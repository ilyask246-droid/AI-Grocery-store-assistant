import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTS, LOW_STOCK_THRESHOLD } from './catalog.js';
import * as parser from './parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const isProd = process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function seedStore() {
  return {
    inventory: PRODUCTS.map((p) => ({ ...p })),
    sales: []
  };
}

function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seedStore(), null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(parsed.inventory) || !Array.isArray(parsed.sales)) return seedStore();
    return parsed;
  } catch {
    return seedStore();
  }
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getProduct(store, sku) {
  return store.inventory.find((p) => p.sku === sku) || null;
}

function inventorySummary(store) {
  const value = store.inventory.reduce((s, p) => s + p.price * p.stock, 0);
  const low = store.inventory.filter((p) => p.stock <= LOW_STOCK_THRESHOLD);
  const out = store.inventory.filter((p) => p.stock <= 0);
  return {
    skus: store.inventory.length,
    value: parser.roundMoney(value),
    low: low.length,
    out: out.length
  };
}

function helpText() {
  return [
    'I can help run the store. Try:',
    '• Order: "2 kg rice, 1 dozen eggs, 3 liters milk"',
    '• Price: "How much is chicken?"',
    '• Stock: "Do you have tomatoes?"',
    '• Sales: "What are today\'s sales?"',
    '• Restock: "Restock 20 kg rice"',
    '• Catalog: "Show products"'
  ].join('\n');
}

function catalogText(store) {
  const groups = {};
  for (const p of store.inventory) {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category].push(p);
  }
  const lines = ['Here is what we sell:'];
  for (const [cat, items] of Object.entries(groups)) {
    lines.push('', cat);
    for (const p of items) {
      lines.push(`• ${p.name} — ${parser.formatMoney(p.price)} / ${p.unit} (stock ${p.stock})`);
    }
  }
  return lines.join('\n');
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/store', (_req, res) => {
  const store = readStore();
  const today = parser.todayIso();
  res.json({
    inventory: store.inventory,
    sales: store.sales.slice().sort((a, b) => b.createdAt - a.createdAt),
    inventorySummary: inventorySummary(store),
    salesSummary: parser.summarizeSales(store.sales),
    todaySummary: parser.summarizeSales(store.sales, today),
    lowStock: store.inventory.filter((p) => p.stock <= LOW_STOCK_THRESHOLD)
  });
});

app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Items required' });
  const store = readStore();
  const result = fulfillOrder(store, items, body.customer || 'Walk-in');
  if (!result.ok) return res.status(400).json(result);
  writeStore(store);
  res.status(201).json(result);
});

app.delete('/api/sales/:id', (req, res) => {
  const store = readStore();
  const sale = store.sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: 'Not found' });
  for (const item of sale.items || []) {
    const product = getProduct(store, item.sku);
    if (product) product.stock = parser.roundMoney(product.stock + Number(item.qty || 0));
  }
  store.sales = store.sales.filter((s) => s.id !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});

app.post('/api/restock', (req, res) => {
  const sku = String((req.body && req.body.sku) || '');
  const qty = Number(req.body && req.body.qty);
  if (!sku || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'sku and qty required' });
  }
  const store = readStore();
  const product = getProduct(store, sku);
  if (!product) return res.status(404).json({ error: 'Unknown product' });
  product.stock = parser.roundMoney(product.stock + qty);
  writeStore(store);
  res.json({ product });
});

