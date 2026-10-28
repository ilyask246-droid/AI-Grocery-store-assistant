import { PRODUCTS } from './catalog.js';

const UNIT_WORDS = [
  'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'liter', 'liters', 'litre', 'litres', 'ltr', 'l',
  'dozen', 'dozens', 'pack', 'packs', 'packet', 'packets',
  'loaf', 'loaves', 'bar', 'bars', 'piece', 'pieces', 'pcs',
  'bottle', 'bottles'
];

const QTY_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 1, half: 0.5
};

const ORDER_HINTS = [
  'need', 'want', 'buy', 'order', 'get', 'give', 'add', 'please',
  'i need', 'i want', 'pack', 'send', 'bill'
];

const PRICE_HINTS = ['price', 'cost', 'how much', 'rate', 'charges'];
const STOCK_HINTS = ['stock', 'available', 'availability', 'in stock', 'do you have', 'have you'];
const SALES_HINTS = ['sales', 'revenue', 'today sold', 'how much sold', 'earnings', 'takings'];
const CATALOG_HINTS = ['catalog', 'catalogue', 'menu', 'products', 'what do you sell', 'list items', 'what is available', 'show items'];
const LOW_HINTS = ['low stock', 'running low', 'out of stock', 'shortage'];
const RESTOCK_HINTS = ['restock', 'add stock', 'refill', 'received shipment'];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[₹$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function productIndex() {
  const rows = [];
  for (const p of PRODUCTS) {
    rows.push({ key: p.name.toLowerCase(), product: p, len: p.name.length });
    rows.push({ key: p.sku, product: p, len: p.sku.length });
    for (const a of p.aliases) {
      rows.push({ key: a.toLowerCase(), product: p, len: a.length });
    }
  }
  rows.sort((a, b) => b.len - a.len);
  return rows;
}

const INDEX = productIndex();

export function findProduct(text) {
  const hay = normalize(text);
  for (const row of INDEX) {
    if (hay.includes(row.key)) return row.product;
  }
  return null;
}

function findAllProducts(text) {
  const hay = normalize(text);
  const found = [];
  const used = new Set();
  for (const row of INDEX) {
    if (used.has(row.product.sku)) continue;
    if (hay.includes(row.key)) {
      found.push(row.product);
      used.add(row.product.sku);
    }
  }
  return found;
}

function parseQtyNear(clause, product) {
  const hay = clause.toLowerCase();
  const names = [product.name.toLowerCase(), product.sku, ...product.aliases.map((a) => a.toLowerCase())]
    .sort((a, b) => b.length - a.length);
  let idx = -1;
  let matched = '';
  for (const n of names) {
    idx = hay.indexOf(n);
    if (idx !== -1) {
      matched = n;
      break;
    }
  }
  if (idx === -1) return 1;
  const before = hay.slice(Math.max(0, idx - 24), idx);
  const after = hay.slice(idx + matched.length, idx + matched.length + 16);
  const numBefore = before.match(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilos?|kilograms?|liters?|litres?|ltrs?|dozens?|packs?|packets?|loaves|loaf|bars?|pcs|pieces?)?\s*$/i);
  if (numBefore) return Number(numBefore[1]);
  const wordBefore = before.match(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|dozen|half)\s*$/i);
  if (wordBefore) return QTY_WORDS[wordBefore[1].toLowerCase()] || 1;
  const numAfter = after.match(/^\s*x\s*(\d+(?:\.\d+)?)/i);
  if (numAfter) return Number(numAfter[1]);
  return 1;
}

function splitItems(text) {
  return text
    .split(/\s*(?:,|&|\band\b|\bplus\b|;)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseOrder(text) {
  const clauses = splitItems(text);
  const items = [];
  const used = new Set();
  for (const clause of clauses) {
    const product = findProduct(clause);
    if (!product || used.has(product.sku)) continue;
    used.add(product.sku);
    const qty = parseQtyNear(clause, product);
    items.push({
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      qty,
      price: product.price,
      lineTotal: roundMoney(qty * product.price)
    });
  }
  if (!items.length) {
    const products = findAllProducts(text);
    for (const product of products) {
      if (used.has(product.sku)) continue;
      used.add(product.sku);
      const qty = parseQtyNear(text, product);
      items.push({
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        qty,
        price: product.price,
        lineTotal: roundMoney(qty * product.price)
      });
    }
  }
  return items;
}

export function detectIntent(text) {
  const hay = normalize(text);
  if (LOW_HINTS.some((h) => hay.includes(h))) return 'low_stock';
  if (RESTOCK_HINTS.some((h) => hay.includes(h))) return 'restock';
  if (SALES_HINTS.some((h) => hay.includes(h))) return 'sales';
  if (CATALOG_HINTS.some((h) => hay.includes(h))) return 'catalog';
  if (PRICE_HINTS.some((h) => hay.includes(h))) return 'price';
  if (STOCK_HINTS.some((h) => hay.includes(h))) return 'stock';
  const items = parseOrder(text);
  if (items.length) {
    if (ORDER_HINTS.some((h) => hay.includes(h))) return 'order';
    if (/\d/.test(hay) || Object.keys(QTY_WORDS).some((w) => new RegExp(`\\b${w}\\b`).test(hay))) return 'order';
    return 'order';
  }
  if (/hello|hi\b|hey|good morning|good evening|assalam/.test(hay)) return 'greet';
  if (/help|what can you/.test(hay)) return 'help';
  return 'unknown';
}

export function parseRestock(text) {
  const items = parseOrder(text);
  return items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unit: i.unit }));
}

export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString('en-PK')}`;
}

export function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function summarizeSales(sales, date = null) {
  const rows = date ? sales.filter((s) => s.date === date) : sales;
  const revenue = rows.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const units = rows.reduce(
    (sum, s) => sum + s.items.reduce((a, i) => a + Number(i.qty || 0), 0),
    0
  );
  const byProduct = {};
  for (const s of rows) {
    for (const i of s.items) {
      if (!byProduct[i.name]) byProduct[i.name] = { qty: 0, revenue: 0 };
      byProduct[i.name].qty += i.qty;
      byProduct[i.name].revenue += i.lineTotal;
    }
  }
  return { count: rows.length, revenue, units, byProduct, rows };
}

export { UNIT_WORDS };
