-- =============================================================
-- Migracion 002 — stores.code nullable
-- =============================================================
-- Decision A (spec Fase 4a): la app solo conoce el NOMBRE de la tienda; no
-- existe un codigo de tienda en los datos actuales. El alta automatica de
-- tiendas al importar crea la fila con region derivada (BB=ES, BB-IC=IC) y
-- code NULL de momento. Por eso relajamos stores.code de NOT NULL a NULL.
--
-- Cambio ADITIVO / no destructivo: relajar una restriccion no toca datos
-- existentes. Si en el futuro hay codigos reales, se rellenan sin nueva
-- migracion (o con una que los vuelva a exigir).
-- =============================================================

ALTER TABLE `stores` MODIFY COLUMN `code` VARCHAR(10) NULL;
