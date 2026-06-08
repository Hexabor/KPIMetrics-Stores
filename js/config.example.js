/**
 * Plantilla de configuracion del frontend.
 * -----------------------------------------------------------------------
 * COPIA este archivo a js/config.local.js (gitignored) y rellena appSecret.
 *
 *   - apiBase: ruta base de la API. '/api' si el frontend y la API estan en
 *     el mismo dominio (caso Hostinger).
 *   - appSecret: el MISMO valor de APP_SECRET de config.php (servidor). Viaja
 *     en la cabecera X-App-Secret de las escrituras. Vive en el frontend (que
 *     se sirve tras Basic Auth), por eso config.local.js es gitignored: el
 *     repo es publico y el secreto no debe filtrarse ahi.
 */
window.APP_CONFIG = {
    apiBase: '/api',
    appSecret: 'PON_AQUI_EL_MISMO_APP_SECRET_DE_config.php'
};
