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
        document.getElementById('data-filter-store').addEventListener('change', loadDataExplorer);
        document.getElementById('data-filter-category').addEventListener('change', loadDataExplorer);
        document.getElementById('data-filter-channel').addEventListener('change', loadDataExplorer);
        document.getElementById('data-filter-date-from').addEventListener('input', debounce(loadDataExplorer, 500));
        document.getElementById('data-filter-date-to').addEventListener('input', debounce(loadDataExplorer, 500));
        document.getElementById('data-pagination').addEventListener('click', (e) => {
            if (e.target.dataset.page) loadDataExplorer(parseInt(e.target.dataset.page));
        });

        // Store selects (searchable)
        initStoreSelect('kpi-panel-store', 'kpi-panel-store-list', refreshEvolution);
        initStoreSelect('cs-store', 'cs-store-list', refreshCrossSellEvo);

        // KPI Mobiles filters
        document.getElementById('evo-week-from').addEventListener('change', refreshEvolution);
        document.getElementById('evo-week-to').addEventListener('change', refreshEvolution);
        document.getElementById('evo-metric').addEventListener('change', () => {
            const m = document.getElementById('evo-metric').value;
            document.getElementById('evo-min-ops').disabled = !m.startsWith('pct');
            refreshEvolution();
        });
        document.getElementById('evo-min-ops').addEventListener('change', refreshEvolution);
        document.getElementById('evo-scope').addEventListener('change', refreshEvolution);

        // Top N + ecom filter + chart toggle
        document.getElementById('evo-top-n').addEventListener('change', refreshEvolution);
        document.getElementById('evo-exclude-ecom')?.addEventListener('change', refreshEvolution);
        document.getElementById('evo-merge-stores')?.addEventListener('change', refreshEvolution);
        document.getElementById('btn-toggle-chart').addEventListener('click', toggleEvoChart);

        // KPI Cross-sell filters
        document.getElementById('cs-week-from').addEventListener('change', refreshCrossSellEvo);
        document.getElementById('cs-week-to').addEventListener('change', refreshCrossSellEvo);
        document.getElementById('cs-metric').addEventListener('change', () => {
            const m = document.getElementById('cs-metric').value;
            document.getElementById('cs-min-ops').disabled = !(m === 'pctMulti' || m === 'avgItems');
            refreshCrossSellEvo();
        });
        document.getElementById('cs-min-ops').addEventListener('change', refreshCrossSellEvo);
        document.getElementById('cs-scope').addEventListener('change', refreshCrossSellEvo);
        document.getElementById('cs-top-n').addEventListener('change', refreshCrossSellEvo);
        document.getElementById('cs-exclude-ecom')?.addEventListener('change', refreshCrossSellEvo);
        document.getElementById('cs-merge-stores')?.addEventListener('change', refreshCrossSellEvo);
        document.getElementById('btn-toggle-cs-chart').addEventListener('click', toggleCsChart);

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
            case 'go-kpi-crosssell': navigateTo('kpi-crosssell'); break;
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
        if (sectionId === 'kpi-crosssell') refreshKPICrossSell();
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

        // Store name from data
        const stores = await Database.getDistinctValues('store');
        document.getElementById('home-store-name').textContent =
            stores.length === 1 ? stores[0] : (stores.length > 1 ? `${stores.length} tiendas` : '--');

        updateTopbarWeek();
        await renderCoverageBars();
    }

    async function renderCoverageBars() {
        const container = document.getElementById('coverage-bars');
        const emptyMsg = document.getElementById('coverage-empty');
        const ranges = await Database.getDateRangeBySource();

        const sources = {
            'baby-banking': { label: 'Baby Banking', cssClass: 'coverage-bar-bb' },
            'ecom': { label: 'Ecom Sales', cssClass: 'coverage-bar-ecom' }
        };

        // Find global min/max
        let globalMin = null, globalMax = null;
        for (const src of Object.keys(sources)) {
            const r = ranges[src];
            if (!r) continue;
            if (!globalMin || r.from < globalMin) globalMin = r.from;
            if (!globalMax || r.to > globalMax) globalMax = r.to;
        }

        if (!globalMin) {
            container.innerHTML = '';
            emptyMsg.classList.remove('hidden');
            return;
        }
        emptyMsg.classList.add('hidden');

        const minMs = new Date(globalMin + 'T00:00:00').getTime();
        const maxMs = new Date(globalMax + 'T00:00:00').getTime();
        const span = maxMs - minMs || 1;

        let html = '';
        for (const [src, meta] of Object.entries(sources)) {
            const r = ranges[src];
            const leftPct = r ? ((new Date(r.from + 'T00:00:00').getTime() - minMs) / span * 100) : 0;
            const rightPct = r ? ((new Date(r.to + 'T00:00:00').getTime() - minMs) / span * 100) : 0;
            const widthPct = r ? Math.max(rightPct - leftPct, 1) : 0;

            html += `<div class="coverage-row">
                <div class="coverage-bar-title" style="margin-left:${r ? leftPct : 0}%;width:${r ? widthPct : 100}%">${meta.label}${r ? '' : ' — sin datos'}</div>
                <div class="coverage-track">
                    ${r ? `<div class="coverage-bar ${meta.cssClass}" style="left:${leftPct}%;width:${widthPct}%"></div>` : ''}
                </div>
                ${r ? `<div class="coverage-dates" style="margin-left:${leftPct}%;width:${widthPct}%">
                    <span>${UI.formatDate(r.from)}</span>
                    <span>${UI.formatDate(r.to)}</span>
                </div>` : ''}
            </div>`;
        }

        container.innerHTML = html;
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
        evoState.staffStore = {};
        const nameStores = {};
        for (const r of sales) {
            const wk = r.week;
            if (wk < weekFrom || wk > weekTo) continue;

            const staffName = r.staff || 'N/A';
            const storeName = r.store || '?';
            let key;
            if (evoState.scope === 'store') {
                key = storeName;
            } else {
                key = `${staffName}\t${storeName}`;
            }
            const catLower = (r.category || '').toLowerCase();
            const qty = r.quantity || 0;

            if (evoState.scope === 'staff') {
                evoState.staffStore[key] = storeName;
                if (!nameStores[staffName]) nameStores[staffName] = new Set();
                nameStores[staffName].add(storeName);
            }

            if (!evoState.staffWeekData[key]) evoState.staffWeekData[key] = {};
            if (!evoState.staffWeekData[key][wk]) evoState.staffWeekData[key][wk] = { mobiles: 0, mobilesTotal: 0, services: 0, basics: 0 };

            const cell = evoState.staffWeekData[key][wk];
            if (catLower.includes('moviles')) { cell.mobiles += qty; cell.mobilesTotal += (r.total || 0); }
            if (catLower.includes('services')) { cell.services += qty; }
            if (catLower.includes('basics')) { cell.basics += qty; }
        }

        // Track names that appear in multiple stores
        evoState.nameStoresMap = {};
        for (const [name, stores] of Object.entries(nameStores)) {
            if (stores.size > 1) evoState.nameStoresMap[name] = [...stores];
        }

        // Merge stores if toggle is on
        const mergeStores = document.getElementById('evo-merge-stores')?.checked;
        if (mergeStores && evoState.scope === 'staff') {
            const merged = {};
            const mergedStores = {};
            for (const [key, weekData] of Object.entries(evoState.staffWeekData)) {
                const name = key.includes('\t') ? key.split('\t')[0] : key;
                if (!merged[name]) { merged[name] = {}; mergedStores[name] = new Set(); }
                const store = evoState.staffStore[key];
                if (store) mergedStores[name].add(store);
                for (const [wk, cell] of Object.entries(weekData)) {
                    if (!merged[name][wk]) merged[name][wk] = { mobiles: 0, mobilesTotal: 0, services: 0, basics: 0 };
                    merged[name][wk].mobiles += cell.mobiles;
                    merged[name][wk].mobilesTotal += cell.mobilesTotal;
                    merged[name][wk].services += cell.services;
                    merged[name][wk].basics += cell.basics;
                }
            }
            evoState.staffWeekData = merged;
            evoState.mergedStoresMap = {};
            for (const [name, stores] of Object.entries(mergedStores)) {
                evoState.mergedStoresMap[name] = [...stores];
            }
        } else {
            evoState.mergedStoresMap = null;
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
        if (col === 'name') return (name.includes('\t') ? name.split('\t')[0] : name).toLowerCase();
        if (col === 'store') return (evoState.staffStore?.[name] || '').toLowerCase();
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

        const showStore = scope === 'staff';
        const nameHeader = scope === 'store' ? 'Tienda' : 'Empleado';
        thead.innerHTML = `<tr>
            <th class="col-rank">#</th>
            <th class="sortable${sortCls('name')}" data-evo-sort="name">${nameHeader}</th>
            ${showStore ? `<th class="sortable${sortCls('store')}" data-evo-sort="store">Tienda</th>` : ''}
            ${weeks.map(w => `<th class="sortable${sortCls(w)}" data-evo-sort="${w}">W${w}</th>`).join('')}
            <th class="sortable col-total${sortCls('total')}" data-evo-sort="total"><strong>Total</strong></th>
        </tr>`;

        // Bind sort clicks
        thead.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.evoSort;
                sortEvolution(col === 'name' || col === 'total' || col === 'store' ? col : parseInt(col));
            });
        });

        let staffNames = Object.keys(staffWeekData);

        if (staffNames.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${weeks.length + (showStore ? 4 : 3)}" class="empty-msg">Sin datos para estas semanas.</td></tr>`;
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

        // Filter by min operations for percentage metrics
        if (metric.startsWith('pct')) {
            const minOps = parseInt(document.getElementById('evo-min-ops').value) || 0;
            if (minOps > 0) {
                staffNames = staffNames.filter(key => {
                    let total = 0;
                    for (const wk of weeks) { total += staffWeekData[key]?.[wk]?.mobiles || 0; }
                    return total >= minOps;
                });
            }
        }

        // Apply top-n filter
        const topNVal = document.getElementById('evo-top-n').value;
        if (topNVal !== 'all') {
            staffNames = staffNames.slice(0, parseInt(topNVal));
        }

        const isMerged = !!evoState.mergedStoresMap;
        tbody.innerHTML = staffNames.map((key, idx) => {
            const wd = staffWeekData[key];
            const selected = evoState.selectedStaff === key ? ' class="evo-row-selected"' : '';
            const displayName = key.includes('\t') ? key.split('\t')[0] : key;
            let nameHtml = escapeHtml(displayName);
            let storeCell = '';
            if (showStore) {
                if (isMerged) {
                    const stores = evoState.mergedStoresMap[key] || [];
                    storeCell = stores.length > 1
                        ? `<td class="col-store"><span title="${stores.join(', ')}">${stores.length} tiendas</span></td>`
                        : `<td class="col-store">${escapeHtml(stores[0] || '')}</td>`;
                } else {
                    const storeName = evoState.staffStore?.[key] || '';
                    const dupStores = evoState.nameStoresMap?.[displayName];
                    if (dupStores) {
                        nameHtml += ` <span class="dup-mark" title="Tambien en: ${dupStores.filter(s => s !== storeName).join(', ')}">*</span>`;
                    }
                    storeCell = `<td class="col-store">${escapeHtml(storeName)}</td>`;
                }
            }
            return `<tr${selected} data-staff="${escapeHtml(key)}">
                <td class="col-rank">${idx + 1}</td>
                <td>${nameHtml}</td>
                ${storeCell}
                ${weeks.map(w => `<td>${evoCellValue(wd?.[w], metric)}</td>`).join('')}
                <td class="col-total"><strong>${evoRowTotal(wd || {}, metric, weeks)}</strong></td>
            </tr>`;
        }).join('');

        if (staffNames.length > 1) {
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
                <td class="col-rank"></td>
                <td>TOTAL</td>
                ${showStore ? '<td></td>' : ''}
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

        // Conditional gradient for absolute metrics
        if (!metric.startsWith('pct')) {
            const evoExtractor = (cell) => {
                if (!cell) return 0;
                if (metric === 'mobilesTotal') return cell.mobilesTotal || 0;
                return cell[metric] || 0;
            };
            applyHeatmap('evo-table', staffWeekData, weeks, evoExtractor);
        }

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

        const labels = weeks.map(w => `W${w}`);
        const isPct = chartMetric.startsWith('pct');
        const topNVal = document.getElementById('evo-top-n').value;
        const showTotal = allStaff.length === 1;
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
                label: (name.includes('\t') ? name.split('\t')[0] : name).split(' ').slice(0, 2).join(' '),
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
    // KPI: VENTA COMPLEMENTARIA
    // ============================
    let csState = {
        data: {},       // key -> { wk -> { totalTickets, multiCount, totalItems } }
        weeks: [],
        scope: 'staff',
        metric: 'totalItems',
        sortCol: null,
        sortDir: 'desc',
        selectedRow: null,
        staffStore: {},
        duplicateNames: new Set()
    };
    let csChartInstance = null;

    async function refreshKPICrossSell() {
        const stores = await Database.getDistinctValues('store');
        populateStoreSelect('cs-store', stores);

        const today = new Date().toISOString().substring(0, 10);
        const currentWeek = KPIEngine.helpers.businessWeek(today);
        const fromEl = document.getElementById('cs-week-from');
        const toEl = document.getElementById('cs-week-to');

        const savedFrom = await Database.getSetting('evoWeekFrom');
        const savedTo = await Database.getSetting('evoWeekTo');
        if (savedFrom && savedTo) {
            fromEl.value = savedFrom;
            toEl.value = savedTo;
        } else if (parseInt(toEl.value) < 2) {
            fromEl.value = Math.max(1, currentWeek - 3);
            toEl.value = currentWeek;
        }

        refreshCrossSellEvo();
    }

    async function refreshCrossSellEvo() {
        const weekFrom = parseInt(document.getElementById('cs-week-from').value) || 1;
        const weekTo = parseInt(document.getElementById('cs-week-to').value) || weekFrom;
        csState.metric = document.getElementById('cs-metric').value;
        csState.scope = document.getElementById('cs-scope').value;
        const store = getStoreValue('cs-store');

        const courseStart = KPIEngine.getCourseStart();
        const cs = courseStart.split('-');
        const startMs = Date.UTC(cs[0], cs[1] - 1, cs[2]);
        const fromDate = new Date(startMs + (weekFrom - 1) * 7 * 86400000).toISOString().substring(0, 10);
        const toDate = new Date(startMs + weekTo * 7 * 86400000 - 86400000).toISOString().substring(0, 10);
        document.getElementById('cs-week-range').textContent =
            weekFrom === weekTo
                ? `Semana ${weekFrom} (${UI.formatDate(fromDate)} - ${UI.formatDate(toDate)})`
                : `Semanas ${weekFrom}-${weekTo} (${UI.formatDate(fromDate)} - ${UI.formatDate(toDate)})`;

        csState.sortCol = null;
        csState.sortDir = 'desc';
        csState.weeks = [];
        for (let w = weekFrom; w <= weekTo; w++) csState.weeks.push(w);

        if (csState.weeks.length === 0 || csState.weeks.length > 52) {
            document.getElementById('cs-tbody').innerHTML =
                '<tr><td class="empty-msg">Rango de semanas no valido.</td></tr>';
            return;
        }

        const allData = await Database.getOperationsForKPI({});
        let sales = allData.filter(r => r.type === 'sale');
        if (store && store !== 'all') sales = sales.filter(r => r.store === store);
        const excludeEcom = document.getElementById('cs-exclude-ecom')?.checked;
        if (excludeEcom) sales = sales.filter(r => r.channel !== 'ecom');

        // Filter out non-article lines (price <= 0)
        sales = sales.filter(r => (r.price || 0) > 0);

        // Group by owner (staff or store) + week + reference
        // owner -> week -> reference -> count of article lines
        const ownerRefCount = {};
        csState.staffStore = {};
        const nameStores = {};

        for (const r of sales) {
            const wk = r.week;
            if (wk < weekFrom || wk > weekTo) continue;

            const staffName = r.staff || 'N/A';
            const storeName = r.store || '?';
            let key;
            if (csState.scope === 'store') {
                key = storeName;
            } else {
                key = `${staffName}\t${storeName}`;
                csState.staffStore[key] = storeName;
                if (!nameStores[staffName]) nameStores[staffName] = new Set();
                nameStores[staffName].add(storeName);
            }

            const ref = r.reference || `_noref_${r.id}`;

            if (!ownerRefCount[key]) ownerRefCount[key] = {};
            if (!ownerRefCount[key][wk]) ownerRefCount[key][wk] = { refs: {}, revenue: 0 };
            ownerRefCount[key][wk].refs[ref] = (ownerRefCount[key][wk].refs[ref] || 0) + 1;
            ownerRefCount[key][wk].revenue += (r.total || 0);
        }

        // Compute aggregated metrics per owner per week
        csState.data = {};
        for (const [key, weekData] of Object.entries(ownerRefCount)) {
            csState.data[key] = {};
            for (const [wk, wd] of Object.entries(weekData)) {
                const refs = wd.refs;
                const tickets = Object.keys(refs).length;
                const multiTickets = Object.values(refs).filter(c => c > 1).length;
                const totalItems = Object.values(refs).reduce((a, b) => a + b, 0);
                csState.data[key][parseInt(wk)] = { totalTickets: tickets, multiCount: multiTickets, totalItems, revenue: wd.revenue };
            }
        }

        csState.nameStoresMap = {};
        for (const [name, stores] of Object.entries(nameStores)) {
            if (stores.size > 1) csState.nameStoresMap[name] = [...stores];
        }

        // Merge stores if toggle is on
        const mergeStores = document.getElementById('cs-merge-stores')?.checked;
        if (mergeStores && csState.scope === 'staff') {
            const merged = {};
            const mergedStores = {};
            for (const [key, weekData] of Object.entries(csState.data)) {
                const name = key.includes('\t') ? key.split('\t')[0] : key;
                if (!merged[name]) { merged[name] = {}; mergedStores[name] = new Set(); }
                const store = csState.staffStore[key];
                if (store) mergedStores[name].add(store);
                for (const [wk, cell] of Object.entries(weekData)) {
                    if (!merged[name][wk]) merged[name][wk] = { totalTickets: 0, multiCount: 0, totalItems: 0, revenue: 0 };
                    merged[name][wk].totalTickets += cell.totalTickets;
                    merged[name][wk].multiCount += cell.multiCount;
                    merged[name][wk].totalItems += cell.totalItems;
                    merged[name][wk].revenue += cell.revenue;
                }
            }
            csState.data = merged;
            csState.mergedStoresMap = {};
            for (const [name, stores] of Object.entries(mergedStores)) {
                csState.mergedStoresMap[name] = [...stores];
            }
        } else {
            csState.mergedStoresMap = null;
        }

        renderCrossSellEvo();
    }

    function csCellValue(cellData, metricKey) {
        if (!cellData) {
            if (metricKey === 'pctMulti' || metricKey === 'avgItems') return '--';
            if (metricKey === 'revenue') return formatCurrency(0);
            return '0';
        }
        const { totalTickets, multiCount, totalItems, revenue } = cellData;
        if (metricKey === 'pctMulti') return formatPctDetail(multiCount, totalTickets);
        if (metricKey === 'avgItems') return totalTickets > 0 ? `${(totalItems / totalTickets).toFixed(1)} <small class="pct-units">(${totalItems}/${totalTickets})</small>` : '--';
        if (metricKey === 'revenue') return formatCurrency(revenue || 0);
        return cellData[metricKey] || 0;
    }

    function csRowTotal(weekData, metricKey, weeks) {
        let sumTickets = 0, sumMulti = 0, sumItems = 0, sumRevenue = 0;
        for (const wk of weeks) {
            const c = weekData?.[wk]; if (!c) continue;
            sumTickets += c.totalTickets; sumMulti += c.multiCount; sumItems += c.totalItems; sumRevenue += c.revenue;
        }
        if (metricKey === 'pctMulti') return formatPctDetail(sumMulti, sumTickets);
        if (metricKey === 'avgItems') return sumTickets > 0 ? `${(sumItems / sumTickets).toFixed(1)} <small class="pct-units">(${sumItems}/${sumTickets})</small>` : '--';
        if (metricKey === 'revenue') return formatCurrency(sumRevenue);
        if (metricKey === 'totalTickets') return sumTickets;
        if (metricKey === 'totalItems') return sumItems;
        return sumMulti;
    }

    function csSortValue(key, col, metric, weeks) {
        const wd = csState.data[key];
        if (col === 'name') return (key.includes('\t') ? key.split('\t')[0] : key).toLowerCase();
        if (col === 'store') return (csState.staffStore?.[key] || '').toLowerCase();
        let cellData;
        if (col === 'total') {
            cellData = { totalTickets: 0, multiCount: 0, totalItems: 0, revenue: 0 };
            for (const wk of weeks) { const c = wd?.[wk]; if (c) { cellData.totalTickets += c.totalTickets; cellData.multiCount += c.multiCount; cellData.totalItems += c.totalItems; cellData.revenue += c.revenue; } }
        } else {
            cellData = wd?.[col] || { totalTickets: 0, multiCount: 0, totalItems: 0, revenue: 0 };
        }
        if (metric === 'pctMulti') return cellData.totalTickets > 0 ? cellData.multiCount / cellData.totalTickets : -1;
        if (metric === 'avgItems') return cellData.totalTickets > 0 ? cellData.totalItems / cellData.totalTickets : -1;
        return cellData[metric] || 0;
    }

    function sortCrossSellEvo(col) {
        if (csState.sortCol === col) {
            csState.sortDir = csState.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            csState.sortCol = col;
            csState.sortDir = 'desc';
        }
        renderCrossSellEvo();
    }

    function renderCrossSellEvo() {
        const { data, weeks, scope, metric, sortCol, sortDir } = csState;
        const thead = document.getElementById('cs-thead');
        const tbody = document.getElementById('cs-tbody');
        const tfoot = document.getElementById('cs-tfoot');

        const sortCls = (col) => {
            if (sortCol !== col) return '';
            return sortDir === 'desc' ? ' sort-desc' : ' sort-asc';
        };

        const showStore = scope === 'staff';
        const nameHeader = scope === 'store' ? 'Tienda' : 'Empleado';
        thead.innerHTML = `<tr>
            <th class="col-rank">#</th>
            <th class="sortable${sortCls('name')}" data-cs-sort="name">${nameHeader}</th>
            ${showStore ? `<th class="sortable${sortCls('store')}" data-cs-sort="store">Tienda</th>` : ''}
            ${weeks.map(w => `<th class="sortable${sortCls(w)}" data-cs-sort="${w}">W${w}</th>`).join('')}
            <th class="sortable col-total${sortCls('total')}" data-cs-sort="total"><strong>Total</strong></th>
        </tr>`;

        thead.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.csSort;
                sortCrossSellEvo(col === 'name' || col === 'total' || col === 'store' ? col : parseInt(col));
            });
        });

        let keys = Object.keys(data);

        if (keys.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${weeks.length + (showStore ? 4 : 3)}" class="empty-msg">Sin datos para estas semanas.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        const rankCol = sortCol || 'total';
        const rankDir = sortCol ? sortDir : 'desc';
        keys.sort((a, b) => {
            const va = csSortValue(a, rankCol, metric, weeks);
            const vb = csSortValue(b, rankCol, metric, weeks);
            if (typeof va === 'string') return rankDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return rankDir === 'asc' ? va - vb : vb - va;
        });

        // Filter by min operations for percentage/average metrics
        if (metric === 'pctMulti' || metric === 'avgItems') {
            const minOps = parseInt(document.getElementById('cs-min-ops').value) || 0;
            if (minOps > 0) {
                keys = keys.filter(key => {
                    let total = 0;
                    for (const wk of weeks) { total += data[key]?.[wk]?.totalTickets || 0; }
                    return total >= minOps;
                });
            }
        }

        const topNVal = document.getElementById('cs-top-n').value;
        if (topNVal !== 'all') keys = keys.slice(0, parseInt(topNVal));

        const isMerged = !!csState.mergedStoresMap;
        tbody.innerHTML = keys.map((key, idx) => {
            const wd = data[key];
            const selected = csState.selectedRow === key ? ' class="evo-row-selected"' : '';
            const displayName = key.includes('\t') ? key.split('\t')[0] : key;
            let nameHtml = escapeHtml(displayName);
            let storeCell = '';
            if (showStore) {
                if (isMerged) {
                    const stores = csState.mergedStoresMap[key] || [];
                    storeCell = stores.length > 1
                        ? `<td class="col-store"><span title="${stores.join(', ')}">${stores.length} tiendas</span></td>`
                        : `<td class="col-store">${escapeHtml(stores[0] || '')}</td>`;
                } else {
                    const storeName = csState.staffStore?.[key] || '';
                    const dupStores = csState.nameStoresMap?.[displayName];
                    if (dupStores) {
                        nameHtml += ` <span class="dup-mark" title="Tambien en: ${dupStores.filter(s => s !== storeName).join(', ')}">*</span>`;
                    }
                    storeCell = `<td class="col-store">${escapeHtml(storeName)}</td>`;
                }
            }
            return `<tr${selected} data-cs-key="${escapeHtml(key)}">
                <td class="col-rank">${idx + 1}</td>
                <td>${nameHtml}</td>
                ${storeCell}
                ${weeks.map(w => `<td>${csCellValue(wd?.[w], metric)}</td>`).join('')}
                <td class="col-total"><strong>${csRowTotal(wd || {}, metric, weeks)}</strong></td>
            </tr>`;
        }).join('');

        if (keys.length > 1) {
            const colTotals = {};
            for (const w of weeks) {
                colTotals[w] = { totalTickets: 0, multiCount: 0, totalItems: 0, revenue: 0 };
                for (const key of keys) {
                    const c = data[key]?.[w]; if (!c) continue;
                    colTotals[w].totalTickets += c.totalTickets;
                    colTotals[w].multiCount += c.multiCount;
                    colTotals[w].totalItems += c.totalItems;
                    colTotals[w].revenue += c.revenue || 0;
                }
            }
            tfoot.innerHTML = `<tr data-cs-key="__TOTAL__">
                <td class="col-rank"></td>
                <td>TOTAL</td>
                ${showStore ? '<td></td>' : ''}
                ${weeks.map(w => `<td><strong>${csCellValue(colTotals[w], metric)}</strong></td>`).join('')}
                <td class="col-total"><strong>${csRowTotal(colTotals, metric, weeks)}</strong></td>
            </tr>`;
        } else {
            tfoot.innerHTML = '';
        }

        // Row click -> chart
        function selectRow(key, tr) {
            csState.selectedRow = csState.selectedRow === key ? null : key;
            const table = document.getElementById('cs-table');
            table.querySelectorAll('tr').forEach(r => r.classList.remove('evo-row-selected'));
            if (csState.selectedRow) tr.classList.add('evo-row-selected');
            const section = document.getElementById('cs-chart-section');
            if (section.classList.contains('collapsed')) {
                section.classList.remove('collapsed');
                requestAnimationFrame(() => requestAnimationFrame(() => renderCsChart()));
            } else {
                renderCsChart();
            }
        }
        document.querySelectorAll('#cs-table tr[data-cs-key]').forEach(tr => {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => selectRow(tr.dataset.csKey, tr));
        });

        // Conditional gradient for absolute metrics
        if (metric !== 'pctMulti' && metric !== 'avgItems') {
            const csExtractor = (cell) => cell?.[metric] || 0;
            applyHeatmap('cs-table', data, weeks, csExtractor);
        }
    }

    function toggleCsChart() {
        const section = document.getElementById('cs-chart-section');
        const isCollapsed = section.classList.contains('collapsed');
        if (isCollapsed) {
            section.classList.remove('collapsed');
            requestAnimationFrame(() => requestAnimationFrame(() => renderCsChart()));
        } else {
            section.classList.add('collapsed');
        }
    }

    function csChartValue(cellData, metricKey) {
        if (!cellData) return 0;
        const { totalTickets, multiCount, totalItems, revenue } = cellData;
        if (metricKey === 'pctMulti') return totalTickets > 0 ? Math.round((multiCount / totalTickets) * 100) : 0;
        if (metricKey === 'avgItems') return totalTickets > 0 ? parseFloat((totalItems / totalTickets).toFixed(1)) : 0;
        if (metricKey === 'revenue') return revenue;
        return cellData[metricKey] || 0;
    }

    function renderCsChart() {
        if (typeof Chart === 'undefined') return;

        const chartMetric = csState.metric;
        const { data, weeks, scope } = csState;

        const canvas = document.getElementById('cs-chart');
        if (!canvas) return;

        if (csChartInstance) { csChartInstance.destroy(); csChartInstance = null; }

        const allKeys = Object.keys(data);
        if (weeks.length === 0 || allKeys.length === 0) return;

        const container = canvas.parentElement;
        if (container.offsetHeight === 0) return;

        const labels = weeks.map(w => `W${w}`);
        const isPct = chartMetric === 'pctMulti';
        const isCurrency = chartMetric === 'revenue';
        const topNVal = document.getElementById('cs-top-n').value;
        const maxLines = topNVal === 'all' ? 999 : parseInt(topNVal) || 999;

        const colors = [
            '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
            '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1',
            '#be123c', '#0d9488', '#c026d3', '#ca8a04', '#475569'
        ];

        let datasets;
        const selected = csState.selectedRow;

        const computeTotal = (w) => {
            let tt = 0, mc = 0, ti = 0, rv = 0;
            for (const k of allKeys) { const c = data[k]?.[w]; if (!c) continue; tt += c.totalTickets; mc += c.multiCount; ti += c.totalItems; rv += c.revenue; }
            return csChartValue({ totalTickets: tt, multiCount: mc, totalItems: ti, revenue: rv }, chartMetric);
        };

        if (selected === '__TOTAL__' || allKeys.length === 1) {
            datasets = [{ label: 'Total', data: weeks.map(computeTotal), borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 4 }];
        } else if (selected && data[selected]) {
            const selData = weeks.map(w => csChartValue(data[selected]?.[w], chartMetric));
            const totalData = weeks.map(computeTotal);
            const selLabel = (selected.includes('\t') ? selected.split('\t')[0] : selected).split(' ').slice(0, 2).join(' ');
            datasets = [
                { label: selLabel, data: selData, borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 5, borderWidth: 3 },
                { label: 'Total', data: totalData, borderColor: '#94a3b8', backgroundColor: 'transparent', tension: 0.3, pointRadius: 3, borderWidth: 1.5, borderDash: [4, 3] }
            ];
        } else {
            const ranked = allKeys
                .map(k => ({ name: k, val: csSortValue(k, 'total', chartMetric, weeks) }))
                .sort((a, b) => b.val - a.val)
                .slice(0, maxLines);
            datasets = ranked.map(({ name }, i) => ({
                label: (name.includes('\t') ? name.split('\t')[0] : name).split(' ').slice(0, 2).join(' '),
                data: weeks.map(w => csChartValue(data[name]?.[w], chartMetric)),
                borderColor: colors[i % colors.length],
                backgroundColor: colors[i % colors.length] + '15',
                tension: 0.3, pointRadius: 3, borderWidth: 2
            }));
        }

        csChartInstance = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: datasets.length > 1 && datasets.length <= 10, position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } },
                    tooltip: { callbacks: { label: ctx => { const v = ctx.parsed.y; return `${ctx.dataset.label}: ${isPct ? v + '%' : isCurrency ? formatCurrency(v) : v}`; } } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { font: { size: 9 }, color: '#94a3b8', callback: val => isPct ? val + '%' : isCurrency ? formatCurrency(val) : val }, grid: { color: '#f1f5f9' } },
                    x: { ticks: { font: { size: 10 } }, grid: { display: false } }
                }
            }
        });
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
    async function toggleDataExplorer() {
        const panel = document.getElementById('data-explorer-panel');
        const btn = document.getElementById('btn-toggle-explorer');
        const visible = !panel.classList.contains('hidden');
        if (visible) {
            panel.classList.add('hidden');
            btn.textContent = 'Mostrar';
        } else {
            panel.classList.remove('hidden');
            btn.textContent = 'Ocultar';
            await populateExplorerDropdowns();
            loadDataExplorer();
        }
    }

    async function populateExplorerDropdowns() {
        const storeSelect = document.getElementById('data-filter-store');
        const catSelect = document.getElementById('data-filter-category');
        const prevStore = storeSelect.value;
        const prevCat = catSelect.value;

        const stores = await Database.getDistinctValues('store');
        storeSelect.innerHTML = '<option value="all">Todas las tiendas</option>';
        stores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            storeSelect.appendChild(opt);
        });
        if (stores.includes(prevStore)) storeSelect.value = prevStore;

        const cats = await Database.getDistinctValues('category');
        catSelect.innerHTML = '<option value="all">Todas las categorias</option>';
        cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            catSelect.appendChild(opt);
        });
        if (cats.includes(prevCat)) catSelect.value = prevCat;
    }

    async function loadDataExplorer(page) {
        const pageNum = typeof page === 'number' ? page : 1;
        const filters = {
            search: document.getElementById('data-search').value,
            type: document.getElementById('data-filter-type').value,
            store: document.getElementById('data-filter-store').value,
            category: document.getElementById('data-filter-category').value,
            channel: document.getElementById('data-filter-channel').value,
            dateFrom: UI.parseDateInput(document.getElementById('data-filter-date-from').value) || '',
            dateTo: UI.parseDateInput(document.getElementById('data-filter-date-to').value) || ''
        };

        const result = await Database.queryOperations(filters, pageNum);
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
        return (val || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    }

    function applyHeatmap(tableId, dataMap, weeks, metricExtractor) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        if (rows.length === 0 || weeks.length === 0) return;

        // Find which column index the week data starts at
        const ths = table.querySelectorAll('thead th');
        let dataStart = -1;
        ths.forEach((th, i) => {
            const sort = th.dataset.evoSort || th.dataset.csSort || '';
            if (/^\d+$/.test(sort) && dataStart === -1) dataStart = i;
        });
        if (dataStart === -1) return;

        // Collect all numeric values from the data to find max
        let maxVal = 0;
        const keys = Object.keys(dataMap);
        for (const key of keys) {
            for (const w of weeks) {
                const v = metricExtractor(dataMap[key]?.[w]);
                if (v > maxVal) maxVal = v;
            }
        }
        if (maxVal === 0) return;

        // Apply to each row's week cells
        rows.forEach(row => {
            const rowKey = row.dataset.staff || row.dataset.csKey;
            if (!rowKey || rowKey === '__TOTAL__') return;
            const wd = dataMap[rowKey];
            if (!wd) return;
            weeks.forEach((w, wi) => {
                const td = row.children[dataStart + wi];
                if (!td) return;
                const v = metricExtractor(wd[w]);
                if (v <= 0) return;
                const alpha = (v / maxVal * 0.35).toFixed(2);
                td.style.backgroundColor = `rgba(37, 99, 235, ${alpha})`;
            });
        });
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
