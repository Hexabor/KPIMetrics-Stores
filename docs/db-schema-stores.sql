-- =============================================================
-- KPI Metrics 2026 - Stores Edition - Schema MySQL
-- =============================================================
-- Base de datos destino: u782235572_CPMT
-- Compatible con: MySQL 8.0+ / MariaDB 10.5+
-- Engine: InnoDB (necesario para FK constraints)
-- Charset: utf8mb4 (Unicode completo)
--
-- Adaptacion de docs/db-schema.md (propuesta corporativa) a la
-- edicion solo-tiendas con compliance GDPR.
--
-- Diferencias frente al PDF original:
--   - Eliminada operations.staff (GDPR — stores edition).
--   - Eliminados los indices idx_ops_staff_date e idx_ops_staff_week.
--   - Reducidos los roles de users.role / user_stores.role a solo
--     'admin' y 'viewer'. Eliminados 'staff' (GDPR), y 'regional' /
--     'manager' (simplificacion: o tienes acceso total, o solo lectura).
--   - Eliminado 'Transfer' del dominio de operations.type
--     (las filas Transfer puras se descartan al importar; las
--      Transfer + categoria 'Test' se importan como 'test-admission').
--   - Sintaxis MySQL en lugar de PostgreSQL (Anexo del PDF).
--
-- Como ejecutar:
--   1. Conecta a la BD via phpMyAdmin (Hostinger panel) o un
--      script PHP de carga unica.
--   2. Selecciona la BD u782235572_CPMT.
--   3. Pega este archivo entero y ejecuta.
-- =============================================================

-- Limpieza defensiva: si por error hubiera tablas con estos nombres,
-- las eliminamos en orden inverso de dependencia.
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `settings`;
DROP TABLE IF EXISTS `operations`;
DROP TABLE IF EXISTS `imports`;
DROP TABLE IF EXISTS `user_stores`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `stores`;
SET FOREIGN_KEY_CHECKS = 1;


