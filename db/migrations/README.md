# Migraciones de la base de datos

Guía permanente. Si no te acuerdas de cómo vamos, **lee esto primero**.

## Qué es una migración (en una frase)

Un archivo `.sql` numerado que aplica **un cambio** a la estructura de la
base de datos. Encadenados en orden, reconstruyen la BD desde cero o la
hacen evolucionar sin perder datos. Son la **fuente de verdad** del schema
(a partir de ahora, por encima de `docs/db-schema-stores.sql`, que queda
como instantánea histórica).

## Reglas de oro

1. **Numeradas y en orden.** `001_...`, `002_...`, `003_...`. Se aplican
   siempre de menor a mayor.
2. **Una migración aplicada NO se edita jamás.** Si ya corrió en la BD, está
   "congelada". ¿Te equivocaste o quieres cambiar algo? → migración nueva
   que lo corrige. (Editar una ya aplicada = la BD real y los archivos dejan
   de coincidir = caos.)
3. **Aditivas, no destructivas** (de la 002 en adelante). `ADD COLUMN`,
   `CREATE TABLE`, `CREATE INDEX`. Nada de `DROP` sobre datos reales salvo
   que sea imprescindible y muy pensado. (La 001 es la excepción: tiene
   `DROP TABLE IF EXISTS` solo para poder recrear el schema en una BD vacía.)
4. **Un cambio lógico por archivo.** "Añadir ciclo de vida de tienda" = una
   migración. No mezcles tres cosas no relacionadas en un archivo.
5. **Nombre descriptivo.** `003_store_lifecycle.sql`, no `003_cambios.sql`.

## Cómo procedemos CADA VEZ que toque cambiar la BD

Cuando un KPI o funcionalidad nueva necesite sitio en la BD, el flujo es
siempre el mismo:

1. **Diseño primero** (norma del proyecto: no implementar sin spec). Decidimos
   qué columna/tabla hace falta y por qué.
2. **Creo el archivo** `db/migrations/NNN_descripcion.sql` con el `ALTER`/
   `CREATE`. NNN = el siguiente número libre.
3. **Lo aplicamos** con el runner (ver abajo): se conecta a MySQL y ejecuta
   solo las migraciones que aún no se hayan aplicado, en orden.
4. **Commit** del archivo. Queda versionado en git para siempre.
5. (Si hubiera una BD de pruebas y otra real) se aplican los **mismos**
   archivos en ambas → estructuras idénticas garantizadas.

El día que haya datos reales y un cambio dé miedo, antes de aplicar la
migración se hace `mysqldump` (backup) — ver `docs/data-integrity.md`.

## El runner (se construye en la Fase 4a, junto con la API)

Un script PHP `migrate.php` que:

- Crea (si no existe) una tabla **`schema_migrations`** que registra qué
  archivos ya se aplicaron. Esa tabla la gestiona el runner solo; **no** es
  una migración que escribas tú.
- Lee `db/migrations/*.sql`, y por cada archivo **no registrado todavía**:
  lo ejecuta y anota su nombre en `schema_migrations`.
- Resultado: ejecutar el runner es **idempotente** — corre solo lo nuevo,
  nunca repite lo ya aplicado. Si todo está al día, no hace nada.

> Seguridad: la carpeta `db/` no debe ser accesible por navegador en el
> servidor (contiene tu schema). Al desplegar el runner se protege con
> `.htaccess` (`Require all denied`) o las migraciones se suben de forma
> temporal y se borran, como hicimos con `db-setup.php`. Se decide en el
> spec de la Fase 4a. Por eso `db/` también está en el `ignore` de la
> extensión SFTP: no se sube por accidente.

## Estado actual

| Migración | Qué hace | Estado |
|---|---|---|
| `001_schema_inicial.sql` | 7 tablas base (stores, users, user_stores, imports, operations, attachment_weekly, settings) | **Aplicada** en `u782235572_CPMT` el 08/06/2026 (vía `db-setup.php`, antes de existir el runner) |

Cuando se construya el runner, la 001 se marca como baseline ya aplicada
(la BD ya la tiene) y a partir de la 002 todo pasa por el runner.
