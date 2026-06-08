<?php
/**
 * POST /api/operations-delete-source.php — Borra una fuente sin tocar las otras.
 * -----------------------------------------------------------------------
 * Reemplaza a Database.deleteBySource(). Body: { source }.
 * Casos:
 *   - attachment / attachment-ic: borra de attachment_weekly.
 *   - ecom: no tiene filas propias; revierte el tag (channel ecom -> tienda).
 *   - resto: borra de operations.
 * Siempre borra el historial de imports de esa fuente.
 * Devuelve: { opsDeleted, importsDeleted, ecomUntagged, attachDeleted }.
 */

require_once __DIR__ . '/auth.php';
exigirAdmin();

$body = json_decode(file_get_contents('php://input'), true);
$source = $body['source'] ?? null;
if (!$source) responderJson(['error' => 'bad_request', 'detail' => 'Falta source'], 400);

$db = dbConnect();
$opsDeleted = 0;
$ecomUntagged = 0;
$attachDeleted = 0;

$isAttach = ($source === 'attachment' || $source === 'attachment-ic');

if ($isAttach) {
    $stmt = $db->prepare("DELETE FROM attachment_weekly WHERE source = ?");
    $stmt->bind_param('s', $source);
    $stmt->execute();
    $attachDeleted = $stmt->affected_rows;
    $stmt->close();
} elseif ($source === 'ecom') {
    $db->query("UPDATE operations SET channel = 'tienda' WHERE channel = 'ecom'");
    $ecomUntagged = $db->affected_rows;
} else {
    $stmt = $db->prepare("DELETE FROM operations WHERE source = ?");
    $stmt->bind_param('s', $source);
    $stmt->execute();
    $opsDeleted = $stmt->affected_rows;
    $stmt->close();
}

$stmt = $db->prepare("DELETE FROM imports WHERE source = ?");
$stmt->bind_param('s', $source);
$stmt->execute();
$importsDeleted = $stmt->affected_rows;
$stmt->close();

$db->close();
responderJson([
    'opsDeleted'     => $opsDeleted,
    'importsDeleted' => $importsDeleted,
    'ecomUntagged'   => $ecomUntagged,
    'attachDeleted'  => $attachDeleted,
]);
