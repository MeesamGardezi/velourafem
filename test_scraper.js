const cheerio = require('cheerio');
const html = `
<div class="result-count text-center col-12 col-md-9 col-sm-6 order-sm-2">
  1928 Products
</div>`;
const $ = cheerio.load(html);
const totalEl = $('[data-total], .total-count, [data-total-count], .results-count, .result-count, .search-result-count');
console.log('length:', totalEl.length);
let totalCountText = totalEl.attr('data-total') || totalEl.attr('data-total-count') || totalEl.text() || '';
console.log('text:', totalCountText);
const totalCount = parseInt(totalCountText.replace(/\D/g, ''), 10);
console.log('totalCount:', totalCount);
