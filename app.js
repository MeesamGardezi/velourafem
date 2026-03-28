const express = require('express');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const content = require('./data/content');

const app = express();
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
  secret: 'clothing-co-secret-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── Multer: product images ────────────────────────────────────────
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, 'public/uploads/products');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const uploadProduct = multer({ storage: productStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Multer: catalogues ────────────────────────────────────────────
const catalogueStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, 'public/uploads/catalogues');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const uploadCatalogue = multer({ storage: catalogueStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────────
function getProducts() {
  const raw = fs.readFileSync(path.join(__dirname, 'data/products.json'), 'utf8');
  return JSON.parse(raw);
}
function saveProducts(data) {
  fs.writeFileSync(path.join(__dirname, 'data/products.json'), JSON.stringify(data, null, 2));
}
function getCatalogues() {
  const raw = fs.readFileSync(path.join(__dirname, 'data/catalogues.json'), 'utf8');
  return JSON.parse(raw);
}
function saveCatalogues(data) {
  fs.writeFileSync(path.join(__dirname, 'data/catalogues.json'), JSON.stringify(data, null, 2));
}
function getCartItems(req) {
  const cart = req.session.cart || [];
  const products = getProducts();
  return cart.map(item => {
    const product = products.find(p => p.id === item.id);
    return product ? { ...product, qty: item.qty } : null;
  }).filter(Boolean);
}
function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

// ── Admin Auth Middleware ─────────────────────────────────────────
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
function requireAdmin(req, res, next) {
  if (req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

// ══════════════════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  const cart = req.session.cart || [];
  res.render('index', { content, cartCount: cart.reduce((s, i) => s + i.qty, 0) });
});

// ══════════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════════
app.get('/products', (req, res) => {
  const products = getProducts();
  const { filter, category, q } = req.query;
  let filtered = [...products];

  if (filter === 'new') filtered = filtered.filter(p => p.badge === 'New Arrival' || p.badge === 'New');
  else if (filter === 'bestseller') filtered = filtered.filter(p => p.badge === 'Bestseller');
  else if (filter === 'archive') filtered = filtered.filter(p => p.badge === 'Archive');
  if (category) filtered = filtered.filter(p => p.category === category);
  if (q) {
    const search = q.toLowerCase();
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(search) ||
      p.desc.toLowerCase().includes(search) ||
      p.category.toLowerCase().includes(search)
    );
  }

  const categories = [...new Set(products.map(p => p.category))];
  const cart = req.session.cart || [];
  res.render('products', {
    content, products: filtered, categories,
    filter: filter || '', category: category || '', q: q || '',
    cartCount: cart.reduce((s, i) => s + i.qty, 0)
  });
});

app.get('/products/:id', (req, res) => {
  const products = getProducts();
  const product = products.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.redirect('/products');
  const related = products.filter(p => p.id !== product.id && p.category === product.category).slice(0, 3);
  const cart = req.session.cart || [];
  res.render('product-detail', {
    content, product, related,
    cartCount: cart.reduce((s, i) => s + i.qty, 0)
  });
});

// ══════════════════════════════════════════════════════════════════
// CART
// ══════════════════════════════════════════════════════════════════
app.get('/cart', (req, res) => {
  const items = getCartItems(req);
  const total = cartTotal(items);
  res.render('cart', { content, items, total, cartCount: items.reduce((s, i) => s + i.qty, 0) });
});

app.post('/cart/add', (req, res) => {
  const id = parseInt(req.body.id);
  const qty = parseInt(req.body.qty) || 1;
  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => i.id === id);
  if (existing) existing.qty += qty;
  else req.session.cart.push({ id, qty });
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    const total = req.session.cart.reduce((s, i) => s + i.qty, 0);
    return res.json({ success: true, cartCount: total });
  }
  res.redirect('/cart');
});

app.post('/cart/update', (req, res) => {
  const id = parseInt(req.body.id);
  const qty = parseInt(req.body.qty);
  if (!req.session.cart) req.session.cart = [];
  if (qty <= 0) {
    req.session.cart = req.session.cart.filter(i => i.id !== id);
  } else {
    const item = req.session.cart.find(i => i.id === id);
    if (item) item.qty = qty;
  }
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const id = parseInt(req.body.id);
  req.session.cart = (req.session.cart || []).filter(i => i.id !== id);
  res.redirect('/cart');
});

// ══════════════════════════════════════════════════════════════════
// CHECKOUT
// ══════════════════════════════════════════════════════════════════
app.get('/checkout', (req, res) => {
  const items = getCartItems(req);
  if (!items.length) return res.redirect('/cart');
  const total = cartTotal(items);
  const cart = req.session.cart || [];
  res.render('checkout', { content, items, total, cartCount: cart.reduce((s, i) => s + i.qty, 0), error: null });
});

