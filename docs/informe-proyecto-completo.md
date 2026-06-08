# KPI Metrics 2026 (Stores Edition) — Informe completo del proyecto

> **Para qué sirve este documento.** Es un dossier autónomo y exhaustivo del
> proyecto y, en especial, de la **Fase 4a** (añadir un backend MySQL). Está
> escrito para poder pegarse en otro chat sin contexto previo y pedir
> explicaciones sobre cualquier punto: arquitectura, conceptos, decisiones.
> Si lo lees en frío: empieza por §1 (qué es esto) y §3 (conceptos), que son
> la base para entender todo lo demás.
>
> Autor del proyecto: **Arc** (Manager de CeX Madrid Islazul). Perfil no
> técnico de formación, aprendiendo backend sobre la marcha. Las explicaciones
> aquí asumen que se valora entender el *porqué*, no solo el *qué*.

---

## 1. Qué es el proyecto

**KPI Metrics 2026** es una herramienta web interna para visualizar KPIs
(indicadores de negocio) de las tiendas de CeX en España: ventas netas,
compras, % vale, captación de socios, attachment, etc. Se alimenta de CSVs
exportados de Looker (la herramienta de datos de CeX).

- **"Stores Edition"**: es una bifurcación (fork) pública de una herramienta
  interna mayor (`KPITool2026`). La diferencia esencial: esta versión **descarta
  el dato de Staff (empleado) al importar y no lo guarda en ninguna forma**, por
  cumplimiento **GDPR** (protección de datos). Solo trabaja a nivel de tienda,
  nunca de empleado.
- **Estado de hosting**: empezó en GitHub Pages (hosting estático gratis) y se
  está moviendo a un hosting propio (Hostinger) con dominio, HTTPS y, ahora, una
  base de datos.

### Reglas de negocio que conviene saber para entender los datos

- **Semanas de negocio**: van de **sábado a viernes** (no lunes-domingo). La
  semana 1 del curso actual empieza el **27/12/2025**.
- **Fechas visibles** siempre en formato **DD/MM/AAAA**.
- **Ventas netas** = Σ(ventas) − Σ(refunds). **Compras** = cash buy + exchange.
- **Captación** = socios captados (membresías). **Attachment** = % de ventas en
  tienda hechas con un socio.

---

## 2. La gran foto: arquitectura (antes y ahora)

### 2.1 Cómo era (y sigue siendo en producción hasta que se promocione la 4a)

Una **app de frontend puro**: HTML + CSS + JavaScript, sin servidor. Todo corría
en el navegador. Los datos se guardaban en **IndexedDB** (una base de datos que
vive *dentro del navegador*, en el PC de cada usuario) mediante la librería
**Dexie.js**.

Consecuencia clave: **los datos no se compartían**. Cada navegador/dispositivo
tenía su propia copia. Si Arc importaba los CSVs en su portátil, nadie más los
veía; en otro PC, la app aparecía vacía.

### 2.2 Cómo es ahora (Fase 4a, en construcción)

Se añade un **backend**: una capa de servidor que guarda los datos en una base
de datos central **MySQL**, compartida por todos.

```
   NAVEGADOR (frontend: HTML/CSS/JS — calcula los KPIs)
        │   módulo "Database" (la costura)
        │      ├─ lecturas  → snapshot en memoria
        │      └─ escrituras → fetch (peticiones HTTP) a la API
        ▼
   API PHP  (carpeta /api/*.php en el servidor)
        │   protegida por Basic Auth + secreto compartido
        ▼
   MySQL  (base de datos central, 7 tablas)  ← datos compartidos y consistentes
```

### 2.3 El **principio rector** (la idea que simplifica todo)

> El **cálculo de los KPIs sigue ocurriendo en el navegador**. El backend NO es
> un motor de cálculo: es solo una **capa de persistencia** (guardar y leer).

Esto es posible porque la app ya cargaba *toda* la tabla de operaciones en
memoria y computaba los KPIs en JavaScript. Mantenemos ese modelo: al arrancar,
el navegador pide un **"snapshot"** (foto completa de los datos) a la API, lo
guarda en memoria, y todos los cálculos siguen igual que antes. Solo las
**escrituras** (importar, editar, borrar) pasan por el servidor.

