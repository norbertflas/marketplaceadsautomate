/**
 * API Interceptor
 * Intercepts XHR/fetch calls made by the Allegro Ads panel to extract
 * session tokens and campaign data without requiring official API access.
 */

let sessionToken = null;
let campaignCache = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

// ── Setup Interceptor ─────────────────────────────────────────────────────

export function setupApiInterceptor() {
  interceptXHR();
  interceptFetch();
}

function interceptXHR() {
  const OriginalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open.bind(xhr);
    const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);

    let requestUrl = '';

    xhr.open = function (method, url, ...args) {
      requestUrl = url;
      return originalOpen(method, url, ...args);
    };

    xhr.setRequestHeader = function (header, value) {
      // Capture authorization tokens from outgoing requests
      if (header.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
        sessionToken = value.replace('Bearer ', '');
      }
      return originalSetRequestHeader(header, value);
    };

    xhr.addEventListener('load', function () {
      try {
        if (requestUrl.includes('/ads/campaigns') || requestUrl.includes('/sponsored-offers')) {
          const data = JSON.parse(xhr.responseText);
          processCampaignResponse(data, requestUrl);
        }
      } catch {
        // Non-JSON response, skip
      }
    });

    return xhr;
  };
}

function interceptFetch() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;

    // Capture auth token from fetch requests
    const authHeader = init.headers?.Authorization || init.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      sessionToken = authHeader.replace('Bearer ', '');
    }

    const response = await originalFetch(input, init);

    // Clone to allow reading body without consuming it
    if (url?.includes('/ads/') || url?.includes('/sponsored-offers')) {
      try {
        const cloned = response.clone();
        const data = await cloned.json();
        processCampaignResponse(data, url);
      } catch {
        // Ignore parse errors
      }
    }

    return response;
  };
}

function processCampaignResponse(data, url) {
  if (Array.isArray(data)) {
    updateCampaignCache(data);
  } else if (data?.campaigns) {
    updateCampaignCache(data.campaigns);
  } else if (data?.items) {
    updateCampaignCache(data.items);
  }
}

function updateCampaignCache(campaigns) {
  if (!Array.isArray(campaigns) || !campaigns.length) return;

  const normalized = campaigns
    .filter(c => c.id || c.campaignId)
    .map(c => ({
      id: c.id || c.campaignId,
      name: c.name || c.campaignName || 'Bez nazwy',
      status: c.status || 'UNKNOWN',
      cpc: c.bid?.amount || c.cpc || c.maxCpc || 0,
      dailyBudget: c.budget?.daily?.amount || c.dailyBudget || 0,
      monthlyBudget: c.budget?.monthly?.amount || c.monthlyBudget || null,
      type: c.type || 'SPONSORED_OFFERS',
      stats: c.stats || null,
    }));

  // Merge with existing cache (deduplicate by id)
  const existing = new Map(campaignCache.map(c => [c.id, c]));
  for (const c of normalized) {
    existing.set(c.id, { ...existing.get(c.id), ...c });
  }

  campaignCache = [...existing.values()];
  lastFetchTime = Date.now();
}

// ── Public API ────────────────────────────────────────────────────────────

export async function fetchCampaigns() {
  const cacheAge = Date.now() - lastFetchTime;
  if (cacheAge < CACHE_TTL_MS && campaignCache.length > 0) {
    return { success: true, campaigns: campaignCache, cached: true };
  }

  // Trigger panel to load campaigns by navigating or using session token
  if (sessionToken) {
    try {
      const campaigns = await fetchCampaignsFromApi();
      return { success: true, campaigns };
    } catch (err) {
      if (campaignCache.length > 0) {
        return { success: true, campaigns: campaignCache, cached: true, warning: err.message };
      }
      return { success: false, error: err.message, hint: 'Open Allegro Ads campaigns list first' };
    }
  }

  if (campaignCache.length > 0) {
    return { success: true, campaigns: campaignCache, cached: true };
  }

  return {
    success: false,
    error: 'No campaign data available',
    hint: 'Navigate to the campaigns list in Allegro Ads panel first',
  };
}

async function fetchCampaignsFromApi() {
  if (!sessionToken) throw new Error('No session token available');

  // Allegro Ads internal API endpoints discovered via network inspection
  const endpoints = [
    'https://edge.salescenter.allegro.com/ads/v1/campaigns?limit=200',
    'https://salescenter.allegro.com/api/v1/ads/campaigns?limit=200',
  ];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (resp.ok) {
        const data = await resp.json();
        const campaigns = data?.campaigns || data?.items || (Array.isArray(data) ? data : []);
        updateCampaignCache(campaigns);
        return campaignCache;
      }
    } catch {
      continue;
    }
  }

  throw new Error('Could not fetch campaigns from API');
}

export async function updateCampaignCpc(campaignId, newCpcGr) {
  if (!sessionToken) throw new Error('No session token – please navigate Allegro Ads panel first');
  if (!campaignId) throw new Error('Invalid campaign ID');

  // Try multiple endpoint formats used by Allegro Ads panel
  const endpoints = [
    {
      url: `https://edge.salescenter.allegro.com/ads/v1/campaigns/${campaignId}`,
      body: { bid: { amount: newCpcGr, currency: 'PLN' } },
      method: 'PATCH',
    },
    {
      url: `https://salescenter.allegro.com/api/v1/ads/campaigns/${campaignId}`,
      body: { bid: { amount: newCpcGr } },
      method: 'PATCH',
    },
  ];

  let lastError;
  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(endpoint.body),
      });

      if (resp.ok || resp.status === 204) {
        // Update local cache
        const idx = campaignCache.findIndex(c => c.id === campaignId);
        if (idx >= 0) campaignCache[idx] = { ...campaignCache[idx], cpc: newCpcGr };
        return { success: true };
      }

      const errorData = await resp.json().catch(() => ({}));
      lastError = new Error(errorData?.message || `HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to update CPC');
}

export async function updateCampaignBudget(campaignId, newBudgetGr) {
  if (!sessionToken) throw new Error('No session token');

  const resp = await fetch(
    `https://edge.salescenter.allegro.com/ads/v1/campaigns/${campaignId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ budget: { daily: { amount: newBudgetGr, currency: 'PLN' } } }),
    }
  );

  if (!resp.ok && resp.status !== 204) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.message || `HTTP ${resp.status}`);
  }

  // Update local cache
  const idx = campaignCache.findIndex(c => c.id === campaignId);
  if (idx >= 0) campaignCache[idx] = { ...campaignCache[idx], dailyBudget: newBudgetGr };

  return { success: true };
}

export function getSessionToken() {
  return sessionToken;
}

export function getCampaignCache() {
  return [...campaignCache];
}