-- =============================================================
-- Tabla: stores - Catalogo de tiendas
-- =============================================================
CREATE TABLE `stores` (
    `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code`       VARCHAR(10)  NOT NULL,
    `name`       VARCHAR(60)  NOT NULL,
    `region`     VARCHAR(2)   NOT NULL,
    `manager`    VARCHAR(80)  NULL,
    `active`     BOOLEAN      NOT NULL DEFAULT TRUE,
    `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_stores_code` (`code`),
    UNIQUE KEY `uq_stores_name` (`name`),
    CONSTRAINT `chk_stores_region` CHECK (`region` IN ('ES', 'IC'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================
-- Tabla: users - Usuarios del sistema
-- Roles: admin (acceso total) / viewer (solo lectura)
--   - 'staff' eliminado por GDPR (sin visibilidad por empleado).
--   - 'regional' / 'manager' eliminados por simplificacion:
--     o tienes acceso total, o solo lectura. Si en el futuro hace
--     falta granularidad, se anaden con ALTER TABLE sin perder datos.
-- =============================================================
CREATE TABLE `users` (
    `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email`      VARCHAR(120) NOT NULL,
    `name`       VARCHAR(80)  NOT NULL,
    `role`       VARCHAR(20)  NOT NULL,
    `active`     BOOLEAN      NOT NULL DEFAULT TRUE,
    `last_login` TIMESTAMP    NULL,
    `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`),
    CONSTRAINT `chk_users_role` CHECK (`role` IN ('admin', 'viewer'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================
-- Tabla: user_stores - Asignacion N:M users <-> stores con rol
-- =============================================================
CREATE TABLE `user_stores` (
    `user_id`    INT UNSIGNED NOT NULL,
    `store_id`   INT UNSIGNED NOT NULL,
    `role`       VARCHAR(20)  NOT NULL,
    `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`user_id`, `store_id`),
    KEY `idx_user_stores_store` (`store_id`),
    CONSTRAINT `fk_user_stores_user`  FOREIGN KEY (`user_id`)  REFERENCES `users`(`id`)  ON DELETE CASCADE,
    CONSTRAINT `fk_user_stores_store` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE,
    CONSTRAINT `chk_user_stores_role` CHECK (`role` IN ('admin', 'viewer'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================
-- Tabla: imports - Log de cargas CSV (auditoria)
-- =============================================================
CREATE TABLE `imports` (
    `id`          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    `source`      VARCHAR(20)      NOT NULL,
    `filename`    VARCHAR(255)     NULL,
    `imported_at` TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `imported_by` INT UNSIGNED     NULL,
    `row_count`   INT UNSIGNED     NOT NULL DEFAULT 0,
    `date_from`   DATE             NULL,
    `date_to`     DATE             NULL,
    `store_count` SMALLINT UNSIGNED NULL,
    `stores`      JSON             NULL,
    PRIMARY KEY (`id`),
    KEY `idx_imports_source_date` (`source`, `imported_at`),
    CONSTRAINT `fk_imports_user` FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    CONSTRAINT `chk_imports_source` CHECK (`source` IN ('baby-banking', 'baby-banking-ic', 'ecom', 'captacion', 'attachment'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================
-- Tabla: operations - TABLA PRINCIPAL
-- SIN columna 'staff' (GDPR — stores edition)
-- =============================================================
CREATE TABLE `operations` (
    `id`         BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    `store_id`   INT UNSIGNED      NOT NULL,
    `reference`  VARCHAR(32)       NULL,
    `type`       VARCHAR(20)       NOT NULL,
    `category`   VARCHAR(80)       NULL,
    `date`       DATE              NOT NULL,
    `quantity`   INT               NULL,
    `price`      DECIMAL(10,2)     NULL,
    `total`      DECIMAL(12,2)     NULL,
    `week`       SMALLINT UNSIGNED NULL,
    `source`     VARCHAR(20)       NOT NULL,
    `channel`    VARCHAR(10)       NOT NULL DEFAULT 'tienda',
    `import_id`  BIGINT UNSIGNED   NULL,
    `created_at` TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_ops_store`         (`store_id`),
    KEY `idx_ops_date`          (`date`),
    KEY `idx_ops_reference`     (`reference`),
    KEY `idx_ops_source`        (`source`),
    KEY `idx_ops_channel`       (`channel`),
    KEY `idx_ops_store_date`    (`store_id`, `date`),
    KEY `idx_ops_category_date` (`category`, `date`),
    KEY `idx_ops_type_date`     (`type`, `date`),
    KEY `idx_ops_type_week`     (`type`, `week`),
    -- Dedup por fuente: misma (reference, source, price, category) = duplicado.
    -- En MySQL una UNIQUE con NULLs permite multiples NULLs distintos, asi
    -- que las filas de captacion (reference=NULL) no colisionan.
    UNIQUE KEY `uq_ops_dedup`   (`reference`, `source`, `price`, `category`),
    CONSTRAINT `fk_ops_store`   FOREIGN KEY (`store_id`)  REFERENCES `stores`(`id`),
    CONSTRAINT `fk_ops_import`  FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON DELETE SET NULL,
    CONSTRAINT `chk_ops_type`   CHECK (`type` IN ('Sale', 'Cash Buy', 'Exchange', 'Refund', 'RMA', 'test-admission', 'membership')),
    CONSTRAINT `chk_ops_source` CHECK (`source` IN ('baby-banking', 'baby-banking-ic', 'ecom', 'captacion', 'attachment')),
    CONSTRAINT `chk_ops_channel` CHECK (`channel` IN ('tienda', 'ecom'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================
-- Tabla: settings - Configuracion clave-valor (global/store/user)
-- =============================================================
CREATE TABLE `settings` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `key`        VARCHAR(64)     NOT NULL,
    `value`      JSON            NOT NULL,
    `scope`      VARCHAR(20)     NOT NULL,
    `store_id`   INT UNSIGNED    NULL,
    `user_id`    INT UNSIGNED    NULL,
    `updated_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_settings_scope` (`key`, `scope`, `store_id`, `user_id`),
    KEY `idx_settings_scope` (`scope`),
    CONSTRAINT `fk_settings_store` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_settings_user`  FOREIGN KEY (`user_id`)  REFERENCES `users`(`id`)  ON DELETE CASCADE,
    CONSTRAINT `chk_settings_scope` CHECK (`scope` IN ('global', 'store', 'user'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
