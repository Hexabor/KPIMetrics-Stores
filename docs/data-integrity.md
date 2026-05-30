# Integridad y recuperación de datos (diseño para fase 4)

Documento de diseño. **No implementado todavía** — se aplicará junto con el
backend MySQL en la fase 4. Pendiente de validar con David antes de codificar.

## Objetivo

Cuando el equipo de operaciones empiece a volcar CSVs sobre la BD MySQL,
errores humanos (CSV incompleto, tienda olvidada, fecha mal exportada, etc.)
podrían contaminar los KPIs silenciosamente. Necesitamos tres capas:

1. **Prevención** — atrapar errores antes de tocar la BD.
2. **Detección** — alertar sobre anomalías post-import.
3. **Recuperación** — deshacer importaciones erróneas sin perder lo demás.

## 1. Regla "solo semanas enteras"

Toda importación debe cubrir una o varias **semanas completas CeX**
(sábado a viernes).

**Validación al subir el CSV** (antes de procesar):

- Parsear todas las fechas → calcular fecha mínima y máxima.
- Verificar que la mínima es un **sábado** y la máxima es un **viernes**.
- Verificar que `(max - min + 1) es múltiplo de 7`.
- Si no cumple → rechazar con mensaje claro:
  *"Las cargas deben cubrir semanas completas (sábado a viernes), una o
  varias. Esta carga termina en miércoles. Espera al viernes o recorta al
  rango anterior."*

Mensaje persistente en la página de importación recordando la regla.

Esta validación es de límites de fechas, no de actividad interna. Un día
sin operaciones dentro de una semana (festivo, cierre de la cadena) es
normal y no rompe el check.

## 2. Ciclo de vida de tienda

### Modelo

Extender `stores`:

```sql
ALTER TABLE stores ADD COLUMN opened_at DATE NULL;
ALTER TABLE stores ADD COLUMN closed_at DATE NULL;  -- NULL = sigue abierta
```

`active` queda derivada (`closed_at IS NULL`).

**"Activa en la semana W"** =
`opened_at <= W_fin AND (closed_at IS NULL OR closed_at > W_inicio)`.

Si en el futuro hace falta modelar cierres temporales (reformas, etc.) se
migra a una tabla `store_status(store_id, effective_from, status, reason)`
sin tocar lo existente.

### Bootstrap

La primera importación es **excepcional** y define la línea base. Todas
las tiendas que aparezcan en ese CSV se adoptan automáticamente como
activas con `opened_at` = inicio del rango. Sin diálogo de anomalías.

A partir de ahí, el catálogo está iniciado y todas las cargas siguientes
se contrastan contra él.

## 3. Flujo de import con diff esperado vs actual

Tras validar que las semanas están completas, para cada `(semana × source)`:

1. **Set actual**: tiendas con operaciones en esa semana en el CSV.
2. **Set esperado**: tiendas activas en esa semana según `stores` (usando
   la fecha de la semana, no la fecha actual — soporta imports históricos).
3. **Diff**:
   - **Missing**: esperada y sin operaciones esta semana → anomalía.
   - **Unexpected**: presente pero no activa → tienda nueva o histórica.

Antes de hacer COMMIT, **diálogo de decisión** al admin:

```
La importación de W35–W38 contiene anomalías:

MISSING:
  • Madrid Islazul (sin operaciones en W37)
    [Saltar / Marcar como cerrada desde 16/05/2026 / Cancelar import]

UNEXPECTED:
  • Sevilla Nervión (aparece en W35–W38, no registrada)
    [Nueva tienda desde 27/04/2026 / Es errata, descartar filas / Cancelar import]

  • Madrid Vallecas (aparece en W35, cerró 30/04/2026)
    [Reabierta el 27/04 / Históricamente activa hasta 30/04 / Cancelar import]
```

Las decisiones del admin **mutan `stores`** (opened_at, closed_at) y
persisten — la próxima vez no se vuelve a preguntar lo mismo.

### Reglas de actividad por fuente

| Fuente | Validación semana completa | Validación store-set | Notas |
|---|---|---|---|
| Baby Banking ES / IC | Sí | Sí: tienda activa con 0 ops en la semana = MISSING | |
| Ecom | Sí | Sí, pero subset: solo tiendas que hacen ecom (atributo a marcar en `stores`?) | Algunas tiendas no operan online |
| Captación | Sí | Sí: 0 socios/semana en tienda activa = MISSING | Confirmado con David — la anomalía es ausencia total, no umbral |
| Attachment | Trivial (ya viene por semana) | Sí | |

