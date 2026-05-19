# Spec destructivo — KPI Metrics 2026 (edicion solo-tiendas)

> Estado: **DRAFT, pendiente de aprobacion de Arc**.
> Una vez aprobado, se implementa en el orden de la seccion 14.
> Mientras este como DRAFT, no se toca codigo de la app.

## 0. Contexto y reglas globales

- Repo: `Hexabor/KPIMetrics-Stores`. Bifurcacion completa de `KPITool2026` el 10/05/2026.
- Tag de divergencia: `v1.0-staff` → commit `a8bf564`.
- Objetivo: **eliminar todo rastro del campo Staff** y de las KPIs/UI que lo usaban, dejando una version "solo tiendas" compatible con GDPR. Cero PII en `operations`.
- Enfoque destructivo: **no flag, no rama, no codigo muerto**. Se borra, no se comenta.
- Sin backend: la app sigue siendo HTML/JS estatico. El backend MySQL (sin staff) es fase posterior.
- Identificadores internos heredados (`Dexie('KPITool2026')`, carpeta backup en Drive) **no cambian** — son contratos de datos existentes en el repo padre que aqui se mantienen por compatibilidad. Lo que cambia es el contenido, no la etiqueta.
- Mantra: **no entra staff al modelo de datos** ni siquiera como cadena vacia mapeada. Si entra, los tests de regresion (seccion 8) fallan.

## 1. Decisiones cerradas

Las cuatro decisiones que bloqueaban el spec quedaron resueltas el 10/05/2026 (con una correccion sobre la marcha — ver nota):

- **A2** — Captacion de socios se mantiene a nivel tienda. El importador, el KPI "Socios", el reconciler de aliases y el editor en "Configuracion profunda" siguen ahi. **La columna Staff del CSV se descarta tambien en captacion**: cada socio queda atribuido a (tienda, fecha), sin persona.
- **B2** — Admision a test se mantiene a nivel tienda. Las filas Transfer con categoria "Test" siguen sobreviviendo como `type=test-admission`. Los KPIs `testOrders`, `testItems` y `testRatio` se conservan.
- **DB renombrada** — `Dexie('KPITool2026')` → `Dexie('KPIMetricsStores2026')`. Esto anula la disyuntiva de migracion: la DB nueva no hereda nada, empieza limpia en `v1` sin staff. Arc renuncia explicitamente a los backups del padre (`.json.gz` con staff): no se importan en KPIMetricsStores y por tanto no hay defensa que montar en `importAll`.
- **Roadmap**: la app sigue siendo HTML/JS estatico con Dexie como almacen. Fase siguiente: subida al FTP + dominio + HTTPS. Fase posterior: backend MySQL en ese FTP, schema sin staff, integracion con la app.

> **Nota historica**: en la conversacion inicial Arc confirmo "A1, B1" pensando que se referia a "mantener a nivel tienda". Las etiquetas de las opciones se prestaban a confusion. La implementacion arranco con A1+B1 (eliminacion total) y se corrigio a A2+B2 antes de cualquier commit, sin perdida de trabajo. La unica diferencia tangible respecto a la version del padre con captacion+test-admission es que **el campo Staff se descarta tambien en esas dos ramas** — antes el padre lo conservaba.

## 2. `js/modules/csv-parser.js`

Cambios:

1. **`DEFAULT_MAPPING`**: borrar la entrada `'staff': 'staff'`. El header "Staff" del CSV ya no se reconoce ni produce campo interno.
2. **`CAPTACION_MAPPING` y `ECOM_FIELDS`**:
   - Si A1: borrar `CAPTACION_MAPPING` completo. Eliminar la rama `if (source === 'captacion')` de `detectMapping` y de `mapRecord`.
   - Si A2: borrar solo `'staff': 'staff'` de `CAPTACION_MAPPING`. La rama de mapRecord ya no toca `record.staff`.
