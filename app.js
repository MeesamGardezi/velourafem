require('dotenv').config();

const express  = require('express');
const path     = require('path');
const session  = require('express-session');
const multer   = require('multer');
const fs       = require('fs');
const content  = require('./data/content');
const firebase = require('./config/firebase');

// Initialise Firebase on startup (non-blocking)
firebase.init();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── View engine ──────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static & Body Parsing ────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Session ──────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'paknits-secret-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── Multer (memory storage — we upload to Firebase Storage) ──────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }   // 50 MB
});

// ════════════════════════════════════════════════════════════════
// DATA HELPERS — Firestore with JSON fallback
// ════════════════════════════════════════════════════════════════
const PRODUCTS_PATH   = path.join(__dirname, 'data/products.json');
const CATALOGUES_PATH = path.join(__dirname, 'data/catalogues.json');

// ── Products ─────────────────────────────────────────────────────
async function getProducts() {
  const db = firebase.getDb();
  if (db) {
    const snap = await db.collection('products').orderBy('id').get();
    return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  }
  return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
}

async function getProductById(id) {
  const db = firebase.getDb();
  if (db) {
    const snap = await db.collection('products').where('id', '==', Number(id)).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { firestoreId: doc.id, ...doc.data() };
  }
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  return products.find(p => p.id === Number(id)) || null;
}

async function saveProduct(data) {
  const db = firebase.getDb();
  if (db) {
    if (data.firestoreId) {
      const { firestoreId, ...rest } = data;
      await db.collection('products').doc(firestoreId).set(rest, { merge: true });
    } else {
      await db.collection('products').add(data);
    }
    return;
  }
  // JSON fallback
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const idx = products.findIndex(p => p.id === data.id);
  if (idx >= 0) products[idx] = data;
  else products.push(data);
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
}

async function deleteProduct(id) {
  const db = firebase.getDb();
  if (db) {
    const snap = await db.collection('products').where('id', '==', Number(id)).limit(1).get();
    if (!snap.empty) await snap.docs[0].ref.delete();
    return;
  }
  let products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  products = products.filter(p => p.id !== Number(id));
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
}

async function nextProductId() {
  const products = await getProducts();
  return products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
}

// ── Catalogues ───────────────────────────────────────────────────
async function getCatalogues() {
  const db = firebase.getDb();
  if (db) {
    const snap = await db.collection('catalogues').orderBy('uploadedAt', 'desc').get();
    return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  }
  return JSON.parse(fs.readFileSync(CATALOGUES_PATH, 'utf8'));
}

async function saveCatalogue(data) {
  const db = firebase.getDb();
  if (db) {
    await db.collection('catalogues').add(data);
    return;
  }
  const cats = JSON.parse(fs.readFileSync(CATALOGUES_PATH, 'utf8'));
  cats.push(data);
  fs.writeFileSync(CATALOGUES_PATH, JSON.stringify(cats, null, 2));
}

