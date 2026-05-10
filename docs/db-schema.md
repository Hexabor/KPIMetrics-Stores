# Esquema de Base de Datos — KPI Metrics 2026

**Propuesta para servidor corporativo (multi-tienda)**

| | |
|---|---|
| Versión | 1.0 |
| Fecha | 06/05/2026 |
| Autor | Arc — Manager CeX Madrid Islazul |
| Estado | Propuesta inicial para revisión |

---

## 1. Contexto y objetivo

KPI Metrics 2026 es la herramienta de analítica de tienda que actualmente corre como aplicación web local (frontend puro + IndexedDB en el navegador). El objetivo de este documento es **definir la estructura de la base de datos centralizada** que permitirá migrar la aplicación a un servidor corporativo y dar acceso a varias tiendas desde una única instalación.

El esquema se ha derivado del modelo de datos en producción local (Dexie/IndexedDB v5), respetando los KPIs y reglas de negocio ya validadas, y se ha extendido para soportar:

- **Multi-tienda**: varias tiendas conviven en la misma BBDD; consultas y permisos se segmentan por tienda.
- **Multi-usuario**: gerentes, regional managers y staff con permisos diferenciados.
- **Auditoría**: trazabilidad de quién importó qué y cuándo.

---

## 2. Visión general del modelo

El modelo se compone de **6 tablas**:

| Tabla         | Propósito                                                     | Volumen estimado            |
|---------------|---------------------------------------------------------------|-----------------------------|
| `stores`      | Catálogo maestro de tiendas                                   | Decenas de filas            |
| `users`       | Usuarios con acceso al sistema                                | Decenas a centenares        |
| `user_stores` | Permisos por usuario y tienda (rol)                           | Centenares                  |
| `operations`  | **Tabla principal**: cada fila es una operación (venta, etc.) | Millones de filas/año       |
| `imports`     | Log de cargas de CSV (auditoría)                              | Miles de filas/año          |
| `settings`    | Configuración de la aplicación (clave-valor)                  | Decenas de filas            |

Relaciones:

```
stores (1) ──< (N) operations
stores (1) ──< (N) user_stores >── (N) users
users  (1) ──< (N) imports
imports(1) ──< (N) operations
```

---

## 3. Tablas — definición detallada

### 3.1. `stores` — Catálogo de tiendas

Cada fila es una tienda física. Centraliza el nombre canónico de la tienda y permite normalizar las referencias desde otras tablas.

| Campo        | Tipo                | Nulable | Long. | Descripción / Dominio |
|--------------|---------------------|:------:|:-----:|------------------------|
| `id`         | INT UNSIGNED PK auto-inc | NO | — | Identificador interno |
| `code`       | VARCHAR             | NO     | 10    | Código corto único (ej. `ISLZ`, `YORK`) |
| `name`       | VARCHAR             | NO     | 60    | Nombre canónico (ej. `Madrid Islazul`) |
| `region`     | VARCHAR             | NO     | 2     | Dominio cerrado: `ES` (Península/Baleares), `IC` (Canarias) |
| `manager`    | VARCHAR             | SÍ     | 80    | Nombre del manager actual (informativo) |
| `active`     | BOOLEAN             | NO     | —     | TRUE si la tienda está operativa |
| `created_at` | TIMESTAMP           | NO     | —     | Auditoría |
| `updated_at` | TIMESTAMP           | NO     | —     | Auditoría |

**Restricciones:**
- `UNIQUE (code)` — el código identifica unívocamente a la tienda.
- `UNIQUE (name)` — para evitar duplicados por errores tipográficos.

---

### 3.2. `users` — Usuarios del sistema

| Campo        | Tipo                | Nulable | Long. | Descripción / Dominio |
|--------------|---------------------|:------:|:-----:|------------------------|
| `id`         | INT UNSIGNED PK auto-inc | NO | — | Identificador interno |
| `email`      | VARCHAR             | NO     | 120   | Email corporativo (login) |
| `name`       | VARCHAR             | NO     | 80    | Nombre completo |
| `role`       | VARCHAR             | NO     | 20    | Dominio cerrado: `admin`, `regional`, `manager`, `staff`, `viewer` |
| `active`     | BOOLEAN             | NO     | —     | TRUE si la cuenta está activa |
| `last_login` | TIMESTAMP           | SÍ     | —     | Última vez que entró |
| `created_at` | TIMESTAMP           | NO     | —     | Auditoría |

**Restricciones:**
- `UNIQUE (email)`.

