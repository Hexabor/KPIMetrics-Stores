# Spec — Fase 4a: Backend MySQL (single-user, sin OAuth)

> Estado: **APROBADO (08/06/2026)**. Todas las decisiones tomadas. Listo para
> implementar siguiendo el plan de §10. La Fase 4b (Google OAuth + RBAC real)
> es un spec aparte y posterior.

## 1. Objetivo

Conectar la app a la base de datos MySQL `u782235572_CPMT` (ya creada, fase
de hoy) para que los datos **dejen de vivir solo en el IndexedDB de cada
navegador** y pasen a estar en un sitio central, compartido y consistente
entre dispositivos.

### Qué SÍ entra (4a)

- Una **API PHP** que lee y escribe en MySQL.
- El módulo `Database` del frontend reescrito para hablar con la API en vez
  de con Dexie, **manteniendo la misma firma pública** (app.js y el motor de
  KPIs no se tocan).
- **Un solo nivel de acceso** ("perfil único" tipo admin): quien entra puede
  leer y escribir. Detrás de Basic Auth + un secreto compartido.
- La **costura de permisos** (`exigirAdmin()`) puesta en cada endpoint de
  escritura desde el día uno, aunque hoy sea un stub que no hace nada.
- El **runner de migraciones** `migrate.php` + tabla `schema_migrations`.
- **Arranque limpio**: MySQL empieza vacío y se re-importan los CSV. La
  configuración (settings) se preserva aparte — ver §8.2.

### Qué NO entra (queda para 4b u otras fases)

- Google OAuth, sesiones reales, distinción admin/viewer. (Costura lista, sin
  implementar.)
- La capa completa de integridad de `docs/data-integrity.md` (validación de
  semana completa, diálogo de anomalías, ciclo de vida de tienda). En 4a solo
  el mínimo: rollback por `import_id` queda disponible de facto.
- Funcionar offline / sincronización bidireccional con conflictos.

## 2. Principio rector (la decisión que lo simplifica todo)

**El cálculo sigue en el navegador. El backend es persistencia, no motor de
queries.** Hoy la app hace `getAllOperations()` → array completo en memoria →
el motor de KPIs computa todo client-side. Mantenemos ese modelo:

- Al cargar, el cliente pide un **snapshot completo** (`GET /api/snapshot`) y
  lo guarda en memoria, exactamente como hoy llena `opsCache`.
- Todos los métodos de lectura de `Database` que ya operan sobre ese array
  (`getDateRangeBySource`, `getStorageSummaryBySource`, `queryOperations`,
  `getOperationsForKPI`, `getDistinctValues`, etc.) **siguen igual**, solo que
  el array viene de la API en vez de Dexie.
- Solo las **escrituras** y las **mutaciones con lógica** van a endpoints.

Ventaja: reescribimos poco, no reimplementamos los KPIs en SQL, y validamos
la consistencia (que es el objetivo) con el mínimo de superficie nueva.

Límite conocido: cargar todo en memoria escala a decenas/cientos de miles de
filas sin problema (es lo que ya hace hoy). Si algún día el volumen lo exige,
se introducen queries server-side **sin romper la costura** (los métodos de
`Database` ya son el punto único donde cambiarlo). No es problema de 4a.

## 3. Arquitectura

```
Navegador (frontend puro, sin cambios en KPIs)
   │  módulo Database (MISMA firma publica)
   │     ├─ lecturas  → snapshot en memoria (como opsCache hoy)
   │     └─ escrituras → fetch JSON
   ▼
API PHP  (/api/*.php)  ── Basic Auth + secreto compartido + exigirAdmin() stub
   │
   ▼
MySQL u782235572_CPMT  (7 tablas, ya creadas)
```

## 4. Reconciliación de modelos Dexie ↔ MySQL

Hay tres desajustes reales entre cómo guarda hoy Dexie y cómo es el schema
MySQL. Resolverlos es el grueso del trabajo de datos de 4a.

### 4.1 Tienda: nombre (texto) vs `store_id` (FK)  ⚠️ decisión abierta

Hoy `operations.store` es el **nombre** de la tienda (string). En MySQL es
`operations.store_id` → `stores.id`. Hace falta un **catálogo de tiendas** y
resolver nombre→id al escribir.

Problema: `stores` exige `code VARCHAR(10) NOT NULL` y `region NOT NULL`. La
app solo conoce el **nombre**; `region` es derivable (baby-banking=ES,
baby-banking-ic=IC, attachment por columna Region), pero **`code` no existe**
en los datos actuales.

→ **Resuelto (Decisión A):** migración `002` que haga `stores.code` nullable,
y bootstrap que dé de alta cada tienda nueva al importar (region derivada,
code NULL de momento). El reconciler de nombres (alias) ya existe en el
frontend y se reutiliza antes de enviar. Esta es la **primera migración real**
con la disciplina nueva (`002_stores_code_nullable.sql`).

