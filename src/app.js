const chatLog = document.getElementById('chat-log');
const composer = document.getElementById('composer');
const prompt = document.getElementById('prompt');
const chips = document.getElementById('chips');
const clock = document.getElementById('clock');
const sidebarStats = document.getElementById('sidebar-stats');
const invStats = document.getElementById('inv-stats');
const invBody = document.getElementById('inv-body');
const filterCategory = document.getElementById('filter-category');
const salesStats = document.getElementById('sales-stats');
const salesBody = document.getElementById('sales-body');
const salesEmpty = document.getElementById('sales-empty');
const bars = document.getElementById('bars');

const SUGGESTIONS = [];

function money(n) {
  return `Rs ${Number(n || 0).toLocaleString('en-PK')}`;
}

function nowLabel() {
  return new Date().toLocaleString('en-PK', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short'
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `<span class="meta">${role === 'bot' ? 'Store Agent' : 'You'} · ${nowLabel()}</span>${escapeHtml(text)}`;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

chips.querySelectorAll('.chip').forEach((b) => {
  b.addEventListener('click', () => {
    prompt.value = b.dataset.fill || b.textContent;
    prompt.focus();
  });
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = prompt.value.trim();
  if (!message) return;
  prompt.value = '';
  addMessage('user', message);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    addMessage('bot', data.reply || 'Something went wrong.');
    await refresh();
  } catch {
    addMessage('bot', 'Could not reach the store desk. Please try again.');
  }
});

async function refresh() {
  const res = await fetch('/api/store');
  const data = await res.json();
  renderSidebar(data);
  renderInventory(data);
  renderSales(data);
}

function renderSidebar(data) {
  const today = data.todaySummary || { revenue: 0, count: 0 };
  const inv = data.inventorySummary || { low: 0 };
  sidebarStats.innerHTML = `
    <div class="mini-stat"><span>Today's sales</span><strong>${money(today.revenue)}</strong></div>
    <div class="mini-stat"><span>Orders today</span><strong>${today.count}</strong></div>
    <div class="mini-stat"><span>Low stock</span><strong>${inv.low}</strong></div>
  `;
}

function renderInventory(data) {
  const inv = data.inventorySummary || { skus: 0, value: 0, low: 0, out: 0 };
  invStats.innerHTML = `
    <div class="stat"><span>SKUs</span><strong>${inv.skus}</strong></div>
    <div class="stat"><span>Stock value</span><strong>${money(inv.value)}</strong></div>
    <div class="stat"><span>Low stock</span><strong>${inv.low}</strong></div>
    <div class="stat"><span>Out of stock</span><strong>${inv.out}</strong></div>
  `;

  if (!filterCategory.dataset.ready) {
    const cats = [...new Set((data.inventory || []).map((p) => p.category))];
    cats.forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      filterCategory.appendChild(o);
    });
    filterCategory.dataset.ready = '1';
  }

  const cat = filterCategory.value;
  const rows = (data.inventory || []).filter((p) => !cat || p.category === cat);
  invBody.innerHTML = rows
    .map((p) => {
      const status = p.stock <= 0 ? 'Out' : p.stock <= 10 ? 'Low' : 'OK';
      const klass = p.stock <= 0 ? 'bad' : p.stock <= 10 ? 'warn' : 'ok';
      return `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category)}</td>
          <td>${money(p.price)} / ${escapeHtml(p.unit)}</td>
          <td>${p.stock} ${escapeHtml(p.unit)}</td>
          <td>${money(p.price * p.stock)}</td>
          <td><span class="status ${klass}">${status}</span></td>
        </tr>`;
    })
    .join('');
}

function renderSales(data) {
  const all = data.salesSummary || { count: 0, revenue: 0, units: 0, byProduct: {} };
  const today = data.todaySummary || { count: 0, revenue: 0 };
  salesStats.innerHTML = `
    <div class="stat"><span>Today</span><strong>${money(today.revenue)}</strong></div>
    <div class="stat"><span>Orders today</span><strong>${today.count}</strong></div>
    <div class="stat"><span>All-time revenue</span><strong>${money(all.revenue)}</strong></div>
    <div class="stat"><span>Units sold</span><strong>${all.units}</strong></div>
  `;

  const entries = Object.entries(all.byProduct || {}).sort((a, b) => b[1].revenue - a[1].revenue);
  const max = Math.max(1, ...entries.map((e) => e[1].revenue));
  bars.innerHTML = entries.length
    ? entries
        .slice(0, 8)
        .map(
          ([k, v]) => `
      <div class="bar-row">
        <div>${escapeHtml(k)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(v.revenue / max) * 100}%"></div></div>
        <div>${money(v.revenue)}</div>
      </div>`
        )
        .join('')
    : '<p class="empty show">No product sales yet.</p>';

  const rows = data.sales || [];
  salesEmpty.classList.toggle('show', rows.length === 0);
  salesBody.innerHTML = rows
    .map((s) => {
      const items = (s.items || []).map((i) => `${i.qty} ${i.unit} ${i.name}`).join(', ');
      const when = new Date(s.createdAt).toLocaleString('en-PK', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short'
      });
      return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td>${escapeHtml(s.customer)}</td>
          <td>${escapeHtml(items)}</td>
          <td class="amt">${money(s.total)}</td>
          <td><button class="ghost" data-id="${escapeHtml(s.id)}" type="button">Remove</button></td>
        </tr>`;
    })
    .join('');
}

salesBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  await fetch(`/api/sales/${btn.dataset.id}`, { method: 'DELETE' });
  await refresh();
});

filterCategory.addEventListener('change', refresh);

document.getElementById('export-csv').addEventListener('click', async () => {
  const res = await fetch('/api/store');
  const data = await res.json();
  const rows = data.sales || [];
  const csv = [
    ['Date', 'Customer', 'Items', 'Total'].join(','),
    ...rows.map((r) => {
      const items = (r.items || []).map((i) => `${i.qty} ${i.unit} ${i.name}`).join('; ');
      return [r.date, `"${r.customer}"`, `"${items.replaceAll('"', '""')}"`, r.total].join(',');
    })
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'green-cart-sales.csv';
  a.click();
  URL.revokeObjectURL(url);
});

setInterval(() => {
  clock.textContent = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}, 1000);
clock.textContent = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

addMessage(
  'bot',
  'Hello! I am the Green Cart store assistant.\nPlace an order like "2 kg rice, 1 dozen eggs, 3 liters milk", or ask about prices, stock, and sales.'
);

refresh().catch(() => {});
