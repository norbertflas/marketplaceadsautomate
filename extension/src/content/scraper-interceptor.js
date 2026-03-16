/**
 * Scraper Interceptor – intercepts Allegro API calls to capture product/listing data
 * Works on allegro.pl pages by hooking into XHR/fetch requests that Allegro makes
 * to load product details, search results, and seller offers.
 */

let allegroToken = null;
const productCache = new Map(); // offerId -> product data
const listingCache = new Map(); // search query -> listing results
const PRODUCT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Allegro internal API patterns for product/listing data
const API_PATTERNS = {
  // Product detail pages
  productDetail: /\/sale\/offers\/(\d+)/,
  offerDetail: /\/offer\/([a-zA-Z0-9-]+)/,
  // Listing / search results
  listing: /\/listing\?/,
  searchResults: /\/search\/offers/,
  // Seller offers
  sellerOffers: /\/users?\/.+\/offers/,
  sellerInfo: /\/users?\/.+\/ratings/,
  // Price/availability
  offerVariants: /\/offers\/(\d+)\/variants/,
  offerDelivery: /\/offers\/(\d+)\/delivery/,
};

// ── Setup ────────────────────────────────────────────────────────────────

export function setupScraperInterceptor() {
  interceptScraperXHR();
  interceptScraperFetch();
  scrapeCurrentPage();
}

function interceptScraperXHR() {
  const OriginalXHR = window.XMLHttpRequest;

  const origOpen = OriginalXHR.prototype.open;
  const origSetHeader = OriginalXHR.prototype.setRequestHeader;

  // Avoid double-patching
  if (OriginalXHR.__scraperPatched) return;
  OriginalXHR.__scraperPatched = true;

  OriginalXHR.prototype.open = function (method, url, ...args) {
    this._scraperUrl = url;
    this._scraperMethod = method;
    return origOpen.call(this, method, url, ...args);
  };

  OriginalXHR.prototype.setRequestHeader = function (header, value) {
    if (header.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
      allegroToken = value.replace('Bearer ', '');
    }
    return origSetHeader.call(this, header, value);
  };

  const origAddEventListener = OriginalXHR.prototype.addEventListener;
  // Patch addEventListener is too invasive, use load event on instances
  const origSend = OriginalXHR.prototype.send;
  OriginalXHR.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        processScraperResponse(this._scraperUrl, this.responseText);
      } catch {
        // ignore
      }
    });
    return origSend.apply(this, args);
  };
}

function interceptScraperFetch() {
  // Check if already patched by the ads interceptor - we add our own layer
  const currentFetch = window.fetch;
  if (currentFetch.__scraperPatched) return;

  const patchedFetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;

    // Capture token
    const headers = init.headers || {};
    const authHeader = headers.Authorization || headers.authorization ||
      (headers instanceof Headers ? headers.get('authorization') : null);
    if (authHeader?.startsWith('Bearer ')) {
      allegroToken = authHeader.replace('Bearer ', '');
    }

    const response = await currentFetch(input, init);

    // Check if this is a relevant API call
    if (url && isRelevantUrl(url)) {
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        processScraperResponse(url, text);
      } catch {
        // ignore
      }
    }

    return response;
  };

  patchedFetch.__scraperPatched = true;
  window.fetch = patchedFetch;
}

function isRelevantUrl(url) {
  return Object.values(API_PATTERNS).some(pattern => pattern.test(url)) ||
    url.includes('/api/') ||
    url.includes('edge.allegro.') ||
    url.includes('a]llegro.pl/api');
}

function processScraperResponse(url, responseText) {
  if (!responseText) return;

  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    return; // not JSON
  }

  // Product/offer detail
  if (data?.id && (data?.name || data?.title) && data?.sellingMode) {
    processProductData(data);
  }

  // Search/listing results
  if (data?.items?.promoted || data?.items?.regular || data?.offers) {
    processListingData(data, url);
  }

  // Seller offers list
  if (Array.isArray(data?.offers)) {
    data.offers.forEach(offer => {
      if (offer?.id && (offer?.name || offer?.title)) {
        processProductData(offer);
      }
    });
  }
}

function processProductData(data) {
  const product = normalizeProduct(data);
  if (!product) return;

  const existing = productCache.get(product.offerId);
  productCache.set(product.offerId, {
    ...product,
    fetchedAt: Date.now(),
    previousSnapshot: existing || null,
  });

  // Notify background script about captured product
  chrome.runtime.sendMessage({
    type: 'SCRAPER_PRODUCT_CAPTURED',
    product,
  }).catch(() => {}); // ignore if background not ready
}

