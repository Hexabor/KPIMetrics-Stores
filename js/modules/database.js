/**
 * Database module - IndexedDB via Dexie.js
 * Handles all persistent storage for operations data.
 *
 * Edicion stores: DB renombrada a 'KPIMetricsStores2026' (la del padre era
 * 'KPITool2026'). Los backups del padre NO son compatibles y no deben importarse
 * en esta version. Schema v1 limpio, sin staff ni indices por staff.
 */
const Database = (() => {
    let db;

    // In-memory cache of the full operations table. Populated on first read,
    // invalidated on any mutation (bulk add, ecom tagging, bulk restore, clear).
    // The returned array is shared — callers must not mutate it in place.
    let opsCache = null;

    function invalidateOpsCache() {
        opsCache = null;
    }

    async function getAllOperations() {
        if (opsCache) return opsCache;
        opsCache = await db.operations.toArray();
        return opsCache;
    }

    function init() {
        db = new Dexie('KPIMetricsStores2026');

        db.version(1).stores({
            operations: '++id, reference, type, category, date, store, week, channel, source, [store+date], [category+date], [type+date], [type+week]',
            imports: '++id, source, filename, date, rowCount, dateFrom, dateTo, storeCount, stores',
            settings: 'key'
        });

        return db;
    }

    /**
     * Add operations in bulk, computing the business week for each record.
     * weekFn: function(dateStr) => weekNumber
     * source: string identifying the import source (for dedup)
     */
    async function bulkAddOperations(records, onProgress, weekFn, source) {
        const BATCH_SIZE = 1000;
        let added = 0;

        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            for (const rec of batch) {
                if (weekFn) rec.week = weekFn(rec.date);
                if (source) rec.source = source;
                if (!rec.channel) rec.channel = 'tienda';
                // Defensa GDPR: aunque un parser desactualizado o un backup
                // legacy traiga staff, nunca llega a IndexedDB.
                delete rec.staff;
            }
            await db.operations.bulkAdd(batch);
            added += batch.length;
            if (onProgress) onProgress(added, records.length);
        }

        invalidateOpsCache();
        return added;
    }

    /**
     * Cross-reference ecom orders: mark baby-banking records whose reference
     * matches an ecom order as channel='ecom'.
     * Matches against both baby-banking (ES) and baby-banking-ic (IC).
     * Returns { tagged, alreadyTagged, notFound } counts.
     */
    async function crossReferenceEcom(ecomRecords, onProgress) {
        const refs = [...new Set(ecomRecords.map(r => r.reference).filter(Boolean))];
        if (!refs.length) return { tagged: 0, alreadyTagged: 0, notFound: 0 };

        // Build a date lookup from ecom records (for metadata)
        const ecomDates = ecomRecords.map(r => r.date).filter(Boolean).sort();

        // Find all baby-banking (ES + IC) records matching these references
        const BATCH = 500;
        let tagged = 0;
        let alreadyTagged = 0;
        let matchedRefs = new Set();

        for (let i = 0; i < refs.length; i += BATCH) {
            const chunk = refs.slice(i, i + BATCH);
            const matches = await db.operations
                .where('reference')
                .anyOf(chunk)
                .filter(r => r.source && r.source.startsWith('baby-banking'))
                .toArray();

            const ids = [];
            for (const m of matches) {
                matchedRefs.add(m.reference);
                if (m.channel === 'ecom') {
                    alreadyTagged++;
                } else {
                    ids.push(m.id);
                }
            }

            if (ids.length > 0) {
                await db.operations.where('id').anyOf(ids).modify({ channel: 'ecom' });
                tagged += ids.length;
            }

            if (onProgress) onProgress(Math.min(i + BATCH, refs.length), refs.length);
        }

        if (tagged > 0) invalidateOpsCache();
        const notFound = refs.length - matchedRefs.size;
        return { tagged, alreadyTagged, notFound, ecomDateFrom: ecomDates[0], ecomDateTo: ecomDates[ecomDates.length - 1] };
    }

    /**
     * Get ecom coverage info: date ranges for baby-banking data (ES + IC)
     * and which portions have been cross-referenced with ecom.
     */
    async function getEcomCoverage() {
        const ops = await getAllOperations();
        const allBB = ops.filter(r => r.source && r.source.startsWith('baby-banking'));

        if (!allBB.length) return null;

        const dates = allBB.map(r => r.date).filter(Boolean).sort();
        const bbFrom = dates[0];
        const bbTo = dates[dates.length - 1];

        // Get ecom import history to find covered date ranges
        const ecomImports = await db.imports
            .where('source').equals('ecom')
            .toArray();

        // Merge overlapping covered ranges
        const rawRanges = ecomImports
            .filter(imp => imp.dateFrom && imp.dateTo)
            .map(imp => ({ from: imp.dateFrom, to: imp.dateTo }))
            .sort((a, b) => a.from.localeCompare(b.from));

        const coveredRanges = [];
        for (const r of rawRanges) {
            const last = coveredRanges[coveredRanges.length - 1];
            if (last && r.from <= last.to) {
                // Overlapping or adjacent: extend
                if (r.to > last.to) last.to = r.to;
            } else {
                coveredRanges.push({ from: r.from, to: r.to });
            }
        }

        // Count channel distribution
        let ecomCount = 0;
        let tiendaCount = 0;
        for (const r of allBB) {
            if (r.channel === 'ecom') ecomCount++;
            else tiendaCount++;
        }

        return {
            bbFrom, bbTo,
            totalRecords: allBB.length,
            ecomCount, tiendaCount,
            coveredRanges
        };
    }

    /**
     * Apply a store-name reconciliation function to all existing rows of a
     * given source. Used by captacion to retro-fix store names already in DB
     * when the normalization rules or alias map evolve. The reconcile fn
     * receives the current store name and returns the canonical one (or the
     * same string if no change is needed). Returns count of rows updated.
     */
    async function renormalizeStoresForSource(source, reconcileFn) {
        if (!source || typeof reconcileFn !== 'function') return 0;
        const ops = await getAllOperations();
        const updates = [];
        for (const r of ops) {
            if (r.source !== source) continue;
            const canonical = reconcileFn(r.store);
            if (canonical && canonical !== r.store) {
                updates.push({ id: r.id, store: canonical });
            }
        }
        if (!updates.length) return 0;
        await db.transaction('rw', db.operations, async () => {
            for (const u of updates) {
                await db.operations.update(u.id, { store: u.store });
            }
        });
        invalidateOpsCache();
        return updates.length;
    }

    /**
     * Replace-by-date-range: for sources without a stable per-row dedup key
     * (e.g. captacion, where Member Id is intentionally discarded), the CSV
     * is treated as the source of truth for the range it covers. This
     * deletes all existing records of the given source whose date falls
     * within [dateFrom, dateTo] before bulk-adding the new ones.
     * Returns count of records deleted.
     */
    async function replaceOperationsByDateRange(source, dateFrom, dateTo) {
        if (!source || !dateFrom || !dateTo) return 0;
        const deleted = await db.operations
            .where('date')
            .between(dateFrom, dateTo, true, true)
            .filter(r => r.source === source)
            .delete();
        if (deleted > 0) invalidateOpsCache();
        return deleted;
    }

    async function logImport(meta) {
        return db.imports.add({
            source: meta.source || 'unknown',
            filename: meta.filename,
            date: new Date().toISOString(),
            rowCount: meta.rowCount || 0,
            dateFrom: meta.dateFrom || null,
            dateTo: meta.dateTo || null,
            storeCount: meta.storeCount || 0,
            stores: meta.stores || []
        });
    }

    /**
     * Build a Set of fingerprints for existing records that match
     * any of the given reference values (Order Numbers) AND the same source.
     * Fingerprint = "reference|price|category"
     * Dedup is per-source: the same order from different sources is NOT a duplicate.
     */
    async function getExistingFingerprints(references, source) {
        if (!references.length) return new Set();
        const existing = await db.operations
            .where('reference')
            .anyOf(references)
            .toArray();
        const fps = new Set();
        for (const r of existing) {
            if (r.source === source) {
                fps.add(`${r.reference}|${r.price}|${r.category}`);
            }
        }
        return fps;
    }

    async function getRecordCount() {
        return db.operations.count();
    }

    async function getDateRange() {
        const first = await db.operations.orderBy('date').first();
        const last = await db.operations.orderBy('date').last();
        if (!first || !last) return null;
        return { from: first.date, to: last.date };
    }

    async function getDateRangeBySource() {
        const result = {};

        // Baby Banking ES + IC + Captacion: compute min/max dates from the cached
        // operations array in one pass (avoids multiple full scans + sortBy).
        const ops = await getAllOperations();
        const trackedSources = new Set(['baby-banking', 'baby-banking-ic', 'captacion']);
        for (const r of ops) {
            if (!r.source || !r.date) continue;
            if (!trackedSources.has(r.source)) continue;
            const cur = result[r.source];
            if (!cur) {
                result[r.source] = { from: r.date, to: r.date };
            } else {
                if (r.date < cur.from) cur.from = r.date;
                if (r.date > cur.to) cur.to = r.date;
            }
        }

        // Ecom: shown as the portion of imported ecom that intersects with BB
        // (ES union IC). Ecom refs outside BB's range produce no cross-reference
        // tagging, so they shouldn't count as coverage. If there is no BB, ecom
        // has no applicable coverage and is omitted.
        const ecomImports = await db.imports.where('source').equals('ecom').toArray();
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
                    if (clipFrom <= clipTo) {
                        result['ecom'] = { from: clipFrom, to: clipTo };
                    }
                }
            }
        }

        return result;
    }

    /**
     * Compute the combined available data range across Baby Banking ES + IC.
     * Returns null if there is no BB data.
     * Week numbers are derived by the caller (app.js has access to KPIEngine);
     * this function only returns the date bounds.
     */
    async function getAvailableBBDateRange() {
        const ranges = await getDateRangeBySource();
        const bbRanges = [ranges['baby-banking'], ranges['baby-banking-ic']].filter(Boolean);
        if (!bbRanges.length) return null;
        const dateMin = bbRanges.map(r => r.from).sort()[0];
        const dateMax = bbRanges.map(r => r.to).sort()[bbRanges.length - 1];
        return { dateMin, dateMax };
    }

    async function getDistinctValues(field) {
        return db.operations.orderBy(field).uniqueKeys();
    }

    async function queryOperations(filters = {}, page = 1, pageSize = 50) {
        const filterFns = [];

        if (filters.type && filters.type !== 'all') {
            const t = filters.type.toLowerCase();
            filterFns.push(r => r.type && r.type.toLowerCase() === t);
        }
        if (filters.store && filters.store !== 'all') {
            filterFns.push(r => r.store === filters.store);
        }
        if (filters.category && filters.category !== 'all') {
            filterFns.push(r => r.category === filters.category);
        }
        if (filters.channel && filters.channel !== 'all') {
            const ch = filters.channel;
            filterFns.push(r => (r.channel || 'tienda') === ch);
        }
        if (filters.dateFrom) {
            filterFns.push(r => r.date >= filters.dateFrom);
        }
        if (filters.dateTo) {
            filterFns.push(r => r.date <= filters.dateTo);
        }
        if (filters.search) {
            const term = filters.search.toLowerCase();
            filterFns.push(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
        }

        const hasFilters = filterFns.length > 0;
        const matchFn = r => filterFns.every(fn => fn(r));

        // Get all matching records, then sort and paginate in memory
        let all;
        if (hasFilters) {
            all = await db.operations.filter(matchFn).toArray();
        } else {
            all = await db.operations.toArray();
        }
        all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        const total = all.length;
        const start = (page - 1) * pageSize;
        const records = all.slice(start, start + pageSize);

        return { records, total, page, pageSize };
    }

    async function getOperationsForKPI(filters = {}) {
        let collection = db.operations.toCollection();

        if (filters.store && filters.store !== 'all') {
            collection = db.operations.where('store').equals(filters.store);
        }

        if (filters.dateFrom && filters.dateTo) {
            collection = db.operations
                .where('date')
                .between(filters.dateFrom, filters.dateTo);
        }

        return collection.toArray();
    }

    async function getImportHistory() {
        return db.imports.orderBy('date').reverse().toArray();
    }

    async function getSetting(key) {
        const row = await db.settings.get(key);
        return row ? row.value : null;
    }

    async function setSetting(key, value) {
        return db.settings.put({ key, value });
    }

    async function exportAll() {
        const operations = await db.operations.toArray();
        const imports = await db.imports.toArray();
        const settings = await db.settings.toArray();
        return { operations, imports, settings, exportDate: new Date().toISOString() };
    }

    async function importAll(data, onProgress) {
        invalidateOpsCache();
        await db.operations.clear();
        await db.imports.clear();
        await db.settings.clear();
        if (data.operations && data.operations.length > 0) {
            const ops = data.operations;
            const BATCH = 5000;
            for (let i = 0; i < ops.length; i += BATCH) {
                await db.operations.bulkAdd(ops.slice(i, i + BATCH));
                if (onProgress) onProgress(Math.min(i + BATCH, ops.length), ops.length);
            }
        }
        if (data.imports) await db.imports.bulkAdd(data.imports);
        if (data.settings) await db.settings.bulkAdd(data.settings);
    }

    async function clearAll() {
        invalidateOpsCache();
        db.close();
        await Dexie.delete('KPIMetricsStores2026');
        init();
        await db.open();
    }

    /**
     * Wipe a single import source from the active database without touching
     * the others. Operations + import history are removed for that source.
     *
     * Special case: 'ecom' has no operations rows of its own — what it does is
     * tag matching baby-banking rows with channel='ecom'. So clearing 'ecom'
     * removes its import history and reverts those tags back to 'tienda'.
     *
     * Settings (course start, ecom-per-KPI config) are NEVER touched.
     */
    async function deleteBySource(source, onProgress) {
        if (!source) return { opsDeleted: 0, importsDeleted: 0, ecomUntagged: 0 };

        // Use filter + primaryKeys + bulkDelete instead of where('source').equals(...).delete().
        // The filter approach is bulletproof at the cost of a full table scan,
        // which is fine here since the cleanup panel is occasional.
        if (onProgress) onProgress({ phase: 'scan', done: 0, total: 1 });
        const ids = source === 'ecom'
            ? await db.operations.filter(r => r.channel === 'ecom').primaryKeys()
            : await db.operations.filter(r => r.source === source).primaryKeys();

        // Delete in chunks so the UI gets meaningful progress updates and the
        // event loop has a chance to repaint between batches. 5000 keeps each
        // bulkDelete short on typical hardware.
        const BATCH = 5000;
        let opsDeleted = 0;
        let ecomUntagged = 0;
        for (let i = 0; i < ids.length; i += BATCH) {
            const chunk = ids.slice(i, i + BATCH);
            if (source === 'ecom') {
                await db.operations.where('id').anyOf(chunk).modify({ channel: 'tienda' });
                ecomUntagged += chunk.length;
                if (onProgress) onProgress({ phase: 'untag', done: ecomUntagged, total: ids.length });
            } else {
                await db.operations.bulkDelete(chunk);
                opsDeleted += chunk.length;
                if (onProgress) onProgress({ phase: 'delete', done: opsDeleted, total: ids.length });
            }
        }

        if (onProgress) onProgress({ phase: 'imports', done: 0, total: 1 });
        const importIds = await db.imports
            .filter(imp => imp.source === source)
            .primaryKeys();
        const importsDeleted = importIds.length;
        if (importIds.length) {
            await db.imports.bulkDelete(importIds);
        }

        if (opsDeleted > 0 || ecomUntagged > 0) invalidateOpsCache();
        return { opsDeleted, importsDeleted, ecomUntagged };
    }

    /**
     * Summary of what is currently stored, broken down by source. Used by
     * the cleanup panel in Configuracion to show what is at stake before
     * the user wipes a source.
     */
    async function getStorageSummaryBySource() {
        const ops = await getAllOperations();
        const counts = {};        // source -> rowCount
        const dateMin = {};
        const dateMax = {};
        let ecomTaggedCount = 0;

        for (const r of ops) {
            const src = r.source || 'unknown';
            counts[src] = (counts[src] || 0) + 1;
            if (r.date) {
                if (!dateMin[src] || r.date < dateMin[src]) dateMin[src] = r.date;
                if (!dateMax[src] || r.date > dateMax[src]) dateMax[src] = r.date;
            }
            if (r.channel === 'ecom') ecomTaggedCount++;
        }

        // Ecom has no rows of its own; surface its presence via imports +
        // the count of currently-tagged baby-banking rows.
        const allImports = await db.imports.toArray();
        const importCountBySource = {};
        const importDateMin = {};
        const importDateMax = {};
        for (const imp of allImports) {
            const src = imp.source || 'unknown';
            importCountBySource[src] = (importCountBySource[src] || 0) + 1;
            if (imp.dateFrom) {
                if (!importDateMin[src] || imp.dateFrom < importDateMin[src]) importDateMin[src] = imp.dateFrom;
            }
            if (imp.dateTo) {
                if (!importDateMax[src] || imp.dateTo > importDateMax[src]) importDateMax[src] = imp.dateTo;
            }
        }

        const allSources = new Set([...Object.keys(counts), ...Object.keys(importCountBySource)]);
        const result = {};
        for (const src of allSources) {
            result[src] = {
                rowCount: counts[src] || 0,
                importCount: importCountBySource[src] || 0,
                dateFrom: dateMin[src] || importDateMin[src] || null,
                dateTo: dateMax[src] || importDateMax[src] || null,
                ecomTaggedCount: src === 'ecom' ? ecomTaggedCount : 0
            };
        }
        return result;
    }

    return {
        init,
        getAllOperations,
        invalidateOpsCache,
        bulkAddOperations,
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
        getStorageSummaryBySource
    };
})();
