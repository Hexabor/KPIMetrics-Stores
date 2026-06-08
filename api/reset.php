<?php
/**
 * POST /api/reset.php — Borra TODOS los datos (Restablecer / limpieza previa).
 * -----------------------------------------------------------------------
 * Reemplaza a Database.clearAll(). Vacia operations, attachment_weekly,
 * imports, settings y stores. NO toca users ni schema_migrations.
 *
 * Usa DELETE (no TRUNCATE) para no chocar con las FK; con FK_CHECKS=0 el
 * orden da igual. Operacion poco frecuente, el coste es asumible.
 */

require_once __DIR__ . '/auth.php';
exigirAdmin();

$db = dbConnect();
$db->query("SET FOREIGN_KEY_CHECKS = 0");
foreach (['operations', 'attachment_weekly', 'imports', 'settings', 'stores'] as $t) {
    $db->query("DELETE FROM `$t`");
}
$db->query("SET FOREIGN_KEY_CHECKS = 1");
$db->close();

responderJson(['ok' => true]);