Ventaja enorme: **no hay que reescribir los KPIs en SQL**. Se reescribe muy poco.

---

## 3. Conceptos clave (glosario explicado)

Esta sección es la más útil para pedir profundización en otro chat.

### 3.1 FTP vs Base de datos (dos mundos distintos en el servidor)

- **FTP** = el **sistema de archivos** del servidor. Como una carpeta: contiene
  archivos (`index.html`, imágenes, `.css`, `.php`). Se accede con un programa
  FTP (aquí, una extensión de VSCode).
- **MySQL (la base de datos)** = un **servicio aparte** que corre en el mismo
  servidor y guarda datos en tablas. **No se ve como un archivo en el FTP.** Es
  invisible desde el explorador de archivos. Solo se le habla mediante código
  (PHP) o un panel de administración (phpMyAdmin).
- Analogía: el FTP es la **estantería de archivadores** (ves las carpetas);
  MySQL es una **caja fuerte empotrada** que no ves en la estantería y solo se
  abre con su combinación (usuario + contraseña).

### 3.2 Qué es un archivo `.php`

Un **programa** que el servidor **ejecuta** cuando alguien visita su URL. No es
un dato ni una base de datos: es código. Cuando el navegador pide
`https://.../api/snapshot.php`, el servidor *ejecuta* ese PHP, que se conecta a
MySQL, lee datos y devuelve una respuesta (aquí, en formato JSON). El visitante
nunca ve el código fuente del PHP, solo su resultado.

### 3.3 API y JSON

- **API** = el conjunto de "puertas" (URLs) que ofrece el backend para que el
  frontend pida o envíe cosas. Cada puerta es un **endpoint** (ej.
  `/api/operations-bulk.php`).
- **JSON** = el formato de texto en el que viajan los datos entre frontend y
  backend (listas y objetos: `{"operations": [...]}`).
- **fetch** = la función de JavaScript con la que el navegador llama a la API.
- **GET vs POST**: GET = "dame datos" (lectura). POST = "toma estos datos"
  (escritura).

### 3.4 IndexedDB / Dexie vs MySQL

- **IndexedDB**: base de datos del **navegador** (local, por dispositivo).
  **Dexie.js** es la librería que la hacía fácil de usar. → datos NO compartidos.
- **MySQL**: base de datos del **servidor** (central, compartida). → datos
  consistentes para todos.
- En la Fase 4a se **retira Dexie** y la fuente de verdad pasa a ser MySQL.

### 3.5 GitHub (repo) vs GitHub Pages vs Hostinger

- **Repositorio de GitHub** = la **copia maestra del código** y su historial
  (control de versiones). NO es donde corre la app; es donde vive el código. Es
  **público** (`Hexabor/KPIMetrics-Stores`): cualquiera ve el *código*, pero NO
  los datos ni las contraseñas (esos nunca se suben).
- **GitHub Pages** = un hosting **estático** que publica el contenido de la rama
  `main`. **No puede ejecutar PHP** ni hablar con MySQL → solo sirve la versión
  Dexie. Se jubilará cuando Hostinger sirva la versión con backend.
- **Hostinger** = el hosting propio (de pago) donde corre la app *de verdad* + el
  PHP + MySQL. Dominio: `capimetrics.cexsv.com`.
- Analogía: GitHub es el **libro de recetas** (con su historial de ediciones);
  Hostinger es la **cocina montada y funcionando** con la despensa (la BD) llena.

### 3.6 Migraciones de base de datos

Una **migración** es un archivo `.sql` numerado que aplica **un cambio** a la
estructura de la BD. Encadenadas en orden (`001_`, `002_`, ...) construyen o
hacen evolucionar la BD **sin perder datos**.

- Reglas: numeradas y en orden; una migración aplicada **no se edita jamás** (si
  hay que corregir, se hace otra nueva); de la 002 en adelante son **aditivas**
  (`ADD COLUMN`, `CREATE TABLE` — no destructivas).
