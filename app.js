require('dotenv').config();

const express  = require('express');
const path     = require('path');
const session  = require('express-session');
const multer   = require('multer');
const fs       = require('fs');
const cron     = require('node-cron');
const crypto   = require('crypto');
const admin    = require('firebase-admin');
const content  = require('./data/content');
const firebase = require('./config/firebase');
const { scrapeProducts } = require('./scripts/scraper');
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');

// ── Paddle Setup ─────────────────────────────────────────────────
const PADDLE_API_KEY       = process.env.PADDLE_API_KEY       || '';
const PADDLE_CLIENT_TOKEN  = process.env.PADDLE_CLIENT_TOKEN  || '';
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';
const PADDLE_ENV = (process.env.PADDLE_ENV || 'sandbox') === 'production'
  ? Environment.production
  : Environment.sandbox;

let paddle = null;
if (PADDLE_API_KEY) {
  paddle = new Paddle(PADDLE_API_KEY, { environment: PADDLE_ENV });
  console.log('Paddle initialised (' + (process.env.PADDLE_ENV || 'sandbox') + ')');
} else {
  console.warn('PADDLE_API_KEY not set — card payments disabled');
}

// Initialise Firebase on startup (non-blocking)
firebase.init();

const app  = express();
const PORT = process.env.PORT || 3007;

// ── View engine ──────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static & Body Parsing ────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Session ──────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET env variable must be set in production');
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'paknits-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
  },
}));

// ── Make USD helper available to all views ───────────────────────
app.use((req, res, next) => { res.locals.usd = usd; res.locals.priceUsd = priceUsd; next(); });

// ── Multer (memory storage — we upload to Firebase Storage) ──────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }   // 50 MB
});

// ── Currency conversion (PKR → USD) ──────────────────────────────
const RATE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
let _pkrToUsd = { rate: 0.0036, ts: 0 };   // fallback rate

async function fetchPkrToUsd() {
  if (Date.now() - _pkrToUsd.ts < RATE_CACHE_TTL) return _pkrToUsd.rate;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/PKR');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result === 'success' && data.rates && data.rates.USD) {
      _pkrToUsd = { rate: data.rates.USD, ts: Date.now() };
      console.log(`Exchange rate updated: 1 PKR = ${_pkrToUsd.rate} USD`);
    }
  } catch (err) {
    console.error('Exchange rate fetch failed, using cached rate:', err.message);
  }
  return _pkrToUsd.rate;
}

// Fetch rate on startup
fetchPkrToUsd();

function usd(pkrAmount) {
  const dollars = pkrAmount * _pkrToUsd.rate;
  return '$' + dollars.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Convert PKR price to USD with default markup applied (sync — uses cached markup)
let _cachedMarkup = 200; // fallback default
async function refreshMarkup() {
  try {
    const pricing = await getPricing();
    _cachedMarkup = pricing.defaultMarkup || 0;
  } catch (_) {}
}

function priceUsd(pkrAmount) {
  const withMarkup = pkrAmount + Math.round(pkrAmount * (_cachedMarkup / 100));
  return usd(withMarkup);
}

// ════════════════════════════════════════════════════════════════
// DATA HELPERS — Products & Catalogues: Firestore with JSON fallback
// ════════════════════════════════════════════════════════════════
const PRODUCTS_PATH   = path.join(__dirname, 'data/products.json');
const CATALOGUES_PATH = path.join(__dirname, 'data/catalogues.json');
const BRANDS_PATH     = path.join(__dirname, 'data/brands.json');
const PRICING_PATH    = path.join(__dirname, 'data/pricing.json');
const ORDERS_PATH     = path.join(__dirname, 'data/orders.json');

// ── In-memory cache (TTL-based) ──────────────────────────────────
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const cache = {
  products:   { data: null, ts: 0 },
  brands:     { data: null, ts: 0 },
  catalogues: { data: null, ts: 0 },
  // Pre-computed filter metadata (rebuilt when products cache refreshes)
  filterMeta: { categories: [], productTypes: [], fabrics: [], brandMap: new Map(), ts: 0 },
};

function isFresh(entry) { return entry.data !== null && (Date.now() - entry.ts) < CACHE_TTL; }

function invalidateCache(key) {
  cache[key].data = null;
  cache[key].ts = 0;
  if (key === 'products' || key === 'brands') {
    cache.filterMeta.ts = 0;
  }
}

function buildFilterMeta(products) {
  const categories = new Set();
  const productTypes = new Set();
  const fabrics = new Set();
  const brandMap = new Map(); // brand name (lower) -> products[]

  for (const p of products) {
    if (p.category) categories.add(p.category);
    if (p.productType) productTypes.add(p.productType);
    if (p.fabric) fabrics.add(p.fabric);
    if (p.brand) {
      const key = p.brand.toLowerCase();
      if (!brandMap.has(key)) brandMap.set(key, []);
      brandMap.get(key).push(p);
    }
  }

  cache.filterMeta = {
    categories: [...categories].sort(),
    productTypes: [...productTypes].sort(),
    fabrics: [...fabrics].sort(),
    brandMap,
    ts: Date.now(),
  };
  return cache.filterMeta;
}

// ── Products ─────────────────────────────────────────────────────
async function getProducts() {
  if (isFresh(cache.products)) return cache.products.data;

  let products;
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('products').orderBy('id').get();
      products = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    } catch (e) {
      if (e.code === 8) {
        console.warn('[getProducts] Firestore quota exhausted — falling back to JSON');
      } else {
        console.warn('[getProducts] Firestore fetch failed — falling back to JSON:', e.message);
      }
    }
  }

  if (!products) {
    products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
    console.log('[getProducts] Loaded', products.length, 'products from JSON fallback');
  }

  cache.products = { data: products, ts: Date.now() };
  buildFilterMeta(products);
  return products;
}

async function getProductById(id) {
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('products').where('id', '==', Number(id)).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        return { firestoreId: doc.id, ...doc.data() };
      }
    } catch (e) {
      console.warn('[getProductById] Firestore failed — falling back to JSON:', e.message);
    }
  }
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
  return products.find(p => p.id === Number(id)) || null;
}

async function saveProduct(data) {
  console.log('[saveProduct] Starting save for product ID:', data.id);
  const db = firebase.getDb();
  if (db) {
    try {
      if (data.firestoreId) {
        const { firestoreId, ...rest } = data;
        await db.collection('products').doc(firestoreId).set(rest, { merge: true });
        console.log('[saveProduct] Successfully updated Firestore doc:', firestoreId);
      } else {
        const ref = await db.collection('products').add(data);
        console.log('[saveProduct] Successfully added to Firestore with doc ID:', ref.id);
      }
    } catch (err) {
      console.error('[saveProduct] Firestore save failed:', err.message);
    }
  } else {
    console.log('[saveProduct] Firestore not available, skipping cloud save');
  }

  try {
    const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
    const idx = products.findIndex(p => p.id === data.id);
    if (idx >= 0) products[idx] = data; else products.push(data);
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
    console.log('[saveProduct] Successfully saved to JSON fallback');
  } catch (err) {
    console.error('[saveProduct] JSON fallback save failed:', err.message);
  }

  invalidateCache('products');
  console.log('[saveProduct] Completed.');
}

async function deleteProduct(id) {
  console.log('[deleteProduct] Starting delete for product ID:', id);
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('products').where('id', '==', Number(id)).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.delete();
        console.log('[deleteProduct] Successfully deleted from Firestore');
      }
    } catch (err) {
      console.error('[deleteProduct] Firestore delete failed:', err.message);
    }
  }

  try {
    const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
    const filtered = products.filter(p => p.id !== Number(id));
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(filtered, null, 2));
    console.log('[deleteProduct] Successfully deleted from JSON fallback');
  } catch (err) {
    console.error('[deleteProduct] JSON fallback delete failed:', err.message);
  }

  invalidateCache('products');
  console.log('[deleteProduct] Completed.');
}

async function nextProductId() {
  const products = await getProducts();
  return products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
}

// ── Catalogues ───────────────────────────────────────────────────
async function getCatalogues() {
  if (isFresh(cache.catalogues)) return cache.catalogues.data;

  let catalogues;
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('catalogues').orderBy('uploadedAt', 'desc').get();
      catalogues = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[getCatalogues] Firestore failed — falling back to JSON:', e.message);
    }
  }

  if (!catalogues) {
    catalogues = fs.existsSync(CATALOGUES_PATH) ? JSON.parse(fs.readFileSync(CATALOGUES_PATH, 'utf8')) : [];
  }

  cache.catalogues = { data: catalogues, ts: Date.now() };
  return catalogues;
}

