/**
 * KPI Metrics 2026 - Main Application Controller
 */
const App = (() => {
    let currentPreviewData = null;
    let currentImportSource = 'baby-banking';

    const SOURCE_LABELS = {
        'baby-banking': 'Baby Banking ES',
        'baby-banking-ic': 'Baby Banking IC',
        'ecom': 'Ecom Sales',
        'captacion': 'Captacion de socios',
        'attachment': 'Attachment',
        'stocks': 'Stocks (AIO)'
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

            const savedEcomConfig = await Database.getSetting('ecomConfigByKpi');
            if (savedEcomConfig && typeof savedEcomConfig === 'object') {
                for (const k of Object.keys(ECOM_CONFIG)) {
                    if (Object.prototype.hasOwnProperty.call(savedEcomConfig, k)) {
                        ECOM_CONFIG[k] = !!savedEcomConfig[k];
                    }
                }
            }

            // Drive (non-blocking)
            const driveClientId = await Database.getSetting('driveClientId');
            const driveApiKey = await Database.getSetting('driveApiKey');
            if (driveClientId) DriveSync.init(driveClientId, driveApiKey);

            // Category -> Supercategory mapping (non-blocking: if it fails,
            // every category falls back to "Sin mapear")
            loadSupercategoryMapping().catch(e => console.warn('Supercat mapping load failed:', e));
        } catch (e) {
            console.error('Init settings error (non-fatal):', e);
        }

        bindEvents();

        try {
            await refreshHome();
        } catch (e) {
            console.error('Init refreshHome error:', e);
        }

        updateTopbarWeek();

        console.log('KPI Metrics 2026 initialized');
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

        // Store select (searchable)
        initStoreSelect('kpi-panel-store', 'kpi-panel-store-list', refreshEvolution);

        // Vista por tienda filters (evolucion semanal unificada)
        document.getElementById('evo-week-from').addEventListener('change', refreshEvolution);
        document.getElementById('evo-week-to').addEventListener('change', refreshEvolution);
        document.getElementById('evo-metric').addEventListener('change', () => {
            const m = document.getElementById('evo-metric').value;
            document.getElementById('evo-min-ops').disabled = !METRICS[m]?.isPct;
            updateEvoMetricInfo();
            refreshEvolution();
        });
        // Info popover next to the KPI dropdown: rebuilt each time the
        // selection changes so the description matches the active metric.
        updateEvoMetricInfo();
        document.getElementById('evo-min-ops').addEventListener('change', refreshEvolution);

        // Top N + chart toggle
        document.getElementById('evo-top-n').addEventListener('change', refreshEvolution);
        document.getElementById('btn-toggle-chart').addEventListener('click', toggleEvoChart);

        // KPI multi-select (compare mode)
        initEvoKpiMultiSelect();

        // Dashboard: general
        document.getElementById('dg-week-from').addEventListener('change', refreshDashGeneral);
        document.getElementById('dg-week-to').addEventListener('change', refreshDashGeneral);

        // Dashboard: detail
        document.getElementById('dd-week-from').addEventListener('change', refreshDashDetail);
        document.getElementById('dd-week-to').addEventListener('change', refreshDashDetail);
        document.getElementById('dd-metric').addEventListener('change', () => {
            ddState.lastAutoMetric = null;  // force recompute of top 5 if not touched
            refreshDashDetail();
        });

        // Detail + Vista general: multi-select dropdowns
        initMultiSelectHandlers();
        initStoreGroupsAllInstances();
        initDashGeneralKpiPicker();
        initCategoryInfoPopover();
        initDashDetailControls();

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

        // Info popovers: flip to "below" when there isn't enough room above
        bindInfoPopoverFlip();
    }

    /**
     * The info-pop popovers (drop-zone help bubbles) drop upwards by default
     * (bottom: 100%). When the trigger sits near the top of the viewport
     * the popover gets clipped by the browser chrome / scrolled out of
     * sight. On hover/focus we measure available space and toggle a
     * .info-pop-below class so the popover drops downward instead.
     */
    function bindInfoPopoverFlip() {
        document.querySelectorAll('.info-btn').forEach(btn => {
            const decide = () => {
                const pop = btn.querySelector('.info-pop');
                if (!pop) return;
                // The popover is always laid out (opacity:0, not display:none),
                // so scrollHeight already reflects the real content height.
                const popHeight = pop.scrollHeight;
                const rect = btn.getBoundingClientRect();
                const spaceAbove = rect.top;
                const spaceBelow = window.innerHeight - rect.bottom;
                // Flip if there isn't room above AND there's more room below
                if (spaceAbove < popHeight + 12 && spaceBelow > spaceAbove) {
                    pop.classList.add('info-pop-below');
                } else {
                    pop.classList.remove('info-pop-below');
                }
            };
            btn.addEventListener('mouseenter', decide);
            btn.addEventListener('focus', decide);
        });
    }

    function handleAction(action) {
        switch (action) {
            case 'go-home': navigateTo('home'); break;
            case 'go-import': navigateTo('import'); break;
            case 'go-settings': navigateTo('settings'); break;
            case 'go-dash-general': navigateTo('dash-general'); break;
            case 'go-dash-detail': navigateTo('dash-detail'); break;
            case 'go-dash-store': navigateTo('dash-store'); break;
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
        if (sectionId === 'dash-general') refreshDashGeneral();
        if (sectionId === 'dash-detail') refreshDashDetail();
        if (sectionId === 'dash-store') refreshDashStore();
    }

    // ============================
    // TOPBAR
    // ============================
    function updateTopbarWeek() {
        const today = new Date().toISOString().substring(0, 10);
        const wk = KPIEngine.helpers.businessWeek(today);
        document.getElementById('topbar-week').textContent = `Semana ${wk}`;
    }

    // ============================
    // HOME: Refresh all
    // ============================
    async function refreshHome() {
        const count = await Database.getRecordCount();
        document.getElementById('db-status-badge').textContent = `DB: ${count.toLocaleString()}`;

        // Store count shown next to COBERTURA label
        const stores = await Database.getDistinctValues('store');
        const storeCountEl = document.getElementById('coverage-store-count');
        if (storeCountEl) {
            if (stores.length === 0) storeCountEl.textContent = '';
            else if (stores.length === 1) storeCountEl.textContent = `· ${stores[0]}`;
            else storeCountEl.textContent = `· ${stores.length} tiendas`;
        }

        updateTopbarWeek();
        await renderCoverageBars();
    }

    async function renderCoverageBars() {
        const container = document.getElementById('coverage-bars');
        const emptyMsg = document.getElementById('coverage-empty');
        const ranges = await Database.getDateRangeBySource();

        const sources = {
            'baby-banking': { label: 'Baby Banking ES', cssClass: 'coverage-bar-bb' },
            'baby-banking-ic': { label: 'Baby Banking IC', cssClass: 'coverage-bar-bb-ic' },
            'ecom': { label: 'Ecom Sales', cssClass: 'coverage-bar-ecom' },
            'captacion': { label: 'Captacion de socios', cssClass: 'coverage-bar-captacion' },
            'attachment': { label: 'Attachment', cssClass: 'coverage-bar-attachment' },
            'stocks': { label: 'Stocks (AIO)', cssClass: 'coverage-bar-stocks' }
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

    function initStoreSelect(inputId, listId, onChange, opts) {
        const input = document.getElementById(inputId);
        const list = document.getElementById(listId);
        const state = {
            stores: [],
            value: 'all',
            onChange,
            allLabel: (opts && opts.allLabel) || 'Todas las tiendas'
        };
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

        const options = [{ value: 'all', label: state.allLabel }];
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
        input.placeholder = state.value === 'all' ? state.allLabel : state.value;
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
    // DASHBOARD: STORE (evolucion por KPI)
    // ============================
    async function refreshDashStore() {
        const stores = await Database.getDistinctValues('store');
        populateStoreSelect('kpi-panel-store', stores);

        const fromEl = document.getElementById('evo-week-from');
        const toEl = document.getElementById('evo-week-to');

        const savedFrom = await Database.getSetting('evoWeekFrom');
        const savedTo = await Database.getSetting('evoWeekTo');
        if (savedFrom && savedTo) {
            fromEl.value = savedFrom;
            toEl.value = savedTo;
        }
        // If no saved range, refreshEvolution will auto-fill from available data.

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
    // METRIC REGISTRY (unificado Ventas + Moviles + Compras)
    // ============================
    // Buckets now carry a "NoEcom" variant of every field affected by ecom
    // (cash buy / exchange are never ecom, so they stay single-valued).
    // Each metric declares a filterEcom flag (live, from Configuracion) that
    // selects which variant its value()/format() uses.
    function emptyBucket() {
        return {
            saleRevenue: 0, saleRevenueNoEcom: 0,
            saleUnits: 0, saleUnitsNoEcom: 0,
            refundAmount: 0, refundAmountNoEcom: 0,
            ticketRefs: {}, ticketRefsNoEcom: {},
            mobiles: 0, mobilesNoEcom: 0,
            mobilesTotal: 0, mobilesTotalNoEcom: 0,
            services: 0, servicesNoEcom: 0,
            basics: 0, basicsNoEcom: 0,
            cashBuyAmount: 0, exchangeAmount: 0,
            memberships: 0,
            // Admision a test: testOrderRefs counts distinct Order Numbers
            // with type='test-admission'; testItems sums quantity.
            testOrderRefs: {}, testItems: 0,
            // Operation refs: distinct Order Numbers per counter type.
            // counterRefs = union of sale + cash buy + exchange + refund + test-admission.
            refundOrderRefs: {}, cashBuyOrderRefs: {}, exchangeOrderRefs: {},
            counterRefs: {}
        };
    }

    function addToBucket(b, r) {
        const total = r.total || 0;
        const qty = r.quantity || 0;
        const catLower = (r.category || '').toLowerCase();
        const isEcom = r.channel === 'ecom';
        const ref = r.reference || `_noref_${r.id || Math.random()}`;
        // counterRefs = denominator del testRatio. Memberships fuera.
        const isCounter = r.type === 'sale' || r.type === 'refund' ||
                          r.type === 'cash buy' || r.type === 'exchange' ||
                          r.type === 'test-admission';
        if (isCounter) b.counterRefs[ref] = true;

        if (r.type === 'sale') {
            if ((r.price || 0) > 0) {
                b.saleRevenue += total;
                b.saleUnits += qty;
                b.ticketRefs[ref] = (b.ticketRefs[ref] || 0) + 1;
                if (!isEcom) {
                    b.saleRevenueNoEcom += total;
                    b.saleUnitsNoEcom += qty;
                    b.ticketRefsNoEcom[ref] = (b.ticketRefsNoEcom[ref] || 0) + 1;
                }
            }
            if (catLower.includes('moviles')) {
                b.mobiles += qty; b.mobilesTotal += total;
                if (!isEcom) { b.mobilesNoEcom += qty; b.mobilesTotalNoEcom += total; }
            }
            if (catLower.includes('services')) {
                b.services += qty;
                if (!isEcom) b.servicesNoEcom += qty;
            }
            if (catLower.includes('basics')) {
                b.basics += qty;
                if (!isEcom) b.basicsNoEcom += qty;
            }
        } else if (r.type === 'refund') {
            b.refundOrderRefs[ref] = true;
            b.refundAmount += Math.abs(total);
            if (!isEcom) b.refundAmountNoEcom += Math.abs(total);
        } else if (r.type === 'cash buy') {
            b.cashBuyOrderRefs[ref] = true;
            b.cashBuyAmount += Math.abs(total);
        } else if (r.type === 'exchange') {
            b.exchangeOrderRefs[ref] = true;
            b.exchangeAmount += Math.abs(total);
        } else if (r.type === 'membership') {
            // Captacion se guarda agregada por (store, date) en confirmCaptacionImport:
            // quantity = socios captados ese dia en esa tienda. El "|| 1" mantiene
            // compatibilidad con filas previas que vinieran 1-por-socio si hubiera
            // datos legacy en la DB.
            b.memberships += (r.quantity || 1);
        } else if (r.type === 'test-admission') {
            b.testOrderRefs[ref] = true;
            b.testItems += qty;
        }
    }

    function mergeBuckets(dst, src) {
        dst.saleRevenue += src.saleRevenue;
        dst.saleRevenueNoEcom += src.saleRevenueNoEcom;
        dst.saleUnits += src.saleUnits;
        dst.saleUnitsNoEcom += src.saleUnitsNoEcom;
        dst.refundAmount += src.refundAmount;
        dst.refundAmountNoEcom += src.refundAmountNoEcom;
        for (const [ref, c] of Object.entries(src.ticketRefs)) {
            dst.ticketRefs[ref] = (dst.ticketRefs[ref] || 0) + c;
        }
        for (const [ref, c] of Object.entries(src.ticketRefsNoEcom || {})) {
            dst.ticketRefsNoEcom[ref] = (dst.ticketRefsNoEcom[ref] || 0) + c;
        }
        dst.mobiles += src.mobiles;
        dst.mobilesNoEcom += src.mobilesNoEcom;
        dst.mobilesTotal += src.mobilesTotal;
        dst.mobilesTotalNoEcom += src.mobilesTotalNoEcom;
        dst.services += src.services;
        dst.servicesNoEcom += src.servicesNoEcom;
        dst.basics += src.basics;
        dst.basicsNoEcom += src.basicsNoEcom;
        dst.cashBuyAmount += src.cashBuyAmount;
        dst.exchangeAmount += src.exchangeAmount;
        dst.memberships += src.memberships || 0;
        if (src.testOrderRefs) {
            for (const ref of Object.keys(src.testOrderRefs)) dst.testOrderRefs[ref] = true;
        }
        dst.testItems += src.testItems || 0;
        if (src.refundOrderRefs) {
            for (const ref of Object.keys(src.refundOrderRefs)) dst.refundOrderRefs[ref] = true;
        }
        if (src.cashBuyOrderRefs) {
            for (const ref of Object.keys(src.cashBuyOrderRefs)) dst.cashBuyOrderRefs[ref] = true;
        }
        if (src.exchangeOrderRefs) {
            for (const ref of Object.keys(src.exchangeOrderRefs)) dst.exchangeOrderRefs[ref] = true;
        }
        if (src.counterRefs) {
            for (const ref of Object.keys(src.counterRefs)) dst.counterRefs[ref] = true;
        }
    }

    // Field picker: returns NoEcom version when the metric filters ecom.
    // Falls back to the base field for compras (no NoEcom variant exists).
    function bf(b, field, fe) {
        if (fe) {
            const v = b[field + 'NoEcom'];
            if (v !== undefined) return v;
        }
        return b[field];
    }
    function bucketTickets(b, fe) {
        if (!b) return 0;
        const refs = fe && b.ticketRefsNoEcom ? b.ticketRefsNoEcom : b.ticketRefs;
        return refs ? Object.keys(refs).length : 0;
    }
    function bucketMultiTickets(b, fe) {
        if (!b) return 0;
        const refs = fe && b.ticketRefsNoEcom ? b.ticketRefsNoEcom : b.ticketRefs;
        return refs ? Object.values(refs).filter(c => c > 1).length : 0;
    }

    // Live per-KPI ecom-filter config. Loaded from Dexie on boot, editable in Configuracion.
    // Hardcoded defaults match the conventional meaning of each metric.
    const ECOM_DEFAULTS = {
        netSales: false, grossSales: false, refundsAmount: false, totalItems: false,
        tickets: true, multiTickets: true, pctMulti: true, avgItems: true,
        mobiles: true, mobilesTotal: true, services: true, pctServices: true,
        basics: true, pctBasics: true, pctCombo: true,
        buys: false, cashBuys: false, exchanges: false, pctVale: false,  // inert (no ecom variant)
        memberships: false,  // inert (captacion is in-store by definition)
        testOrders: false, testItems: false, testRatio: false,  // inert (test admissions are in-store)
        operTotal: false, operRefunds: false, operCashBuys: false, operExchanges: false  // inert (counts of refs)
    };
    const ECOM_CONFIG = { ...ECOM_DEFAULTS };
    // Families for the Settings UI. Compras family is excluded (ecom has no effect there).
    const ECOM_CONFIGURABLE_GROUPS = [
        { family: 'Ventas', keys: ['netSales', 'grossSales', 'refundsAmount', 'totalItems', 'tickets', 'multiTickets', 'pctMulti', 'avgItems'] },
        { family: 'Moviles', keys: ['mobiles', 'mobilesTotal', 'services', 'pctServices', 'basics', 'pctBasics', 'pctCombo'] }
    ];
    function metricFiltersEcom(key) { return !!ECOM_CONFIG[key]; }

    // Category -> Supercategory mapping (loaded from data/ at init)
    const CATEGORY_SUPERCATEGORY = {};   // { category: supercategory }
    let SUPERCATEGORY_LIST = [];          // declared order from the JSON + "Sin mapear" if needed
    const UNMAPPED_SUPER = 'Sin mapear';
    let supercategoryLoadPromise = null;  // memoized loader; consumers await it
    function loadSupercategoryMapping() {
        if (supercategoryLoadPromise) return supercategoryLoadPromise;
        supercategoryLoadPromise = (async () => {
            const res = await fetch('data/categories-supercategories.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data && data.mapping && typeof data.mapping === 'object') {
                for (const [cat, sup] of Object.entries(data.mapping)) {
                    CATEGORY_SUPERCATEGORY[cat] = sup;
                }
            }
            if (Array.isArray(data.supercategories)) {
                SUPERCATEGORY_LIST = data.supercategories.slice();
            } else {
                SUPERCATEGORY_LIST = [...new Set(Object.values(CATEGORY_SUPERCATEGORY))];
            }
        })();
        // Clear promise on failure so a later caller can retry.
        supercategoryLoadPromise.catch(() => { supercategoryLoadPromise = null; });
        return supercategoryLoadPromise;
    }
    function getSupercategory(category) {
        if (!category) return UNMAPPED_SUPER;
        return CATEGORY_SUPERCATEGORY[category] || UNMAPPED_SUPER;
    }

    // ============================
    // CAPTACION STORE NAME RECONCILIATION
    // ============================
    // El CSV de captacion trae nombres de tienda que no siempre coinciden con
    // Baby Banking:
    //   - Algunos van en MAYUSCULAS ("MADRID ISLAZUL")
    //   - Algunos sin tildes ("Alcala Magna" vs "Alcalá Magna")
    //   - Algunos con espaciado distinto ("ALCORCON TRES AGUAS" vs "Alcorcón TresAguas")
    //   - Unos pocos con palabras distintas ("Getafe" vs "Getafe Madrid")
    // Los tres primeros se resuelven automaticamente; el cuarto necesita un
    // alias manual en data/captacion-store-aliases.json.
    function normalizeStoreName(s) {
        if (!s || typeof s !== 'string') return '';
        // NFD splits accented chars; the regex strips combining marks (tildes, dieresis, etc.)
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();
    }
    function normalizeStoreNameCompact(s) {
        return normalizeStoreName(s).replace(/\s+/g, '');
    }

    // captacionAliasFactory holds the JSON defaults; captacionAliasUserOverrides
    // holds the user-edited entries from Configuracion. The final lookup map is
    // built lazily on demand and invalidated after every edit.
    let captacionAliasFactory = null;       // Map<normalizedKey, { rawKey, canonical }>
    let captacionAliasMergedPromise = null; // Promise<Map<normalizedKey, canonical>>

    async function loadCaptacionAliasFactory() {
        if (captacionAliasFactory) return captacionAliasFactory;
        const map = new Map();
        try {
            const res = await fetch('data/captacion-store-aliases.json', { cache: 'no-cache' });
            if (res.ok) {
                const data = await res.json();
                if (data && data.aliases && typeof data.aliases === 'object') {
                    for (const [key, value] of Object.entries(data.aliases)) {
                        map.set(normalizeStoreName(key), { rawKey: key, canonical: value });
                    }
                }
            }
        } catch (e) {
            console.warn('Captacion aliases factory load failed:', e);
        }
        captacionAliasFactory = map;
        return map;
    }

    async function getCaptacionAliasOverrides() {
        const stored = await Database.getSetting('captacionAliasOverrides');
        if (!stored || typeof stored !== 'object') return {};
        return stored;
    }

    async function setCaptacionAliasOverrides(obj) {
        await Database.setSetting('captacionAliasOverrides', obj || {});
        // Invalidate merged cache so next reconcile picks up the change
        captacionAliasMergedPromise = null;
    }

    function loadCaptacionAliases() {
        if (captacionAliasMergedPromise) return captacionAliasMergedPromise;
        captacionAliasMergedPromise = (async () => {
            const merged = new Map();
            const factory = await loadCaptacionAliasFactory();
            for (const [normKey, entry] of factory.entries()) {
                merged.set(normKey, entry.canonical);
            }
            const overrides = await getCaptacionAliasOverrides();
            for (const [rawKey, canonical] of Object.entries(overrides)) {
                if (canonical && typeof canonical === 'string') {
                    merged.set(normalizeStoreName(rawKey), canonical);
                }
            }
            return merged;
        })();
        captacionAliasMergedPromise.catch(() => { captacionAliasMergedPromise = null; });
        return captacionAliasMergedPromise;
    }

    /**
     * Build a reconcile(name) function that maps a captacion store name to
     * its canonical Baby Banking name. Returns null if no match found.
     */
    function makeCaptacionReconciler(bbStores, aliasMap) {
        const exactMap = new Map();
        const normMap = new Map();
        const compactMap = new Map();
        for (const s of bbStores) {
            if (!s || typeof s !== 'string') continue;
            exactMap.set(s.toLowerCase(), s);
            normMap.set(normalizeStoreName(s), s);
            compactMap.set(normalizeStoreNameCompact(s), s);
        }
        return function reconcile(name) {
            if (!name || typeof name !== 'string') return null;
            const norm = normalizeStoreName(name);
            // 1) Manual alias (matches by normalized key)
            if (aliasMap && aliasMap.has(norm)) return aliasMap.get(norm);
            // 2) Exact case-insensitive match against BB
            const exact = exactMap.get(name.toLowerCase());
            if (exact) return exact;
            // 3) Tildes-insensitive match
            const byNorm = normMap.get(norm);
            if (byNorm) return byNorm;
            // 4) Compact match (no spaces) for "TRES AGUAS" vs "TresAguas"
            const byCompact = compactMap.get(normalizeStoreNameCompact(name));
            if (byCompact) return byCompact;
            return null;
        };
    }

    // Raw metric definitions: each value/format/minOpsOf receives (b, fe).
    // A wrapper below injects the live fe from ECOM_CONFIG so callers still
    // invoke def.value(b) / def.format(v, b) as before.
    const RAW_METRICS = {
        // Ventas
        netSales:      { label: 'Ventas netas',          isCurrency: true,
            value: (b, fe) => bf(b, 'saleRevenue', fe) - bf(b, 'refundAmount', fe),
            format: v => formatCurrency(v) },
        grossSales:    { label: 'Ventas brutas',         isCurrency: true,
            value: (b, fe) => bf(b, 'saleRevenue', fe),
            format: v => formatCurrency(v) },
        refundsAmount: { label: 'Refunds',               isCurrency: true,
            value: (b, fe) => bf(b, 'refundAmount', fe),
            format: v => formatCurrency(v) },
        totalItems:    { label: 'Articulos vendidos',
            value: (b, fe) => bf(b, 'saleUnits', fe),
            format: v => (v || 0).toLocaleString('es-ES') },
        tickets:       { label: 'Tickets',
            value: (b, fe) => bucketTickets(b, fe),
            format: v => (v || 0).toLocaleString('es-ES') },
        multiTickets:  { label: 'Tickets multiples',
            value: (b, fe) => bucketMultiTickets(b, fe),
            format: v => (v || 0).toLocaleString('es-ES') },
        pctMulti:      { label: '% Venta complementaria', isPct: true,
            minOpsOf: (b, fe) => bucketTickets(b, fe),
            value: (b, fe) => { const t = bucketTickets(b, fe); return t > 0 ? (bucketMultiTickets(b, fe) / t) * 100 : 0; },
            format: (v, b, fe) => formatPctDetail(bucketMultiTickets(b, fe), bucketTickets(b, fe)) },
        avgItems:      { label: 'Media articulos/ticket', isPct: true,
            minOpsOf: (b, fe) => bucketTickets(b, fe),
            value: (b, fe) => { const t = bucketTickets(b, fe); return t > 0 ? bf(b, 'saleUnits', fe) / t : 0; },
            format: (v, b, fe) => {
                const t = bucketTickets(b, fe);
                const u = bf(b, 'saleUnits', fe);
                return t > 0 ? `${(u / t).toFixed(1)} <small class="pct-units">(${u}/${t})</small>` : '--';
            } },
        // Moviles
        mobiles:       { label: 'Moviles (uds)',
            value: (b, fe) => bf(b, 'mobiles', fe),
            format: v => (v || 0).toLocaleString('es-ES') },
        mobilesTotal:  { label: 'Moviles (EUR)',         isCurrency: true,
            value: (b, fe) => bf(b, 'mobilesTotal', fe),
            format: v => formatCurrency(v) },
        services:      { label: 'Protectores de gel',
            value: (b, fe) => bf(b, 'services', fe),
            format: v => (v || 0).toLocaleString('es-ES') },
        pctServices:   { label: '% Gel/Movil',           isPct: true,
            minOpsOf: (b, fe) => bf(b, 'mobiles', fe),
            value: (b, fe) => { const m = bf(b, 'mobiles', fe); return m > 0 ? (bf(b, 'services', fe) / m) * 100 : 0; },
            format: (v, b, fe) => formatPctDetail(bf(b, 'services', fe), bf(b, 'mobiles', fe)) },
        basics:        { label: 'Basics',
            value: (b, fe) => bf(b, 'basics', fe),
            format: v => (v || 0).toLocaleString('es-ES') },
        pctBasics:     { label: '% Basics/Movil',        isPct: true,
            minOpsOf: (b, fe) => bf(b, 'mobiles', fe),
            value: (b, fe) => { const m = bf(b, 'mobiles', fe); return m > 0 ? (bf(b, 'basics', fe) / m) * 100 : 0; },
            format: (v, b, fe) => formatPctDetail(bf(b, 'basics', fe), bf(b, 'mobiles', fe)) },
        pctCombo:      { label: '% Combo/Movil',         isPct: true,
            minOpsOf: (b, fe) => bf(b, 'mobiles', fe),
            value: (b, fe) => { const m = bf(b, 'mobiles', fe); return m > 0 ? ((bf(b, 'services', fe) + bf(b, 'basics', fe)) / m) * 100 : 0; },
            format: (v, b, fe) => formatPctDetail(bf(b, 'services', fe) + bf(b, 'basics', fe), bf(b, 'mobiles', fe)) },
        // Compras (ecom no aplica: no hay cash buys/exchanges online)
        buys:          { label: 'Compras (EUR)',         isCurrency: true,
            value: b => b.cashBuyAmount + b.exchangeAmount,
            format: v => formatCurrency(v) },
        cashBuys:      { label: 'Cash buys (EUR)',       isCurrency: true,
            value: b => b.cashBuyAmount,
            format: v => formatCurrency(v) },
        exchanges:     { label: 'Exchanges (EUR)',       isCurrency: true,
            value: b => b.exchangeAmount,
            format: v => formatCurrency(v) },
        pctVale:       { label: '% Vale',                isPct: true,
            value: b => { const t = b.cashBuyAmount + b.exchangeAmount; return t > 0 ? (b.exchangeAmount / t) * 100 : 0; },
            format: (v, b) => {
                const t = b.cashBuyAmount + b.exchangeAmount;
                return t > 0 ? formatPctDetail(Math.round(b.exchangeAmount), Math.round(t)) : '--';
            } },
        // Captacion (a nivel tienda)
        memberships:   { label: 'Socios',
            value: b => b.memberships || 0,
            format: v => (v || 0).toLocaleString('es-ES') },
        // Admision a test (a nivel tienda)
        testOrders:    { label: 'Ordenes de test',
            value: b => Object.keys(b.testOrderRefs || {}).length,
            format: v => (v || 0).toLocaleString('es-ES') },
        testItems:     { label: 'Items admitidos a test',
            value: b => b.testItems || 0,
            format: v => (v || 0).toLocaleString('es-ES') },
        testRatio:     { label: 'Ratio de ordenes de test', isPct: true,
            minOpsOf: b => Object.keys(b.counterRefs || {}).length,
            value: b => {
                const denom = Object.keys(b.counterRefs || {}).length;
                const num = Object.keys(b.testOrderRefs || {}).length;
                return denom > 0 ? (num / denom) * 100 : 0;
            },
            format: (v, b) => {
                const denom = Object.keys(b.counterRefs || {}).length;
                const num = Object.keys(b.testOrderRefs || {}).length;
                return formatPctDetail(num, denom);
            } },
        // Operaciones (Order Numbers unicos por tipo). Una misma orden puede
        // contener compras y ventas a la vez; cada movimiento suma en su tipo.
        operTotal:     { label: 'Operaciones',
            value: b => Object.keys(b.counterRefs || {}).length,
            format: v => (v || 0).toLocaleString('es-ES') },
        operRefunds:   { label: 'Refunds (n)',
            value: b => Object.keys(b.refundOrderRefs || {}).length,
            format: v => (v || 0).toLocaleString('es-ES') },
        operCashBuys:  { label: 'Cash buys (n)',
            value: b => Object.keys(b.cashBuyOrderRefs || {}).length,
            format: v => (v || 0).toLocaleString('es-ES') },
        operExchanges: { label: 'Exchanges (n)',
            value: b => Object.keys(b.exchangeOrderRefs || {}).length,
            format: v => (v || 0).toLocaleString('es-ES') }
    };

    // Wrap each raw metric so callers keep using def.value(b), def.format(v, b),
    // def.minOpsOf(b). The live filterEcom flag is injected from ECOM_CONFIG.
    const METRICS = {};
    for (const [key, raw] of Object.entries(RAW_METRICS)) {
        METRICS[key] = {
            key,
            label: raw.label,
            isPct: raw.isPct,
            isCurrency: raw.isCurrency,
            value: (b) => raw.value(b, metricFiltersEcom(key)),
            format: (v, b) => raw.format(v, b, metricFiltersEcom(key)),
            minOpsOf: raw.minOpsOf ? (b) => raw.minOpsOf(b, metricFiltersEcom(key)) : undefined
        };
    }

    // ============================
    // EVOLUTION TABLE
    // ============================
    let evoState = {
        rowWeekData: {},
        weeks: [],
        metric: 'netSales',
        sortCol: null,
        sortDir: 'desc',
        selectedRow: null,  // clicked row for chart highlight
        // Compare-KPIs mode
        compareMode: false,
        compareSubject: null,     // store name when a single store is fixed
        compareWeekData: null,    // {weekN: bucket} for that subject
        selectedKpis: null        // Set<metricKey>, null until initialized
    };

    // Default KPIs to show in compare mode (registry order within these)
    const DEFAULT_COMPARE_KPIS = ['netSales', 'tickets', 'pctMulti', 'mobiles', 'pctServices', 'pctVale'];

    function initEvoKpiMultiSelect() {
        const trigger = document.getElementById('evo-kpi-trigger');
        const panel = document.getElementById('evo-kpi-panel');
        if (!trigger || !panel) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !trigger.contains(e.target)) {
                panel.classList.remove('open');
            }
        });

        document.getElementById('evo-kpi-all').addEventListener('change', (e) => {
            evoState.selectedKpis = e.target.checked
                ? new Set(Object.keys(METRICS))
                : new Set();
            updateEvoKpiUI();
            refreshEvolution();
        });

        document.getElementById('evo-kpi-search').addEventListener('input', renderEvoKpiList);

        document.getElementById('evo-kpi-list').addEventListener('change', (e) => {
            if (!e.target.matches('input[type="checkbox"]')) return;
            const key = e.target.dataset.value;
            if (!evoState.selectedKpis) evoState.selectedKpis = new Set(DEFAULT_COMPARE_KPIS);
            if (e.target.checked) evoState.selectedKpis.add(key);
            else evoState.selectedKpis.delete(key);
            updateEvoKpiUI();
            refreshEvolution();
        });

        document.getElementById('evo-kpi-reset').addEventListener('click', () => {
            evoState.selectedKpis = new Set(DEFAULT_COMPARE_KPIS);
            updateEvoKpiUI();
            refreshEvolution();
        });
    }

    function renderEvoKpiList() {
        const listEl = document.getElementById('evo-kpi-list');
        const searchEl = document.getElementById('evo-kpi-search');
        if (!listEl) return;
        const term = ((searchEl && searchEl.value) || '').toLowerCase();
        if (!evoState.selectedKpis) evoState.selectedKpis = new Set(DEFAULT_COMPARE_KPIS);
        const keys = Object.keys(METRICS);
        const filtered = term
            ? keys.filter(k => METRICS[k].label.toLowerCase().includes(term))
            : keys;
        if (!filtered.length) {
            listEl.innerHTML = '<div class="multi-select-option" style="color:var(--color-text-lighter);justify-content:center;">Sin coincidencias</div>';
            return;
        }
        listEl.innerHTML = filtered.map(k => {
            const checked = evoState.selectedKpis.has(k) ? 'checked' : '';
            const lbl = DG_COLUMN_LABELS[k];
            const tip = lbl ? lbl.title : METRICS[k].label;
            return `<label class="multi-select-option" title="${escapeHtml(tip)}">
                <input type="checkbox" data-value="${k}" ${checked}>
                <span class="multi-select-option-label">${escapeHtml(METRICS[k].label)}</span>
            </label>`;
        }).join('');
    }

    /**
     * Refresh the popover next to the single-metric dropdown so it documents
     * the currently selected KPI. The trigger is a normal .info-btn, the
     * existing CSS handles the show-on-hover behavior.
     */
    function updateEvoMetricInfo() {
        const select = document.getElementById('evo-metric');
        const pop = document.getElementById('evo-metric-info-pop');
        if (!select || !pop) return;
        const key = select.value;
        const def = METRICS[key];
        const lbl = DG_COLUMN_LABELS[key];
        const titleText = def ? def.label : key;
        const desc = lbl ? lbl.title : (def ? def.label : '');
        pop.innerHTML = `<span class="info-pop-title">${escapeHtml(titleText)}</span>
            <span>${escapeHtml(desc)}</span>`;
    }

    function updateEvoKpiUI() {
        if (!evoState.selectedKpis) evoState.selectedKpis = new Set(DEFAULT_COMPARE_KPIS);
        const total = Object.keys(METRICS).length;
        const n = evoState.selectedKpis.size;
        const countEl = document.getElementById('evo-kpi-count');
        const allCb = document.getElementById('evo-kpi-all');
        if (countEl) countEl.textContent = `${n}/${total}`;
        if (allCb) allCb.checked = n === total && total > 0;
        renderEvoKpiList();
    }

    function updateEvoModeVisibility() {
        const compare = !!evoState.compareMode;
        document.querySelectorAll('#section-dash-store .evo-single-only').forEach(el => {
            el.classList.toggle('hidden', compare);
        });
        document.querySelectorAll('#section-dash-store .evo-compare-only').forEach(el => {
            el.classList.toggle('hidden', !compare);
        });
        const chartBtn = document.getElementById('btn-toggle-chart');
        const chartSection = document.getElementById('evo-chart-section');
        if (chartBtn) {
            chartBtn.disabled = compare;
            chartBtn.title = compare ? 'No aplica al comparar KPIs (usa las sparklines por fila)' : '';
        }
        if (compare && chartSection) chartSection.classList.add('collapsed');
    }

    function renderSparkline(values, width, height) {
        width = width || 120;
        height = height || 22;
        const nums = values.map(v => (typeof v === 'number' && isFinite(v)) ? v : null);
        const valid = nums.filter(v => v !== null);
        if (valid.length < 2) {
            return `<svg class="evo-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
        }
        const min = Math.min.apply(null, valid);
        const max = Math.max.apply(null, valid);
        const range = max - min || 1;
        const pad = 2;
        const innerW = width - pad * 2;
        const innerH = height - pad * 2;
        const step = nums.length > 1 ? innerW / (nums.length - 1) : 0;
        const pointY = (v) => pad + innerH - ((v - min) / range) * innerH;
        const segs = [];
        let cur = [];
        nums.forEach((v, i) => {
            if (v === null) {
                if (cur.length > 1) segs.push(cur);
                cur = [];
            } else {
                cur.push(`${(pad + i * step).toFixed(1)},${pointY(v).toFixed(1)}`);
            }
        });
        if (cur.length > 1) segs.push(cur);
        let svgInner = segs.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`).join('');
        for (let i = nums.length - 1; i >= 0; i--) {
            if (nums[i] !== null) {
                svgInner += `<circle cx="${(pad + i * step).toFixed(1)}" cy="${pointY(nums[i]).toFixed(1)}" r="2" fill="currentColor" />`;
                break;
            }
        }
        return `<svg class="evo-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgInner}</svg>`;
    }

    // Dashboard: General state (sort + store multi-select filter + column selection)
    // Saved store groups live in a shared module-level state (STORE_GROUPS) so
    // Vista general and Vista detalle share the same groups.
    let dgState = {
        sortCol: null,
        sortDir: 'desc',
        visibleStores: null,   // Set<string>; null = "all" fallback until first render
        storesTouched: false,
        allStores: [],
        columns: null,         // ordered array of METRICS keys; null = use default
        columnsLoaded: false
    };

    // Default columns for Vista general (current defaults as approved)
    const DG_DEFAULT_COLUMNS = ['netSales', 'buys', 'pctVale', 'pctMulti', 'pctServices', 'pctBasics'];

    // Short labels used in the Vista general header (overrides METRICS.label for compactness)
    const DG_COLUMN_LABELS = {
        netSales:      { label: 'Ventas',         title: 'Ventas netas = ventas brutas - refunds' },
        grossSales:    { label: 'V. brutas',      title: 'Ventas brutas (sum de sales)' },
        refundsAmount: { label: 'Refunds',        title: 'Importe de refunds' },
        totalItems:    { label: 'Articulos',      title: 'Articulos vendidos' },
        tickets:       { label: 'Tickets',        title: 'Numero de tickets unicos' },
        multiTickets:  { label: 'T. multiples',   title: 'Tickets con >1 linea' },
        pctMulti:      { label: '% Venta compl.', title: 'Tickets con >1 linea / tickets totales' },
        avgItems:      { label: 'Art/tck',        title: 'Media de articulos por ticket' },
        mobiles:       { label: 'Moviles',        title: 'Moviles vendidos (uds)' },
        mobilesTotal:  { label: 'Moviles EUR',    title: 'Importe total de moviles' },
        services:      { label: 'Services',       title: 'Services vendidos (uds)' },
        pctServices:   { label: '% Gel/Mvl',      title: 'Services / moviles' },
        basics:        { label: 'Basics',         title: 'Basics vendidos (uds)' },
        pctBasics:     { label: '% Basics/Mvl',   title: 'Basics / moviles' },
        pctCombo:      { label: '% Combo/Mvl',    title: '(Services + Basics) / moviles' },
        buys:          { label: 'Compras',        title: 'Cash buy + exchange' },
        cashBuys:      { label: 'Cash buys',      title: 'Compras en efectivo' },
        exchanges:     { label: 'Exchanges',      title: 'Compras en vale' },
        pctVale:       { label: '% Vale',         title: '% de compras hechas con vale de tienda (exchange)' },
        memberships:   { label: 'Socios',         title: 'Socios captados en el rango de semanas' },
        testOrders:    { label: 'Ord. test',      title: 'Numero de ordenes de admision a test (Order Numbers unicos con type=test-admission)' },
        testItems:     { label: 'Items test',     title: 'Suma de Quantity en las filas Transfer/Test (items admitidos a test)' },
        testRatio:     { label: '% Ord. test',    title: 'Ordenes de test / Operaciones totales (Order Numbers unicos con type sale | cash buy | exchange | refund | test-admission)' },
        operTotal:     { label: 'Operaciones',    title: 'Operaciones totales: Order Numbers unicos con type sale | cash buy | exchange | refund | test-admission. Una misma orden puede contener compras y ventas; cada tipo cuenta una vez en su propia metrica' },
        operRefunds:   { label: 'Refunds (n)',    title: 'Numero de operaciones de refund (Order Numbers unicos con type=refund)' },
        operCashBuys:  { label: 'Cash buys (n)',  title: 'Numero de operaciones de cash buy (Order Numbers unicos con type=cash buy)' },
        operExchanges: { label: 'Exchanges (n)',  title: 'Numero de operaciones de exchange (Order Numbers unicos con type=exchange)' }
    };

    // Dashboard: Detail state (sort + multi-select filters + grouping + axis)
    let ddState = {
        sortCol: null,
        sortDir: 'desc',
        groupBy: 'cat',        // 'cat' | 'sup' — columns (or rows, when swapped) level
        axisMode: 'store-rows',// 'store-rows' | 'group-rows'
        configLoaded: false,
        visibleCats: null,     // Set<string> of selected categories; null = "all" fallback
        visibleStores: null,   // Set<string>
        visibleSupers: null,   // Set<string> of selected supercategories; null = "all" fallback
        catsTouched: false,    // user manually altered category selection
        storesTouched: false,
        supersTouched: false,
        allCats: [],           // full list seen last render (for the panel UI)
        allStores: [],
        allSupers: [],
        lastAutoMetric: null,  // metric used to compute default top 5 last time
        lastAutoRange: null    // "weekFrom-weekTo-groupBy-axis" key for default recompute check
    };

    async function refreshEvolution() {
        const available = await updateAvailableWeeksLabel('evo-available');
        const fromEl = document.getElementById('evo-week-from');
        const toEl = document.getElementById('evo-week-to');
        if (!parseInt(toEl.value) || parseInt(toEl.value) < 1) {
            if (available) {
                fromEl.value = available.weekMin;
                toEl.value = available.weekMax;
            } else {
                const today = new Date().toISOString().substring(0, 10);
                const currentWeek = KPIEngine.helpers.businessWeek(today);
                fromEl.value = Math.max(1, currentWeek - 3);
                toEl.value = currentWeek;
            }
        }
        const weekFrom = parseInt(fromEl.value) || 1;
        const weekTo = parseInt(toEl.value) || weekFrom;
        evoState.metric = document.getElementById('evo-metric').value;
        const store = getStoreValue('kpi-panel-store');

        // Compare-KPIs mode: active when a single store is fixed
        const compareSubject = store && store !== 'all' ? store : null;
        evoState.compareMode = !!compareSubject;
        evoState.compareSubject = compareSubject;
        if (!evoState.selectedKpis) {
            evoState.selectedKpis = new Set(DEFAULT_COMPARE_KPIS);
            updateEvoKpiUI();
        }
        updateEvoModeVisibility();

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

        const allData = await Database.getAllOperations();
        let records = allData;
        if (store && store !== 'all') {
            records = records.filter(r => r.store === store);
        }
        // Ecom filtering is per-KPI (see Configuracion): buckets store both
        // variants, metrics pick the right one. No record-level filter here.

        // Compare-KPIs branch: aggregate one bucket per week for the fixed store
        if (evoState.compareMode) {
            evoState.compareWeekData = {};
            for (const r of records) {
                const wk = r.week;
                if (wk < weekFrom || wk > weekTo) continue;
                if (!evoState.compareWeekData[wk]) evoState.compareWeekData[wk] = emptyBucket();
                addToBucket(evoState.compareWeekData[wk], r);
            }
            renderCompareKPIs();
            return;
        }

        evoState.rowWeekData = {};
        for (const r of records) {
            const wk = r.week;
            if (wk < weekFrom || wk > weekTo) continue;
            const key = r.store || '?';
            if (!evoState.rowWeekData[key]) evoState.rowWeekData[key] = {};
            if (!evoState.rowWeekData[key][wk]) evoState.rowWeekData[key][wk] = emptyBucket();
            addToBucket(evoState.rowWeekData[key][wk], r);
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
        const wd = evoState.rowWeekData[name];
        if (col === 'name') return name.toLowerCase();
        const def = METRICS[metric];
        if (!def) return 0;
        let bucket;
        if (col === 'total') {
            bucket = emptyBucket();
            for (const wk of weeks) { const c = wd?.[wk]; if (c) mergeBuckets(bucket, c); }
        } else {
            bucket = wd?.[col] || emptyBucket();
        }
        const v = def.value(bucket);
        // For pct metrics without denominator, sort to bottom
        if (def.isPct && v === 0 && def.minOpsOf && def.minOpsOf(bucket) === 0) return -1;
        return v;
    }

    function evoCellValue(cellData, metricKey) {
        const def = METRICS[metricKey];
        if (!def) return '0';
        const bucket = cellData || emptyBucket();
        if (!cellData) {
            if (def.isPct) return '--';
            if (def.isCurrency) return formatCurrency(0);
            return '0';
        }
        return def.format(def.value(bucket), bucket);
    }

    function evoRowTotal(weekData, metricKey, weeks) {
        const def = METRICS[metricKey];
        if (!def) return 0;
        const bucket = emptyBucket();
        for (const wk of weeks) { const c = weekData[wk]; if (c) mergeBuckets(bucket, c); }
        return def.format(def.value(bucket), bucket);
    }

    function renderCompareKPIs() {
        const { compareSubject, compareWeekData, weeks } = evoState;
        const thead = document.getElementById('evo-thead');
        const tbody = document.getElementById('evo-tbody');
        const tfoot = document.getElementById('evo-tfoot');

        const selectedKeys = Object.keys(METRICS).filter(k => evoState.selectedKpis.has(k));
        const colCount = weeks.length + 3;

        thead.innerHTML = `<tr>
            <th>KPI <span class="col-subject-hint">(Tienda: ${escapeHtml(compareSubject)})</span></th>
            <th class="col-spark">Evolucion</th>
            ${weeks.map(w => `<th>W${w}</th>`).join('')}
            <th class="col-total"><strong>Total</strong></th>
        </tr>`;

        if (!selectedKeys.length) {
            tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-msg">Selecciona al menos un KPI en el filtro.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }
        if (!weeks.length) {
            tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-msg">Sin semanas en el rango.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        const weekBuckets = weeks.map(w => compareWeekData?.[w] || null);
        const anyData = weekBuckets.some(b => b);

        if (!anyData) {
            tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-msg">Sin datos para "${escapeHtml(compareSubject)}" en el rango seleccionado.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        tbody.innerHTML = selectedKeys.map(mk => {
            const def = METRICS[mk];
            const lbl = DG_COLUMN_LABELS[mk];
            const tooltip = lbl ? lbl.title : def.label;
            const rawVals = weekBuckets.map(b => {
                if (!b) return null;
                if (def.isPct && def.minOpsOf && def.minOpsOf(b) === 0) return null;
                return def.value(b);
            });
            const spark = renderSparkline(rawVals);
            const cells = weekBuckets.map(b => {
                if (!b) return `<td class="cell-empty">${def.isPct ? '--' : (def.isCurrency ? formatCurrency(0) : '0')}</td>`;
                return `<td>${def.format(def.value(b), b)}</td>`;
            }).join('');
            const totalBucket = emptyBucket();
            for (const b of weekBuckets) if (b) mergeBuckets(totalBucket, b);
            const totalCell = def.format(def.value(totalBucket), totalBucket);
            return `<tr>
                <td class="evo-kpi-name" title="${escapeHtml(tooltip)}">${escapeHtml(def.label)}</td>
                <td class="col-spark">${spark}</td>
                ${cells}
                <td class="col-total"><strong>${totalCell}</strong></td>
            </tr>`;
        }).join('');

        tfoot.innerHTML = '';
    }

    function renderEvolution() {
        const { rowWeekData, weeks, metric, sortCol, sortDir } = evoState;
        const thead = document.getElementById('evo-thead');
        const tbody = document.getElementById('evo-tbody');
        const tfoot = document.getElementById('evo-tfoot');

        const sortCls = (col) => {
            if (sortCol !== col) return '';
            return sortDir === 'desc' ? ' sort-desc' : ' sort-asc';
        };

        thead.innerHTML = `<tr>
            <th class="col-rank">#</th>
            <th class="sortable${sortCls('name')}" data-evo-sort="name">Tienda</th>
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

        let rowNames = Object.keys(rowWeekData);

        if (rowNames.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${weeks.length + 3}" class="empty-msg">Sin datos para estas semanas.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        // Sort: default by total desc, or by clicked column
        const rankCol = sortCol || 'total';
        const rankDir = sortCol ? sortDir : 'desc';
        rowNames.sort((a, b) => {
            const va = evoSortValue(a, rankCol, metric, weeks);
            const vb = evoSortValue(b, rankCol, metric, weeks);
            if (typeof va === 'string') return rankDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return rankDir === 'asc' ? va - vb : vb - va;
        });

        // Filter by min operations for percentage/average metrics
        const metricDef = METRICS[metric];
        if (metricDef?.isPct && metricDef.minOpsOf) {
            const minOps = parseInt(document.getElementById('evo-min-ops').value) || 0;
            if (minOps > 0) {
                rowNames = rowNames.filter(key => {
                    let total = 0;
                    for (const wk of weeks) {
                        const c = rowWeekData[key]?.[wk];
                        if (c) total += metricDef.minOpsOf(c);
                    }
                    return total >= minOps;
                });
            }
        }

        // Apply top-n filter
        const topNVal = document.getElementById('evo-top-n').value;
        if (topNVal !== 'all') {
            rowNames = rowNames.slice(0, parseInt(topNVal));
        }

        tbody.innerHTML = rowNames.map((key, idx) => {
            const wd = rowWeekData[key];
            const selected = evoState.selectedRow === key ? ' class="evo-row-selected"' : '';
            return `<tr${selected} data-row="${escapeHtml(key)}">
                <td class="col-rank">${idx + 1}</td>
                <td>${escapeHtml(key)}</td>
                ${weeks.map(w => `<td>${evoCellValue(wd?.[w], metric)}</td>`).join('')}
                <td class="col-total"><strong>${evoRowTotal(wd || {}, metric, weeks)}</strong></td>
            </tr>`;
        }).join('');

        if (rowNames.length > 1) {
            const colTotals = {};
            for (const w of weeks) {
                colTotals[w] = emptyBucket();
                for (const name of rowNames) {
                    const c = rowWeekData[name]?.[w];
                    if (c) mergeBuckets(colTotals[w], c);
                }
            }
            tfoot.innerHTML = `<tr data-row="__TOTAL__">
                <td class="col-rank"></td>
                <td>TOTAL</td>
                ${weeks.map(w => `<td><strong>${evoCellValue(colTotals[w], metric)}</strong></td>`).join('')}
                <td class="col-total"><strong>${evoRowTotal(colTotals, metric, weeks)}</strong></td>
            </tr>`;
        } else {
            tfoot.innerHTML = '';
        }

        // Click any row to select for chart
        function selectRow(name, tr) {
            evoState.selectedRow = evoState.selectedRow === name ? null : name;
            const table = document.getElementById('evo-table');
            table.querySelectorAll('tr').forEach(r => r.classList.remove('evo-row-selected'));
            if (evoState.selectedRow) tr.classList.add('evo-row-selected');
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

        document.querySelectorAll('#evo-table tr[data-row]').forEach(tr => {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => selectRow(tr.dataset.row, tr));
        });

        // Conditional gradient for absolute metrics
        if (metricDef && !metricDef.isPct) {
            const evoExtractor = (cell) => cell ? (metricDef.value(cell) || 0) : 0;
            applyHeatmap('evo-table', rowWeekData, weeks, evoExtractor);
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
        netSales: 'Ventas netas = ventas brutas - refunds',
        grossSales: 'Suma de ventas (type=sale)',
        refundsAmount: 'Importe de devoluciones (valor absoluto)',
        totalItems: 'Unidades vendidas (lineas de venta)',
        tickets: 'Numero de tickets unicos (Order Number distintos en sales)',
        multiTickets: 'Tickets con mas de 1 linea',
        pctMulti: '% Venta complementaria.\nNumerador: tickets con >1 linea\nDenominador: tickets totales',
        avgItems: 'Media de articulos por ticket.\nNumerador: articulos\nDenominador: tickets',
        pctServices: 'Porcentaje de geles (Services)\nvendidos por movil.\n\nNumerador: lineas Services\nDenominador: lineas Moviles',
        pctBasics: 'Porcentaje de CeX Basics\nvendidos por movil.\n\nNumerador: lineas Basics\nDenominador: lineas Moviles',
        pctCombo: 'Porcentaje combinado de\ngeles + basics por movil.\n\nNumerador: Services + Basics\nDenominador: lineas Moviles',
        mobiles: 'Unidades de moviles vendidos\n(lineas con categoria "Moviles")',
        mobilesTotal: 'Importe total de moviles vendidos',
        services: 'Unidades de Services vendidos\n(lineas con categoria "Services")',
        basics: 'Unidades de CeX Basics vendidos\n(lineas con categoria "basics")',
        buys: 'Compras totales (cash buy + exchange) en valor absoluto',
        cashBuys: 'Compras pagadas en efectivo',
        exchanges: 'Compras pagadas en vale de tienda (mas rentables)',
        pctVale: '% de compras pagadas en vale.\nNumerador: exchange EUR\nDenominador: cash buy + exchange EUR'
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
        const { rowWeekData, weeks } = evoState;

        document.getElementById('evo-chart-info').dataset.tip = CHART_METRIC_INFO[chartMetric] || '';

        const canvas = document.getElementById('evo-chart');
        if (!canvas) { console.error('Canvas not found'); return; }

        if (evoChartInstance) {
            evoChartInstance.destroy();
            evoChartInstance = null;
        }

        const allRows = Object.keys(rowWeekData);
        if (weeks.length === 0 || allRows.length === 0) return;

        // Ensure canvas has dimensions
        const container = canvas.parentElement;
        if (container.offsetHeight === 0) {
            console.warn('Chart container has no height, skipping render');
            return;
        }

        const labels = weeks.map(w => `W${w}`);
        const metricDef = METRICS[chartMetric];
        const isPct = !!metricDef?.isPct;
        const isCurrency = !!metricDef?.isCurrency;
        const topNVal = document.getElementById('evo-top-n').value;
        const showTotal = allRows.length === 1;
        const maxLines = topNVal === 'all' ? 999 : parseInt(topNVal) || 999;

        const colors = [
            '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
            '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1',
            '#be123c', '#0d9488', '#c026d3', '#ca8a04', '#475569'
        ];

        // Aggregate total bucket across all rows for a week
        const totalBucketAtWeek = (w) => {
            const b = emptyBucket();
            for (const name of allRows) {
                const c = rowWeekData[name]?.[w];
                if (c) mergeBuckets(b, c);
            }
            return b;
        };

        let datasets;

        const selected = evoState.selectedRow;
        if (selected === '__TOTAL__' || (showTotal && !selected)) {
            const data = weeks.map(w => evoChartValue(totalBucketAtWeek(w), chartMetric));
            datasets = [{ label: 'Total', data, borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 4 }];
        } else if (selected && rowWeekData[selected] && !showTotal) {
            const selData = weeks.map(w => evoChartValue(rowWeekData[selected]?.[w], chartMetric));
            const totalData = weeks.map(w => evoChartValue(totalBucketAtWeek(w), chartMetric));
            datasets = [
                { label: selected.split(' ').slice(0, 2).join(' '), data: selData, borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 5, borderWidth: 3 },
                { label: 'Total', data: totalData, borderColor: '#94a3b8', backgroundColor: 'transparent', tension: 0.3, pointRadius: 3, borderWidth: 1.5, borderDash: [4, 3] }
            ];
        } else if (showTotal) {
            const data = weeks.map(w => evoChartValue(totalBucketAtWeek(w), chartMetric));
            datasets = [{ label: 'Total', data, borderColor: colors[0], backgroundColor: colors[0] + '20', tension: 0.3, fill: true, pointRadius: 4 }];
        } else {
            const rankCol = evoState.sortCol || 'total';
            const ranked = allRows
                .map(name => ({ name, val: evoSortValue(name, rankCol, chartMetric, weeks) }))
                .sort((a, b) => b.val - a.val)
                .slice(0, maxLines);

            datasets = ranked.map(({ name }, i) => ({
                label: name.split(' ').slice(0, 2).join(' '),
                data: weeks.map(w => evoChartValue(rowWeekData[name]?.[w], chartMetric)),
                borderColor: colors[i % colors.length],
                backgroundColor: colors[i % colors.length] + '15',
                tension: 0.3,
                pointRadius: 3,
                borderWidth: 2
            }));

            // Aggregate Total line for context (skip for pct: averaging makes no sense).
            if (!isPct) {
                const totalData = weeks.map(w => evoChartValue(totalBucketAtWeek(w), chartMetric));
                datasets.push({
                    label: 'Total',
                    data: totalData,
                    borderColor: '#64748b',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 3,
                    borderWidth: 1.5,
                    borderDash: [5, 4]
                });
            }
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
                                const suffix = isPct ? val + '%' : isCurrency ? formatCurrency(val) : val;
                                return `${ctx.dataset.label}: ${suffix}`;
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
                            callback: val => isPct ? val + '%' : isCurrency ? formatCurrency(val) : val,
                            mirror: true,
                            padding: 4,
                            align: 'end'
                        },
                        grid: { color: '#f1f5f9' },
                        afterFit: (axis) => { axis.width = 55; }
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
        const def = METRICS[metricKey];
        if (!def) return 0;
        const v = def.value(cellData);
        return def.isPct ? Math.round(v) : (def.isCurrency ? Math.round(v) : v);
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

            // Captacion: replace-by-date-range (no per-row dedup key,
            // since Member Id is intentionally discarded for anonymization).
            if (currentImportSource === 'captacion') {
                await confirmCaptacionImport(result.records, file.name);
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
            resetDashboardFilters();
            await renderImportHistory();
            await renderEcomTimeline();
            await refreshHome();
        } catch (err) {
            UI.hideProgress();
            UI.addLog(`Error: ${err.message}`, 'error');
        }
    }

    // ============================
    // CAPTACION (Store Memberships) IMPORT
    // ============================
    // Strategy: replace-by-date-range. The CSV is treated as the source of
    // truth for the dates it covers. Existing captacion rows in that range
    // are deleted before adding the new ones. This avoids needing a
    // per-row dedup key (Member Id is intentionally not stored, GDPR).
    async function confirmCaptacionImport(records, filename) {
        if (!records.length) {
            UI.hideProgress();
            UI.addLog('No se encontraron filas validas en el CSV de captacion.', 'error');
            currentPreviewData = null;
            return;
        }

        // Build a reconciliation function that maps any captacion store name
        // to the canonical Baby Banking name. Cascade:
        //   1) manual alias from data/captacion-store-aliases.json
        //   2) exact match (case-insensitive) against BB stores
        //   3) tildes-insensitive match
        //   4) compact match (also collapses spaces) for "TRES AGUAS" vs "TresAguas"
        // If nothing matches, the name is returned unchanged and listed as unmatched.
        const knownStores = await Database.getDistinctValues('store');
        const aliases = await loadCaptacionAliases();
        const reconcile = makeCaptacionReconciler(knownStores, aliases);

        // Apply to incoming records
        let resolved = 0;
        const unmatchedSet = new Set();
        for (const r of records) {
            if (!r.store) continue;
            const canonical = reconcile(r.store);
            if (!canonical) {
                unmatchedSet.add(r.store);
                continue;
            }
            if (canonical !== r.store) {
                r.store = canonical;
                resolved++;
            }
        }
        if (resolved > 0) {
            UI.addLog(`Tiendas normalizadas al canon de Baby Banking: ${resolved.toLocaleString()} filas entrantes`, 'success');
        }
        if (unmatchedSet.size > 0) {
            const sample = [...unmatchedSet].slice(0, 5).join(', ');
            const more = unmatchedSet.size > 5 ? ` (+${unmatchedSet.size - 5})` : '';
            UI.addLog(`Aviso: ${unmatchedSet.size} tiendas sin match en Baby Banking: ${sample}${more}. Anade un alias en data/captacion-store-aliases.json.`, 'error');
        }

        // Also retro-fix existing captacion rows in DB so they pick up
        // any new alias/normalization rule without forcing re-import.
        const retroFixed = await Database.renormalizeStoresForSource('captacion', s => reconcile(s) || s);
        if (retroFixed > 0) {
            UI.addLog(`Tiendas previas renormalizadas en BD: ${retroFixed.toLocaleString()} filas`, 'success');
        }

        const dates = records.map(r => r.date).filter(Boolean).sort();
        const dateFrom = dates[0];
        const dateTo = dates[dates.length - 1];

        // Captacion se almacena AGREGADA por (store, date). Sin Order Number,
        // Member Id ni Staff que distingan socios individuales (todo descartado
        // por GDPR/anonimizacion), una fila por socio es almacenamiento puro
        // tonto. Una fila por (tienda, dia) con quantity = socios captados ese
        // dia ocupa ~10x menos sin perder informacion para los KPIs.
        const totalMembers = records.length;
        const grouped = {};
        for (const r of records) {
            if (!r.store || !r.date) continue;
            const key = `${r.store}\t${r.date}`;
            if (!grouped[key]) {
                grouped[key] = {
                    type: 'membership',
                    store: r.store,
                    date: r.date,
                    quantity: 0
                };
            }
            grouped[key].quantity += 1;
        }
        const aggregated = Object.values(grouped);

        UI.showProgress(0, 1, 'Reemplazando rango previo de captacion...');
        const deleted = await Database.replaceOperationsByDateRange('captacion', dateFrom, dateTo);
        if (deleted > 0) {
            UI.addLog(`Reemplazo: ${deleted.toLocaleString()} filas previas de captacion en ${UI.formatDate(dateFrom)} — ${UI.formatDate(dateTo)} eliminadas`, 'success');
        }

        UI.showProgress(0, aggregated.length, 'Guardando socios...');
        const weekFn = KPIEngine.helpers.businessWeek;
        const added = await Database.bulkAddOperations(aggregated, (current, total) => {
            UI.showProgress(current, total);
        }, weekFn, 'captacion');

        const storeSet = new Set(aggregated.map(r => r.store).filter(Boolean));
        await Database.logImport({
            source: 'captacion',
            filename,
            rowCount: totalMembers,  // socios captados (no filas en BD, que es menor por la agregacion)
            dateFrom,
            dateTo,
            storeCount: storeSet.size,
            stores: [...storeSet]
        });

        UI.hideProgress();
        UI.addLog(`Captacion OK: ${totalMembers.toLocaleString()} socios captados (${added.toLocaleString()} filas (tienda, dia) en BD)`, 'success');

        currentPreviewData = null;
        resetDashboardFilters();
        await renderImportHistory();
        await refreshHome();
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
            resetDashboardFilters();
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

        renderEcomConfigUI();
        await renderAliasEditor();
        await renderCleanupSourcePanel();

        if (DriveSync.isConnected()) {
            const info = await DriveSync.getBackupInfo();
            UI.updateDriveStatus(info ? `Conectado. Ultimo backup: ${info.lastModified}` : 'Conectado.');
        }
    }

    // ============================
    // CLEANUP BY SOURCE (Configuracion profunda)
    // ============================
    // Wipe a single import source from the active DB without affecting the
    // others or the configuration. Settings (course start, ecom-per-KPI,
    // captacion aliases) are never touched.
    async function renderCleanupSourcePanel() {
        const tbody = document.getElementById('cleanup-source-tbody');
        if (!tbody) return;

        const summary = await Database.getStorageSummaryBySource();

        // Show a fixed list of known sources first (so the panel is consistent
        // even when one source has 0 rows), followed by any unknown ones we
        // happen to find. Stocks/attachment are skipped: no importer yet.
        const knownOrder = ['baby-banking', 'baby-banking-ic', 'ecom', 'captacion'];
        const knownSet = new Set(knownOrder);
        const extraSources = Object.keys(summary).filter(s => !knownSet.has(s)).sort();
        const ordered = [...knownOrder, ...extraSources];

        const rows = ordered.map(src => {
            const info = summary[src] || { rowCount: 0, importCount: 0, dateFrom: null, dateTo: null, ecomTaggedCount: 0 };
            const label = SOURCE_LABELS[src] || src;
            const hasData = info.rowCount > 0 || info.importCount > 0 || info.ecomTaggedCount > 0;
            const range = info.dateFrom && info.dateTo
                ? `${UI.formatDate(info.dateFrom)} — ${UI.formatDate(info.dateTo)}`
                : '--';
            // For ecom we show the tagged-rows count instead of rowCount
            // (ecom has no rows of its own).
            const rowsCell = src === 'ecom'
                ? `<span title="Filas de Baby Banking marcadas como ecom">${info.ecomTaggedCount.toLocaleString('es-ES')} marcadas</span>`
                : info.rowCount.toLocaleString('es-ES');
            const btn = hasData
                ? `<button type="button" class="alias-btn alias-btn-danger" data-cleanup-source="${escapeHtml(src)}">Eliminar</button>`
                : `<button type="button" class="alias-btn" disabled title="No hay datos de esta fuente">Sin datos</button>`;
            return `<tr>
                <td>${escapeHtml(label)}</td>
                <td>${rowsCell}</td>
                <td>${info.importCount}</td>
                <td>${range}</td>
                <td>${btn}</td>
            </tr>`;
        }).join('');

        tbody.innerHTML = rows;

        tbody.querySelectorAll('button[data-cleanup-source]').forEach(btn => {
            btn.addEventListener('click', () => handleCleanupSource(btn.dataset.cleanupSource, summary[btn.dataset.cleanupSource]));
        });
    }

    async function handleCleanupSource(source, info) {
        const label = SOURCE_LABELS[source] || source;
        const summary = info || { rowCount: 0, importCount: 0, ecomTaggedCount: 0 };
        let warnLines;
        if (source === 'ecom') {
            warnLines = [
                `Vas a desetiquetar ${summary.ecomTaggedCount.toLocaleString('es-ES')} filas de Baby Banking marcadas como ecom (volveran a contar como tienda) y a borrar ${summary.importCount} importaciones de "${label}".`,
                'Esta accion es irreversible salvo restaurando un backup. ¿Continuar?'
            ];
        } else {
            warnLines = [
                `Vas a borrar ${summary.rowCount.toLocaleString('es-ES')} filas y ${summary.importCount} importaciones de "${label}".`,
                'El resto de fuentes y la configuracion no se ven afectadas.',
                'Esta accion es irreversible salvo restaurando un backup. ¿Continuar?'
            ];
        }
        if (!confirm(warnLines.join('\n\n'))) return;

        UI.showProgress(0, 1, `Buscando filas de ${label}...`);
        try {
            const result = await Database.deleteBySource(source, ({ phase, done, total }) => {
                if (phase === 'scan') {
                    UI.showProgress(0, 1, `Buscando filas de ${label}...`);
                } else if (phase === 'delete') {
                    UI.showProgress(done, total, `Eliminando ${label}: ${done.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}`);
                } else if (phase === 'untag') {
                    UI.showProgress(done, total, `Desetiquetando ${label}: ${done.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}`);
                } else if (phase === 'imports') {
                    UI.showProgress(0, 1, `Borrando historial de importaciones de ${label}...`);
                }
            });
            UI.hideProgress();
            const msg = source === 'ecom'
                ? `Limpieza de ${label}: ${result.ecomUntagged.toLocaleString('es-ES')} filas desetiquetadas, ${result.importsDeleted} importaciones borradas`
                : `Limpieza de ${label}: ${result.opsDeleted.toLocaleString('es-ES')} filas borradas, ${result.importsDeleted} importaciones borradas`;
            UI.addLog(msg, 'success');
        } catch (e) {
            UI.hideProgress();
            console.error('deleteBySource error:', e);
            UI.addLog(`Error al limpiar ${label}: ${e.message}`, 'error');
            return;
        }

        // Refresh: settings panel itself, home (coverage bars + counters), and
        // any open dashboard caches that read getAllOperations.
        await renderCleanupSourcePanel();
        await refreshHome();
        const count = await Database.getRecordCount();
        const imports = await Database.getImportHistory();
        UI.updateSettingsInfo(`${count.toLocaleString()} registros. ${imports.length} importaciones.`);
    }

    // ============================
    // ALIAS EDITOR (Configuracion profunda)
    // ============================
    async function renderAliasEditor() {
        const tbody = document.getElementById('alias-table-body');
        if (!tbody) return;

        const factory = await loadCaptacionAliasFactory();   // Map<normKey, {rawKey, canonical}>
        const overrides = await getCaptacionAliasOverrides(); // raw object

        // Build a unified map keyed by normalized key, marking origin
        const rows = new Map();
        for (const [normKey, entry] of factory.entries()) {
            rows.set(normKey, {
                key: entry.rawKey,
                factoryValue: entry.canonical,
                userValue: null,
                origin: 'factory'
            });
        }
        for (const [rawKey, value] of Object.entries(overrides)) {
            const normKey = normalizeStoreName(rawKey);
            const existing = rows.get(normKey);
            if (existing) {
                existing.userValue = value;
                existing.origin = 'override';
            } else {
                rows.set(normKey, {
                    key: rawKey,
                    factoryValue: null,
                    userValue: value,
                    origin: 'user'
                });
            }
        }

        const sorted = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));

        if (sorted.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">No hay aliases definidos.</td></tr>';
        } else {
            tbody.innerHTML = sorted.map(r => {
                const currentValue = r.userValue || r.factoryValue || '';
                const badge = r.origin === 'factory'
                    ? '<span class="alias-origin-factory" title="Definido en data/captacion-store-aliases.json">Fabrica</span>'
                    : r.origin === 'override'
                        ? `<span class="alias-origin-override" title="Sobrescribe el valor de fabrica: ${escapeHtml(r.factoryValue)}">Modificado</span>`
                        : '<span class="alias-origin-user">Personalizado</span>';
                const actions = r.origin === 'user'
                    ? `<button type="button" class="alias-btn" data-action="edit" data-key="${escapeHtml(r.key)}">Editar</button>
                       <button type="button" class="alias-btn alias-btn-danger" data-action="remove" data-key="${escapeHtml(r.key)}">Eliminar</button>`
                    : r.origin === 'override'
                        ? `<button type="button" class="alias-btn" data-action="edit" data-key="${escapeHtml(r.key)}">Editar</button>
                           <button type="button" class="alias-btn alias-btn-danger" data-action="restore" data-key="${escapeHtml(r.key)}" title="Vuelve al valor de fabrica">Restaurar</button>`
                        : `<button type="button" class="alias-btn" data-action="edit" data-key="${escapeHtml(r.key)}">Sobrescribir</button>`;
                return `<tr data-norm-key="${escapeHtml(normalizeStoreName(r.key))}">
                    <td>${escapeHtml(r.key)}</td>
                    <td class="alias-value-cell">${escapeHtml(currentValue)}</td>
                    <td>${badge}</td>
                    <td><div class="alias-actions">${actions}</div></td>
                </tr>`;
            }).join('');
        }

        // Wire actions
        tbody.querySelectorAll('button[data-action]').forEach(btn => {
            const action = btn.dataset.action;
            const key = btn.dataset.key;
            btn.addEventListener('click', () => handleAliasAction(action, key));
        });

        // Add-row button
        const addBtn = document.getElementById('btn-alias-add');
        if (addBtn && !addBtn.dataset.bound) {
            addBtn.dataset.bound = '1';
            addBtn.addEventListener('click', handleAliasAdd);
        }
    }

    async function handleAliasAction(action, rawKey) {
        if (action === 'edit') {
            startInlineAliasEdit(rawKey);
        } else if (action === 'restore') {
            if (!confirm(`Restaurar "${rawKey}" al valor de fabrica?`)) return;
            const overrides = await getCaptacionAliasOverrides();
            delete overrides[rawKey];
            // Also remove any case-variant entry that normalizes to same key
            const norm = normalizeStoreName(rawKey);
            for (const k of Object.keys(overrides)) {
                if (normalizeStoreName(k) === norm) delete overrides[k];
            }
            await setCaptacionAliasOverrides(overrides);
            await reapplyAliasesToExistingData();
            await renderAliasEditor();
        } else if (action === 'remove') {
            if (!confirm(`Eliminar el alias personalizado para "${rawKey}"?`)) return;
            const overrides = await getCaptacionAliasOverrides();
            delete overrides[rawKey];
            const norm = normalizeStoreName(rawKey);
            for (const k of Object.keys(overrides)) {
                if (normalizeStoreName(k) === norm) delete overrides[k];
            }
            await setCaptacionAliasOverrides(overrides);
            await reapplyAliasesToExistingData();
            await renderAliasEditor();
        }
    }

    /**
     * After any alias change, rerun the reconciler against existing captacion
     * rows so the dashboards reflect the new mapping immediately (no need to
     * re-import the CSV).
     */
    async function reapplyAliasesToExistingData() {
        try {
            const knownStores = await Database.getDistinctValues('store');
            const aliases = await loadCaptacionAliases();
            const reconcile = makeCaptacionReconciler(knownStores, aliases);
            const fixed = await Database.renormalizeStoresForSource('captacion', s => reconcile(s) || s);
            if (fixed > 0) {
                UI.addLog(`Aliases aplicados: ${fixed.toLocaleString()} filas de captacion renormalizadas`, 'success');
            }
        } catch (e) {
            console.warn('reapplyAliasesToExistingData failed:', e);
        }
    }

    function startInlineAliasEdit(rawKey) {
        const tbody = document.getElementById('alias-table-body');
        const norm = normalizeStoreName(rawKey);
        const row = tbody.querySelector(`tr[data-norm-key="${CSS.escape(norm)}"]`);
        if (!row) return;
        const valueCell = row.querySelector('.alias-value-cell');
        const actionsCell = row.querySelector('.alias-actions');
        const currentValue = valueCell.textContent;
        valueCell.innerHTML = `<input type="text" class="alias-edit-input" value="${escapeHtml(currentValue)}">`;
        actionsCell.innerHTML = `
            <button type="button" class="alias-btn" data-action="save">Guardar</button>
            <button type="button" class="alias-btn" data-action="cancel">Cancelar</button>
        `;
        const input = valueCell.querySelector('input');
        input.focus();
        input.select();
        actionsCell.querySelector('[data-action="save"]').addEventListener('click', async () => {
            const newValue = input.value.trim();
            if (!newValue) { alert('El valor no puede estar vacio.'); return; }
            const overrides = await getCaptacionAliasOverrides();
            overrides[rawKey] = newValue;
            await setCaptacionAliasOverrides(overrides);
            await reapplyAliasesToExistingData();
            await renderAliasEditor();
        });
        actionsCell.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            renderAliasEditor();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') actionsCell.querySelector('[data-action="save"]').click();
            if (e.key === 'Escape') actionsCell.querySelector('[data-action="cancel"]').click();
        });
    }

    async function handleAliasAdd() {
        const keyInput = document.getElementById('alias-new-key');
        const valueInput = document.getElementById('alias-new-value');
        const key = keyInput.value.trim();
        const value = valueInput.value.trim();
        if (!key || !value) { alert('Rellena los dos campos para anadir un alias.'); return; }
        const overrides = await getCaptacionAliasOverrides();
        // Detect collision with existing override (case/tildes-insensitive)
        const norm = normalizeStoreName(key);
        for (const existingKey of Object.keys(overrides)) {
            if (normalizeStoreName(existingKey) === norm) {
                if (!confirm(`Ya existe un alias para "${existingKey}". Sobrescribirlo?`)) return;
                delete overrides[existingKey];
                break;
            }
        }
        overrides[key] = value;
        await setCaptacionAliasOverrides(overrides);
        await reapplyAliasesToExistingData();
        keyInput.value = '';
        valueInput.value = '';
        await renderAliasEditor();
    }

    function renderEcomConfigUI() {
        const container = document.getElementById('kpi-ecom-config');
        if (!container) return;
        const html = ECOM_CONFIGURABLE_GROUPS.map(group => {
            const rows = group.keys.map(k => {
                const def = METRICS[k];
                if (!def) return '';
                const checked = ECOM_CONFIG[k] ? 'checked' : '';
                return `<label class="ecom-kpi-row">
                    <input type="checkbox" data-kpi-ecom="${k}" ${checked}>
                    <span>${escapeHtml(def.label)}</span>
                </label>`;
            }).join('');
            return `<div class="ecom-kpi-group">
                <h4>${escapeHtml(group.family)}</h4>
                <div class="ecom-kpi-rows">${rows}</div>
            </div>`;
        }).join('');
        container.innerHTML = html;

        container.querySelectorAll('input[data-kpi-ecom]').forEach(cb => {
            cb.addEventListener('change', async (e) => {
                const k = e.target.dataset.kpiEcom;
                ECOM_CONFIG[k] = e.target.checked;
                // Persist only the configurable keys (don't pollute storage with Compras inert flags)
                const toSave = {};
                for (const g of ECOM_CONFIGURABLE_GROUPS) {
                    for (const key of g.keys) toSave[key] = !!ECOM_CONFIG[key];
                }
                await Database.setSetting('ecomConfigByKpi', toSave);
            });
        });
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
        resetDashboardFilters();
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

            const total = data.operations.length;
            UI.showProgress(0, total, `Restaurando... 0 de ${total.toLocaleString()}`);

            await Database.importAll(data, (done, tot) => {
                UI.showProgress(done, tot, `Restaurando... ${done.toLocaleString()} de ${tot.toLocaleString()}`);
            });

            UI.hideProgress();

            // Restore course start if present
            if (data.settings) {
                const cs = data.settings.find(s => s.key === 'courseStartDate');
                if (cs && cs.value) {
                    KPIEngine.setCourseStart(cs.value);
                    document.getElementById('course-start-date').value = UI.formatDate(cs.value);
                }
            }

            resetDashboardFilters();
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
        a.download = `kpimetrix_export_${datePart}_${timePart}.json.gz`;
        a.click();
        URL.revokeObjectURL(url);

        const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
        UI.addLog(`Backup exportado (${sizeMB} MB comprimido)`, 'success');
    }

    // ============================
    // DASHBOARD: aggregation helpers
    // ============================

    // Aggregate records into per-store buckets using the unified bucket.
    // Returns { storeName: bucket }. Callers use METRICS[k].value(b) / .format(v, b)
    // to extract values, which respect the live per-KPI ecom config.
    function aggregateByStore(records) {
        const byStoreBucket = {};
        for (const r of records) {
            const store = r.store || '?';
            if (!byStoreBucket[store]) byStoreBucket[store] = emptyBucket();
            addToBucket(byStoreBucket[store], r);
        }
        return byStoreBucket;
    }

    function weekDateRange(week) {
        const courseStart = KPIEngine.getCourseStart();
        const cs = courseStart.split('-');
        const startMs = Date.UTC(cs[0], cs[1] - 1, cs[2]);
        const fromMs = startMs + (week - 1) * 7 * 86400000;
        const toMs = startMs + week * 7 * 86400000 - 86400000;
        return {
            from: new Date(fromMs).toISOString().substring(0, 10),
            to: new Date(toMs).toISOString().substring(0, 10)
        };
    }

    /**
     * Week-year label: year of the Friday (end of week).
     * W1 starts sat 27/12/2025 and ends fri 02/01/2026 -> year "2026".
     */
    function weekYear(week) {
        return weekDateRange(week).to.substring(0, 4);
    }

    /**
     * Combined available BB data range, derived from min/max dates.
     * Returns { weekMin, weekMax, dateMin, dateMax } or null.
     */
    async function getAvailableWeekRange() {
        const range = await Database.getAvailableBBDateRange();
        if (!range) return null;
        return {
            dateMin: range.dateMin,
            dateMax: range.dateMax,
            weekMin: KPIEngine.helpers.businessWeek(range.dateMin),
            weekMax: KPIEngine.helpers.businessWeek(range.dateMax)
        };
    }

    function formatAvailableWeeksLabel(range) {
        if (!range) return 'Sin datos disponibles.';
        const wrFrom = weekDateRange(range.weekMin);
        const wrTo = weekDateRange(range.weekMax);
        const yFrom = wrFrom.to.substring(0, 4);
        const yTo = wrTo.to.substring(0, 4);
        const dateSpan = `${UI.formatDate(wrFrom.from)} — ${UI.formatDate(wrTo.to)}`;
        if (yFrom === yTo) {
            return range.weekMin === range.weekMax
                ? `Datos disponibles: W${range.weekMin} de ${yFrom} (${dateSpan})`
                : `Datos disponibles: W${range.weekMin} — W${range.weekMax} de ${yFrom} (${dateSpan})`;
        }
        return `Datos disponibles: W${range.weekMin}/${yFrom} (${UI.formatDate(wrFrom.from)}) — W${range.weekMax}/${yTo} (${UI.formatDate(wrTo.to)})`;
    }

    async function updateAvailableWeeksLabel(elId) {
        const el = document.getElementById(elId);
        if (!el) return null;
        const range = await getAvailableWeekRange();
        el.textContent = formatAvailableWeeksLabel(range);
        return range;
    }

    // ============================
    // MULTI-SELECT (Detail view)
    // ============================
    function initMultiSelectHandlers() {
        // Toggle panels (and close others when one opens)
        const cfg = [
            { trigger: 'dd-cat-trigger', panel: 'dd-cat-panel' },
            { trigger: 'dd-store-trigger', panel: 'dd-store-panel' },
            { trigger: 'dd-sup-trigger', panel: 'dd-sup-panel' },
            { trigger: 'dg-store-trigger', panel: 'dg-store-panel' }
        ];
        cfg.forEach(({ trigger, panel }) => {
            document.getElementById(trigger).addEventListener('click', (e) => {
                e.stopPropagation();
                const p = document.getElementById(panel);
                const wasOpen = p.classList.contains('open');
                // Close all panels first
                cfg.forEach(c => document.getElementById(c.panel).classList.remove('open'));
                if (!wasOpen) p.classList.add('open');
            });
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            cfg.forEach(({ panel }) => {
                const p = document.getElementById(panel);
                if (!p.contains(e.target)) p.classList.remove('open');
            });
        });

        // "Select all" checkboxes
        document.getElementById('dd-cat-all').addEventListener('change', (e) => {
            if (e.target.checked) ddState.visibleCats = new Set(ddState.allCats);
            else ddState.visibleCats = new Set();
            ddState.catsTouched = true;
            refreshDashDetail();
        });
        document.getElementById('dd-store-all').addEventListener('change', (e) => {
            if (e.target.checked) ddState.visibleStores = new Set(ddState.allStores);
            else ddState.visibleStores = new Set();
            ddState.storesTouched = true;
            refreshDashDetail();
        });
        document.getElementById('dg-store-all').addEventListener('change', (e) => {
            if (e.target.checked) dgState.visibleStores = new Set(dgState.allStores);
            else dgState.visibleStores = new Set();
            dgState.storesTouched = true;
            refreshDashGeneral();
        });
        document.getElementById('dd-sup-all').addEventListener('change', (e) => {
            if (e.target.checked) ddState.visibleSupers = new Set(ddState.allSupers);
            else ddState.visibleSupers = new Set();
            ddState.supersTouched = true;
            // Supers change invalidates the category selection: let the default
            // top-5 logic recompute within the new scope.
            ddState.catsTouched = false;
            ddState.lastAutoMetric = null;
            refreshDashDetail();
        });

        // Search inputs
        document.getElementById('dd-cat-search').addEventListener('input', (e) => {
            renderMultiSelectList('dd-cat-list', ddState.allCats, ddState.visibleCats, e.target.value.toLowerCase(), 'cat');
        });
        document.getElementById('dd-store-search').addEventListener('input', (e) => {
            renderMultiSelectList('dd-store-list', ddState.allStores, ddState.visibleStores, e.target.value.toLowerCase(), 'store');
        });
        document.getElementById('dg-store-search').addEventListener('input', (e) => {
            renderMultiSelectList('dg-store-list', dgState.allStores, dgState.visibleStores, e.target.value.toLowerCase(), 'dg-store');
        });

        // Reset to top 5 for categories
        document.getElementById('dd-cat-top5').addEventListener('click', () => {
            ddState.catsTouched = false;
            ddState.lastAutoMetric = null;
            refreshDashDetail();
        });

        // Item toggles (delegation)
        document.getElementById('dd-cat-list').addEventListener('change', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                const value = e.target.dataset.value;
                if (!ddState.visibleCats) ddState.visibleCats = new Set();
                if (e.target.checked) ddState.visibleCats.add(value);
                else ddState.visibleCats.delete(value);
                ddState.catsTouched = true;
                refreshDashDetail();
            }
        });
        document.getElementById('dd-store-list').addEventListener('change', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                const value = e.target.dataset.value;
                if (!ddState.visibleStores) ddState.visibleStores = new Set();
                if (e.target.checked) ddState.visibleStores.add(value);
                else ddState.visibleStores.delete(value);
                ddState.storesTouched = true;
                refreshDashDetail();
            }
        });
        document.getElementById('dg-store-list').addEventListener('change', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                const value = e.target.dataset.value;
                if (!dgState.visibleStores) dgState.visibleStores = new Set();
                if (e.target.checked) dgState.visibleStores.add(value);
                else dgState.visibleStores.delete(value);
                dgState.storesTouched = true;
                refreshDashGeneral();
            }
        });
        document.getElementById('dd-sup-list').addEventListener('change', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                const value = e.target.dataset.value;
                if (!ddState.visibleSupers) ddState.visibleSupers = new Set();
                if (e.target.checked) ddState.visibleSupers.add(value);
                else ddState.visibleSupers.delete(value);
                ddState.supersTouched = true;
                // Same reason as the "all" handler above: let top-5 recompute
                ddState.catsTouched = false;
                ddState.lastAutoMetric = null;
                refreshDashDetail();
            }
        });
    }

    function renderMultiSelectList(listId, items, selectedSet, searchTerm, kind) {
        const el = document.getElementById(listId);
        if (!el) return;
        const term = (searchTerm || '').toLowerCase();
        const filtered = term ? items.filter(it => it.toLowerCase().includes(term)) : items;
        if (!filtered.length) {
            el.innerHTML = '<div class="multi-select-option" style="color:var(--color-text-lighter);justify-content:center;">Sin coincidencias</div>';
            return;
        }
        el.innerHTML = filtered.map(it => {
            const checked = selectedSet && selectedSet.has(it) ? 'checked' : '';
            return `<label class="multi-select-option">
                <input type="checkbox" data-value="${escapeHtml(it)}" ${checked}>
                <span class="multi-select-option-label" title="${escapeHtml(it)}">${escapeHtml(it)}</span>
            </label>`;
        }).join('');
    }

    function updateMultiSelectUI(kind) {
        let listId, countId, searchId, allCbId, items, selected;
        if (kind === 'cat') {
            listId = 'dd-cat-list'; countId = 'dd-cat-count';
            searchId = 'dd-cat-search'; allCbId = 'dd-cat-all';
            items = ddState.allCats; selected = ddState.visibleCats;
        } else if (kind === 'dg-store') {
            listId = 'dg-store-list'; countId = 'dg-store-count';
            searchId = 'dg-store-search'; allCbId = 'dg-store-all';
            items = dgState.allStores; selected = dgState.visibleStores;
        } else if (kind === 'sup') {
            listId = 'dd-sup-list'; countId = 'dd-sup-count';
            searchId = null; allCbId = 'dd-sup-all';
            items = ddState.allSupers; selected = ddState.visibleSupers;
        } else {
            listId = 'dd-store-list'; countId = 'dd-store-count';
            searchId = 'dd-store-search'; allCbId = 'dd-store-all';
            items = ddState.allStores; selected = ddState.visibleStores;
        }
        const searchVal = searchId ? document.getElementById(searchId).value.toLowerCase() : '';
        renderMultiSelectList(listId, items, selected, searchVal, kind);
        const nSel = selected ? selected.size : 0;
        document.getElementById(countId).textContent = `${nSel}/${items.length}`;
        document.getElementById(allCbId).checked = nSel === items.length && items.length > 0;
    }

    function updateWeekRangeLabel(elId, weekFrom, weekTo) {
        const from = weekDateRange(weekFrom);
        const to = weekDateRange(weekTo);
        const el = document.getElementById(elId);
        if (!el) return;
        el.textContent = weekFrom === weekTo
            ? `Semana ${weekFrom} (${UI.formatDate(from.from)} - ${UI.formatDate(from.to)})`
            : `Semanas ${weekFrom}-${weekTo} (${UI.formatDate(from.from)} - ${UI.formatDate(to.to)})`;
    }

    // ============================
    // DASHBOARD: GENERAL (Tiendas x KPIs)
    // ============================
    // Reset dashboard state (sort, multi-select filters) after a data change.
    function resetDashboardFilters() {
        dgState.sortCol = null;
        dgState.sortDir = 'desc';
        dgState.visibleStores = null;
        dgState.storesTouched = false;
        ddState.sortCol = null;
        ddState.sortDir = 'desc';
        ddState.visibleCats = null;
        ddState.visibleStores = null;
        ddState.visibleSupers = null;
        ddState.catsTouched = false;
        ddState.storesTouched = false;
        ddState.supersTouched = false;
        ddState.lastAutoMetric = null;
        ddState.lastAutoRange = null;
        // Keep groupBy / axisMode across data reloads; they're user preferences.
    }

    function sortDashGeneral(col) {
        if (dgState.sortCol === col) {
            dgState.sortDir = dgState.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            dgState.sortCol = col;
            dgState.sortDir = 'desc';
        }
        refreshDashGeneral();
    }

    // --- Store groups (shared across Vista general + Vista detalle) ----------
    // Groups are persisted once (setting `storeGroups`) and rendered into each
    // view's own "Tiendas" multi-select panel. Selection state per view stays
    // independent: each view picks which stores it shows; groups are a tool
    // to quickly switch that selection.
    const STORE_GROUPS = { groups: [], loaded: false };
    const storeGroupsInstances = [];

    async function loadStoreGroups() {
        if (STORE_GROUPS.loaded) return;
        let saved = await Database.getSetting('storeGroups');
        if (!Array.isArray(saved)) {
            // One-time migration from the older Vista-general-only key
            const legacy = await Database.getSetting('dgStoreGroups');
            if (Array.isArray(legacy) && legacy.length) {
                saved = legacy;
                await Database.setSetting('storeGroups', legacy);
            }
        }
        if (Array.isArray(saved)) {
            STORE_GROUPS.groups = saved.filter(g => g && g.name && Array.isArray(g.stores));
        }
        STORE_GROUPS.loaded = true;
    }

    async function saveStoreGroups() {
        await Database.setSetting('storeGroups', STORE_GROUPS.groups);
    }

    function registerStoreGroupsInstance(cfg) {
        // cfg = { prefix, getVisibleStores, setVisibleStores, getAllStores, refresh }
        const instance = { ...cfg, managing: false };
        storeGroupsInstances.push(instance);
        return instance;
    }

    function renderStoreGroupsUIFor(inst) {
        const { prefix } = inst;
        const select = document.getElementById(`${prefix}-groups-select`);
        const manageBtn = document.getElementById(`${prefix}-groups-manage`);
        const list = document.getElementById(`${prefix}-groups-list`);
        if (!select || !manageBtn || !list) return;

        const opts = ['<option value="">-- Aplicar grupo --</option>'];
        for (const g of STORE_GROUPS.groups) {
            opts.push(`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${g.stores.length})</option>`);
        }
        select.innerHTML = opts.join('');
        select.value = '';

        manageBtn.textContent = inst.managing ? 'Cerrar gestion' : 'Gestionar grupos...';

        if (inst.managing) {
            list.classList.remove('hidden');
            if (!STORE_GROUPS.groups.length) {
                list.innerHTML = '<div class="store-groups-empty">No hay grupos guardados.</div>';
            } else {
                list.innerHTML = STORE_GROUPS.groups.map(g =>
                    `<div class="store-group-row" data-group-id="${escapeHtml(g.id)}">
                        <span class="store-group-name" title="${g.stores.map(escapeHtml).join(', ')}">${escapeHtml(g.name)}</span>
                        <span class="store-group-count">${g.stores.length}</span>
                        <button type="button" class="store-group-btn" data-action="rename" title="Renombrar">Renombrar</button>
                        <button type="button" class="store-group-btn" data-action="update" title="Actualizar con la seleccion actual">Actualizar</button>
                        <button type="button" class="store-group-btn store-group-btn-danger" data-action="delete" title="Eliminar">Eliminar</button>
                    </div>`
                ).join('');
            }
        } else {
            list.classList.add('hidden');
        }
    }

    // Re-render the group toolbar/list on every registered view (used after
    // create/update/delete so both views stay in sync).
    function renderAllStoreGroupsUI() {
        for (const inst of storeGroupsInstances) renderStoreGroupsUIFor(inst);
    }

    function initStoreGroupsInstanceHandlers(inst) {
        const { prefix, getVisibleStores, setVisibleStores, getAllStores, refresh } = inst;
        const select = document.getElementById(`${prefix}-groups-select`);
        const saveBtn = document.getElementById(`${prefix}-groups-save`);
        const manageBtn = document.getElementById(`${prefix}-groups-manage`);
        const list = document.getElementById(`${prefix}-groups-list`);
        if (!select || !saveBtn || !manageBtn || !list) return;

        select.addEventListener('change', () => {
            const id = select.value;
            if (!id) return;
            const g = STORE_GROUPS.groups.find(x => x.id === id);
            if (!g) return;
            // Apply only stores currently available in this view's data
            const all = getAllStores();
            const validSet = new Set(g.stores.filter(s => all.includes(s)));
            setVisibleStores(validSet);
            select.value = '';
            refresh();
        });

        saveBtn.addEventListener('click', async () => {
            const selected = [...(getVisibleStores() || [])];
            if (!selected.length) {
                alert('Selecciona al menos una tienda antes de guardar un grupo.');
                return;
            }
            const name = (prompt('Nombre del grupo:') || '').trim();
            if (!name) return;
            const existing = STORE_GROUPS.groups.find(g => g.name.toLowerCase() === name.toLowerCase());
            if (existing) {
                if (!confirm(`Ya existe un grupo llamado "${existing.name}". Sobrescribir?`)) return;
                existing.stores = selected;
            } else {
                STORE_GROUPS.groups.push({
                    id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    name,
                    stores: selected
                });
            }
            await saveStoreGroups();
            renderAllStoreGroupsUI();
        });

        manageBtn.addEventListener('click', () => {
            inst.managing = !inst.managing;
            renderStoreGroupsUIFor(inst);
        });

        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const row = btn.closest('[data-group-id]');
            const id = row && row.dataset.groupId;
            const group = STORE_GROUPS.groups.find(g => g.id === id);
            if (!group) return;

            const action = btn.dataset.action;
            if (action === 'rename') {
                const newName = (prompt('Nuevo nombre:', group.name) || '').trim();
                if (!newName || newName === group.name) return;
                const conflict = STORE_GROUPS.groups.find(g => g.id !== id && g.name.toLowerCase() === newName.toLowerCase());
                if (conflict) { alert('Ya existe un grupo con ese nombre.'); return; }
                group.name = newName;
            } else if (action === 'update') {
                const selected = [...(getVisibleStores() || [])];
                if (!selected.length) { alert('Selecciona al menos una tienda antes de actualizar.'); return; }
                if (!confirm(`Actualizar "${group.name}" con la seleccion actual (${selected.length} tiendas)?`)) return;
                group.stores = selected;
            } else if (action === 'delete') {
                if (!confirm(`Eliminar el grupo "${group.name}"?`)) return;
                STORE_GROUPS.groups = STORE_GROUPS.groups.filter(g => g.id !== id);
            }
            await saveStoreGroups();
            renderAllStoreGroupsUI();
        });
    }

    function initStoreGroupsAllInstances() {
        // Vista general
        registerStoreGroupsInstance({
            prefix: 'dg',
            getVisibleStores: () => dgState.visibleStores,
            setVisibleStores: (set) => { dgState.visibleStores = set; dgState.storesTouched = true; },
            getAllStores: () => dgState.allStores,
            refresh: () => refreshDashGeneral()
        });
        // Vista detalle
        registerStoreGroupsInstance({
            prefix: 'dd',
            getVisibleStores: () => ddState.visibleStores,
            setVisibleStores: (set) => { ddState.visibleStores = set; ddState.storesTouched = true; },
            getAllStores: () => ddState.allStores,
            refresh: () => refreshDashDetail()
        });
        for (const inst of storeGroupsInstances) initStoreGroupsInstanceHandlers(inst);
    }

    // --- Column selection (Vista general) -----------------------------------
    async function loadDashGeneralColumns() {
        if (dgState.columnsLoaded) return;
        const saved = await Database.getSetting('dgColumns');
        if (Array.isArray(saved) && saved.length) {
            // Keep only keys that still exist in METRICS
            dgState.columns = saved.filter(k => METRICS[k]);
        }
        if (!dgState.columns || !dgState.columns.length) {
            dgState.columns = [...DG_DEFAULT_COLUMNS];
        }
        dgState.columnsLoaded = true;
    }

    async function saveDashGeneralColumns() {
        await Database.setSetting('dgColumns', dgState.columns);
    }

    // The full ordered list used for the picker: active ones first (in their
    // order) followed by inactive ones, preserving registry order within each.
    function dgPickerEntries() {
        const active = dgState.columns || [];
        const inactive = Object.keys(METRICS).filter(k => !active.includes(k));
        return [
            ...active.map(k => ({ key: k, active: true })),
            ...inactive.map(k => ({ key: k, active: false }))
        ];
    }

    function renderDashGeneralKpiPanel() {
        const list = document.getElementById('dg-kpi-list');
        const count = document.getElementById('dg-kpi-count');
        if (!list || !count) return;
        const total = Object.keys(METRICS).length;
        count.textContent = `${(dgState.columns || []).length}/${total}`;

        const entries = dgPickerEntries();
        list.innerHTML = entries.map((e, idx) => {
            const def = DG_COLUMN_LABELS[e.key] || { label: METRICS[e.key].label, title: METRICS[e.key].label };
            const canUp = idx > 0;
            const canDown = idx < entries.length - 1;
            return `<div class="dg-kpi-row${e.active ? ' active' : ''}" data-key="${escapeHtml(e.key)}">
                <input type="checkbox" data-role="toggle" ${e.active ? 'checked' : ''}>
                <span class="dg-kpi-name" title="${escapeHtml(def.title)}">${escapeHtml(def.label)}</span>
                <button type="button" class="dg-kpi-move" data-role="up" ${canUp ? '' : 'disabled'} title="Subir">&uarr;</button>
                <button type="button" class="dg-kpi-move" data-role="down" ${canDown ? '' : 'disabled'} title="Bajar">&darr;</button>
            </div>`;
        }).join('');
    }

    // --- Category / Supercategory info popover (Vista detalle) ---------------
    function renderCategoryInfoPopover() {
        const body = document.getElementById('dd-cat-info-body');
        const searchEl = document.getElementById('dd-cat-info-search');
        if (!body) return;
        const term = (searchEl && searchEl.value || '').toLowerCase().trim();

        // Build supercategory -> [categories] groups. Use SUPERCATEGORY_LIST order,
        // plus any extra supers seen in mapping, plus "Sin mapear" bucket at the end.
        const orderedSupers = SUPERCATEGORY_LIST.length ? [...SUPERCATEGORY_LIST] : [];
        const byS = {};
        for (const s of orderedSupers) byS[s] = [];
        for (const [cat, sup] of Object.entries(CATEGORY_SUPERCATEGORY)) {
            if (!byS[sup]) { byS[sup] = []; orderedSupers.push(sup); }
            byS[sup].push(cat);
        }
        // Sort categories alphabetically inside each super
        for (const s of orderedSupers) byS[s].sort((a, b) => a.localeCompare(b, 'es'));

        if (!orderedSupers.length) {
            body.innerHTML = '<div class="info-popover-empty">El mapping no se cargo. Revisa data/categories-supercategories.json.</div>';
            return;
        }

        body.innerHTML = orderedSupers.map(sup => {
            const cats = byS[sup] || [];
            const matching = term ? cats.filter(c => c.toLowerCase().includes(term)) : cats;
            if (!matching.length) return '';
            return `<div class="info-popover-group">
                <div class="info-popover-super">${escapeHtml(sup)} <span class="info-popover-count">(${cats.length})</span></div>
                <div class="info-popover-cats">${matching.map(c => `<span class="info-popover-cat">${escapeHtml(c)}</span>`).join('')}</div>
            </div>`;
        }).join('') || '<div class="info-popover-empty">Sin coincidencias.</div>';
    }

    // --- Vista detalle: group-by segmented + axis swap ----------------------
    async function loadDashDetailConfig() {
        if (ddState.configLoaded) return;
        const gb = await Database.getSetting('ddGroupBy');
        const ax = await Database.getSetting('ddAxisMode');
        if (gb === 'cat' || gb === 'sup') ddState.groupBy = gb;
        if (ax === 'store-rows' || ax === 'group-rows') ddState.axisMode = ax;
        ddState.configLoaded = true;
    }

    function updateDashDetailControlsUI() {
        // Segmented
        const buttons = document.querySelectorAll('#dd-groupby .segmented-btn');
        buttons.forEach(b => b.classList.toggle('active', b.dataset.groupby === ddState.groupBy));

        // Multi-select visibility (the one matching groupBy is shown)
        const catWrap = document.querySelector('.multi-select.dd-groupby-cat');
        const supWrap = document.querySelector('.multi-select.dd-groupby-sup');
        if (catWrap) catWrap.classList.toggle('hidden', ddState.groupBy !== 'cat');
        if (supWrap) supWrap.classList.toggle('hidden', ddState.groupBy !== 'sup');

        // Swap button visual state
        const swapBtn = document.getElementById('dd-axis-swap');
        if (swapBtn) swapBtn.classList.toggle('active', ddState.axisMode === 'group-rows');
    }

    function initDashDetailControls() {
        const groupbyEl = document.getElementById('dd-groupby');
        const swapBtn = document.getElementById('dd-axis-swap');
        if (!groupbyEl || !swapBtn) return;

        groupbyEl.addEventListener('click', async (e) => {
            const btn = e.target.closest('.segmented-btn');
            if (!btn) return;
            const val = btn.dataset.groupby;
            if (val !== 'cat' && val !== 'sup') return;
            if (ddState.groupBy === val) return;
            ddState.groupBy = val;
            // Changing granularity invalidates the auto-top-5 recompute key
            ddState.lastAutoMetric = null;
            await Database.setSetting('ddGroupBy', val);
            updateDashDetailControlsUI();
            refreshDashDetail();
        });

        swapBtn.addEventListener('click', async () => {
            ddState.axisMode = ddState.axisMode === 'store-rows' ? 'group-rows' : 'store-rows';
            // Sorting was column-based in the old orientation; reset so the
            // new layout starts clean instead of pointing at a stale column.
            ddState.sortCol = null;
            ddState.sortDir = 'desc';
            // Swapping the axis means the row axis changes too, so the
            // default top-5-by-metric rows need to be recomputed.
            ddState.lastAutoMetric = null;
            await Database.setSetting('ddAxisMode', ddState.axisMode);
            updateDashDetailControlsUI();
            refreshDashDetail();
        });
    }

    function initCategoryInfoPopover() {
        const btn = document.getElementById('dd-cat-info-btn');
        const panel = document.getElementById('dd-cat-info-panel');
        const search = document.getElementById('dd-cat-info-search');
        if (!btn || !panel || !search) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = panel.classList.contains('open');
            if (!wasOpen) renderCategoryInfoPopover();
            panel.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !btn.contains(e.target)) {
                panel.classList.remove('open');
            }
        });
        search.addEventListener('input', renderCategoryInfoPopover);
    }

    function initDashGeneralKpiPicker() {
        const trigger = document.getElementById('dg-kpi-trigger');
        const panel = document.getElementById('dg-kpi-panel');
        const list = document.getElementById('dg-kpi-list');
        const resetBtn = document.getElementById('dg-kpi-reset');
        if (!trigger || !panel || !list || !resetBtn) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !trigger.contains(e.target)) {
                panel.classList.remove('open');
            }
        });

        // Work on the full picker order so up/down on inactive entries also
        // moves them relative to actives. This lets the user promote a hidden
        // KPI into a desired slot and then toggle it on.
        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-role]');
            if (!btn) return;
            const row = btn.closest('.dg-kpi-row');
            if (!row) return;
            const key = row.dataset.key;
            const role = btn.dataset.role;
            const order = dgPickerEntries().map(x => x.key);
            const idx = order.indexOf(key);
            if (idx < 0) return;

            if (role === 'toggle') {
                // Checkbox change is handled in the change listener below; the
                // click bubbled from the label wrapper, so let the change run.
                return;
            }
            if (role === 'up' && idx > 0) {
                [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
            } else if (role === 'down' && idx < order.length - 1) {
                [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
            } else {
                return;
            }
            // Rebuild dgState.columns keeping only the active ones, in new order
            const activeSet = new Set(dgState.columns || []);
            dgState.columns = order.filter(k => activeSet.has(k));
            await saveDashGeneralColumns();
            renderDashGeneralKpiPanel();
            refreshDashGeneral();
        });

        list.addEventListener('change', async (e) => {
            if (!e.target.matches('input[type="checkbox"][data-role="toggle"]')) return;
            const row = e.target.closest('.dg-kpi-row');
            if (!row) return;
            const key = row.dataset.key;
            const order = dgPickerEntries().map(x => x.key);
            const activeSet = new Set(dgState.columns || []);
            if (e.target.checked) activeSet.add(key);
            else activeSet.delete(key);
            dgState.columns = order.filter(k => activeSet.has(k));
            await saveDashGeneralColumns();
            renderDashGeneralKpiPanel();
            refreshDashGeneral();
        });

        resetBtn.addEventListener('click', async () => {
            dgState.columns = [...DG_DEFAULT_COLUMNS];
            await saveDashGeneralColumns();
            renderDashGeneralKpiPanel();
            refreshDashGeneral();
        });
    }

    async function refreshDashGeneral() {
        await loadStoreGroups();
        await loadDashGeneralColumns();
        renderDashGeneralKpiPanel();

        const available = await updateAvailableWeeksLabel('dg-available');
        const fromEl = document.getElementById('dg-week-from');
        const toEl = document.getElementById('dg-week-to');
        if (!parseInt(toEl.value) || parseInt(toEl.value) < 1) {
            if (available) {
                fromEl.value = available.weekMin;
                toEl.value = available.weekMax;
            } else {
                const today = new Date().toISOString().substring(0, 10);
                const currentWeek = KPIEngine.helpers.businessWeek(today);
                fromEl.value = Math.max(1, currentWeek - 3);
                toEl.value = currentWeek;
            }
        }
        const weekFrom = parseInt(fromEl.value) || 1;
        const weekTo = parseInt(toEl.value) || weekFrom;

        updateWeekRangeLabel('dg-week-range', weekFrom, weekTo);

        const activeCols = dgState.columns || DG_DEFAULT_COLUMNS;
        const totalCols = activeCols.length + 1 + 1; // name + metrics + 1 placeholder (Stock)

        if (weekTo < weekFrom || weekTo - weekFrom > 52) {
            document.getElementById('dg-tbody').innerHTML =
                `<tr><td colspan="${totalCols}" class="empty-msg">Rango de semanas no valido.</td></tr>`;
            return;
        }

        const allData = await Database.getAllOperations();
        const rangeRecords = allData.filter(r => r.week >= weekFrom && r.week <= weekTo);
        const buckets = aggregateByStore(rangeRecords);

        // Populate store multi-select state
        const allStoresArr = Object.keys(buckets).sort((a, b) => a.localeCompare(b));
        dgState.allStores = allStoresArr;
        if (!dgState.storesTouched || !dgState.visibleStores) {
            dgState.visibleStores = new Set(allStoresArr);
        } else {
            // Drop stale store entries
            dgState.visibleStores = new Set([...dgState.visibleStores].filter(s => buckets[s]));
        }
        updateMultiSelectUI('dg-store');
        const dgGroupsInst = storeGroupsInstances.find(i => i.prefix === 'dg');
        if (dgGroupsInst) renderStoreGroupsUIFor(dgGroupsInst);

        // Sort stores by the selected column (desc/asc) or alphabetically if none
        const sortCol = dgState.sortCol;
        const sortDir = dgState.sortDir;
        const dgSortValue = (storeName, col) => {
            const b = buckets[storeName];
            if (col === 'name') return storeName.toLowerCase();
            const def = METRICS[col];
            if (!def) return 0;
            // For pct metrics without denominator, sort to bottom
            if (def.isPct && def.minOpsOf && def.minOpsOf(b) === 0) return -1;
            return def.value(b);
        };
        const stores = allStoresArr
            .filter(s => dgState.visibleStores.has(s))
            .sort((a, b) => {
                if (!sortCol) return a.localeCompare(b);
                const va = dgSortValue(a, sortCol);
                const vb = dgSortValue(b, sortCol);
                if (typeof va === 'string') {
                    return sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
                }
                return sortDir === 'desc' ? (vb - va) : (va - vb);
            });

        const sortCls = (col) => sortCol === col ? (sortDir === 'desc' ? ' sort-desc' : ' sort-asc') : '';
        const thead = document.getElementById('dg-thead');
        const metricThs = activeCols.map(key => {
            const lbl = DG_COLUMN_LABELS[key] || { label: METRICS[key]?.label || key, title: METRICS[key]?.label || key };
            return `<th class="sortable${sortCls(key)}" data-dg-sort="${key}" title="${escapeHtml(lbl.title)}">${escapeHtml(lbl.label)}</th>`;
        }).join('');
        thead.innerHTML = `<tr>
            <th class="col-name sortable${sortCls('name')}" data-dg-sort="name">Tienda</th>
            ${metricThs}
            <th>Stock</th>
        </tr>`;
        thead.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => sortDashGeneral(th.dataset.dgSort));
        });

        const tbody = document.getElementById('dg-tbody');
        if (!stores.length) {
            tbody.innerHTML = `<tr><td colspan="${totalCols}" class="empty-msg">Sin datos para esta semana.</td></tr>`;
            document.getElementById('dg-tfoot').innerHTML = '';
            return;
        }

        if (!activeCols.length) {
            tbody.innerHTML = `<tr><td colspan="${totalCols}" class="empty-msg">Ningun KPI seleccionado. Abre el filtro KPIs para elegir columnas.</td></tr>`;
            document.getElementById('dg-tfoot').innerHTML = '';
            return;
        }

        // Render rows
        let html = '';
        for (const store of stores) {
            const b = buckets[store];
            const metricCells = activeCols.map(key => {
                const def = METRICS[key];
                return `<td>${def.format(def.value(b), b)}</td>`;
            }).join('');
            html += `<tr>
                <td class="col-name">${escapeHtml(store)}</td>
                ${metricCells}
                <td class="cell-empty">--</td>
            </tr>`;
        }
        tbody.innerHTML = html;

        // TOTAL row: merge only the visible stores' buckets
        const totalBucket = emptyBucket();
        for (const s of stores) mergeBuckets(totalBucket, buckets[s]);
        const totalCells = activeCols.map(key => {
            const def = METRICS[key];
            return `<td><strong>${def.format(def.value(totalBucket), totalBucket)}</strong></td>`;
        }).join('');
        document.getElementById('dg-tfoot').innerHTML = `<tr class="row-total">
            <td class="col-name"><strong>TOTAL</strong></td>
            ${totalCells}
            <td class="cell-empty">--</td>
        </tr>`;
    }

    // ============================
    // DASHBOARD: DETAIL (Tiendas x Categoria)
    // ============================
    function sortDashDetail(col) {
        if (ddState.sortCol === col) {
            ddState.sortDir = ddState.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            ddState.sortCol = col;
            ddState.sortDir = 'desc';
        }
        refreshDashDetail();
    }

    async function refreshDashDetail() {
        // Ensure supercat mapping + persisted prefs + shared store groups are loaded before render.
        try { await loadSupercategoryMapping(); } catch (e) { /* no-op */ }
        await loadDashDetailConfig();
        await loadStoreGroups();
        updateDashDetailControlsUI();

        const available = await updateAvailableWeeksLabel('dd-available');
        const fromEl = document.getElementById('dd-week-from');
        const toEl = document.getElementById('dd-week-to');
        if (!parseInt(toEl.value) || parseInt(toEl.value) < 1) {
            if (available) {
                fromEl.value = available.weekMin;
                toEl.value = available.weekMax;
            } else {
                const today = new Date().toISOString().substring(0, 10);
                const currentWeek = KPIEngine.helpers.businessWeek(today);
                fromEl.value = currentWeek;
                toEl.value = currentWeek;
            }
        }
        const weekFrom = parseInt(fromEl.value) || 1;
        const weekTo = parseInt(toEl.value) || weekFrom;
        const metric = document.getElementById('dd-metric').value;
        const metricToKpiKey = { netSales: 'netSales', units: 'totalItems', tickets: 'tickets', buys: 'buys' };
        const excludeEcom = metricFiltersEcom(metricToKpiKey[metric] || metric);

        updateWeekRangeLabel('dd-week-range', weekFrom, weekTo);

        const thead = document.getElementById('dd-thead');
        const tbody = document.getElementById('dd-tbody');
        const tfoot = document.getElementById('dd-tfoot');
        const titleEl = document.getElementById('dd-panel-title');

        // Dynamic panel title
        const groupLabel = ddState.groupBy === 'sup' ? 'Supercategoría' : 'Categoría';
        if (titleEl) {
            titleEl.textContent = ddState.axisMode === 'store-rows'
                ? `Tiendas × ${groupLabel}`
                : `${groupLabel} × Tiendas`;
        }

        if (weekTo < weekFrom || weekTo - weekFrom > 52) {
            tbody.innerHTML = '<tr><td class="empty-msg">Rango de semanas no valido.</td></tr>';
            thead.innerHTML = '<tr><th>Tienda</th></tr>';
            tfoot.innerHTML = '';
            return;
        }

        const allData = await Database.getAllOperations();
        const weekRecords = allData.filter(r => r.week >= weekFrom && r.week <= weekTo);

        // Group key = category or supercategory depending on ddState.groupBy.
        // Aggregate by (store, groupKey). Keep per-store and per-group ticket
        // Sets for cross-dedup when rendering the Tickets metric.
        const groupOf = (cat) => ddState.groupBy === 'sup' ? getSupercategory(cat) : cat;
        const byStoreGroup = {};
        const storeTickets = {};
        const groupTickets = {};
        const allTicketSet = new Set();
        const allCategories = new Set();
        const allGroupSet = new Set();
        const allStoresSet = new Set();

        for (const r of weekRecords) {
            // Memberships and test admissions have no usable product category;
            // they belong to Vista general / Vista por tienda, not to the
            // category-axis Vista detalle. (Test admissions all live in a
            // single bookkeeping category "Test", which would just pollute
            // the breakdown.)
            if (r.type === 'membership' || r.type === 'test-admission') continue;
            if (excludeEcom && r.channel === 'ecom') continue;
            const store = r.store || '?';
            const cat = r.category || 'Sin categoria';
            const groupKey = groupOf(cat);
            allStoresSet.add(store);
            allCategories.add(cat);
            allGroupSet.add(groupKey);

            if (!byStoreGroup[store]) byStoreGroup[store] = {};
            if (!byStoreGroup[store][groupKey]) {
                byStoreGroup[store][groupKey] = { netSales: 0, units: 0, tickets: new Set(), buys: 0 };
            }
            const bucket = byStoreGroup[store][groupKey];
            const total = r.total || 0;
            if (r.type === 'sale') {
                bucket.netSales += total;
                bucket.units += (r.quantity || 0);
                if (r.reference) {
                    bucket.tickets.add(r.reference);
                    if (!storeTickets[store]) storeTickets[store] = new Set();
                    storeTickets[store].add(r.reference);
                    if (!groupTickets[groupKey]) groupTickets[groupKey] = new Set();
                    groupTickets[groupKey].add(r.reference);
                    allTicketSet.add(r.reference);
                }
            } else if (r.type === 'refund') {
                bucket.netSales -= Math.abs(total);
            } else if (r.type === 'cash buy' || r.type === 'exchange') {
                bucket.buys += Math.abs(total);
            }
        }

        const allStoresArr = [...allStoresSet].sort((a, b) => a.localeCompare(b));

        // Supercategories present in the data (for the sup multi-select UI)
        const supersInData = new Set();
        for (const c of allCategories) supersInData.add(getSupercategory(c));
        const allSupersArr = [];
        for (const s of SUPERCATEGORY_LIST) if (supersInData.has(s)) allSupersArr.push(s);
        for (const s of supersInData) if (!allSupersArr.includes(s)) allSupersArr.push(s);

        // Groups array for the active groupBy (used as columns or rows)
        let allGroupsArr;
        if (ddState.groupBy === 'sup') {
            allGroupsArr = allSupersArr.slice();
        } else {
            allGroupsArr = [...allGroupSet].sort((a, b) => a.localeCompare(b));
        }

        ddState.allCats = [...allCategories].sort((a, b) => a.localeCompare(b));
        ddState.allSupers = allSupersArr;
        ddState.allStores = allStoresArr;

        if (!allStoresArr.length || !allGroupsArr.length) {
            thead.innerHTML = '<tr><th>Tienda</th></tr>';
            const msg = weekFrom === weekTo ? 'Sin datos para esta semana.' : 'Sin datos para este rango de semanas.';
            tbody.innerHTML = `<tr><td class="empty-msg">${msg}</td></tr>`;
            tfoot.innerHTML = '';
            updateMultiSelectUI('sup');
            updateMultiSelectUI('cat');
            updateMultiSelectUI('store');
            const ddGroupsEmptyInst = storeGroupsInstances.find(i => i.prefix === 'dd');
            if (ddGroupsEmptyInst) renderStoreGroupsUIFor(ddGroupsEmptyInst);
            return;
        }

        const isCurrency = metric === 'netSales' || metric === 'buys';
        const isTickets = metric === 'tickets';
        const extract = (bucket) => {
            if (!bucket) return 0;
            if (isTickets) return bucket.tickets.size;
            return bucket[metric] || 0;
        };
        const fmt = (v) => isCurrency ? formatCurrency(v) : (v || 0).toLocaleString('es-ES');

        // Per-group total for the active metric (used for top-N defaults on the cat side)
        const groupTotalForMetric = (g) => {
            if (isTickets) return groupTickets[g] ? groupTickets[g].size : 0;
            let t = 0;
            for (const store of allStoresArr) {
                const b = byStoreGroup[store]?.[g];
                if (b) t += b[metric] || 0;
            }
            return t;
        };

        // Defaults / reconciliation for the group multi-select (matches groupBy)
        const groupStateKey = ddState.groupBy === 'sup' ? 'visibleSupers' : 'visibleCats';
        const groupTouchedKey = ddState.groupBy === 'sup' ? 'supersTouched' : 'catsTouched';
        const rangeKey = `${weekFrom}-${weekTo}-${excludeEcom ? 'e' : 'f'}-${ddState.groupBy}-${ddState.axisMode}`;
        const needAutoTop = !ddState[groupTouchedKey] && (
            !ddState[groupStateKey] ||
            ddState.lastAutoMetric !== metric ||
            ddState.lastAutoRange !== rangeKey
        );
        if (needAutoTop) {
            if (ddState.groupBy === 'sup') {
                // Few supers: default = all marked
                ddState[groupStateKey] = new Set(allGroupsArr);
            } else {
                // Many cats: default = top 5 by metric
                const top5 = [...allGroupsArr]
                    .sort((a, b) => groupTotalForMetric(b) - groupTotalForMetric(a))
                    .slice(0, 5);
                ddState[groupStateKey] = new Set(top5);
            }
            ddState.lastAutoMetric = metric;
            ddState.lastAutoRange = rangeKey;
        } else if (ddState[groupStateKey]) {
            const groupSet = new Set(allGroupsArr);
            ddState[groupStateKey] = new Set([...ddState[groupStateKey]].filter(g => groupSet.has(g)));
        }

        // Stores multi-select
        if (!ddState.storesTouched || !ddState.visibleStores) {
            ddState.visibleStores = new Set(allStoresArr);
        } else {
            ddState.visibleStores = new Set([...ddState.visibleStores].filter(s => allStoresSet.has(s)));
        }

        updateMultiSelectUI('sup');
        updateMultiSelectUI('cat');
        updateMultiSelectUI('store');
        const ddGroupsInst = storeGroupsInstances.find(i => i.prefix === 'dd');
        if (ddGroupsInst) renderStoreGroupsUIFor(ddGroupsInst);

        const visibleGroups = allGroupsArr.filter(g => ddState[groupStateKey].has(g));
        const visibleStores = allStoresArr.filter(s => ddState.visibleStores.has(s));

        if (!visibleStores.length || !visibleGroups.length) {
            thead.innerHTML = '<tr><th>Tienda</th></tr>';
            tbody.innerHTML = '<tr><td class="empty-msg">No hay items seleccionados. Despliega los filtros.</td></tr>';
            tfoot.innerHTML = '';
            return;
        }

        // Orientation: who goes on the row axis
        const storeRows = ddState.axisMode === 'store-rows';
        const rowsArr = storeRows ? visibleStores.slice() : visibleGroups.slice();
        const colsArr = storeRows ? visibleGroups.slice() : visibleStores.slice();

        // Cell lookup abstracts over orientation: row × col → bucket
        const bucketFor = (row, col) => {
            const store = storeRows ? row : col;
            const group = storeRows ? col : row;
            return byStoreGroup[store]?.[group];
        };

        // Row values + row totals (up-front so we can sort)
        const rowValues = {};
        const rowTotals = {};
        for (const row of rowsArr) {
            rowValues[row] = {};
            for (const col of colsArr) {
                rowValues[row][col] = extract(bucketFor(row, col));
            }
            if (isTickets) {
                const refs = new Set();
                for (const col of colsArr) {
                    const b = bucketFor(row, col);
                    if (b && b.tickets) for (const ref of b.tickets) refs.add(ref);
                }
                rowTotals[row] = refs.size;
            } else {
                rowTotals[row] = colsArr.reduce((sum, col) => sum + rowValues[row][col], 0);
            }
        }

        // Sort
        const sortCol = ddState.sortCol;
        const sortDir = ddState.sortDir;
        if (sortCol) {
            const getVal = (row) => {
                if (sortCol === 'name') return row.toLowerCase();
                if (sortCol === '__total__') return rowTotals[row] || 0;
                if (sortCol.startsWith('col:')) return rowValues[row][sortCol.slice(4)] || 0;
                return 0;
            };
            rowsArr.sort((a, b) => {
                const va = getVal(a);
                const vb = getVal(b);
                if (typeof va === 'string') {
                    return sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
                }
                return sortDir === 'desc' ? (vb - va) : (va - vb);
            });
        }

        const sortCls = (col) => sortCol === col ? (sortDir === 'desc' ? ' sort-desc' : ' sort-asc') : '';
        const rowHeaderLabel = storeRows ? 'Tienda' : groupLabel;

        // Header
        let head = `<tr><th class="col-name sortable${sortCls('name')}" data-dd-sort="name">${escapeHtml(rowHeaderLabel)}</th>`;
        for (const col of colsArr) {
            const key = `col:${col}`;
            head += `<th class="sortable${sortCls(key)}" data-dd-sort="${escapeHtml(key)}">${escapeHtml(col)}</th>`;
        }
        head += `<th class="col-shaded sortable${sortCls('__total__')}" data-dd-sort="__total__">Total</th></tr>`;
        thead.innerHTML = head;
        thead.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => sortDashDetail(th.dataset.ddSort));
        });

        // Body
        let html = '';
        const colTotals = new Array(colsArr.length).fill(0);
        let grandTotal = 0;

        for (const row of rowsArr) {
            let tr = `<tr><td class="col-name">${escapeHtml(row)}</td>`;
            colsArr.forEach((col, i) => {
                const v = rowValues[row][col];
                if (!isTickets) colTotals[i] += v;
                tr += `<td>${v ? fmt(v) : '<span class="cell-zero">--</span>'}</td>`;
            });
            if (!isTickets) grandTotal += rowTotals[row];
            tr += `<td class="col-shaded"><strong>${rowTotals[row] ? fmt(rowTotals[row]) : '--'}</strong></td></tr>`;
            html += tr;
        }
        tbody.innerHTML = html;

        // Footer: column totals + grand total
        let visibleRefs = null;
        let foot = '<tr class="row-total"><td class="col-name"><strong>TOTAL</strong></td>';
        colsArr.forEach((col, i) => {
            let v;
            if (isTickets) {
                const refs = new Set();
                for (const row of rowsArr) {
                    const b = bucketFor(row, col);
                    if (b && b.tickets) for (const ref of b.tickets) refs.add(ref);
                }
                v = refs.size;
                if (!visibleRefs) visibleRefs = new Set();
                for (const ref of refs) visibleRefs.add(ref);
            } else {
                v = colTotals[i];
            }
            foot += `<td><strong>${v ? fmt(v) : '--'}</strong></td>`;
        });
        const totalCell = isTickets ? (visibleRefs ? visibleRefs.size : 0) : grandTotal;
        foot += `<td class="col-shaded"><strong>${totalCell ? fmt(totalCell) : '--'}</strong></td></tr>`;
        tfoot.innerHTML = foot;
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
            const rowKey = row.dataset.row;
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