### 4.2 Settings: clave-valor plano vs con scope

Dexie: `settings(key → value)`. MySQL: `settings(key, value, scope, store_id,
user_id)`. En 4a todo es `scope='global'`, `store_id=NULL`, `user_id=NULL`.
`getSetting/setSetting` mapean a esa fila global. Trivial.

### 4.3 Dedup: fingerprint en JS vs UNIQUE en la BD

Hoy `getExistingFingerprints` calcula duplicados en JS antes de insertar. En
MySQL el índice `uq_ops_dedup (reference, source, price, category)` lo hace
solo: el endpoint de importación usa `INSERT ... ON DUPLICATE KEY UPDATE`
(o `INSERT IGNORE`) y la dedup es automática y atómica. **Mejor que hoy.**

## 5. Endpoints de la API

Todos devuelven JSON. Las escrituras pasan por `exigirAdmin()`. Mapeo directo
a los métodos actuales de `Database`:

| Método / Verbo | Reemplaza a | Notas |
|---|---|---|
| `GET /api/snapshot` | `getAllOperations` + `getAllAttachmentWeekly` + `getImportHistory` + settings | Devuelve el dataset completo para computar en cliente. |
| `POST /api/operations/bulk` | `bulkAddOperations` | INSERT con dedup por unique key. Resuelve store→id. Devuelve nº insertadas. |
| `POST /api/attachment/bulk` | `bulkPutAttachmentWeekly` | UPSERT por PK natural. |
| `POST /api/ecom/cross-reference` | `crossReferenceEcom` | UPDATE channel='ecom' WHERE reference IN (...). En SQL. |
| `POST /api/operations/replace-range` | `replaceOperationsByDateRange` | DELETE por (source, rango) + INSERT. Transacción. |
| `POST /api/operations/delete-source` | `deleteBySource` | DELETE por source (o untag ecom). |
| `POST /api/operations/renormalize` | `renormalize*StoresForSource` | UPDATE de nombres→nuevo id. |
| `POST /api/imports` | `logImport` | Inserta fila de auditoría. |
| `GET/PUT /api/settings/:key` | `getSetting/setSetting` | scope=global. |

> Nota: varias mutaciones que hoy son lógica JS sobre Dexie pasan a ser SQL
> server-side (cross-reference, delete-source, replace-range). Es más robusto
> (atómico) pero es el trabajo real de PHP de esta fase.

## 6. Seguridad interina (4a)

Tres capas, ninguna definitiva (la auth real es 4b):

1. **Basic Auth** del `.htaccess` ya existente: filtra quién llega a la web y
   a la API.
2. **Secreto compartido**: la API exige una cabecera `X-App-Secret: <token>`
   en las escrituras (igual idea que el `?token=` de `db-setup.php`). Defensa
   en capas por si una ruta se sirve sin Basic Auth.
3. **Costura de permisos**: cada endpoint de escritura llama a `exigirAdmin()`.

```php
// auth.php — hoy stub, en 4b se rellena con la sesión OAuth real.
function usuarioActual() { return ['id' => 0, 'role' => 'admin']; }
function exigirAdmin() {
    // 4a: comprueba solo el secreto compartido.
    if (($_SERVER['HTTP_X_APP_SECRET'] ?? '') !== APP_SECRET) {
        http_response_code(403); exit(json_encode(['error' => 'forbidden']));
    }
    // 4b: añadir aquí la comprobación de sesión + rol === 'admin'.
}
```

El día de 4b se cambia **una sola función** y todos los endpoints quedan
protegidos. Deferir OAuth cuesta ~0 y no deja deuda.

Credenciales MySQL y `APP_SECRET`: en un `config.php` **fuera del webroot** si
el hosting lo permite, o protegido por `.htaccess` (`Require all denied`).
Nunca en git (gitignored, mismo patrón que `db-setup.php`).

## 7. Runner de migraciones — `migrate.php`

- Crea la tabla `schema_migrations(filename, applied_at)` si no existe (la
  gestiona el runner, no es una migración de usuario).
- Lee `db/migrations/*.sql` en orden y aplica solo las **no registradas**.
- Idempotente: corre solo lo nuevo.
- **Baseline**: como la `001` ya está aplicada a mano (hoy), el runner se
  ejecuta una primera vez en modo "marcar 001 como aplicada sin re-ejecutar"
  (o se inserta su fila a mano). De la `002` en adelante, flujo normal.
- Protección: `db/` no accesible por navegador (`.htaccess Require all denied`)
  o se sube temporal y se borra. Ya está en el `ignore` de la extensión SFTP.

