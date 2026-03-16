/**
 * Background Service Worker – Allegro Ads Automate
 * Handles: scheduling (chrome.alarms), license validation, message routing
 */

import { validateLicense } from './license.js';
import { executeSchedule, registerAlarms } from './scheduler.js';
import { syncHistory } from './history-sync.js';
import {
  addMonitoredProduct, removeMonitoredProduct, getMonitoredProducts,
  toggleProductMonitoring, getSnapshots, saveSnapshot, getAlerts,
  markAlertRead, markAllAlertsRead, clearAlerts, getMonitorSettings,
  saveMonitorSettings, executeMonitorCheck, detectChanges, createAlert,
} from './product-monitor.js';

const ALARM_SCHEDULER = 'allegro-ads-scheduler';
const ALARM_LICENSE_CHECK = 'allegro-ads-license-check';
const ALARM_MONITOR_CHECK = 'allegro-scraper-monitor';

// ── Startup ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      license: null,
      schedules: [],
      changeHistory: [],
      monitoredProducts: [],
      productSnapshots: {},
      productAlerts: [],
      monitorSettings: {
        checkIntervalMinutes: 60,
        enableNotifications: true,
        trackPrice: true,
        trackAvailability: true,
        trackTitle: true,
        trackQuantity: true,
        priceChangeThreshold: 0,
      },
      settings: {
        vatRate: 23,
        billingDayStart: 26,
        backendUrl: 'https://api.allegro-ads-automate.pl',
        notifications: true,
        darkMode: false,
      },
    });
  }

  await registerAlarms();
  await registerMonitorAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await registerAlarms();
  await registerMonitorAlarm();
});

// ── Alarm Handler ─────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case ALARM_SCHEDULER:
      await executeSchedule();
      break;
    case ALARM_LICENSE_CHECK:
      await validateLicense();
      break;
    case ALARM_MONITOR_CHECK:
      await executeMonitorCheck();
      break;
    default:
      break;
  }
});

// Register monitor alarm based on settings
async function registerMonitorAlarm() {
  const settings = await getMonitorSettings();
  const intervalMinutes = Math.max(5, settings.checkIntervalMinutes || 60);

  await chrome.alarms.clear(ALARM_MONITOR_CHECK);
  await chrome.alarms.create(ALARM_MONITOR_CHECK, {
    periodInMinutes: intervalMinutes,
  });
}

// ── Message Handler ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'VALIDATE_LICENSE':
      return validateLicense(true);

    case 'GET_STATE': {
      const data = await chrome.storage.local.get([
        'license', 'schedules', 'changeHistory', 'settings',
      ]);
      return { success: true, data };
    }

    case 'SAVE_SCHEDULE': {
      const { schedules } = await chrome.storage.local.get('schedules');
      const existing = schedules || [];
      const idx = existing.findIndex(s => s.id === message.schedule.id);
      if (idx >= 0) {
        existing[idx] = message.schedule;
      } else {
        existing.push(message.schedule);
      }
      await chrome.storage.local.set({ schedules: existing });
      await registerAlarms();
      return { success: true };
    }

    case 'DELETE_SCHEDULE': {
      const { schedules } = await chrome.storage.local.get('schedules');
      const updated = (schedules || []).filter(s => s.id !== message.id);
      await chrome.storage.local.set({ schedules: updated });
      return { success: true };
    }

    case 'LOG_CHANGE':
      return logChange(message.entry);

    case 'UNDO_CHANGE':
      return undoChange(message.entryId, sender.tab?.id);

    case 'GET_HISTORY': {
      const { changeHistory } = await chrome.storage.local.get('changeHistory');
      return { success: true, history: changeHistory || [] };
    }

    case 'CLEAR_HISTORY': {
      await chrome.storage.local.set({ changeHistory: [] });
      return { success: true };
    }

    case 'SAVE_SETTINGS': {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...message.settings } });
      return { success: true };
    }

    case 'ACTIVATE_LICENSE': {
      const result = await activateLicense(message.key);
      return result;
    }

    case 'SYNC_HISTORY':
      return syncHistory();

    // ── Scraper / Monitor messages ─────────────────────────────────────
    case 'MONITOR_ADD_PRODUCT':
      return addMonitoredProduct(message.product);

    case 'MONITOR_REMOVE_PRODUCT':
      return removeMonitoredProduct(message.offerId);

    case 'MONITOR_GET_PRODUCTS':
      return getMonitoredProducts();

    case 'MONITOR_TOGGLE_PRODUCT':
      return toggleProductMonitoring(message.offerId, message.enabled);

    case 'MONITOR_GET_SNAPSHOTS':
      return getSnapshots(message.offerId, message.limit);

    case 'MONITOR_GET_ALERTS':
      return getAlerts(message.limit, message.unreadOnly);

    case 'MONITOR_MARK_ALERT_READ':
      return markAlertRead(message.alertId);

    case 'MONITOR_MARK_ALL_READ':
      return markAllAlertsRead();

    case 'MONITOR_CLEAR_ALERTS':
      return clearAlerts();

    case 'MONITOR_GET_SETTINGS':
      return getMonitorSettings();

    case 'MONITOR_SAVE_SETTINGS': {
      const result = await saveMonitorSettings(message.settings);
      await registerMonitorAlarm(); // re-register alarm with new interval
      return result;
    }

    case 'MONITOR_CHECK_NOW':
      return executeMonitorCheck();

    case 'SCRAPER_PRODUCT_CAPTURED': {
      // Product data captured from content script – check if monitored
      const products = await getMonitoredProducts();
      const monitored = products.find(p => p.offerId === message.product.offerId);
      if (monitored && monitored.enabled) {
        const { hasChanges, changes } = await detectChanges(monitored.offerId, message.product);
        await saveSnapshot(monitored.offerId, message.product);
        if (hasChanges) {
          await createAlert(monitored.offerId, monitored.title, changes);
          const settings = await getMonitorSettings();
          if (settings.enableNotifications) {
            chrome.notifications.create(`monitor_${monitored.offerId}_${Date.now()}`, {
              type: 'basic',
              iconUrl: '/icons/icon128.png',
              title: `Zmiana: ${monitored.title.substring(0, 50)}`,
              message: changes.map(c => `${c.field}: ${c.oldValue} -> ${c.newValue}`).join(', '),
              priority: 2,
            });
          }
        }
      }
      return { success: true };
    }

    case 'SCRAPER_LISTING_CAPTURED':
      // Listing data captured – store for potential analysis
      return { success: true, itemCount: message.itemCount };

    case 'SCRAPER_SELLER_CAPTURED':
      return { success: true };

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ── Change History ────────────────────────────────────────────────────────

