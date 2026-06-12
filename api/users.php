<?php
/**
 * /api/users.php — Gestión de usuarios (admin-only). Fase 4b.
 * -----------------------------------------------------------------------
 *   GET  -> { users: [ {id, email, name, role, active, lastLogin}, ... ] }
 *   PUT  -> body { id, role?, active? }  cambia rol (admin/viewer) o estado.
 *
 * Alimenta la pantalla "Usuarios" de Configuración. Guard anti-bloqueo: no se
 * permite dejar el sistema sin ningún admin activo (degradar/desactivar al
 * último admin -> 409).
 */

require_once __DIR__ . '/auth.php';
exigirAdmin();

$db = dbConnect();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $users = [];
    if ($res = $db->query("SELECT id, email, name, role, active, last_login
                           FROM users ORDER BY role, email")) {
        while ($r = $res->fetch_assoc()) {
            $users[] = [
                'id'        => (int) $r['id'],
                'email'     => $r['email'],
                'name'      => $r['name'],
                'role'      => $r['role'],
                'active'    => (bool) (int) $r['active'],
                'lastLogin' => $r['last_login'],
            ];
        }
        $res->free();
    }
    $db->close();
    responderJson(['users' => $users]);
}

if ($method === 'PUT' || $method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) responderJson(['error' => 'bad_request'], 400);
    $id = (int) ($body['id'] ?? 0);
    if ($id <= 0) responderJson(['error' => 'bad_request'], 400);

    // Estado actual del usuario objetivo.
    $stmt = $db->prepare("SELECT role, active FROM users WHERE id = ?");
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $cur = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$cur) { $db->close(); responderJson(['error' => 'not_found'], 404); }

    $newRole   = $body['role'] ?? $cur['role'];
    $newActive = array_key_exists('active', $body) ? (int) (bool) $body['active'] : (int) $cur['active'];
    if (!in_array($newRole, ['admin', 'viewer'], true)) {
        $db->close();
        responderJson(['error' => 'bad_role'], 400);
    }

    // Guard anti-bloqueo: si el objetivo era admin activo y deja de serlo,
    // comprobar que no es el último admin activo del sistema.
    $eraAdminActivo     = ($cur['role'] === 'admin' && (int) $cur['active'] === 1);
    $seguiraAdminActivo = ($newRole === 'admin' && $newActive === 1);
    if ($eraAdminActivo && !$seguiraAdminActivo) {
        $r = $db->query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1");
        $admins = (int) $r->fetch_assoc()['c'];
        if ($admins <= 1) { $db->close(); responderJson(['error' => 'last_admin'], 409); }
    }

    $stmt = $db->prepare("UPDATE users SET role = ?, active = ? WHERE id = ?");
    $stmt->bind_param('sii', $newRole, $newActive, $id);
    $stmt->execute();
    $stmt->close();
    $db->close();
    responderJson(['ok' => true, 'id' => $id, 'role' => $newRole, 'active' => (bool) $newActive]);
}

$db->close();
responderJson(['error' => 'method_not_allowed'], 405);