function processListingData(data, url) {
  const items = [];

  // Allegro returns promoted and regular items
  if (data?.items?.promoted) {
    data.items.promoted.forEach(item => {
      const p = normalizeListingItem(item);
      if (p) items.push({ ...p, promoted: true });
    });
  }
  if (data?.items?.regular) {
    data.items.regular.forEach(item => {
      const p = normalizeListingItem(item);
      if (p) items.push(p);
    });
  }
  if (data?.offers) {
    data.offers.forEach(item => {
      const p = normalizeListingItem(item);
      if (p) items.push(p);
    });
  }

  if (items.length > 0) {
    const cacheKey = extractSearchQuery(url);
    listingCache.set(cacheKey, {
      items,
      totalCount: data?.searchMeta?.totalCount || data?.totalCount || items.length,
      fetchedAt: Date.now(),
    });

    chrome.runtime.sendMessage({
      type: 'SCRAPER_LISTING_CAPTURED',
      query: cacheKey,
      itemCount: items.length,
      items: items.slice(0, 50), // limit to prevent oversized messages
    }).catch(() => {});
  }
}

// ── DOM Scraping (fallback when API interception doesn't capture) ─────

function scrapeCurrentPage() {
  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(doPageScrape, 2000));
  } else {
    setTimeout(doPageScrape, 2000);
  }
}

function doPageScrape() {
  const url = window.location.href;

  // Product page: allegro.pl/oferta/...
  if (url.includes('/oferta/') || url.includes('/offer/')) {
    scrapeProductPage();
  }

  // Listing page: allegro.pl/listing?...
  if (url.includes('/listing') || url.includes('/kategoria/')) {
    scrapeListingPage();
  }

  // Seller page: allegro.pl/uzytkownik/...
  if (url.includes('/uzytkownik/') || url.includes('/user/')) {
    scrapeSellerPage();
  }
}

function scrapeProductPage() {
  try {
    // Try to extract data from ld+json structured data
    const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldJsonScripts) {
      try {
        const ld = JSON.parse(script.textContent);
        if (ld['@type'] === 'Product' || ld['@type'] === 'IndividualProduct') {
          const product = {
            offerId: extractOfferIdFromUrl(window.location.href),
            title: ld.name,
            price: parseFloat(ld.offers?.price || ld.offers?.lowPrice) || null,
            currency: ld.offers?.priceCurrency || 'PLN',
            availability: ld.offers?.availability?.includes('InStock') ? 'available' : 'unavailable',
            seller: ld.offers?.seller?.name || null,
            imageUrl: ld.image?.[0] || ld.image || null,
            description: ld.description?.substring(0, 500) || null,
            rating: parseFloat(ld.aggregateRating?.ratingValue) || null,
            reviewCount: parseInt(ld.aggregateRating?.reviewCount) || 0,
            source: 'dom_scrape',
            fetchedAt: Date.now(),
            url: window.location.href,
          };

          if (product.offerId && product.title) {
            productCache.set(product.offerId, product);
            chrome.runtime.sendMessage({
              type: 'SCRAPER_PRODUCT_CAPTURED',
              product,
            }).catch(() => {});
          }
          return;
        }
      } catch {
        continue;
      }
    }

    // Fallback: scrape from DOM elements
    const title = document.querySelector('[data-box-name="summary"] h1, h1[class*="title"]')?.textContent?.trim();
    const priceEl = document.querySelector('[aria-label*="cena"], [data-testid="price"]');
    const price = priceEl ? parseFloat(priceEl.textContent.replace(/[^\d,.]/g, '').replace(',', '.')) : null;

    if (title) {
      const product = {
        offerId: extractOfferIdFromUrl(window.location.href),
        title,
        price,
        currency: 'PLN',
        source: 'dom_scrape',
        fetchedAt: Date.now(),
        url: window.location.href,
      };

      productCache.set(product.offerId, product);
      chrome.runtime.sendMessage({
        type: 'SCRAPER_PRODUCT_CAPTURED',
        product,
      }).catch(() => {});
    }
  } catch {
    // DOM scraping failed silently
  }
}

