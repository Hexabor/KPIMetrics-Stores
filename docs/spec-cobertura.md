# Spec — Panel de Cobertura v2 (rejilla + drill-down + resumen accionable)

> Estado: PROPUESTA, pendiente de aprobacion de Arc. No codificar hasta visto bueno.
> Sustituye el panel actual de barras continuas (`renderCoverageBars`, app.js ~289).

## 1. Motivacion

El panel actual dibuja una barra continua por fuente (de `getDateRangeBySource`, solo `{from,to}`).
Una barra W19→W23 se ve "llena" aunque falte la W21 en medio o aunque solo se importaran
3 de 6 tiendas. **No revela huecos** — justo el riesgo real de la herramienta (olvidar
importar una semana, una fuente o una tienda).

Todo lo necesario YA esta en memoria client-side (`opsCache`: week/date/store/source;
`attachmentCache`: store/cycleYear/week/source). **Sin cambios de backend.**

## 2. Decisiones (confirmadas por Arc 13/06/2026)

1. **Dia vacio en nivel 3 = solo mostrar, sin alertar.** Celda en gris; el usuario interpreta
   (no tenemos calendario de festivos y las tiendas de centro comercial pueden abrir domingos).
   No se asume nada sobre domingos/festivos.
2. **Columnas hasta la semana actual.** El eje va de la primera semana con datos a la semana
   de curso de hoy. Las semanas recientes sin importar aparecen como huecos al final.
3. **Nivel superior (Fuente×Semana) binario.** Hay datos / no hay datos. La cobertura parcial
   por tiendas NO se codifica en el nivel superior; se descubre al hacer drill-down (y en el
   resumen accionable).

Derivadas:
- Alertas de **hueco interno** (semana vacia rodeada de semanas con datos) SI se marcan en los
  niveles de **semana** (nivel 1 y 2), porque son fiables sin calendario de festivos. El nivel
  de **dia** (nivel 3) no alerta (decision 1).
- El nivel 3 es un **calendario Semana×Dia** (filas = semanas, columnas = Sáb…Vie), no una tira
  lineal de dias.

## 3. Granularidad disponible por fuente

| Fuente             | Origen                         | Semana | Tienda | Dia | Drill-down |
|--------------------|--------------------------------|:------:|:------:|:---:|------------|
| baby-banking (ES)  | opsCache (1 fila/transaccion)  |   ✓    |   ✓    |  ✓  | N1→N2→N3   |
| baby-banking-ic    | opsCache                       |   ✓    |   ✓    |  ✓  | N1→N2→N3   |
| captacion          | opsCache (agregada store/dia)  |   ✓    |   ✓    |  ✓  | N1→N2→N3   |
| attachment / -ic   | attachmentCache (store/semana) |   ✓    |   ✓    |  —  | N1→N2      |
| ecom               | importsCache (rango import)    |   ✓    |   —    |  —  | N1 (solo)  |
| stocks             | placeholder                    |   —    |   —    |  —  | —          |

