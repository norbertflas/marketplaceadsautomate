/**
 * Product Monitor – Background module for tracking product changes
 * Stores monitored products, detects changes, sends notifications
 */

const STORAGE_KEY_PRODUCTS = 'monitoredProducts';
const STORAGE_KEY_SNAPSHOTS = 'productSnapshots';
const STORAGE_KEY_ALERTS = 'productAlerts';
const STORAGE_KEY_MONITOR_SETTINGS = 'monitorSettings';

const MAX_SNAPSHOTS_PER_PRODUCT = 500;
const MAX_ALERTS = 1000;

// ── Default Monitor Settings ────────────────────────────────────────────

const DEFAULT_MONITOR_SETTINGS = {
  checkIntervalMinutes: 60,    // default: check every hour
  enableNotifications: true,
  trackPrice: true,
  trackAvailability: true,
  trackTitle: true,
  trackQuantity: true,
  priceChangeThreshold: 0,     // 0 = notify on any change, or set % threshold
};

// ── Product Management ──────────────────────────────────────────────────

export async function addMonitoredProduct(product) {
  const { monitoredProducts } = await chrome.storage.local.get(STORAGE_KEY_PRODUCTS);
  const products = monitoredProducts || [];

  // Check if already monitored
  if (products.some(p => p.offerId === product.offerId)) {
    return { success: false, error: 'Produkt jest juz monitorowany' };
  }

  const entry = {
    offerId: product.offerId,
    title: product.title,
    url: product.url || `https://allegro.pl/oferta/${product.offerId}`,
    seller: product.seller || null,
    imageUrl: product.imageUrl || null,
    category: product.category || null,
    addedAt: new Date().toISOString(),
    lastCheckedAt: null,
    enabled: true,
  };

  products.push(entry);
  await chrome.storage.local.set({ [STORAGE_KEY_PRODUCTS]: products });

  // Save initial snapshot
  await saveSnapshot(product.offerId, product);

  return { success: true, product: entry };
}

export async function removeMonitoredProduct(offerId) {
  const { monitoredProducts } = await chrome.storage.local.get(STORAGE_KEY_PRODUCTS);
  const products = (monitoredProducts || []).filter(p => p.offerId !== offerId);
  await chrome.storage.local.set({ [STORAGE_KEY_PRODUCTS]: products });

  // Clean up snapshots for this product
  const { productSnapshots } = await chrome.storage.local.get(STORAGE_KEY_SNAPSHOTS);
  const snapshots = productSnapshots || {};
  delete snapshots[offerId];
  await chrome.storage.local.set({ [STORAGE_KEY_SNAPSHOTS]: snapshots });

  return { success: true };
}

export async function getMonitoredProducts() {
  const { monitoredProducts } = await chrome.storage.local.get(STORAGE_KEY_PRODUCTS);
  return monitoredProducts || [];
}

export async function toggleProductMonitoring(offerId, enabled) {
  const { monitoredProducts } = await chrome.storage.local.get(STORAGE_KEY_PRODUCTS);
  const products = monitoredProducts || [];
  const idx = products.findIndex(p => p.offerId === offerId);

  if (idx < 0) return { success: false, error: 'Product not found' };

  products[idx] = { ...products[idx], enabled };
  await chrome.storage.local.set({ [STORAGE_KEY_PRODUCTS]: products });
  return { success: true };
}

// ── Snapshot Management ─────────────────────────────────────────────────

export async function saveSnapshot(offerId, productData) {
  const { productSnapshots } = await chrome.storage.local.get(STORAGE_KEY_SNAPSHOTS);
  const snapshots = productSnapshots || {};

  if (!snapshots[offerId]) snapshots[offerId] = [];

  const snapshot = {
    timestamp: new Date().toISOString(),
    price: productData.price ?? null,
    originalPrice: productData.originalPrice ?? null,
    title: productData.title || '',
    quantity: productData.quantity ?? null,
    soldCount: productData.soldCount ?? null,
    availability: productData.availability || 'unknown',
    delivery: productData.delivery || null,
    rating: productData.rating || null,
    parameters: productData.parameters || null,
  };

  snapshots[offerId].push(snapshot);

  // Keep only last N snapshots per product
  if (snapshots[offerId].length > MAX_SNAPSHOTS_PER_PRODUCT) {
    snapshots[offerId] = snapshots[offerId].slice(-MAX_SNAPSHOTS_PER_PRODUCT);
  }

  await chrome.storage.local.set({ [STORAGE_KEY_SNAPSHOTS]: snapshots });
  return snapshot;
}

