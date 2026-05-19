import { describe, it, expect } from 'vitest';
import CSVParser from '../js/modules/csv-parser.js';

const { mapRecord, normalizeDate } = CSVParser._internals;

describe('normalizeDate', () => {
    it('formato Looker CeX tipico: "3 Apr 2026, 21:54:58"', () => {
        expect(normalizeDate('3 Apr 2026, 21:54:58')).toBe('2026-04-03');
    });

    it('Looker con dia de 2 digitos: "31 Mar 2026, 15:06:40"', () => {
        expect(normalizeDate('31 Mar 2026, 15:06:40')).toBe('2026-03-31');
    });

    it('ya en ISO se devuelve recortado a 10 chars', () => {
        expect(normalizeDate('2026-04-03')).toBe('2026-04-03');
        expect(normalizeDate('2026-04-03T12:00:00')).toBe('2026-04-03');
    });

    it('formato europeo DD/MM/YYYY', () => {
        expect(normalizeDate('03/04/2026')).toBe('2026-04-03');
    });

    it('formato europeo con guiones DD-MM-YYYY', () => {
        expect(normalizeDate('03-04-2026')).toBe('2026-04-03');
    });

    it('null o cadena vacia devuelve null', () => {
        expect(normalizeDate(null)).toBe(null);
        expect(normalizeDate('')).toBe(null);
    });
});

describe('mapRecord - reglas de descarte e import', () => {
    // Mapping sin Staff: el header Staff del CSV no se mapea a ningun campo interno.
    const mapping = {
        'Branch': 'store',
        'Order Number': 'reference',
        'Order Dt': 'date',
        'Transaction Type': 'type',
        'Box ID': 'sku',
        'Box Name': 'product',
        'Category': 'category',
        'Quantity': 'quantity',
        'Price': 'price'
    };

    it('transfer normal se descarta (movimiento de stock interno)', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'transfer',
            'Category': 'Moviles - iPhone',
            'Quantity': '1',
            'Price': '100',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        expect(mapRecord(raw, mapping)).toBeNull();
    });

    it('transfer con category=Test se MANTIENE como type=test-admission', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'transfer',
            'Category': 'Test',
            'Quantity': '1',
            'Price': '0',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        const r = mapRecord(raw, mapping);
        expect(r).not.toBeNull();
        expect(r.type).toBe('test-admission');
    });

    it('transfer con category=TEST (mayusculas) tambien sobrevive', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'transfer',
            'Category': 'TEST',
            'Quantity': '1',
            'Price': '0',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        expect(mapRecord(raw, mapping).type).toBe('test-admission');
    });

    it('refund SE GUARDA (necesario para ventas netas = brutas - |refunds|)', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'refund',
            'Category': 'Moviles - iPhone',
            'Quantity': '1',
            'Price': '-50',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        const r = mapRecord(raw, mapping);
        expect(r).not.toBeNull();
        expect(r.type).toBe('refund');
        expect(r.total).toBe(-50);
    });

    it('store="ES Ecomdistribution" se descarta (no es tienda)', () => {
        const raw = {
            'Branch': 'ES Ecomdistribution',
            'Transaction Type': 'sale',
            'Quantity': '1',
            'Price': '100',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        expect(mapRecord(raw, mapping)).toBeNull();
    });

    it('store que contiene "RMA" se descarta (centro RMA, no tienda)', () => {
        const raw = {
            'Branch': 'ES RMA Centre',
            'Transaction Type': 'sale',
            'Quantity': '1',
            'Price': '100',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        expect(mapRecord(raw, mapping)).toBeNull();
    });

    it('store="ES Ecommerce" se descarta', () => {
        const raw = {
            'Branch': 'ES Ecommerce',
            'Transaction Type': 'sale',
            'Quantity': '1',
            'Price': '100',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        expect(mapRecord(raw, mapping)).toBeNull();
    });

    it('total se calcula como quantity * price', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'sale',
            'Quantity': '2',
            'Price': '50',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        const r = mapRecord(raw, mapping);
        expect(r.total).toBe(100);
    });

    it('campos descartables (sku, product, serial, till) no aparecen en el record final', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'sale',
            'Box ID': 'BOX123',
            'Box Name': 'iPhone 15',
            'Quantity': '1',
            'Price': '50',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        const r = mapRecord(raw, mapping);
        expect(r.sku).toBeUndefined();
        expect(r.product).toBeUndefined();
        expect(r.serial).toBeUndefined();
        expect(r.till).toBeUndefined();
        expect(r.store).toBe('Madrid');
        expect(r.type).toBe('sale');
        expect(r.total).toBe(50);
    });

    it('type se normaliza a minusculas', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'SALE',
            'Quantity': '1',
            'Price': '50',
            'Order Dt': '3 Apr 2026, 12:00:00'
        };
        const r = mapRecord(raw, mapping);
        expect(r.type).toBe('sale');
    });

    it('fecha se normaliza al formato ISO YYYY-MM-DD', () => {
        const raw = {
            'Branch': 'Madrid',
            'Transaction Type': 'sale',
            'Quantity': '1',
            'Price': '50',
            'Order Dt': '3 Apr 2026, 21:54:58'
        };
        const r = mapRecord(raw, mapping);
        expect(r.date).toBe('2026-04-03');
    });
});

