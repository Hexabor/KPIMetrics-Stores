# KPI Metrix 2026 - Normas de desarrollo

> Nombre interno (DB Dexie, backup folder de Drive) se mantiene como "KPITool2026" por compatibilidad con datos existentes. El nombre visible es "KPI Metrix 2026" (originalmente "KPI Tool 2026", luego "CapiMetrics 2026").

## Formato de fechas
- Todos los campos de fecha visibles al usuario deben mostrarse en formato **DD/MM/AAAA**
- Los selectores de fecha (date pickers) deben mostrar las semanas empezando en **lunes**
- Internamente se puede usar ISO (YYYY-MM-DD) para almacenamiento y queries

## Calendario de negocio
- Las semanas van de **sabado a viernes**
- La **semana 1** del curso actual empieza el **27/12/2025** (sabado)
- Este valor es configurable en Ajustes pero ese es el default fijo

## Tipos de transaccion
- Sale, Cash Buy, Transfer, Exchange, Refund, RMA
- Cash Buy = compra a cliente (precio negativo)
- Transfer con SKU "TXORD" = orden de transferencia interna, no producto fisico

## Campos almacenados (solo KPI-relevantes)
- Se guardan: reference, type, category, date, store, staff, quantity, price, total, source, week
- Se descartan al importar: product, serial, sku, till, _raw
- Se descartan filas de tipo: transfer (movimientos internos de stock)
- **Refunds SI se guardan**: necesarios para ventas netas = ventas brutas - refunds
- RMA se guarda pero no se usa aun en KPIs (puede ser util mas adelante)
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
- `attachment`, `captacion`: placeholders (proximamente)

## Deduplicacion
- La deduplicacion es **por fuente (source)**. Un mismo Order Number puede aparecer en Baby Banking ES y en Ecom Sales y NO es duplicado
- Esto es intencionado: las coincidencias entre fuentes indican ordenes de e-commerce dentro de baby banking
- ES y IC son fuentes distintas, asi que una orden con mismo numero en ambas (muy improbable) tampoco seria duplicado

## Datos CSV
- Origen: Looker (CeX)
- Columnas: Branch, Order Number, Staff, Order Dt, Transaction Type, Box ID, Box Name, SerialNo, Category, Till No, Quantity, Price
- Formato de fecha en CSV: "3 Apr 2026, 21:54:58"

## Estilo visual
- Iconos siempre **minimalistas y monocromo** (SVG stroke, lineas finas). Nunca emojis coloridos ni iconos juguetones
- Cuando se necesite un icono para un boton o card, usar SVG inline con stroke="currentColor"

## Terminologia
- NO usar la palabra "ajustes" en la UI (es un KPI interno de CeX). Usar "configuracion" en su lugar

## Stack
- Frontend puro (HTML/CSS/JS), compatible con GitHub Pages
- IndexedDB via Dexie.js para persistencia
- Papa Parse para CSV streaming
- Sin backend