Al clicar una fuente sin nivel mas profundo, no se hace drill (o se muestra nota "sin desglose
por tienda/dia para esta fuente").

## 4. Semana canonica (clave de columna)

Para que todas las fuentes compartan eje, la clave de semana es la **semana lineal**:
- operations (BB, captacion): `wk = KPIEngine.helpers.businessWeek(op.date)`.
- attachment: `wk = KPIEngine.helpers.courseWeekToLinear(row.cycleYear, row.week)`.
- ecom: semanas `businessWeek(import.dateFrom) .. businessWeek(import.dateTo)` por cada import ecom.
- Etiqueta de columna: `KPIEngine.helpers.weekYearLabel(wk)` → "W21 2026".

`colMax = businessWeek(hoy)`; `colMin = min(wk con datos)`. Columnas = `colMin..colMax`.

## 5. Niveles y navegacion

Breadcrumb arriba de la seccion: `Cobertura ▸ Baby Banking ES ▸ Madrid Islazul`.
Click en un crumb sube de nivel. El grid se reemplaza in-place (no modales, no nueva seccion).

**Nivel 1 — Fuente × Semana** (binario)
- Filas = fuentes (las del §3 que tengan datos). Columnas = semanas `colMin..colMax`.
- Celda: `present` (color de la fuente) si esa fuente tiene ≥1 registro esa semana; si no, `empty`.
- `empty` se sub-clasifica: **hueco interno** (existe dato en semana anterior Y posterior de esa
  fuente) → estilo alerta (rojo tenue). Hueco de cola/cabeza → neutro (pendiente/futuro).
- Click en la etiqueta de fila → Nivel 2 (si la fuente lo soporta).

**Nivel 2 — Tienda × Semana** (para una fuente)
- Tiendas esperadas de la fuente = tiendas distintas que aparecen en esa fuente en TODO el dataset.
- Filas = esas tiendas; columnas = mismo rango de semanas.
- Celda `present` si `(store, source)` tiene datos esa semana. Hueco interno por fila → alerta.
- Click en una tienda → Nivel 3 (si la fuente tiene granularidad de dia).

**Nivel 3 — Calendario Semana × Dia** (para fuente + tienda)
- Filas = semanas `colMin..colMax` (etiqueta "W21 2026"). Columnas = 7 dias **Sáb Dom Lun Mar Mié Jue Vie**.
- Celda = una fecha concreta. `present` si hay ≥1 registro ese dia para (source, store); si no, `empty`
  (gris neutro, **sin alerta** — decision 1). Fechas posteriores a hoy: estilo "futuro" atenuado.
- Tooltip por celda: fecha DD/MM/AAAA + nº de registros.

## 6. Resumen accionable

Bloque de avisos (sobre o bajo la rejilla de nivel 1). Reglas, por fuente con datos:
- **Hueco interno**: por cada semana vacia rodeada de datos → aviso ambar
  "Falta `weekYearLabel` en `<fuente>` (rodeada de semanas con datos)".
- **Desactualizado (frescura)**: si `colMax > maxWeekConDatos(fuente)` →
  "Última semana de `<fuente>` = `Wxx`; hoy es `Wyy` → N semanas sin importar".
- **Cobertura parcial** (deriva de nivel 2, aunque el nivel 1 sea binario): semanas donde
  `tiendas_presentes < tiendas_esperadas` → "`Wxx` `<fuente>`: faltan N de M tiendas".
  (Surface aqui aunque el grid superior no lo pinte; el resumen es la capa analitica.)
- **OK**: fuente sin huecos internos y al dia → linea verde "al dia (última `Wxx`)".

Iconos SVG stroke monocromo (alerta triangulo, reloj, check), coherente con CLAUDE.md.

## 7. Calculo (una pasada O(n) sobre las caches)

- `bySourceWeek: Map<source, Set<wk>>` y `bySourceWeekStore: Map<source, Map<wk, Set<store>>>`
  → niveles 1 y 2 + parcialidad.
- `expectedStores: Map<source, Set<store>>` → denominador de "tiendas esperadas".
- Nivel 3 se calcula on-demand filtrando `opsCache` por (source, store) → `Set<fecha>`.
- Hueco interno: para una secuencia de semanas, marcar vacias entre el primer y ultimo `present`.
- Memoizar el modelo y recomputar solo al cambiar datos (import/reset/restore).

## 8. Fases (cada una entregable por separado)

- **F1**: Nivel 1 (rejilla binaria + hueco-interno/cola + leyenda + estado vacio) reemplaza las
  barras. Columnas hasta semana actual. Sin drill-down todavia.
- **F2**: Drill-down Nivel 2 (Tienda×Semana) + breadcrumb + navegacion in-place.
- **F3**: Drill-down Nivel 3 (calendario Semana×Dia) para fuentes con dia.
- **F4**: Resumen accionable (huecos + frescura + parcialidad + OK).
- (Futuro, no en alcance): agrupacion por mes cuando el eje supere ~16 semanas; intensidad por
  nº registros; export del informe de cobertura.

## 9. Tests propuestos (vitest)

Extraer la logica pura a funciones testeables (en `kpi-engine` helpers o nuevo
`js/modules/coverage-model.js`), alimentadas por arrays simples:
- `buildCoverageModel(ops, attachment, ecomImports, today)` → estructura por fuente.
- Casos: deteccion de hueco interno (vacia rodeada) vs cola; frescura (N semanas sin importar);
  parcialidad (tiendas_presentes < esperadas); clave de semana correcta (BB via businessWeek,
  attachment via courseWeekToLinear); rango de columnas hasta semana actual.

## 10. Fuera de alcance

- Calendario de festivos / dias cerrados (decision 1: no se asume nada).
- Cambios de backend / nuevos endpoints (todo client-side).
- Cobertura parcial pintada en el nivel 1 (queda binario; parcialidad via drill-down + resumen).