- Un **runner** (`migrate.php`) aplica solo las migraciones que aún no se han
  aplicado, llevando la cuenta en una tabla `schema_migrations`. Es
  **idempotente** (correrlo dos veces no repite nada).
- Por qué importa: cuando los datos sean compartidos, cualquier cambio de
  estructura afecta a todos; las migraciones versionadas lo hacen ordenado y
  repetible.

### 3.7 La "costura" de autenticación

Es un **punto único** en el código (`api/auth.php`, función `exigirAdmin()`)
donde se decide quién puede escribir. Hoy es un *stub* (comprobación mínima). El
día que se implemente el login real (Google OAuth, Fase 4b), se cambia **solo esa
función** y *todos* los endpoints quedan protegidos a la vez. Dejar la costura
puesta desde el principio hace que aplazar el login real **no genere deuda
técnica**.

### 3.8 Seguridad: Basic Auth, secreto compartido, repo público

- **Basic Auth**: una ventana de usuario/contraseña que pide el servidor
  (configurada en el archivo `.htaccess`) antes de dejar entrar a la web. En la
  Fase 4a es el **portero principal**: quien entra es "admin de facto".
- **Secreto compartido (`APP_SECRET`)**: una cadena larga que las escrituras de
  la API exigen en una cabecera (`X-App-Secret`). Es **defensa en capas**.
- **Repo público + secretos**: como el código es público, las contraseñas NUNCA
  se suben a git. Viven en archivos **gitignored** (`config.php`,
  `js/config.local.js`) que solo existen en el PC de Arc y en el servidor.

### 3.9 RBAC (Role-Based Access Control)

"Control de acceso basado en roles": lo que puedes hacer depende de tu **rol**.
Aquí habrá dos: **admin** (todo: importar, editar, configurar) y **viewer**
(solo mirar dashboards). La seguridad real se comprueba **en el servidor** (la
API rechaza escrituras de un viewer), no solo ocultando botones. Llega en la
**Fase 4b**; la columna `role` ya existe en la tabla `users`.

### 3.10 El módulo `Database` como "costura" del frontend

Todo el almacenamiento del frontend pasa por un único módulo
(`js/modules/database.js`) con ~30 funciones públicas (`getAllOperations`,
`bulkAddOperations`, `getSetting`...). El resto de la app (`app.js`, el motor de
KPIs) solo habla con ese módulo. Por eso, para cambiar de Dexie a MySQL bastó con
**reescribir ese módulo por dentro manteniendo sus nombres de función idénticos**:
nada más de la app se enteró.

---

## 4. El modelo de datos (las 7 tablas de MySQL)

La BD se llama `u782235572_CPMT`. Tablas:

1. **`stores`** — catálogo de tiendas (id, nombre, region ES/IC, ...). El nombre
   es único. `code` es opcional (nullable desde la migración 002).
2. **`users`** — usuarios del sistema, con `role` (admin/viewer). Para la Fase 4b.
3. **`user_stores`** — relación usuarios↔tiendas (para permisos por tienda en el
   futuro). Vacía en v1.
4. **`imports`** — registro de cada carga CSV (auditoría): fuente, fecha, nº
   filas, rango de fechas, tiendas afectadas.
5. **`operations`** — **la tabla principal** (fact table). Una fila por
   transacción: tienda, tipo (Sale, Cash Buy, Exchange, Refund, RMA,
   test-admission, membership), categoría, fecha, cantidad, precio, total,
   semana, fuente, canal (tienda/ecom). **Sin columna staff (GDPR).**
6. **`attachment_weekly`** — KPI Attachment agregado por (tienda, ciclo, semana,
   fuente). Granularidad semanal, por eso tiene su propia tabla.
7. **`settings`** — configuración clave-valor (grupos de tiendas, familias de
   categorías, inicio de curso, etc.) en formato JSON.

### Detalles importantes del modelo

- **Tienda: nombre vs id.** El frontend trabaja con el **nombre** de la tienda;
  MySQL guarda un `store_id` (número) que apunta a `stores`. La API traduce: al
  leer hace un JOIN (`store_id` → nombre); al escribir resuelve nombre → id,
  **dando de alta la tienda automáticamente** si es nueva.
