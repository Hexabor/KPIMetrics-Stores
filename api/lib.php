<?php
/**
 * lib.php — Ayudantes compartidos del backend.
 * -----------------------------------------------------------------------
 * Funciones reutilizadas por varios endpoints (resolucion/alta de tiendas).
 */

require_once __DIR__ . '/../config.php';

/** Las fuentes IC vienen sufijadas -ic; el resto es ES (peninsula + baleares). */
function regionFromSource($source) {
    return (substr((string) $source, -3) === '-ic') ? 'IC' : 'ES';
}

/**
 * Resuelve nombre de tienda -> id, creandola si no existe. Cachea por
 * peticion (&$cache) para no repetir queries de la misma tienda.
 * El truco ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id) devuelve el id
 * existente si la tienda ya estaba (uq_stores_name) o el nuevo si se inserta.
 */
function resolveStoreId($db, $name, $source, &$cache) {
    if (isset($cache[$name])) return $cache[$name];
    $region = regionFromSource($source);
    $stmt = $db->prepare(
        "INSERT INTO stores (name, region) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
    );
    $stmt->bind_param('ss', $name, $region);
    $stmt->execute();
    $id = $db->insert_id;
    $stmt->close();
    $cache[$name] = $id;
    return $id;
}
