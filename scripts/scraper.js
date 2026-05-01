/**
 * Product Scraper
 *
 * Fetches a brand's product page and extracts product data.
 * Extraction strategy (in order of preference):
 *   1. Shopify JSON API (/products.json) — fastest & most reliable
 *   2. JSON-LD structured data (Schema.org Product / ItemList)
 *   3. Shopify embedded analytics data (collection_viewed event)
 *   4. Common e-commerce HTML patterns via CSS selectors
 *
 * Usage:
 *   const { scrapeProducts } = require('./scripts/scraper');
 *   const products = await scrapeProducts('https://brand.com/collections/all');
 */

const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const MAX_PAGES = 100; // safety cap for pagination loops

// ── Fetch helper with timeout ────────────────────────────────────
async function fetchUrl(url, accept) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const headers = { ...HEADERS };
    if (accept) headers['Accept'] = accept;
    const res = await fetch(url, { signal: controller.signal, headers, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// ── 1. Shopify JSON API ──────────────────────────────────────────
async function tryShopifyJson(url) {
  const base = new URL(url);
  try {
    let allProducts = [];
    let page = 1;
    while (true) {
      const apiUrl = `${base.origin}/products.json?limit=250&page=${page}`;
      const res = await fetchUrl(apiUrl, 'application/json');
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('json')) break;
      const data = await res.json();
      if (!data.products || !Array.isArray(data.products) || data.products.length === 0) break;
      console.log(`  ✓ Page ${page}: ${data.products.length} products`);
      allProducts = allProducts.concat(data.products);
      if (data.products.length < 250) break; // last page
      page++;
    }
    if (allProducts.length === 0) return [];
    console.log(`  ✓ Total: ${allProducts.length} products via Shopify JSON API (${page} pages)`);
    return allProducts
      .filter(p => {
        // Skip out-of-stock products
        const variants = p.variants || [];
        return variants.some(v => v.available === true);
      })
      .map(p => {
      const variant = p.variants && p.variants[0];
      const allImages = (p.images || []).map(img => img.src).filter(Boolean);
      return {
        title: p.title || '',
        desc: stripHtml(p.body_html || ''),
        price: parseFloat(variant?.price || 0),
        currency: 'PKR',
        image: allImages[0] || '',
        images: allImages,
        inStock: variant?.available !== false,
        url: `${base.origin}/products/${p.handle}`,
        category: p.product_type || '',
        productType: p.product_type || '',
        tags: (typeof p.tags === 'string' ? p.tags : (Array.isArray(p.tags) ? p.tags.join(', ') : '')).split(',').map(t => t.trim()).filter(Boolean),
      };
    });
  } catch (err) {
    console.log(`  · Shopify JSON API not available: ${err.message}`);
    return [];
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
}

// ── 2. JSON-LD structured data ───────────────────────────────────
function extractFromJsonLd($) {
  const products = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = normaliseJsonLd(data);
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'IndividualProduct') {
          products.push(mapJsonLdProduct(item));
        }
      }
    } catch { /* skip malformed JSON-LD */ }
  });
  return products;
}

function normaliseJsonLd(data) {
  if (Array.isArray(data)) return data.flatMap(normaliseJsonLd);
  if (data['@graph']) return normaliseJsonLd(data['@graph']);
  if (data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
    return data.itemListElement.map(e => e.item || e);
  }
  return [data];
}

function mapJsonLdProduct(item) {
  const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers || {};
  const price = parseFloat(offer.price || offer.lowPrice || 0);
  const image = Array.isArray(item.image) ? item.image[0] : item.image || '';
  return {
    title: item.name || '',
    desc: item.description || '',
    price,
    currency: offer.priceCurrency || 'PKR',
    image: typeof image === 'object' ? image.url || '' : image,
    inStock: offer.availability ? !offer.availability.includes('OutOfStock') : true,
    url: item.url || '',
  };
}