describe('mapRecord - source captacion (sin staff por GDPR)', () => {
    // Mapping de captacion sin Staff: solo store + date.
    const captacionMapping = {
        'Branch': 'store',
        'subscriptiondate': 'date'
    };

    it('strip prefijo "CeX " del nombre de tienda', () => {
        const raw = {
            'Branch': 'CeX YORK',
            'subscriptiondate': '2026-04-03'
        };
        const r = mapRecord(raw, captacionMapping, 'captacion');
        expect(r.store).toBe('YORK');
        expect(r.type).toBe('membership');
    });

    it('"CeX Madrid Islazul" -> "Madrid Islazul"', () => {
        const raw = {
            'Branch': 'CeX Madrid Islazul',
            'subscriptiondate': '2026-04-03'
        };
        const r = mapRecord(raw, captacionMapping, 'captacion');
        expect(r.store).toBe('Madrid Islazul');
    });

    it('row sin date devuelve null', () => {
        const raw = { 'Branch': 'CeX YORK' };
        expect(mapRecord(raw, captacionMapping, 'captacion')).toBeNull();
    });

    it('row sin store devuelve null', () => {
        const raw = { 'subscriptiondate': '2026-04-03' };
        expect(mapRecord(raw, captacionMapping, 'captacion')).toBeNull();
    });

    it('captacion record NO contiene staff aunque venga en el CSV', () => {
        const captacionConStaff = {
            'Branch': 'CeX YORK',
            'Staff': 'Ana',
            'subscriptiondate': '2026-04-03'
        };
        const r = mapRecord(captacionConStaff, captacionMapping, 'captacion');
        expect(r).not.toBeNull();
        expect(r.staff).toBeUndefined();
        expect('staff' in r).toBe(false);
    });
});

describe('mapRecord - regresion GDPR: Staff nunca entra al modelo', () => {
    // Defensa #1: el mapping por defecto NO contiene Staff, por lo que el
    // header "Staff" del CSV no se traduce a ningun campo interno.
    it('mapping sin Staff: el header "Staff" del CSV se ignora silenciosamente', () => {
        const mappingSinStaff = {
            'Branch': 'store',
            'Order Number': 'reference',
            'Order Dt': 'date',
            'Transaction Type': 'type',
            'Category': 'category',
            'Quantity': 'quantity',
            'Price': 'price'
        };
        const raw = {
            'Branch': 'Madrid',
            'Staff': 'Ana',
            'Order Number': 'X1',
            'Transaction Type': 'sale',
            'Order Dt': '3 Apr 2026, 12:00:00',
            'Quantity': '1', 'Price': '100'
        };
        const r = mapRecord(raw, mappingSinStaff);
        expect(r).not.toBeNull();
        expect(r.staff).toBeUndefined();
        expect('staff' in r).toBe(false);
    });

    // Defensa #2: aunque alguien restaure manualmente 'Staff' en el mapping
    // (escenario malicioso o bug de UI), mapRecord debe borrarlo del record final.
    it('mapping malicioso con Staff: el record final NO contiene staff', () => {
        const mappingConStaff = {
            'Branch': 'store',
            'Staff': 'staff',
            'Order Number': 'reference',
            'Order Dt': 'date',
            'Transaction Type': 'type',
            'Category': 'category',
            'Quantity': 'quantity',
            'Price': 'price'
        };
        const raw = {
            'Branch': 'Madrid',
            'Staff': 'Ana',
            'Order Number': 'X2',
            'Transaction Type': 'sale',
            'Order Dt': '3 Apr 2026, 12:00:00',
            'Quantity': '1', 'Price': '100'
        };
        const r = mapRecord(raw, mappingConStaff);
        expect(r).not.toBeNull();
        expect(r.staff).toBeUndefined();
        expect('staff' in r).toBe(false);
    });
});
