/**
 * CSV Parser module - Uses Papa Parse for streaming large files.
 * Handles column mapping and data normalization.
 *
 * Real CSV columns from CeX Looker:
 *   Branch, Order Number, Staff, Order Dt, Transaction Type,
 *   Box ID, Box Name, SerialNo, Category, Till No, Quantity, Price
 *
 * Edicion stores (GDPR): la columna Staff del CSV se DESCARTA al importar
 * y no se guarda en ninguna forma, en ninguna fuente. Ver CLAUDE.md.
 */
const CSVParser = (() => {

    // Default column mapping: exact CSV header -> internal field name
    // Keys are matched case-insensitively against the CSV headers.
    // Covers both Baby Banking ES (Branch, Order Dt, Box ID, Box Name, Category)
    // and Baby Banking IC (branchname, order_date, box_id, box_name, boxcategory).
    // Staff NO esta mapeado deliberadamente: aunque venga en el CSV, no entra.
    const DEFAULT_MAPPING = {
        'branch': 'store',
        'branchname': 'store',
        'order number': 'reference',
        'order dt': 'date',
        'order_date': 'date',
        'transaction type': 'type',
        'box id': 'sku',
        'box_id': 'sku',
        'box name': 'product',
        'box_name': 'product',
        'serialno': 'serial',
        'category': 'category',
        'boxcategory': 'category',
        'till no': 'till',
        'quantity': 'quantity',
        'price': 'price'
    };

    // Ecom Sales mapping: only date and order reference
    // Real header varies: "Dispatch Date(As per CWCM)", "Epos OrderID", etc.
    // We use fuzzy matching for ecom (see detectMapping)
    const ECOM_FIELDS = {
        date: ['dispatch date'],
        reference: ['epos order', 'epos orderid']
    };

    // Captacion (Store Memberships) mapping: solo lo que guardamos.
    // Staff NO esta aqui por GDPR; Member Id y Operating Company tampoco
    // (anonimizacion). Cada fila = 1 socio captado por esa tienda en esa fecha.
    const CAPTACION_MAPPING = {
        'branch': 'store',
        'subscriptiondate': 'date'
    };

    // Attachment (Store Membership Attachment) mapping: granularidad
    // (region, year, week, store) tras descartar staff.
    // CSV columns: Region, Year, Month, Week, OperatingCompany, StoreName,
    //   StaffID, StaffName, Percentage, Transactions, Attachment.
    // Lo que NO esta mapeado se descarta:
    //   - Month: derivable de (cycleYear, week).
    //   - OperatingCompany: redundante con Region.
    //   - StaffID/StaffName: GDPR (no se guarda).
    //   - Percentage: derivado en query (no se almacena el precalculado).
    const ATTACHMENT_MAPPING = {
        'region': 'region',
        'year': 'cycleYear',
        'week': 'week',
        'storename': 'store',
        'transactions': 'saleTransactions',
        'attachment': 'attachmentTransactions'
    };

    let columnMapping = { ...DEFAULT_MAPPING };

    /**
     * Heuristica para descartar nombres de "tienda" que en realidad son
     * departamentos centrales: RMA (servicios postventa), Ecomdistribution
     * (almacen e-commerce), Ecommerce/Commerce (departamento de venta online).
     * Aplica tanto a Baby Banking como a Attachment (CeX los mezcla en
     * algunas fuentes). "commerce" cubre las variantes "Ecommerce" (que ya
     * lo contiene) y "ES Commerce" (la que aparece en el CSV de attachment).
     */
    function isNonStoreDept(storeName) {
        if (!storeName) return false;
        const s = String(storeName).trim().toLowerCase();
        return s.includes('rma') || s.includes('ecomdistribution') || s.includes('commerce');
    }

    /** Update column mapping */
    function setMapping(mapping) {
        columnMapping = { ...DEFAULT_MAPPING, ...mapping };
    }

    function getMapping() {
        return { ...columnMapping };
    }

    /**
     * Parse a CSV file and return preview data.
     * Only reads first N rows for preview.
     */
    function parsePreview(file, maxRows = 20, source) {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                preview: maxRows,
                complete(results) {
                    const headers = results.meta.fields || [];
                    resolve({
                        headers,
                        rows: results.data,
                        detectedMapping: detectMapping(headers, source),
                        errors: results.errors
                    });
                },
                error(err) {
                    reject(err);
                }
            });
        });
    }

    /** Detect which CSV columns map to our internal fields */
    function detectMapping(headers, source) {
        const detected = {};

        if (source === 'ecom') {
            // Fuzzy match: header must contain one of the keywords
            for (const header of headers) {
                const h = header.trim().toLowerCase();
                for (const [field, keywords] of Object.entries(ECOM_FIELDS)) {
                    if (keywords.some(kw => h.includes(kw))) {
                        detected[header] = field;
                        break;
                    }
                }
            }
            return detected;
        }

        if (source === 'captacion') {
            for (const header of headers) {
                const normalized = header.trim().toLowerCase();
                if (CAPTACION_MAPPING[normalized]) {
                    detected[header] = CAPTACION_MAPPING[normalized];
                }
            }
            return detected;
        }

        if (source === 'attachment') {
            for (const header of headers) {
                const normalized = header.trim().toLowerCase();
                if (ATTACHMENT_MAPPING[normalized]) {
                    detected[header] = ATTACHMENT_MAPPING[normalized];
                }
            }
            return detected;
        }

        for (const header of headers) {
            const normalized = header.trim().toLowerCase();
            if (columnMapping[normalized]) {
                detected[header] = columnMapping[normalized];
            }
        }
        return detected;
    }

    /**
     * Parse the full CSV file and return normalized records.
     * Uses streaming for large files.
     */
    function parseFull(file, mapping, onProgress, source) {
        return new Promise((resolve, reject) => {
            const records = [];
            let rowCount = 0;

            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                step(results) {
                    rowCount++;
                    const raw = results.data;
                    const record = mapRecord(raw, mapping, source);
                    if (record) {
                        records.push(record);
                    }

                    if (onProgress && rowCount % 500 === 0) {
                        onProgress(rowCount);
                    }
                },
                complete() {
                    if (onProgress) onProgress(rowCount);
                    resolve({
                        records,
                        totalRows: rowCount,
                        skipped: rowCount - records.length
                    });
                },
                error(err) {
                    reject(err);
                }
            });
        });
    }

    /**
     * Map a raw CSV row to our internal record format.
     * Only keeps fields needed for KPIs: reference, type, category,
     * date, store, quantity, price, total.
     * Discards: product, serial, sku, till, staff, _raw.
     * Discards rows of type transfer (stock internal moves), EXCEPT those
     * with category "Test"/"TEST" — those are test admissions and we
     * remap their type to 'test-admission' so they survive the discard.
     * Refunds ARE kept (needed for net sales = gross - refunds).
     */
    function mapRecord(raw, mapping, source) {
        const record = {};

        for (const [csvCol, internalField] of Object.entries(mapping)) {
            if (raw[csvCol] !== undefined) {
                record[internalField] = raw[csvCol];
            }
        }

        // Ecom Sales: only reference + date, discard everything else
        if (source === 'ecom') {
            if (record.date) {
                record.date = normalizeDate(record.date);
            }
            if (record.reference) {
                record.reference = record.reference.trim();
            }
            if (!record.reference && !record.date) {
                return null;
            }
            // Defensa GDPR: si alguien mapea staff por error, lo borramos.
            delete record.staff;
            return record;
        }

        // Attachment (Store Membership Attachment): cada fila trae los
        // contadores semanales de UN staff en UNA tienda. Aqui descartamos
        // staff y devolvemos los contadores brutos junto con region/cycleYear/
        // week/store; la agregacion por (store, semana) la hace el confirm
        // flow en app.js. La columna source destino ('attachment' vs
        // 'attachment-ic') se decide alli a partir de region.
        if (source === 'attachment') {
            // Defensa GDPR explicita en la rama attachment.
            delete record.staff;
            delete record.staffId;
            delete record.staffName;
            const region = (record.region || '').trim().toUpperCase();
            const cycleYear = parseInt(record.cycleYear, 10);
            const week = parseInt(record.week, 10);
            const sale = parseInt(record.saleTransactions, 10);
            const att = parseInt(record.attachmentTransactions, 10);
            // Filas sin datos numericos validos no aportan nada.
            if (!region || !cycleYear || !week || !record.store) return null;
            if (!Number.isFinite(sale) || sale < 0) return null;
            if (!Number.isFinite(att) || att < 0) return null;
            // Descarta departamentos no-tienda (ES Commerce / Ecomdistribution / RMA, etc.)
            // tambien aqui — Looker los expone como StoreName igual que en BB.
            if (isNonStoreDept(record.store)) return null;
            return {
                region,
                cycleYear,
                week,
                store: record.store.trim(),
                saleTransactions: sale,
                attachmentTransactions: att
            };
        }

        // Captacion (Store Memberships): each row = 1 captured member at
        // (store, date). Member Id, Operating Company y Staff se descartan
        // siempre (anonimizacion + GDPR).
        if (source === 'captacion') {
            if (record.date) record.date = normalizeDate(record.date);
            if (record.store) {
                // El CSV de captacion prefija las branches con "CeX " (p.e. "CeX YORK"),
                // mientras que Baby Banking las exporta sin el prefijo ("York").
                // Quitamos el prefijo para que los socios crucen bien con las ventas.
                record.store = record.store.trim().replace(/^CeX\s+/i, '');
            }
            // Defensa GDPR explicita en la rama captacion.
            delete record.staff;
            // Skip rows with no usable data
            if (!record.date || !record.store) return null;
            record.type = 'membership';
            return record;
        }

        // Normalize type first (needed for discard check)
        if (record.type) {
            record.type = record.type.trim().toLowerCase();
        }

        // Transfers: by default they are discarded (internal stock moves).
        // Exception: rows whose category is "Test" (any case) are admissions
        // to test — we keep them under a distinct type 'test-admission' so
        // every existing filter that excludes 'transfer' keeps ignoring them.
        if (record.type === 'transfer') {
            const cat = (record.category || '').trim().toLowerCase();
            if (cat === 'test') {
                record.type = 'test-admission';
            } else {
                return null;
            }
        }

        // Discard non-store departments (RMA centres, ecom warehouses).
        // Helper compartido con la rama de attachment para que cualquier
        // departamento nuevo se filtre una sola vez.
        if (isNonStoreDept(record.store)) return null;

        // Normalize date: "3 Apr 2026, 21:54:58" -> "2026-04-03"
        if (record.date) {
            record.date = normalizeDate(record.date);
        }

        if (record.category) {
            record.category = record.category.trim();
        }

        if (record.quantity) {
            record.quantity = parseFloat(record.quantity) || 0;
        }

        if (record.price) {
            record.price = parseFloat(record.price) || 0;
        }

        record.total = (record.quantity || 0) * (record.price || 0);

        // Strip fields not needed for KPIs. Staff es defensa GDPR: aunque alguien
        // restaure manualmente 'Staff'->'staff' en el mapping desde la UI, este
        // delete impide que el record final lo contenga.
        delete record.product;
        delete record.serial;
        delete record.sku;
        delete record.till;
        delete record.staff;

        // Skip rows with no meaningful data
        if (!record.type && !record.date) {
            return null;
        }

        return record;
    }

    /**
     * Normalize date formats to ISO "YYYY-MM-DD".
     * Primary format from CeX Looker: "3 Apr 2026, 21:54:58"
     */
    function normalizeDate(dateStr) {
        if (!dateStr) return null;
        const str = dateStr.trim();

        // Already ISO format
        if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
            return str.substring(0, 10);
        }

        // CeX Looker format: "3 Apr 2026, 21:54:58" or "31 Mar 2026, 15:06:40"
        const cexMatch = str.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})/);
        if (cexMatch) {
            const [, day, monthStr, year] = cexMatch;
            const months = {
                'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
                'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
                'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
            };
            const month = months[monthStr.toLowerCase()];
            if (month) {
                return `${year}-${month}-${day.padStart(2, '0')}`;
            }
        }

        // DD/MM/YYYY or DD-MM-YYYY
        const euMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (euMatch) {
            const [, day, month, year] = euMatch;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        // Fallback: native Date parsing
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            return d.toISOString().substring(0, 10);
        }

        return str;
    }

    /**
     * Agrega las filas de admision a test (type='test-admission') por Order
     * Number, sumando Quantity en UNA sola fila por pedido.
     *
     * Cada pedido a test aparece en el CSV como VARIAS filas (una por item/
     * serial), todas con la misma reference, price=0 y category "Test"/"TEST".
     * La clave de dedup al guardar es (reference, source, price, category) y NO
     * incluye quantity; ademas la colacion de MySQL es case-insensitive, asi que
     * "Test" == "TEST". Sin agregar, todas esas filas colapsan a UNA al guardar
     * y se pierde el conteo real de items (p.ej. 207 -> 133). Agregando aqui
     * (igual que captacion) se preserva la suma de items y la dedup por
     * reference queda idempotente al reimportar.
     *
     * Las filas que no son test-admission, o sin reference, se devuelven tal
     * cual y en su posicion original. Pura: no muta los registros de entrada.
     */
    function aggregateTestAdmissions(records) {
        const out = [];
        const byRef = new Map();
        for (const r of records) {
            if (r.type !== 'test-admission' || !r.reference) { out.push(r); continue; }
            const acc = byRef.get(r.reference);
            if (acc) {
                acc.quantity = (acc.quantity || 0) + (r.quantity || 0);
                acc.total = (acc.quantity || 0) * (acc.price || 0);
            } else {
                const copy = { ...r };
                byRef.set(r.reference, copy);
                out.push(copy);
            }
        }
        return out;
    }

    return {
        parsePreview,
        parseFull,
        setMapping,
        getMapping,
        detectMapping,
        isNonStoreDept,
        aggregateTestAdmissions,
        // Funciones internas expuestas solo para tests. No usar desde la app.
        _internals: { mapRecord, normalizeDate }
    };
})();

// Export para entornos Node (tests con Vitest). Inerte en navegador.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CSVParser;
}
