/**
 * UI Module - Handles all DOM interactions and rendering.
 * All dates displayed to the user use DD/MM/AAAA format.
 */
const UI = (() => {

    /** Format ISO date (YYYY-MM-DD) or ISO datetime to DD/MM/AAAA */
    function formatDate(dateStr) {
        if (!dateStr) return '--';
        const iso = dateStr.substring(0, 10);
        const parts = iso.split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return dateStr;
    }

    /** Parse DD/MM/AAAA to ISO YYYY-MM-DD. Returns null if invalid. */
    function parseDateInput(ddmmaaaa) {
        if (!ddmmaaaa) return null;
        const match = ddmmaaaa.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!match) return null;
        const [, dd, mm, yyyy] = match;
        const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
        if (isNaN(d.getTime())) return null;
        return `${yyyy}-${mm}-${dd}`;
    }

    /** Show a section, hide others */
    function showSection(sectionId) {
        document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
        const target = document.getElementById(`section-${sectionId}`);
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.nav-btn[data-section="${sectionId}"]`);
        if (btn) btn.classList.add('active');
    }

    /** Update the DB status badge */
    function updateDBStatus(count) {
        const badge = document.getElementById('db-status');
        if (badge) {
            badge.textContent = `DB: ${count.toLocaleString()} registros`;
            badge.style.color = count > 0 ? 'var(--color-success)' : 'var(--color-text-light)';
        }
    }

    /** Show import preview */
    function showPreview(headers, rows, mapping) {
        const container = document.getElementById('import-preview');
        const statsEl = document.getElementById('preview-stats');
        const tableEl = document.getElementById('preview-table');

        // Stats
        statsEl.innerHTML = `
            <span><strong>${rows.length}</strong> filas en vista previa</span>
            <span><strong>${headers.length}</strong> columnas detectadas</span>
            <span><strong>${Object.keys(mapping).length}</strong> campos mapeados</span>
        `;

        // Table
        let html = '<thead><tr>';
        for (const h of headers) {
            const mapped = mapping[h];
            html += `<th>${h}${mapped ? ` <small style="color:var(--color-primary)">[${mapped}]</small>` : ''}</th>`;
        }
        html += '</tr></thead><tbody>';

        for (const row of rows) {
            html += '<tr>';
            for (const h of headers) {
                html += `<td>${escapeHtml(row[h] || '')}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody>';

        tableEl.innerHTML = html;
        container.classList.remove('hidden');
    }

    /** Hide import preview */
    function hidePreview() {
        document.getElementById('import-preview').classList.add('hidden');
    }

    /** Show/update import progress */
    function showProgress(current, total, text) {
        const container = document.getElementById('import-progress');
        const fill = document.getElementById('import-progress-fill');
        const textEl = document.getElementById('import-progress-text');

        container.classList.remove('hidden');
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        fill.style.width = `${pct}%`;
        textEl.textContent = text || `Importando... ${current.toLocaleString()} de ${total.toLocaleString()} (${pct}%)`;
    }

    /** Hide progress */
    function hideProgress() {
        document.getElementById('import-progress').classList.add('hidden');
    }

    /** Add log entry */
    function addLog(message, type = 'info') {
        const log = document.getElementById('import-log');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.prepend(entry);
    }

    /** Render dashboard summary cards */
    function renderDashboard(stats) {
        document.getElementById('stat-total-records').textContent =
            stats.totalRecords ? stats.totalRecords.toLocaleString() : '--';
        document.getElementById('stat-date-range').textContent =
            stats.dateRange ? `${formatDate(stats.dateRange.from)} a ${formatDate(stats.dateRange.to)}` : '--';
        document.getElementById('stat-categories').textContent =
            stats.categories ? stats.categories.length : '--';
        document.getElementById('stat-last-import').textContent =
            stats.lastImport ? formatDate(stats.lastImport) : '--';
    }

    /** Render KPI results */
    function renderKPIs(results) {
        const container = document.getElementById('kpi-results');
        container.innerHTML = '';

        for (const [id, kpi] of Object.entries(results)) {
            const card = document.createElement('div');
            card.className = 'kpi-card';

            let valueHtml = '';
            if (kpi.error) {
                valueHtml = `<div class="kpi-value" style="color:var(--color-danger)">Error</div>
                             <div class="kpi-detail">${kpi.error}</div>`;
            } else if (kpi.result !== null) {
                valueHtml = formatKPIResult(id, kpi.result);
            }

            card.innerHTML = `
                <h3>${kpi.name}</h3>
                ${valueHtml}
            `;
            container.appendChild(card);
        }
    }

    /** Format KPI result for display */
    function formatKPIResult(id, result) {
        // Simple value display
        if (typeof result === 'number') {
            return `<div class="kpi-value">${result.toLocaleString()}</div>`;
        }

        if (result.value !== undefined) {
            let html = `<div class="kpi-value">${result.value.toLocaleString()}</div>`;
            if (result.total !== undefined) {
                html += `<div class="kpi-detail">Total: ${result.total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</div>`;
            }
            return html;
        }

        // Object with nested data - show as compact table
        if (typeof result === 'object') {
            const entries = Object.entries(result);
            if (entries.length === 0) {
                return '<div class="kpi-detail">Sin datos</div>';
            }

            // Simple key-value object
            if (entries.length <= 10 && typeof entries[0][1] !== 'object') {
                let html = '<div class="kpi-detail"><table style="width:100%">';
                for (const [k, v] of entries) {
                    html += `<tr><td>${k}</td><td style="text-align:right"><strong>${typeof v === 'number' ? v.toLocaleString() : JSON.stringify(v)}</strong></td></tr>`;
                }
                html += '</table></div>';
                return html;
            }

            // Complex nested - show summary count
            if (result.total !== undefined) {
                return `<div class="kpi-value">${result.total.toLocaleString()}</div>
                        <div class="kpi-detail">${entries.length - 1} grupos</div>`;
            }

            return `<div class="kpi-value">${entries.length}</div>
                    <div class="kpi-detail">grupos</div>`;
        }

        return `<div class="kpi-value">${result}</div>`;
    }

    /** Render data table with pagination */
    function renderDataTable(result) {
        const container = document.getElementById('data-table-container');
        const table = document.getElementById('data-table');
        const pagination = document.getElementById('data-pagination');

        if (!result.records.length) {
            table.innerHTML = '<tr><td>No hay datos</td></tr>';
            pagination.innerHTML = '';
            return;
        }

        // Headers from first record's keys (excluding internal fields)
        const fields = Object.keys(result.records[0]).filter(k => !k.startsWith('_') && k !== 'id');

        let html = '<thead><tr>';
        for (const f of fields) {
            html += `<th>${f}</th>`;
        }
        html += '</tr></thead><tbody>';

        for (const record of result.records) {
            const rowCls = record.channel === 'ecom' ? ' class="row-ecom"' : '';
            html += `<tr${rowCls}>`;
            for (const f of fields) {
                let val = record[f] || '';
                // Format date fields as DD/MM/AAAA
                if (f === 'date' && val) val = formatDate(val);
                html += `<td>${escapeHtml(String(val))}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody>';
        table.innerHTML = html;

        // Pagination
        const totalPages = Math.ceil(result.total / result.pageSize);
        let pagHtml = '';
        for (let i = 1; i <= Math.min(totalPages, 10); i++) {
            pagHtml += `<button class="btn btn-secondary ${i === result.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        if (totalPages > 10) {
            pagHtml += `<span>... ${totalPages} paginas</span>`;
        }
        pagination.innerHTML = pagHtml;
    }

    /** Populate store filter dropdowns */
    function populateStoreFilter(stores) {
        const select = document.getElementById('kpi-store');
        select.innerHTML = '<option value="all">Todas las tiendas</option>';
        for (const store of stores) {
            select.innerHTML += `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`;
        }
    }

    /** Populate type filter dropdown */
    function populateTypeFilter(types) {
        const select = document.getElementById('data-filter-type');
        select.innerHTML = '<option value="all">Todos los tipos</option>';
        for (const type of types) {
            select.innerHTML += `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`;
        }
    }

    /** Update settings info */
    function updateSettingsInfo(info) {
        document.getElementById('settings-db-info').textContent = info;
    }

    /** Update drive status */
    function updateDriveStatus(text) {
        document.getElementById('drive-status').textContent = text;
    }

    /** Escape HTML to prevent XSS */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        showSection,
        updateDBStatus,
        showPreview,
        hidePreview,
        showProgress,
        hideProgress,
        addLog,
        renderDashboard,
        renderKPIs,
        renderDataTable,
        populateStoreFilter,
        populateTypeFilter,
        updateSettingsInfo,
        updateDriveStatus,
        formatDate,
        parseDateInput
    };
})();