async function deleteCatalogue(firestoreIdOrJsonId) {
  const db = firebase.getDb();
  if (db) {
    await db.collection('catalogues').doc(String(firestoreIdOrJsonId)).delete();
    return;
  }
  let cats = JSON.parse(fs.readFileSync(CATALOGUES_PATH, 'utf8'));
  const cat = cats.find(c => c.id === Number(firestoreIdOrJsonId));
  if (cat) {
    const fp = path.join(__dirname, 'public/uploads/catalogues', cat.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  cats = cats.filter(c => c.id !== Number(firestoreIdOrJsonId));
  fs.writeFileSync(CATALOGUES_PATH, JSON.stringify(cats, null, 2));
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
function cartTotal(items) {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}

// ── Admin auth ───────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
function requireAdmin(req, res, next) {
  if (req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

// ════════════════════════════════════════════════════════════════
// HOME
// ════════════════════════════════════════════════════════════════
app.get('/', async (req, res) => {
  const cart = req.session.cart || [];
  res.render('index', { content, cartCount: cart.reduce((s, i) => s + i.qty, 0) });
});

// ════════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════════
app.get('/products', async (req, res) => {
  try {
    let products = await getProducts();
    const { filter, category, q } = req.query;

    if (filter === 'new')        products = products.filter(p => p.badge === 'New Arrival' || p.badge === 'New');
    else if (filter === 'bestseller') products = products.filter(p => p.badge === 'Bestseller');
    else if (filter === 'archive')    products = products.filter(p => p.badge === 'Archive');

    if (category) products = products.filter(p => p.category === category);
    if (q) {
      const s = q.toLowerCase();
      products = products.filter(p =>
        p.title.toLowerCase().includes(s) ||
        p.desc.toLowerCase().includes(s) ||
        p.category.toLowerCase().includes(s)
      );
    }

    const all = await getProducts();
    const categories = [...new Set(all.map(p => p.category))];
    const cart = req.session.cart || [];
    res.render('products', {
      content, products, categories,
      filter: filter || '', category: category || '', q: q || '',
      cartCount: cart.reduce((s, i) => s + i.qty, 0)
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading products.');
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const product = await getProductById(req.params.id);
    if (!product) return res.redirect('/products');
    const all = await getProducts();
    const related = all.filter(p => p.id !== product.id && p.category === product.category).slice(0, 3);
    const cart = req.session.cart || [];
    res.render('product-detail', { content, product, related, cartCount: cart.reduce((s, i) => s + i.qty, 0) });
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
  res.render('cart', { content, items, total: cartTotal(items), cartCount: items.reduce((s, i) => s + i.qty, 0) });
});

app.post('/cart/add', async (req, res) => {
  const id  = parseInt(req.body.id);
  const qty = parseInt(req.body.qty) || 1;
  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => i.id === id);
  if (existing) existing.qty += qty;
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
  res.render('checkout', { content, items, total: cartTotal(items), cartCount: cart.reduce((s, i) => s + i.qty, 0), error: null });
});

app.post('/checkout', async (req, res) => {
  const items = await getCartItems(req);
  if (!items.length) return res.redirect('/cart');
  const { name, email, phone, address, city, postalCode, paymentMethod } = req.body;
  if (!name || !email || !address || !city) {
    const cart = req.session.cart || [];
    return res.render('checkout', {
      content, items, total: cartTotal(items),
      cartCount: cart.reduce((s, i) => s + i.qty, 0),
      error: 'Please fill in all required fields.'
    });
  }
  const orderId = 'ORD-' + Date.now().toString(36).toUpperCase();
  const order = { orderId, name, email, phone, address, city, postalCode, paymentMethod, items, total: cartTotal(items), date: new Date().toISOString() };

  // Persist order to Firestore if available
  const db = firebase.getDb();
  if (db) {
    await db.collection('orders').add(order).catch(console.error);
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
  res.render('admin/login', { error: `Invalid credentials. Try ${ADMIN_USER} / ${ADMIN_PASS}` });
});

app.get('/admin/logout', (req, res) => {
  req.session.adminLoggedIn = false;
  res.redirect('/admin/login');
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Dashboard
// ════════════════════════════════════════════════════════════════
app.get('/admin', requireAdmin, async (req, res) => {
  const [products, catalogues] = await Promise.all([getProducts(), getCatalogues()]);
  res.render('admin/dashboard', { products, catalogues });
});

// ════════════════════════════════════════════════════════════════
// ADMIN — Products CRUD
// ════════════════════════════════════════════════════════════════
app.get('/admin/products', requireAdmin, async (req, res) => {
  const products = await getProducts();
  res.render('admin/products', { products, success: req.query.success || null, error: req.query.error || null });
});

app.get('/admin/products/new', requireAdmin, (req, res) => {
  res.render('admin/product-form', { product: null, error: null });
});

app.post('/admin/products/new', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, category, meta, price, badge, badgeStyle, color, desc, details, inStock, featured } = req.body;
    if (!title || !price) return res.render('admin/product-form', { product: null, error: 'Title and price are required.' });

    let imageUrl = 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop';
    let storagePath = null;
    if (req.file) {
      const uploaded = await uploadToStorage(req.file, 'products');
      imageUrl    = uploaded.url;
      storagePath = uploaded.storagePath || null;
    }

    const id = await nextProductId();
    await saveProduct({
      id, title, category, meta, price: parseFloat(price),
      badge, badgeStyle: badgeStyle || 'green', color: color || 'green',
      image: imageUrl, storagePath, desc, details,
      inStock: inStock === 'on', featured: featured === 'on'
    });
    res.redirect('/admin/products?success=Product+added+successfully');
  } catch (err) {
    console.error(err);
    res.render('admin/product-form', { product: null, error: 'Failed to save product: ' + err.message });
  }
});

app.get('/admin/products/:id/edit', requireAdmin, async (req, res) => {
  const product = await getProductById(req.params.id);
  if (!product) return res.redirect('/admin/products');
  res.render('admin/product-form', { product, error: null });
});

app.post('/admin/products/:id/edit', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const existing = await getProductById(req.params.id);
    if (!existing) return res.redirect('/admin/products');

    const { title, category, meta, price, badge, badgeStyle, color, desc, details, inStock, featured } = req.body;
    let imageUrl    = existing.image;
    let storagePath = existing.storagePath || null;

    if (req.file) {
      // Delete old file from Storage
      if (storagePath) await deleteFromStorage(storagePath);
      const uploaded = await uploadToStorage(req.file, 'products');
      imageUrl    = uploaded.url;
      storagePath = uploaded.storagePath || null;
    }

    await saveProduct({
      ...existing,
      title, category, meta, price: parseFloat(price),
      badge, badgeStyle, color, image: imageUrl, storagePath,
      desc, details,
      inStock: inStock === 'on', featured: featured === 'on'
    });
    res.redirect('/admin/products?success=Product+updated+successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products?error=Update+failed:+' + encodeURIComponent(err.message));
  }
});

app.post('/admin/products/:id/delete', requireAdmin, async (req, res) => {
  try {
    const product = await getProductById(req.params.id);
    if (product && product.storagePath) await deleteFromStorage(product.storagePath);
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
// START
// ════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`paknits running at http://localhost:${PORT}`);
  console.log(`Admin panel:  http://localhost:${PORT}/admin  (${ADMIN_USER} / ${ADMIN_PASS})`);
});
