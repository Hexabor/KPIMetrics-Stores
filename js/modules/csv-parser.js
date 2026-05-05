/**
 * CSV Parser module - Uses Papa Parse for streaming large files.
 * Handles column mapping and data normalization.
 *
 * Real CSV columns from CeX Looker:
 *   Branch, Order Number, Staff, Order Dt, Transaction Type,
 *   Box ID, Box Name, SerialNo, Category, Till No, Quantity, Price
 */
const CSVParser = (() => {

    // Default column mapping: exact CSV header -> internal field name
    // Keys are matched case-insensitively against the CSV headers.
    // Covers both Baby Banking ES (Branch, Order Dt, Box ID, Box Name, Category)
    // and Baby Banking IC (branchname, order_date, box_id, box_name, boxcategory).
    const DEFAULT_MAPPING = {
        'branch': 'store',
        'branchname': 'store',
        'order number': 'reference',
        'staff': 'staff',
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

    // Captacion (Store Memberships) mapping: only what we keep.
    // Member Id and Operating Company are intentionally discarded for
    // anonymization. Each row = 1 captured member by that staff on that date.
    const CAPTACION_MAPPING = {
        'branch': 'store',
        'staff': 'staff',
        'subscriptiondate': 'date'
    };

    let columnMapping = { ...DEFAULT_MAPPING };

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
     * date, store, staff, quantity, price, total.
     * Discards: product, serial, sku, till, _raw.
     * Discards rows of type transfer (stock internal moves), EXCEPT those
     * with category "Test"/"TEST" — those are test admissions and we
     * remap their type to 'test-admission' so they survive the discard.
     * Refunds ARE kept now (needed for net sales = gross - refunds).
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
            return record;
        }

        // Captacion (Store Memberships): each row = 1 member captured.
        // We keep only store + staff + date. Member Id and Operating Company
        // are intentionally discarded (anonymization).
        if (source === 'captacion') {
            if (record.date) record.date = normalizeDate(record.date);
            if (record.store) {
                // The captacion CSV prefixes branches with "CeX " (e.g. "CeX YORK"),
                // while Baby Banking exports them without the prefix ("York").
                // Strip the prefix so memberships join correctly with sales.
                record.store = record.store.trim().replace(/^CeX\s+/i, '');
            }
            if (record.staff) record.staff = record.staff.trim();
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
        // ES uses "ES Ecomdistribution"/"ES Ecommerce"; IC uses the same pattern
        // with "IC " prefix, so we match by substring.
        if (record.store) {
            const s = record.store.trim().toLowerCase();
            if (s.includes('rma') || s.includes('ecomdistribution') || s.includes('ecommerce')) {
                return null;
            }
        }

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

        // Strip fields not needed for KPIs
        delete record.product;
        delete record.serial;
        delete record.sku;
        delete record.till;

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

    return {
        parsePreview,
        parseFull,
        setMapping,
        getMapping,
        detectMapping
    };
})();