**Notas sobre roles:**
- `admin`: acceso total (incluido el panel de configuración global).
- `regional`: ve los KPIs de varias tiendas asignadas en `user_stores`.
- `manager`: ve los KPIs de una sola tienda (su tienda).
- `staff`: ve solo su rendimiento individual dentro de su tienda.
- `viewer`: solo lectura, sin acceso a configuración ni a importaciones.

---

### 3.3. `user_stores` — Asignación usuario–tienda

Tabla intermedia (N:M) que define a qué tiendas tiene acceso cada usuario y con qué rol específico. Permite que un mismo usuario sea, por ejemplo, `manager` en una tienda y `staff` en otra.

| Campo        | Tipo                | Nulable | Long. | Descripción |
|--------------|---------------------|:------:|:-----:|------------------------|
| `user_id`    | INT UNSIGNED FK → `users.id`  | NO | — | |
| `store_id`   | INT UNSIGNED FK → `stores.id` | NO | — | |
| `role`       | VARCHAR             | NO     | 20    | Mismo dominio que `users.role` |
| `created_at` | TIMESTAMP           | NO     | —     | Auditoría |

**Restricciones:**
- PK compuesta `(user_id, store_id)`.
- ON DELETE CASCADE en ambas FKs.

---

### 3.4. `operations` — Tabla principal

Cada fila representa **una línea de operación** (venta, compra a cliente, refund, captación de socio, etc.) ya normalizada y lista para alimentar los KPIs. Es la tabla con mayor volumen de filas.

| Campo        | Tipo                       | Nulable | Long. | Descripción / Dominio |
|--------------|----------------------------|:------:|:-----:|------------------------|
| `id`         | BIGINT UNSIGNED PK auto-inc | NO    | —     | Identificador interno |
| `store_id`   | INT UNSIGNED FK → `stores.id` | NO | —     | Tienda a la que pertenece la operación |
| `reference`  | VARCHAR                    | SÍ     | 32    | Order Number (Looker). NULL en `captacion` (no aplica) |
| `type`       | VARCHAR                    | NO     | 20    | Dominio cerrado: `Sale`, `Cash Buy`, `Transfer`, `Exchange`, `Refund`, `RMA`, `test-admission`, `membership` |
| `category`   | VARCHAR                    | SÍ     | 80    | Categoría del producto (ej. `PlayStation 5`) |
| `date`       | DATE                       | NO     | —     | Fecha de la operación (sin hora) |
| `staff`      | VARCHAR                    | SÍ     | 80    | Nombre del empleado que realizó la operación |
| `quantity`   | INT                        | SÍ     | —     | Puede ser negativa (refunds, cash buys) |
| `price`      | DECIMAL(10,2)              | SÍ     | —     | Precio unitario (puede ser negativo) |
| `total`      | DECIMAL(12,2)              | SÍ     | —     | `quantity × price`, calculado al importar |
| `week`       | SMALLINT UNSIGNED          | SÍ     | —     | Nº de semana del curso (sáb–vie, semana 1 = 27/12/2025) |
| `source`     | VARCHAR                    | NO     | 20    | Dominio cerrado: `baby-banking`, `baby-banking-ic`, `ecom`, `captacion`, `attachment` |
| `channel`    | VARCHAR                    | NO     | 10    | Dominio cerrado: `tienda`, `ecom`. Default `tienda` |
| `import_id`  | BIGINT UNSIGNED FK → `imports.id` | SÍ | —  | Trazabilidad: importación que trajo esta fila |
| `created_at` | TIMESTAMP                  | NO     | —     | Auditoría — fecha de inserción |

**Notas sobre tipos:**
- `DECIMAL` (no `FLOAT` / `DOUBLE`): trabajamos con dinero. Hay que evitar errores de coma flotante.
- `DATE` (no `DATETIME`): la hora del CSV se descarta al normalizar.
- Para `type`, `source`, `channel`: se puede usar `ENUM` si el SGBD lo soporta y se prefiere validar en BBDD; alternativa portable es `VARCHAR` + `CHECK constraint`.

---

### 3.5. `imports` — Log de importaciones

Una fila por cada CSV cargado. Sirve para auditoría, para el panel de "limpieza por fuente" y para calcular cobertura de cruces (ecom × baby-banking).

