// Allegro Ads Automate – Background Service Worker (standalone, no build required)
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────
const ALARM_SCHEDULER = 'aaa-scheduler';
const ALARM_LICENSE   = 'aaa-license-check';
const MAX_HISTORY     = 500;

// ── Install / startup ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_SCHEDULER, { periodInMinutes: 1 });
  await chrome.alarms.create(ALARM_LICENSE,   { periodInMinutes: 60 * 12 });
  console.log('[AAA] Extension installed, alarms created');
});

chrome.runtime.onStartup.addListener(async () => {
  const alarms = await chrome.alarms.getAll();
  const names = alarms.map(a => a.name);
  if (!names.includes(ALARM_SCHEDULER)) {
    await chrome.alarms.create(ALARM_SCHEDULER, { periodInMinutes: 1 });
  }
  if (!names.includes(ALARM_LICENSE)) {
    await chrome.alarms.create(ALARM_LICENSE, { periodInMinutes: 60 * 12 });
  }
});

// ── Alarm handler ─────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_SCHEDULER) await runScheduler();
  if (alarm.name === ALARM_LICENSE)   await validateLicense(true);
});

// ── Message handler ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'GET_LICENSE':        return getLicenseState();
    case 'VALIDATE_LICENSE':   return validateLicense(true);
    case 'ACTIVATE_LICENSE':   return activateLicense(msg.key);
    case 'GET_SCHEDULES':      return getSchedules();
    case 'SAVE_SCHEDULE':      return saveSchedule(msg.schedule);
    case 'DELETE_SCHEDULE':    return deleteSchedule(msg.id);
    case 'GET_HISTORY':        return getHistory();
    case 'UNDO_CHANGE':        return undoChange(msg.entryId, sender);
    case 'CLEAR_HISTORY':      return clearHistory();
    case 'SAVE_SETTINGS':      return saveSettings(msg.settings);
    case 'GET_SETTINGS':       return getSettings();
    case 'LOG_CHANGE':         return logChange(msg.entry);
    default:
      return { success: false, error: `Unknown message type: ${msg.type}` };
  }
}

// ── License ───────────────────────────────────────────────────────────────
async function getLicenseState() {
  const { license } = await chrome.storage.local.get('license');
  return { success: true, license: license || null };
}

async function activateLicense(key) {
  if (!key || key.trim().length < 8) {
    return { success: false, error: 'Podaj poprawny klucz licencyjny (min. 8 znaków)' };
  }

  const { settings } = await chrome.storage.local.get('settings');
  const backendUrl = settings?.backendUrl || 'https://api.allegro-ads-automate.pl';

  try {
    const resp = await fetch(`${backendUrl}/api/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key.trim() }),
    });

    const data = await resp.json();

    if (!data.valid) {
      return { success: false, error: data.message || 'Nieprawidłowy klucz licencyjny' };
    }

    const license = {
      key: key.trim(),
      plan: data.plan || 'standard',
      expiresAt: data.expiresAt || null,
      allegroLogin: data.allegroLogin || null,
      validatedAt: new Date().toISOString(),
      valid: true,
    };

    await chrome.storage.local.set({ license });
    return { success: true, license };

  } catch {
    // Backend offline — store key locally and assume valid for 24h
    const license = {
      key: key.trim(),
      plan: 'standard',
      expiresAt: null,
      validatedAt: new Date().toISOString(),
      valid: true,
      offline: true,
    };
    await chrome.storage.local.set({ license });
    return { success: true, license, warning: 'Backend niedostępny – klucz zapisany lokalnie' };
  }
}

async function validateLicense(force = false) {
  const { license, settings } = await chrome.storage.local.get(['license', 'settings']);
  if (!license?.key) return { valid: false, reason: 'no_license' };

  const lastValidated = license.validatedAt ? new Date(license.validatedAt) : null;
  const hoursSince = lastValidated
    ? (Date.now() - lastValidated.getTime()) / 3600000
    : Infinity;

  if (!force && hoursSince < 24) {
    const expired = license.expiresAt && new Date(license.expiresAt) < new Date();
    return { valid: !expired, plan: license.plan, cached: true };
  }

  const backendUrl = settings?.backendUrl || 'https://api.allegro-ads-automate.pl';
  try {
    const resp = await fetch(`${backendUrl}/api/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: license.key }),
    });
    const data = await resp.json();

    await chrome.storage.local.set({
      license: {
        ...license,
        plan: data.plan || license.plan,
        expiresAt: data.expiresAt || license.expiresAt,
        validatedAt: new Date().toISOString(),
        valid: data.valid,
      },
    });
    return { valid: data.valid, plan: data.plan || license.plan };
  } catch {
    const expired = license.expiresAt && new Date(license.expiresAt) < new Date();
    return { valid: !expired, plan: license.plan, offline: true };
  }
}