- **Deduplicación.** Es **por fuente**: la misma orden en Baby Banking y en Ecom
  NO es duplicado (es intencionado: indica ventas online dentro de baby banking).
  En MySQL lo garantiza un índice `UNIQUE (reference, source, price, category)`.
- **Captación** se guarda **agregada** por (tienda, día): una fila con
  `quantity` = socios captados ese día. Member Id y Staff se descartan (GDPR).
- **GDPR / Staff**: el dato de empleado se descarta en el parser y hay "defensas"
  (`delete record.staff`) en varios puntos del código + tests de regresión que
  fallan si alguien reintroduce staff. **Regla absoluta del proyecto.**

---

## 5. La API (los endpoints construidos en la Fase 4a)

Todos en la carpeta `/api/`. Las escrituras exigen permisos (`exigirAdmin()`).

| Endpoint | Qué hace |
|---|---|
| `GET snapshot.php` | Devuelve el dataset completo (operations + attachment + settings + imports) para que el navegador calcule. **Lectura.** |
| `POST operations-bulk.php` | Inserta operaciones en bloque. Da de alta tiendas nuevas. Dedup por el índice UNIQUE. |
| `POST attachment-bulk.php` | Upsert del attachment semanal. |
| `POST ecom-cross-reference.php` | Marca como `ecom` las filas de baby-banking cuya referencia coincide con ventas online. |
| `POST operations-replace-range.php` | Borra (y opcionalmente reinserta) un rango de fechas. Lo usa captación. |
| `POST operations-delete-source.php` | Borra una fuente entera (o revierte el tag ecom). |
| `POST imports.php` | Registra una carga (auditoría). |
| `POST settings.php` | Guarda un ajuste (upsert global). |
| `POST reset.php` | Vacía todos los datos (restablecer). |
| `api/auth.php` | La costura de permisos (no es un endpoint, lo usan todos). |
| `api/lib.php` | Helpers compartidos (resolver/crear tiendas). |

Archivos de soporte fuera de `/api/`:
- **`config.php`** (raíz, gitignored): credenciales MySQL + `APP_SECRET`.
- **`migrate.php`** (raíz): el runner de migraciones.
- **`db/migrations/*.sql`**: las migraciones versionadas (`001`, `002`).

---

## 6. Las decisiones tomadas y su porqué

Esta es la sección para entender **por qué** se hizo así y no de otra forma.

### 6.1 Backend "capa de persistencia", no motor de queries
Porque la app ya calculaba en el navegador. Reescribir los KPIs en SQL sería
enorme y sin beneficio. Coste: cargar todo en memoria (ya se hacía; escala a
cientos de miles de filas sin problema).

### 6.2 Secuenciación de la autenticación: 4a sin login, 4b con OAuth
Google OAuth es **ortogonal** a conectar la app con MySQL. Meter las dos cosas a
la vez sería depurar dos problemas nuevos simultáneamente (Arc aprendiendo). Por
eso:
- **Fase 4a**: un solo nivel de acceso (todos los que pasan el Basic Auth son
  admin), **con la costura de permisos ya puesta**.
- **Fase 4b**: se cambia el stub por Google OAuth + RBAC real. Como el schema ya
  tiene `users.role`, no cambia nada de la estructura. Decisión reversible.

**Política de acceso de la Fase 4b (definida por Arc, firme):**
- **Solo cuentas `@webuy.com`** (el dominio corporativo) pueden acceder.
  Cualquier email de otro dominio queda **fuera por completo** (ni siquiera
  viewer).
- Una cuenta `@webuy.com` nueva entra como **`viewer`** por defecto (se da de
  alta automáticamente al primer login; no hay que pre-añadirla).
- El **primer admin** es `abeatrice@webuy.com`, sembrado a mano una sola vez.
- Los **admins pueden elevar** a otras cuentas `@webuy.com` a admin (desde una
  pantalla "Usuarios" en Configuración, solo para admins).
