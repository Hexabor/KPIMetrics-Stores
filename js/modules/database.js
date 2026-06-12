/**
 * Database module — Backend MySQL via API REST (Fase 4a).
 *
 * Sustituye al antiguo almacenamiento Dexie/IndexedDB. La FIRMA PUBLICA del
 * modulo es identica a la version Dexie: app.js, kpi-engine.js y csv-parser.js
 * NO cambian.
 *
 * Modelo (principio rector del spec 4a): el calculo sigue en el navegador.
 * El backend es persistencia, no motor de queries. Al primer acceso se carga
 * un SNAPSHOT completo (operations + attachment_weekly + settings + imports)
 * en memoria; todas las lecturas operan sobre esos arrays (como hacia opsCache
 * con Dexie). Las escrituras llaman a endpoints y invalidan el snapshot, que
 * se recarga en la siguiente lectura.
 *
 * Config: window.APP_CONFIG = { apiBase, appSecret } (js/config.local.js,
 * gitignored, servido tras Basic Auth). appSecret viaja en la cabecera
 * X-App-Secret de las escrituras.
 *
 * GDPR: delete rec.staff defensivo antes de enviar (igual que la version
 * Dexie). El backend tampoco tiene columna staff.
 */
const Database = (() => {
    const CFG = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
    const API_BASE = (CFG.apiBase || '/api').replace(/\/$/, '');
    const APP_SECRET = CFG.appSecret || '';

    // --- Snapshot cacheado en memoria ---
    let opsCache = null;
    let attachmentCache = null;
    let importsCache = null;
    let settingsMap = null;          // Map key -> value
    let loaded = false;
    let loadPromise = null;
    const distinctValuesCache = new Map();

    // ===================== Infraestructura HTTP =====================

    // 401 = sesión ausente/caducada. Avisamos a auth-ui (que reabre el login)
    // y propagamos el error para cortar la operación en curso.
    function handle401() {
        window.dispatchEvent(new CustomEvent('auth:expired'));
    }

    async function apiGet(path) {
        const res = await fetch(`${API_BASE}/${path}`, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });
        if (res.status === 401) { handle401(); throw new Error(`GET ${path} -> 401`); }
        if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
        return res.json();
    }

    async function apiPost(path, body) {
        // Fase 4b: la autenticación va por la cookie de sesión (credentials),
        // no por X-App-Secret. El backend exige sesión admin para escribir.
        const res = await fetch(`${API_BASE}/${path}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
        if (res.status === 401) { handle401(); throw new Error(`POST ${path} -> 401`); }
        if (!res.ok) {
            let detail = '';
            try { detail = JSON.stringify(await res.json()); } catch (e) { /* ignore */ }
            throw new Error(`POST ${path} -> ${res.status} ${detail}`);
        }
        return res.json();
    }

    // ===================== Snapshot / cache =====================

    async function loadSnapshot() {
        const data = await apiGet('snapshot.php');
        opsCache = data.operations || [];
        attachmentCache = data.attachment_weekly || [];
        importsCache = data.imports || [];
        settingsMap = new Map((data.settings || []).map(s => [s.key, s.value]));
        distinctValuesCache.clear();
        loaded = true;
    }

    async function ensureLoaded() {
        if (loaded) return;
        if (!loadPromise) {
            loadPromise = loadSnapshot().finally(() => { loadPromise = null; });
        }
        await loadPromise;
    }

    // Cualquier mutacion invalida el snapshot entero; la proxima lectura lo
    // recarga del servidor (una sola llamada trae todo). Mantiene la misma
    // semantica que invalidateOpsCache hacia con Dexie.
    function invalidate() {
        loaded = false;
        opsCache = null;
        attachmentCache = null;
        importsCache = null;
        settingsMap = null;
        distinctValuesCache.clear();
    }
    function invalidateOpsCache() { invalidate(); }
    function invalidateAttachmentCache() { invalidate(); }

    function init() {
        // Arranca la carga del snapshot en segundo plano; las lecturas la
        // esperan via ensureLoaded(). No abre ninguna DB local (Dexie retirado).
        ensureLoaded().catch(() => { /* la lectura que toque surfará el error */ });
    }

    // ===================== Lecturas =====================

    async function getAllOperations() {
        await ensureLoaded();
        return opsCache;
    }

    async function getAllAttachmentWeekly() {
        await ensureLoaded();
        return attachmentCache;
    }

    async function getRecordCount() {
        await ensureLoaded();
        return opsCache.length;
    }

    async function getDistinctValues(field) {
        await ensureLoaded();
        if (distinctValuesCache.has(field)) return distinctValuesCache.get(field);
        const set = new Set();
        for (const r of opsCache) {
            const v = r[field];
            if (v !== undefined && v !== null && v !== '') set.add(v);
        }
        const values = [...set].sort((a, b) => String(a).localeCompare(String(b)));
        distinctValuesCache.set(field, values);
        return values;
    }

    async function getDateRange() {
        await ensureLoaded();
        let from = null, to = null;
        for (const r of opsCache) {
            if (!r.date) continue;
            if (from === null || r.date < from) from = r.date;
            if (to === null || r.date > to) to = r.date;
        }
        return from ? { from, to } : null;
    }

    async function getDateRangeBySource() {
        await ensureLoaded();
        const result = {};
        const trackedSources = new Set(['baby-banking', 'baby-banking-ic', 'captacion']);
        for (const r of opsCache) {
            if (!r.source || !r.date) continue;
            if (!trackedSources.has(r.source)) continue;
            const cur = result[r.source];
            if (!cur) result[r.source] = { from: r.date, to: r.date };
            else {
                if (r.date < cur.from) cur.from = r.date;
                if (r.date > cur.to) cur.to = r.date;
            }
        }

        // Ecom: porcion de ecom importado que intersecta con BB (ES union IC).
        const ecomImports = importsCache.filter(i => i.source === 'ecom');
        if (ecomImports.length > 0) {
            const froms = ecomImports.map(i => i.dateFrom).filter(Boolean).sort();
            const tos = ecomImports.map(i => i.dateTo).filter(Boolean).sort();
            if (froms.length && tos.length) {
                const ecomFrom = froms[0];
                const ecomTo = tos[tos.length - 1];
                const bbRanges = [result['baby-banking'], result['baby-banking-ic']].filter(Boolean);
                if (bbRanges.length) {
                    const bbFrom = bbRanges.map(r => r.from).sort()[0];
                    const bbTo = bbRanges.map(r => r.to).sort()[bbRanges.length - 1];
                    const clipFrom = ecomFrom > bbFrom ? ecomFrom : bbFrom;
                    const clipTo = ecomTo < bbTo ? ecomTo : bbTo;
                    if (clipFrom <= clipTo) result['ecom'] = { from: clipFrom, to: clipTo };
                }
            }
        }
        return result;
    }

    async function getAvailableBBDateRange() {
        const ranges = await getDateRangeBySource();
        const bbRanges = [ranges['baby-banking'], ranges['baby-banking-ic']].filter(Boolean);
        if (!bbRanges.length) return null;
        const dateMin = bbRanges.map(r => r.from).sort()[0];
        const dateMax = bbRanges.map(r => r.to).sort()[bbRanges.length - 1];
        return { dateMin, dateMax };
    }

    async function getEcomCoverage() {
        await ensureLoaded();
        const allBB = opsCache.filter(r => r.source && r.source.startsWith('baby-banking'));
        if (!allBB.length) return null;

        const dates = allBB.map(r => r.date).filter(Boolean).sort();
        const bbFrom = dates[0];
        const bbTo = dates[dates.length - 1];

        const ecomImports = importsCache.filter(i => i.source === 'ecom');
        const rawRanges = ecomImports
            .filter(imp => imp.dateFrom && imp.dateTo)
            .map(imp => ({ from: imp.dateFrom, to: imp.dateTo }))
            .sort((a, b) => a.from.localeCompare(b.from));

        const coveredRanges = [];
        for (const r of rawRanges) {
            const last = coveredRanges[coveredRanges.length - 1];
            if (last && r.from <= last.to) {
                if (r.to > last.to) last.to = r.to;
            } else {
                coveredRanges.push({ from: r.from, to: r.to });
            }
        }

        let ecomCount = 0, tiendaCount = 0;
        for (const r of allBB) {
            if (r.channel === 'ecom') ecomCount++;
            else tiendaCount++;
        }
        return { bbFrom, bbTo, totalRecords: allBB.length, ecomCount, tiendaCount, coveredRanges };
    }

    async function queryOperations(filters = {}, page = 1, pageSize = 50) {
        await ensureLoaded();
        const filterFns = [];
        if (filters.type && filters.type !== 'all') {
            const t = filters.type.toLowerCase();
            filterFns.push(r => r.type && r.type.toLowerCase() === t);
        }
        if (filters.store && filters.store !== 'all') filterFns.push(r => r.store === filters.store);
        if (filters.category && filters.category !== 'all') filterFns.push(r => r.category === filters.category);
        if (filters.channel && filters.channel !== 'all') {
            const ch = filters.channel;
            filterFns.push(r => (r.channel || 'tienda') === ch);
        }
        if (filters.dateFrom) filterFns.push(r => r.date >= filters.dateFrom);
        if (filters.dateTo) filterFns.push(r => r.date <= filters.dateTo);
        if (filters.search) {
            const term = filters.search.toLowerCase();
            filterFns.push(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
        }
        const matchFn = r => filterFns.every(fn => fn(r));
        const all = (filterFns.length ? opsCache.filter(matchFn) : opsCache.slice());
        all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const total = all.length;
        const start = (page - 1) * pageSize;
        return { records: all.slice(start, start + pageSize), total, page, pageSize };
    }

    async function getOperationsForKPI(filters = {}) {
        await ensureLoaded();
        let rows = opsCache;
        if (filters.store && filters.store !== 'all') rows = rows.filter(r => r.store === filters.store);
        if (filters.dateFrom && filters.dateTo) {
            rows = rows.filter(r => r.date >= filters.dateFrom && r.date <= filters.dateTo);
        }
        return rows.slice();
    }

    async function getImportHistory() {
        await ensureLoaded();
        // El snapshot ya viene ORDER BY imported_at DESC; devolvemos copia.
        return importsCache.slice();
    }

    async function getExistingFingerprints(references, source) {
        if (!references || !references.length) return new Set();
        await ensureLoaded();
        const refSet = new Set(references);
        const fps = new Set();
        for (const r of opsCache) {
            if (r.source === source && refSet.has(r.reference)) {
                fps.add(`${r.reference}|${r.price}|${r.category}`);
            }
        }
        return fps;
    }

    async function getStorageSummaryBySource() {
        await ensureLoaded();
        const counts = {}, dateMin = {}, dateMax = {};
        let ecomTaggedCount = 0;
        for (const r of opsCache) {
            const src = r.source || 'unknown';
            counts[src] = (counts[src] || 0) + 1;
            if (r.date) {
                if (!dateMin[src] || r.date < dateMin[src]) dateMin[src] = r.date;
                if (!dateMax[src] || r.date > dateMax[src]) dateMax[src] = r.date;
            }
            if (r.channel === 'ecom') ecomTaggedCount++;
        }

        const attachWeekMin = {}, attachWeekMax = {};
        for (const r of attachmentCache) {
            const src = r.source || 'unknown';
            counts[src] = (counts[src] || 0) + 1;
            const key = `${r.cycleYear}-W${String(r.week).padStart(2, '0')}`;
            if (!attachWeekMin[src] || key < attachWeekMin[src]) attachWeekMin[src] = key;
            if (!attachWeekMax[src] || key > attachWeekMax[src]) attachWeekMax[src] = key;
        }

        const importCountBySource = {}, importDateMin = {}, importDateMax = {};
        for (const imp of importsCache) {
            const src = imp.source || 'unknown';
            importCountBySource[src] = (importCountBySource[src] || 0) + 1;
            if (imp.dateFrom && (!importDateMin[src] || imp.dateFrom < importDateMin[src])) importDateMin[src] = imp.dateFrom;
            if (imp.dateTo && (!importDateMax[src] || imp.dateTo > importDateMax[src])) importDateMax[src] = imp.dateTo;
        }

        const allSources = new Set([...Object.keys(counts), ...Object.keys(importCountBySource)]);
        const result = {};
        for (const src of allSources) {
            result[src] = {
                rowCount: counts[src] || 0,
                importCount: importCountBySource[src] || 0,
                dateFrom: dateMin[src] || importDateMin[src] || null,
                dateTo: dateMax[src] || importDateMax[src] || null,
                ecomTaggedCount: src === 'ecom' ? ecomTaggedCount : 0,
                weekFrom: attachWeekMin[src] || null,
                weekTo: attachWeekMax[src] || null
            };
        }
        return result;
    }

    async function getSetting(key) {
        await ensureLoaded();
        return settingsMap.has(key) ? settingsMap.get(key) : null;
    }

    // ===================== Escrituras =====================

    async function setSetting(key, value) {
        await apiPost('settings.php', { key, value });
        if (settingsMap) settingsMap.set(key, value); // refresco local barato
    }

    async function bulkAddOperations(records, onProgress, weekFn, source) {
        const BATCH = 1000;
        let added = 0;
        for (let i = 0; i < records.length; i += BATCH) {
            const batch = records.slice(i, i + BATCH).map(rec => {
                const r = { ...rec };
                if (weekFn) r.week = weekFn(r.date);
                if (source) r.source = source;
                if (!r.channel) r.channel = 'tienda';
                delete r.staff; // Defensa GDPR (igual que la version Dexie)
                return r;
            });
            const res = await apiPost('operations-bulk.php', { records: batch });
            added += res.inserted || 0;
            if (onProgress) onProgress(Math.min(i + BATCH, records.length), records.length);
        }
        invalidate();
        return added;
    }

    async function bulkPutAttachmentWeekly(records, onProgress) {
        const BATCH = 500;
        let done = 0;
        for (let i = 0; i < records.length; i += BATCH) {
            const batch = records.slice(i, i + BATCH).map(rec => {
                const r = { ...rec };
                delete r.staff; delete r.staffId; delete r.staffName; // Defensa GDPR
                return r;
            });
            const res = await apiPost('attachment-bulk.php', { records: batch });
            done += res.upserted || 0;
            if (onProgress) onProgress(Math.min(i + BATCH, records.length), records.length);
        }
        invalidate();
        return done;
    }

    async function crossReferenceEcom(ecomRecords, onProgress) {
        const refs = [...new Set(ecomRecords.map(r => r.reference).filter(Boolean))];
        if (!refs.length) return { tagged: 0, alreadyTagged: 0, notFound: 0 };
        const ecomDates = ecomRecords.map(r => r.date).filter(Boolean).sort();
        if (onProgress) onProgress(0, refs.length);
        const res = await apiPost('ecom-cross-reference.php', { references: refs });
        if (onProgress) onProgress(refs.length, refs.length);
        invalidate();
        return {
            tagged: res.tagged || 0,
            alreadyTagged: res.alreadyTagged || 0,
            notFound: res.notFound || 0,
            ecomDateFrom: ecomDates[0],
            ecomDateTo: ecomDates[ecomDates.length - 1]
        };
    }

    async function replaceOperationsByDateRange(source, dateFrom, dateTo) {
        if (!source || !dateFrom || !dateTo) return 0;
        // Solo borra el rango (sin records): el insert lo hace bulkAddOperations
        // despues, igual que el flujo Dexie de captacion.
        const res = await apiPost('operations-replace-range.php', { source, dateFrom, dateTo });
        invalidate();
        return res.deleted || 0;
    }

    // DEFERIDO en 4a: el retro-arreglo de nombres de tienda ya existentes.
    // En el modelo normalizado el nombre vive en stores.name (no por fila) y el
    // merge es complejo. Las importaciones NUEVAS ya llegan reconciliadas desde
    // app.js (reconcile aplicado a los registros entrantes). Para aplicar un
    // alias nuevo a datos ya cargados, se RE-IMPORTA la fuente. No-op seguro.
    async function renormalizeStoresForSource() { return 0; }
    async function renormalizeAttachmentStoresForSource() { return 0; }

    async function logImport(meta) {
        const res = await apiPost('imports.php', {
            source: meta.source || 'unknown',
            filename: meta.filename,
            rowCount: meta.rowCount || 0,
            dateFrom: meta.dateFrom || null,
            dateTo: meta.dateTo || null,
            storeCount: meta.storeCount || 0,
            stores: meta.stores || []
        });
        invalidate();
        return res.id;
    }

    async function deleteBySource(source, onProgress) {
        if (!source) return { opsDeleted: 0, importsDeleted: 0, ecomUntagged: 0, attachDeleted: 0 };
        if (onProgress) onProgress({ phase: 'delete', done: 0, total: 1 });
        const res = await apiPost('operations-delete-source.php', { source });
        if (onProgress) onProgress({ phase: 'delete', done: 1, total: 1 });
        invalidate();
        return {
            opsDeleted: res.opsDeleted || 0,
            importsDeleted: res.importsDeleted || 0,
            ecomUntagged: res.ecomUntagged || 0,
            attachDeleted: res.attachDeleted || 0
        };
    }

    async function clearAll() {
        await apiPost('reset.php', {});
        invalidate();
    }

    // ===================== Backup =====================

    async function exportAll() {
        const data = await apiGet('snapshot.php');
        return {
            operations: data.operations || [],
            imports: data.imports || [],
            settings: data.settings || [],            // [{key, value}]
            attachment_weekly: data.attachment_weekly || [],
            exportDate: new Date().toISOString()
        };
    }

    async function importAll(data, onProgress) {
        await apiPost('reset.php', {});
        const BATCH = 1000;

        const ops = data.operations || [];
        for (let i = 0; i < ops.length; i += BATCH) {
            await apiPost('operations-bulk.php', { records: ops.slice(i, i + BATCH) });
            if (onProgress) onProgress(Math.min(i + BATCH, ops.length), ops.length);
        }

        const att = data.attachment_weekly || [];
        for (let i = 0; i < att.length; i += BATCH) {
            await apiPost('attachment-bulk.php', { records: att.slice(i, i + BATCH) });
        }

        for (const s of (data.settings || [])) {
            await apiPost('settings.php', { key: s.key, value: s.value });
        }
        for (const imp of (data.imports || [])) {
            await apiPost('imports.php', imp);
        }
        invalidate();
    }

    // ===================== Usuarios (Fase 4b, admin-only) =====================
    // No tocan el snapshot: hablan directamente con users.php. El backend exige
    // sesión admin (un viewer recibe 403 y apiGet/apiPost lanzan).

    async function getUsers() {
        return apiGet('users.php'); // { users: [...] }
    }

    async function updateUser(payload) {
        // payload: { id, role?, active? }. users.php acepta POST además de PUT.
        return apiPost('users.php', payload);
    }

    return {
        init,
        getAllOperations,
        getAllAttachmentWeekly,
        invalidateOpsCache,
        invalidateAttachmentCache,
        bulkAddOperations,
        bulkPutAttachmentWeekly,
        renormalizeAttachmentStoresForSource,
        replaceOperationsByDateRange,
        renormalizeStoresForSource,
        logImport,
        getExistingFingerprints,
        crossReferenceEcom,
        getEcomCoverage,
        getRecordCount,
        getDateRange,
        getDateRangeBySource,
        getAvailableBBDateRange,
        getDistinctValues,
        queryOperations,
        getOperationsForKPI,
        getImportHistory,
        getSetting,
        setSetting,
        exportAll,
        importAll,
        clearAll,
        deleteBySource,
        getStorageSummaryBySource,
        getUsers,
        updateUser
    };
})();
