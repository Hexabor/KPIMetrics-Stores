<?php
/**
 * GET /api/snapshot.php — Dataset completo para computar en el cliente.
 * -----------------------------------------------------------------------
 * Devuelve operations + attachment_weekly + settings + imports en JSON, con
 * la MISMA forma que devolvia Dexie (el frontend no cambia su modelo).
 *
 * Traducciones clave:
 *   - operations/attachment: store_id (BD) -> store nombre (JOIN a stores),
 *     que es lo que usa el frontend.
 *   - snake_case (BD) -> camelCase (frontend).
 *
 * Lectura: protegida por el Basic Auth del .htaccess (4a). NO exige el
 * secreto (asi es trivial probarla en el navegador). En 4b se añade la
 * comprobacion de sesion/rol en auth.php.
 */

require_once __DIR__ . '/auth.php'; // trae config.php + responderJson()

$db = dbConnect();

// --- operations: JOIN para resolver store_id -> nombre ---
$operations = [];
$sql = "SELECT o.id, o.reference, o.type, o.category, o.date, s.name AS store,
               o.quantity, o.price, o.total, o.week, o.channel, o.source
        FROM operations o
        JOIN stores s ON s.id = o.store_id";
if ($res = $db->query($sql)) {
    while ($r = $res->fetch_assoc()) {
        $operations[] = [
            'id'        => (int) $r['id'],
            'reference' => $r['reference'],
            'type'      => $r['type'],
            'category'  => $r['category'],
            'date'      => $r['date'],
            'store'     => $r['store'],
            'quantity'  => $r['quantity'] === null ? null : (int) $r['quantity'],
            'price'     => $r['price'] === null ? null : (float) $r['price'],
            'total'     => $r['total'] === null ? null : (float) $r['total'],
            'week'      => $r['week'] === null ? null : (int) $r['week'],
            'channel'   => $r['channel'],
            'source'    => $r['source'],
        ];
    }
    $res->free();
}

// --- attachment_weekly: store nombre + id string + camelCase ---
$attachment_weekly = [];
$sql = "SELECT s.name AS store, a.cycle_year, a.week, a.source,
               a.sale_transactions, a.attachment_transactions
        FROM attachment_weekly a
        JOIN stores s ON s.id = a.store_id";
if ($res = $db->query($sql)) {
    while ($r = $res->fetch_assoc()) {
        $store = $r['store'];
        $cy = (int) $r['cycle_year'];
        $wk = (int) $r['week'];
        $src = $r['source'];
        $attachment_weekly[] = [
            'id'                     => "$store|$cy|$wk|$src",
            'store'                  => $store,
            'cycleYear'              => $cy,
            'week'                   => $wk,
            'source'                 => $src,
            'saleTransactions'       => (int) $r['sale_transactions'],
            'attachmentTransactions' => (int) $r['attachment_transactions'],
        ];
    }
    $res->free();
}

// --- settings (scope global): key + value (JSON decodificado) ---
$settings = [];
if ($res = $db->query("SELECT `key`, `value` FROM settings WHERE scope = 'global'")) {
    while ($r = $res->fetch_assoc()) {
        $settings[] = [
            'key'   => $r['key'],
            'value' => json_decode($r['value'], true),
        ];
    }
    $res->free();
}

// --- imports: snake_case -> camelCase ---
$imports = [];
$sql = "SELECT id, source, filename, imported_at, row_count, date_from, date_to, store_count, stores
        FROM imports
        ORDER BY imported_at DESC";
if ($res = $db->query($sql)) {
    while ($r = $res->fetch_assoc()) {
        $imports[] = [
            'id'         => (int) $r['id'],
            'source'     => $r['source'],
            'filename'   => $r['filename'],
            'date'       => $r['imported_at'],
            'rowCount'   => (int) $r['row_count'],
            'dateFrom'   => $r['date_from'],
            'dateTo'     => $r['date_to'],
            'storeCount' => $r['store_count'] === null ? null : (int) $r['store_count'],
            'stores'     => $r['stores'] ? json_decode($r['stores'], true) : [],
        ];
    }
    $res->free();
}

$db->close();

responderJson([
    'operations'        => $operations,
    'attachment_weekly' => $attachment_weekly,
    'settings'          => $settings,
    'imports'           => $imports,
]);
