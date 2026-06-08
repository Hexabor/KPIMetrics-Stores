<?php
/**
 * POST /api/imports.php — Registra una carga CSV (auditoria).
 * -----------------------------------------------------------------------
 * Reemplaza a Database.logImport(). Body:
 *   { source, filename, rowCount, dateFrom, dateTo, storeCount, stores[] }
 * Devuelve: { id }.
 */

require_once __DIR__ . '/auth.php';
exigirAdmin();

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) responderJson(['error' => 'bad_request'], 400);

$source     = $body['source'] ?? 'unknown';
$filename   = $body['filename'] ?? null;
$rowCount   = (int) ($body['rowCount'] ?? 0);
$dateFrom   = $body['dateFrom'] ?? null;
$dateTo     = $body['dateTo'] ?? null;
$storeCount = isset($body['storeCount']) ? (int) $body['storeCount'] : null;
$stores     = isset($body['stores']) ? json_encode($body['stores']) : null;

$db = dbConnect();
$stmt = $db->prepare(
    "INSERT INTO imports (source, filename, row_count, date_from, date_to, store_count, stores)
     VALUES (?, ?, ?, ?, ?, ?, ?)"
);
$stmt->bind_param('ssissis', $source, $filename, $rowCount, $dateFrom, $dateTo, $storeCount, $stores);
$stmt->execute();
$id = $stmt->insert_id;
$stmt->close();
$db->close();

responderJson(['id' => $id]);