async function saveCatalogue(data) {
  console.log('[saveCatalogue] Starting save for catalogue ID:', data.id);
  const db = firebase.getDb();
  if (db) {
    try {
      const ref = await db.collection('catalogues').add(data);
      console.log('[saveCatalogue] Successfully added to Firestore with doc ID:', ref.id);
    } catch (err) {
      console.error('[saveCatalogue] Firestore save failed:', err.message);
    }
  }

  try {
    const cats = JSON.parse(fs.readFileSync(CATALOGUES_PATH, 'utf8'));
    cats.push(data);
    fs.writeFileSync(CATALOGUES_PATH, JSON.stringify(cats, null, 2));
    console.log('[saveCatalogue] Successfully saved to JSON fallback');
  } catch (err) {
    console.error('[saveCatalogue] JSON fallback save failed:', err.message);
  }

  invalidateCache('catalogues');
  console.log('[saveCatalogue] Completed.');
}

async function deleteCatalogue(firestoreIdOrJsonId) {
  console.log('[deleteCatalogue] Starting delete for ID:', firestoreIdOrJsonId);
  const db = firebase.getDb();
  if (db) {
    try {
      await db.collection('catalogues').doc(String(firestoreIdOrJsonId)).delete();
      console.log('[deleteCatalogue] Successfully deleted from Firestore');
    } catch (err) {
      console.error('[deleteCatalogue] Firestore delete failed:', err.message);
    }
  }

  try {
    let cats = JSON.parse(fs.readFileSync(CATALOGUES_PATH, 'utf8'));
    const cat = cats.find(c => c.id === Number(firestoreIdOrJsonId));
    if (cat) {
      const fp = path.join(__dirname, 'public/uploads/catalogues', cat.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      console.log('[deleteCatalogue] Local file unlinked');
    }
    cats = cats.filter(c => c.id !== Number(firestoreIdOrJsonId));
    fs.writeFileSync(CATALOGUES_PATH, JSON.stringify(cats, null, 2));
    console.log('[deleteCatalogue] Successfully deleted from JSON fallback');
  } catch (err) {
    console.error('[deleteCatalogue] JSON fallback delete failed:', err.message);
  }

  invalidateCache('catalogues');
  console.log('[deleteCatalogue] Completed.');
}

// ── Brands ───────────────────────────────────────────────────────
async function getBrands() {
  if (isFresh(cache.brands)) return cache.brands.data;

  let brands;
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('brands').orderBy('name').get();
      brands = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[getBrands] Firestore failed — falling back to JSON:', e.message);
    }
  }

  if (!brands) {
    brands = fs.existsSync(BRANDS_PATH) ? JSON.parse(fs.readFileSync(BRANDS_PATH, 'utf-8')) : [];
  }

  cache.brands = { data: brands, ts: Date.now() };
  return brands;
}

async function getBrandById(id) {
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('brands').where('id', '==', Number(id)).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        return { firestoreId: doc.id, ...doc.data() };
      }
    } catch (e) {
      console.warn('[getBrandById] Firestore failed — falling back to JSON:', e.message);
    }
  }
  const brands = JSON.parse(fs.readFileSync(BRANDS_PATH, 'utf-8'));
  return brands.find(b => b.id === Number(id)) || null;
}

async function saveBrand(data) {
  console.log('[saveBrand] Starting save for brand ID:', data.id);
  const db = firebase.getDb();
  if (db) {
    try {
      if (data.firestoreId) {
        const { firestoreId, ...rest } = data;
        await db.collection('brands').doc(firestoreId).set(rest, { merge: true });
        console.log('[saveBrand] Successfully updated Firestore doc:', firestoreId);
      } else {
        const ref = await db.collection('brands').add(data);
        console.log('[saveBrand] Successfully added to Firestore with doc ID:', ref.id);
      }
    } catch (err) {
      console.error('[saveBrand] Firestore save failed:', err.message);
    }
  }

  try {
    const brands = JSON.parse(fs.readFileSync(BRANDS_PATH, 'utf-8'));
    const idx = brands.findIndex(b => b.id === data.id);
    if (idx >= 0) brands[idx] = data; else brands.push(data);
    fs.writeFileSync(BRANDS_PATH, JSON.stringify(brands, null, 2));
    console.log('[saveBrand] Successfully saved to JSON fallback');
  } catch (err) {
    console.error('[saveBrand] JSON fallback save failed:', err.message);
  }

  invalidateCache('brands');
  console.log('[saveBrand] Completed.');
}

async function deleteBrand(id) {
  const numId = Number(id);
  console.log('[deleteBrand] Starting delete for brand ID:', numId);

  const db = firebase.getDb();

  // ── 1. Delete linked products ──────────────────────────────────
  console.log('[deleteBrand] Deleting linked products for brandId:', numId);
  if (db) {
    try {
      const prodSnap = await db.collection('products').where('brandId', '==', numId).get();
      if (!prodSnap.empty) {
        // Batch-delete in chunks of 450
        const BATCH_SIZE = 450;
        const docs = prodSnap.docs;
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
          const batch = db.batch();
          docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        console.log(`[deleteBrand] Deleted ${docs.length} linked products from Firestore`);
      } else {
        console.log('[deleteBrand] No linked products found in Firestore');
      }
    } catch (err) {
      console.error('[deleteBrand] Firestore product delete failed:', err.message);
    }
  }

  try {
    const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
    const before = products.length;
    const filtered = products.filter(p => p.brandId !== numId);
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(filtered, null, 2));
    console.log(`[deleteBrand] Removed ${before - filtered.length} linked products from JSON fallback`);
  } catch (err) {
    console.error('[deleteBrand] JSON product delete failed:', err.message);
  }

  invalidateCache('products');

  // ── 2. Delete the brand itself ─────────────────────────────────
  if (db) {
    try {
      const snap = await db.collection('brands').where('id', '==', numId).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.delete();
        console.log('[deleteBrand] Successfully deleted brand from Firestore');
      }
    } catch (err) {
      console.error('[deleteBrand] Firestore brand delete failed:', err.message);
    }
  }

  try {
    const brands = JSON.parse(fs.readFileSync(BRANDS_PATH, 'utf-8'));
    const filtered = brands.filter(b => b.id !== numId);
    fs.writeFileSync(BRANDS_PATH, JSON.stringify(filtered, null, 2));
    console.log('[deleteBrand] Successfully deleted brand from JSON fallback');
  } catch (err) {
    console.error('[deleteBrand] JSON fallback brand delete failed:', err.message);
  }

  invalidateCache('brands');
  console.log('[deleteBrand] Completed (brand + all linked products removed).');
}


async function nextBrandId() {
  const brands = await getBrands();
  return brands.length ? Math.max(...brands.map(b => b.id)) + 1 : 1;
}

// ── Pricing Settings ─────────────────────────────────────────────
async function getPricing() {
  const db = firebase.getDb();
  if (db) {
    try {
      const doc = await db.collection('settings').doc('pricing').get();
      if (doc.exists) return doc.data();
    } catch (e) {
      console.warn('Pricing fetch from Firestore failed:', e.message);
    }
  }
  return JSON.parse(fs.readFileSync(PRICING_PATH, 'utf-8'));
}

async function savePricing(data) {
  console.log('[savePricing] Starting save');
  const db = firebase.getDb();
  if (db) {
    try {
      await db.collection('settings').doc('pricing').set(data);
      console.log('[savePricing] Successfully saved to Firestore');
    } catch (err) {
      console.error('[savePricing] Firestore save failed:', err.message);
    }
  }

  try {
    fs.writeFileSync(PRICING_PATH, JSON.stringify(data, null, 2));
    console.log('[savePricing] Successfully saved to JSON fallback');
  } catch (err) {
    console.error('[savePricing] JSON fallback save failed:', err.message);
  }

  _cachedMarkup = data.defaultMarkup || 0; // keep markup cache in sync
  console.log('[savePricing] Completed.');
}

// ── Orders ───────────────────────────────────────────────────────
const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

async function getOrders() {
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('orders').orderBy('date', 'desc').get();
      return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[getOrders] Firestore failed — falling back to JSON:', e.message);
    }
  }
  if (fs.existsSync(ORDERS_PATH)) return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8'));
  return [];
}

async function getOrderById(firestoreId) {
  const db = firebase.getDb();
  if (db) {
    try {
      const doc = await db.collection('orders').doc(firestoreId).get();
      if (doc.exists) return { firestoreId: doc.id, ...doc.data() };
    } catch (e) {
      console.warn('[getOrderById] Firestore failed — falling back to JSON:', e.message);
    }
  }
  if (fs.existsSync(ORDERS_PATH)) {
    const orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8'));
    return orders.find(o => o.firestoreId === firestoreId || o.orderId === firestoreId) || null;
  }
  return null;
}

