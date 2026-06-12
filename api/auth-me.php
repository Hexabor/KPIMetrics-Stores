<?php
/**
 * GET /api/auth-me.php — Devuelve el usuario de la sesión, o 401.
 * -----------------------------------------------------------------------
 * Lo llama el frontend al arrancar para decidir: ¿muestro la pantalla de
 * login (401) o arranco la app (200 con el usuario)?
 */

require_once __DIR__ . '/auth.php';

$u = usuarioActual();
if (!$u) responderJson(['error' => 'unauthenticated'], 401);

responderJson([
    'id'    => $u['id'],
    'email' => $u['email'],
    'name'  => $u['name'],
    'role'  => $u['role'],
]);
