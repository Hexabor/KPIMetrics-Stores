# KPI Metrics 2026 — Stores Edition

Version solo-tiendas (GDPR) de KPI Metrics 2026. Frontend puro (HTML/CSS/JS) que importa CSVs exportados desde Looker (CeX) y calcula KPIs operativos a nivel de tienda y semana de negocio.

## Que tiene de especial esta version

Esta edicion **descarta deliberadamente la columna `Staff` del CSV al importar**. No guarda, no hashea, no aliasea ni mapea el campo en ninguna forma. La base de datos local nunca contiene identificadores de empleado.

Sirve para escenarios donde se quiere usar la herramienta sin exponer informacion de personal (compartirla con terceros, despliegues corporativos, auditorias externas).

Si necesitas KPIs por empleado, usa el repo padre [`KPITool2026`](https://github.com/Hexabor/KPITool2026), que es la version completa con staff.

## Stack

- HTML/CSS/JS puro, sin build step.
- IndexedDB via [Dexie.js](https://dexie.org/) (`KPIMetricsStores2026`).
- [Papa Parse](https://www.papaparse.com/) para streaming de CSV.
- [Chart.js](https://www.chartjs.org/) para graficos.
- [pako](https://github.com/nodeca/pako) para gzip de backups.
- Tests con [Vitest](https://vitest.dev/) (solo dev, la app no usa npm).

## Estructura

```
index.html             Entry point
js/app.js              Controlador principal
js/modules/            csv-parser, kpi-engine, database, ui, drive-sync
css/styles.css         Estilos
data/                  JSON estaticos (categories-supercategories.json)
tests/                 Vitest tests (csv-parser + kpi-engine)
docs/                  Esquemas de DB y spec del barrido destructivo
```

## Desarrollo

```bash
npm install              # instala vitest
npm test                 # tests
npm run test:watch       # tests en watch mode
```

Hay un hook `pre-commit` en `.git/hooks/` que corre los tests antes de cada commit. Replicalo manualmente si haces `git init` en otra maquina (no se versiona).

## Despliegue

- Como cualquier estatico (GitHub Pages, FTP, S3, etc.). Solo necesita servir `index.html` y la carpeta `data/`.
- Roadmap: hosting en FTP propio + backend MySQL (sin staff). Ver `CLAUDE.md` seccion "Roadmap".

## Documentacion

- `CLAUDE.md`: convenciones de desarrollo y reglas de negocio.
- `docs/spec-stores-edition.md`: spec destructivo de la bifurcacion desde KPITool2026.
- `docs/db-schema.md` + `docs/db-schema.html`: esquemas de BD pensados para el futuro backend MySQL.
- `js/changelog.js`: novedades por sesion (las mas recientes arriba).
