# KPI Metrics 2026 - Stores Edition - Normas de desarrollo

> Edicion solo-tiendas (GDPR), derivada de KPITool2026. **La columna Staff del CSV se descarta deliberadamente al importar y no se guarda en ninguna forma** (ver "Campos almacenados" mas abajo). DB Dexie renombrada a `KPIMetricsStores2026` (la del padre era `KPITool2026`). Los backups generados desde el padre no son compatibles con esta version y no deben importarse aqui.
>
> El nombre visible de la app sigue siendo "KPI Metrics 2026". El historial de rebrands (KPI Tool 2026 → CapiMetrics 2026 → KPI Metrix 2026 (typo) → KPI Metrics 2026) se conserva por contexto historico.

## Bifurcacion

- Repo padre: `KPITool2026` (version completa interna, con datos de staff).
- Repo actual: `KPIMetricsStores-Stores` — bifurcacion publica en cuenta `Hexabor` el 10/05/2026 desde el tag `v1.0-staff` del padre.
- Spec del barrido destructivo: `docs/spec-stores-edition.md`.
- Para portar fixes desde el padre: `git fetch upstream && git cherry-pick <sha>` con cuidado de NO traer codigo relacionado con staff/captacion/admision-a-test.

## Formato de fechas
- Todos los campos de fecha visibles al usuario deben mostrarse en formato **DD/MM/AAAA**
- Los selectores de fecha (date pickers) deben mostrar las semanas empezando en **lunes**
- Internamente se puede usar ISO (YYYY-MM-DD) para almacenamiento y queries

## Calendario de negocio
- Las semanas van de **sabado a viernes**
- La **semana 1** del curso actual empieza el **27/12/2025** (sabado)
- Este valor es configurable en Configuracion pero ese es el default fijo

## Tipos de transaccion
- Sale, Cash Buy, Transfer, Exchange, Refund, RMA
- Cash Buy = compra a cliente (precio negativo)
- Transfer con SKU "TXORD" = orden de transferencia interna, no producto fisico

## Campos almacenados (solo KPI-relevantes)
- Se guardan: reference, type, category, date, store, quantity, price, total, source, week, channel
- Se descartan al importar: product, serial, sku, till, **staff**, _raw
- **Staff (GDPR)**: se descarta al importar y no debe reintroducirse bajo ninguna forma (ni hash, ni alias, ni cadena vacia mapeada). Aplica a TODAS las fuentes — Baby Banking, Captacion, etc. Los tests de regresion en `tests/csv-parser.test.mjs` y `tests/kpi-engine.test.mjs` validan que no existe ningun camino de entrada
- Se descartan filas de tipo: transfer (movimientos internos de stock). **Excepcion**: las filas Transfer con categoria "Test"/"TEST" se importan como `type=test-admission` (alimentan los KPIs de admision a test a nivel tienda)
- **Refunds SI se guardan**: necesarios para ventas netas = ventas brutas - refunds
- RMA se guarda pero no se usa aun en KPIs (puede ser util mas adelante)
- Captacion: se guarda **agregada** por (store, date). Una fila en `operations` con `type=membership` y `quantity=N socios captados ese dia en esa tienda`. La agregacion ocurre en `confirmCaptacionImport` antes del `bulkAddOperations`, no en el parser (el parser sigue produciendo una fila por socio del CSV). Member Id, Operating Company y Staff se descartan (anonimizacion + GDPR), por lo que las filas individuales serian indistinguibles — agregar no pierde nada
- Backups comprimidos con gzip (pako.js): exporta .json.gz, importa .gz o .json

## Calculos de negocio clave
- **Ventas netas** = Σ(total sale) − Σ(|total refund|)
- **Compras totales** = Σ(|total cash buy|) + Σ(|total exchange|)
- **Exchange** = compra pagada a cliente en vale de tienda (mas interesante para el negocio)
- **Cash Buy** = compra pagada a cliente en efectivo
- **% Vale** = exchange / compras totales (proporcion pagada en vale)

## Fuentes de importacion
- `baby-banking` (Baby Banking ES): Peninsula y Baleares
- `baby-banking-ic` (Baby Banking IC): Islas Canarias (se exporta aparte en Looker)
- `ecom` (Ecom Sales): no se almacena, solo cruza referencias contra ES + IC
- `captacion` (Store Memberships): 1 fila = 1 socio captado en (tienda, fecha). KPI "Socios" a nivel tienda
- `attachment`, `stocks`: placeholders (proximamente)

## Deduplicacion
- La deduplicacion es **por fuente (source)**. Un mismo Order Number puede aparecer en Baby Banking ES y en Ecom Sales y NO es duplicado
- Esto es intencionado: las coincidencias entre fuentes indican ordenes de e-commerce dentro de baby banking
- ES y IC son fuentes distintas, asi que una orden con mismo numero en ambas (muy improbable) tampoco seria duplicado

## Datos CSV
- Origen: Looker (CeX)
- Columnas reales del CSV: Branch, Order Number, Staff, Order Dt, Transaction Type, Box ID, Box Name, SerialNo, Category, Till No, Quantity, Price
- De estas, **Staff se descarta** y solo se mapean las columnas relevantes para KPI a nivel tienda
- Formato de fecha en CSV: "3 Apr 2026, 21:54:58"

## Estilo visual
- Iconos siempre **minimalistas y monocromo** (SVG stroke, lineas finas). Nunca emojis coloridos ni iconos juguetones
- Cuando se necesite un icono para un boton o card, usar SVG inline con stroke="currentColor"

## Terminologia
- NO usar la palabra "ajustes" en la UI (es un KPI interno de CeX). Usar "configuracion" en su lugar

## Stack
- Frontend puro (HTML/CSS/JS), compatible con GitHub Pages
- IndexedDB via Dexie.js para persistencia (`KPIMetricsStores2026`)
- Papa Parse para CSV streaming
- Sin backend (de momento)

## Roadmap
1. **Implementacion solo-tiendas**: completada (sesion 1 — 10/05/2026).
2. **Siguiente fase**: subida estatica al FTP + dominio + HTTPS. Sigue siendo frontend puro, solo cambia de hosting.
3. **Fase posterior**: backend MySQL en el FTP. Spec aparte: schema sin staff, endpoints, auth, integracion con la app. Dexie pasa a ser cache local o se retira segun como se diseñe.