### Festivos a nivel cadena

CeX confirma que **25/12 y 1/1** son los únicos días en que no opera
ninguna tienda. Catálogo simple:

```sql
CREATE TABLE chain_holidays (
    holiday_date DATE PRIMARY KEY,
    description VARCHAR(80)
);
INSERT INTO chain_holidays VALUES
  ('2025-12-25', 'Navidad'),
  ('2026-01-01', 'Año Nuevo'),
  ...;
```

Estos días no rompen el check de "semana completa" (que es de límites,
no de actividad) y los usaremos en analytics futuros para comparar
semanas like-for-like (una semana con 25/12 tendrá menos volumen).

## 4. Recuperación

### Rollback granular por `import_id`

`operations.import_id` ya está en el schema. Borrar todas las filas con
ese id deshace ese import específico sin tocar los demás.

Para ecom (no añade filas, solo tagea): cada import guarda en
`imports` qué refs etiquetó (campo nuevo, e.g. `tagged_refs JSON`);
rollback = revertir esas refs a `channel='tienda'`.

### Snapshot pre-mutación para captación

Captación usa `replace-by-date-range` (destructivo). Antes de borrar:

```sql
CREATE TABLE operations_archive LIKE operations;
ALTER TABLE operations_archive ADD COLUMN archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE operations_archive ADD COLUMN superseded_by_import_id BIGINT UNSIGNED;

-- En cada import de captación:
INSERT INTO operations_archive (...)
SELECT *, NOW(), :new_import_id FROM operations
WHERE source = 'captacion' AND date BETWEEN :from AND :to;
DELETE FROM operations WHERE ...;
```

Si el admin se da cuenta de que el CSV nuevo era erróneo, una operación
"restore from archive" devuelve esas filas y elimina las que aplicó el
import problemático.

### Backup completo

`mysqldump` diario al FTP de Hostinger (o Google Drive cuando se
implemente Drive). Comprimido + cifrado. Retención escalonada:
7 días + 4 semanas + 12 meses. Restauración manual ante desastres.

## 5. Auditoría y alertas

### Tabla `import_checks`

```sql
CREATE TABLE import_checks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    import_id BIGINT UNSIGNED NOT NULL,
    check_name VARCHAR(40),       -- 'missing_store', 'unexpected_store', etc.
    severity ENUM('info','warn','error'),
    payload JSON,                 -- detalles: store, week, etc.
    decision VARCHAR(40) NULL,    -- decisión tomada por el admin (si aplica)
    decided_by INT UNSIGNED NULL, -- user_id
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_id) REFERENCES imports(id)
);
```

Sirve para:
- Diario forense de qué se decidió y cuándo.
- Panel "Auditoría de imports" en Configuración (admin only).
- Si en el futuro se añaden checks post-import (drops anómalos vs
  histórico), se registran aquí con `severity='warn'`.

### Permisos

Confirmado con David: solo `admin` puede importar y configurar.
`viewer` solo consume dashboards. Las decisiones del diálogo de
anomalías quedan registradas en `import_checks.decided_by`.

## 6. Roadmap de implementación

**Imprescindible desde día 1 del backend**:
- Validación "semana completa" en endpoint de import.
- `stores.opened_at` / `stores.closed_at` + lógica de activa-en-semana.
- Diálogo de anomalías (frontend).
- Rollback por `import_id` (endpoint + UI mínima).
- Snapshot pre-mutación para captación.
- `mysqldump` diario en cron Hostinger.
- Catálogo de `chain_holidays` con 25/12 y 1/1 sembrado.

**Importante en las primeras semanas**:
- Panel "Auditoría de imports" en Configuración (lista + botón "Deshacer").
- Cross-check de ecom análogo al de attachment.

**Mejora continua**:
- Checks post-import refinados según fallos reales (drops drásticos,
  outliers, etc.).
- Alertas por email al admin cuando un check da `error`.

## Preguntas resueltas (sesión 30/05/2026)

- **Bootstrap del catálogo**: primera importación = excepcional, marca línea base.
- **Captación, anomalía**: 0 socios/semana en tienda activa.
- **Permisos**: solo `admin` importa y configura.
- **Festivos cadena**: 25/12 y 1/1 únicamente.