## 8. Migración de la app y de los datos

### 8.1 Código (el módulo Database)

Reescribir `js/modules/database.js` para que sus métodos hagan `fetch` a la
API. **La firma pública del módulo no cambia** → `app.js`, `kpi-engine.js`,
`csv-parser.js` no se tocan. Las lecturas se sirven del snapshot cacheado en
memoria; las escrituras llaman a los endpoints y luego invalidan/refrescan el
snapshot.

**Resuelto (Decisión B):** Dexie se **retira**. El servidor es la única fuente
de verdad y el cliente cachea el snapshot en memoria (como hoy `opsCache`).
Se elimina la dependencia de Dexie.js y el módulo `init()` que crea la DB
IndexedDB.

### 8.2 Datos existentes de Arc

**Resuelto (Decisión C):** arranque limpio. MySQL empieza vacío y Arc
**re-importa los CSV** por el flujo normal (que ahora escribe en MySQL). No
hace falta endpoint de migración de snapshot.

**Resuelto (Decisión C-bis):** los CSV solo contienen *operations* y
*attachment*. La **configuración** (grupos de tiendas, familias de categorías,
inicio de curso, config ecom-por-KPI, alias de captación) vive en `settings` y
**no está en ningún CSV**. Se **preserva** con un empujón único: se exporta
solo `settings` del IndexedDB actual y se sube vía `PUT /api/settings` (una
fila por clave, scope=global). Así Arc re-importa los datos pesados pero no
rehace la configuración.

## 9. Layout en el servidor

```
/ (webroot)
  index.html, js/, css/, assets/, data/      ← la app (ya está)
  .htaccess                                   ← Basic Auth + reglas
  api/
    snapshot.php, operations.php, ...         ← endpoints
    auth.php                                  ← costura de permisos
  config.php            ← creds MySQL + APP_SECRET (gitignored, protegido)
  migrate.php           ← runner (protegido / temporal)
  db/migrations/*.sql   ← protegido (Require all denied)
```

## 10. Plan de implementación (incremental, cada paso verificable)

1. `config.php` + `auth.php` (stub) + protección de rutas sensibles.
2. `migrate.php` + baseline de la `001`. Verificar: re-ejecutar no hace nada.
3. Migración `002_stores_code_nullable.sql` (Decisión A) aplicada por el
   runner → primera migración real con la disciplina nueva.
4. `GET /api/snapshot` (solo lectura) contra la BD vacía → devuelve estructura
   vacía bien formada.
5. `POST /api/operations/bulk` + resolución/alta de tienda store→id.
   Verificar con un CSV pequeño que las filas llegan a MySQL.
6. Resto de endpoints de escritura (attachment, ecom, delete-source, etc.).
7. Reescritura de `database.js` contra la API y retirada de Dexie. Verificar
   que la app entera funciona igual que hoy pero leyendo/escribiendo en MySQL.
8. Arranque limpio: re-importar los CSV + preservar `settings` (C-bis).
9. Verificación final: abrir la app en **dos dispositivos** y comprobar que
   ven los mismos datos (el objetivo de la fase).

## 11. Decisiones (resueltas 08/06/2026)

- **Decisión A — catálogo de tiendas / `code`.** ✅ **Resuelto:** `code`
  nullable (migración `002`) + alta automática de tienda al importar.
- **Decisión B — Dexie.** ✅ **Resuelto:** retirarlo; servidor = fuente de
  verdad, cliente cachea snapshot en memoria. Sin offline.
- **Decisión C — datos actuales.** ✅ **Resuelto:** arranque limpio,
  re-importar CSV (no se migra el IndexedDB local).
- **Decisión C-bis — configuración (settings).** ✅ **Resuelto:** se preserva
  con un empujón único (export de settings → `PUT /api/settings`). No se
  recrea a mano.
- **Decisión D — alcance de integridad en 4a.** ✅ **Resuelto:** mínimo
  (rollback por `import_id` gratis; el resto de `data-integrity.md` en una fase
  propia, fuera de 4a).

## 12. Riesgos

- **El interino se apoya en Basic Auth + secreto.** No es seguridad fuerte;
  mitiga que la herramienta no está enlazada públicamente. No meter datos
  sensibles más allá de lo ya asumido hasta 4b.
- **"Luego" (4b) puede no llegar.** Mitigación: 4b es el hito inmediatamente
  siguiente, escrito en memoria, no "algún día".
- **Reescribir `database.js` toca el corazón de la app.** Mitigación: la firma
  pública no cambia y se verifica paso a paso contra el comportamiento actual.
- **`config.php` con credenciales en un hosting compartido.** Mitigación:
  fuera del webroot si se puede; si no, `Require all denied` + gitignored.
```