async function getOrderByOrderId(orderId) {
  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('orders').where('orderId', '==', orderId).limit(1).get();
      if (!snap.empty) return { firestoreId: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (e) {
      console.warn('[getOrderByOrderId] Firestore failed — falling back to JSON:', e.message);
    }
  }
  if (fs.existsSync(ORDERS_PATH)) {
    const orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8'));
    return orders.find(o => o.orderId === orderId) || null;
  }
  return null;
}

async function updateOrderStatus(firestoreId, status, note) {
  const db = firebase.getDb();
  const event = { status, ts: new Date().toISOString() };
  if (note) event.note = note;

  // Always update JSON fallback first
  try {
    if (fs.existsSync(ORDERS_PATH)) {
      const orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8'));
      const idx = orders.findIndex(o => o.firestoreId === firestoreId || o.orderId === firestoreId);
      if (idx !== -1) {
        orders[idx].status = status;
        orders[idx].statusUpdatedAt = new Date().toISOString();
        if (!orders[idx].statusHistory) orders[idx].statusHistory = [];
        orders[idx].statusHistory.push(event);
        fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
        console.log('[updateOrderStatus] JSON fallback updated for order:', firestoreId);
      }
    }
  } catch (err) {
    console.error('[updateOrderStatus] JSON fallback update failed:', err.message);
  }

  if (db) {
    try {
      await db.collection('orders').doc(firestoreId).update({
        status,
        statusUpdatedAt: new Date().toISOString(),
        statusHistory: admin.firestore.FieldValue.arrayUnion(event),
      });
      console.log('[updateOrderStatus] Firestore updated for order:', firestoreId);
    } catch (err) {
      console.warn('[updateOrderStatus] Firestore update failed:', err.message);
    }
  }
}

// ── Firebase Storage upload helper ───────────────────────────────
async function uploadToStorage(file, folder) {
  const bucket = firebase.getBucket();
  if (!bucket) {
    // Local fallback
    const dest = path.join(__dirname, `public/uploads/${folder}`);
    fs.mkdirSync(dest, { recursive: true });
    const filename = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
    fs.writeFileSync(path.join(dest, filename), file.buffer);
    return { url: `/uploads/${folder}/${filename}`, filename };
  }

  const filename  = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
  const storagePath = `${folder}/${filename}`;
  const fileRef   = bucket.file(storagePath);

  await fileRef.save(file.buffer, {
    metadata: { contentType: file.mimetype },
    public: true,
  });

  // Make publicly readable and get URL
  await fileRef.makePublic();
  const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  return { url, filename, storagePath };
}

async function deleteFromStorage(storagePath) {
  const bucket = firebase.getBucket();
  if (!bucket || !storagePath) return;
  try {
    await bucket.file(storagePath).delete();
  } catch (_) { /* already deleted */ }
}

// ── Cart helpers ─────────────────────────────────────────────────
async function getCartItems(req) {
  const cart = req.session.cart || [];
  if (!cart.length) return [];
  const products = await getProducts();
  return cart.map(item => {
    const p = products.find(p => p.id === item.id);
    return p ? { ...p, qty: item.qty } : null;
  }).filter(Boolean);
}
function cartSubtotal(items) {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}
function applyMarkup(subtotal, markup) {
  return subtotal + Math.round(subtotal * (markup / 100));
}
async function getCartTotals(items, countryCode) {
  const pricing = await getPricing();
  const sub = cartSubtotal(items);
  // Find country-specific pricing or use defaults
  const country = countryCode
    ? pricing.countries.find(c => c.code === countryCode && c.enabled)
    : null;
  const markup   = country && country.markup   != null ? country.markup   : (pricing.defaultMarkup || 0);
  
  // Delivery and threshold are configured in USD by admins.
  // We must convert them to PKR using the live exchange rate so all cart math is uniform.
  const deliveryUsd = country && country.delivery != null ? country.delivery : (pricing.defaultDelivery || 0);
  const thresholdUsd = pricing.freeShippingThreshold || 0;
  
  const deliveryPkr = (deliveryUsd > 0 && _pkrToUsd.rate > 0) ? Math.round(deliveryUsd / _pkrToUsd.rate) : 0;
  const thresholdPkr = (thresholdUsd > 0 && _pkrToUsd.rate > 0) ? Math.round(thresholdUsd / _pkrToUsd.rate) : 0;

  const markedUp = applyMarkup(sub, markup);
  const shippingCostPkr = (thresholdPkr > 0 && markedUp >= thresholdPkr) ? 0 : deliveryPkr;
  
  return { 
    subtotal: sub, 
    markup, 
    markedUpTotal: markedUp, 
    delivery: shippingCostPkr, 
    total: markedUp + shippingCostPkr, 
    countryName: country ? country.name : null 
  };
}
// Backwards-compatible alias
function cartTotal(items) {
  return cartSubtotal(items);
}

