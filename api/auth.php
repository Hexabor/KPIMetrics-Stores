<?php
/**
 * auth.php — La "costura" de permisos (Fase 4b: sesión real + RBAC).
 * -----------------------------------------------------------------------
 * Punto UNICO donde se decide quién puede leer y quién puede escribir.
 *
 * En 4a era un stub (admin único validado por secreto compartido). En 4b se
 * apoya en la SESIÓN abierta tras el login con Google (ver auth-login.php) y
 * en el ROL del usuario (admin/viewer). Como los 9 endpoints de escritura ya
 * llamaban a exigirAdmin() desde 4a, rellenar esta función los protege a todos
 * de golpe.
 *
 *   - exigirSesion(): cualquier usuario logueado (lecturas, p. ej. snapshot).
 *   - exigirAdmin():  además rol === 'admin' (escrituras).
 */

require_once __DIR__ . '/../config.php';

// Arranca la sesión (cookie segura) una sola vez, antes de cualquier salida.
// Como cada endpoint hace require de este archivo lo primero, la cabecera
// Set-Cookie se emite siempre antes de imprimir el cuerpo.
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'secure'   => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

/**
 * Devuelve el usuario actual desde la sesión, o null si no hay sesión.
 */
function usuarioActual() {
    if (empty($_SESSION['user_id'])) return null;
    return [
        'id'    => (int) $_SESSION['user_id'],
        'email' => $_SESSION['email'] ?? '',
        'name'  => $_SESSION['name']  ?? '',
        'role'  => $_SESSION['role']  ?? 'viewer',
    ];
}

/**
 * Exige una sesión válida (cualquier rol). Corta con 401 si no la hay.
 * Para lecturas: un viewer puede leer, un anónimo no.
 */
function exigirSesion() {
    $u = usuarioActual();
    if (!$u) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        exit(json_encode(['error' => 'unauthenticated']));
    }
    return $u;
}

/**
 * Exige sesión válida Y rol admin. Corta con 401/403. Para escrituras.
 */
function exigirAdmin() {
    $u = exigirSesion();
    if ($u['role'] !== 'admin') {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        exit(json_encode(['error' => 'forbidden']));
    }
    return $u;
}

/**
 * Helper: envia una respuesta JSON y termina. Lo usan los endpoints.
 */
function responderJson($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    exit(json_encode($data));
}