app.post('/checkout', (req, res) => {
  const items = getCartItems(req);
  if (!items.length) return res.redirect('/cart');
  const { name, email, phone, address, city, postalCode, paymentMethod } = req.body;
  if (!name || !email || !address || !city) {
    const total = cartTotal(items);
    const cart = req.session.cart || [];
    return res.render('checkout', {
      content, items, total, cartCount: cart.reduce((s, i) => s + i.qty, 0),
      error: 'Please fill in all required fields.'
    });
  }
  const orderId = 'ORD-' + Date.now().toString(36).toUpperCase();
  const order = { orderId, name, email, phone, address, city, postalCode, paymentMethod, items, total: cartTotal(items), date: new Date().toISOString() };
  req.session.lastOrder = order;
  req.session.cart = [];
  res.redirect('/checkout/success');
});

app.get('/checkout/success', (req, res) => {
  const order = req.session.lastOrder;
  if (!order) return res.redirect('/');
  res.render('order-success', { content, order, cartCount: 0 });
});

// ══════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════
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
  res.render('admin/login', { error: 'Invalid credentials. Try admin / admin123' });
});

app.get('/admin/logout', (req, res) => {
  req.session.adminLoggedIn = false;
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => {
  const products = getProducts();
  const catalogues = getCatalogues();
  res.render('admin/dashboard', { products, catalogues });
});

// Admin – Products
app.get('/admin/products', requireAdmin, (req, res) => {
  const products = getProducts();
  res.render('admin/products', { products, success: req.query.success || null, error: req.query.error || null });
});

app.get('/admin/products/new', requireAdmin, (req, res) => {
  res.render('admin/product-form', { product: null, error: null });
});

app.post('/admin/products/new', requireAdmin, uploadProduct.single('image'), (req, res) => {
  const products = getProducts();
  const { title, category, meta, price, badge, badgeStyle, color, desc, details, inStock, featured } = req.body;
  if (!title || !price) {
    return res.render('admin/product-form', { product: null, error: 'Title and price are required.' });
  }
  const newProduct = {
    id: products.length ? Math.max(...products.map(p => p.id)) + 1 : 1,
    title, category, meta, price: parseFloat(price),
    badge, badgeStyle: badgeStyle || 'green', color: color || 'green',
    image: req.file ? '/uploads/products/' + req.file.filename : 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=750&fit=crop',
    desc, details,
    inStock: inStock === 'on',
    featured: featured === 'on'
  };
  products.push(newProduct);
  saveProducts(products);
  res.redirect('/admin/products?success=Product+added+successfully');
});

app.get('/admin/products/:id/edit', requireAdmin, (req, res) => {
  const products = getProducts();
  const product = products.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.redirect('/admin/products');
  res.render('admin/product-form', { product, error: null });
});

app.post('/admin/products/:id/edit', requireAdmin, uploadProduct.single('image'), (req, res) => {
  const products = getProducts();
  const idx = products.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.redirect('/admin/products');
  const { title, category, meta, price, badge, badgeStyle, color, desc, details, inStock, featured } = req.body;
  products[idx] = {
    ...products[idx], title, category, meta,
    price: parseFloat(price), badge, badgeStyle, color, desc, details,
    inStock: inStock === 'on', featured: featured === 'on',
    image: req.file ? '/uploads/products/' + req.file.filename : products[idx].image
  };
  saveProducts(products);
  res.redirect('/admin/products?success=Product+updated+successfully');
});

app.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
  let products = getProducts();
  products = products.filter(p => p.id !== parseInt(req.params.id));
  saveProducts(products);
  res.redirect('/admin/products?success=Product+deleted');
});

// Admin – Catalogues
app.get('/admin/catalogues', requireAdmin, (req, res) => {
  const catalogues = getCatalogues();
  res.render('admin/catalogues', { catalogues, success: req.query.success || null, error: req.query.error || null });
});

app.post('/admin/catalogues/upload', requireAdmin, uploadCatalogue.single('catalogue'), (req, res) => {
  if (!req.file) {
    const catalogues = getCatalogues();
    return res.render('admin/catalogues', { catalogues, success: null, error: 'No file uploaded.' });
  }
  const catalogues = getCatalogues();
  catalogues.push({
    id: catalogues.length ? Math.max(...catalogues.map(c => c.id)) + 1 : 1,
    name: req.body.name || req.file.originalname,
    filename: req.file.filename,
    url: '/uploads/catalogues/' + req.file.filename,
    size: req.file.size,
    uploadedAt: new Date().toISOString()
  });
  saveCatalogues(catalogues);
  res.redirect('/admin/catalogues?success=Catalogue+uploaded+successfully');
});

app.post('/admin/catalogues/:id/delete', requireAdmin, (req, res) => {
  let catalogues = getCatalogues();
  const cat = catalogues.find(c => c.id === parseInt(req.params.id));
  if (cat) {
    const filePath = path.join(__dirname, 'public/uploads/catalogues', cat.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  catalogues = catalogues.filter(c => c.id !== parseInt(req.params.id));
  saveCatalogues(catalogues);
  res.redirect('/admin/catalogues?success=Catalogue+deleted');
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Clothing Co. running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin (admin / admin123)`);
});
