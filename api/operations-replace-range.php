<?php
/**
 * POST /api/operations-replace-range.php — Reemplaza un rango de fechas.
 * -----------------------------------------------------------------------
 * Reemplaza a Database.replaceOperationsByDateRange() + el bulkAdd posterior.
 * Usado por captacion (sin dedup estable por fila: el CSV es la verdad del
 * rango). Borra las filas de (source, [from,to]) y mete las nuevas, todo en
 * una transaccion (atomico). Body:
 *   { source, dateFrom, dateTo, records: [...] }
 * Devuelve: { deleted, inserted }.
 */

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/lib.php';
exigirAdmin();

$body = json_decode(file_get_contents('php://input'), true);
$source = $body['source'] ?? null;
$from   = $body['dateFrom'] ?? null;
$to     = $body['dateTo'] ?? null;
$records = (isset($body['records']) && is_array($body['records'])) ? $body['records'] : [];
if (!$source || !$from || !$to) {
    responderJson(['error' => 'bad_request', 'detail' => 'Falta source/dateFrom/dateTo'], 400);
}

$db = dbConnect();
$db->begin_transaction();

// 1) Borrar el rango existente de esa fuente.
$stmt = $db->prepare("DELETE FROM operations WHERE source = ? AND date BETWEEN ? AND ?");
$stmt->bind_param('sss', $source, $from, $to);
$stmt->execute();
$deleted = $stmt->affected_rows;
$stmt->close();

// 2) Insertar las nuevas.
$inserted = 0;
$storeCache = [];
$storeId = $reference = $type = $category = $date = null;
$quantity = $price = $total = $week = $src = $channel = null;

$stmt = $db->prepare(
    "INSERT INTO operations
       (store_id, reference, type, category, date, quantity, price, total, week, source, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id"
);
$stmt->bind_param(
    'issssiddiss',
    $storeId, $reference, $type, $category, $date,
    $quantity, $price, $total, $week, $src, $channel
);

foreach ($records as $rec) {
    $name = $rec['store'] ?? null;
    $src  = $rec['source'] ?? $source;
    $type = $rec['type'] ?? null;
    $date = $rec['date'] ?? null;
    if (!$name || !$type || !$date) continue;
    $storeId   = resolveStoreId($db, $name, $src, $storeCache);
    $reference = $rec['reference'] ?? null;
    $category  = $rec['category'] ?? null;
    $quantity  = array_key_exists('quantity', $rec) ? $rec['quantity'] : null;
    $price     = array_key_exists('price', $rec) ? $rec['price'] : null;
    $total     = array_key_exists('total', $rec) ? $rec['total'] : null;
    $week      = array_key_exists('week', $rec) ? $rec['week'] : null;
    $channel   = $rec['channel'] ?? 'tienda';
    $stmt->execute();
    if ($stmt->affected_rows === 1) $inserted++;
}

$stmt->close();
$db->commit();
$db->close();

responderJson(['deleted' => $deleted, 'inserted' => $inserted]);
