/**
 * UI Injector – injects Allegro Ads Automate UI elements into the panel
 */

const EXTENSION_CLASS = 'aaa-ext';
const TOAST_CONTAINER_ID = 'aaa-toast-container';
const PROGRESS_BAR_ID = 'aaa-progress-bar';
const MODAL_OVERLAY_ID = 'aaa-modal-overlay';

let progressInterval = null;

// ── Main UI Injection ─────────────────────────────────────────────────────

export function injectUI() {
  // Wait for Allegro Ads panel to load
  waitForElement('.seller-advertising, [data-testid="campaigns-list"], main', () => {
    injectToastContainer();
    injectFloatingButton();
    injectProgressBar();
    applyDarkModeIfEnabled();
  });
}

function injectToastContainer() {
  if (document.getElementById(TOAST_CONTAINER_ID)) return;

  const container = createElement('div', { id: TOAST_CONTAINER_ID, class: `${EXTENSION_CLASS} aaa-toasts` });
  document.body.appendChild(container);
}

function injectProgressBar() {
  if (document.getElementById(PROGRESS_BAR_ID)) return;

  const bar = createElement('div', { id: PROGRESS_BAR_ID, class: `${EXTENSION_CLASS} aaa-progress hidden` }, `
    <div class="aaa-progress-label"></div>
    <div class="aaa-progress-track">
      <div class="aaa-progress-fill"></div>
    </div>
    <div class="aaa-progress-count"></div>
  `);
  document.body.appendChild(bar);
}

function injectFloatingButton() {
  if (document.getElementById('aaa-fab')) return;

  const fab = createElement('button', {
    id: 'aaa-fab',
    class: `${EXTENSION_CLASS} aaa-fab`,
    title: 'Allegro Ads Automate',
  }, `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8v4l3 3"/>
    </svg>
  `);

  fab.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
  });

  document.body.appendChild(fab);
}

// ── Toast Notifications ───────────────────────────────────────────────────

export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) return;

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  const toast = createElement('div', { class: `aaa-toast aaa-toast-${type}` }, `
    <span class="aaa-toast-icon">${icons[type] || icons.info}</span>
    <span class="aaa-toast-msg">${escapeHtml(message)}</span>
  `);

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add('aaa-toast-show'));

  setTimeout(() => {
    toast.classList.remove('aaa-toast-show');
    toast.classList.add('aaa-toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Progress Bar ──────────────────────────────────────────────────────────

export function showProgress(label, total, current = 0) {
  const bar = document.getElementById(PROGRESS_BAR_ID);
  if (!bar) return;

  const labelEl = bar.querySelector('.aaa-progress-label');
  const fillEl = bar.querySelector('.aaa-progress-fill');
  const countEl = bar.querySelector('.aaa-progress-count');

  if (labelEl) labelEl.textContent = label;
  if (fillEl) fillEl.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
  if (countEl) countEl.textContent = total > 0 ? `${current} / ${total}` : '';

  bar.classList.remove('hidden');
}

export function hideProgress() {
  const bar = document.getElementById(PROGRESS_BAR_ID);
  if (bar) bar.classList.add('hidden');
}

// ── Confirm Modal ─────────────────────────────────────────────────────────

export function showConfirmModal({ title, body, confirmText = 'Potwierdź', cancelText = 'Anuluj' }) {
  return new Promise((resolve) => {
    const overlay = createElement('div', { id: MODAL_OVERLAY_ID, class: `${EXTENSION_CLASS} aaa-modal-overlay` }, `
      <div class="aaa-modal">
        <div class="aaa-modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="aaa-modal-close" aria-label="Zamknij">✕</button>
        </div>
        <div class="aaa-modal-body">
          <pre>${escapeHtml(body)}</pre>
        </div>
        <div class="aaa-modal-footer">
          <button class="aaa-btn aaa-btn-secondary aaa-cancel">${escapeHtml(cancelText)}</button>
          <button class="aaa-btn aaa-btn-primary aaa-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `);

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.querySelector('.aaa-modal-close').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.aaa-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.aaa-confirm').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });

    document.body.appendChild(overlay);
  });
}

// ── Offer Stats Page – "x" remove button injection ────────────────────────

const OFFER_BTN_CLASS = 'aaa-offer-remove-btn';
let offerStatsObserver = null;
let lastUrl = location.href;

/**
 * Watch for navigation to offer statistics pages in the Allegro SPA
 * and inject remove buttons into offer rows.
 */
export function watchOfferStatsPage() {
  injectOfferStatsButtonsIfNeeded();

  // SPA navigation detection via history API patching
  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    origPushState(...args);
    onUrlChange();
  };
  window.addEventListener('popstate', onUrlChange);
}

function onUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    injectOfferStatsButtonsIfNeeded();
  }
}

function isOfferStatsUrl() {
  const url = location.href;
  return (
    url.includes('/statistics') ||
    url.includes('/sponsored-offers') ||
    url.includes('/ads/offers') ||
    url.includes('salescenter.allegro.com/ads')
  );
}

function injectOfferStatsButtonsIfNeeded() {
  if (!isOfferStatsUrl()) return;

  // Disconnect previous observer if any
  if (offerStatsObserver) {
    offerStatsObserver.disconnect();
  }

  // Try immediately and then watch for DOM changes
  tryInjectOfferButtons();

  offerStatsObserver = new MutationObserver(() => tryInjectOfferButtons());
  offerStatsObserver.observe(document.body, { childList: true, subtree: true });
}

