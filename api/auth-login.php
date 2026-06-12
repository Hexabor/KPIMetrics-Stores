<?php
/**
 * POST /api/auth-login.php — Login con Google (Fase 4b).
 * -----------------------------------------------------------------------
 * Body: { id_token }. El frontend lo obtiene del botón "Iniciar sesión con
 * Google" (Google Identity Services).
 *
 * Flujo:
 *   1) Valida el id_token con el endpoint `tokeninfo` de Google (decisión
 *      spec 4b §11.2: una llamada a Google por login; el resto del tráfico va
 *      por la cookie de sesión).
 *   2) Comprueba aud (== nuestro Client ID), iss y email_verified.
 *   3) Gate de dominio: solo @webuy.com (función pura emailPermitido()).
 *   4) Alta/actualización del usuario (viewer por defecto; seed -> admin).
 *   5) Abre la sesión. Devuelve { email, name, role }.
 *
 * Respuestas de error: 400 token ausente, 401 token inválido, 403 dominio no
 * permitido / cuenta desactivada.
 */

require_once __DIR__ . '/auth.php'; // arranca la sesión + responderJson()

/**
 * Gate de dominio — función PURA (sin red ni BD), para poder razonarla/testear
 * de un vistazo. Solo cuentas @webuy.com con email verificado.
 */
function emailPermitido($email, $emailVerified, $hd) {
    if ($emailVerified !== true && $emailVerified !== 'true') return false;
    $email = strtolower(trim((string) $email));
    if (substr($email, -strlen('@webuy.com')) !== '@webuy.com') return false;
    // Si Google manda el dominio hospedado (hd), debe coincidir.
    if ($hd !== '' && $hd !== null && strtolower((string) $hd) !== 'webuy.com') return false;
    return true;
}

/** GET de un JSON por HTTPS (curl). Devuelve array decodificado o null. */
function httpGetJson($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code !== 200) return null;
    $data = json_decode($resp, true);
    return is_array($data) ? $data : null;
}

$body = json_decode(file_get_contents('php://input'), true);
$idToken = is_array($body) ? ($body['id_token'] ?? '') : '';
if ($idToken === '') responderJson(['error' => 'missing_token'], 400);

// 1) Validar el token con Google.
$info = httpGetJson('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken));
if (!$info || isset($info['error']) || isset($info['error_description'])) {
    responderJson(['error' => 'invalid_token'], 401);
}

// 2) Comprobaciones de seguridad del token.
if (!hash_equals(GOOGLE_CLIENT_ID, (string) ($info['aud'] ?? ''))) {
    responderJson(['error' => 'wrong_audience'], 401);
}
$iss = $info['iss'] ?? '';
if ($iss !== 'accounts.google.com' && $iss !== 'https://accounts.google.com') {
    responderJson(['error' => 'wrong_issuer'], 401);
}

$email = strtolower(trim($info['email'] ?? ''));
$name  = trim($info['name'] ?? '');
if ($name === '') $name = $email;
$hd = $info['hd'] ?? '';

// 3) Gate de dominio.
if (!emailPermitido($email, $info['email_verified'] ?? false, $hd)) {
    responderJson(['error' => 'domain_forbidden'], 403);
}

// 4) Alta / actualización del usuario.
$db = dbConnect();
$stmt = $db->prepare("SELECT id, role, active FROM users WHERE email = ?");
$stmt->bind_param('s', $email);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($user) {
    if ((int) $user['active'] !== 1) { $db->close(); responderJson(['error' => 'account_disabled'], 403); }
    $uid  = (int) $user['id'];
    $role = $user['role'];
    $upd = $db->prepare("UPDATE users SET name = ?, last_login = NOW() WHERE id = ?");
    $upd->bind_param('si', $name, $uid);
    $upd->execute();
    $upd->close();
} else {
    // Cuenta nueva @webuy.com: viewer por defecto; admin si está en el seed.
    $seeds = array_map('strtolower', defined('ADMIN_SEED_EMAILS') ? ADMIN_SEED_EMAILS : []);
    $role  = in_array($email, $seeds, true) ? 'admin' : 'viewer';
    $ins = $db->prepare("INSERT INTO users (email, name, role, last_login) VALUES (?, ?, ?, NOW())");
    $ins->bind_param('sss', $email, $name, $role);
    $ins->execute();
    $uid = (int) $ins->insert_id;
    $ins->close();
}
$db->close();

// 5) Abrir sesión (regenera el id para evitar fijación de sesión).
session_regenerate_id(true);
$_SESSION['user_id'] = $uid;
$_SESSION['email']   = $email;
$_SESSION['name']    = $name;
$_SESSION['role']    = $role;

responderJson(['id' => $uid, 'email' => $email, 'name' => $name, 'role' => $role]);
