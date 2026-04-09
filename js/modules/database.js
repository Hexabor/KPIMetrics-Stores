/**
 * Database module - IndexedDB via Dexie.js
 * Handles all persistent storage for operations data.
 */
const Database = (() => {
    let db;

    function init() {
        db = new Dexie('KPITool2026');

        db.version(1).stores({
            operations: '++id, type, category, date, store, staff, week, [store+date], [category+date], [type+date], [staff+date], [staff+week], [type+week]',
            imports: '++id, filename, date, rowCount',
            settings: 'key'
        });

        // v2: richer import log
        db.version(2).stores({
            operations: '++id, type, category, date, store, staff, week, [store+date], [category+date], [type+date], [staff+date], [staff+week], [type+week]',
            imports: '++id, source, filename, date, rowCount, dateFrom, dateTo, storeCount, stores',
            settings: 'key'
        });

        // v3: add reference index for deduplication
        db.version(3).stores({
            operations: '++id, reference, type, category, date, store, staff, week, [store+date], [category+date], [type+date], [staff+date], [staff+week], [type+week]',
            imports: '++id, source, filename, date, rowCount, dateFrom, dateTo, storeCount, stores',
            settings: 'key'
        });

        // v4: add channel field (tienda/ecom) - backfill existing as 'tienda'
        db.version(4).stores({
            operations: '++id, reference, type, category, date, store, staff, week, channel, [store+date], [category+date], [type+date], [staff+date], [staff+week], [type+week]',
            imports: '++id, source, filename, date, rowCount, dateFrom, dateTo, storeCount, stores',
            settings: 'key'
        }).upgrade(tx => {
            return tx.table('operations').toCollection().modify(rec => {
                if (!rec.channel) rec.channel = 'tienda';
            });
        });

        // v5: add source index (required for ecom coverage queries)
        db.version(5).stores({
            operations: '++id, reference, type, category, date, store, staff, week, channel, source, [store+date], [category+date], [type+date], [staff+date], [staff+week], [type+week]',
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
            }
            await db.operations.bulkAdd(batch);
            added += batch.length;
            if (onProgress) onProgress(added, records.length);
        }

        return added;
    }

    /**
     * Cross-reference ecom orders: mark baby-banking records whose reference
     * matches an ecom order as channel='ecom'.
     * Returns { tagged, alreadyTagged, notFound } counts.
     */
    async function crossReferenceEcom(ecomRecords, onProgress) {
        const refs = [...new Set(ecomRecords.map(r => r.reference).filter(Boolean))];
        if (!refs.length) return { tagged: 0, alreadyTagged: 0, notFound: 0 };

        // Build a date lookup from ecom records (for metadata)
        const ecomDates = ecomRecords.map(r => r.date).filter(Boolean).sort();

        // Find all baby-banking records matching these references
        const BATCH = 500;
        let tagged = 0;
        let alreadyTagged = 0;
        let matchedRefs = new Set();

        for (let i = 0; i < refs.length; i += BATCH) {
            const chunk = refs.slice(i, i + BATCH);
            const matches = await db.operations
                .where('reference')
                .anyOf(chunk)
                .filter(r => r.source === 'baby-banking')
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

        const notFound = refs.length - matchedRefs.size;
        return { tagged, alreadyTagged, notFound, ecomDateFrom: ecomDates[0], ecomDateTo: ecomDates[ecomDates.length - 1] };
    }

    /**
     * Get ecom coverage info: date ranges for baby-banking data
     * and which portions have been cross-referenced with ecom.
     */
    async function getEcomCoverage() {
        const allBB = await db.operations
            .filter(r => r.source === 'baby-banking')
            .toArray();

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

        // Baby Banking: from operations table
        const bbSorted = await db.operations.where('source').equals('baby-banking').sortBy('date');
        if (bbSorted.length > 0) {
            const first = bbSorted.find(r => r.date);
            const last = [...bbSorted].reverse().find(r => r.date);
            if (first && last) result['baby-banking'] = { from: first.date, to: last.date };
        }

        // Ecom: from imports table (ecom records aren't stored in operations)
        const ecomImports = await db.imports.where('source').equals('ecom').toArray();
        if (ecomImports.length > 0) {
            const froms = ecomImports.map(i => i.dateFrom).filter(Boolean).sort();
            const tos = ecomImports.map(i => i.dateTo).filter(Boolean).sort();
            if (froms.length && tos.length) {
                result['ecom'] = { from: froms[0], to: tos[tos.length - 1] };
            }
        }

        return result;
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
        db.close();
        await Dexie.delete('KPITool2026');
        init();
        await db.open();
    }

    return {
        init,
        bulkAddOperations,
        logImport,
        getExistingFingerprints,
        crossReferenceEcom,
        getEcomCoverage,
        getRecordCount,
        getDateRange,
        getDateRangeBySource,
        getDistinctValues,
        queryOperations,
        getOperationsForKPI,
        getImportHistory,
        getSetting,
        setSetting,
        exportAll,
        importAll,
        clearAll
    };
})();
