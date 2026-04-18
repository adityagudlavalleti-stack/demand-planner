'use strict';

// ─── Data Loading ────────────────────────────────────────────────────────────
async function loadAll() {
  const [forecast, po, schedule, alertsRaw, accuracy] = await Promise.all([
    fetch('data/forecast.json').then(r => r.json()),
    fetch('data/purchase_orders.json').then(r => r.json()),
    fetch('data/schedule.json').then(r => r.json()),
    fetch('data/alerts.json').then(r => r.json()).catch(() => ({ alerts: [] })),
    fetch('data/accuracy.json').then(r => r.json()).catch(() => null),
  ]);
  return { forecast, po, schedule, alerts: alertsRaw.alerts || [], accuracy };
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

// ─── Forecast Tab ─────────────────────────────────────────────────────────────
let forecastChart = null;
let _accuracy = null;  // module-level so updateChart can access it
const PALETTE = ['#3b82f6','#22c55e','#f59e0b','#ec4899','#8b5cf6','#06b6d4'];

function buildForecastTab(data, accuracy) {
  _accuracy = accuracy;
  const skus = Object.keys(data.skus);
  let activeSku = skus[0];

  // Model health badge
  const headerEl = document.querySelector('#tab-forecast .section-header');
  if (accuracy && accuracy.health_badge !== 'NO DATA') {
    const badgeClass = { GOOD: 'badge-green', FAIR: 'badge-yellow', POOR: 'badge-red' }[accuracy.health_badge] || 'badge-blue';
    const mapeStr = accuracy.overall_mape != null ? `MAPE ${accuracy.overall_mape.toFixed(1)}%` : '';
    const wrap = document.createElement('div');
    wrap.className = 'health-badge-wrap';
    wrap.innerHTML = `<span class="badge ${badgeClass}">Model: ${accuracy.health_badge}</span><span style="color:var(--muted);font-size:12px">${mapeStr}</span>`;
    headerEl.appendChild(wrap);
  }

  // SKU filter buttons
  const filterEl = document.getElementById('sku-filter');
  skus.forEach((sku, i) => {
    const btn = document.createElement('button');
    btn.className = 'sku-btn' + (i === 0 ? ' active' : '');
    btn.textContent = sku;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sku-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSku = sku;
      updateChart(data, activeSku, _accuracy);
    });
    filterEl.appendChild(btn);
  });

  // Chart
  const ctx = document.getElementById('forecast-chart').getContext('2d');
  const labels = data.skus[skus[0]].daily.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const initDatasets = buildDatasets(data, skus[0], accuracy, PALETTE[0]);
  forecastChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: initDatasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: initDatasets.length > 1, labels: { color: '#94a3b8', boxWidth: 14 } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b', maxTicksLimit: 14 } },
        y: { grid: { color: '#253347' }, ticks: { color: '#64748b' }, beginAtZero: true,
             title: { display: true, text: 'Units', color: '#64748b' } }
      }
    }
  });

  // Weekly summary table
  const tbody = document.querySelector('#forecast-table tbody');
  skus.forEach((sku, si) => {
    const d = data.skus[sku];
    const totalRev = d.weekly_summary.reduce((a, w) => a + w.revenue, 0);
    const skuAcc = accuracy && accuracy.sku_summary && accuracy.sku_summary[sku];

    // Actuals cell: show per-week actual if available
    let actualsHtml = '<span style="color:var(--muted)">—</span>';
    if (accuracy && accuracy.weeks) {
      const weekActuals = accuracy.weeks.map(wk => {
        const sd = wk.skus[sku];
        return sd && sd.has_actual ? sd.actual_units : null;
      });
      if (weekActuals.some(v => v !== null)) {
        actualsHtml = weekActuals.map(v => v != null ? v : '—').join(' / ');
      }
    }

    // Accuracy cell
    let accHtml = '<span style="color:var(--muted)">—</span>';
    if (skuAcc && skuAcc.mape != null) {
      const color = skuAcc.mape <= 10 ? 'var(--green)' : skuAcc.mape <= 20 ? 'var(--yellow)' : 'var(--red)';
      const cal = skuAcc.needs_calibration ? ' <span class="badge badge-yellow" style="font-size:10px">Tuning</span>' : '';
      accHtml = `<span style="color:${color};font-weight:600">${skuAcc.mape.toFixed(1)}%</span>${cal}`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="color:${PALETTE[si % PALETTE.length]};font-weight:700">${sku}</span></td>
      <td>${d.name}</td>
      ${d.weekly_summary.map(w => `<td>${w.units} u · $${w.revenue.toLocaleString()}</td>`).join('')}
      <td><strong>$${totalRev.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></td>
      <td style="font-size:12px;color:var(--muted)">${actualsHtml}</td>
      <td>${accHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildDatasets(data, sku, accuracy, color) {
  const d = data.skus[sku];
  const datasets = [{
    label: d.name + ' (Forecast)',
    data: d.daily.map(x => x.units),
    borderColor: color,
    backgroundColor: color + '22',
    fill: true,
    tension: 0.35,
    pointRadius: 2,
    borderWidth: 2,
    borderDash: [],
  }];

  if (accuracy && accuracy.weeks) {
    const actualPoints = buildActualDailyPoints(data, sku, accuracy);
    if (actualPoints.some(v => v !== null)) {
      datasets.push({
        label: d.name + ' (Actual)',
        data: actualPoints,
        borderColor: '#f97316',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.2,
        pointRadius: 4,
        borderWidth: 2.5,
        borderDash: [4, 3],
        spanGaps: false,
      });
    }
  }
  return datasets;
}

function buildActualDailyPoints(data, sku, accuracy) {
  // Spread weekly actual totals evenly across 7 days for chart overlay
  const weekActuals = {};
  (accuracy.weeks || []).forEach(week => {
    const skuData = week.skus[sku];
    if (skuData && skuData.has_actual && skuData.actual_units != null) {
      const start = new Date(week.week_start + 'T00:00:00');
      const daily = skuData.actual_units / 7;
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        weekActuals[d.toISOString().slice(0, 10)] = daily;
      }
    }
  });
  return data.skus[sku].daily.map(pt => weekActuals[pt.date] !== undefined ? weekActuals[pt.date] : null);
}

function updateChart(data, sku, accuracy) {
  const color = PALETTE[Object.keys(data.skus).indexOf(sku) % PALETTE.length];
  const datasets = buildDatasets(data, sku, accuracy, color);
  forecastChart.data.datasets = datasets;
  forecastChart.options.plugins.legend.display = datasets.length > 1;
  forecastChart.update();
}

// ─── Purchase Orders Tab ──────────────────────────────────────────────────────
function buildPOTab(data) {
  const urgent = data.orders.filter(o => o.urgency === 'URGENT').length;
  const soon   = data.orders.filter(o => o.urgency === 'ORDER SOON').length;
  document.getElementById('po-summary').innerHTML = `
    <div class="po-stat">
      <div class="val">$${data.total_estimated_cost.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
      <div class="lbl">Total Est. Cost</div>
    </div>
    <div class="po-stat">
      <div class="val" style="color:var(--red)">${urgent}</div>
      <div class="lbl">Urgent</div>
    </div>
    <div class="po-stat">
      <div class="val" style="color:var(--yellow)">${soon}</div>
      <div class="lbl">Order Soon</div>
    </div>
  `;

  const urgencyBadge = {
    'URGENT':     '<span class="badge badge-red">Urgent</span>',
    'ORDER SOON': '<span class="badge badge-yellow">Order Soon</span>',
    'PLAN':       '<span class="badge badge-blue">Plan</span>',
    'OK':         '<span class="badge badge-green">OK</span>',
  };

  const tbody = document.querySelector('#po-table tbody');
  data.orders.forEach(o => {
    const tr = document.createElement('tr');
    const daysClass = o.days_of_stock_remaining < 7 ? 'style="color:var(--red)"'
                    : o.days_of_stock_remaining < 14 ? 'style="color:var(--yellow)"' : '';
    tr.innerHTML = `
      <td>${urgencyBadge[o.urgency] || o.urgency}</td>
      <td><strong>${o.sku}</strong></td>
      <td>${o.name}</td>
      <td>${o.supplier}</td>
      <td>${o.current_stock}</td>
      <td>${o.four_week_demand}</td>
      <td ${daysClass}>${o.days_of_stock_remaining}d</td>
      <td>${o.order_qty > 0 ? '<strong>' + o.order_qty + '</strong>' : '—'}</td>
      <td>${o.est_order_cost > 0 ? '$' + o.est_order_cost.toLocaleString() : '—'}</td>
      <td>${o.order_by || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Schedule Tab ─────────────────────────────────────────────────────────────
function buildScheduleTab(data) {
  let activeWeek = 1;

  const navEl = document.getElementById('week-nav');
  [1,2,3,4].forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'week-btn' + (w === 1 ? ' active' : '');
    btn.textContent = 'Week ' + w;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.week-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeWeek = w;
      renderScheduleGrid(data, activeWeek);
    });
    navEl.appendChild(btn);
  });

  const tbody = document.querySelector('#hours-table tbody');
  data.employees.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${e.name}</strong></td>
      <td style="color:var(--muted)">${e.role}</td>
      ${e.weekly_hours.map(h => `<td>${h}h</td>`).join('')}
      <td><strong>${e.total_hours}h</strong></td>
    `;
    tbody.appendChild(tr);
  });

  renderScheduleGrid(data, 1);

  const badDays = data.days.filter(d => d.understaffed);
  if (badDays.length) {
    const el = document.getElementById('schedule-understaffed');
    el.textContent = `\u26a0 ${badDays.length} understaffed day(s): ${badDays.map(d => d.date).join(', ')}`;
    el.classList.remove('hidden');
  }
}

function renderScheduleGrid(data, week) {
  const days = data.days.filter(d => d.week === week);
  const employees = data.employees;
  const container = document.getElementById('schedule-grid');

  const lookup = {};
  days.forEach(day => {
    lookup[day.date] = {};
    day.assignments.forEach(a => {
      if (!lookup[day.date][a.employee_id]) lookup[day.date][a.employee_id] = [];
      lookup[day.date][a.employee_id].push(a.shift);
    });
  });

  let html = '<div class="schedule-grid-wrap"><table class="schedule-table"><thead><tr><th>Employee</th>';
  days.forEach(day => {
    const dt = new Date(day.date + 'T00:00:00');
    const label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const under = day.understaffed ? ' style="color:var(--red)"' : '';
    html += `<th><div${under}>${label}</div><div class="day-header-under">$${Math.round(day.projected_revenue).toLocaleString()}</div></th>`;
  });
  html += '</tr></thead><tbody>';

  employees.forEach(emp => {
    html += `<tr><td class="emp-name">${emp.name}<br><span style="color:var(--muted);font-size:11px;font-weight:400">${emp.role}</span></td>`;
    days.forEach(day => {
      const shifts = lookup[day.date][emp.id] || [];
      const under = day.understaffed ? ' understaffed-cell' : '';
      let cell = '';
      if (shifts.includes('OFF') || shifts.length === 0) {
        cell = '<span class="shift-off">OFF</span>';
      } else if (shifts.includes('AM') && shifts.includes('PM')) {
        cell = '<span class="shift-both">AM+PM</span>';
      } else if (shifts.includes('AM')) {
        cell = '<span class="shift-am">AM</span>';
      } else {
        cell = '<span class="shift-pm">PM</span>';
      }
      html += `<td class="${under}">${cell}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ─── Alert Banner ─────────────────────────────────────────────────────────────
function buildAlertBanner(alerts) {
  const banner = document.getElementById('alert-banner');
  if (!alerts.length) { banner.classList.add('hidden'); return; }

  const urgent  = alerts.filter(a => a.level === 'urgent');
  const warning = alerts.filter(a => a.level === 'warning');

  let html = '<div class="alert-banner-inner">';
  if (urgent.length) {
    html += `<span class="alert-icon alert-urgent">&#9888; ${urgent.length} URGENT</span>`;
    urgent.forEach(a => { html += `<span class="alert-item alert-urgent-item">${a.message}</span>`; });
  }
  if (warning.length) {
    html += `<span class="alert-icon alert-warn">&#9888; ${warning.length} Order Soon</span>`;
    warning.forEach(a => { html += `<span class="alert-item alert-warn-item">${a.message}</span>`; });
  }
  html += '</div>';
  banner.innerHTML = html;
  banner.classList.remove('hidden');
}

// ─── Log Sales Tab ────────────────────────────────────────────────────────────
const LS_KEY = 'dp_sales_log';

function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function lsSave(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

function buildLogTab(forecast) {
  const skus = Object.keys(forecast.skus);

  // Build SKU input rows
  const formSkus = document.getElementById('log-form-skus');
  skus.forEach(sku => {
    const row = document.createElement('div');
    row.className = 'log-sku-row';
    row.innerHTML = `
      <span class="log-sku-label">${sku}</span>
      <span class="log-sku-name">${forecast.skus[sku].name}</span>
      <input type="number" class="log-sku-input" id="log-input-${sku}"
             min="0" step="1" value="0" data-sku="${sku}" />
    `;
    formSkus.appendChild(row);
  });

  // Build log table headers — insert SKU columns before last two (Total, delete)
  const logThead = document.getElementById('log-table-head');
  const totalTh = logThead.children[1]; // "Total Units" th
  skus.forEach(sku => {
    const th = document.createElement('th');
    th.textContent = sku;
    logThead.insertBefore(th, totalTh);
  });

  // Default date to today
  document.getElementById('log-date').value = new Date().toISOString().slice(0, 10);

  // Quick-fill today
  document.getElementById('btn-quick-today').addEventListener('click', () => {
    document.getElementById('log-date').value = new Date().toISOString().slice(0, 10);
  });

  // Save entry
  document.getElementById('btn-save-entry').addEventListener('click', () => {
    const logDate = document.getElementById('log-date').value;
    if (!logDate) { showLogFeedback('Please select a date.', false); return; }
    const entries = {};
    skus.forEach(sku => {
      entries[sku] = parseInt(document.getElementById('log-input-' + sku).value, 10) || 0;
    });
    const arr = lsLoad();
    arr.push({ id: Date.now().toString(), date: logDate, entries });
    lsSave(arr);
    skus.forEach(sku => { document.getElementById('log-input-' + sku).value = 0; });
    showLogFeedback('Saved.', true);
    renderLogTable(skus);
    updateLogBadge();
  });

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', () => exportLogCSV(skus));

  renderLogTable(skus);
  updateLogBadge();
}

function renderLogTable(skus) {
  const arr = lsLoad();
  const tbody = document.querySelector('#log-table tbody');
  tbody.innerHTML = '';

  const sorted = [...arr].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach(entry => {
    const tr = document.createElement('tr');
    const total = skus.reduce((s, sku) => s + (entry.entries[sku] || 0), 0);
    const skuCells = skus.map(sku => `<td>${entry.entries[sku] || 0}</td>`).join('');
    tr.innerHTML = `
      <td>${entry.date}</td>
      ${skuCells}
      <td><strong>${total}</strong></td>
      <td><button class="btn-delete-log" data-id="${entry.id}" title="Delete">&times;</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-delete-log').forEach(btn => {
    btn.addEventListener('click', () => {
      lsSave(lsLoad().filter(e => e.id !== btn.dataset.id));
      renderLogTable(skus);
      updateLogBadge();
    });
  });

  document.getElementById('log-entries-count').textContent = arr.length;
}

function updateLogBadge() {
  const count = lsLoad().length;
  const badge = document.getElementById('log-count-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function showLogFeedback(msg, ok) {
  const el = document.getElementById('log-save-feedback');
  el.textContent = msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function exportLogCSV(skus) {
  const arr = lsLoad();
  if (!arr.length) { alert('No entries to export.'); return; }

  // Aggregate (date, sku) -> sum, skip zeros
  const agg = {};
  arr.forEach(entry => {
    skus.forEach(sku => {
      const units = entry.entries[sku] || 0;
      if (units > 0) {
        const key = entry.date + '|' + sku;
        agg[key] = (agg[key] || 0) + units;
      }
    });
  });

  const rows = Object.entries(agg).sort(([a], [b]) => a.localeCompare(b));
  let csv = 'date,sku,units\n';
  rows.forEach(([key, units]) => {
    const [d, sku] = key.split('|');
    csv += `${d},${sku},${units}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `sales_log_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const { forecast, po, schedule, alerts, accuracy } = await loadAll();

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('tab-forecast').classList.remove('hidden');

    document.getElementById('meta-info').textContent =
      `Generated ${forecast.generated}  \u00b7  ${forecast.forecast_start} \u2192 ${forecast.forecast_end}`;

    buildAlertBanner(alerts);
    buildForecastTab(forecast, accuracy);
    buildPOTab(po);
    buildScheduleTab(schedule);
    buildLogTab(forecast);
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:var(--red)">Failed to load data: ${err.message}</p>
       <p style="color:var(--muted);margin-top:8px;font-size:12px">Run <code>python tools/run_demand_planning.py</code> first, then open this file via a local server or GitHub Pages.</p>`;
  }
})();
