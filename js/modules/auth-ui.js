/**
 * auth-ui.js — Login con Google + sesión en el frontend (Fase 4b).
 * -----------------------------------------------------------------------
 * Se carga ANTES de app.js. El arranque de la app pasa por Auth.boot(init):
 *
 *   - boot() pregunta a /api/auth-me.php.
 *       · Hay sesión  -> pinta la caja de usuario, aplica el rol y llama a la
 *                        funcion de arranque de la app (init).
 *       · No hay (401) -> muestra la pantalla de login (botón de Google). La
 *                        app NO arranca hasta que el login va bien.
 *   - El boton de Google entrega un id_token que se manda a auth-login.php;
 *     el backend valida, aplica el gate @webuy.com y abre la sesión (cookie).
 *
 * RBAC (solo UX): añade la clase `role-viewer` al <body> cuando el usuario es
 * viewer; el CSS oculta los `.admin-only`. La seguridad REAL la hace el backend
 * (un viewer que fuerce una escritura recibe 403).
 */
const Auth = (() => {
    const CFG = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
    const API_BASE = (CFG.apiBase || '/api').replace(/\/$/, '');

    let currentUser = null;
    let onReadyCb = null;
    let appStarted = false;

    // ===================== HTTP =====================

    async function fetchMe() {
        const res = await fetch(`${API_BASE}/auth-me.php`, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });
        if (res.status === 401) return null;
        if (!res.ok) throw new Error(`auth-me -> ${res.status}`);
        return res.json();
    }

    async function postLogin(idToken) {
        const res = await fetch(`${API_BASE}/auth-login.php`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: idToken })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `http_${res.status}`);
        return data;
    }

    async function logout() {
        try {
            await fetch(`${API_BASE}/auth-logout.php`, { method: 'POST', credentials: 'same-origin' });
        } catch (e) { /* da igual: recargamos igualmente */ }
        currentUser = null;
        location.reload();
    }

    // ===================== Estado / rol =====================

    function esAdmin() { return !!currentUser && currentUser.role === 'admin'; }
    function getUser() { return currentUser; }

    function applyRole() {
        const admin = esAdmin();
        document.body.classList.toggle('role-viewer', !admin);
        document.body.classList.toggle('role-admin', admin);
    }

    // ===================== Caja de usuario (topbar) =====================

    function renderUserBox() {
        if (!currentUser) return;
        const right = document.querySelector('.topbar-right');
        if (!right) return;
        let box = document.getElementById('topbar-user');
        if (!box) {
            box = document.createElement('div');
            box.id = 'topbar-user';
            box.className = 'topbar-user';
            right.appendChild(box);
        }
        const role = esAdmin() ? 'admin' : 'viewer';
        const label = currentUser.name || currentUser.email || '';
        box.innerHTML =
            `<span class="topbar-user-name" title="${escapeAttr(currentUser.email || '')}">${escapeHtml(label)}</span>` +
            `<span class="topbar-user-role">${role}</span>` +
            `<button class="topbar-logout" id="btn-logout" title="Cerrar sesión">` +
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">` +
            `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>`;
        const btn = document.getElementById('btn-logout');
        if (btn) btn.addEventListener('click', logout);
    }

    // ===================== Pantalla de login =====================

    function ensureOverlay() {
        let ov = document.getElementById('auth-overlay');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.id = 'auth-overlay';
        ov.className = 'auth-overlay';
        ov.innerHTML =
            `<div class="auth-card">` +
            `<img src="assets/logo.png" alt="KPI Metrics" class="auth-logo" onerror="this.style.display='none'">` +
            `<h1 class="auth-title">KPI Metrics 2026</h1>` +
            `<p class="auth-sub">Acceso restringido a cuentas <strong>@webuy.com</strong></p>` +
            `<div id="auth-btn" class="auth-btn"></div>` +
            `<p id="auth-status" class="auth-status"></p>` +
            `</div>`;
        document.body.appendChild(ov);
        return ov;
    }

    function setStatus(msg, isError) {
        const el = document.getElementById('auth-status');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('is-error', !!isError);
    }

    function showOverlay(message) {
        const ov = ensureOverlay();
        ov.classList.add('visible');
        setStatus(message || '', !!message);

        if (!CFG.googleClientId || CFG.googleClientId.indexOf('apps.googleusercontent.com') === -1) {
            setStatus('Falta configurar googleClientId en config.local.js', true);
            return;
        }
        waitForGoogle().then(() => {
            const btn = document.getElementById('auth-btn');
            if (!btn) return;
            btn.innerHTML = '';
            google.accounts.id.initialize({
                client_id: CFG.googleClientId,
                callback: onCredential,
                auto_select: false
            });
            google.accounts.id.renderButton(btn, {
                theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill'
            });
        }).catch(() => {
            setStatus('No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.', true);
        });
    }

    function hideOverlay() {
        const ov = document.getElementById('auth-overlay');
        if (ov) ov.classList.remove('visible');
    }

    // Espera a que la librería GIS (gsi/client) esté disponible.
    function waitForGoogle(timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function check() {
                if (window.google && google.accounts && google.accounts.id) return resolve();
                if (Date.now() - t0 > timeoutMs) return reject(new Error('gsi_timeout'));
                setTimeout(check, 100);
            })();
        });
    }

    function mapError(code) {
        switch (code) {
            case 'domain_forbidden': return 'Solo pueden acceder cuentas @webuy.com.';
            case 'account_disabled': return 'Tu cuenta está desactivada. Contacta con un administrador.';
            case 'missing_token':
            case 'invalid_token':
            case 'wrong_audience':
            case 'wrong_issuer':   return 'No se pudo validar el inicio de sesión. Inténtalo de nuevo.';
            default:               return `No se pudo iniciar sesión (${code}).`;
        }
    }

    function onCredential(resp) {
        const idToken = resp && resp.credential;
        if (!idToken) return;
        setStatus('Verificando…', false);
        postLogin(idToken).then(user => {
            currentUser = user;
            // Si la app ya estaba arrancada (re-login por sesión caducada),
            // lo más seguro es recargar para no doblar la inicialización.
            if (appStarted) { location.reload(); return; }
            appStarted = true;
            hideOverlay();
            renderUserBox();
            applyRole();
            if (onReadyCb) onReadyCb(user);
        }).catch(err => {
            setStatus(mapError(err.message), true);
        });
    }

    // ===================== Arranque =====================

    async function boot(onReady) {
        onReadyCb = onReady;

        // Si otra parte de la app detecta 401 (sesión caducada), reabrimos login.
        window.addEventListener('auth:expired', () => {
            currentUser = null;
            showOverlay('Tu sesión ha caducado. Vuelve a entrar.');
        });

        let me = null;
        try { me = await fetchMe(); }
        catch (e) { /* error de red: mostramos login con opción de reintentar */ }

        if (me) {
            currentUser = me;
            appStarted = true;
            renderUserBox();
            applyRole();
            onReady(me);
        } else {
            showOverlay();
        }
    }

    // ===================== util =====================

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str == null ? '' : String(str);
        return d.innerHTML;
    }
    function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;'); }

    return { boot, logout, esAdmin, getUser };
})();