// ── Schedules ─────────────────────────────────────────────────────────────
async function getSchedules() {
  const { schedules } = await chrome.storage.local.get('schedules');
  return { success: true, schedules: schedules || [] };
}

async function saveSchedule(schedule) {
  const { schedules = [] } = await chrome.storage.local.get('schedules');
  const idx = schedules.findIndex(s => s.id === schedule.id);
  if (idx >= 0) schedules[idx] = schedule;
  else schedules.push({ ...schedule, id: schedule.id || `sched_${Date.now()}` });
  await chrome.storage.local.set({ schedules });
  return { success: true, schedules };
}

async function deleteSchedule(id) {
  const { schedules = [] } = await chrome.storage.local.get('schedules');
  await chrome.storage.local.set({ schedules: schedules.filter(s => s.id !== id) });
  return { success: true };
}

// ── Scheduler execution ───────────────────────────────────────────────────
async function runScheduler() {
  const { schedules = [], license } = await chrome.storage.local.get(['schedules', 'license']);
  if (!license?.valid) return;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat
  const hour = now.getHours();
  const minute = now.getMinutes();

  for (const sched of schedules) {
    if (!sched.enabled) continue;
    if (!sched.days.includes(dayOfWeek)) continue;
    if (sched.hour !== hour || sched.minute !== minute) continue;

    // Execute schedule via content script in active Allegro Ads tabs
    const tabs = await chrome.tabs.query({ url: 'https://salescenter.allegro.com/*' });
    for (const tab of tabs) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: 'GLOBAL_CPC_CHANGE',
          params: {
            type: sched.actionType,
            value: sched.actionValue,
            filters: sched.filters || null,
            dryRun: false,
          },
        });

        await logChange({
          type: 'schedule',
          scheduleName: sched.name,
          actionType: sched.actionType,
          actionValue: sched.actionValue,
          affectedCampaigns: result?.affectedCampaigns || 0,
          success: result?.success !== false,
          error: result?.error || null,
          source: 'scheduler',
          timestamp: new Date().toISOString(),
        });

        if (sched.notify !== false) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'data:image/png;base64,iVBORw0KGgo=', // placeholder
            title: 'Allegro Ads Automate',
            message: `Harmonogram "${sched.name}" wykonany: ${result?.affectedCampaigns || 0} kampanii`,
          });
        }
      } catch (err) {
        await logChange({
          type: 'schedule',
          scheduleName: sched.name,
          success: false,
          error: err.message,
          source: 'scheduler',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

// ── History ───────────────────────────────────────────────────────────────
async function getHistory() {
  const { changeHistory = [] } = await chrome.storage.local.get('changeHistory');
  return { success: true, history: changeHistory };
}

async function logChange(entry) {
  const { changeHistory = [] } = await chrome.storage.local.get('changeHistory');
  const newEntry = {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    undone: false,
    synced: false,
    ...entry,
  };
  const updated = [newEntry, ...changeHistory].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ changeHistory: updated });
  return { success: true, entry: newEntry };
}

async function undoChange(entryId, sender) {
  const { changeHistory = [] } = await chrome.storage.local.get('changeHistory');
  const entry = changeHistory.find(e => e.id === entryId);

  if (!entry) return { success: false, error: 'Wpis nie znaleziony' };
  if (entry.undone) return { success: false, error: 'Zmiana już cofnięta' };
  if (entry.previousValue === undefined) return { success: false, error: 'Brak poprzedniej wartości' };

  // Send undo command to content script in Allegro Ads tabs
  const tabs = await chrome.tabs.query({ url: 'https://salescenter.allegro.com/*' });
  if (!tabs.length) return { success: false, error: 'Otwórz panel Allegro Ads aby cofnąć zmianę' };

  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'UNDO_CAMPAIGN_CHANGE',
        entry,
      });
    } catch {
      // Tab may not have content script
    }
  }

  // Mark as undone
  const updated = changeHistory.map(e =>
    e.id === entryId ? { ...e, undone: true } : e
  );
  await chrome.storage.local.set({ changeHistory: updated });
  return { success: true };
}

async function clearHistory() {
  await chrome.storage.local.set({ changeHistory: [] });
  return { success: true };
}

// ── Settings ──────────────────────────────────────────────────────────────
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return {
    success: true,
    settings: {
      vatRate: 23,
      billingDayStart: 26,
      notifications: true,
      darkMode: false,
      backendUrl: 'https://api.allegro-ads-automate.pl',
      ...settings,
    },
  };
}

async function saveSettings(newSettings) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const merged = { ...settings, ...newSettings };
  await chrome.storage.local.set({ settings: merged });
  return { success: true, settings: merged };
}
