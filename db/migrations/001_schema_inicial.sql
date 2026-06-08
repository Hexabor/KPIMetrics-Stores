-- =============================================================
-- Migracion 001 — Schema inicial (baseline)
-- KPI Metrics 2026 - Stores Edition
-- =============================================================
-- Estado: YA DESPLEGADA en u782235572_CPMT el 08/06/2026 (sesion 4),
--         via el script de un solo uso db-setup.php (borrado tras usar).
--         Este archivo es la VERSION VERSIONADA de ese mismo schema:
--         a partir de ahora, db/migrations/ es la fuente de verdad.
--
-- Crea las 7 tablas base con FKs, indices y checks.
-- Compatible con: MySQL 8.0+ / MariaDB 10.5+. Engine InnoDB. Charset utf8mb4.
--
-- NOTA: empieza con DROP TABLE IF EXISTS para poder recrear el schema
-- en una BD vacia/de pruebas. NUNCA ejecutar sobre una BD con datos reales.
-- Las migraciones SIGUIENTES (002+) seran ADITIVAS (sin DROP).
-- =============================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `settings`;
DROP TABLE IF EXISTS `attachment_weekly`;
DROP TABLE IF EXISTS `operations`;
DROP TABLE IF EXISTS `imports`;
DROP TABLE IF EXISTS `user_stores`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `stores`;
SET FOREIGN_KEY_CHECKS = 1;


-- stores — Catalogo de tiendas
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


-- users — Usuarios del sistema. Roles: admin (acceso total) / viewer (solo lectura).
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


-- user_stores — Asignacion N:M users <-> stores con rol
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


-- imports — Log de cargas CSV (auditoria)
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
    CONSTRAINT `chk_imports_source` CHECK (`source` IN ('baby-banking', 'baby-banking-ic', 'ecom', 'captacion', 'attachment', 'attachment-ic'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- operations — TABLA PRINCIPAL (fact table). SIN columna 'staff' (GDPR).
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
    -- Una UNIQUE con NULLs permite multiples NULLs, asi que captacion (reference=NULL) no colisiona.
    UNIQUE KEY `uq_ops_dedup`   (`reference`, `source`, `price`, `category`),
    CONSTRAINT `fk_ops_store`   FOREIGN KEY (`store_id`)  REFERENCES `stores`(`id`),
    CONSTRAINT `fk_ops_import`  FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON DELETE SET NULL,
    CONSTRAINT `chk_ops_type`   CHECK (`type` IN ('Sale', 'Cash Buy', 'Exchange', 'Refund', 'RMA', 'test-admission', 'membership')),
    -- 'attachment'/'attachment-ic' NO van aqui: tienen su propia tabla (granularidad semanal).
    CONSTRAINT `chk_ops_source` CHECK (`source` IN ('baby-banking', 'baby-banking-ic', 'ecom', 'captacion')),
    CONSTRAINT `chk_ops_channel` CHECK (`channel` IN ('tienda', 'ecom'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- attachment_weekly — Agregado semanal del KPI Attachment.
-- Granularidad (tienda, ciclo, semana, fuente). El % se DERIVA en query.
CREATE TABLE `attachment_weekly` (
    `store_id`                INT UNSIGNED      NOT NULL,
    `cycle_year`              SMALLINT UNSIGNED NOT NULL,
    `week`                    SMALLINT UNSIGNED NOT NULL,
    `source`                  VARCHAR(20)       NOT NULL,
    `sale_transactions`       INT UNSIGNED      NOT NULL,
    `attachment_transactions` INT UNSIGNED      NOT NULL,
    `import_id`               BIGINT UNSIGNED   NULL,
    `created_at`              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`store_id`, `cycle_year`, `week`, `source`),
    KEY `idx_attach_week` (`cycle_year`, `week`),
    CONSTRAINT `fk_attach_store`   FOREIGN KEY (`store_id`)  REFERENCES `stores`(`id`),
    CONSTRAINT `fk_attach_import`  FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON DELETE SET NULL,
    CONSTRAINT `chk_attach_source` CHECK (`source` IN ('attachment', 'attachment-ic')),
    CONSTRAINT `chk_attach_qty`    CHECK (`attachment_transactions` <= `sale_transactions`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- settings — Configuracion clave-valor (global/store/user)
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
