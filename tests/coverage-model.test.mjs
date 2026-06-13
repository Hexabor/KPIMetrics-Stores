import { describe, it, expect } from 'vitest';
import CoverageModel from '../js/modules/coverage-model.js';

// Helper: fecha ISO del dia `dayOffset` de la semana lineal `lin`.
// Curso anclado en 2025-12-27 (W1), que es el default del KPIEngine.
const COURSE_START = Date.UTC(2025, 11, 27);
function weekDate(lin, dayOffset = 0) {
    const ms = COURSE_START + ((lin - 1) * 7 + dayOffset) * 86400000;
    return new Date(ms).toISOString().substring(0, 10);
}

describe('CoverageModel — análisis puro de semanas', () => {
    const { classifyWeek, internalGaps, staleness, partialWeeks } = CoverageModel;

    it('classifyWeek distingue present / gap / leading / pending / future', () => {
        const weeks = new Set([2, 3, 5]); // hueco en 4
        const today = 7;
        expect(classifyWeek(weeks, 2, today)).toBe('present');
        expect(classifyWeek(weeks, 4, today)).toBe('gap');      // rodeada de datos
        expect(classifyWeek(weeks, 1, today)).toBe('leading');  // antes del primer dato
        expect(classifyWeek(weeks, 6, today)).toBe('pending');  // terminada (<= hoy-1) y sin datos
        expect(classifyWeek(weeks, 7, today)).toBe('future');   // semana EN CURSO → no cuenta
        expect(classifyWeek(weeks, 8, today)).toBe('future');   // posterior
    });

    it('internalGaps devuelve solo las semanas vacías rodeadas de datos', () => {
        expect(internalGaps(new Set([1, 2, 4, 5]))).toEqual([3]);
        expect(internalGaps(new Set([1, 2, 5]))).toEqual([3, 4]);
        expect(internalGaps(new Set([1, 2, 3]))).toEqual([]);
        expect(internalGaps(new Set([7]))).toEqual([]);
        expect(internalGaps(new Set())).toEqual([]);
    });

    it('staleness cuenta solo semanas TERMINADAS sin subir (la actual no cuenta)', () => {
        // hoy = W6 → última semana concluida = W5
        expect(staleness(new Set([1, 2, 4]), 6)).toBe(1); // falta W5 (W6 en curso no cuenta)
        expect(staleness(new Set([1, 2, 5]), 6)).toBe(0); // W5 subida, W6 en curso → al día
        expect(staleness(new Set([1, 2, 6]), 6)).toBe(0); // hay datos de la semana en curso
        expect(staleness(new Set([1, 2, 8]), 6)).toBe(0); // nunca negativo
        expect(staleness(new Set(), 6)).toBe(0);
    });

    it('partialWeeks no exige una tienda antes de su primera semana (apertura)', () => {
        // A y B abren en W1; C abre en W3.
        const storeFirstWeek = new Map([['A', 1], ['B', 1], ['C', 3]]);
        const weekStores = new Map([
            [1, new Set(['A', 'B'])],   // C aún no existe → no se exige
            [2, new Set(['A', 'B'])],   // C aún no existe → no se exige
            [3, new Set(['A', 'C'])]    // ya se espera C; falta B (abierta en W1)
        ]);
        const res = partialWeeks(weekStores, storeFirstWeek);
        expect(res).toEqual([
            { week: 3, missing: ['B'], present: 2, expected: 3 }
        ]);
    });
});

describe('CoverageModel — buildCoverageModel', () => {
    const { buildCoverageModel } = CoverageModel;

    // baby-banking: tienda A en W1,W2,W4 (hueco W3); tienda B en W1,W2 (parcial en W4).
    const operations = [
        { source: 'baby-banking', store: 'A', date: weekDate(1) },
        { source: 'baby-banking', store: 'A', date: weekDate(2) },
        { source: 'baby-banking', store: 'A', date: weekDate(4) },
        { source: 'baby-banking', store: 'B', date: weekDate(1) },
        { source: 'baby-banking', store: 'B', date: weekDate(2) },
        // captacion: solo W1
        { source: 'captacion', store: 'A', date: weekDate(1) }
    ];
    const attachment = [
        { source: 'attachment', store: 'A', cycleYear: 2026, week: 2 }
    ];
    const ecomImports = [
        { dateFrom: weekDate(2), dateTo: weekDate(3, 6) } // cubre W2 y W3
    ];
    const todayWeek = 6;

    const model = buildCoverageModel({ operations, attachment, ecomImports }, todayWeek);

    it('colMin = primera semana con datos; colMax = max(datos, hoy)', () => {
        expect(model.colMin).toBe(1);
        expect(model.colMax).toBe(6); // hoy (6) > último dato (4)
    });

    it('incluye solo fuentes con datos, en el orden de SOURCE_META', () => {
        expect(model.sources.map(s => s.key)).toEqual(['baby-banking', 'ecom', 'captacion', 'attachment']);
    });

    it('baby-banking: semanas, hueco interno, frescura y parcialidad', () => {
        const bb = model.sources.find(s => s.key === 'baby-banking');
        expect([...bb.weeks].sort((a, b) => a - b)).toEqual([1, 2, 4]);
        expect(bb.gaps).toEqual([3]);            // W3 vacía rodeada de datos
        expect(bb.staleness).toBe(1);            // última W4; concluida W5 → 1 sin subir (W6 en curso no cuenta)
        expect([...bb.expectedStores].sort()).toEqual(['A', 'B']);
        // W4 solo tiene la tienda A → parcial, falta B
        expect(bb.partials).toEqual([{ week: 4, missing: ['B'], present: 1, expected: 2 }]);
    });

    it('ecom deriva semanas del rango de import y no tiene tiendas', () => {
        const ecom = model.sources.find(s => s.key === 'ecom');
        expect([...ecom.weeks].sort((a, b) => a - b)).toEqual([2, 3]);
        expect(ecom.hasStore).toBe(false);
        expect(ecom.partials).toEqual([]);
    });

    it('attachment usa courseWeekToLinear para la clave de semana', () => {
        const at = model.sources.find(s => s.key === 'attachment');
        expect([...at.weeks]).toEqual([2]); // cycleYear 2026, week 2 → lineal 2
        expect(at.hasDay).toBe(false);
    });

    it('sin datos devuelve estructura vacía', () => {
        const empty = buildCoverageModel({ operations: [], attachment: [], ecomImports: [] }, 6);
        expect(empty.colMin).toBe(null);
        expect(empty.sources).toEqual([]);
    });
});
