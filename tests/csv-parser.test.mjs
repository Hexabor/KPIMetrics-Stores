import { describe, it, expect } from 'vitest';
import CSVParser from '../js/modules/csv-parser.js';

const { mapRecord, normalizeDate } = CSVParser._internals;
const { isNonStoreDept, aggregateTestAdmissions } = CSVParser;

describe('isNonStoreDept - filtro defensivo de departamentos no-tienda', () => {
    it('descarta variantes de Ecommerce (con y sin "e" extra)', () => {
        expect(isNonStoreDept('ES Ecommerce')).toBe(true);
        expect(isNonStoreDept('ES Commerce')).toBe(true);
        expect(isNonStoreDept('IC Ecommerce')).toBe(true);
    });

    it('descarta RMA y Ecomdistribution', () => {
        expect(isNonStoreDept('ES RMA Centre')).toBe(true);
        expect(isNonStoreDept('IC RMA')).toBe(true);
        expect(isNonStoreDept('ES Ecomdistribution')).toBe(true);
    });

    it('NO descarta tiendas reales', () => {
        expect(isNonStoreDept('Madrid Islazul')).toBe(false);
        expect(isNonStoreDept('Las Palmas Mesa y Lopez')).toBe(false);
        expect(isNonStoreDept('York')).toBe(false);
    });

    it('null / vacio devuelve false (no se descarta lo que no es nombre)', () => {
        expect(isNonStoreDept(null)).toBe(false);
        expect(isNonStoreDept('')).toBe(false);
        expect(isNonStoreDept(undefined)).toBe(false);
    });
});

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