function scrapeListingPage() {
  try {
    const items = [];
    const articleEls = document.querySelectorAll('article[data-analytics-view-label], [data-box-name="items-v3"] article');

    for (const el of articleEls) {
      try {
        const linkEl = el.querySelector('a[href*="/oferta/"]');
        const titleEl = el.querySelector('h2, [class*="title"]');
        const priceEl = el.querySelector('[aria-label*="cena"], span[class*="price"]');

        if (!titleEl) continue;

        const href = linkEl?.href || '';
        items.push({
          offerId: extractOfferIdFromUrl(href),
          title: titleEl.textContent?.trim(),
          price: priceEl ? parseFloat(priceEl.textContent.replace(/[^\d,.]/g, '').replace(',', '.')) : null,
          currency: 'PLN',
          url: href,
          source: 'dom_scrape',
        });
      } catch {
        continue;
      }
    }

    if (items.length > 0) {
      const query = new URLSearchParams(window.location.search).get('string') || 'listing';
      chrome.runtime.sendMessage({
        type: 'SCRAPER_LISTING_CAPTURED',
        query,
        itemCount: items.length,
        items,
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

function scrapeSellerPage() {
  try {
    const sellerName = document.querySelector('[data-box-name="sellerHeader"] h1, [class*="seller-name"]')?.textContent?.trim();
    if (sellerName) {
      chrome.runtime.sendMessage({
        type: 'SCRAPER_SELLER_CAPTURED',
        seller: {
          name: sellerName,
          url: window.location.href,
          fetchedAt: Date.now(),
        },
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

// ── Active Scraping (fetch specific offer data using captured token) ──

export async function fetchOfferDetails(offerId) {
  if (!allegroToken) {
    // Try to get token from background
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_ALLEGRO_TOKEN' });
      if (resp?.token) allegroToken = resp.token;
    } catch {}
  }

  // Check cache first
  const cached = productCache.get(offerId);
  if (cached && (Date.now() - cached.fetchedAt) < PRODUCT_CACHE_TTL) {
    return { success: true, product: cached, cached: true };
  }

  // Allegro internal API endpoints for offer details
  const endpoints = [
    `https://edge.allegro.pl/sale/offers/${offerId}`,
    `https://allegro.pl/api/sale/offers/${offerId}`,
  ];

  for (const url of endpoints) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (allegroToken) headers.Authorization = `Bearer ${allegroToken}`;

      const resp = await fetch(url, { headers, credentials: 'include' });

      if (resp.ok) {
        const data = await resp.json();
        const product = normalizeProduct(data);
        if (product) {
          productCache.set(offerId, { ...product, fetchedAt: Date.now() });
          return { success: true, product };
        }
      }
    } catch {
      continue;
    }
  }

  // Return cached data if available even if stale
  if (cached) {
    return { success: true, product: cached, cached: true, stale: true };
  }

  return { success: false, error: 'Could not fetch offer details' };
}

export async function fetchSellerOffers(sellerId, limit = 60) {
  const endpoints = [
    `https://edge.allegro.pl/users/${sellerId}/offers?limit=${limit}`,
    `https://allegro.pl/api/users/${sellerId}/offers?limit=${limit}`,
  ];

  for (const url of endpoints) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (allegroToken) headers.Authorization = `Bearer ${allegroToken}`;

      const resp = await fetch(url, { headers, credentials: 'include' });

      if (resp.ok) {
        const data = await resp.json();
        const offers = (data?.offers || data?.items || [])
          .map(normalizeListingItem)
          .filter(Boolean);
        return { success: true, offers };
      }
    } catch {
      continue;
    }
  }

  return { success: false, error: 'Could not fetch seller offers' };
}

export async function searchOffers(query, params = {}) {
  const searchParams = new URLSearchParams({
    phrase: query,
    limit: params.limit || 60,
    offset: params.offset || 0,
    sort: params.sort || '-relevance',
    ...params.filters,
  });

  const endpoints = [
    `https://edge.allegro.pl/offers/listing?${searchParams}`,
    `https://allegro.pl/api/offers/listing?${searchParams}`,
  ];

  for (const url of endpoints) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (allegroToken) headers.Authorization = `Bearer ${allegroToken}`;

      const resp = await fetch(url, { headers, credentials: 'include' });

      if (resp.ok) {
        const data = await resp.json();
        const items = [];

        if (data?.items?.promoted) {
          data.items.promoted.forEach(i => {
            const p = normalizeListingItem(i);
            if (p) items.push({ ...p, promoted: true });
          });
        }
        if (data?.items?.regular) {
          data.items.regular.forEach(i => {
            const p = normalizeListingItem(i);
            if (p) items.push(p);
          });
        }

        return {
          success: true,
          items,
          totalCount: data?.searchMeta?.totalCount || items.length,
        };
      }
    } catch {
      continue;
    }
  }

  return { success: false, error: 'Could not search offers' };
}

// ── Normalization ────────────────────────────────────────────────────────

function normalizeProduct(data) {
  if (!data) return null;

  const id = String(data.id || data.offerId || '');
  if (!id) return null;

  return {
    offerId: id,
    title: data.name || data.title || '',
    price: extractPrice(data),
    originalPrice: extractOriginalPrice(data),
    currency: data.sellingMode?.price?.currency || data.price?.currency || 'PLN',
    quantity: data.stock?.available ?? data.quantity ?? null,
    soldCount: data.stock?.sold ?? data.soldCount ?? null,
    availability: data.publication?.status || data.status || 'unknown',
    seller: {
      id: data.seller?.id || null,
      login: data.seller?.login || data.seller?.name || null,
      rating: data.seller?.rating || null,
      isSuperSeller: data.seller?.superSeller || false,
    },
    category: {
      id: data.category?.id || null,
      name: data.category?.name || null,
      path: data.category?.path || null,
    },
    imageUrl: data.images?.[0]?.url || data.primaryImage?.url || null,
    images: (data.images || []).map(img => img?.url || img).filter(Boolean),
    description: data.description?.sections?.[0]?.items?.[0]?.content?.substring(0, 500) || null,
    parameters: (data.parameters || []).map(p => ({
      name: p.name,
      values: p.values || [p.value],
    })),
    delivery: {
      lowestPrice: data.delivery?.lowestPrice?.amount || null,
      freeShipping: data.delivery?.lowestPrice?.amount === 0 || data.delivery?.free || false,
    },
    rating: {
      score: data.rating?.average || null,
      count: data.rating?.count || 0,
    },
    url: data.url || `https://allegro.pl/oferta/${id}`,
    source: 'api_intercept',
    fetchedAt: Date.now(),
  };
}

function normalizeListingItem(item) {
  if (!item) return null;

  const id = String(item.id || item.offerId || '');
  if (!id) return null;

  return {
    offerId: id,
    title: item.name || item.title || '',
    price: extractPrice(item),
    originalPrice: extractOriginalPrice(item),
    currency: item.sellingMode?.price?.currency || 'PLN',
    quantity: item.stock?.available ?? null,
    seller: {
      id: item.seller?.id || null,
      login: item.seller?.login || item.seller?.name || null,
      isSuperSeller: item.seller?.superSeller || false,
    },
    imageUrl: item.images?.[0]?.url || item.primaryImage?.url || null,
    delivery: {
      lowestPrice: item.delivery?.lowestPrice?.amount || null,
      freeShipping: item.delivery?.lowestPrice?.amount === 0 || item.delivery?.free || false,
    },
    url: item.url || `https://allegro.pl/oferta/${id}`,
    promoted: false,
  };
}

function extractPrice(data) {
  return parseFloat(
    data.sellingMode?.price?.amount ||
    data.sellingMode?.buyNowPrice?.amount ||
    data.price?.amount ||
    data.buyNowPrice?.amount ||
    0
  );
}

function extractOriginalPrice(data) {
  const original = parseFloat(
    data.sellingMode?.originalPrice?.amount ||
    data.originalPrice?.amount ||
    0
  );
  return original > 0 ? original : null;
}

function extractOfferIdFromUrl(url) {
  // allegro.pl/oferta/product-name-12345678
  const match = url.match(/[-/](\d{7,})(?:\?|$|#)/);
  return match ? match[1] : url.split('/').pop()?.split('?')[0] || '';
}

function extractSearchQuery(url) {
  try {
    const u = new URL(url, 'https://allegro.pl');
    return u.searchParams.get('phrase') || u.searchParams.get('string') || 'search';
  } catch {
    return 'search';
  }
}

// ── Public getters ────────────────────────────────────────────────────────

export function getProductCache() {
  return new Map(productCache);
}

export function getListingCache() {
  return new Map(listingCache);
}

export function getAllegroToken() {
  return allegroToken;
}
