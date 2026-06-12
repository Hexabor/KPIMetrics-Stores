-- =============================================================
-- Migracion 003 — Seed del primer admin (Fase 4b)
-- =============================================================
-- Spec Fase 4b (Google OAuth + RBAC): el primer administrador se siembra a
-- mano. abeatrice@webuy.com es la cuenta de TRABAJO de Arc (distinta de su
-- cuenta personal/Google de Claude). El `name` 'Arc' es provisional: se
-- sobrescribe con el nombre real de Google en el primer login.
--
-- A David y al resto de admins se les eleva DESPUES desde la pantalla
-- "Usuarios" (admin-only); NO se siembran aqui.
--
-- Cambio ADITIVO e IDEMPOTENTE: si la fila ya existe (p. ej. el usuario entro
-- antes de aplicar esta migracion y se auto-creo como viewer), el ON DUPLICATE
-- la promociona a admin sin duplicar ni tocar el resto de columnas.
--
-- Defensa en capas: ademas de esta fila, el backend reconoce ADMIN_SEED_EMAILS
-- (config.php) y promociona a admin a esos correos si se crean por primera vez.
-- =============================================================

INSERT INTO `users` (`email`, `name`, `role`)
VALUES ('abeatrice@webuy.com', 'Arc', 'admin')
ON DUPLICATE KEY UPDATE `role` = 'admin';