// ── 3. Shopify embedded analytics ────────────────────────────────
function extractFromShopifyAnalytics($, baseUrl) {
  const products = [];
  const base = new URL(baseUrl);
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    // Match the collection_viewed event data
    const match = text.match(/collection_viewed[^[]*(\[.*?\])\s*\}\s*\]\s*\)/s)
      || text.match(/"productVariants"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (!match) return;
    try {
      const variants = JSON.parse(match[1]);
      const seen = new Set();
      for (const v of variants) {
        const prod = v.product || v;
        const title = prod.title || '';
        if (!title || seen.has(title)) continue;
        seen.add(title);
        const imgSrc = (v.image?.src || prod.image?.src || '');
        products.push({
          title,
          desc: '',
          price: v.price?.amount || parseFloat(prod.price || 0),
          currency: v.price?.currencyCode || 'PKR',
          image: imgSrc.startsWith('//') ? 'https:' + imgSrc : imgSrc,
          inStock: true,
          url: prod.url ? new URL(prod.url, base.origin).href : '',
        });
      }
    } catch { /* parse error — skip */ }
  });
  return products;
}

// ── 4. HTML pattern matching (fallback) ──────────────────────────
const PRODUCT_SELECTORS = [
  'hdt-card-product', '.hdt-card-product',
  '.product-card', '.product-item', '.product-grid-item',
  '.product', 'li.product',
  '[data-product]', '[data-product-id]',
  '.grid__item .card', '.collection-product',
  '.product-tile', '.product-block',
];

const TITLE_SELECTORS  = ['.hdt-card-product__title', '.product-card__title', '.product-title', '.card__heading', 'h2', 'h3', '.title', '[data-product-title]', '.product-name'];
const PRICE_SELECTORS  = ['.price', '.hdt-price', '.product-price', '.money', '.price__regular', '[data-product-price]', '.amount'];
const IMAGE_SELECTORS  = ['img'];
const LINK_SELECTORS   = ['a[href*="/products/"]', 'a[data-pr-url]', 'a'];

function extractFromHtml($, baseUrl) {
  const products = [];
  let container = null;

  for (const sel of PRODUCT_SELECTORS) {
    const found = $(sel);
    if (found.length >= 2) { container = sel; break; }
  }
  if (!container) return products;

  const base = new URL(baseUrl);
  $(container).each((_, el) => {
    const $el = $(el);
    const title = findText($, $el, TITLE_SELECTORS);
    if (!title) return;

    const priceText = findText($, $el, PRICE_SELECTORS);
    const price = parsePrice(priceText);
    const image = findImage($, $el, IMAGE_SELECTORS);
    const link  = findLink($, $el, LINK_SELECTORS, base.origin);

    products.push({ title, desc: '', price, currency: 'PKR', image, inStock: true, url: link });
  });

  return products;
}

function findText($, $el, selectors) {
  for (const sel of selectors) {
    const text = $el.find(sel).first().text().trim();
    if (text) return text;
  }
  return '';
}

function parsePrice(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[^\d.,]/g, '').replace(/,/g, '');
  return parseFloat(cleaned) || 0;
}

function findImage($, $el, selectors) {
  for (const sel of selectors) {
    const $img = $el.find(sel).first();
    const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-srcset') || $img.attr('srcset');
    if (src) {
      const url = src.split(/[,\s]/)[0];
      return url.startsWith('//') ? 'https:' + url : url;
    }
  }
  return '';
}

function findLink($, $el, selectors, origin) {
  for (const sel of selectors) {
    const href = $el.find(sel).first().attr('href') || $el.attr('href');
    if (href && href !== '#') {
      try { return new URL(href, origin).href; } catch { return href; }
    }
  }
  return '';
}

