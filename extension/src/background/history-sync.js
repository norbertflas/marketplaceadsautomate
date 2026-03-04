/**
 * Syncs change history to the backend for long-term storage.
 * Only runs for Agency plan users.
 */

export async function syncHistory() {
  const { license, settings, changeHistory } = await chrome.storage.local.get([
    'license', 'settings', 'changeHistory',
  ]);

  if (!license?.valid || !['agency_starter', 'agency_pro', 'agency_elite'].includes(license.plan)) {
    return { success: false, reason: 'agency_plan_required' };
  }

  const unsynced = (changeHistory || []).filter(e => !e.synced);
  if (!unsynced.length) return { success: true, synced: 0 };

  try {
    const backendUrl = settings?.backendUrl || 'https://api.allegro-ads-automate.pl';
    const resp = await fetch(`${backendUrl}/api/history/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-License-Key': license.key,
      },
      body: JSON.stringify({ entries: unsynced }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Mark as synced
    const syncedIds = new Set(unsynced.map(e => e.id));
    const updated = changeHistory.map(e =>
      syncedIds.has(e.id) ? { ...e, synced: true } : e
    );
    await chrome.storage.local.set({ changeHistory: updated });

    return { success: true, synced: unsynced.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