| Campo         | Tipo                       | Nulable | Long. | Descripción |
|---------------|----------------------------|:------:|:-----:|------------------------|
| `id`          | BIGINT UNSIGNED PK auto-inc | NO    | —     | Identificador |
| `source`      | VARCHAR                    | NO     | 20    | Mismo dominio que `operations.source` |
| `filename`    | VARCHAR                    | SÍ     | 255   | Nombre del CSV original |
| `imported_at` | TIMESTAMP                  | NO     | —     | Cuándo se importó |
| `imported_by` | INT UNSIGNED FK → `users.id` | SÍ   | —     | Quién la ejecutó |
| `row_count`   | INT UNSIGNED               | NO     | —     | Filas válidas insertadas (tras filtros) |
| `date_from`   | DATE                       | SÍ     | —     | Primera fecha cubierta por el CSV |
| `date_to`     | DATE                       | SÍ     | —     | Última fecha cubierta |
| `store_count` | SMALLINT UNSIGNED          | SÍ     | —     | Nº de tiendas distintas en el CSV |
| `stores`      | JSON / TEXT                | SÍ     | —     | Lista de IDs de tienda (JSON array) afectadas |

---

### 3.6. `settings` — Configuración clave-valor

Equivalente al store `settings` de Dexie. Guarda fecha de inicio del curso, configuración de KPIs (qué KPIs cuentan ecom), alias de tiendas para captación, etc.

| Campo        | Tipo        | Nulable | Long. | Descripción |
|--------------|-------------|:------:|:-----:|------------------------|
| `key`        | VARCHAR PK  | NO     | 64    | Clave única |
| `value`      | JSON / TEXT | NO     | —     | Valor serializado (JSON preferido) |
| `scope`      | VARCHAR     | NO     | 20    | Dominio cerrado: `global`, `store`, `user` |
| `store_id`   | INT UNSIGNED FK → `stores.id` | SÍ | — | NULL si scope = global o user |
| `user_id`    | INT UNSIGNED FK → `users.id`  | SÍ | — | NULL si scope = global o store |
| `updated_at` | TIMESTAMP   | NO     | —     | Última modificación |

**Restricciones:**
- Unicidad lógica: `(key, scope, store_id, user_id)` debe ser único.

---

## 4. Restricciones de unicidad y deduplicación

La regla de deduplicación que ya valida el cliente al importar CSVs debe replicarse en BBDD:

> Una operación es duplicada si comparte **(reference, source, price, category)** con otra ya almacenada. La dedup es **por fuente**: un mismo Order Number puede aparecer en `baby-banking` y en `ecom` y NO es duplicado (de hecho, el cruce entre fuentes es lo que permite identificar pedidos online dentro del baby banking).

```sql
CREATE UNIQUE INDEX uq_ops_dedup
  ON operations (reference, source, price, category)
  WHERE reference IS NOT NULL;
```

> Nota: el `WHERE reference IS NOT NULL` evita colisión en filas de `captacion` (que no tienen Order Number). Si el SGBD no soporta índices parciales (MySQL antes de 8.0.13), se puede sustituir por una columna calculada que use un valor centinela.

---

## 5. Índices recomendados

Replican los índices compuestos que ya usa la versión Dexie (probados en producción local):

```sql
-- Índices simples
CREATE INDEX idx_ops_store      ON operations (store_id);
CREATE INDEX idx_ops_date       ON operations (date);
CREATE INDEX idx_ops_reference  ON operations (reference);
CREATE INDEX idx_ops_source     ON operations (source);
CREATE INDEX idx_ops_channel    ON operations (channel);

-- Índices compuestos (los que más usa el motor de KPIs)
CREATE INDEX idx_ops_store_date     ON operations (store_id, date);
CREATE INDEX idx_ops_category_date  ON operations (category, date);
CREATE INDEX idx_ops_type_date      ON operations (type, date);
CREATE INDEX idx_ops_staff_date     ON operations (staff, date);
CREATE INDEX idx_ops_staff_week     ON operations (staff, week);
CREATE INDEX idx_ops_type_week      ON operations (type, week);

-- Imports
CREATE INDEX idx_imports_source_date ON imports (source, imported_at);
```

---

## 6. Equivalencias de tipos por SGBD

| Concepto             | MySQL / MariaDB                 | SQL Server                       | PostgreSQL              |
|----------------------|---------------------------------|----------------------------------|-------------------------|
| PK auto-incremental  | `BIGINT UNSIGNED AUTO_INCREMENT` | `BIGINT IDENTITY(1,1)`          | `BIGSERIAL`             |
| Texto corto          | `VARCHAR(n)`                    | `NVARCHAR(n)`                    | `VARCHAR(n)`            |
| Decimal monetario    | `DECIMAL(12,2)`                 | `DECIMAL(12,2)`                  | `NUMERIC(12,2)`         |
| Fecha sin hora       | `DATE`                          | `DATE`                           | `DATE`                  |
| Marca temporal       | `TIMESTAMP` / `DATETIME`        | `DATETIME2`                      | `TIMESTAMPTZ`           |
| JSON                 | `JSON`                          | `NVARCHAR(MAX)` (con `ISJSON`)  | `JSONB`                 |
| Booleano             | `TINYINT(1)` / `BOOLEAN`        | `BIT`                            | `BOOLEAN`               |
| Enum portable        | `ENUM(...)` o `VARCHAR + CHECK` | `VARCHAR + CHECK`                | `VARCHAR + CHECK`       |