3. **`mapRecord` (bloque baby-banking)**:
   - Si B1: restaurar la logica antigua de transfer — `if (record.type === 'transfer') return null;` sin la excepcion `category=Test`. Borrar las lineas 222-232 actuales.
   - Si B2: dejar como esta (el bloque test-admission no depende de staff).
4. **`mapRecord` post-procesado**: dejar de escribir/leer `record.staff`. Como el mapping ya no produce ese campo, no hace falta `delete record.staff` — pero anadir un `delete record.staff;` defensivo justo despues de los demas `delete record.product;` etc., **por si alguien restaura el mapping manualmente desde la UI**. Esto cuesta una linea y blinda contra reintroducir staff por accidente.
5. **Comentarios del header del modulo** (lineas 4-7): actualizar la lista de columnas — Staff queda como **columna descartada explicitamente**, no mapeada. Indicar GDPR.

Tests asociados: ver seccion 8.

## 3. `js/modules/database.js`

Cambios:

1. **Nombre de la DB**: `new Dexie('KPITool2026')` → `new Dexie('KPIMetricsStores2026')`. Esto desacopla la DB de la del padre. En el navegador es un cajon nuevo, sin filas heredadas.
2. **Colapsar v1–v5 en una sola declaracion v1 limpia**. Las cinco versiones acumuladas del padre describian la evolucion historica de un schema que ahora deja de existir. La DB nueva empieza de cero y solo necesita una version:
   ```js
   db.version(1).stores({
       operations: '++id, reference, type, category, date, store, week, channel, source,
                    [store+date], [category+date], [type+date], [type+week]',
       imports: '++id, source, filename, date, rowCount, dateFrom, dateTo, storeCount, stores',
       settings: 'key'
   });
   ```
   Fuera `staff` como campo indexado y fuera los indices compuestos `[staff+date]`, `[staff+week]`. **No hay `upgrade()`** porque no hay version previa de la que migrar (la DB es nueva).
3. **`bulkAddOperations`**: añadir `delete rec.staff;` dentro del bucle. Es la unica defensa que se mantiene: cubre el caso de que alguien añada manualmente `'Staff': 'staff'` al mapping desde la UI o que el parser regrese a importar staff por bug. Coste: una linea.
4. **`importAll(data)`**: **no se toca**. Los unicos backups que existiran son los que esta app exporta, y esta app nunca escribe staff. Si por error se importa un backup del padre, la app no lo va a leer correctamente igualmente (otros campos pueden diverger en futuras versiones); para esos casos Arc usara "Limpiar datos por fuente" o `clearAll()`.
5. **`renormalizeStoresForSource`** y **`replaceOperationsByDateRange`**: eliminar funciones completas y sus exports — solo las usaba el importador de captacion (A1: fuera).
6. **`crossReferenceEcom`** y demas: **no se tocan**. Independientes de staff.

## 4. `js/modules/kpi-engine.js`

Eliminar dos KPIs registrados:

1. **`register('sales-by-staff', ...)`** — borrar completo (lineas 148-168).
2. **`register('mobile-sales-by-staff-week', ...)`** — borrar completo (lineas 170-193).

El resto del modulo no usa `r.staff` ni la palabra staff. `helpers` y la API publica no cambian.

Tests asociados: ver seccion 8.

## 5. `js/app.js`

Bloque mas grande. Cambios:

1. **Mapeo de fuentes** (linea 12): si A1, eliminar `'captacion': 'Captacion de socios'`.
2. **`initStoreSelect('kpi-panel-staff', ...)`** (linea 128) y poblamiento (lineas 444-445): eliminar.
3. **Coverage label** (linea 296): si A1, eliminar `'captacion'` del map.
4. **`addToBucket`** (lineas ~510-580): **rediseño**. Toda la rama `isStaff = attribution === 'staff'` desaparece. El parametro `attribution` ya no necesita existir; siempre se suman EUR. Resultado: la funcion vuelve a la version pre-sesion-9 mas simple, sin la supresion de cash-buy/exchange/refund EUR.
5. **Estructura `emptyBucket()`** (lineas ~485-505): si A1+B1, borrar `memberships`, `testOrders`, `testItems`, `testRatio` del bucket. Si solo B1 (A2 vive): solo borrar los `test*`.
6. **Familia de filtros** (lineas 650-660 aprox.): borrar las entradas `memberships`, `testOrders`, `testItems`, `testRatio` del registro inert/active si A1+B1.
7. **Diccionario de KPIs visibles** (lineas ~880-900): borrar entradas `memberships` y `testRatio` si A1+B1.
8. **Tooltips/descriptions** (lineas ~1150-1160): idem.
9. **`evoState`**:
   - `scope` ya no admite valor `'staff'`. Inicializar `scope: 'store'` y eliminar todo `evoState.scope === 'staff'` (lineas 1056-1059, 1203, 1208, 1256, 1260-1265, 1278, 1313, ...).
   - Eliminar campos `staffWeekData`, `staffStore`, `selectedStaff`. Renombrar `staffWeekData` → `storeWeekData` (o equivalente).
   - Renombrar `selectedStaff` → `selectedRow` (mas neutro). Tambien todos los `dataset.staff` → `dataset.store`.
10. **Renderer de tabla** (lineas ~1457-1610): simplificar — `nameHeader` siempre 'Tienda', `showStore` siempre false. Eliminar la columna "Tienda" duplicada que se muestra solo cuando scope=staff.
11. **Renderer de grafico** (lineas ~1663-1740): mismas simplificaciones.
12. **Importador de captacion** (lineas 1858-2010, todo el bloque `confirmCaptacionImport`, `loadCaptacionAliases`, `loadCaptacionAliasFactory`, `getCaptacionAliasOverrides`, `setCaptacionAliasOverrides`, `makeCaptacionReconciler`, lineas 697-790 y 2378-2549): **eliminar completo** si A1. Si A2, conservar pero quitar `staff` del registro.
13. **Lista de fuentes con orden** (linea 2283): si A1, quitar `'captacion'`.
14. **Vista detalle / filtro inicial** (lineas ~3650-3660): si B1, eliminar `r.type === 'test-admission'`. Si A1+B1, eliminar el `if` completo (ya no quedan tipos especiales a filtrar).

## 6. `index.html`

1. **Header del dashboard** (linea 75): `Vista tienda/empleado` → `Vista por tienda`.
2. **Drop zone captacion** (lineas 231-256): eliminar el bloque completo si A1.
3. **Drop zone attachment** (linea 256, placeholder): eliminar tambien — depende conceptualmente de captacion.
4. **Filtro Data Explorer** (lineas 328-329): si A1, eliminar `<option value="membership">`. Si B1, eliminar `<option value="test-admission">`.
5. **Seccion configuracion aliases** (lineas 376-440 aprox.): eliminar completo si A1.
6. **Comentario** (linea 445): `DASHBOARD: STORE / STAFF` → `DASHBOARD: STORE`.
7. **`<h2>Vista tienda/empleado</h2>`** (linea 448): → `Vista por tienda`.
8. **Optgroup "Captacion"** (lineas 487-489): eliminar si A1.
9. **Opcion `testRatio`** (linea 493): eliminar si B1.
10. **`<option value="staff">Por empleado</option>`** (linea 526): eliminar.
11. **Bloque buscador de staff** (lineas 540-544 + label adjacente del toggle de unificar tiendas): eliminar.
12. **Demas referencias menores** detectadas en grep — barrer una segunda pasada al implementar.

## 7. `js/modules/ui.js`

No se detectan referencias directas a staff/captacion segun el grep. **No requiere cambios** salvo limpieza secundaria si la implementacion descubre helpers que solo se usaban desde codigo eliminado. Marcar como "limpieza oportunista al final".

## 8. `tests/`