- En el backend: verificar el token de Google, comprobar que el email termina
  en `@webuy.com` (si no, denegar), buscar/crear la fila en `users` (rol viewer
  por defecto) y aplicar el rol.

### 6.3 Decisión A — `stores.code` nullable + alta automática
La app conoce el **nombre** de la tienda pero no un código. En vez de obligar a
Arc a mapear códigos a mano, se relajó `code` a opcional (migración 002) y las
tiendas se crean solas al importar (region derivada de la fuente: las fuentes
"-ic" son Canarias, el resto España).

### 6.4 Decisión B — retirar Dexie (no mantenerlo como caché offline)
El servidor es la única fuente de verdad. Mantener Dexie como caché para trabajar
sin conexión añadiría complejidad de sincronización que no compensa ahora.

### 6.5 Decisión C / C-bis — arranque limpio + preservar configuración
MySQL empieza vacío y se re-importan los CSVs. Pero la **configuración** (grupos,
familias, inicio de curso, alias) no está en los CSVs, así que se **preserva**
aparte. *(Nota: surgió una vía aún más cómoda — restaurar el backup `.json.gz` de
la versión Dexie desde el propio botón de la app, que migraría datos Y
configuración de golpe. Pendiente de decidir en el paso 8.)*

### 6.6 Decisión D — integridad mínima en 4a
Las validaciones avanzadas (que cada carga cubra "semanas enteras", diálogo de
anomalías, ciclo de vida de tienda — diseñadas en `docs/data-integrity.md`) se
dejan para una fase propia. En 4a solo lo que sale gratis (deshacer una
importación por su `import_id`).

### 6.7 `renormalize` deferido (no-op en 4a)
El retro-arreglo de nombres de tienda ya guardados (cuando se añade un alias
nuevo) se aplaza: en el modelo normalizado el nombre vive en un solo sitio
(`stores.name`) y el "merge" es complejo. Las importaciones **nuevas** ya llegan
con los nombres reconciliados, así que no se pierde nada en el día a día; para
aplicar un alias a datos viejos, se re-importa esa fuente.

### 6.8 Estrategia de ramas (red de seguridad)
- `main` se queda **congelado** como la versión Dexie estable (la que David puede
  enseñar a Edu esta semana).
- Todo el desarrollo de la 4a vive en la rama **`fase-4a`**.
- Un **tag `v1.0-stores`** marca un punto de retorno inmutable.
- Hostinger no se toca (en su frontend) hasta que la 4a esté probada.
- Para el test, el frontend 4a se desplegará en un **subfolder `/test4a/`** para
  no tocar la demo principal.

---

## 7. Cómo se ha trabajado (flujos operativos que se repiten)

### 7.1 Ejecutar algo contra la BD (no hay phpMyAdmin)
Arc no tiene panel de control de Hostinger (lo tiene David), y MySQL solo acepta
conexiones desde el propio servidor. Patrón: un **script PHP** (con las
credenciales de `config.php`) se sube por FTP y se ejecuta abriéndolo en el
navegador. Para tareas de un solo uso (crear el schema), el script se **borra
después**. El runner de migraciones, en cambio, se queda (es una herramienta).

### 7.2 Borrar un archivo del servidor
La extensión SFTP de VSCode **no** borra con clic derecho (al clicar lo abre).
Para borrar archivos del servidor se usa `curl -Q 'DELE archivo'` por FTP.

### 7.3 Aplicar una migración (el bucle para siempre)
1. Escribir `db/migrations/NNN_descripcion.sql`. 2. Subirlo por FTP. 3. Abrir
`migrate.php?token=APP_SECRET` en el navegador. 4. El runner aplica solo lo nuevo.
5. Commit del archivo.

---

## 8. Estado actual y plan (los 9 pasos de la Fase 4a)

```
✅ 1  config.php + auth.php (costura)
✅ 2  migrate.php (runner) + baseline de la migración 001
✅ 3  migración 002 (stores.code nullable), aplicada
✅ 4  GET /api/snapshot — PROBADO (la web lee de MySQL)
✅ 5  POST operations-bulk (+ alta automática de tiendas)
✅ 6  resto de endpoints de escritura (8 en total)
✅ 7  reescritura de database.js + retirada de Dexie (56 tests OK)
⬜ 8  desplegar en /test4a/ e importar un CSV (test de integración)
⬜ 9  verificar en dos dispositivos que ven los mismos datos
```