function fulfillOrder(store, requested, customer) {
  const lines = [];
  const missing = [];
  const short = [];
  for (const reqItem of requested) {
    const product = getProduct(store, reqItem.sku);
    if (!product) {
      missing.push(reqItem.name || reqItem.sku);
      continue;
    }
    const qty = Number(reqItem.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (product.stock < qty) {
      short.push({
        name: product.name,
        requested: qty,
        available: product.stock,
        unit: product.unit
      });
      continue;
    }
    lines.push({
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      qty,
      price: product.price,
      lineTotal: parser.roundMoney(qty * product.price)
    });
  }
  if (missing.length || short.length || !lines.length) {
    return { ok: false, missing, short, lines };
  }
  for (const line of lines) {
    const product = getProduct(store, line.sku);
    product.stock = parser.roundMoney(product.stock - line.qty);
  }
  const sale = {
    id: uid('sale'),
    date: parser.todayIso(),
    customer: customer || 'Walk-in',
    items: lines,
    total: parser.roundMoney(lines.reduce((s, i) => s + i.lineTotal, 0)),
    createdAt: Date.now()
  };
  store.sales.push(sale);
  return { ok: true, sale };
}

function replyForOrder(result) {
  if (result.ok) {
    const lines = result.sale.items.map(
      (i) => `• ${i.qty} ${i.unit} ${i.name} — ${parser.formatMoney(i.lineTotal)}`
    );
    return [
      `Order placed for ${result.sale.customer}.`,
      ...lines,
      '',
      `Bill total: ${parser.formatMoney(result.sale.total)}`
    ].join('\n');
  }
  const bits = ['I could not complete that order.'];
  if (result.short && result.short.length) {
    bits.push('Not enough stock:');
    for (const s of result.short) {
      bits.push(`• ${s.name}: asked ${s.requested} ${s.unit}, have ${s.available}`);
    }
  }
  if (result.missing && result.missing.length) {
    bits.push(`Unknown items: ${result.missing.join(', ')}`);
  }
  if (!result.lines || !result.lines.length) {
    bits.push('Try: "2 kg rice and 1 dozen eggs".');
  }
  return bits.join('\n');
}

app.post('/api/chat', (req, res) => {
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'Message required' });

  const store = readStore();
  const intent = parser.detectIntent(message);
  let reply = '';
  let extra = {};

  if (intent === 'greet') {
    reply = 'Hello! I am the grocery store assistant. Tell me an order, or ask about prices, stock, or sales.';
  } else if (intent === 'help') {
    reply = helpText();
  } else if (intent === 'catalog') {
    reply = catalogText(store);
  } else if (intent === 'price') {
    const product = parser.findProduct(message);
    if (!product) {
      reply = 'Which item? For example: "How much is rice?"';
    } else {
      const live = getProduct(store, product.sku);
      reply = `${live.name} is ${parser.formatMoney(live.price)} per ${live.unit}. ${live.stock} ${live.unit} in stock.`;
    }
  } else if (intent === 'stock') {
    const product = parser.findProduct(message);
    if (!product) {
      const low = store.inventory.filter((p) => p.stock <= LOW_STOCK_THRESHOLD);
      reply = low.length
        ? `Low stock:\n${low.map((p) => `• ${p.name}: ${p.stock} ${p.unit}`).join('\n')}`
        : 'Stock looks healthy across the catalog.';
    } else {
      const live = getProduct(store, product.sku);
      reply = live.stock > 0
        ? `Yes — ${live.stock} ${live.unit} of ${live.name} in stock.`
        : `${live.name} is out of stock.`;
    }
  } else if (intent === 'low_stock') {
    const low = store.inventory.filter((p) => p.stock <= LOW_STOCK_THRESHOLD);
    reply = low.length
      ? `Running low:\n${low.map((p) => `• ${p.name}: ${p.stock} ${p.unit}`).join('\n')}`
      : 'Nothing is below the low-stock threshold.';
  } else if (intent === 'sales') {
    const today = parser.todayIso();
    const wantsToday = /today|aaj/.test(message.toLowerCase());
    const summary = parser.summarizeSales(store.sales, wantsToday ? today : null);
    if (!summary.count) {
      reply = wantsToday ? 'No sales recorded today yet.' : 'No sales recorded yet.';
    } else {
      const top = Object.entries(summary.byProduct).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
      reply = [
        wantsToday ? "Today's sales:" : 'Sales summary:',
        `Orders: ${summary.count}`,
        `Revenue: ${parser.formatMoney(summary.revenue)}`,
        `Units sold: ${summary.units}`,
        '',
        'Top items:',
        ...top.map(([name, v]) => `• ${name}: ${v.qty} sold, ${parser.formatMoney(v.revenue)}`)
      ].join('\n');
    }
  } else if (intent === 'restock') {
    const items = parser.parseRestock(message);
    if (!items.length) {
      reply = 'Tell me what to restock, for example: "Restock 20 kg rice".';
    } else {
      const lines = [];
      for (const item of items) {
        const product = getProduct(store, item.sku);
        product.stock = parser.roundMoney(product.stock + item.qty);
        lines.push(`• ${product.name}: +${item.qty} ${product.unit} (now ${product.stock})`);
      }
      writeStore(store);
      reply = ['Stock updated:', ...lines].join('\n');
      extra.inventory = store.inventory;
    }
  } else if (intent === 'order') {
    const items = parser.parseOrder(message);
    if (!items.length) {
      reply = 'I did not catch an item. Try: "2 kg rice, 1 dozen eggs, 3 liters milk".';
    } else {
      const result = fulfillOrder(store, items, 'Walk-in');
      if (result.ok) writeStore(store);
      reply = replyForOrder(result);
      extra.sale = result.sale || null;
      extra.short = result.short || [];
    }
  } else {
    reply = 'I can take orders, check prices and stock, restock, or report sales. Say "help" for examples.';
  }

  const fresh = readStore();
  res.json({
    reply,
    intent,
    ...extra,
    inventorySummary: inventorySummary(fresh),
    todaySummary: parser.summarizeSales(fresh.sales, parser.todayIso())
  });
});

if (isProd) {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  ensureStore();
  console.log(`Grocery API on ${PORT}`);
});
