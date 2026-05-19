/**
 * KPI Engine - Calculates key performance indicators from operations data.
 * Each KPI is a registered function that receives filtered data and returns results.
 *
 * Business calendar: weeks run Saturday to Friday.
 * A "course start" date defines week 1.
 */
const KPIEngine = (() => {

    // Registry of KPI calculators
    const kpis = {};

    // Course start date (Saturday that begins week 1). Configurable.
    // Default: 2025-12-27 (semana 1 del curso 2026)
    let courseStartDate = '2025-12-27';

    /** Set the course start date (must be a Saturday YYYY-MM-DD) */
    function setCourseStart(dateStr) {
        courseStartDate = dateStr;
    }

    function getCourseStart() {
        return courseStartDate;
    }

    /**
     * Calculate the business week number for a given date string.
     * Weeks run Saturday-Friday. Week 1 starts on courseStartDate.
     * Uses Date.UTC to avoid DST/timezone drift.
     */
    function businessWeek(dateStr) {
        if (!dateStr) return null;
        const p = dateStr.split('-');
        const d = Date.UTC(p[0], p[1] - 1, p[2]);
        const s = courseStartDate.split('-');
        const start = Date.UTC(s[0], s[1] - 1, s[2]);
        const diffDays = Math.round((d - start) / 86400000);
        const weekNum = Math.floor(diffDays / 7) + 1;
        return weekNum;
    }

    /** Get "Wxx" label from a date */
    function businessWeekKey(dateStr) {
        const wn = businessWeek(dateStr);
        if (wn === null) return 'N/A';
        return `W${String(wn).padStart(2, '0')}`;
    }

    /** Register a new KPI calculator */
    function register(id, config) {
        kpis[id] = {
            id,
            name: config.name,
            description: config.description || '',
            category: config.category || 'general',
            calculate: config.calculate
        };
    }

    function getAll() {
        return Object.values(kpis);
    }

    function calculate(id, data, params = {}) {
        const kpi = kpis[id];
        if (!kpi) throw new Error(`KPI not found: ${id}`);
        return kpi.calculate(data, params);
    }

    function calculateAll(data, params = {}) {
        const results = {};
        for (const [id, kpi] of Object.entries(kpis)) {
            try {
                results[id] = {
                    ...kpi,
                    result: kpi.calculate(data, params)
                };
            } catch (e) {
                results[id] = { ...kpi, result: null, error: e.message };
            }
        }
        return results;
    }

    // ========== Helpers ==========

    function groupBy(records, field) {
        const groups = {};
        for (const r of records) {
            const key = r[field] || 'N/A';
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
        }
        return groups;
    }

    function monthKey(dateStr) {
        return dateStr ? dateStr.substring(0, 7) : 'N/A';
    }

    function periodKey(dateStr, period) {
        if (period === 'week') return businessWeekKey(dateStr);
        if (period === 'month') return monthKey(dateStr);
        if (period === 'quarter') {
            const d = new Date(dateStr);
            const q = Math.ceil((d.getMonth() + 1) / 3);
            return `${d.getFullYear()}-Q${q}`;
        }
        return dateStr;
    }

    // ========== Built-in KPIs ==========

    // Total sales (type === 'sale')
    register('total-sales', {
        name: 'Ventas totales',
        description: 'Operaciones de tipo Sale',
        category: 'ventas',
        calculate(data) {
            const sales = data.filter(r => r.type === 'sale');
            return {
                value: sales.length,
                total: sales.reduce((s, r) => s + (r.total || 0), 0)
            };
        }
    });

    // Sales by category
    register('sales-by-category', {
        name: 'Ventas por categoria',
        description: 'Desglose de ventas por categoria de producto',
        category: 'ventas',
        calculate(data) {
            const sales = data.filter(r => r.type === 'sale');
            const groups = groupBy(sales, 'category');
            const result = {};
            for (const [cat, recs] of Object.entries(groups)) {
                result[cat] = {
                    count: recs.length,
                    total: recs.reduce((s, r) => s + (r.total || 0), 0),
                    quantity: recs.reduce((s, r) => s + (r.quantity || 0), 0)
                };
            }
            return result;
        }
    });

    // Operations by type
    register('operations-by-type', {
        name: 'Operaciones por tipo',
        description: 'Distribucion: sale, cash buy, transfer, exchange, refund, rma',
        category: 'general',
        calculate(data) {
            const groups = groupBy(data, 'type');
            const result = {};
            for (const [type, recs] of Object.entries(groups)) {
                result[type] = {
                    count: recs.length,
                    total: recs.reduce((s, r) => s + (r.total || 0), 0)
                };
            }
            return result;
        }
    });

    // Transfers summary
    register('transfers', {
        name: 'Transfers de stock',
        description: 'Transferencias de stock (excluye TXORD)',
        category: 'logistica',
        calculate(data) {
            const transfers = data.filter(r =>
                r.type === 'transfer' && r.sku !== 'TXORD'
            );
            const byStore = groupBy(transfers, 'store');
            const result = {};
            for (const [store, recs] of Object.entries(byStore)) {
                result[store] = {
                    count: recs.length,
                    quantity: recs.reduce((s, r) => s + (r.quantity || 0), 0)
                };
            }
            return { total: transfers.length, byStore: result };
        }
    });

    // RMA summary
    register('rma', {
        name: 'Envios a RMA',
        description: 'Envios a garantia/RMA',
        category: 'logistica',
        calculate(data) {
            const rma = data.filter(r => r.type === 'rma');
            const byCategory = groupBy(rma, 'category');
            const result = {};
            for (const [cat, recs] of Object.entries(byCategory)) {
                result[cat] = {
                    count: recs.length,
                    total: recs.reduce((s, r) => s + (r.total || 0), 0)
                };
            }
            return { total: rma.length, byCategory: result };
        }
    });

    // Sales by store and period
    register('sales-by-store', {
        name: 'Ventas por tienda',
        description: 'Ventas por tienda y periodo',
        category: 'ventas',
        calculate(data, params = {}) {
            const period = params.period || 'week';
            const sales = data.filter(r => r.type === 'sale');
            const result = {};

            for (const r of sales) {
                const store = r.store || 'N/A';
                const pk = periodKey(r.date, period);
                if (!result[store]) result[store] = {};
                if (!result[store][pk]) result[store][pk] = { count: 0, total: 0 };
                result[store][pk].count++;
                result[store][pk].total += (r.total || 0);
            }
            return result;
        }
    });

    // Cash buys (compras a clientes - negative prices)
    register('cash-buys', {
        name: 'Compras (Cash Buy)',
        description: 'Articulos comprados a clientes',
        category: 'compras',
        calculate(data, params = {}) {
            const period = params.period || 'week';
            const buys = data.filter(r => r.type === 'cash buy');
            const byPeriod = {};

            for (const r of buys) {
                const pk = periodKey(r.date, period);
                if (!byPeriod[pk]) byPeriod[pk] = { count: 0, total: 0 };
                byPeriod[pk].count++;
                byPeriod[pk].total += (r.total || 0);
            }
            return {
                value: buys.length,
                total: buys.reduce((s, r) => s + (r.total || 0), 0),
                byPeriod
            };
        }
    });

    // Exchanges
    register('exchanges', {
        name: 'Exchanges',
        description: 'Operaciones de intercambio',
        category: 'general',
        calculate(data) {
            const ex = data.filter(r => r.type === 'exchange');
            return {
                value: ex.length,
                total: ex.reduce((s, r) => s + (r.total || 0), 0)
            };
        }
    });

    // Refunds
    register('refunds', {
        name: 'Refunds',
        description: 'Devoluciones a clientes',
        category: 'general',
        calculate(data) {
            const ref = data.filter(r => r.type === 'refund');
            return {
                value: ref.length,
                total: ref.reduce((s, r) => s + (r.total || 0), 0)
            };
        }
    });

    return {
        register,
        getAll,
        calculate,
        calculateAll,
        setCourseStart,
        getCourseStart,
        helpers: { groupBy, businessWeek, businessWeekKey, monthKey, periodKey }
    };
})();

// Export para entornos Node (tests con Vitest). Inerte en navegador.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KPIEngine;
}
