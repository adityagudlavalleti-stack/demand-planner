'use strict';

// ─── Data Loading ────────────────────────────────────────────────────────────
async function loadAll() {
  const [forecast, po, schedule, alertsRaw] = await Promise.all([
    fetch('data/forecast.json').then(r => r.json()),
    fetch('data/purchase_orders.json').then(r => r.json()),
    fetch('data/schedule.json').then(r => r.json()),
    fetch('data/alerts.json').then(r => r.json()).catch(() => ({ alerts: [] })),
  ]);
  return { forecast, po, schedule, alerts: alertsRaw.alerts || [] };
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
const PALETTE = ['#3b82f6','#22c55e','#f59e0b','#ec4899','#8b5cf6','#06b6d4'];

function buildForecastTab(data) {
  const skus = Object.keys(data.skus);
  let activeSku = skus[0];

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
      updateChart(data, activeSku);
    });
    filterEl.appendChild(btn);
  });

  // Chart
  const ctx = document.getElementById('forecast-chart').getContext('2d');
  const labels = data.skus[skus[0]].daily.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  forecastChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: data.skus[skus[0]].name,
        data: data.skus[skus[0]].daily.map(d => d.units),
        borderColor: PALETTE[0],
        backgroundColor: PALETTE[0] + '22',
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
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
    const tr = document.createElement('tr');
    const totalRev = d.weekly_summary.reduce((a, w) => a + w.revenue, 0);
    tr.innerHTML = `
      <td><span style="color:${PALETTE[si % PALETTE.length]};font-weight:700">${sku}</span></td>
      <td>${d.name}</td>
      ${d.weekly_summary.map(w => `<td>${w.units} u · $${w.revenue.toLocaleString()}</td>`).join('')}
      <td><strong>$${totalRev.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

function updateChart(data, sku) {
  const d = data.skus[sku];
  forecastChart.data.datasets[0].label = d.name;
  forecastChart.data.datasets[0].data  = d.daily.map(x => x.units);
  forecastChart.data.datasets[0].borderColor = PALETTE[Object.keys(data.skus).indexOf(sku) % PALETTE.length];
  forecastChart.data.datasets[0].backgroundColor = PALETTE[Object.keys(data.skus).indexOf(sku) % PALETTE.length] + '22';
  forecastChart.update();
}

// ─── Purchase Orders Tab ──────────────────────────────────────────────────────
function buildPOTab(data) {
  // Summary bar
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

  // Week nav buttons
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

  // Hours table
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

  // Understaffed alert
  const badDays = data.days.filter(d => d.understaffed);
  if (badDays.length) {
    const el = document.getElementById('schedule-understaffed');
    el.textContent = `⚠ ${badDays.length} understaffed day(s): ${badDays.map(d => d.date).join(', ')}`;
    el.classList.remove('hidden');
  }
}

function renderScheduleGrid(data, week) {
  const days = data.days.filter(d => d.week === week);
  const employees = data.employees;
  const container = document.getElementById('schedule-grid');

  // Build assignment lookup: date → emp_id → shift(s)
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

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const { forecast, po, schedule, alerts } = await loadAll();

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('tab-forecast').classList.remove('hidden');

    document.getElementById('meta-info').textContent =
      `Generated ${forecast.generated}  ·  ${forecast.forecast_start} → ${forecast.forecast_end}`;

    buildAlertBanner(alerts);
    buildForecastTab(forecast);
    buildPOTab(po);
    buildScheduleTab(schedule);
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:var(--red)">Failed to load data: ${err.message}</p>
       <p style="color:var(--muted);margin-top:8px;font-size:12px">Run <code>python tools/run_demand_planning.py</code> first, then open this file via a local server or GitHub Pages.</p>`;
  }
})();
