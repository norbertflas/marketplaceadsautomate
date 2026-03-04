// Allegro Ads Automate – Content Script (standalone, no build required)
(function () {
  'use strict';

  if (window.__aaa_loaded) return;
  window.__aaa_loaded = true;

  // ── Session & cache ──────────────────────────────────────────────────────
  let sessionToken = null;
  let campaignCache = [];
  let lastFetchTime = 0;
  const CACHE_TTL = 30000;

  // ── API Interceptor ───────────────────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OrigXHR();
    const origOpen = xhr.open.bind(xhr);
    const origSetHeader = xhr.setRequestHeader.bind(xhr);
    let url = '';

    xhr.open = function (m, u, ...a) { url = u; return origOpen(m, u, ...a); };

    xhr.setRequestHeader = function (h, v) {
      if (h.toLowerCase() === 'authorization' && v.startsWith('Bearer ')) {
        sessionToken = v.slice(7);
      }
      return origSetHeader(h, v);
    };

    xhr.addEventListener('load', function () {
      if (url.includes('/ads/') || url.includes('/sponsored-offers')) {
        try { processCampaignResponse(JSON.parse(xhr.responseText)); } catch {}
      }
    });
    return xhr;
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const authHeader = (init.headers || {}).Authorization || (init.headers || {}).authorization || '';
    if (authHeader.startsWith('Bearer ')) sessionToken = authHeader.slice(7);

    const resp = await origFetch(input, init);
    if (url.includes('/ads/') || url.includes('/sponsored-offers')) {
      try { processCampaignResponse(await resp.clone().json()); } catch {}
    }
    return resp;
  };

  function processCampaignResponse(data) {
    const items = data?.campaigns || data?.items || (Array.isArray(data) ? data : null);
    if (!items?.length) return;
    const map = new Map(campaignCache.map(c => [c.id, c]));
    for (const c of items) {
      if (!c.id && !c.campaignId) continue;
      const id = c.id || c.campaignId;
      map.set(id, {
        id,
        name: c.name || c.campaignName || 'Bez nazwy',
        status: c.status || 'UNKNOWN',
        cpc: c.bid?.amount || c.cpc || c.maxCpc || 0,
        dailyBudget: c.budget?.daily?.amount || c.dailyBudget || 0,
        type: c.type || 'SPONSORED_OFFERS',
        ...map.get(id),
        id, name: c.name || c.campaignName || map.get(id)?.name || 'Bez nazwy',
        status: c.status || map.get(id)?.status || 'UNKNOWN',
      });
    }
    campaignCache = [...map.values()];
    lastFetchTime = Date.now();
  }

  // ── Campaign API calls ────────────────────────────────────────────────────
  async function getCampaigns() {
    if (Date.now() - lastFetchTime < CACHE_TTL && campaignCache.length) {
      return { success: true, campaigns: campaignCache, cached: true };
    }
    if (!campaignCache.length) {
      return { success: false, error: 'Otwórz listę kampanii w panelu Allegro Ads', hint: true };
    }
    return { success: true, campaigns: campaignCache, cached: true };
  }

  async function updateCpc(campaignId, newCpcGr) {
    if (!sessionToken) throw new Error('Brak tokenu sesji – przejdź przez panel kampanii');
    const urls = [
      `https://edge.salescenter.allegro.com/ads/v1/campaigns/${campaignId}`,
      `https://salescenter.allegro.com/api/v1/ads/campaigns/${campaignId}`,
    ];
    let lastErr;
    for (const url of urls) {
      try {
        const r = await origFetch(url, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ bid: { amount: newCpcGr, currency: 'PLN' } }),
        });
        if (r.ok || r.status === 204) {
          const idx = campaignCache.findIndex(c => c.id === campaignId);
          if (idx >= 0) campaignCache[idx] = { ...campaignCache[idx], cpc: newCpcGr };
          return { success: true };
        }
        const e = await r.json().catch(() => ({}));
        lastErr = new Error(e.message || `HTTP ${r.status}`);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Nie można zaktualizować CPC');
  }

  function calcNewCpc(oldCpc, type, value) {
    switch (type) {
      case 'increase_pct': return Math.round(oldCpc * (1 + value / 100));
      case 'decrease_pct': return Math.max(1, Math.round(oldCpc * (1 - value / 100)));
      case 'set':          return Math.max(1, Math.round(value));
      case 'increase_abs': return Math.round(oldCpc + value);
      case 'decrease_abs': return Math.max(1, Math.round(oldCpc - value));
      default:             return oldCpc;
    }
  }

  async function globalCpcChange({ type, value, filters, dryRun }) {
    const { success, campaigns, error } = await getCampaigns();
    if (!success) return { success: false, error };

    let filtered = campaigns;
    if (filters?.status) {
      filtered = campaigns.filter(c => c.status === filters.status);
    }

    const preview = filtered.map(c => ({
      id: c.id,
      name: c.name,
      oldCpc: c.cpc,
      newCpc: calcNewCpc(c.cpc, type, value),
    }));

    if (dryRun) return { success: true, preview, affectedCampaigns: filtered.length };

    let ok = 0, failed = 0, errors = [];
    showProgress('Aktualizacja CPC…', filtered.length, 0);

    for (let i = 0; i < filtered.length; i++) {
      const c = filtered[i];
      const newCpc = calcNewCpc(c.cpc, type, value);
      showProgress(`Aktualizacja CPC: ${c.name}`, filtered.length, i + 1);
      try {
        await updateCpc(c.id, newCpc);

        // Log to background
        chrome.runtime.sendMessage({
          type: 'LOG_CHANGE',
          entry: {
            type: 'cpc_change',
            campaignId: c.id,
            campaignName: c.name,
            previousValue: c.cpc,
            newValue: newCpc,
            source: 'manual',
          },
        });
        ok++;
      } catch (e) {
        failed++;
        errors.push(`${c.name}: ${e.message}`);
      }
      await sleep(150); // respect rate limits
    }

    hideProgress();
    if (ok > 0) showToast(`Zaktualizowano ${ok} kampanii${failed ? ` (${failed} błędów)` : ''}`, ok > 0 && failed === 0 ? 'success' : 'warning');

    return { success: true, affectedCampaigns: ok, failed, errors };
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  const TOAST_ID = 'aaa-toasts';
  const PROGRESS_ID = 'aaa-progress';

  function injectBaseUI() {
    if (document.getElementById(TOAST_ID)) return;

    const toasts = el('div', { id: TOAST_ID, style: 'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none' });
    document.body.appendChild(toasts);

    const progress = el('div', {
      id: PROGRESS_ID,
      style: 'position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#1e293b;padding:8px 20px;display:none;align-items:center;gap:12px;font-family:system-ui;font-size:13px;color:#e2e8f0',
    }, `<span id="aaa-p-label" style="flex:1"></span>
        <div style="flex:2;height:6px;background:#334155;border-radius:3px;overflow:hidden">
          <div id="aaa-p-fill" style="height:100%;background:#f97316;transition:width .2s;width:0%"></div>
        </div>
        <span id="aaa-p-count" style="font-size:11px;color:#94a3b8"></span>`);
    document.body.appendChild(progress);
  }

  function showToast(msg, type = 'info', duration = 4000) {
    const c = document.getElementById(TOAST_ID);
    if (!c) return;
    const colors = { success: '#16a34a', error: '#dc2626', warning: '#d97706', info: '#2563eb' };
    const icons  = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const t = el('div', {
      style: `display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:8px;font-family:system-ui;font-size:14px;color:#fff;background:${colors[type]||colors.info};box-shadow:0 4px 16px rgba(0,0,0,.2);min-width:260px;max-width:400px;pointer-events:auto;opacity:0;transform:translateX(20px);transition:opacity .25s,transform .25s`,
    }, `<span>${icons[type]||icons.info}</span><span>${esc(msg)}</span>`);
    c.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(0)'; });
    setTimeout(() => {
      t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  function showProgress(label, total, current) {
    const p = document.getElementById(PROGRESS_ID);
    if (!p) return;
    p.style.display = 'flex';
    document.getElementById('aaa-p-label').textContent = label;
    document.getElementById('aaa-p-fill').style.width = total > 0 ? `${(current/total)*100}%` : '0%';
    document.getElementById('aaa-p-count').textContent = total > 0 ? `${current} / ${total}` : '';
  }

  function hideProgress() {
    const p = document.getElementById(PROGRESS_ID);
    if (p) p.style.display = 'none';
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMsg(msg).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  });

  async function handleMsg(msg) {
    switch (msg.type) {
      case 'GET_CAMPAIGNS':
        return getCampaigns();
      case 'GLOBAL_CPC_CHANGE':
        return globalCpcChange(msg.params);
      case 'UNDO_CAMPAIGN_CHANGE':
        return undoCampaignChange(msg.entry);
      case 'PING':
        return { success: true };
      default:
        return { success: false, error: `Unknown: ${msg.type}` };
    }
  }

  async function undoCampaignChange(entry) {
    if (entry.type === 'cpc_change' && entry.campaignId && entry.previousValue !== undefined) {
      await updateCpc(entry.campaignId, entry.previousValue);
      showToast(`Cofnięto zmianę CPC: ${entry.campaignName}`, 'success');
      return { success: true };
    }
    return { success: false, error: 'Nie można cofnąć tego typu zmiany' };
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function el(tag, attrs = {}, html = '') {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Apply dark mode from settings ─────────────────────────────────────────
  chrome.storage.local.get('settings', ({ settings }) => {
    if (settings?.darkMode) document.documentElement.setAttribute('data-aaa-dark', '1');
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectBaseUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
