# Spec — Fase 4b: Google OAuth + RBAC real

> Estado: **APROBADO (12/06/2026)**. Continúa la Fase 4a
> (backend MySQL single-user, ya en producción). Aquí se sustituye el acceso
> interino (Basic Auth + secreto compartido) por **login con Google** y dos
> roles reales (`admin` / `viewer`). Toda la "costura" necesaria se dejó puesta
> en 4a: el cambio es localizado.
>
> Desarrollo en la rama `fase-4b` (creada desde `fase-4a` el 12/06/2026).
> Punto de retorno seguro: `fase-4a` (congelada) y tag `v1.0-stores` (Dexie).

## 1. Objetivo

Que solo entren cuentas del dominio corporativo **`@webuy.com`**, autenticadas
con Google, y que haya **dos niveles reales de permiso**:

- **admin**: acceso total (importar, editar, configurar, gestionar usuarios).
- **viewer**: solo lectura (ve los dashboards; sin botones de importar/editar).

La seguridad real vive en el **backend** (rechaza escrituras sin sesión admin);
el frontend solo oculta/deshabilita controles por UX.

### Qué SÍ entra (4b)

- **Login con Google** (Google Identity Services) en el frontend.
- **Verificación del `id_token` en el backend** vía el endpoint `tokeninfo` de
  Google (decisión tomada — ver §11.2).
- **Gate de dominio**: solo `@webuy.com`; cualquier otro dominio → 403.
- **Auto-provisión**: una cuenta `@webuy.com` nueva se crea sola como `viewer`
  en su primer login (allowlist por DOMINIO, no lista pre-cargada).
- **Seed del primer admin**: `abeatrice@webuy.com` (cuenta de trabajo de Arc).
- **Sesiones reales** (PHP nativo, cookie httponly): el `id_token` se valida una
  vez en el login; el resto del tráfico va por la cookie de sesión.
- **Reescritura de la costura** `api/auth.php`: `exigirAdmin()` exige sesión +
  rol admin; nueva `exigirSesion()` (cualquier usuario logueado) para lecturas.
- **RBAC en la UI**: los viewers no ven importar/editar/reset/escrituras de
  configuración. Cabecera con usuario + "Cerrar sesión".
- **Pantalla "Usuarios"** en Configuración (admin-only): elevar/degradar rol y
  activar/desactivar cuentas.
- **Retirada del Basic Auth** del `.htaccess` (lo reemplaza OAuth — decisión §11.3).
- **Retirada del secreto compartido** del frontend (`appSecret`): ya no hace
  falta, manda la cookie de sesión.

### Qué NO entra (queda fuera de 4b)

- Permisos por tienda (`user_stores`): la tabla existe pero queda **vacía** en
  4b. El rol es global (admin o viewer sobre todo el dataset).
- Verificación local del token con JWKS (endurecimiento futuro, innecesario a
  esta escala — ver §11.2 y §12).
- Logout remoto / expiración avanzada de sesiones, refresh tokens, recordar
  dispositivos. Sesión simple basada en cookie.
- Auditoría de acciones por usuario más allá de `imports.imported_by` y
  `users.last_login`.

## 2. Principio rector

**Un solo punto decide quién puede qué: `api/auth.php`.** En 4a quedó como stub
(siempre admin). En 4b se rellena con la sesión real. Como TODOS los endpoints
de escritura ya llaman a `exigirAdmin()` desde el día uno, rellenar esa función
los protege a todos de golpe. **El cálculo, el snapshot y el modelo de datos no
cambian** respecto a 4a — esto es una capa de identidad por delante, no una
reescritura del backend.

## 3. Arquitectura y flujo de login

```
Navegador                Frontend (GIS)      Backend PHP             MySQL
   │  "Entrar con Google"   │                    │                     │
   │──────────────────────> │  id_token (JWT)    │                     │
   │                        │── POST auth-login ─>│  valida id_token    │
   │                        │                     │  (tokeninfo Google) │
   │                        │                     │  aud==ClientID,     │
   │                        │                     │  email_verified,    │
   │                        │                     │  dominio==webuy.com  │
   │                        │                     │── find/create user ─>│ role=viewer (default)
   │                        │                     │  o seed → admin      │
   │                        │<── Set-Cookie sesión│  $_SESSION{uid,role} │
   │   la app arranca       │                     │                     │
   │   (lecturas/escrituras │── fetch + cookie ──>│  exigirSesion() /    │
   │    con la cookie)      │                     │  exigirAdmin()       │
```