export async function getSnapshots(offerId, limit = 100) {
  const { productSnapshots } = await chrome.storage.local.get(STORAGE_KEY_SNAPSHOTS);
  const snapshots = (productSnapshots || {})[offerId] || [];
  return limit ? snapshots.slice(-limit) : snapshots;
}

export async function getLatestSnapshot(offerId) {
  const snapshots = await getSnapshots(offerId, 1);
  return snapshots[0] || null;
}

// ── Change Detection ────────────────────────────────────────────────────

export async function detectChanges(offerId, newData) {
  const { monitorSettings } = await chrome.storage.local.get(STORAGE_KEY_MONITOR_SETTINGS);
  const settings = { ...DEFAULT_MONITOR_SETTINGS, ...monitorSettings };

  const lastSnapshot = await getLatestSnapshot(offerId);
  if (!lastSnapshot) return { hasChanges: false, changes: [] };

  const changes = [];

  // Price change
  if (settings.trackPrice && newData.price != null && lastSnapshot.price != null) {
    if (newData.price !== lastSnapshot.price) {
      const pctChange = ((newData.price - lastSnapshot.price) / lastSnapshot.price) * 100;
      if (Math.abs(pctChange) >= settings.priceChangeThreshold) {
        changes.push({
          field: 'price',
          oldValue: lastSnapshot.price,
          newValue: newData.price,
          percentChange: Math.round(pctChange * 100) / 100,
          direction: newData.price > lastSnapshot.price ? 'up' : 'down',
        });
      }
    }
  }

  // Title change
  if (settings.trackTitle && newData.title && lastSnapshot.title) {
    if (newData.title !== lastSnapshot.title) {
      changes.push({
        field: 'title',
        oldValue: lastSnapshot.title,
        newValue: newData.title,
      });
    }
  }

  // Availability change
  if (settings.trackAvailability && newData.availability && lastSnapshot.availability) {
    if (newData.availability !== lastSnapshot.availability) {
      changes.push({
        field: 'availability',
        oldValue: lastSnapshot.availability,
        newValue: newData.availability,
      });
    }
  }

  // Quantity change
  if (settings.trackQuantity && newData.quantity != null && lastSnapshot.quantity != null) {
    if (newData.quantity !== lastSnapshot.quantity) {
      changes.push({
        field: 'quantity',
        oldValue: lastSnapshot.quantity,
        newValue: newData.quantity,
      });
    }
  }

  return { hasChanges: changes.length > 0, changes };
}

// ── Alerts ──────────────────────────────────────────────────────────────

export async function createAlert(offerId, productTitle, changes) {
  const { productAlerts } = await chrome.storage.local.get(STORAGE_KEY_ALERTS);
  const alerts = productAlerts || [];

  const alert = {
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    offerId,
    productTitle,
    changes,
    createdAt: new Date().toISOString(),
    read: false,
  };

  alerts.unshift(alert);

  // Keep only last N alerts
  if (alerts.length > MAX_ALERTS) alerts.splice(MAX_ALERTS);

  await chrome.storage.local.set({ [STORAGE_KEY_ALERTS]: alerts });
  return alert;
}

export async function getAlerts(limit = 50, unreadOnly = false) {
  const { productAlerts } = await chrome.storage.local.get(STORAGE_KEY_ALERTS);
  let alerts = productAlerts || [];
  if (unreadOnly) alerts = alerts.filter(a => !a.read);
  return limit ? alerts.slice(0, limit) : alerts;
}

export async function markAlertRead(alertId) {
  const { productAlerts } = await chrome.storage.local.get(STORAGE_KEY_ALERTS);
  const alerts = productAlerts || [];
  const idx = alerts.findIndex(a => a.id === alertId);
  if (idx >= 0) {
    alerts[idx] = { ...alerts[idx], read: true };
    await chrome.storage.local.set({ [STORAGE_KEY_ALERTS]: alerts });
  }
  return { success: true };
}