**Dónde están las cosas ahora mismo:**
- La BD MySQL existe con sus 7 tablas (vacía de datos).
- El backend (`config.php`, `migrate.php`, `db/`, y `api/auth.php` + `snapshot.php`)
  está subido al servidor. **Los endpoints de escritura del paso 6 y el `auth.php`
  actualizado aún NO están subidos** (pendiente para el paso 8).
- Todo el código está commiteado y empujado a la rama `fase-4a` en GitHub.
- `main` y GitHub Pages siguen sirviendo la versión Dexie (demo intacta).

**Lo que falta (paso 8):** crear `js/config.local.js`, subir el frontend 4a a
`/test4a/` + re-subir `/api/` entero, importar un CSV de prueba y ver las filas
aterrizar en MySQL. Luego (paso 9) abrir en dos dispositivos.

**Después (otras fases):** Fase 4b (Google OAuth + RBAC real), capa completa de
integridad de datos, jubilar GitHub Pages, promover `/test4a/` a la raíz.

---

## 9. Reglas absolutas del proyecto (no romper nunca)

1. **GDPR / Staff**: el dato de empleado no se guarda en ninguna forma. Hay
   defensas en el código y tests de regresión que lo vigilan.
2. **Nunca commitear secretos**: `config.php` y `js/config.local.js` son
   gitignored. El repo es público.
3. **Una migración aplicada no se edita**: se corrige con otra nueva.
4. **`main` se queda estable** hasta que la 4a esté probada; el desarrollo va en
   `fase-4a`.
5. **Una sola app con roles**, no dos versiones del código (evitar duplicar y que
   diverjan).
6. **Terminología UI**: no usar la palabra "ajustes" (es un KPI interno de CeX);
   usar "configuración".
7. **Iconos**: siempre minimalistas y monocromos (SVG con stroke), nunca emojis.

---

## 10. Glosario rápido (para buscar un término suelto)

- **Backend**: la parte de servidor (PHP + MySQL) que guarda y sirve los datos.
- **Frontend**: la app que corre en el navegador (HTML/CSS/JS).
- **Endpoint**: una URL de la API que hace una cosa concreta.
- **Snapshot**: la foto completa de los datos que el frontend carga en memoria.
- **Migración**: un cambio versionado en la estructura de la BD.
- **Runner**: el script que aplica las migraciones (`migrate.php`).
- **Costura**: punto único del código preparado para cambiar de comportamiento
  (aquí, la autenticación).
- **Stub**: una implementación provisional mínima que se rellenará después.
- **Upsert**: insertar o, si ya existe, actualizar.
- **Idempotente**: ejecutar algo dos veces da el mismo resultado que una.
- **Fact table**: la tabla principal de hechos/transacciones (`operations`).
- **GDPR**: reglamento europeo de protección de datos.
- **RBAC**: control de acceso por roles.
- **Basic Auth**: ventana de usuario/contraseña a nivel de servidor.
- **OAuth**: protocolo de login con cuentas externas (aquí, Google) — Fase 4b.

---

## 11. Cómo usar este documento en otros chats

Pega la sección (o el documento entero) que te interese y pregunta, por ejemplo:
- "Explícame con un ejemplo qué hace `operations-bulk.php` paso a paso."
- "No entiendo la diferencia entre IndexedDB y MySQL en mi caso, profundiza."
- "¿Por qué es mejor un subfolder /test4a/ que desplegar en la raíz?"
- "Explícame la costura de autenticación como si tuviera 12 años."
- "¿Qué riesgos tiene tener el repo público con una base de datos detrás?"

Cuanto más concreta la pregunta y más contexto pegues de aquí, mejor la
respuesta. Este documento refleja el estado a fecha **08/06/2026**, con la Fase
4a construida (pasos 1-7) y pendiente de desplegar y probar (pasos 8-9).