Clave: **`tokeninfo` solo se llama en el login**. Una vez abierta la sesión,
cargar dashboards, importar CSVs y navegar van por la cookie, sin tocar Google.
A la escala de la herramienta (decenas a bajos cientos de logins/día como techo)
esto sobra de margen.

## 4. Backend — endpoints nuevos

Todos devuelven JSON.

| Endpoint | Método | Auth | Qué hace |
|---|---|---|---|
| `api/auth-login.php` | POST | pública | Recibe `{id_token}`. Valida con `tokeninfo`. Aplica gate de dominio. Find/create user (viewer por defecto; seed → admin). Actualiza `last_login`. Abre `$_SESSION`. Devuelve `{email, name, role}`. |
| `api/auth-me.php` | GET | sesión | Devuelve el usuario de la sesión, o 401 si no hay. Lo llama el frontend al arrancar para decidir login vs. app. |
| `api/auth-logout.php` | POST | sesión | Destruye la sesión y borra la cookie. |
| `api/users.php` | GET / PUT | **admin** | GET: lista usuarios. PUT `{id, role?, active?}`: cambia rol (admin↔viewer) o activa/desactiva. No permite que un admin se quite a sí mismo el último rol admin (guard anti-bloqueo). |

### 4.1 Validación del `id_token` (`auth-login.php`)

1. POST `https://oauth2.googleapis.com/tokeninfo?id_token=<token>` (o GET con el
   token en query). Si Google responde error → 401.
2. Comprobar **todos** estos campos de la respuesta:
   - `aud` === nuestro `GOOGLE_CLIENT_ID` (config.php). *Crítico*: descarta
     tokens emitidos para otra app.
   - `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}.
   - `email_verified` === `true` (o `"true"`).
   - `exp` en el futuro (tokeninfo ya lo valida, pero lo reconfirmamos).
   - **dominio**: `email` termina en `@webuy.com` (y si viene `hd`, que sea
     `webuy.com`). Si no → **403** (no es "login fallido", es "dominio no
     permitido"; el frontend muestra mensaje claro).
3. Find/create en `users` por `email`:
   - Si no existe → INSERT con `role = 'viewer'`, `name` del token.
   - Si el email está en `ADMIN_SEED_EMAILS` (config) y se crea ahora → `admin`.
   - Si existe → actualizar `name` y `last_login` (no se toca el rol existente).
   - Si `active = 0` → 403 (cuenta desactivada).
4. Guardar en `$_SESSION`: `user_id`, `email`, `role`.

La lógica del gate de dominio se extrae a una función pura `emailPermitido($email,
$emailVerified, $hd): bool` para poder testearla sin red (§9).

## 5. Backend — reescribir la costura (`api/auth.php`)

Es el corazón del cambio, y es pequeño. Hoy:

```php
function usuarioActual() { return ['id'=>0,'name'=>'admin','role'=>'admin']; }
function exigirAdmin() { /* secreto X-App-Secret O Basic Auth presente */ }
```

En 4b:

```php
function usuarioActual() {
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    if (empty($_SESSION['user_id'])) return null;
    return [
        'id'    => $_SESSION['user_id'],
        'email' => $_SESSION['email'],
        'role'  => $_SESSION['role'],
    ];
}

function exigirSesion() {            // cualquier usuario logueado (lecturas)
    $u = usuarioActual();
    if (!$u) { http_response_code(401); exit(json_encode(['error'=>'unauthenticated'])); }
    return $u;
}

