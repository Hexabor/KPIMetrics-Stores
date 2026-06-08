<?php
/**
 * POST /api/attachment-bulk.php — Upsert de attachment semanal.
 * -----------------------------------------------------------------------
 * Reemplaza a Database.bulkPutAttachmentWeekly(). Body:
 *   { "records": [ { store, cycleYear, week, source,
 *                    saleTransactions, attachmentTransactions }, ... ] }
 * UPSERT por la PK natural (store_id, cycle_year, week, source): re-importar
 * la misma semana sobreescribe en vez de duplicar.
 * Devuelve: { received, upserted }.
 */

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/lib.php';
exigirAdmin();

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body) || !isset($body['records']) || !is_array($body['records'])) {
    responderJson(['error' => 'bad_request', 'detail' => 'Falta records[]'], 400);
}
$records = $body['records'];

$db = dbConnect();

$received = count($records);
$upserted = 0;
$storeCache = [];

$storeId = $cy = $wk = $src = $sale = $att = null;
$db->begin_transaction();
$stmt = $db->prepare(
    "INSERT INTO attachment_weekly
       (store_id, cycle_year, week, source, sale_transactions, attachment_transactions)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       sale_transactions = VALUES(sale_transactions),
       attachment_transactions = VALUES(attachment_transactions)"
);
$stmt->bind_param('iiisii', $storeId, $cy, $wk, $src, $sale, $att);

foreach ($records as $rec) {
    $name = $rec['store'] ?? null;
    $src  = $rec['source'] ?? null;
    if (!$name || !$src) continue;
    $cy   = (int) ($rec['cycleYear'] ?? 0);
    $wk   = (int) ($rec['week'] ?? 0);
    $sale = (int) ($rec['saleTransactions'] ?? 0);
    $att  = (int) ($rec['attachmentTransactions'] ?? 0);
    $storeId = resolveStoreId($db, $name, $src, $storeCache);
    $stmt->execute();
    $upserted++;
}

$stmt->close();
$db->commit();
$db->close();

responderJson(['received' => $received, 'upserted' => $upserted]);