### `csv-parser.test.mjs`
1. **Mapping de prueba** (lineas 35-46, 194-205): eliminar `'Staff': 'staff'` de los mappings.
2. **Tests de captacion** (cualquier test que use `subscriptiondate` o `source='captacion'`, lineas ~220-225): eliminar si A1.
3. **Test de regresion NUEVO** (obligatorio): `mapRecord nunca produce campo staff`. Caso minimo:
   ```js
   it('mapRecord descarta Staff aunque venga en el CSV', () => {
       const raw = {
           'Branch': 'Madrid',
           'Staff': 'Ana',           // este header NO esta mapeado, deberia ignorarse
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
   ```
4. **Segundo test de regresion**: incluso si el usuario añade manualmente `'Staff': 'staff'` al mapping (escenario malicioso), `mapRecord` debe eliminarlo. Justifica el `delete record.staff;` defensivo del paso 2.4.

### `kpi-engine.test.mjs`
1. **Fixture data** (lineas 57-62): eliminar la propiedad `staff` de cada objeto.
2. **Test `mobile-sales-by-staff-week`** (lineas 96-111): eliminar completo.
3. **Test de regresion NUEVO**: `KPIEngine.getAll().map(k => k.id)` no contiene ningun KPI con "staff" o "empleado" en su id ni nombre.

## 9. `css/styles.css`

Solo encontrado: `.coverage-bar-captacion` (linea 479). Eliminar si A1.

Limpieza oportunista al final del proyecto para selectores `evo-staff-only` u otros que queden huerfanos tras el barrido de HTML — marcar como pasada final, no critico.

## 10. `package.json`

```json
{
  "name": "kpi-metrics-stores",
  "version": "1.0.0",
  "private": true,
  "description": "Tests para KPI Metrics 2026 - edicion solo tiendas (sin datos de staff, compatible GDPR)",
  ...
}
```

Cambia `name` y `description`. `version` se queda en 1.0.0 (es la 1.0 de esta nueva linea).

## 11. `CLAUDE.md`

Cambios:

1. **Bloque inicial**: reemplazar la nota actual ("Nombre interno (DB Dexie...) se mantiene como 'KPITool2026' por compatibilidad...") por: "Edicion solo-tiendas (GDPR), derivada de KPITool2026. DB Dexie renombrada a `KPIMetricsStores2026` — la DB del padre no se hereda, los backups generados desde el padre no son compatibles con esta version y no deben importarse. El nombre visible de la app es 'KPI Metrics 2026 - Stores'."
2. **Seccion "Campos almacenados"**: quitar `staff` de la lista de campos guardados. Añadir nota: "El campo `staff` se descarta deliberadamente al importar para cumplir GDPR. No debe reintroducirse bajo ninguna forma (hash, alias, ni cadena vacia mapeada)."
3. **Fuentes de importacion**: dejar solo `baby-banking`, `baby-banking-ic`, `ecom`. Quitar `captacion`, `attachment`.
4. **Transfer Test**: quitar la nota — vuelve a la logica simple "transfer se descarta siempre".
5. **Nueva subseccion "Bifurcacion"**: una frase indicando que el repo es la version solo-tiendas y que el padre (`KPITool2026`) sigue siendo la version completa con staff. Apuntar a `docs/spec-stores-edition.md` como referencia historica del barrido.
6. **Roadmap (opcional)**: mencion breve a las dos fases siguientes — subida al FTP y backend MySQL — para que un agente futuro tenga el norte.

## 12. `README.md`

Crear nuevo. Contenido minimo:

- Que es: KPI Metrics 2026 edicion solo-tiendas.
- Por que existe: cumplir GDPR para escenarios donde se quiere compartir la herramienta con terceros (corporativo, otras tiendas) sin exponer nombres de empleados.
- Relacion con el padre: enlace al repo `KPITool2026` como version completa interna.
- Stack: igual que el padre. Apuntar al CLAUDE.md.
- Como contribuir / como reportar bugs: pendiente.

## 13. Pre-commit hook

El hook `.git/hooks/pre-commit` del padre **no esta versionado** (es local). Replicarlo manualmente en la primera sesion de implementacion **antes** del primer commit destructivo. Para hacerlo facil: copiarlo del padre.