function exigirAdmin() {             // solo admin (escrituras)
    $u = exigirSesion();
    if ($u['role'] !== 'admin') { http_response_code(403); exit(json_encode(['error'=>'forbidden'])); }
    return $u;
}
```

- Los **9 endpoints de escritura** ya llaman a `exigirAdmin()` → cero cambios en
  ellos. Quedan protegidos por sesión + rol automáticamente.
- `api/snapshot.php` (lectura) pasa a llamar **`exigirSesion()`**: un viewer debe
  poder leer el snapshot, pero un anónimo no. Esto además **tapa la fuga de datos
  por HTTP** mejor que el Basic Auth (el snapshot deja de ser accesible sin login).
- Se elimina la rama del secreto `X-App-Secret` y de Basic Auth.

## 6. Schema / migración

`db/migrations/003_seed_admin.sql` — siembra el primer admin. Aditiva e
idempotente:

```sql
INSERT INTO `users` (`email`, `name`, `role`)
VALUES ('abeatrice@webuy.com', 'Arc', 'admin')
ON DUPLICATE KEY UPDATE `role` = 'admin';
```

(El `name` real se sobrescribe en el primer login con el de Google.) **No hay más
cambios de schema**: `users(email, name, role, active, last_login)` y el check
`role IN ('admin','viewer')` ya existen desde la `001`. Se aplica con el runner
`migrate.php` ya existente.

> Alternativa considerada y descartada: seed por config (`ADMIN_SEED_EMAILS`) en
> el código de login en vez de migración. Mantenemos AMBOS: la migración crea la
> fila de Arc explícitamente, y `ADMIN_SEED_EMAILS` cubre el caso de que la fila
> no exista aún cuando entre por primera vez. A David se le eleva a admin **desde
> la pantalla "Usuarios"** cuando esté listo (no se siembra).

## 7. Frontend

### 7.1 Carga de Google Identity Services

- Añadir `<script src="https://accounts.google.com/gsi/client" async defer>` en
  `index.html`.
- Retirar el `<script src="https://apis.google.com/js/api.js">` legacy de Drive
  (línea 16) si ya no se usa, y el `drive-sync.js` asociado si procede.

### 7.2 Gate de arranque (antes de `Database.init()`)

1. Al cargar, llamar `GET /api/auth-me.php`.
2. Si 401 → mostrar **pantalla de login**: botón de Google (estilo minimalista
   monocromo, coherente con el resto). Sin barra lateral ni dashboard.
3. Al firmar, GIS entrega el `credential` (id_token) → `POST /api/auth-login.php`.
   - 200 → guardar el usuario, ocultar login, arrancar la app (`Database.init()`).
   - 403 dominio → mensaje claro: "Solo cuentas @webuy.com".
   - 403 desactivada → "Tu cuenta está desactivada, contacta con un admin".
4. Botón "Cerrar sesión" → `POST /api/auth-logout.php` → recargar a la pantalla
   de login.

### 7.3 Retirada del secreto compartido

- `apiPost` (database.js) **deja de mandar** `X-App-Secret`; usa la cookie de
  sesión (same-origin, ya se envía sola).
- `js/config.local.js` pierde `appSecret`, gana `googleClientId` (público — no es
  secreto). Actualizar `js/config.example.js` igual.
- `apiGet`/`apiPost`: en respuesta **401** disparar el flujo de re-login (la
  sesión expiró) en vez de un error opaco.

### 7.4 RBAC en la UI (solo UX)

- Exponer el usuario actual y un helper central `esAdmin()`.
- Para viewers: ocultar/deshabilitar importar, editar, reset, y las escrituras de
  Configuración (grupos, familias, alias, inicio de curso, ecom-por-KPI). Las
  **lecturas y los dashboards se ven igual**.
- Cabecera: nombre del usuario + rol + "Cerrar sesión".
- Recordatorio: esto es cosmético. Aunque un viewer fuerce un POST con DevTools,
  el backend responde 403. La UI solo evita confusión.

### 7.5 Pantalla "Usuarios" (Configuración, admin-only)

- 7ª pestaña en Configuración, visible solo para admins.
- Lista usuarios (email, nombre, rol, activo, último login) desde `GET
  /api/users.php`.
- Permite elevar/degradar (admin↔viewer) y activar/desactivar vía `PUT`.
- Guard de UI + backend: no dejar que el admin se auto-degrade si es el último
  admin activo.

## 8. `.htaccess` / hosting

- **Retirar el Basic Auth** (decisión §11.3): lo reemplaza OAuth. Sin doble login.
- **Mantener** las capas de no-indexación: `robots.txt`, meta `noindex` en
  `index.html`, `Header set X-Robots-Tag "noindex, nofollow"`.
- **Mantener** el deny de rutas sensibles: `db/.htaccess` (`Require all denied`) y
  la regla global `\.(md|sh|sql|lock)$`. `config.php` sigue protegido/gitignored.
- Sesiones PHP: ficheros por defecto de Hostinger (válido). Cookie con `HttpOnly`,
  `Secure`, `SameSite=Lax`.

## 9. Verificación y tests

- **Unitario (puro, sin red)**: `emailPermitido($email, $emailVerified, $hd)`.
  Casos: `@webuy.com` verificado → true; `@gmail.com` → false; `@webuy.com` no
  verificado → false; `hd` ausente pero email correcto → true; `hd` distinto →
  false. Test de regresión del gate de dominio.
- **Lógica de rol**: alta nueva → viewer; email en `ADMIN_SEED_EMAILS` → admin;
  usuario existente → rol no se pisa.
- **Checklist manual en vivo** (no automatizable, OAuth real):
  1. Login con `abeatrice@webuy.com` → entra como **admin**, ve todo.
  2. Login con otra `@webuy.com` → entra como **viewer**, NO ve importar/editar.
  3. Login con `@gmail.com` → **403**, mensaje "solo @webuy.com".
  4. Viewer hace POST a `/api/operations-bulk.php` con DevTools → **403**.
  5. Anónimo (sin sesión) hace GET a `/api/snapshot.php` → **401**.
  6. Desde "Usuarios": elevar el viewer a admin → recarga y ya ve importar.
  7. Cerrar sesión → vuelve a la pantalla de login.
  8. Sesión expirada → la app detecta 401 y reabre el login sin romperse.

## 10. Plan de implementación (incremental, cada paso verificable)

> **Bloqueante previo (Arc):** crear el **OAuth Client ID** en Google Cloud del
> Workspace `webuy.com` (consent screen tipo **Internal**, origen autorizado
> `https://capimetrics.cexsv.com`). Arc lo crea con su cuenta `@webuy.com`. Sin
> esto, nada se puede probar en vivo.

