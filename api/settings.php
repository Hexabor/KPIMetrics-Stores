<?php
/**
 * POST /api/settings.php — Guarda un setting global (upsert).
 * -----------------------------------------------------------------------
 * Reemplaza a Database.setSetting(). Body: { key, value }.
 * value se guarda como JSON. Scope = global (store_id/user_id NULL).
 *
 * La lectura NO necesita endpoint: los settings vienen en /api/snapshot.
 *
 * Upsert MANUAL: el UNIQUE (key, scope, store_id, user_id) NO captura el
 * caso global porque store_id/user_id NULL se tratan como distintos en un
 * indice unico de MySQL. Por eso comprobamos a mano.
 */

require_once __DIR__ . '/auth.php';
exigirAdmin();

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body) || !isset($body['key'])) {
    responderJson(['error' => 'bad_request', 'detail' => 'Falta key'], 400);
}
$key = $body['key'];
$value = array_key_exists('value', $body) ? $body['value'] : null;
$valueJson = json_encode($value);

$db = dbConnect();

$stmt = $db->prepare(
    "SELECT id FROM settings
     WHERE `key` = ? AND scope = 'global' AND store_id IS NULL AND user_id IS NULL"
);
$stmt->bind_param('s', $key);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($row) {
    $stmt = $db->prepare("UPDATE settings SET `value` = ? WHERE id = ?");
    $stmt->bind_param('si', $valueJson, $row['id']);
    $stmt->execute();
    $stmt->close();
} else {
    $stmt = $db->prepare("INSERT INTO settings (`key`, `value`, scope) VALUES (?, ?, 'global')");
    $stmt->bind_param('ss', $key, $valueJson);
    $stmt->execute();
    $stmt->close();
}

$db->close();
responderJson(['ok' => true]);