async function logChange(entry) {
  const { changeHistory } = await chrome.storage.local.get('changeHistory');
  const history = changeHistory || [];

  const newEntry = {
    id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  history.unshift(newEntry);

  // Keep last 1000 entries (≈ 5 MB buffer)
  if (history.length > 1000) history.splice(1000);

  await chrome.storage.local.set({ changeHistory: history });
  return { success: true, entry: newEntry };
}

async function undoChange(entryId, tabId) {
  const { changeHistory } = await chrome.storage.local.get('changeHistory');
  const history = changeHistory || [];
  const entry = history.find(e => e.id === entryId);

  if (!entry) return { success: false, error: 'Entry not found' };
  if (!entry.previousValue) return { success: false, error: 'No previous value to restore' };

  // Send undo command to the active Allegro Ads tab
  const tabs = await chrome.tabs.query({ url: 'https://salescenter.allegro.com/*' });
  const targetTab = tabId
    ? tabs.find(t => t.id === tabId)
    : tabs[0];

  if (!targetTab) {
    return { success: false, error: 'No active Allegro Ads tab found. Open salescenter.allegro.com to undo.' };
  }

  const result = await chrome.tabs.sendMessage(targetTab.id, {
    type: 'EXECUTE_UNDO',
    entry,
  });

  if (result?.success) {
    // Mark entry as undone
    const idx = history.findIndex(e => e.id === entryId);
    if (idx >= 0) history[idx] = { ...history[idx], undone: true, undoneAt: new Date().toISOString() };
    await chrome.storage.local.set({ changeHistory: history });
  }

  return result;
}

// ── License Activation ────────────────────────────────────────────────────

async function activateLicense(key) {
  if (!key || key.length < 8) {
    return { success: false, error: 'Invalid license key format' };
  }

  try {
    const { settings } = await chrome.storage.local.get('settings');
    const backendUrl = settings?.backendUrl || 'https://api.allegro-ads-automate.pl';

    const resp = await fetch(`${backendUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });

    const data = await resp.json();

    if (data.valid) {
      await chrome.storage.local.set({
        license: {
          key,
          plan: data.plan,
          expiresAt: data.expiresAt,
          allegroLogin: data.allegroLogin,
          validatedAt: new Date().toISOString(),
        },
      });
      return { success: true, license: data };
    } else {
      return { success: false, error: data.message || 'License validation failed' };
    }
  } catch (err) {
    // Offline fallback – allow if locally cached and not expired
    const { license } = await chrome.storage.local.get('license');
    if (license?.key === key && license?.expiresAt && new Date(license.expiresAt) > new Date()) {
      return { success: true, license, offline: true };
    }
    return { success: false, error: 'Cannot reach license server. Check your internet connection.' };
  }
}

export { ALARM_SCHEDULER, ALARM_LICENSE_CHECK };