// ── Admin auth ───────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
function requireAdmin(req, res, next) {
  if (req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

// ═══════════════════════════════════════════════════════════════
// BRAND PRODUCT FETCHER — scrape products from brand URLs
// ═══════════════════════════════════════════════════════════════
async function fetchBrandProducts(brand) {
  console.log(`\n── fetchBrandProducts called ──`);
  console.log(`  Brand: ${brand.name} (id: ${brand.id})`);
  console.log(`  scrapeUrl: "${brand.scrapeUrl || ''}"`);
  console.log(`  All brand keys: ${Object.keys(brand).join(', ')}`);
  if (!brand.scrapeUrl) {
    console.log(`  ⚠ No scrapeUrl set — skipping`);
    return { added: 0, removed: 0, errors: [] };
  }
  console.log(`⏳ Fetching products from ${brand.name}: ${brand.scrapeUrl}`);
  const errors = [];
  let added = 0;
  let removed = 0;
  try {
    const scraped = await scrapeProducts(brand.scrapeUrl);
    console.log(`  Scraper returned ${scraped.length} products`);
    if (scraped.length > 0) {
      console.log(`  First scraped: "${scraped[0].title}" @ ${scraped[0].price}`);
    }
    const existing = await getProducts();
    console.log(`  Existing products in DB: ${existing.length}`);
    const existingTitles = new Set(existing.map(p => p.title.toLowerCase()));

    // Filter new products first
    const newProducts = scraped.filter(raw => raw.title && !existingTitles.has(raw.title.toLowerCase()));
    console.log(`  New products to add: ${newProducts.length} (${scraped.length - newProducts.length} duplicates skipped)`);

    // Get starting ID once, increment locally
    let nextId = await nextProductId();

    // Batch write to Firestore (max 500 per batch)
    const db = firebase.getDb();
    const BATCH_SIZE = 450;
    for (let i = 0; i < newProducts.length; i += BATCH_SIZE) {
      const chunk = newProducts.slice(i, i + BATCH_SIZE);
      if (db) {
        const batch = db.batch();
        for (const raw of chunk) {
          const docRef = db.collection('products').doc();
          batch.set(docRef, {
            id: nextId++,
            title: raw.title,
            category: raw.category || 'Uncategorised',
            meta: brand.name,
            price: raw.price || 0,
            badge: 'New Arrival',
            badgeStyle: 'green',
            color: brand.color || 'green',
            image: raw.image || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop',
            images: raw.images && raw.images.length ? raw.images : [raw.image || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop'],
            desc: raw.desc || '',
            details: '',
            brand: brand.name,
            brandId: brand.id,
            productType: raw.productType || '',
            fabric: raw.fabric || '',
            tags: raw.tags || [],
            inStock: raw.inStock !== false,
            featured: false,
            sourceUrl: raw.url || '',
            fetchedAt: new Date().toISOString(),
          });
        }
        await batch.commit();
        console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: committed ${chunk.length} products`);
      } else {
        // JSON fallback — write all at once
        const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
        for (const raw of chunk) {
          products.push({
            id: nextId++, title: raw.title,
            category: raw.category || 'Uncategorised', meta: brand.name,
            price: raw.price || 0, badge: 'New Arrival', badgeStyle: 'green',
            color: brand.color || 'green',
            image: raw.image || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop',
            images: raw.images && raw.images.length ? raw.images : [raw.image || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop'],
            desc: raw.desc || '', details: '', brand: brand.name,
            brandId: brand.id, productType: raw.productType || '',
            fabric: raw.fabric || '', tags: raw.tags || [],
            inStock: raw.inStock !== false, featured: false,
            sourceUrl: raw.url || '', fetchedAt: new Date().toISOString(),
          });
        }
        fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
      }
      added += chunk.length;
    }
    console.log(`✅ ${brand.name}: ${added} new products added`);
    if (added > 0) invalidateCache('products');

    // ── Remove products no longer on the brand's site ─────────────
    // Only touches auto-fetched products (have sourceUrl set).
    // Manually created products are never auto-deleted.
    if (scraped.length > 0) {
      const scrapedUrls = new Set(scraped.map(p => p.url).filter(Boolean));
      const brandExisting = existing.filter(p => p.brandId === brand.id && p.sourceUrl);
      const toDelete = brandExisting.filter(p => !scrapedUrls.has(p.sourceUrl));

      if (toDelete.length > 0) {
        const db = firebase.getDb();
        for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
          const chunk = toDelete.slice(i, i + BATCH_SIZE);
          if (db) {
            const batch = db.batch();
            for (const p of chunk) {
              const snap = await db.collection('products').where('id', '==', Number(p.id)).limit(1).get();
              if (!snap.empty) batch.delete(snap.docs[0].ref);
            }
            await batch.commit();
          } else {
            for (const p of chunk) {
              const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
              fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products.filter(x => x.id !== p.id), null, 2));
            }
          }
        }
        removed = toDelete.length;
        console.log(`  🗑 ${brand.name}: ${removed} product(s) removed (no longer on site)`);
        invalidateCache('products');
      }
    }
  } catch (err) {
    console.error(`❌ ${brand.name}: fetch failed —`, err.message);
    errors.push(err.message);
  }
  return { added, removed, errors };
}

async function fetchAllBrandProducts() {
  console.log('\n══ Daily brand product fetch started ══');
  const brands = await getBrands();
  const results = [];
  for (const brand of brands) {
    if (!brand.scrapeUrl) continue;
    const result = await fetchBrandProducts(brand);
    results.push({ brand: brand.name, added: result.added, removed: result.removed, errors: result.errors });
  }
  console.log('══ Daily brand product fetch complete ══\n');
  return results;
}

// Run daily at 2:00 AM
cron.schedule('0 2 * * *', () => {
  fetchAllBrandProducts().catch(err => console.error('Cron fetch error:', err));
});

// ════════════════════════════════════════════════════════════════
// HOME
// ════════════════════════════════════════════════════════════════
app.get('/', async (req, res) => {
  const cart = req.session.cart || [];
  const [allProducts, brands] = await Promise.all([getProducts(), getBrands()]);
  // Only show featured products on homepage, fallback to latest 12
  const featured = allProducts.filter(p => p.featured);
  const products = featured.length ? featured.slice(0, 12) : allProducts.slice(0, 12);
  res.render('index', { content, products, brands, cartCount: cart.reduce((s, i) => s + i.qty, 0) });
});


app.get('/contact', (req, res) => {
  const cart = req.session.cart || [];
  const success = req.query.success === '1';
  res.render('contact', { content, cartCount: cart.reduce((s, i) => s + i.qty, 0), success });
});

app.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;
  console.log('[contact] New submission — name:', name, '| email:', email);

  if (!name || !email || !message) {
    console.warn('[contact] Missing required fields');
    const cart = req.session.cart || [];
    return res.render('contact', {
      content,
      cartCount: cart.reduce((s, i) => s + i.qty, 0),
      success: false,
      error: 'Please fill in all required fields.',
    });
  }

  const submission = {
    name: name.trim(),
    email: email.trim(),
    message: message.trim(),
    submittedAt: new Date().toISOString(),
    read: false,
  };

  // ── Firestore ────────────────────────────────────────────
  const db = firebase.getDb();
  if (db) {
    try {
      const ref = await db.collection('contact_submissions').add(submission);
      console.log('[contact] Saved to Firestore with ID:', ref.id);
    } catch (err) {
      console.error('[contact] Firestore save failed:', err.message);
    }
  } else {
    console.warn('[contact] No Firestore connection — skipping cloud save');
  }

  // ── JSON fallback ────────────────────────────────────────
  try {
    const CONTACT_PATH = path.join(__dirname, 'data/contact_submissions.json');
    let existing = [];
    if (fs.existsSync(CONTACT_PATH)) {
      existing = JSON.parse(fs.readFileSync(CONTACT_PATH, 'utf-8'));
    }
    existing.push(submission);
    fs.writeFileSync(CONTACT_PATH, JSON.stringify(existing, null, 2));
    console.log('[contact] Saved to JSON fallback. Total submissions:', existing.length);
  } catch (err) {
    console.error('[contact] JSON fallback save failed:', err.message);
  }

  res.redirect('/contact?success=1');
});

// ════════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════════
app.get('/products', async (req, res) => {
  try {
    const [all, allBrands] = await Promise.all([getProducts(), getBrands()]);
    let products = [...all];
    const { filter, category, brand, productType, fabric, sort, q, page: pageParam } = req.query;

    if (filter === 'new')        products = products.filter(p => p.badge === 'New Arrival' || p.badge === 'New');
    else if (filter === 'bestseller') products = products.filter(p => p.badge === 'Bestseller');
    else if (filter === 'archive')    products = products.filter(p => p.badge === 'Archive');

    if (brand) products = products.filter(p => (p.brand || '').toLowerCase() === brand.toLowerCase());
    if (category) products = products.filter(p => p.category === category);
    if (productType) products = products.filter(p => p.productType === productType);
    if (fabric) products = products.filter(p => p.fabric === fabric);
    if (q) {
      const s = q.toLowerCase();
      products = products.filter(p =>
        p.title.toLowerCase().includes(s) ||
        (p.desc || '').toLowerCase().includes(s) ||
        p.category.toLowerCase().includes(s) ||
        (p.brand || '').toLowerCase().includes(s)
      );
    }

    // Sort
    if (sort === 'price-asc')       products.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') products.sort((a, b) => b.price - a.price);
    else if (sort === 'newest')     products.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

    // Pagination
    const perPage = 24;
    const totalProducts = products.length;
    const totalPages = Math.max(1, Math.ceil(totalProducts / perPage));
    const page = Math.max(1, Math.min(parseInt(pageParam) || 1, totalPages));
    products = products.slice((page - 1) * perPage, page * perPage);

    // Use cached filter metadata — scope to brand if selected
    const meta = cache.filterMeta;
    let categories, productTypes, fabrics;
    if (brand) {
      const scopedProducts = meta.brandMap.get(brand.toLowerCase()) || [];
      categories = [...new Set(scopedProducts.map(p => p.category).filter(Boolean))].sort();
      productTypes = [...new Set(scopedProducts.map(p => p.productType).filter(Boolean))].sort();
      fabrics = [...new Set(scopedProducts.map(p => p.fabric).filter(Boolean))].sort();
    } else {
      categories = meta.categories;
      productTypes = meta.productTypes;
      fabrics = meta.fabrics;
    }

    const usedBrandNames = new Set(all.map(p => p.brand).filter(Boolean));
    const brandNames = allBrands.filter(b => usedBrandNames.has(b.name));
    const cart = req.session.cart || [];
    res.render('products', {
      content, products, categories, brandNames, productTypes, fabrics,
      filter: filter || '', category: category || '', brand: brand || '',
      productType: productType || '', fabric: fabric || '', sort: sort || '', q: q || '',
      page, totalPages, totalProducts,
      cartCount: cart.reduce((s, i) => s + i.qty, 0)
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading products.');
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    // Fetch product + all products in parallel (all is cached, so nearly free)
    const [product, all] = await Promise.all([getProductById(req.params.id), getProducts()]);
    if (!product) return res.redirect('/products');
    const related = all.filter(p => p.id !== product.id && p.category === product.category).slice(0, 3);
    const cart = req.session.cart || [];
    // Resolve brand for breadcrumb
    let brand = null;
    if (product.brandId) brand = await getBrandById(product.brandId);
    res.render('product-detail', { 
      content, 
      product, 
      related, 
      brand, 
      cartCount: cart.reduce((s, i) => s + i.qty, 0),
      pricing: await getPricing(),
      _pkrRate: typeof _pkrRate !== 'undefined' ? _pkrRate : 0.0036
    });
  } catch (err) {
    console.error(err);
    res.redirect('/products');
  }
});

// ════════════════════════════════════════════════════════════════
// BRAND PAGE — Public brand page with filters
// ════════════════════════════════════════════════════════════════
app.get('/brands/:id', async (req, res) => {
  try {
    const [brand, all] = await Promise.all([getBrandById(req.params.id), getProducts()]);
    if (!brand) return res.redirect('/products');
    let products = all.filter(p => p.brandId === brand.id || (p.brand || '').toLowerCase() === brand.name.toLowerCase());

    const { category, productType, fabric, tag, sort, q, page: pageParam } = req.query;

    // Gather filter options from this brand's products
    const categories   = [...new Set(products.map(p => p.category).filter(Boolean))];
    const productTypes = [...new Set(products.map(p => p.productType).filter(Boolean))];
    const fabrics      = [...new Set(products.map(p => p.fabric).filter(Boolean))];
    const allTags      = [...new Set(products.flatMap(p => Array.isArray(p.tags) ? p.tags : []).filter(Boolean))].sort();

    // Apply filters
    if (category)    products = products.filter(p => p.category === category);
    if (productType) products = products.filter(p => p.productType === productType);
    if (fabric)      products = products.filter(p => p.fabric === fabric);
    if (tag)         products = products.filter(p => Array.isArray(p.tags) && p.tags.includes(tag));
    if (q) {
      const s = q.toLowerCase();
      products = products.filter(p =>
        p.title.toLowerCase().includes(s) ||
        (p.desc || '').toLowerCase().includes(s)
      );
    }

    // Sort
    if (sort === 'price-asc')       products.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') products.sort((a, b) => b.price - a.price);
    else if (sort === 'newest')     products.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

    // Pagination
    const perPage = 24;
    const totalProducts = products.length;
    const totalPages = Math.max(1, Math.ceil(totalProducts / perPage));
    const page = Math.max(1, Math.min(parseInt(pageParam) || 1, totalPages));
    products = products.slice((page - 1) * perPage, page * perPage);

    const cart = req.session.cart || [];
    res.render('brand-products', {
      content, brand, products,
      categories, productTypes, fabrics, allTags,
      category: category || '', productType: productType || '',
      fabric: fabric || '', tag: tag || '', sort: sort || '', q: q || '',
      page, totalPages, totalProducts,
      cartCount: cart.reduce((s, i) => s + i.qty, 0)
    });
  } catch (err) {
    console.error(err);
    res.redirect('/products');
  }
});

// ════════════════════════════════════════════════════════════════
// CART
// ════════════════════════════════════════════════════════════════
app.get('/cart', async (req, res) => {
  const items = await getCartItems(req);
  const country = req.session.country || null;
  const totals = await getCartTotals(items, country);
  const pricing = await getPricing();
  res.render('cart', { content, items, totals, pricing, selectedCountry: country, cartCount: items.reduce((s, i) => s + i.qty, 0), _pkrRate: _pkrToUsd.rate });
});

app.post('/cart/country', (req, res) => {
  req.session.country = req.body.country || null;
  res.redirect(req.body.returnTo || '/cart');
});

app.post('/cart/add', async (req, res) => {
  const id  = parseInt(req.body.id);
  const qty = Math.max(1, Math.min(parseInt(req.body.qty) || 1, 99)); // enforce 1–99 server-side
  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => i.id === id);
  if (existing) existing.qty = Math.min(existing.qty + qty, 99); // cap total at 99
  else req.session.cart.push({ id, qty });

  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return res.json({ success: true, cartCount: req.session.cart.reduce((s, i) => s + i.qty, 0) });
  }
  res.redirect('/cart');
});

app.post('/cart/update', (req, res) => {
  const id  = parseInt(req.body.id);
  const qty = parseInt(req.body.qty);
  if (!req.session.cart) req.session.cart = [];
  if (qty <= 0) req.session.cart = req.session.cart.filter(i => i.id !== id);
  else { const item = req.session.cart.find(i => i.id === id); if (item) item.qty = qty; }
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const id = parseInt(req.body.id);
  req.session.cart = (req.session.cart || []).filter(i => i.id !== id);
  res.redirect('/cart');
});

// ════════════════════════════════════════════════════════════════
// CHECKOUT
// ════════════════════════════════════════════════════════════════
app.get('/checkout', async (req, res) => {
  const items = await getCartItems(req);
  if (!items.length) return res.redirect('/cart');
  const cart = req.session.cart || [];
  const country = req.session.country || null;
  const totals = await getCartTotals(items, country);
  const pricing = await getPricing();
  res.render('checkout', { content, items, totals, pricing, selectedCountry: country, cartCount: cart.reduce((s, i) => s + i.qty, 0), error: null, paddleClientToken: PADDLE_CLIENT_TOKEN, paddleEnv: process.env.PADDLE_ENV || 'sandbox' });
});

app.post('/checkout', async (req, res) => {
  const items = await getCartItems(req);
  if (!items.length) return res.redirect('/cart');
  const { name, email, phone, address, city, postalCode, paymentMethod } = req.body;
  if (!name || !email || !address || !city) {
    const cart = req.session.cart || [];
    const country = req.session.country || null;
    const totals = await getCartTotals(items, country);
    const pricing = await getPricing();
    return res.render('checkout', {
      content, items, totals, pricing, selectedCountry: country,
      cartCount: cart.reduce((s, i) => s + i.qty, 0),
      error: 'Please fill in all required fields.',
      paddleClientToken: PADDLE_CLIENT_TOKEN, paddleEnv: process.env.PADDLE_ENV || 'sandbox'
    });
  }
  const country = req.session.country || null;
  const totals = await getCartTotals(items, country);
  const orderId = 'ORD-' + Date.now().toString(36).toUpperCase();
  const order = {
    orderId, name, email, phone, address, city, postalCode,
    paymentMethod, items, subtotal: totals.subtotal,
    markup: totals.markup, delivery: totals.delivery, total: totals.total,
    country, date: new Date().toISOString(),
    status: 'pending',
    statusHistory: [{ status: 'pending', ts: new Date().toISOString() }],
  };

  // Persist order — dual-write: Firestore + JSON fallback
  const db = firebase.getDb();
  if (db) {
    try {
      const ref = await db.collection('orders').add(order);
      order.firestoreId = ref.id;
      console.log('[checkout] Order saved to Firestore:', ref.id);
    } catch (err) {
      console.error('[checkout] Firestore save failed:', err.message);
      order.firestoreId = order.orderId;
    }
  } else {
    order.firestoreId = order.orderId; // Mock ID for JSON mode
  }

  // Always write to JSON fallback
  try {
    let orders = [];
    if (fs.existsSync(ORDERS_PATH)) {
      orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8'));
    }
    orders.push(order);
    fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
    console.log('[checkout] Order saved to JSON fallback. orderId:', order.orderId);
  } catch (err) {
    console.error('[checkout] JSON fallback save failed:', err.message);
  }

  req.session.lastOrder = order;
  req.session.cart = [];
  res.redirect('/checkout/success');
});

app.get('/checkout/success', (req, res) => {
  const order = req.session.lastOrder;
  if (!order) return res.redirect('/');
  res.render('order-success', { content, order, cartCount: 0 });
});

// ════════════════════════════════════════════════════════════════
// PADDLE PAYMENTS
// ════════════════════════════════════════════════════════════════

// Create a Paddle transaction for overlay checkout
app.post('/api/paddle/create-transaction', async (req, res) => {
  if (!paddle) return res.status(503).json({ error: 'Paddle not configured' });
  try {
    const items = await getCartItems(req);
    if (!items.length) return res.status(400).json({ error: 'Cart is empty' });

    const { name, email, phone, address, city, postalCode } = req.body;
    if (!name || !email || !address || !city) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const country = req.session.country || null;
    const totals = await getCartTotals(items, country);
    const orderId = 'ORD-' + Date.now().toString(36).toUpperCase();

    // Build Paddle line items — single custom line for order total
    // Amount is in smallest currency unit (cents for USD)
    const totalCents = Math.round(totals.total * _pkrToUsd.rate * 100);

    const txn = await paddle.transactions.create({
      items: [{
        quantity: 1,
        price: {
          description: `Order ${orderId} (${items.length} item${items.length > 1 ? 's' : ''})`,
          name: content.brand.name + ' Order',
          unitPrice: { amount: String(totalCents), currencyCode: 'USD' },
          product: {
            name: content.brand.name + ' Order',
            description: items.map(i => `${i.title} x${i.qty}`).join(', '),
            taxCategory: 'standard',
          },
          taxMode: 'internal',
        },
      }],
      customData: { orderId, sessionId: req.sessionID },
    });

    // Store pending order in session so we can finalise later
    req.session.pendingPaddleOrder = {
      orderId, name, email, phone, address, city, postalCode,
      paymentMethod: 'card',
      items: items.map(i => ({ id: i.id, title: i.title, image: i.image, price: i.price, qty: i.qty })),
      subtotal: totals.subtotal, markup: totals.markup,
      delivery: totals.delivery, total: totals.total,
      country, date: new Date().toISOString(),
      status: 'pending',
      statusHistory: [{ status: 'pending', ts: new Date().toISOString() }],
      paddleTransactionId: txn.id,
    };

    return res.json({ transactionId: txn.id, clientToken: PADDLE_CLIENT_TOKEN });
  } catch (err) {
    console.error('Paddle create-transaction error:', err);
    return res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// Called by frontend after Paddle overlay success
app.post('/api/paddle/complete', async (req, res) => {
  const pending = req.session.pendingPaddleOrder;
  if (!pending) return res.status(400).json({ error: 'No pending order' });

  // Verify with Paddle that the transaction was actually completed
  if (paddle && pending.paddleTransactionId) {
    try {
      const txn = await paddle.transactions.get(pending.paddleTransactionId);
      if (txn.status !== 'completed' && txn.status !== 'paid') {
        return res.status(402).json({ error: 'Payment not yet confirmed. Please wait a moment and try again.' });
      }
    } catch (verifyErr) {
      console.error('Paddle transaction verify error:', verifyErr.message);
      // Do not block on verify failure — webhook is the source of truth
    }
  }

  const order = {
    ...pending,
    status: 'confirmed',
    statusHistory: [
      { status: 'pending', ts: pending.date },
      { status: 'confirmed', ts: new Date().toISOString(), note: 'Payment verified via Paddle' },
    ],
  };
  delete order.paddleTransactionId;

  // Persist order
  const db = firebase.getDb();
  if (db) {
    await db.collection('orders').add({
      ...order,
      paddleTransactionId: pending.paddleTransactionId,
      paddleStatus: 'completed',
    }).catch(console.error);
  } else {
    // JSON fallback
    let orders = [];
    if (fs.existsSync(ORDERS_PATH)) {
      orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8'));
    }
    const orderToSave = {
      ...order,
      paddleTransactionId: pending.paddleTransactionId,
      paddleStatus: 'completed',
    };
    orderToSave.firestoreId = orderToSave.orderId; // Mock ID
    orders.push(orderToSave);
    fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
  }

  req.session.lastOrder = order;
  req.session.cart = [];
  delete req.session.pendingPaddleOrder;
  return res.json({ success: true, redirect: '/checkout/success' });
});

// Paddle webhook handler (verifies signature)
app.post('/api/paddle/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!PADDLE_WEBHOOK_SECRET) return res.status(200).send('ok');
  try {
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf-8');
    const sig = req.headers['paddle-signature'] || '';
    const parts = Object.fromEntries(sig.split(';').map(p => p.split('=')));
    const ts = parts['ts'] || '';
    const h1 = parts['h1'] || '';
    const payload = ts + ':' + rawBody;
    const computed = crypto.createHmac('sha256', PADDLE_WEBHOOK_SECRET).update(payload).digest('hex');
    if (computed !== h1) {
      console.warn('Paddle webhook signature mismatch');
      return res.status(403).send('Invalid signature');
    }
    const event = JSON.parse(rawBody);
    console.log('Paddle webhook:', event.event_type, event.data?.id);

    // Update order status when transaction completes
    if (event.event_type === 'transaction.completed' && event.data?.id) {
      const paddleTransactionId = event.data.id;
      try {
        const db = firebase.getDb();
        if (db) {
          const snap = await db.collection('orders')
            .where('paddleTransactionId', '==', paddleTransactionId)
            .limit(1).get();
          if (!snap.empty) {
            const docRef = snap.docs[0].ref;
            const existing = snap.docs[0].data();
            // Only update if not already confirmed/further along
            if (!existing.status || existing.status === 'pending') {
              await docRef.update({
                status: 'confirmed',
                statusUpdatedAt: new Date().toISOString(),
                paddleStatus: 'completed',
                statusHistory: admin.firestore.FieldValue.arrayUnion({
                  status: 'confirmed',
                  ts: new Date().toISOString(),
                  note: 'Confirmed via Paddle webhook',
                }),
              });
              console.log(`Order confirmed via webhook: ${existing.orderId}`);
            }
          }
        }
      } catch (dbErr) {
        console.error('Webhook order update error:', dbErr.message);
      }
    }

    // Handle payment failure — mark order as cancelled
    if ((event.event_type === 'transaction.payment_failed') && event.data?.id) {
      const paddleTransactionId = event.data.id;
      try {
        const db = firebase.getDb();
        if (db) {
          const snap = await db.collection('orders')
            .where('paddleTransactionId', '==', paddleTransactionId)
            .limit(1).get();
          if (!snap.empty) {
            const docRef = snap.docs[0].ref;
            await docRef.update({
              status: 'cancelled',
              statusUpdatedAt: new Date().toISOString(),
              paddleStatus: 'payment_failed',
              statusHistory: admin.firestore.FieldValue.arrayUnion({
                status: 'cancelled',
                ts: new Date().toISOString(),
                note: 'Payment failed (Paddle webhook)',
              }),
            });
          }
        }
      } catch (dbErr) {
        console.error('Webhook order cancel error:', dbErr.message);
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Paddle webhook error:', err);
    res.status(400).send('error');
  }
});

// ════════════════════════════════════════════════════════════════
// CUSTOMER — Order Tracking
// ════════════════════════════════════════════════════════════════
app.get('/orders/track', (req, res) => {
  const cartCount = req.session.cart ? req.session.cart.reduce((s, i) => s + i.qty, 0) : 0;
  res.render('order-track', { content, order: null, error: null, cartCount, query: {} });
});

app.post('/orders/track', async (req, res) => {
  const cartCount = req.session.cart ? req.session.cart.reduce((s, i) => s + i.qty, 0) : 0;
  const { orderId, email } = req.body;
  if (!orderId || !email) {
    return res.render('order-track', { content, order: null, error: 'Please enter both Order ID and email.', cartCount, query: { orderId, email } });
  }
  try {
    const order = await getOrderByOrderId(orderId.trim().toUpperCase());
    if (!order || order.email.toLowerCase() !== email.trim().toLowerCase()) {
      return res.render('order-track', { content, order: null, error: 'No order found with that ID and email combination.', cartCount, query: { orderId, email } });
    }
    res.render('order-track', { content, order, error: null, cartCount, query: { orderId, email } });
  } catch (err) {
    console.error(err);
    res.render('order-track', { content, order: null, error: 'Unable to look up order. Please try again.', cartCount, query: { orderId, email } });
  }
});

// ════════════════════════════════════════════════════════════════
// LEGAL PAGES
// ════════════════════════════════════════════════════════════════
app.get('/philosophy', (req, res) => {
  const cartCount = req.session.cart ? req.session.cart.reduce((s, i) => s + i.qty, 0) : 0;
  res.render('philosophy', { content, cartCount });
});

app.get('/terms', (req, res) => {
  const cartCount = req.session.cart ? req.session.cart.reduce((s, i) => s + i.qty, 0) : 0;
  res.render('terms', { content, cartCount });
});

app.get('/privacy', (req, res) => {
  const cartCount = req.session.cart ? req.session.cart.reduce((s, i) => s + i.qty, 0) : 0;
  res.render('privacy', { content, cartCount });
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Auth
// ════════════════════════════════════════════════════════════════
app.get('/admin/login', (req, res) => {
  if (req.session.adminLoggedIn) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.adminLoggedIn = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { error: 'Invalid username or password.' });
});

app.get('/admin/logout', (req, res) => {
  req.session.adminLoggedIn = false;
  res.redirect('/admin/login');
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Dashboard
// ════════════════════════════════════════════════════════════════
app.get('/admin', requireAdmin, async (req, res) => {
  const [products, catalogues, brands, orders] = await Promise.all([getProducts(), getCatalogues(), getBrands(), getOrders()]);
  res.render('admin/dashboard', { products, catalogues, brands, orders, activePage: 'dashboard' });
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Products CRUD
// ════════════════════════════════════════════════════════════════
app.get('/admin/products', requireAdmin, async (req, res) => {
  const products = await getProducts();
  res.render('admin/products', { products, success: req.query.success || null, error: req.query.error || null });
});

app.get('/admin/products/new', requireAdmin, async (req, res) => {
  const brands = await getBrands();
  res.render('admin/product-form', { product: null, error: null, brands });
});

app.post('/admin/products/new', requireAdmin, upload.array('images', 10), async (req, res) => {
  try {
    const { title, category, meta, price, badge, badgeStyle, color, desc, details, inStock, featured } = req.body;
    if (!title || !price) {
      const brands = await getBrands();
      return res.render('admin/product-form', { product: null, error: 'Title and price are required.', brands });
    }

    const defaultImg = 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop';
    let images = [];
    let storagePaths = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        const uploaded = await uploadToStorage(file, 'products');
        images.push(uploaded.url);
        if (uploaded.storagePath) storagePaths.push(uploaded.storagePath);
      }
    }
    if (!images.length) images = [defaultImg];

    const id = await nextProductId();
    await saveProduct({
      id, title, category, meta, price: parseFloat(price),
      badge, badgeStyle: badgeStyle || 'green', color: color || 'green',
      image: images[0], images, storagePaths, desc, details,
      brand: req.body.brand || '',
      brandId: req.body.brandId ? Number(req.body.brandId) : null,
      fabric: req.body.fabric || '',
      productType: req.body.productType || '',
      tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      inStock: inStock === 'on', featured: featured === 'on'
    });
    res.redirect('/admin/products?success=Product+added+successfully');
  } catch (err) {
    console.error(err);
    const brands = await getBrands();
    res.render('admin/product-form', { product: null, error: 'Failed to save product: ' + err.message, brands });
  }
});

app.get('/admin/products/:id/edit', requireAdmin, async (req, res) => {
  const product = await getProductById(req.params.id);
  if (!product) return res.redirect('/admin/products');
  const brands = await getBrands();
  res.render('admin/product-form', { product, error: null, brands });
});

app.post('/admin/products/:id/edit', requireAdmin, upload.array('images', 10), async (req, res) => {
  try {
    const existing = await getProductById(req.params.id);
    if (!existing) return res.redirect('/admin/products');

    const { title, category, meta, price, badge, badgeStyle, color, desc, details, inStock, featured } = req.body;

    // Start with existing images
    let images = existing.images && existing.images.length ? [...existing.images] : (existing.image ? [existing.image] : []);
    let storagePaths = existing.storagePaths && existing.storagePaths.length ? [...existing.storagePaths] : (existing.storagePath ? [existing.storagePath] : []);

    // Remove images marked for removal
    if (req.body.removedImages) {
      const removeIdxs = req.body.removedImages.split(',').map(Number).filter(n => !isNaN(n)).sort((a, b) => b - a);
      for (const idx of removeIdxs) {
        if (idx >= 0 && idx < images.length) {
          // Delete from storage if we have a matching storagePath
          if (storagePaths[idx]) await deleteFromStorage(storagePaths[idx]);
          images.splice(idx, 1);
          storagePaths.splice(idx, 1);
        }
      }
    }

    // Add newly uploaded images
    if (req.files && req.files.length) {
      for (const file of req.files) {
        const uploaded = await uploadToStorage(file, 'products');
        images.push(uploaded.url);
        storagePaths.push(uploaded.storagePath || '');
      }
    }

    // Ensure at least a default
    if (!images.length) images = ['https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop'];

    await saveProduct({
      ...existing,
      title, category, meta, price: parseFloat(price),
      badge, badgeStyle, color,
      image: images[0], images, storagePaths,
      desc, details,
      brand: req.body.brand || '',
      brandId: req.body.brandId ? Number(req.body.brandId) : (existing.brandId || null),
      fabric: req.body.fabric || '',
      productType: req.body.productType || '',
      tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(Boolean) : (existing.tags || []),
      inStock: inStock === 'on', featured: featured === 'on'
    });
    res.redirect('/admin/products?success=Product+updated+successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products?error=Update+failed:+' + encodeURIComponent(err.message));
  }
});

// Bulk delete selected products (must be before :id/delete)
app.post('/admin/products/bulk-delete', requireAdmin, async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!ids || !ids.length) return res.redirect('/admin/products?error=No+products+selected');
    const idList = Array.isArray(ids) ? ids : [ids];
    for (const id of idList) {
      const product = await getProductById(id);
      if (product) {
        for (const sp of (product.storagePaths || [])) { if (sp) await deleteFromStorage(sp); }
        if (product.storagePath) await deleteFromStorage(product.storagePath);
      }
      await deleteProduct(id);
    }
    res.redirect('/admin/products?success=' + encodeURIComponent(`Deleted ${idList.length} product(s)`));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products?error=Bulk+delete+failed');
  }
});

// Delete ALL products
app.post('/admin/products/delete-all', requireAdmin, async (req, res) => {
  try {
    const all = await getProducts();
    for (const p of all) {
      for (const sp of (p.storagePaths || [])) { if (sp) await deleteFromStorage(sp); }
      if (p.storagePath) await deleteFromStorage(p.storagePath);
      await deleteProduct(p.id);
    }
    res.redirect('/admin/products?success=' + encodeURIComponent(`Deleted all ${all.length} product(s)`));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products?error=Delete+all+failed');
  }
});

app.post('/admin/products/:id/delete', requireAdmin, async (req, res) => {
  try {
    const product = await getProductById(req.params.id);
    if (product) {
      for (const sp of (product.storagePaths || [])) { if (sp) await deleteFromStorage(sp); }
      if (product.storagePath) await deleteFromStorage(product.storagePath);
    }
    await deleteProduct(req.params.id);
    res.redirect('/admin/products?success=Product+deleted');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products?error=Delete+failed');
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Catalogues
// ════════════════════════════════════════════════════════════════
app.get('/admin/catalogues', requireAdmin, async (req, res) => {
  const catalogues = await getCatalogues();
  res.render('admin/catalogues', { catalogues, success: req.query.success || null, error: req.query.error || null });
});

app.post('/admin/catalogues/upload', requireAdmin, upload.single('catalogue'), async (req, res) => {
  try {
    if (!req.file) {
      const catalogues = await getCatalogues();
      return res.render('admin/catalogues', { catalogues, success: null, error: 'No file uploaded.' });
    }
    const uploaded = await uploadToStorage(req.file, 'catalogues');
    const cats = await getCatalogues();
    const nextId = cats.length ? Math.max(...cats.map(c => c.id || 0)) + 1 : 1;

    await saveCatalogue({
      id: nextId,
      name: req.body.name || req.file.originalname,
      filename: uploaded.filename,
      url: uploaded.url,
      storagePath: uploaded.storagePath || null,
      size: req.file.size,
      uploadedAt: new Date().toISOString()
    });
    res.redirect('/admin/catalogues?success=Catalogue+uploaded+successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/catalogues?error=' + encodeURIComponent('Upload failed: ' + err.message));
  }
});

app.post('/admin/catalogues/:id/delete', requireAdmin, async (req, res) => {
  try {
    const cats = await getCatalogues();
    // id may be a Firestore doc id or a numeric JSON id
    const cat = cats.find(c => String(c.firestoreId || c.id) === String(req.params.id));
    if (cat && cat.storagePath) await deleteFromStorage(cat.storagePath);
    await deleteCatalogue(cat ? (cat.firestoreId || cat.id) : req.params.id);
    res.redirect('/admin/catalogues?success=Catalogue+deleted');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/catalogues?error=Delete+failed');
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Brands
// ════════════════════════════════════════════════════════════════
app.get('/admin/brands', requireAdmin, async (req, res) => {
  const brands = await getBrands();
  res.render('admin/brands', { brands, success: req.query.success || null, error: req.query.error || null });
});

app.post('/admin/brands/new', requireAdmin, upload.single('logo'), async (req, res) => {
  try {
    const { name, description, website, color, scrapeUrl } = req.body;
    if (!name) return res.redirect('/admin/brands?error=Brand+name+is+required');

    let logoUrl = null;
    let storagePath = null;
    if (req.file) {
      const uploaded = await uploadToStorage(req.file, 'brands');
      logoUrl     = uploaded.url;
      storagePath = uploaded.storagePath || null;
    }

    const id = await nextBrandId();
    await saveBrand({
      id, name, description: description || '',
      website: website || '', scrapeUrl: scrapeUrl || '',
      color: color || 'green',
      logo: logoUrl, storagePath,
      createdAt: new Date().toISOString()
    });
    res.redirect('/admin/brands?success=Brand+added+successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands?error=' + encodeURIComponent('Failed: ' + err.message));
  }
});

app.get('/admin/brands/:id/edit', requireAdmin, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) return res.redirect('/admin/brands');
  const brands = await getBrands();
  res.render('admin/brands', { brands, editing: brand, success: null, error: null });
});

app.post('/admin/brands/:id/edit', requireAdmin, upload.single('logo'), async (req, res) => {
  try {
    const existing = await getBrandById(req.params.id);
    if (!existing) return res.redirect('/admin/brands');

    const { name, description, website, color, scrapeUrl } = req.body;
    let logoUrl     = existing.logo;
    let storagePath = existing.storagePath || null;

    if (req.file) {
      if (storagePath) await deleteFromStorage(storagePath);
      const uploaded = await uploadToStorage(req.file, 'brands');
      logoUrl     = uploaded.url;
      storagePath = uploaded.storagePath || null;
    }

    await saveBrand({
      ...existing,
      name, description: description || '',
      website: website || '', scrapeUrl: scrapeUrl || '',
      color: color || 'green',
      logo: logoUrl, storagePath
    });
    res.redirect('/admin/brands?success=Brand+updated+successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands?error=' + encodeURIComponent('Update failed: ' + err.message));
  }
});

// ── Fetch products for a single brand ────────────────────────
app.post('/admin/brands/:id/fetch', requireAdmin, async (req, res) => {
  try {
    const brand = await getBrandById(req.params.id);
    if (!brand) return res.redirect('/admin/brands?error=Brand+not+found');
    if (!brand.scrapeUrl) return res.redirect('/admin/brands?error=No+scrape+URL+set+for+this+brand');
    const result = await fetchBrandProducts(brand);
    const msg = result.errors.length
      ? `Fetch had errors: ${result.errors.join('; ')}`
      : `Fetched ${result.added} new, removed ${result.removed} deleted product(s) from ${brand.name}`;
    res.redirect('/admin/brands?success=' + encodeURIComponent(msg));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands?error=' + encodeURIComponent('Fetch failed: ' + err.message));
  }
});

// ── Fetch products for ALL brands ────────────────────────────
app.post('/admin/brands/fetch-all', requireAdmin, async (req, res) => {
  try {
    const results = await fetchAllBrandProducts();
    const totalAdded   = results.reduce((s, r) => s + r.added, 0);
    const totalRemoved = results.reduce((s, r) => s + r.removed, 0);
    res.redirect('/admin/brands?success=' + encodeURIComponent(`Fetched ${totalAdded} new, removed ${totalRemoved} deleted product(s) across ${results.length} brand(s)`));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands?error=' + encodeURIComponent('Fetch all failed: ' + err.message));
  }
});

// Bulk delete selected brands (must be before :id/delete)
app.post('/admin/brands/bulk-delete', requireAdmin, async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!ids || !ids.length) return res.redirect('/admin/brands?error=No+brands+selected');
    const idList = Array.isArray(ids) ? ids : [ids];
    for (const id of idList) {
      const brand = await getBrandById(id);
      if (brand && brand.storagePath) await deleteFromStorage(brand.storagePath);
      await deleteBrand(id);
    }
    res.redirect('/admin/brands?success=' + encodeURIComponent(`Deleted ${idList.length} brand(s)`));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands?error=Bulk+delete+failed');
  }
});

// Delete ALL brands
app.post('/admin/brands/delete-all', requireAdmin, async (req, res) => {
  try {
    const all = await getBrands();
    for (const b of all) {
      if (b.storagePath) await deleteFromStorage(b.storagePath);
      await deleteBrand(b.id);
    }
    res.redirect('/admin/brands?success=' + encodeURIComponent(`Deleted all ${all.length} brand(s)`));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands?error=Delete+all+failed');
  }
});

app.post('/admin/brands/:id/delete', requireAdmin, async (req, res) => {
  try {
    const brand = await getBrandById(req.params.id);
    if (brand && brand.storagePath) await deleteFromStorage(brand.storagePath);
    await deleteBrand(req.params.id);
    res.redirect('/admin/brands?success=Brand+deleted');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/brands?error=Delete+failed');
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Pricing & Delivery
// ════════════════════════════════════════════════════════════════
app.get('/admin/pricing', requireAdmin, async (req, res) => {
  const pricing = await getPricing();
  res.render('admin/pricing', { pricing, success: req.query.success || null, error: req.query.error || null });
});

app.post('/admin/pricing', requireAdmin, async (req, res) => {
  try {
    const pricing = await getPricing();
    pricing.defaultMarkup = parseFloat(req.body.defaultMarkup) || 0;
    pricing.defaultDelivery = parseFloat(req.body.defaultDelivery) || 0;
    pricing.freeShippingThreshold = parseFloat(req.body.freeShippingThreshold) || 0;

    // Update country-specific settings
    const countries = req.body.countries;
    if (countries) {
      // Express parses countries[0][code] etc. as an object with numeric keys
      const updates = Array.isArray(countries) ? countries : Object.values(countries);
      for (const update of updates) {
        if (!update || !update.code) continue;
        const existing = pricing.countries.find(c => c.code === update.code);
        if (existing) {
          existing.markup = parseFloat(update.markup) || 0;
          existing.delivery = parseFloat(update.delivery) || 0;
          existing.enabled = update.enabled === 'on' || update.enabled === true;
        }
      }
    }

    await savePricing(pricing);
    res.redirect('/admin/pricing?success=Pricing+settings+saved');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/pricing?error=' + encodeURIComponent('Failed to save: ' + err.message));
  }
});

app.post('/admin/pricing/add-country', requireAdmin, async (req, res) => {
  try {
    const { code, name, currency } = req.body;
    if (!code || !name || !currency) return res.redirect('/admin/pricing?error=All+fields+required');
    const pricing = await getPricing();
    if (pricing.countries.find(c => c.code === code.toUpperCase())) {
      return res.redirect('/admin/pricing?error=Country+already+exists');
    }
    pricing.countries.push({
      code: code.toUpperCase(),
      name,
      currency: currency.toUpperCase(),
      markup: pricing.defaultMarkup || 0,
      delivery: pricing.defaultDelivery || 0,
      enabled: false
    });
    await savePricing(pricing);
    res.redirect('/admin/pricing?success=Country+added');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/pricing?error=' + encodeURIComponent('Failed: ' + err.message));
  }
});

app.post('/admin/pricing/remove-country', requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;
    const pricing = await getPricing();
    pricing.countries = pricing.countries.filter(c => c.code !== code);
    await savePricing(pricing);
    res.redirect('/admin/pricing?success=Country+removed');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/pricing?error=' + encodeURIComponent('Failed: ' + err.message));
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Orders
// ════════════════════════════════════════════════════════════════
app.get('/admin/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await getOrders();
    const { status } = req.query;
    const filtered = status ? orders.filter(o => o.status === status) : orders;
    res.render('admin/orders', {
      orders: filtered,
      allOrders: orders,
      statusFilter: status || '',
      statuses: ORDER_STATUSES,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error(err);
    res.render('admin/orders', { orders: [], allOrders: [], statusFilter: '', statuses: ORDER_STATUSES, success: null, error: 'Failed to load orders.' });
  }
});

app.get('/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) return res.redirect('/admin/orders?error=Order+not+found');
    res.render('admin/orders', {
      orders: null,
      allOrders: null,
      detailOrder: order,
      statusFilter: '',
      statuses: ORDER_STATUSES,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/orders?error=Failed+to+load+order');
  }
});

app.post('/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!ORDER_STATUSES.includes(status)) return res.redirect('/admin/orders?error=Invalid+status');
    await updateOrderStatus(req.params.id, status, note || '');
    res.redirect(`/admin/orders/${req.params.id}?success=Status+updated`);
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/orders/${req.params.id}?error=` + encodeURIComponent('Update failed: ' + err.message));
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN — CONTACT MESSAGES
// ════════════════════════════════════════════════════════════════
app.get('/admin/messages', requireAdmin, async (req, res) => {
  console.log('[admin/messages] Loading contact submissions');
  let messages = [];

  const db = firebase.getDb();
  if (db) {
    try {
      const snap = await db.collection('contact_submissions').orderBy('submittedAt', 'desc').get();
      messages = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
      console.log('[admin/messages] Loaded', messages.length, 'from Firestore');
    } catch (err) {
      console.warn('[admin/messages] orderBy failed (index may be missing), trying unordered:', err.message);
      try {
        const snap = await db.collection('contact_submissions').get();
        messages = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        messages.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
        console.log('[admin/messages] Loaded', messages.length, 'from Firestore (unordered fallback)');
      } catch (err2) {
        console.error('[admin/messages] Firestore load failed entirely:', err2.message);
      }
    }
  }

  // Fallback to JSON if Firestore returned nothing
  if (messages.length === 0) {
    try {
      const CONTACT_PATH = path.join(__dirname, 'data/contact_submissions.json');
      if (fs.existsSync(CONTACT_PATH)) {
        messages = JSON.parse(fs.readFileSync(CONTACT_PATH, 'utf-8'));
        console.log('[admin/messages] Loaded', messages.length, 'from JSON fallback');
      }
    } catch (err) {
      console.error('[admin/messages] JSON fallback load failed:', err.message);
    }
  }

  res.render('admin/messages', { activePage: 'messages', messages });
});

// ════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  refreshMarkup(); // load default markup into cache on startup
  console.log(`paknits running at http://localhost:${PORT}`);
  console.log(`Admin panel:  http://localhost:${PORT}/admin`);
});