---

## 7. Estimaciones de tamaño

- Una fila de `operations` ≈ **130–180 bytes** sin índices; con índices, ~250–300 B/fila.
- Una tienda CeX típica (estilo Islazul) genera del orden de **30–60 k operaciones/año** → ~10–20 MB/año/tienda.
- Si se centralizan **10 tiendas**: ~100–200 MB/año + índices. Volumen muy holgado para cualquier servidor SQL moderno.
- Las tablas `stores`, `users`, `user_stores`, `imports` y `settings` son despreciables en tamaño.

---

## 8. Migración desde la base de datos local

La aplicación actual exporta backups en formato `.json.gz` (gzip + JSON). El procedimiento de migración inicial sería:

1. **Generar backup** desde KPI Metrics local (botón "Exportar todo").
2. **Pre-poblar** `stores` con el catálogo de tiendas a centralizar y obtener su `id`.
3. **Mapear** las cadenas `store` del backup a `store_id` durante la carga.
4. **Bulk-insert** de `operations` y `imports` en lotes de 5.000 filas.
5. **Recalcular** la columna `week` con la fecha de inicio del curso configurada (`2025-12-27`).

---

## 9. Anexo — DDL ejemplo (PostgreSQL)

```sql
CREATE TABLE stores (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(10)  NOT NULL UNIQUE,
    name        VARCHAR(60)  NOT NULL UNIQUE,
    region      VARCHAR(2)   NOT NULL CHECK (region IN ('ES', 'IC')),
    manager     VARCHAR(80),
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(120) NOT NULL UNIQUE,
    name        VARCHAR(80)  NOT NULL,
    role        VARCHAR(20)  NOT NULL
                CHECK (role IN ('admin','regional','manager','staff','viewer')),
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE user_stores (
    user_id     INT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    store_id    INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, store_id)
);

CREATE TABLE imports (
    id           BIGSERIAL PRIMARY KEY,
    source       VARCHAR(20) NOT NULL,
    filename     VARCHAR(255),
    imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    imported_by  INT REFERENCES users(id),
    row_count    INT NOT NULL DEFAULT 0,
    date_from    DATE,
    date_to      DATE,
    store_count  SMALLINT,
    stores       JSONB
);

CREATE TABLE operations (
    id          BIGSERIAL PRIMARY KEY,
    store_id    INT NOT NULL REFERENCES stores(id),
    reference   VARCHAR(32),
    type        VARCHAR(20) NOT NULL,
    category    VARCHAR(80),
    date        DATE NOT NULL,
    staff       VARCHAR(80),
    quantity    INT,
    price       NUMERIC(10,2),
    total       NUMERIC(12,2),
    week        SMALLINT,
    source      VARCHAR(20) NOT NULL,
    channel     VARCHAR(10) NOT NULL DEFAULT 'tienda',
    import_id   BIGINT REFERENCES imports(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settings (
    key         VARCHAR(64) NOT NULL,
    value       JSONB       NOT NULL,
    scope       VARCHAR(20) NOT NULL CHECK (scope IN ('global','store','user')),
    store_id    INT REFERENCES stores(id),
    user_id     INT REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (key, scope, COALESCE(store_id, 0), COALESCE(user_id, 0))
);

-- Índices (ver sección 5)
```

---

## 10. Preguntas abiertas para concretar con IT

1. **SGBD corporativo**: ¿SQL Server, MySQL/MariaDB, PostgreSQL u Oracle? Algunos detalles (JSON, índices parciales, tipos de auto-inc) cambian.
2. **Autenticación**: ¿Active Directory / SSO corporativo, o gestión de cuentas propia con email + contraseña hasheada (bcrypt)?
3. **Vía de carga de datos**: ¿La aplicación KPI Metrics empuja vía API (frontend → backend), o un proceso programado lee los CSVs de Looker directamente desde un share corporativo?
4. **Retención**: ¿Mantener todo el histórico, o archivar tras X años?
5. **Backups**: ¿Política de la empresa, o conservamos también el export `.json.gz` como respaldo paralelo?
6. **Entorno**: ¿Hace falta un entorno de pre-producción para validar cargas antes del entorno productivo?