describe('mapRecord - source attachment (sin staff por GDPR)', () => {
    // Mapping de attachment: lo que el detector produciria a partir de los
    // headers reales del CSV de Looker ("Region", "Year", "Week", ...).
    const attachmentMapping = {
        'Region': 'region',
        'Year': 'cycleYear',
        'Week': 'week',
        'StoreName': 'store',
        'Transactions': 'saleTransactions',
        'Attachment': 'attachmentTransactions'
    };

    it('fila ES tipica devuelve region/cycleYear/week/store + contadores', () => {
        const raw = {
            'Region': 'SPAIN',
            'Year': '2026',
            'Week': '22',
            'StoreName': 'Madrid Islazul',
            'StaffID': 'ESVLN14167',
            'StaffName': 'ALEJANDRO BERMEJO',
            'Transactions': '32',
            'Attachment': '30'
        };
        const r = mapRecord(raw, attachmentMapping, 'attachment');
        expect(r).not.toBeNull();
        expect(r.region).toBe('SPAIN');
        expect(r.cycleYear).toBe(2026);
        expect(r.week).toBe(22);
        expect(r.store).toBe('Madrid Islazul');
        expect(r.saleTransactions).toBe(32);
        expect(r.attachmentTransactions).toBe(30);
    });

    it('region normalizada a mayusculas y trimeada', () => {
        const raw = {
            'Region': '  canary island  ',
            'Year': '2026', 'Week': '22', 'StoreName': 'Las Palmas',
            'Transactions': '10', 'Attachment': '7'
        };
        const r = mapRecord(raw, attachmentMapping, 'attachment');
        expect(r.region).toBe('CANARY ISLAND');
    });

    it('Percentage NUNCA entra al record (% se recalcula en query)', () => {
        const raw = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'StoreName': 'Madrid Islazul',
            'Percentage': '0.9375',
            'Transactions': '32', 'Attachment': '30'
        };
        const r = mapRecord(raw, attachmentMapping, 'attachment');
        expect(r.percentage).toBeUndefined();
        expect('percentage' in r).toBe(false);
    });

    it('regresion GDPR: staff/staffId/staffName nunca entran al record', () => {
        const rawConStaff = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'StoreName': 'Madrid Islazul',
            'StaffID': 'ESVLN14167', 'StaffName': 'ALEJANDRO BERMEJO',
            'Transactions': '32', 'Attachment': '30'
        };
        const r = mapRecord(rawConStaff, attachmentMapping, 'attachment');
        expect(r).not.toBeNull();
        expect(r.staff).toBeUndefined();
        expect(r.staffId).toBeUndefined();
        expect(r.staffName).toBeUndefined();
        expect('staff' in r).toBe(false);
        expect('staffId' in r).toBe(false);
        expect('staffName' in r).toBe(false);
    });

    it('regresion GDPR: mapping malicioso con StaffName tampoco lo deja pasar', () => {
        const mappingMalicioso = { ...attachmentMapping, 'StaffName': 'staffName' };
        const raw = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'StoreName': 'Madrid Islazul',
            'StaffName': 'ALEJANDRO BERMEJO',
            'Transactions': '32', 'Attachment': '30'
        };
        const r = mapRecord(raw, mappingMalicioso, 'attachment');
        expect(r.staffName).toBeUndefined();
        expect('staffName' in r).toBe(false);
    });

    it('fila sin region devuelve null', () => {
        const raw = {
            'Year': '2026', 'Week': '22', 'StoreName': 'Madrid',
            'Transactions': '10', 'Attachment': '5'
        };
        expect(mapRecord(raw, attachmentMapping, 'attachment')).toBeNull();
    });

    it('fila sin store devuelve null', () => {
        const raw = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'Transactions': '10', 'Attachment': '5'
        };
        expect(mapRecord(raw, attachmentMapping, 'attachment')).toBeNull();
    });

    it('Transactions/Attachment no numericos devuelven null', () => {
        const raw = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'StoreName': 'Madrid',
            'Transactions': 'N/A', 'Attachment': '5'
        };
        expect(mapRecord(raw, attachmentMapping, 'attachment')).toBeNull();
    });

    it('StoreName="ES Commerce" se descarta (departamento ecom, no tienda)', () => {
        const raw = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'StoreName': 'ES Commerce',
            'Transactions': '50', 'Attachment': '40'
        };
        expect(mapRecord(raw, attachmentMapping, 'attachment')).toBeNull();
    });

    it('StoreName="ES Ecommerce" se descarta (variante con doble e)', () => {
        const raw = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'StoreName': 'ES Ecommerce',
            'Transactions': '50', 'Attachment': '40'
        };
        expect(mapRecord(raw, attachmentMapping, 'attachment')).toBeNull();
    });

    it('StoreName con "RMA" se descarta (centro RMA)', () => {
        const raw = {
            'Region': 'CANARY ISLAND', 'Year': '2026', 'Week': '22',
            'StoreName': 'IC RMA Centre',
            'Transactions': '10', 'Attachment': '5'
        };
        expect(mapRecord(raw, attachmentMapping, 'attachment')).toBeNull();
    });

    it('attachment > transactions: el parser NO bloquea (validacion en BD), pero conserva los numeros', () => {
        // El chk_attach_qty del schema MySQL valida esto, no el parser.
        // El parser pasa los numeros tal cual; la responsabilidad de filtrar
        // datos imposibles es del confirm flow / la BD.
        const raw = {
            'Region': 'SPAIN', 'Year': '2026', 'Week': '22',
            'StoreName': 'Madrid',
            'Transactions': '10', 'Attachment': '20'
        };
        const r = mapRecord(raw, attachmentMapping, 'attachment');
        expect(r).not.toBeNull();
        expect(r.saleTransactions).toBe(10);
        expect(r.attachmentTransactions).toBe(20);
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

describe('aggregateTestAdmissions - items admitidos a test por pedido', () => {
    it('suma Quantity de todas las filas test del mismo pedido en una sola', () => {
        // Pedido con 3 items a test (uno con Quantity 3) → 1 fila, quantity = 5
        const records = [
            { type: 'test-admission', reference: 'ORD1', category: 'Test', quantity: 1, price: 0 },
            { type: 'test-admission', reference: 'ORD1', category: 'TEST', quantity: 1, price: 0 },
            { type: 'test-admission', reference: 'ORD1', category: 'Test', quantity: 3, price: 0 }
        ];
        const out = aggregateTestAdmissions(records);
        expect(out).toHaveLength(1);
        expect(out[0].reference).toBe('ORD1');
        expect(out[0].quantity).toBe(5);
        expect(out.reduce((a, r) => a + r.quantity, 0)).toBe(5);
    });

    it('mantiene pedidos distintos separados y no toca otras filas', () => {
        const records = [
            { type: 'test-admission', reference: 'A', quantity: 2, price: 0 },
            { type: 'sale', reference: 'A', quantity: 1, price: 100 },
            { type: 'test-admission', reference: 'B', quantity: 1, price: 0 },
            { type: 'test-admission', reference: 'A', quantity: 1, price: 0 }
        ];
        const out = aggregateTestAdmissions(records);
        const test = out.filter(r => r.type === 'test-admission');
        expect(test).toHaveLength(2);                       // A y B
        expect(out.filter(r => r.type === 'sale')).toHaveLength(1); // la venta intacta
        expect(test.find(r => r.reference === 'A').quantity).toBe(3);
        expect(test.find(r => r.reference === 'B').quantity).toBe(1);
    });

    it('regresion W24: total de items se preserva (207, no 133)', () => {
        // Reproduce el caso real: muchas filas test de pocos pedidos, varias por
        // pedido. La suma total de Quantity debe conservarse tras agregar.
        const records = [];
        let total = 0;
        // 30 pedidos, cada uno con 1..5 items (quantity 1 cada fila, salvo algunos)
        for (let o = 0; o < 30; o++) {
            const items = (o % 5) + 1;            // 1..5 filas por pedido
            for (let i = 0; i < items; i++) {
                const q = (i === 0 && o % 7 === 0) ? 3 : 1; // alguna fila con Quantity 3
                records.push({ type: 'test-admission', reference: `ORD${o}`, category: i % 2 ? 'TEST' : 'Test', quantity: q, price: 0 });
                total += q;
            }
        }
        const out = aggregateTestAdmissions(records);
        expect(out).toHaveLength(30);                                   // 1 fila por pedido
        expect(out.reduce((a, r) => a + r.quantity, 0)).toBe(total);    // items preservados
    });

    it('filas sin reference se dejan tal cual (no se agregan)', () => {
        const records = [
            { type: 'test-admission', reference: '', quantity: 1, price: 0 },
            { type: 'test-admission', reference: '', quantity: 1, price: 0 }
        ];
        const out = aggregateTestAdmissions(records);
        expect(out).toHaveLength(2);
    });
});
