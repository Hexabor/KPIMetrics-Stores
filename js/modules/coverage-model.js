/**
 * Coverage Model — lógica PURA del panel de cobertura.
 *
 * Calcula, a partir de las caches en memoria (operations, attachment_weekly,
 * imports de ecom), la presencia de datos por fuente / semana / tienda, y
 * deriva huecos internos, frescura (semanas sin importar) y cobertura parcial.
 *
 * No toca el DOM ni la BD: recibe arrays y devuelve estructuras. Así es
 * testeable con Vitest. La derivación de la semana LINEAL reutiliza los helpers
 * del KPIEngine (businessWeek para fechas, courseWeekToLinear para attachment).
 *
 * Eje de semana = semana LINEAL (W1 2026 = 1; semanas anteriores 0, -1...).
 */
const CoverageModel = (() => {

    // KPIEngine es global en el navegador; en Node (tests) se requiere.
    const KPI = (typeof KPIEngine !== 'undefined')
        ? KPIEngine
        : require('./kpi-engine.js');

    // Granularidad por fuente. hasStore/hasDay controlan hasta qué nivel
    // se puede hacer drill-down. El orden define el orden de filas en la rejilla.
    const SOURCE_META = [
        { key: 'baby-banking',    origin: 'ops',        hasStore: true,  hasDay: true  },
        { key: 'baby-banking-ic', origin: 'ops',        hasStore: true,  hasDay: true  },
        { key: 'ecom',            origin: 'ecomImports', hasStore: false, hasDay: false },
        { key: 'captacion',       origin: 'ops',        hasStore: true,  hasDay: true  },
        { key: 'attachment',      origin: 'attachment', hasStore: true,  hasDay: false },
        { key: 'attachment-ic',   origin: 'attachment', hasStore: true,  hasDay: false },
        { key: 'stocks',          origin: 'ops',        hasStore: true,  hasDay: true  }
    ];

    // ---- Derivación de la semana lineal ----
    function weekOfOp(op) {
        return KPI.helpers.businessWeek(op.date);
    }
    function weekOfAttachment(row) {
        return KPI.helpers.courseWeekToLinear(row.cycleYear, row.week);
    }

    // ---- Análisis puro sobre conjuntos de semanas ----

    /**
     * Clasifica una semana del eje respecto a un conjunto de semanas-con-datos.
     * La semana EN CURSO (todayWeek) y posteriores son 'future': aún no han
     * concluido, así que su ausencia no es un problema. La última semana
     * concluida es todayWeek - 1.
     *   present  — hay datos
     *   gap      — vacía, pero rodeada de datos (hay datos antes Y después) → probable olvido
     *   leading  — vacía antes del primer dato (la tienda/fuente no existía aún)
     *   pending  — vacía, concluida y posterior al último dato (terminada y sin subir)
     *   future   — vacía y aún no concluida (semana en curso o posterior)
     */
    function classifyWeek(weeksWithData, wk, todayWeek) {
        if (weeksWithData.has(wk)) return 'present';
        let min = Infinity, max = -Infinity;
        for (const w of weeksWithData) { if (w < min) min = w; if (w > max) max = w; }
        if (wk < min) return 'leading';
        if (wk > max) return wk >= todayWeek ? 'future' : 'pending'; // todayWeek aún en curso
        return 'gap'; // entre min y max, sin datos → hueco interno
    }

    /** Semanas vacías rodeadas de datos (huecos internos), ordenadas. */
    function internalGaps(weeksWithData) {
        if (!weeksWithData.size) return [];
        let min = Infinity, max = -Infinity;
        for (const w of weeksWithData) { if (w < min) min = w; if (w > max) max = w; }
        const gaps = [];
        for (let w = min + 1; w < max; w++) if (!weeksWithData.has(w)) gaps.push(w);
        return gaps;
    }

    /**
     * Semanas TERMINADAS sin subir: desde la última con datos hasta la última
     * semana concluida (todayWeek - 1). La semana en curso NO cuenta (no ha
     * concluido). Nunca negativo (no mira hacia atrás de lo subido).
     */
    function staleness(weeksWithData, todayWeek) {
        if (!weeksWithData.size) return 0;
        let max = -Infinity;
        for (const w of weeksWithData) if (w > max) max = w;
        return Math.max(0, (todayWeek - 1) - max);
    }

    /**
     * Semanas con cobertura parcial: presentes pero a las que les falta alguna
     * tienda ESPERADA. Una tienda solo se espera desde su propia primera semana
     * con datos (storeFirstWeek): así no se marca como faltante en semanas
     * anteriores a su apertura.
     * @param {Map<number,Set>} weekStores  semana -> set de tiendas con datos
     * @param {Map<string,number>} storeFirstWeek  tienda -> su primera semana con datos
     * @returns {Array} [{ week, missing:[stores], present:n, expected:n }]
     */
    function partialWeeks(weekStores, storeFirstWeek) {
        const out = [];
        for (const [wk, stores] of weekStores) {
            const expected = [];
            for (const [store, firstWk] of storeFirstWeek) if (firstWk <= wk) expected.push(store);
            const missing = expected.filter(s => !stores.has(s));
            if (missing.length) out.push({ week: wk, missing, present: stores.size, expected: expected.length });
        }
        out.sort((a, b) => a.week - b.week);
        return out;
    }

    // ---- Construcción del modelo completo ----

    /**
     * @param {Object} data { operations, attachment, ecomImports }
     *   operations: [{ source, store, date }]
     *   attachment: [{ source, store, cycleYear, week }]
     *   ecomImports: [{ dateFrom, dateTo }]   (solo imports de ecom)
     * @param {number} todayWeek  semana lineal de hoy (KPIEngine.helpers.businessWeek(hoy))
     * @returns {Object} { colMin, colMax, sources: [{ key, hasStore, hasDay, weeks:Set,
     *   storeWeeks:Map<store,Set>, weekStores:Map<wk,Set>, expectedStores:Set, maxWeek,
     *   gaps:[], staleness:n, partials:[] }] }  — solo fuentes CON datos.
     */
    function buildCoverageModel(data, todayWeek) {
        const { operations = [], attachment = [], ecomImports = [] } = data || {};

        // Acumuladores por clave de fuente.
        const acc = {};
        const ensure = (key) => acc[key] || (acc[key] = { weeks: new Set(), storeWeeks: new Map(), weekStores: new Map() });
        const addPresence = (key, wk, store) => {
            if (!Number.isFinite(wk)) return;
            const a = ensure(key);
            a.weeks.add(wk);
            if (store) {
                if (!a.storeWeeks.has(store)) a.storeWeeks.set(store, new Set());
                a.storeWeeks.get(store).add(wk);
                if (!a.weekStores.has(wk)) a.weekStores.set(wk, new Set());
                a.weekStores.get(wk).add(store);
            }
        };

        for (const op of operations) {
            if (!op.source || !op.date) continue;
            addPresence(op.source, weekOfOp(op), op.store);
        }
        for (const row of attachment) {
            if (!row.source) continue;
            addPresence(row.source, weekOfAttachment(row), row.store);
        }
        for (const imp of ecomImports) {
            if (!imp.dateFrom || !imp.dateTo) continue;
            const wFrom = KPI.helpers.businessWeek(imp.dateFrom);
            const wTo = KPI.helpers.businessWeek(imp.dateTo);
            if (!Number.isFinite(wFrom) || !Number.isFinite(wTo)) continue;
            for (let w = Math.min(wFrom, wTo); w <= Math.max(wFrom, wTo); w++) addPresence('ecom', w, null);
        }

        // Eje global de columnas.
        let colMin = Infinity, dataMax = -Infinity;
        for (const a of Object.values(acc)) {
            for (const w of a.weeks) { if (w < colMin) colMin = w; if (w > dataMax) dataMax = w; }
        }
        if (!Number.isFinite(colMin)) return { colMin: null, colMax: null, sources: [] };
        const colMax = Math.max(dataMax, todayWeek);

        // Ensamblar fuentes en el orden de SOURCE_META (solo las que tienen datos).
        const sources = [];
        for (const meta of SOURCE_META) {
            const a = acc[meta.key];
            if (!a || !a.weeks.size) continue;
            let maxWeek = -Infinity;
            for (const w of a.weeks) if (w > maxWeek) maxWeek = w;
            const expectedStores = new Set(a.storeWeeks.keys());
            // Primera semana con datos de cada tienda (para no exigirla antes de abrir).
            const storeFirstWeek = new Map();
            for (const [store, wks] of a.storeWeeks) {
                let mn = Infinity;
                for (const w of wks) if (w < mn) mn = w;
                storeFirstWeek.set(store, mn);
            }
            sources.push({
                key: meta.key,
                hasStore: meta.hasStore,
                hasDay: meta.hasDay,
                weeks: a.weeks,
                storeWeeks: a.storeWeeks,
                weekStores: a.weekStores,
                expectedStores,
                storeFirstWeek,
                maxWeek,
                gaps: internalGaps(a.weeks),
                staleness: staleness(a.weeks, todayWeek),
                partials: meta.hasStore ? partialWeeks(a.weekStores, storeFirstWeek) : []
            });
        }
        return { colMin, colMax, sources };
    }

    return {
        SOURCE_META,
        weekOfOp,
        weekOfAttachment,
        classifyWeek,
        internalGaps,
        staleness,
        partialWeeks,
        buildCoverageModel
    };
})();

// Export para entornos Node (tests con Vitest). Inerte en navegador.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoverageModel;
}
