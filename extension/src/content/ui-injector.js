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
