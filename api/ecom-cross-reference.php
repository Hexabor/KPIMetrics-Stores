<?php
/**
 * POST /api/ecom-cross-reference.php — Marca ordenes ecom dentro de baby-banking.
 * -----------------------------------------------------------------------
 * Reemplaza a Database.crossReferenceEcom(). Body:
 *   { "references": ["12345", ...] }
 * Marca channel='ecom' en las filas de baby-banking (ES+IC) cuya reference
 * coincide. Devuelve: { tagged, alreadyTagged, notFound }.
 */

require_once __DIR__ . '/auth.php';
exigirAdmin();

$body = json_decode(file_get_contents('php://input'), true);
$refs = (is_array($body) && isset($body['references']) && is_array($body['references']))
    ? $body['references'] : [];
$refs = array_values(array_unique(array_filter($refs, fn($r) => $r !== null && $r !== '')));
if (!$refs) responderJson(['tagged' => 0, 'alreadyTagged' => 0, 'notFound' => 0]);

$db = dbConnect();
$tagged = 0;
$alreadyTagged = 0;
$matched = [];
$CH = 500;

for ($i = 0; $i < count($refs); $i += $CH) {
    $chunk = array_slice($refs, $i, $CH);
    $place = implode(',', array_fill(0, count($chunk), '?'));
    $types = str_repeat('s', count($chunk));

    // Filas baby-banking que coinciden: registramos refs encontradas y ya tagueadas.
    $stmt = $db->prepare(
        "SELECT reference, channel FROM operations
         WHERE source LIKE 'baby-banking%' AND reference IN ($place)"
    );
    $stmt->bind_param($types, ...$chunk);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $matched[$row['reference']] = true;
        if ($row['channel'] === 'ecom') $alreadyTagged++;
    }
    $stmt->close();

    // Tagueamos las que aun no lo estaban.
    $stmt = $db->prepare(
        "UPDATE operations SET channel = 'ecom'
         WHERE source LIKE 'baby-banking%' AND channel <> 'ecom' AND reference IN ($place)"
    );
    $stmt->bind_param($types, ...$chunk);
    $stmt->execute();
    $tagged += $stmt->affected_rows;
    $stmt->close();
}

$db->close();
$notFound = count($refs) - count($matched);
responderJson(['tagged' => $tagged, 'alreadyTagged' => $alreadyTagged, 'notFound' => $notFound]);
