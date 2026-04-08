/**
 * KPI Tool 2026 - Main Application Controller
 */
const App = (() => {
    let currentPreviewData = null;
    let currentImportSource = 'baby-banking';

    const SOURCE_LABELS = {
        'baby-banking': 'Baby Banking ES',
        'ecom': 'Ecom Sales',
        'attachment': 'Attachment',
        'captacion': 'Captacion'
    };


    async function init() {
        try {
            Database.init();

            // Load saved settings
            const savedMapping = await Database.getSetting('columnMapping');
            if (savedMapping) CSVParser.setMapping(savedMapping);

            const savedCourseStart = await Database.getSetting('courseStartDate');
            if (savedCourseStart) {
                KPIEngine.setCourseStart(savedCourseStart);
                const el = document.getElementById('course-start-date');
                if (el) el.value = UI.formatDate(savedCourseStart);
            }

            // Drive (non-blocking)
            const driveClientId = await Database.getSetting('driveClientId');
            const driveApiKey = await Database.getSetting('driveApiKey');
            if (driveClientId) DriveSync.init(driveClientId, driveApiKey);
        } catch (e) {
            console.error('Init settings error (non-fatal):', e);
        }

        bindEvents();

        try {
            await refreshHome();
        } catch (e) {
            console.error('Init refreshHome error:', e);
        }

        updateGreeting();
        updateTopbarWeek();

        console.log('KPI Tool 2026 initialized');
    }

    // ============================
    // EVENT BINDING
    // ============================
    function bindEvents() {
        // Sidebar navigation
        document.querySelectorAll('.sidebar-btn').forEach(btn => {
            btn.addEventListener('click', () => navigateTo(btn.dataset.section));
        });

        // Home card actions
        document.querySelectorAll('[data-action]').forEach(el => {
            el.addEventListener('click', () => handleAction(el.dataset.action));
        });

        // CSV import: each drop zone is its own source
        document.querySelectorAll('.import-zone:not(.disabled)').forEach(zone => {
            const input = zone.querySelector('input[type="file"]');
            const source = zone.dataset.source;

            zone.addEventListener('click', () => input.click());
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                if (e.dataTransfer.files[0]) {
                    currentImportSource = source;
                    handleFileSelected(e.dataTransfer.files[0]);
                }
            });
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('change', (e) => {
                if (e.target.files[0]) {
                    currentImportSource = source;
                    handleFileSelected(e.target.files[0]);
                }
                e.target.value = '';
            });
        });

        document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);
        document.getElementById('btn-cancel-import').addEventListener('click', () => {
            currentPreviewData = null;
            UI.hidePreview();
        });

        // Data explorer toggle
        document.getElementById('btn-toggle-explorer').addEventListener('click', toggleDataExplorer);
        document.getElementById('data-search').addEventListener('input', debounce(loadDataExplorer, 300));
        document.getElementById('data-filter-type').addEventListener('change', loadDataExplorer);
        document.getElementById('data-pagination').addEventListener('click', (e) => {
            if (e.target.dataset.page) loadDataExplorer(parseInt(e.target.dataset.page));
        });

        // Store selects (searchable)
        initStoreSelect('home-summary-store', 'home-summary-store-list', refreshHomeSummary);
        initStoreSelect('kpi-panel-store', 'kpi-panel-store-list', refreshEvolution);

        // Home summary filters
        document.getElementById('home-summary-period').addEventListener('change', refreshHomeSummary);

        // KPI Mobiles filters
        document.getElementById('evo-week-from').addEventListener('change', refreshEvolution);
        document.getElementById('evo-week-to').addEventListener('change', refreshEvolution);
        document.getElementById('evo-metric').addEventListener('change', refreshEvolution);
        document.getElementById('evo-scope').addEventListener('change', refreshEvolution);

        // Top N + ecom filter + chart toggle
        document.getElementById('evo-top-n').addEventListener('change', refreshEvolution);
        document.getElementById('evo-exclude-ecom')?.addEventListener('change', refreshEvolution);
        document.getElementById('btn-toggle-chart').addEventListener('click', toggleEvoChart);

        // Changelog
        document.getElementById('btn-changelog').addEventListener('click', openChangelog);
        document.getElementById('btn-changelog-close').addEventListener('click', closeChangelog);
        document.getElementById('changelog-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeChangelog();
        });

        // JSON import
        document.getElementById('json-input').addEventListener('change', handleJsonImport);

        // Settings
        document.getElementById('btn-reset-tool').addEventListener('click', resetTool);
        document.getElementById('btn-save-course-start').addEventListener('click', saveCourseStart);
    }

    function handleAction(action) {
        switch (action) {
            case 'go-home': navigateTo('home'); break;
            case 'go-import': navigateTo('import'); break;
            case 'go-settings': navigateTo('settings'); break;
            case 'go-kpi-mobiles': navigateTo('kpi-mobiles'); break;
            case 'export-json': exportData(); break;
            case 'import-json': document.getElementById('json-input').click(); break;
            case 'drive-sync': syncDrive(); break;
        }
    }

    // ============================
    // NAVIGATION
    // ============================
    function navigateTo(sectionId) {
        document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
        document.getElementById(`section-${sectionId}`).classList.remove('hidden');

        document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
        const sidebarBtn = document.querySelector(`.sidebar-btn[data-section="${sectionId}"]`);
        if (sidebarBtn) sidebarBtn.classList.add('active');

        if (sectionId === 'home') refreshHome();
        if (sectionId === 'import') { renderImportHistory(); renderEcomTimeline(); }
        if (sectionId === 'settings') loadSettings();
        if (sectionId === 'kpi-mobiles') refreshKPIMobiles();
    }

    // ============================
    // GREETING & TOPBAR
    // ============================
    function updateGreeting() {
        const h = new Date().getHours();
        let greeting = 'Buenas noches';
        if (h >= 6 && h < 14) greeting = 'Buenos dias';
        else if (h >= 14 && h < 21) greeting = 'Buenas tardes';
        document.getElementById('home-greeting-text').textContent = greeting;
    }

    function updateTopbarWeek() {
        const today = new Date().toISOString().substring(0, 10);
        const wk = KPIEngine.helpers.businessWeek(today);
        document.getElementById('topbar-week').textContent = `Semana ${wk}`;
        document.getElementById('home-week-num').textContent = wk;
    }

    // ============================
    // HOME: Refresh all
    // ============================
    async function refreshHome() {
        const count = await Database.getRecordCount();
        document.getElementById('db-status-badge').textContent = `DB: ${count.toLocaleString()}`;

        // Last import
        const imports = await Database.getImportHistory();
        document.getElementById('home-last-import').textContent =
            imports.length > 0 ? UI.formatDate(imports[0].date) : 'Ninguna';

        // Store name from data
        const stores = await Database.getDistinctValues('store');
        document.getElementById('home-store-name').textContent =
            stores.length === 1 ? stores[0] : (stores.length > 1 ? `${stores.length} tiendas` : '--');

        // Populate store filters
        populateStoreSelect('home-summary-store', stores);

        updateTopbarWeek();
        await refreshHomeSummary();
    }

    // ============================
    // SEARCHABLE STORE SELECT
    // ============================
    const storeSelects = {};

    function initStoreSelect(inputId, listId, onChange) {
        const input = document.getElementById(inputId);
        const list = document.getElementById(listId);
        const state = { stores: [], value: 'all', onChange };
        storeSelects[inputId] = state;

        input.addEventListener('focus', () => {
            renderStoreList(inputId);
            list.classList.add('open');
        });

        input.addEventListener('input', () => {
            renderStoreList(inputId);
            list.classList.add('open');
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { list.classList.remove('open'); input.blur(); }
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !list.contains(e.target)) {
                list.classList.remove('open');
                // If text doesn't match a store, reset to current
                syncInputDisplay(inputId);
            }
        });
    }

    function renderStoreList(inputId) {
        const state = storeSelects[inputId];
        const input = document.getElementById(inputId);
        const list = document.getElementById(inputId + '-list');
        const filter = input.value.toLowerCase();

        const options = [{ value: 'all', label: 'Todas las tiendas' }];
        for (const s of state.stores) {
            options.push({ value: s, label: s });
        }

        const filtered = options.filter(o => o.label.toLowerCase().includes(filter));

        list.innerHTML = filtered.map(o =>
            `<div class="search-select-option" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`
        ).join('');

        list.querySelectorAll('.search-select-option').forEach(opt => {
            opt.addEventListener('mousedown', (e) => {
                e.preventDefault();
                state.value = opt.dataset.value;
                syncInputDisplay(inputId);
                list.classList.remove('open');
                if (state.onChange) state.onChange();
            });
        });
    }

    function syncInputDisplay(inputId) {
        const state = storeSelects[inputId];
        const input = document.getElementById(inputId);
        input.value = state.value === 'all' ? '' : state.value;
        input.placeholder = state.value === 'all' ? 'Todas las tiendas' : state.value;
    }

    function populateStoreSelect(inputId, stores) {
        const state = storeSelects[inputId];
        if (!state) return;
        state.stores = stores;
        syncInputDisplay(inputId);
    }

    function getStoreValue(inputId) {
        const state = storeSelects[inputId];
        return state ? state.value : 'all';
    }

    // ============================
    // HOME: Summary panel
    // ============================
    /**
     * Compute date range for a period selector value.
     * Uses UTC arithmetic to avoid DST issues.
     */
    function getPeriodDateRange(periodValue) {
        const today = new Date().toISOString().substring(0, 10);
        const currentWeek = KPIEngine.helpers.businessWeek(today);
        const courseStart = KPIEngine.getCourseStart();
        const cs = courseStart.split('-');
        const startMs = Date.UTC(cs[0], cs[1] - 1, cs[2]);

        if (periodValue === 'all') return { dateFrom: null, dateTo: null, label: 'Todos los datos' };

        let fromWeek, toWeek;
        if (periodValue === 'current-week') {
            fromWeek = currentWeek;
            toWeek = currentWeek;
        } else if (periodValue === 'last-week') {
            fromWeek = currentWeek - 1;
            toWeek = currentWeek - 1;
        } else if (periodValue === 'last-4') {
            fromWeek = currentWeek - 3;
            toWeek = currentWeek;
        }

        const fromMs = startMs + (fromWeek - 1) * 7 * 86400000;
        const toMs = startMs + toWeek * 7 * 86400000 - 86400000;
        const fromDate = new Date(fromMs).toISOString().substring(0, 10);
        const toDate = new Date(toMs).toISOString().substring(0, 10);

        return {
            dateFrom: fromDate,
            dateTo: toDate,
            label: fromWeek === toWeek
                ? `Semana ${fromWeek} (${UI.formatDate(fromDate)} - ${UI.formatDate(toDate)})`
                : `Semanas ${fromWeek}-${toWeek} (${UI.formatDate(fromDate)} - ${UI.formatDate(toDate)})`
        };
    }

    async function refreshHomeSummary() {
        const periodValue = document.getElementById('home-summary-period').value;
        const store = getStoreValue('home-summary-store');
        const range = getPeriodDateRange(periodValue);

        const filters = { store: store };
        if (range.dateFrom) {
            filters.dateFrom = range.dateFrom;
            filters.dateTo = range.dateTo;
        }

        const data = await Database.getOperationsForKPI(filters);

        // Filter by date range if needed (getOperationsForKPI only uses one where clause)
        let filtered = data;
        if (range.dateFrom) {
            filtered = data.filter(r => r.date >= range.dateFrom && r.date <= range.dateTo);
        }
        if (store && store !== 'all') {
            filtered = filtered.filter(r => r.store === store);
        }

        const sales = filtered.filter(r => r.type === 'sale');
        const buys = filtered.filter(r => r.type === 'cash buy');
        const exchanges = filtered.filter(r => r.type === 'exchange');
        const rma = filtered.filter(r => r.type === 'rma');

        const salesTotal = sales.reduce((s, r) => s + (r.total || 0), 0);
        const buysTotal = buys.reduce((s, r) => s + (r.total || 0), 0);

        document.getElementById('summary-sales').textContent = sales.length.toLocaleString();
        document.getElementById('summary-sales-total').textContent = formatCurrency(salesTotal);
        document.getElementById('summary-buys').textContent = buys.length.toLocaleString();
        document.getElementById('summary-buys-total').textContent = formatCurrency(buysTotal);
        document.getElementById('summary-exchanges').textContent = exchanges.length.toLocaleString();
        document.getElementById('summary-rma').textContent = rma.length.toLocaleString();
        document.getElementById('summary-date-range').textContent = range.label;
    }

    // ============================
    // KPI PANEL (sortable, multi-KPI ready)
    // ============================
    async function refreshKPIMobiles() {
        const stores = await Database.getDistinctValues('store');
        populateStoreSelect('kpi-panel-store', stores);

        const today = new Date().toISOString().substring(0, 10);
        const currentWeek = KPIEngine.helpers.businessWeek(today);
        const fromEl = document.getElementById('evo-week-from');
        const toEl = document.getElementById('evo-week-to');

        const savedFrom = await Database.getSetting('evoWeekFrom');
        const savedTo = await Database.getSetting('evoWeekTo');
        if (savedFrom && savedTo) {
            fromEl.value = savedFrom;
            toEl.value = savedTo;
        } else if (parseInt(toEl.value) < 2) {
            fromEl.value = Math.max(1, currentWeek - 3);
            toEl.value = currentWeek;
        }

        refreshEvolution();
    }

    function formatPct(val) {
        const cls = val > 40 ? 'pct-good' : val >= 30 ? 'pct-ok' : 'pct-low';
        return `<span class="pct-cell ${cls}">${val}%</span>`;
    }

    function formatPctDetail(numerator, denominator) {
        if (denominator <= 0) return '--';
        const pct = Math.round((numerator / denominator) * 100);
        const cls = pct > 40 ? 'pct-good' : pct >= 30 ? 'pct-ok' : 'pct-low';
        return `<span class="pct-cell ${cls}">${pct}%</span> <small class="pct-units">${numerator}/${denominator}</small>`;
    }

    // ============================
    // EVOLUTION TABLE
    // ============================
    let evoState = {
        staffWeekData: {},
        weeks: [],
        scope: 'staff',
        metric: 'mobiles',
        sortCol: null,
        sortDir: 'desc',
        selectedStaff: null  // clicked row for chart highlight
    };

    async function refreshEvolution() {
        const weekFrom = parseInt(document.getElementById('evo-week-from').value) || 1;
        const weekTo = parseInt(document.getElementById('evo-week-to').value) || weekFrom;
        evoState.metric = document.getElementById('evo-metric').value;
        evoState.scope = document.getElementById('evo-scope').value;
        const store = getStoreValue('kpi-panel-store');

        // Persist week range
        await Database.setSetting('evoWeekFrom', weekFrom);
        await Database.setSetting('evoWeekTo', weekTo);

        // Week range label
        const courseStart = KPIEngine.getCourseStart();
        const cs = courseStart.split('-');
        const startMs = Date.UTC(cs[0], cs[1] - 1, cs[2]);
        const fromDate = new Date(startMs + (weekFrom - 1) * 7 * 86400000).toISOString().substring(0, 10);
        const toDate = new Date(startMs + weekTo * 7 * 86400000 - 86400000).toISOString().substring(0, 10);
        document.getElementById('kpi-panel-week-range').textContent =
            weekFrom === weekTo
                ? `Semana ${weekFrom} (${UI.formatDate(fromDate)} - ${UI.formatDate(toDate)})`
                : `Semanas ${weekFrom}-${weekTo} (${UI.formatDate(fromDate)} - ${UI.formatDate(toDate)})`;

        // Reset sort on data change
        evoState.sortCol = null;
        evoState.sortDir = 'desc';

        evoState.weeks = [];
        for (let w = weekFrom; w <= weekTo; w++) evoState.weeks.push(w);

        if (evoState.weeks.length === 0 || evoState.weeks.length > 52) {
            document.getElementById('evo-tbody').innerHTML =
                '<tr><td class="empty-msg">Rango de semanas no valido.</td></tr>';
            return;
        }

        const allData = await Database.getOperationsForKPI({});
        let sales = allData.filter(r => r.type === 'sale');
        if (store && store !== 'all') {
            sales = sales.filter(r => r.store === store);
        }
        const excludeEcom = document.getElementById('evo-exclude-ecom')?.checked;
        if (excludeEcom) {
            sales = sales.filter(r => r.channel !== 'ecom');
        }

        evoState.staffWeekData = {};
        for (const r of sales) {
            const wk = r.week;
            if (wk < weekFrom || wk > weekTo) continue;

            const name = evoState.scope === 'total' ? 'Total tienda' : (r.staff || 'N/A');
            const catLower = (r.category || '').toLowerCase();
            const qty = r.quantity || 0;

            if (!evoState.staffWeekData[name]) evoState.staffWeekData[name] = {};
            if (!evoState.staffWeekData[name][wk]) evoState.staffWeekData[name][wk] = { mobiles: 0, mobilesTotal: 0, services: 0, basics: 0 };

            const cell = evoState.staffWeekData[name][wk];
            if (catLower.includes('moviles')) { cell.mobiles += qty; cell.mobilesTotal += (r.total || 0); }
            if (catLower.includes('services')) { cell.services += qty; }
            if (catLower.includes('basics')) { cell.basics += qty; }
        }

        renderEvolution();
    }

    function sortEvolution(col) {
        if (evoState.sortCol === col) {
            evoState.sortDir = evoState.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            evoState.sortCol = col;
            evoState.sortDir = 'desc';
        }
        renderEvolution();
        // Re-rank chart if visible
        if (!document.getElementById('evo-chart-section').classList.contains('collapsed')) {
            renderEvoChart();
        }
    }

    function evoSortValue(name, col, metric, weeks) {
        const wd = evoState.staffWeekData[name];
        if (col === 'name') return name.toLowerCase();
        // Get cell data for a specific week or total
        let cellData;
        if (col === 'total') {
            cellData = { mobiles: 0, mobilesTotal: 0, services: 0, basics: 0 };
            for (const wk of weeks) { const c = wd?.[wk]; if (c) { cellData.mobiles += c.mobiles; cellData.mobilesTotal += c.mobilesTotal; cellData.services += c.services; cellData.basics += c.basics; } }
        } else {
            cellData = wd?.[col] || { mobiles: 0, mobilesTotal: 0, services: 0, basics: 0 };
        }
        const m = cellData.mobiles, s = cellData.services, b = cellData.basics;
        if (metric === 'pctServices') return m > 0 ? s / m : -1;
        if (metric === 'pctBasics') return m > 0 ? b / m : -1;
        if (metric === 'pctCombo') return m > 0 ? (s + b) / m : -1;
        if (metric === 'mobilesTotal') return cellData.mobilesTotal;
        return cellData[metric] || 0;
    }

    function evoCellValue(cellData, metricKey) {
        if (!cellData) {
            if (metricKey.startsWith('pct')) return '--';
            if (metricKey === 'mobilesTotal') return formatCurrency(0);
            return '0';
        }
        const m = cellData.mobiles, s = cellData.services, b = cellData.basics;
        if (metricKey === 'pctServices') return formatPctDetail(s, m);
        if (metricKey === 'pctBasics') return formatPctDetail(b, m);
        if (metricKey === 'pctCombo') return formatPctDetail(s + b, m);
        if (metricKey === 'mobilesTotal') return formatCurrency(cellData.mobilesTotal);
        return cellData[metricKey] || 0;
    }

    function evoRowTotal(weekData, metricKey, weeks) {
        let sumM = 0, sumS = 0, sumB = 0, sumMT = 0;
        for (const wk of weeks) {
            const c = weekData[wk]; if (!c) continue;
            sumM += c.mobiles; sumS += c.services; sumB += c.basics; sumMT += c.mobilesTotal;
        }
        if (metricKey === 'pctServices') return formatPctDetail(sumS, sumM);
        if (metricKey === 'pctBasics') return formatPctDetail(sumB, sumM);
        if (metricKey === 'pctCombo') return formatPctDetail(sumS + sumB, sumM);
        if (metricKey === 'mobilesTotal') return formatCurrency(sumMT);
        if (metricKey === 'mobiles') return sumM;
        if (metricKey === 'services') return sumS;
        if (metricKey === 'basics') return sumB;
        return 0;
    }

    function renderEvolution() {
        const { staffWeekData, weeks, scope, metric, sortCol, sortDir } = evoState;
        const thead = document.getElementById('evo-thead');
        const tbody = document.getElementById('evo-tbody');
        const tfoot = document.getElementById('evo-tfoot');

        const sortCls = (col) => {
            if (sortCol !== col) return '';
            return sortDir === 'desc' ? ' sort-desc' : ' sort-asc';
        };

        thead.innerHTML = `<tr>
            <th class="sortable${sortCls('name')}" data-evo-sort="name">${scope === 'total' ? '' : 'Empleado'}</th>
            ${weeks.map(w => `<th class="sortable${sortCls(w)}" data-evo-sort="${w}">W${w}</th>`).join('')}
            <th class="sortable col-total${sortCls('total')}" data-evo-sort="total"><strong>Total</strong></th>
        </tr>`;

        // Bind sort clicks
        thead.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.evoSort;
                sortEvolution(col === 'name' || col === 'total' ? col : parseInt(col));
            });
        });

        let staffNames = Object.keys(staffWeekData);

        if (staffNames.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${weeks.length + 2}" class="empty-msg">Sin datos para estas semanas.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        // Sort: default by total desc, or by clicked column
        const rankCol = sortCol || 'total';
        const rankDir = sortCol ? sortDir : 'desc';
        staffNames.sort((a, b) => {
            const va = evoSortValue(a, rankCol, metric, weeks);
            const vb = evoSortValue(b, rankCol, metric, weeks);
            if (typeof va === 'string') return rankDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return rankDir === 'asc' ? va - vb : vb - va;
        });

        // Apply top-n filter
        const topNVal = document.getElementById('evo-top-n').value;
        if (topNVal !== 'all') {
            staffNames = staffNames.slice(0, parseInt(topNVal));
        }

        tbody.innerHTML = staffNames.map(name => {
            const wd = staffWeekData[name];
            const selected = evoState.selectedStaff === name ? ' class="evo-row-selected"' : '';
            return `<tr${selected} data-staff="${escapeHtml(name)}">
                <td>${escapeHtml(name)}</td>
                ${weeks.map(w => `<td>${evoCellValue(wd?.[w], metric)}</td>`).join('')}
                <td class="col-total"><strong>${evoRowTotal(wd || {}, metric, weeks)}</strong></td>
            </tr>`;
        }).join('');

        if (scope === 'staff' && staffNames.length > 1) {
            const colTotals = {};
            for (const w of weeks) {
                colTotals[w] = { mobiles: 0, mobilesTotal: 0, services: 0, basics: 0 };
                for (const name of staffNames) {
                    const c = staffWeekData[name]?.[w]; if (!c) continue;
                    colTotals[w].mobiles += c.mobiles; colTotals[w].mobilesTotal += c.mobilesTotal;
                    colTotals[w].services += c.services; colTotals[w].basics += c.basics;
                }
            }
            tfoot.innerHTML = `<tr data-staff="__TOTAL__">
                <td>TOTAL</td>
                ${weeks.map(w => `<td><strong>${evoCellValue(colTotals[w], metric)}</strong></td>`).join('')}
                <td class="col-total"><strong>${evoRowTotal(colTotals, metric, weeks)}</strong></td>
            </tr>`;
        } else {
            tfoot.innerHTML = '';
        }

        // Click any row (staff or total) to select for chart
        function selectRow(name, tr) {
            evoState.selectedStaff = evoState.selectedStaff === name ? null : name;
            // Update highlight across both tbody and tfoot
            const table = document.getElementById('evo-table');
            table.querySelectorAll('tr').forEach(r => r.classList.remove('evo-row-selected'));
            if (evoState.selectedStaff) tr.classList.add('evo-row-selected');
            // Open chart if collapsed, then render
            const section = document.getElementById('evo-chart-section');
            if (section.classList.contains('collapsed')) {
                section.classList.remove('collapsed');
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    try { renderEvoChart(); } catch(e) { console.error('Chart error:', e); }
                }));
            } else {
                try { renderEvoChart(); } catch(e) { console.error('Chart error:', e); }
            }
        }

        document.querySelectorAll('#evo-table tr[data-staff]').forEach(tr => {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => selectRow(tr.dataset.staff, tr));
        });

        // Refresh chart if visible
        if (!document.getElementById('evo-chart-section').classList.contains('collapsed')) {
            renderEvoChart();
        }
    }

    // ============================
    // EVOLUTION CHART
    // ============================
    let evoChartInstance = null;

    const CHART_METRIC_INFO = {
        pctServices: 'Porcentaje de geles (Services)\nvendidos por movil.\n\nNumerador: lineas Services\nDenominador: lineas Moviles',
        pctBasics: 'Porcentaje de CeX Basics\nvendidos por movil.\n\nNumerador: lineas Basics\nDenominador: lineas Moviles',
        pctCombo: 'Porcentaje combinado de\ngeles + basics por movil.\n\nNumerador: Services + Basics\nDenominador: lineas Moviles',
        mobiles: 'Unidades de moviles vendidos\n(lineas con categoria "Moviles")',
        mobilesTotal: 'Importe total de moviles vendidos',
        services: 'Unidades de Services vendidos\n(lineas con categoria "Services")',
        basics: 'Unidades de CeX Basics vendidos\n(lineas con categoria "basics")'
    };

    function toggleEvoChart() {
        const section = document.getElementById('evo-chart-section');
        const isCollapsed = section.classList.contains('collapsed');
        if (isCollapsed) {
            section.classList.remove('collapsed');
            // Double rAF: first to apply display change, second to let layout compute
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try { renderEvoChart(); }
                    catch (e) { console.error('Chart render error:', e); }
                });
            });
        } else {
            section.classList.add('collapsed');
        }
    }

    function renderEvoChart() {
        if (typeof Chart === 'undefined') {
            console.error('Chart.js not loaded');
            return;
        }

        const chartMetric = evoState.metric;
        const { staffWeekData, weeks, scope } = evoState;

        document.getElementById('evo-chart-info').title = CHART_METRIC_INFO[chartMetric] || '';

        const canvas = document.getElementById('evo-chart');
        if (!canvas) { console.error('Canvas not found'); return; }

        if (evoChartInstance) {
            evoChartInstance.destroy();
            evoChartInstance = null;
        }

        const allStaff = Object.keys(staffWeekData);
        if (weeks.length === 0 || allStaff.length === 0) return;

        // Ensure canvas has dimensions
        const container = canvas.parentElement;
        if (container.offsetHeight === 0) {
            console.warn('Chart container has no height, skipping render');
            return;
        }

        // Align chart dots to the CENTER of each week column
        // Reserve space for Y-axis labels in the employee column
        const Y_AXIS_WIDTH = 36;
        const table = document.getElementById('evo-table');
        const headerCells = table?.querySelectorAll('thead th');
        if (headerCells && headerCells.length > 2) {
            const firstWeekTh = headerCells[1];
            const lastWeekTh = headerCells[headerCells.length - 2];
            const panelRect = container.parentElement.getBoundingClientRect();
            const firstRect = firstWeekTh.getBoundingClientRect();
            const lastRect = lastWeekTh.getBoundingClientRect();

            // Center of first week column and center of last week column
            const firstCenter = firstRect.left + firstRect.width / 2 - panelRect.left;
            const lastCenter = lastRect.left + lastRect.width / 2 - panelRect.left;
            const rightMargin = panelRect.width - lastCenter;

            // Shift left to make room for Y-axis labels (they sit in the employee column)
            container.style.marginLeft = (firstCenter - Y_AXIS_WIDTH) + 'px';
            container.style.marginRight = rightMargin + 'px';
        }

        const labels = weeks.map(w => `W${w}`);
        const isPct = chartMetric.startsWith('pct');
        const topNVal = document.getElementById('evo-top-n').value;
        const showTotal = scope === 'total' || allStaff.length === 1;
        const maxLines = topNVal === 'all' ? 999 : parseInt(topNVal) || 999;

        const colors = [
            '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
            '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1',
            '#be123c', '#0d9488', '#c026d3', '#ca8a04', '#475569'
        ];

        let datasets;

        // If a row is selected, show that line (+ total as context if it's a staff)
        const selected = evoState.selectedStaff;
        if (selected === '__TOTAL__' || (showTotal && !selected)) {
            // Show total line
            const data = weeks.map(w => {
                let m = 0, s = 0, b = 0, mt = 0;
                for (const name of allStaff) {
                    const c = staffWeekData[name]?.[w]; if (!c) continue;
                    m += c.mobiles; s += c.services; b += c.basics; mt += c.mobilesTotal;
                }
                return evoChartValue({ mobiles: m, services: s, basics: b, mobilesTotal: mt }, chartMetric);
            });
            datasets = [{ label: 'Total', data, borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 4 }];
        } else if (selected && staffWeekData[selected] && !showTotal) {
            const selData = weeks.map(w => evoChartValue(staffWeekData[selected]?.[w], chartMetric));
            const totalData = weeks.map(w => {
                let m = 0, s = 0, b = 0, mt = 0;
                for (const name of allStaff) {
                    const c = staffWeekData[name]?.[w]; if (!c) continue;
                    m += c.mobiles; s += c.services; b += c.basics; mt += c.mobilesTotal;
                }
                return evoChartValue({ mobiles: m, services: s, basics: b, mobilesTotal: mt }, chartMetric);
            });
            datasets = [
                { label: selected.split(' ').slice(0, 2).join(' '), data: selData, borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 5, borderWidth: 3 },
                { label: 'Total tienda', data: totalData, borderColor: '#94a3b8', backgroundColor: 'transparent', tension: 0.3, pointRadius: 3, borderWidth: 1.5, borderDash: [4, 3] }
            ];
        } else if (showTotal) {
            const data = weeks.map(w => {
                let m = 0, s = 0, b = 0, mt = 0;
                for (const name of allStaff) {
                    const c = staffWeekData[name]?.[w]; if (!c) continue;
                    m += c.mobiles; s += c.services; b += c.basics; mt += c.mobilesTotal;
                }
                return evoChartValue({ mobiles: m, services: s, basics: b, mobilesTotal: mt }, chartMetric);
            });
            datasets = [{ label: 'Total', data, borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 4 }];
        } else {
            const rankCol = evoState.sortCol || 'total';
            const ranked = allStaff
                .map(name => ({ name, val: evoSortValue(name, rankCol, chartMetric, weeks) }))
                .sort((a, b) => b.val - a.val)
                .slice(0, maxLines);

            datasets = ranked.map(({ name }, i) => ({
                label: name.split(' ').slice(0, 2).join(' '),
                data: weeks.map(w => evoChartValue(staffWeekData[name]?.[w], chartMetric)),
                borderColor: colors[i % colors.length],
                backgroundColor: colors[i % colors.length] + '15',
                tension: 0.3,
                pointRadius: 3,
                borderWidth: 2
            }));
        }

        evoChartInstance = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: 0 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: datasets.length > 1 && datasets.length <= 10,
                        position: 'bottom',
                        labels: { font: { size: 10 }, boxWidth: 12, padding: 8 }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                const val = ctx.parsed.y;
                                return `${ctx.dataset.label}: ${isPct ? val + '%' : val}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: { size: 9 },
                            color: '#94a3b8',
                            callback: val => isPct ? val + '%' : val,
                            mirror: true,
                            padding: 4,
                            align: 'end'
                        },
                        grid: { color: '#f1f5f9' },
                        afterFit: (axis) => { axis.width = Y_AXIS_WIDTH; }
                    },
                    x: {
                        ticks: { font: { size: 10 } },
                        grid: { display: false },
                        offset: false
                    }
                }
            }
        });
    }

    function evoChartValue(cellData, metricKey) {
        if (!cellData) return 0;
        const m = cellData.mobiles, s = cellData.services, b = cellData.basics;
        if (metricKey === 'pctServices') return m > 0 ? Math.round((s / m) * 100) : 0;
        if (metricKey === 'pctBasics') return m > 0 ? Math.round((b / m) * 100) : 0;
        if (metricKey === 'pctCombo') return m > 0 ? Math.round(((s + b) / m) * 100) : 0;
        if (metricKey === 'mobilesTotal') return cellData.mobilesTotal;
        return cellData[metricKey] || 0;
    }

    // ============================
    // CSV IMPORT
    // ============================
    async function handleFileSelected(file) {
        if (!file.name.match(/\.(csv|txt)$/i)) {
            UI.addLog('Error: Selecciona un archivo CSV', 'error');
            return;
        }

        UI.addLog(`Archivo: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

        try {
            const preview = await CSVParser.parsePreview(file, 20, currentImportSource);
            currentPreviewData = { file, mapping: preview.detectedMapping };
            UI.showPreview(preview.headers, preview.rows, preview.detectedMapping);
            UI.addLog(`Vista previa: ${preview.headers.length} columnas, ${Object.keys(preview.detectedMapping).length} mapeadas`);
        } catch (err) {
            UI.addLog(`Error al leer CSV: ${err.message}`, 'error');
        }
    }

    async function confirmImport() {
        if (!currentPreviewData) return;

        const { file, mapping } = currentPreviewData;
        UI.hidePreview();
        UI.showProgress(0, 1, 'Leyendo archivo CSV...');
        UI.addLog(`Importando ${file.name}...`);

        try {
            const result = await CSVParser.parseFull(file, mapping, (count) => {
                UI.showProgress(count, count, `Parseando... ${count.toLocaleString()} filas`);
            }, currentImportSource);

            UI.addLog(`Parseado: ${result.records.length} validas de ${result.totalRows}`);

            // Ecom Sales: cross-reference, don't store
            if (currentImportSource === 'ecom') {
                await confirmEcomImport(result.records, file.name);
                return;
            }

            // Baby Banking (and other sources): normal import flow
            // Deduplicate: skip records that already exist from the SAME source
            UI.showProgress(0, 1, 'Comprobando duplicados...');
            const refs = [...new Set(result.records.map(r => r.reference).filter(Boolean))];
            const existingFps = await Database.getExistingFingerprints(refs, currentImportSource);

            let newRecords = result.records;
            let skippedDupes = 0;
            if (existingFps.size > 0) {
                newRecords = result.records.filter(r => {
                    const fp = `${r.reference}|${r.price}|${r.category}`;
                    if (existingFps.has(fp)) { skippedDupes++; return false; }
                    return true;
                });
                if (skippedDupes > 0) {
                    UI.addLog(`Duplicados detectados: ${skippedDupes} filas ya existian, se omiten`, 'success');
                }
            }

            if (newRecords.length === 0) {
                UI.hideProgress();
                UI.addLog('Todos los registros ya estaban importados. Nada que hacer.', 'success');
                currentPreviewData = null;
                return;
            }

            UI.showProgress(0, newRecords.length, 'Guardando...');
            const weekFn = KPIEngine.helpers.businessWeek;
            const added = await Database.bulkAddOperations(newRecords, (current, total) => {
                UI.showProgress(current, total);
            }, weekFn, currentImportSource);

            // Extract metadata from actually imported records
            const dates = newRecords.map(r => r.date).filter(Boolean).sort();
            const storeSet = new Set(newRecords.map(r => r.store).filter(Boolean));

            await Database.logImport({
                source: currentImportSource,
                filename: file.name,
                rowCount: added,
                dateFrom: dates[0] || null,
                dateTo: dates[dates.length - 1] || null,
                storeCount: storeSet.size,
                stores: [...storeSet]
            });

            UI.hideProgress();
            UI.addLog(`Importacion OK: ${added.toLocaleString()} registros`, 'success');

            currentPreviewData = null;
            await renderImportHistory();
            await renderEcomTimeline();
            await refreshHome();
        } catch (err) {
            UI.hideProgress();
            UI.addLog(`Error: ${err.message}`, 'error');
        }
    }

    // ============================
    // ECOM CROSS-REFERENCE
    // ============================
    async function confirmEcomImport(ecomRecords, filename) {
        UI.showProgress(0, 1, 'Cruzando con Baby Banking...');
        UI.addLog(`Cruzando ${ecomRecords.length.toLocaleString()} ordenes ecom...`);

        try {
            const result = await Database.crossReferenceEcom(ecomRecords, (current, total) => {
                UI.showProgress(current, total, `Cruzando referencias... ${current}/${total}`);
            });

            // Log the import for audit trail
            await Database.logImport({
                source: 'ecom',
                filename,
                rowCount: result.tagged,
                dateFrom: result.ecomDateFrom || null,
                dateTo: result.ecomDateTo || null,
                storeCount: 0,
                stores: []
            });

            UI.hideProgress();

            const parts = [];
            if (result.tagged > 0) parts.push(`${result.tagged} operaciones marcadas como ecom`);
            if (result.alreadyTagged > 0) parts.push(`${result.alreadyTagged} ya estaban marcadas`);
            if (result.notFound > 0) parts.push(`${result.notFound} referencias no encontradas en Baby Banking`);

            UI.addLog(`Cruce completado: ${parts.join(', ')}`, 'success');

            currentPreviewData = null;
            await renderImportHistory();
            await renderEcomTimeline();
            await refreshHome();
        } catch (err) {
            UI.hideProgress();
            UI.addLog(`Error en cruce ecom: ${err.message}`, 'error');
        }
    }

    // ============================
    // ECOM COVERAGE TIMELINE
    // ============================
    async function renderEcomTimeline() {
        const container = document.getElementById('ecom-timeline');
        if (!container) return;

        const coverage = await Database.getEcomCoverage();
        if (!coverage) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');

        const { bbFrom, bbTo, totalRecords, ecomCount, tiendaCount, coveredRanges } = coverage;

        // Calculate timeline dimensions
        const bbStart = new Date(bbFrom).getTime();
        const bbEnd = new Date(bbTo).getTime();
        const totalSpan = bbEnd - bbStart || 1;

        // Build covered segments with percentage positions and dates
        const segments = coveredRanges.map(r => {
            const from = Math.max(new Date(r.from).getTime(), bbStart);
            const to = Math.min(new Date(r.to).getTime(), bbEnd);
            return {
                left: ((from - bbStart) / totalSpan * 100).toFixed(2),
                width: (((to - from) / totalSpan) * 100).toFixed(2),
                fromDate: r.from,
                toDate: r.to
            };
        });

        // Build gap list (uncovered periods between BB range and ecom segments)
        const gaps = [];
        let cursor = bbFrom;
        for (const r of coveredRanges) {
            if (r.from > cursor) {
                gaps.push({ from: cursor, to: r.from });
            }
            cursor = r.to > cursor ? r.to : cursor;
        }
        if (cursor < bbTo) {
            gaps.push({ from: cursor, to: bbTo });
        }

        const pctEcom = totalRecords > 0 ? ((ecomCount / totalRecords) * 100).toFixed(1) : '0';

        // Segment date markers on the bar
        const markers = segments.map(s => {
            const leftEnd = (parseFloat(s.left) + parseFloat(s.width)).toFixed(2);
            return `<div class="ecom-timeline-covered" style="left:${s.left}%;width:${s.width}%"
                        title="${UI.formatDate(s.fromDate)} — ${UI.formatDate(s.toDate)}"></div>
                    <span class="ecom-marker ecom-marker-start" style="left:${s.left}%">${UI.formatDate(s.fromDate)}</span>
                    <span class="ecom-marker ecom-marker-end" style="left:${leftEnd}%">${UI.formatDate(s.toDate)}</span>`;
        }).join('');

        const gapInfo = gaps.length > 0
            ? `<div class="ecom-gaps">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; opacity:0.5;flex-shrink:0;">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
                </svg>
                ${gaps.map(g => `<span class="ecom-gap-label">Sin ecom: ${UI.formatDate(g.from)} — ${UI.formatDate(g.to)}</span>`).join('')}
              </div>`
            : '';

        container.innerHTML = `
            <h4 class="home-col-label" style="margin-top:2rem;">COBERTURA ECOM</h4>
            <div class="ecom-timeline-bar-wrap">
                <div class="ecom-timeline-labels">
                    <span>${UI.formatDate(bbFrom)}</span>
                    <span>${UI.formatDate(bbTo)}</span>
                </div>
                <div class="ecom-timeline-bar">
                    ${markers}
                </div>
                <div class="ecom-timeline-legend">
                    <span class="ecom-legend-item"><span class="ecom-legend-dot covered"></span> Cruzado con ecom</span>
                    <span class="ecom-legend-item"><span class="ecom-legend-dot uncovered"></span> Sin datos ecom</span>
                </div>
            </div>
            ${gapInfo}
            <div class="ecom-timeline-stats">
                <span>${ecomCount.toLocaleString()} ecom</span>
                <span>${tiendaCount.toLocaleString()} tienda</span>
                <span>${pctEcom}% ecom</span>
            </div>
        `;
    }

    // ============================
    // IMPORT HISTORY
    // ============================
    async function renderImportHistory() {
        const imports = await Database.getImportHistory();
        const tbody = document.getElementById('import-history-tbody');

        if (imports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Ningun archivo importado todavia.</td></tr>';
            return;
        }

        tbody.innerHTML = imports.map(imp => {
            const sourceLabel = SOURCE_LABELS[imp.source] || imp.source || '--';
            const storesText = imp.storeCount === 1 ? (imp.stores?.[0] || '1 tienda')
                : imp.storeCount > 1 ? `${imp.storeCount} tiendas`
                : '--';

            return `<tr>
                <td>${escapeHtml(imp.filename || '--')}</td>
                <td><span class="source-badge">${escapeHtml(sourceLabel)}</span></td>
                <td>${UI.formatDate(imp.date)}</td>
                <td>${imp.dateFrom ? UI.formatDate(imp.dateFrom) : '--'}</td>
                <td>${imp.dateTo ? UI.formatDate(imp.dateTo) : '--'}</td>
                <td>${storesText}</td>
                <td>${(imp.rowCount || 0).toLocaleString()}</td>
            </tr>`;
        }).join('');
    }

    // ============================
    // DATA EXPLORER (inline in import section)
    // ============================
    function toggleDataExplorer() {
        const panel = document.getElementById('data-explorer-panel');
        const btn = document.getElementById('btn-toggle-explorer');
        const visible = !panel.classList.contains('hidden');
        if (visible) {
            panel.classList.add('hidden');
            btn.textContent = 'Mostrar';
        } else {
            panel.classList.remove('hidden');
            btn.textContent = 'Ocultar';
            loadDataExplorer();
        }
    }

    async function loadDataExplorer(page) {
        const pageNum = typeof page === 'number' ? page : 1;
        const search = document.getElementById('data-search').value;
        const type = document.getElementById('data-filter-type').value;

        const result = await Database.queryOperations({ type, search }, pageNum);
        UI.renderDataTable(result);

        const countEl = document.getElementById('data-record-count');
        if (countEl) countEl.textContent = `${result.total.toLocaleString()} registros`;
    }

    // ============================
    // SETTINGS
    // ============================
    async function loadSettings() {
        const count = await Database.getRecordCount();
        const imports = await Database.getImportHistory();
        UI.updateSettingsInfo(
            `${count.toLocaleString()} registros. ${imports.length} importaciones.`
        );

        const saved = await Database.getSetting('courseStartDate');
        if (saved) document.getElementById('course-start-date').value = UI.formatDate(saved);
        updateCourseStartInfo();

        if (DriveSync.isConnected()) {
            const info = await DriveSync.getBackupInfo();
            UI.updateDriveStatus(info ? `Conectado. Ultimo backup: ${info.lastModified}` : 'Conectado.');
        }
    }

    async function saveCourseStart() {
        const rawValue = document.getElementById('course-start-date').value;
        const isoDate = UI.parseDateInput(rawValue);

        if (!isoDate) { alert('Formato invalido. Usa DD/MM/AAAA.'); return; }

        const d = new Date(isoDate + 'T00:00:00');
        if (d.getDay() !== 6) { alert('La fecha debe ser un sabado.'); return; }

        KPIEngine.setCourseStart(isoDate);
        await Database.setSetting('courseStartDate', isoDate);
        updateCourseStartInfo();
        updateTopbarWeek();
        UI.addLog(`Inicio de curso: ${rawValue}`, 'success');
    }

    function updateCourseStartInfo() {
        const el = document.getElementById('course-start-info');
        if (!el) return;
        const start = KPIEngine.getCourseStart();
        const today = new Date().toISOString().substring(0, 10);
        const wk = KPIEngine.helpers.businessWeek(today);
        el.textContent = `Curso desde ${UI.formatDate(start)}. Hoy es semana ${wk}.`;
    }

    // ============================
    // ACTIONS
    // ============================
    async function resetTool() {
        const step1 = confirm(
            'Vas a restablecer toda la herramienta.\n\n' +
            'Se eliminaran todos los datos importados, el historial y la configuracion.\n\n' +
            'Si quieres conservar los datos, primero exporta un backup JSON desde el Home. ' +
            'Podras restaurarlo despues con "Importar backup".\n\n' +
            'Continuar?'
        );
        if (!step1) return;

        const step2 = confirm(
            'ULTIMA OPORTUNIDAD\n\n' +
            'Esta accion no se puede deshacer. Se borrara todo.\n\n' +
            'Pulsa Aceptar para restablecer.'
        );
        if (!step2) return;

        await Database.clearAll();
        await Database.setSetting('courseStartDate', null);
        KPIEngine.setCourseStart('2025-12-27');
        document.getElementById('course-start-date').value = '27/12/2025';
        await refreshHome();
        navigateTo('home');
        UI.addLog('Herramienta restablecida', 'success');
    }

    async function handleJsonImport(e) {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';

        if (!confirm(`Restaurar datos desde "${file.name}"?\n\nEsto reemplazara TODOS los datos actuales.`)) return;

        try {
            UI.addLog('Leyendo backup...');
            let text;
            if (file.name.endsWith('.gz')) {
                const buffer = await file.arrayBuffer();
                const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
                text = decompressed;
            } else {
                text = await file.text();
            }
            const data = JSON.parse(text);

            if (!data.operations || !Array.isArray(data.operations)) {
                UI.addLog('Error: el archivo no tiene formato de backup valido', 'error');
                return;
            }

            await Database.importAll(data);

            // Restore course start if present
            if (data.settings) {
                const cs = data.settings.find(s => s.key === 'courseStartDate');
                if (cs && cs.value) {
                    KPIEngine.setCourseStart(cs.value);
                    document.getElementById('course-start-date').value = UI.formatDate(cs.value);
                }
            }

            await refreshHome();
            UI.addLog(`Backup restaurado: ${data.operations.length.toLocaleString()} registros desde ${file.name}`, 'success');
        } catch (err) {
            UI.addLog(`Error al importar JSON: ${err.message}`, 'error');
        }
    }

    async function connectDrive() {
        try {
            await DriveSync.authenticate();
            document.getElementById('home-drive-status').textContent = 'Conectado';
            UI.updateDriveStatus('Conectado');
            UI.addLog('Google Drive conectado', 'success');
        } catch (err) {
            UI.addLog(`Error Drive: ${err.message}`, 'error');
        }
    }

    async function syncDrive() {
        if (!DriveSync.isConnected()) {
            UI.addLog('Conecta primero con Drive en Ajustes', 'error');
            return;
        }
        try {
            UI.addLog('Backup a Drive...');
            const data = await Database.exportAll();
            await DriveSync.backup(data);
            UI.addLog('Backup OK', 'success');
        } catch (err) {
            UI.addLog(`Error backup: ${err.message}`, 'error');
        }
    }

    async function exportData() {
        UI.addLog('Preparando backup comprimido...');
        const data = await Database.exportAll();
        const jsonStr = JSON.stringify(data);
        const compressed = pako.gzip(jsonStr);
        const blob = new Blob([compressed], { type: 'application/gzip' });

        const now = new Date();
        const datePart = now.toISOString().slice(0, 10);
        const timePart = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kpitool_export_${datePart}_${timePart}.json.gz`;
        a.click();
        URL.revokeObjectURL(url);

        const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
        UI.addLog(`Backup exportado (${sizeMB} MB comprimido)`, 'success');
    }

    // ============================
    // CHANGELOG
    // ============================
    function openChangelog() {
        const body = document.getElementById('changelog-body');
        body.innerHTML = Changelog.map(entry => `
            <div class="changelog-date">${entry.date}</div>
            ${entry.items.map(item => `
                <div class="changelog-item">
                    <span class="changelog-tag ${item.type}">${item.type}</span>
                    <span>${item.text}</span>
                </div>
            `).join('')}
        `).join('');
        document.getElementById('changelog-overlay').classList.remove('hidden');
    }

    function closeChangelog() {
        document.getElementById('changelog-overlay').classList.add('hidden');
    }

    // ============================
    // HELPERS
    // ============================
    function formatCurrency(val) {
        return val.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function debounce(fn, ms) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    }

    document.addEventListener('DOMContentLoaded', init);
    return { init };
})();
