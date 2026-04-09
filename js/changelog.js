/**
 * Changelog - Diario de novedades.
 * Siempre lo mas nuevo arriba.
 */
const Changelog = [
    {
        date: '09/04/2026 (sesion 4)',
        items: [
            { type: 'new', text: 'KPI Ventas: tickets, articulos, facturacion, ventas multiples, % venta complementaria, media articulos/ticket' },
            { type: 'new', text: 'Home rediseñado: cards verticales 3:4 con icono, nombre y listado de metricas' },
            { type: 'new', text: 'Cobertura de datos en Home: barras por fuente (Baby Banking, Ecom) con fechas' },
            { type: 'new', text: 'Columna Tienda en tablas de evolucion con indicador de empleados multi-tienda (*)' },
            { type: 'new', text: 'Switch Unificar: fusiona apariciones del mismo empleado en varias tiendas' },
            { type: 'new', text: 'Columna de ranking (#) en todas las tablas de KPIs' },
            { type: 'new', text: 'Filtro minimo de operaciones para metricas porcentuales (configurable)' },
            { type: 'new', text: 'Heatmap gradual azul en celdas de metricas absolutas' },
            { type: 'new', text: 'Verificar datos: filtros por tienda, categoria, canal, fechas' },
            { type: 'new', text: 'Top 20 en selector de ranking' },
            { type: 'new', text: 'Scope "Por tienda" reemplaza "Total tienda" en evolucion' },
            { type: 'fix', text: 'Restablecer herramienta ahora borra la BD completamente (Dexie.delete)' },
            { type: 'fix', text: 'Importador filtra departamentos no-tienda (RMA, Ecomdistribution, Ecommerce)' },
            { type: 'fix', text: 'Totales de facturacion en Ventas calculados correctamente' },
            { type: 'fix', text: 'Filtrar ecom activado por defecto' },
            { type: 'new', text: 'Barra de progreso global al restaurar backups (overlay con porcentaje)' },
        ]
    },
    {
        date: '08/04/2026 (sesion 3)',
        items: [
            { type: 'new', text: 'Importador Ecom Sales activo: cruza ordenes ecom con Baby Banking y marca canal (ecom/tienda)' },
            { type: 'new', text: 'Campo "channel" en registros: distingue ventas en caja vs e-commerce' },
            { type: 'new', text: 'Switch "Solo tienda" en evolucion semanal: excluye ordenes ecom de los KPIs' },
            { type: 'new', text: 'Timeline de cobertura ecom con fechas de inicio/fin por tramo y huecos sin cobertura' },
            { type: 'new', text: '4 drop zones independientes en fila (Baby Banking, Ecom, Attachment, Captacion)' },
            { type: 'new', text: 'Hint contextual en cada drop zone (ej: "Datos globales, todas las tiendas")' },
            { type: 'new', text: 'Filas ecom sombreadas en violeta tenue en el explorador de datos (Verificar datos)' },
            { type: 'new', text: 'Columna Total sombreada en tabla de evolucion para diferenciarla de semanas' },
            { type: 'new', text: 'Escala del eje Y visible en el grafico, alineada en la columna previa' },
            { type: 'fix', text: 'Mapping Ecom Sales con fuzzy match: detecta headers con sufijos variables' },
            { type: 'fix', text: 'DB v5: index "source" en nueva version (Dexie no re-aplica schemas existentes)' },
            { type: 'fix', text: 'Init robusto: bindEvents siempre se ejecuta aunque falle la carga de settings' },
        ]
    },
    {
        date: '08/04/2026 (sesion 2)',
        items: [
            { type: 'new', text: 'Grafico de evolucion semanal con Chart.js: lineas por empleado o total tienda' },
            { type: 'new', text: 'Click en fila de la tabla para ver su grafico individual (+ total como referencia en linea discontinua)' },
            { type: 'new', text: 'Fila TOTAL tambien seleccionable para grafico' },
            { type: 'new', text: 'Selector Top N (Top 3, 5, 10, Todos) en filtros de evolucion: filtra tabla y grafico' },
            { type: 'new', text: 'Tooltip info (i) en el grafico explicando numerador/denominador de cada metrica' },
            { type: 'new', text: 'Panel unico de Moviles: eliminado resumen redundante, solo evolucion semanal con todos los filtros' },
            { type: 'new', text: 'Rango de semanas persistido en IndexedDB (se recuerda entre sesiones y en backups)' },
            { type: 'new', text: 'Explorador de datos movido dentro de Importar CSV como boton "Verificar datos" desplegable' },
            { type: 'new', text: 'Home: resumen muestra "Todo" por defecto al cargar' },
            { type: 'new', text: 'Boton "Novedades" en topbar con modal de changelog' },
            { type: 'fix', text: 'Chart.js: URL corregida a cdn.jsdelivr.net (version 4.4.4, la anterior daba 404)' },
            { type: 'fix', text: 'Error btn-drive-auth eliminado (rompia toda la inicializacion al estar sombreado Drive)' },
            { type: 'fix', text: 'Variable allStaff declarada antes de usarse en renderEvoChart (error de referencia)' },
        ]
    },
    {
        date: '08/04/2026 (sesion 1)',
        items: [
            { type: 'new', text: 'Estructura base del proyecto: HTML/CSS/JS, IndexedDB (Dexie.js), Papa Parse' },
            { type: 'new', text: 'Home profesional con sidebar, topbar, panel resumen con filtros de periodo y tienda' },
            { type: 'new', text: 'Importador CSV adaptado al formato Baby Banking ES de Looker (12 columnas)' },
            { type: 'new', text: 'Multi-source: botones para Baby Banking, Ecom Sales, Attachment, Captacion (3 ultimos proximamente)' },
            { type: 'new', text: 'Historial de importaciones con metadata: archivo, origen, fecha, rango de datos, tiendas, filas' },
            { type: 'new', text: 'Deduplicacion por fuente al importar (misma orden de distinta fuente NO es duplicado)' },
            { type: 'new', text: 'Optimizacion de almacenamiento: solo campos KPI-relevantes, descarte de transfers y refunds' },
            { type: 'new', text: 'Backup comprimido .json.gz (pako.js). Importacion soporta .gz y .json' },
            { type: 'new', text: 'Nombre de exports con fecha y hora: kpitool_export_2026-04-08_1109.json.gz' },
            { type: 'new', text: 'Restablecer herramienta con doble confirmacion y recomendacion de backup previo' },
            { type: 'new', text: 'Calendario de negocio: semanas sabado-viernes, semana 1 = 27/12/2025, configurable' },
            { type: 'new', text: 'KPI Moviles con porcentajes, desglose de unidades y colores (>40% verde, 30-40% amarillo, <30% rojo)' },
            { type: 'new', text: '% Combo: indicador de venta conjunta de geles + basics por movil' },
            { type: 'fix', text: 'Calculo de semanas con Date.UTC para evitar desfase por cambio de hora (DST)' },
            { type: 'fix', text: 'Fechas siempre en DD/MM/AAAA, input de texto en vez de date picker nativo' },
            { type: 'fix', text: 'Botones de confirmar/cancelar importacion visibles arriba sin necesidad de scroll' },
            { type: 'new', text: 'Google Drive sombreado como "proximamente"' },
        ]
    }
];