function tryInjectOfferButtons() {
  // Target table rows that contain offer data.
  // Allegro Ads panel typically renders rows as <tr> or as list items.
  // We try multiple selectors to handle different page variants.
  const rowSelectors = [
    'tbody tr',
    '[data-testid="offer-row"]',
    '[class*="offerRow"]',
    '[class*="offer-row"]',
    '[class*="TableRow"]',
  ];

  let rows = [];
  for (const sel of rowSelectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) {
      rows = [...found];
      break;
    }
  }

  for (const row of rows) {
    if (row.querySelector(`.${OFFER_BTN_CLASS}`)) continue; // already injected

    // Try to extract offerId from the row
    const offerId = extractOfferId(row);
    if (!offerId) continue;

    const btn = createRemoveButton(offerId, row);

    // Find a good place to inject – last cell or action area
    const lastCell = row.querySelector('td:last-child, [class*="actions"], [class*="Actions"]');
    if (lastCell) {
      lastCell.style.position = 'relative';
      lastCell.appendChild(btn);
    } else {
      row.style.position = 'relative';
      row.appendChild(btn);
    }
  }
}

function extractOfferId(row) {
  // Try data attributes first
  const candidates = [
    row.dataset.offerId,
    row.dataset.id,
    row.getAttribute('data-offer-id'),
    row.getAttribute('data-id'),
  ];
  for (const c of candidates) {
    if (c) return c;
  }

  // Try links that look like offer URLs: /oferty/{id} or /offer/{id}
  const links = row.querySelectorAll('a[href]');
  for (const a of links) {
    const m = a.href.match(/\/(?:oferty|offer|offers?)\/(\d+)/i);
    if (m) return m[1];
  }

  // Try to find a numeric ID in text of the row (offer IDs are long numbers)
  const text = row.textContent || '';
  const m = text.match(/\b(\d{10,})\b/);
  if (m) return m[1];

  return null;
}

function createRemoveButton(offerId, row) {
  const btn = document.createElement('button');
  btn.className = `${EXTENSION_CLASS} ${OFFER_BTN_CLASS}`;
  btn.title = 'Usuń ofertę z kampanii';
  btn.textContent = '✕';
  btn.style.cssText = `
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
    background: transparent;
    border: 1px solid #e53935;
    color: #e53935;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    z-index: 100;
    opacity: 0.7;
    transition: opacity 0.15s;
  `;

  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.7'; });

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    await handleOfferRemove(offerId, btn, row);
  });

  return btn;
}

async function handleOfferRemove(offerId, btn, row) {
  // Get the campaign for this offer from the background's offer map
  // The content script has access to the offerCampaignMap via the api-interceptor
  let campaignId = null;
  let campaignName = null;

  try {
    // Dynamic import to avoid circular deps
    const { getOfferCampaignMap } = await import('./api-interceptor.js');
    const map = getOfferCampaignMap();
    if (map[offerId]) {
      campaignId = map[offerId].campaignId;
      campaignName = map[offerId].campaignName;
    }
  } catch {
    /* ignore */
  }

  // Fallback: try to find campaign name from the DOM row itself
  if (!campaignId) {
    const campaignLink = row.querySelector('a[href*="/campaign"], a[href*="/kampanie"]');
    if (campaignLink) {
      const m = campaignLink.href.match(/\/(\w[\w-]+)(?:\?|$)/);
      if (m) campaignId = m[1];
      campaignName = campaignLink.textContent?.trim();
    }
  }

  if (!campaignId) {
    showToast('Nie można ustalić kampanii tej oferty. Otwórz listę kampanii i wróć do statystyk.', 'warning', 5000);
    return;
  }

  const confirmName = campaignName ? ` z kampanii „${campaignName}"` : '';
  const ok = confirm(`Usunąć ofertę ${offerId}${confirmName}?\n\nTej operacji nie można cofnąć.`);
  if (!ok) return;

  btn.textContent = '...';
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'REMOVE_OFFER_FROM_CAMPAIGN_BG',
      campaignId,
      offerId,
    });

    if (result?.success) {
      showToast(`Oferta ${offerId} usunięta z kampanii`, 'success');
      // Fade out and remove the row
      row.style.transition = 'opacity 0.4s';
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 400);
    } else {
      showToast(`Błąd: ${result?.error || 'Nie udało się usunąć oferty'}`, 'error');
      btn.textContent = '✕';
      btn.disabled = false;
    }
  } catch (err) {
    showToast(`Błąd: ${err.message}`, 'error');
    btn.textContent = '✕';
    btn.disabled = false;
  }
}

// ── Dark Mode ─────────────────────────────────────────────────────────────

export async function applyDarkModeIfEnabled() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings?.darkMode) {
    document.documentElement.setAttribute('data-aaa-dark', '1');
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function waitForElement(selector, callback, timeout = 10000) {
  const el = document.querySelector(selector);
  if (el) {
    callback(el);
    return;
  }

  const observer = new MutationObserver(() => {
    const found = document.querySelector(selector);
    if (found) {
      observer.disconnect();
      callback(found);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
    // Inject anyway even if specific element not found
    callback(null);
  }, timeout);
}

function createElement(tag, attrs = {}, innerHTML = '') {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  el.innerHTML = innerHTML;
  return el;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
