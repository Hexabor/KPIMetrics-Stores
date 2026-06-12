/**
 * Plantilla de configuracion del frontend.
 * -----------------------------------------------------------------------
 * COPIA este archivo a js/config.local.js (gitignored) y rellena los valores.
 *
 *   - apiBase: ruta base de la API. '/api' si el frontend y la API estan en
 *     el mismo dominio (caso Hostinger).
 *   - googleClientId: el OAuth Client ID creado en Google Cloud del Workspace
 *     webuy.com (Fase 4b). NO es secreto: es publico por diseño (va a la vista
 *     en el frontend). Debe coincidir con GOOGLE_CLIENT_ID de config.php, que
 *     es contra lo que el backend valida el campo `aud` del id_token.
 *     Formato: "1234567890-abcdefg.apps.googleusercontent.com".
 *
 * NOTA (Fase 4b): ya NO hay `appSecret`. La autenticacion es por sesion
 * (cookie tras login con Google), no por secreto compartido. Las escrituras
 * van con la cookie de sesion same-origin, no con cabecera X-App-Secret.
 */
window.APP_CONFIG = {
    apiBase: '/api',
    googleClientId: 'PON_AQUI_EL_OAUTH_CLIENT_ID.apps.googleusercontent.com'
};