// ── AI-assisted next-page detection ──────────────────────────────
// Uses Gemini 2.5 Pro to extract the next-page URL from pagination HTML
// when all heuristics fail. Requires GEMINI_API_KEY in environment.
async function aiDetectNextPage(paginationHtml, currentUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !paginationHtml) return null;
  try {
    const prompt =
      'You are a web-scraping assistant. Given pagination HTML and the current page URL, ' +
      'output ONLY the absolute URL of the next page, or the single word null if there is no next page. ' +
      'No explanation, no markdown, just the URL or null.\n\n' +
      `Current URL: ${currentUrl}\n\nPagination HTML:\n${paginationHtml.slice(0, 2500)}\n\nNext page URL:`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 100 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!text || text.toLowerCase() === 'null') return null;
    return new URL(text, currentUrl).href; // normalise to absolute
  } catch (err) {
    console.log(`  [AI pagination] ${err.message}`);
    return null;
  }
}

// ── Heuristic next-page detection ────────────────────────────────
function detectNextPage($, currentUrl, currentPage) {
  const base = new URL(currentUrl);
  const nextPageNum = currentPage + 1;

  // 1. rel="next" — canonical HTML standard
  const relNext = $('a[rel="next"]').first().attr('href');
  if (relNext) {
    try { return new URL(relNext, base.origin).href; } catch { /* bad href */ }
  }

  // 2. Common "Next page" button selectors
  const NEXT_SELECTORS = [
    '.pagination__next a', '.pagination-next a',
    'li.next a', 'li.next--link a',
    'a.next', '.next > a', '.next-page a',
    'a[aria-label="Next page"]', 'a[aria-label="Next"]',
    'a[title="Next"]', 'a[title="next"]',
    '.pager-next a', '.page-next a',
    '.woocommerce-pagination .next',
    'nav[aria-label*="pagination"] a:last-child',
  ];
  for (const sel of NEXT_SELECTORS) {
    const href = $(sel).first().attr('href');
    if (href && href !== '#' && !href.startsWith('javascript')) {
      try { return new URL(href, base.origin).href; } catch { /* bad href */ }
    }
  }

  // 3. Find any link whose href contains a page param equal to nextPageNum
  const allHrefs = $('a[href]').toArray().map(el => $(el).attr('href') || '');
  for (const href of allHrefs) {
    if (!href || href === '#' || href.startsWith('javascript')) continue;
    const m = href.match(/[?&](page|p|paged)=(\d+)/) || href.match(/\/page\/(\d+)/);
    if (m && parseInt(m[m.length - 1]) === nextPageNum) {
      try { return new URL(href, base.origin).href; } catch { /* bad href */ }
    }
  }

  // 4. Auto-construct: increment an existing page param in the current URL
  for (const param of ['page', 'p', 'paged']) {
    const val = base.searchParams.get(param);
    if (val && parseInt(val) === currentPage) {
      const next = new URL(currentUrl);
      next.searchParams.set(param, nextPageNum);
      return next.href;
    }
  }

  // 5. Path-based: /page/N → /page/N+1
  const pathMatch = base.pathname.match(/\/page\/(\d+)(\/?)$/);
  if (pathMatch && parseInt(pathMatch[1]) === currentPage) {
    const next = new URL(currentUrl);
    next.pathname = base.pathname.replace(/\/page\/\d+(\/?)$/, `/page/${nextPageNum}$1`);
    return next.href;
  }

  return null;
}

// ── Extract pagination HTML for AI analysis ───────────────────────
function extractPaginationHtml($) {
  const SELECTORS = [
    'nav[aria-label*="agination"]',
    '.pagination', '#pagination',
    '[class*="pagination"]', '[class*="pager"]',
    '.page-numbers', 'ul.pages', '.wp-pagenavi',
  ];
  for (const sel of SELECTORS) {
    const $el = $(sel).first();
    if ($el.length) return $.html($el).slice(0, 2500);
  }
  return null;
}