Comando concreto (a ejecutar manualmente al empezar la implementacion):
```
copy "..\KPITool2026\.git\hooks\pre-commit" ".git\hooks\pre-commit"
```

(Ajustar ruta segun donde tenga Arc clonado el padre.)

## 14. `js/changelog.js`

Añadir entrada como item mas reciente. Texto propuesto:

```
{
    date: '10/05/2026 (sesion 1)',
    items: [
        { type: 'new', text: 'Bifurcacion: KPI Metrics 2026 edicion solo-tiendas (repo aparte: KPIMetrics-Stores). Version derivada de KPITool2026 que descarta el campo Staff del CSV y elimina toda la vista por empleado, los KPIs por staff y los importadores que solo tenian sentido a nivel persona (captacion, attachment, admision a test). Cumple GDPR: la base de datos local nunca contiene identificadores de empleado. El identificador interno de Dexie sigue siendo KPITool2026 por compatibilidad con backups exportados desde el repo padre' },
    ]
}
```

Esto va como bloque mas arriba en el array.

## 15. Orden de implementacion seguro

Cuando Arc apruebe el spec:

1. **Pre-commit hook** (paso 13). Antes de cualquier commit.
2. **Tests primero** (seccion 8). Cambiar los tests asi de modo que **fallen** contra el codigo actual — son la diana de la cirugia. Commit: "tests: regresiones de no-staff (fallaran hasta el barrido)".
3. **Parser** (seccion 2). Tests de parser pasan. Commit: "csv-parser: descartar Staff y limpiar fuentes muertas".
4. **KPI engine** (seccion 4). Tests de engine pasan. Commit: "kpi-engine: quitar KPIs por staff".
5. **Database** (seccion 3: rename Dexie a `KPIMetricsStores2026`, colapsar versiones a una v1 limpia sin staff). Probar manualmente importando un CSV pequeño en navegador limpio. Commit: "database: rename to KPIMetricsStores2026, fresh schema without staff".
6. **app.js + index.html + ui.js + css** (secciones 5-7, 9). Es el cambio mas grande. Hacerlo en una sola pasada porque las referencias estan entrelazadas. Probar manualmente en navegador (importar CSV, navegar todas las pestañas, comprobar que no quedan controles muertos). Commit: "app/ui: eliminar Vista empleado y captacion".
7. **Metadata y docs** (secciones 10-12, 14). Commit: "docs: rebrand stores edition, README, CLAUDE, changelog".
8. **Smoke final**: cargar `index.html` en navegador limpio (sin Dexie previo). Importar Baby Banking ES + IC reales. Recorrer todas las pestañas. Verificar que no aparece la palabra "staff" / "empleado" en la UI. Verificar que `getAllOperations()` no tiene `staff` en ninguna fila.
9. **Tag**: `v1.0-stores`.

## 16. Lista de chequeo final (smoke test)

- [ ] No existe `r.staff` en ninguna fila de Dexie tras importar.
- [ ] No existe `dataset.staff` en el DOM.
- [ ] No existe optgroup, KPI o seleccion con la palabra "staff" o "empleado".
- [ ] `KPIEngine.getAll()` no devuelve KPIs con id que contenga `staff`.
- [ ] El parser ignora silenciosamente la columna `Staff` del CSV (no produce warning, no crashea).
- [ ] Test de regresion (8.csv-parser.4) pasa: aunque alguien añada `'Staff':'staff'` al mapping, el record final no contiene staff.
- [ ] La DB de Dexie en DevTools se llama `KPIMetricsStores2026`, no `KPITool2026`.
- [ ] Cobertura visual: barras de fuentes muestran solo `baby-banking`, `baby-banking-ic`, `ecom`.
- [ ] CLAUDE.md y README explican la GDPR.

---

**Decisiones cerradas. Pendiente: aprobacion explicita de Arc para empezar la implementacion (paso 1 de la seccion 15).**
