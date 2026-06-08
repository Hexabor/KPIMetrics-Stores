<?php
/**
 * POST /api/operations-bulk.php — Inserta operaciones en bloque.
 * -----------------------------------------------------------------------
 * Reemplaza a Database.bulkAddOperations(). El frontend envia un LOTE de
 * registros ya formados (con week y source calculados en cliente):
 *
 *   { "records": [ { reference, type, category, date, store, quantity,
 *                    price, total, week, channel, source }, ... ] }
 *
 * - Resuelve store (nombre) -> store_id, dando de alta la tienda si es nueva
 *   (region derivada de la fuente, code NULL). Decision A del spec 4a.
 * - Dedup por el UNIQUE uq_ops_dedup (reference, source, price, category):
 *   ON DUPLICATE KEY no-op. Re-importar no duplica.
 *
 * Devuelve: { received, inserted, duplicates }.
 *
 * El frontend envia en lotes (como hoy bulkAdd en tandas de 1000) para no
 * chocar con post_max_size y poder mostrar progreso.
 */

require_once __DIR__ . '/auth.php'; // config.php + responderJson()
require_once __DIR__ . '/lib.php';  // regionFromSource() + resolveStoreId()
exigirAdmin();                      // escritura -> exige X-App-Secret

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body) || !isset($body['records']) || !is_array($body['records'])) {
    responderJson(['error' => 'bad_request', 'detail' => 'Falta records[]'], 400);
}
$records = $body['records'];

$db = dbConnect();

$received = count($records);
$inserted = 0;
$storeCache = [];

// Variables ligadas al statement (se mutan en el bucle y se re-ejecutan).
$storeId = $reference = $type = $category = $date = null;
$quantity = $price = $total = $week = $source = $channel = null;

$db->begin_transaction();
$stmt = $db->prepare(
    "INSERT INTO operations
       (store_id, reference, type, category, date, quantity, price, total, week, source, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id"
);
$stmt->bind_param(
    'issssiddiss',
    $storeId, $reference, $type, $category, $date,
    $quantity, $price, $total, $week, $source, $channel
);

foreach ($records as $rec) {
    $name   = $rec['store'] ?? null;
    $source = $rec['source'] ?? null;
    $type   = $rec['type'] ?? null;
    $date   = $rec['date'] ?? null;
    // Defensa minima: filas sin lo imprescindible se saltan.
    if (!$name || !$source || !$type || !$date) continue;

    $storeId   = resolveStoreId($db, $name, $source, $storeCache);
    $reference = $rec['reference'] ?? null;
    $category  = $rec['category'] ?? null;
    $quantity  = array_key_exists('quantity', $rec) ? $rec['quantity'] : null;
    $price     = array_key_exists('price', $rec) ? $rec['price'] : null;
    $total     = array_key_exists('total', $rec) ? $rec['total'] : null;
    $week      = array_key_exists('week', $rec) ? $rec['week'] : null;
    $channel   = $rec['channel'] ?? 'tienda';

    $stmt->execute();
    if ($stmt->affected_rows === 1) $inserted++; // 1=insertada, 0=duplicada
}

$stmt->close();
$db->commit();
$db->close();

responderJson([
    'received'   => $received,
    'inserted'   => $inserted,
    'duplicates' => $received - $inserted,
]);
