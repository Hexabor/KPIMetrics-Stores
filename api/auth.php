<?php
/**
 * auth.php — La "costura" de permisos.
 * -----------------------------------------------------------------------
 * Punto UNICO donde se decide quien puede escribir. Hoy (Fase 4a) es un
 * stub: perfil unico admin, validado solo por el secreto compartido.
 *
 * En la Fase 4b se rellena con la sesion de Google OAuth + el rol real.
 * Como TODOS los endpoints de escritura llaman a exigirAdmin(), ese dia se
 * cambia SOLO esta funcion y todo queda protegido de golpe. Cero deuda.
 */

require_once __DIR__ . '/../config.php';

/**
 * Devuelve el usuario actual.
 * Fase 4a: siempre el admin unico.
 * Fase 4b: el usuario autenticado por OAuth (de la sesion).
 */
function usuarioActual() {
    return ['id' => 0, 'name' => 'admin', 'role' => 'admin'];
}

/**
 * Exige permisos de escritura. Corta con 403 si no los hay.
 * Fase 4a: comprueba solo el secreto compartido (cabecera X-App-Secret).
 * Fase 4b: AÑADIR aqui -> exigir sesion valida y usuarioActual()['role']==='admin'.
 */
function exigirAdmin() {
    // Fase 4a, admin de facto por dos vias (cualquiera vale):
    //   1) Secreto compartido en cabecera X-App-Secret (lo manda el frontend
    //      y las herramientas tipo curl/migrate).
    //   2) Haber pasado el Basic Auth del .htaccess (el navegador reenvia las
    //      credenciales en las peticiones same-origin). Cubre el caso de que
    //      el secreto no llegue por config del servidor.
    $secret = $_SERVER['HTTP_X_APP_SECRET'] ?? '';
    $hasSecret = APP_SECRET !== '' && hash_equals(APP_SECRET, $secret);
    $hasBasicAuth = !empty($_SERVER['PHP_AUTH_USER'])
        || !empty($_SERVER['REMOTE_USER'])
        || !empty($_SERVER['REDIRECT_REMOTE_USER']);

    if (!$hasSecret && !$hasBasicAuth) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        exit(json_encode(['error' => 'forbidden']));
    }
    // Fase 4b: sustituir "Basic Auth presente" por "sesion OAuth valida y
    // usuarioActual()['role'] === 'admin'".
}

/**
 * Helper: envia una respuesta JSON y termina. Lo usaran los endpoints.
 */
function responderJson($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    exit(json_encode($data));
}
