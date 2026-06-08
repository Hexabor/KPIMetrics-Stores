<?php
/**
 * migrate.php — Runner de migraciones.
 * -----------------------------------------------------------------------
 * Aplica las migraciones de db/migrations/ que aun no se hayan aplicado,
 * en orden, y lleva la cuenta en la tabla `schema_migrations`.
 *
 * NO es de un solo uso: se queda en el servidor como herramienta. Es
 * idempotente (correrlo dos veces no repite nada) y esta protegido por el
 * secreto compartido.
 *
 * Uso:
 *   https://capimetrics.cexsv.com/migrate.php?token=EL_APP_SECRET
 *
 * Requiere: config.php (creds) y la carpeta db/migrations/ junto a este
 * archivo en el servidor.
 */

require_once __DIR__ . '/config.php';
header('Content-Type: text/plain; charset=utf-8');

// --- Guarda: exige el secreto (querystring ?token= o cabecera X-App-Secret) ---
$token = $_GET['token'] ?? ($_SERVER['HTTP_X_APP_SECRET'] ?? '');
if (!hash_equals(APP_SECRET, $token)) {
    http_response_code(403);
    exit("403 - secreto invalido o ausente.\n");
}

$db = dbConnect();
echo "Conectado a " . DB_NAME . " OK.\n\n";

// --- Tabla de control (la gestiona el runner; NO es una migracion de usuario) ---
$db->query("CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `filename`   VARCHAR(255) NOT NULL,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// --- Set de migraciones ya aplicadas ---
$applied = [];
if ($res = $db->query("SELECT `filename` FROM `schema_migrations`")) {
    while ($row = $res->fetch_assoc()) $applied[$row['filename']] = true;
    $res->free();
}

function tableExists($db, $name) {
    $name = $db->real_escape_string($name);
    $res = $db->query("SHOW TABLES LIKE '$name'");
    return $res && $res->num_rows > 0;
}

function recordMigration($db, $name) {
    $stmt = $db->prepare("INSERT INTO `schema_migrations` (`filename`) VALUES (?)");
    $stmt->bind_param('s', $name);
    $stmt->execute();
    $stmt->close();
}

// --- Leer migraciones en orden (001_, 002_, ... = orden lexicografico) ---
$files = glob(__DIR__ . '/db/migrations/*.sql');
sort($files);
if (!$files) {
    http_response_code(500);
    exit("ERROR: no encuentro db/migrations/*.sql junto a migrate.php.\n");
}

$ranAny = false;
foreach ($files as $path) {
    $name = basename($path);

    if (isset($applied[$name])) {
        echo "skip      $name (ya aplicada)\n";
        continue;
    }

    // BASELINE: la 001 se aplico a mano (db-setup.php) antes de existir el
    // runner. Si las tablas ya estan, la marcamos como aplicada SIN ejecutarla
    // (tiene DROP TABLE: re-ejecutarla borraria datos).
    if ($name === '001_schema_inicial.sql' && tableExists($db, 'operations')) {
        recordMigration($db, $name);
        echo "baseline  $name (marcada sin ejecutar; ya estaba desplegada)\n";
        continue;
    }

    // Ejecutar la migracion (puede tener varias sentencias).
    $sql = file_get_contents($path);
    echo "running   $name ...\n";
    if (!$db->multi_query($sql)) {
        http_response_code(500);
        exit("ERROR en $name: {$db->error}\n");
    }
    do { if ($r = $db->store_result()) $r->free(); } while ($db->more_results() && $db->next_result());
    if ($db->errno) {
        http_response_code(500);
        exit("ERROR en $name: {$db->error}\n");
    }
    recordMigration($db, $name);
    echo "ok        $name\n";
    $ranAny = true;
}

echo "\n" . ($ranAny ? "Migraciones aplicadas. BD al dia.\n" : "Nada que aplicar. BD al dia.\n");

echo "\nAplicadas hasta ahora:\n";
if ($res = $db->query("SELECT `filename`, `applied_at` FROM `schema_migrations` ORDER BY `filename`")) {
    while ($row = $res->fetch_assoc()) echo "  - {$row['filename']}  ({$row['applied_at']})\n";
}
$db->close();