export async function markAllAlertsRead() {
  const { productAlerts } = await chrome.storage.local.get(STORAGE_KEY_ALERTS);
  const alerts = (productAlerts || []).map(a => ({ ...a, read: true }));
  await chrome.storage.local.set({ [STORAGE_KEY_ALERTS]: alerts });
  return { success: true };
}

export async function clearAlerts() {
  await chrome.storage.local.set({ [STORAGE_KEY_ALERTS]: [] });
  return { success: true };
}

// ── Monitor Settings ────────────────────────────────────────────────────

export async function getMonitorSettings() {
  const { monitorSettings } = await chrome.storage.local.get(STORAGE_KEY_MONITOR_SETTINGS);
  return { ...DEFAULT_MONITOR_SETTINGS, ...monitorSettings };
}

export async function saveMonitorSettings(settings) {
  const current = await getMonitorSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEY_MONITOR_SETTINGS]: updated });
  return { success: true, settings: updated };
}

// ── Periodic Check Execution ────────────────────────────────────────────

export async function executeMonitorCheck() {
  const products = await getMonitoredProducts();
  const enabledProducts = products.filter(p => p.enabled);

  if (enabledProducts.length === 0) return { success: true, checked: 0 };

  const settings = await getMonitorSettings();
  let checked = 0;
  let alertsCreated = 0;

  // Send check request to content script on active Allegro tab
  const tabs = await chrome.tabs.query({ url: 'https://*.allegro.pl/*' });
  const allegroTab = tabs[0];

  if (!allegroTab) {
    return {
      success: false,
      error: 'Brak otwartej karty Allegro. Otworz allegro.pl by sprawdzic produkty.',
    };
  }

  for (const product of enabledProducts) {
    try {
      // Ask content script to fetch offer details
      const result = await chrome.tabs.sendMessage(allegroTab.id, {
        type: 'SCRAPER_FETCH_OFFER',
        offerId: product.offerId,
      });

      if (result?.success && result.product) {
        // Detect changes
        const { hasChanges, changes } = await detectChanges(product.offerId, result.product);

        // Save new snapshot
        await saveSnapshot(product.offerId, result.product);

        // Update lastCheckedAt
        await updateProductLastChecked(product.offerId);

        if (hasChanges) {
          const alert = await createAlert(product.offerId, product.title, changes);
          alertsCreated++;

          // Send browser notification
          if (settings.enableNotifications) {
            sendChangeNotification(product, changes);
          }

          // Sync to backend if available
          try {
            await syncAlertToBackend(alert);
          } catch {
            // Backend sync is best-effort
          }
        }

        checked++;
      }

      // Rate limit: wait between checks
      await sleep(500);
    } catch (err) {
      console.warn(`[Monitor] Failed to check ${product.offerId}:`, err.message);
    }
  }

  return { success: true, checked, alertsCreated };
}

async function updateProductLastChecked(offerId) {
  const { monitoredProducts } = await chrome.storage.local.get(STORAGE_KEY_PRODUCTS);
  const products = monitoredProducts || [];
  const idx = products.findIndex(p => p.offerId === offerId);
  if (idx >= 0) {
    products[idx] = { ...products[idx], lastCheckedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [STORAGE_KEY_PRODUCTS]: products });
  }
}

function sendChangeNotification(product, changes) {
  const priceChange = changes.find(c => c.field === 'price');
  let message;

  if (priceChange) {
    const arrow = priceChange.direction === 'up' ? '\u2191' : '\u2193';
    message = `Cena: ${priceChange.oldValue} PLN ${arrow} ${priceChange.newValue} PLN (${priceChange.percentChange > 0 ? '+' : ''}${priceChange.percentChange}%)`;
  } else {
    message = changes.map(c => `${c.field}: ${c.oldValue} -> ${c.newValue}`).join(', ');
  }

  chrome.notifications.create(`monitor_${product.offerId}_${Date.now()}`, {
    type: 'basic',
    iconUrl: '/icons/icon128.png',
    title: `Zmiana oferty: ${product.title.substring(0, 50)}`,
    message,
    priority: 2,
  });
}

async function syncAlertToBackend(alert) {
  const { settings, license } = await chrome.storage.local.get(['settings', 'license']);
  if (!license?.key || !settings?.backendUrl) return;

  await fetch(`${settings.backendUrl}/api/scraper/alerts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-License-Key': license.key,
    },
    body: JSON.stringify(alert),
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