// ── Multi-page HTML fetch orchestrator ────────────────────────────
// Fetches all pages of a product listing, using heuristic + AI
// pagination detection to traverse next-page links.
async function fetchAllPages(startUrl) {
  const allProducts = [];
  const seenKeys = new Set();   // dedup by sourceUrl, fall back to title
  const seenPageUrls = new Set();
  let currentUrl = startUrl;
  let page = 1;

  while (currentUrl && page <= MAX_PAGES) {
    if (seenPageUrls.has(currentUrl)) break;
    seenPageUrls.add(currentUrl);

    let $, paginationHtml;
    try {
      const res = await fetchUrl(currentUrl);
      const html = await res.text();
      $ = cheerio.load(html);
      paginationHtml = extractPaginationHtml($);
    } catch (err) {
      console.log(`  [pagination] Page ${page} error: ${err.message}`);
      break;
    }

    // Try all HTML-based extraction strategies in order
    let products = extractFromJsonLd($);
    if (!products.length) products = extractFromShopifyAnalytics($, currentUrl);
    if (!products.length) products = extractFromHtml($, currentUrl);

    if (!products.length) {
      console.log(`  [pagination] Page ${page}: 0 products — stopping`);
      break;
    }

    // Deduplicate across pages
    const fresh = products.filter(p => {
      if (!p.title) return false;
      const key = (p.url || p.title).toLowerCase();
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    if (fresh.length === 0 && page > 1) {
      console.log(`  [pagination] Page ${page}: all duplicates — stopping`);
      break;
    }

    allProducts.push(...fresh);
    console.log(`  [pagination] Page ${page}: ${fresh.length} new products (total: ${allProducts.length})`);

    // Detect next page: heuristics first, then AI fallback
    let nextUrl = detectNextPage($, currentUrl, page);
    if (!nextUrl) {
      nextUrl = await aiDetectNextPage(paginationHtml, currentUrl);
      if (nextUrl) console.log(`  [pagination] AI found next page: ${nextUrl}`);
    }

    // --- SFCC Custom Pagination Injection ---
    if (!nextUrl) {
      const totalEl = $('[data-total], .total-count, [data-total-count], .results-count, .result-count, .search-result-count');
      if (totalEl.length) {
        let totalCountText = totalEl.attr('data-total') || totalEl.attr('data-total-count') || totalEl.text() || '';
        const totalCount = parseInt(totalCountText.replace(/\D/g, ''), 10);
        if (!isNaN(totalCount) && totalCount > allProducts.length && fresh.length > 0) {
          try {
            const u = new URL(startUrl);
            u.searchParams.set('sz', '500');
            u.searchParams.set('start', allProducts.length.toString());
            nextUrl = u.toString();
            console.log(`  [pagination] SFCC/Custom detected. Total: ${totalCount}. Next start: ${allProducts.length}`);
          } catch (e) {
            // URL parse error, ignore
          }
        }
      }
    }
    // ----------------------------------------

    if (!nextUrl) break;
    currentUrl = nextUrl;
    page++;
    await new Promise(r => setTimeout(r, 300)); // polite delay
  }

  console.log(`  [pagination] Done: ${allProducts.length} products across ${page} page(s)`);
  return allProducts;
}

// ── Main entry point ─────────────────────────────────────────────
async function scrapeProducts(url) {
  console.log(`  [scraper] Starting scrape for: ${url}`);

  // 1. Try Shopify JSON API first (already handles its own pagination)
  let products = await tryShopifyJson(url);
  if (products.length > 0) {
    console.log(`  [scraper] Returning ${products.length} from Shopify JSON API`);
    return products;
  }

  // 2. Fall back to multi-page HTML fetch (JSON-LD / analytics / HTML selectors)
  console.log(`  [scraper] Shopify API returned 0, falling back to paginated HTML fetch...`);
  products = await fetchAllPages(url);
  console.log(`  [scraper] Total: ${products.length} products from HTML strategies`);
  return products;
}

module.exports = { scrapeProducts };