1. **Config**: añadir `GOOGLE_CLIENT_ID` y `ADMIN_SEED_EMAILS` a `config.php`
   (servidor). Frontend: `googleClientId` en `config.local.js`/`config.example.js`.
2. **Migración `003_seed_admin.sql`** aplicada por `migrate.php`.
3. **`auth-login.php`** con `emailPermitido()` + validación `tokeninfo` +
   find/create + sesión. Probar con un id_token real (login manual).
4. **`auth-me.php` / `auth-logout.php`**. Verificar ciclo sesión.
5. **Reescribir `api/auth.php`**: `usuarioActual` / `exigirSesion` / `exigirAdmin`.
   `snapshot.php` pasa a `exigirSesion()`. Verificar: anónimo→401, viewer→lee,
   admin→escribe.
6. **`users.php`** (GET/PUT) con el guard anti-auto-degradación.
7. **Frontend**: gate de login + GIS + retirar `appSecret` de `apiPost`/config +
   manejo de 401.
8. **RBAC en UI** + pantalla "Usuarios".
9. **Retirar Basic Auth** del `.htaccess`; mantener noindex y denies.
10. **Pruebas en vivo** (checklist §9) y commit. Elevar a David a admin cuando
    confirme que todo va.

## 11. Decisiones

- **11.1 — Client ID / seed admin.** ✅ **Resuelto:** Arc crea el Client ID con
  su cuenta `@webuy.com`. Seed admin = `abeatrice@webuy.com`. David se eleva a
  admin desde "Usuarios" cuando esté todo listo (no se siembra).
- **11.2 — Verificación del token.** ✅ **Resuelto:** `tokeninfo` (una llamada a
  Google por login). A la escala de la herramienta (la sesión absorbe el tráfico;
  techo realista de bajos cientos de logins/día aun escalando a corporativo)
  sobra de margen. JWKS local queda como endurecimiento futuro, localizado en una
  sola función, si algún día el volumen lo exigiera. Decisión reversible.
- **11.3 — Basic Auth.** ✅ **Resuelto:** se retira al activar OAuth (sin solape;
  evita doble login). Se mantienen las capas de no-indexación y los denies.
- **11.4 — Permisos por tienda (`user_stores`).** ✅ **Resuelto:** fuera de 4b.
  Rol global. La tabla queda vacía, lista para una fase futura.

## 12. Riesgos

- **Dependencia externa (Google Cloud).** Crear el Client ID puede requerir
  permisos del Workspace `webuy.com`. Mitigación: Arc confirma que su cuenta
  puede crearlo antes de comprometer fechas; es el primer paso del plan.
- **`tokeninfo` como dependencia de red en el login.** Si Google no responde, no
  se puede iniciar sesión (las sesiones ya abiertas siguen). Mitigación: a esta
  escala el endpoint es fiable; el endurecimiento a JWKS está disponible y es
  localizado.
- **Retirar Basic Auth deja la web "abierta" hasta el primer login.** Mitigación:
  `snapshot.php` y las escrituras ya exigen sesión (401/403); sin login no se ve
  ningún dato. Las capas de no-indexación siguen evitando que aparezca en buscadores.
- **Bloqueo por auto-degradación.** Un admin podría quitarse el rol y dejar el
  sistema sin admins. Mitigación: guard en backend + UI (no degradar al último
  admin activo).
- **Cache agresiva de LiteSpeed/navegador** (recurrente en 4a). Tras subir JS/CSS
  nuevos, forzar `Disable cache` + Ctrl+Shift+R; valorar cache-busting `?v=`.
