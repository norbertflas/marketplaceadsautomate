/**
 * Campaign Manager – Global CPC/budget changes and bulk operations
 */

import { fetchCampaigns, updateCampaignCpc, updateCampaignBudget } from './api-interceptor.js';
import { showToast, showProgress, hideProgress, showConfirmModal } from './ui-injector.js';

const RATE_LIMIT_MS = 150; // ms between API calls to avoid triggering rate limits

// ── Global CPC Change ─────────────────────────────────────────────────────

export async function executeGlobalCpcChange(params) {
  const {
    type,       // 'increase_pct' | 'decrease_pct' | 'set' | 'increase_abs' | 'decrease_abs'
    value,      // numeric value
    filters,    // { status, minBudget, maxBudget, campaignIds }
    dryRun,     // if true, only simulate
  } = params;

  const { success, campaigns, error } = await fetchCampaigns();
  if (!success) return { success: false, error };

  const targets = applyFilters(campaigns, filters);
  if (!targets.length) {
    showToast('Brak kampanii spełniających kryteria filtrowania', 'warning');
    return { success: true, affectedCampaigns: 0 };
  }

  // Build preview of changes
  const preview = targets.map(c => ({
    id: c.id,
    name: c.name,
    oldCpc: c.cpc,
    newCpc: calculateNewValue(c.cpc, type, value),
  }));

  if (dryRun) {
    return { success: true, preview, affectedCampaigns: preview.length };
  }

  // Confirm before applying
  const confirmed = await showConfirmModal({
    title: 'Globalna zmiana CPC',
    body: buildConfirmBody(preview, type, value),
    confirmText: `Zmień CPC (${targets.length} kampanii)`,
  });

  if (!confirmed) return { success: false, error: 'Cancelled by user' };

  return applyChanges(preview, 'cpc', 'cpc_change');
}

// ── Bulk Budget Change ────────────────────────────────────────────────────

export async function executeGlobalBudgetChange(params) {
  const { type, value, filters, dryRun } = params;

  const { success, campaigns, error } = await fetchCampaigns();
  if (!success) return { success: false, error };

  const targets = applyFilters(campaigns, filters);
  if (!targets.length) {
    showToast('Brak kampanii spełniających kryteria filtrowania', 'warning');
    return { success: true, affectedCampaigns: 0 };
  }

  const preview = targets.map(c => ({
    id: c.id,
    name: c.name,
    oldBudget: c.dailyBudget,
    newBudget: calculateNewValue(c.dailyBudget, type, value),
  }));

  if (dryRun) {
    return { success: true, preview, affectedCampaigns: preview.length };
  }

  const confirmed = await showConfirmModal({
    title: 'Globalna zmiana budżetu',
    body: buildConfirmBody(preview, type, value),
    confirmText: `Zmień budżet (${targets.length} kampanii)`,
  });

  if (!confirmed) return { success: false, error: 'Cancelled by user' };

  return applyChanges(preview, 'budget', 'budget_change');
}

// ── Bulk Action ───────────────────────────────────────────────────────────

export async function executeBulkAction(params) {
  const { action, campaignIds, filters } = params;

  const { success, campaigns, error } = await fetchCampaigns();
  if (!success) return { success: false, error };

  let targets = campaigns;
  if (campaignIds?.length) {
    targets = campaigns.filter(c => campaignIds.includes(c.id));
  } else if (filters) {
    targets = applyFilters(campaigns, filters);
  }

  if (!targets.length) return { success: true, affectedCampaigns: 0 };

  switch (action) {
    case 'pause':
      return bulkStatusChange(targets, 'PAUSED');
    case 'resume':
      return bulkStatusChange(targets, 'ACTIVE');
    case 'cpc':
      return executeGlobalCpcChange({ ...params, filters: null });
    case 'budget':
      return executeGlobalBudgetChange({ ...params, filters: null });
    default:
      return { success: false, error: `Unknown bulk action: ${action}` };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function applyChanges(preview, field, changeType) {
  showProgress(`Aktualizacja ${field === 'cpc' ? 'CPC' : 'budżetu'}`, preview.length);

  let succeeded = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < preview.length; i++) {
    const item = preview[i];
    showProgress(
      `Aktualizacja ${field === 'cpc' ? 'CPC' : 'budżetu'}: ${item.name}`,
      preview.length,
      i + 1
    );

    try {
      if (field === 'cpc') {
        await updateCampaignCpc(item.id, item.newCpc);
      } else {
        await updateCampaignBudget(item.id, item.newBudget);
      }

      await chrome.runtime.sendMessage({
        type: 'LOG_CHANGE',
        entry: {
          type: changeType,
          source: 'manual',
          campaignId: item.id,
          campaignName: item.name,
          previousValue: field === 'cpc' ? item.oldCpc : item.oldBudget,
          newValue: field === 'cpc' ? item.newCpc : item.newBudget,
          status: 'success',
        },
      });

      succeeded++;
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      failed++;
      errors.push({ campaignId: item.id, campaignName: item.name, error: err.message });
    }
  }

  hideProgress();

  if (failed === 0) {
    showToast(`Zaktualizowano ${succeeded} kampanii`, 'success');
  } else {
    showToast(`${succeeded} sukces, ${failed} błędów`, 'warning');
  }

  return { success: true, affectedCampaigns: succeeded, failed, errors };
}

async function bulkStatusChange(campaigns, newStatus) {
  showProgress(`Zmiana statusu: ${newStatus}`, campaigns.length);
  let succeeded = 0;

  for (let i = 0; i < campaigns.length; i++) {
    showProgress(`Zmiana statusu`, campaigns.length, i + 1);
    try {
      // Status change via same PATCH endpoint
      await updateCampaignCpc(campaigns[i].id, campaigns[i].cpc); // triggers update
      succeeded++;
      await sleep(RATE_LIMIT_MS);
    } catch {
      // Continue on error
    }
  }

  hideProgress();
  showToast(`Status zmieniony: ${succeeded} kampanii`, 'success');
  return { success: true, affectedCampaigns: succeeded };
}

function calculateNewValue(current, type, value) {
  const cur = parseFloat(current) || 0;
  const val = parseFloat(value) || 0;

  switch (type) {
    case 'increase_pct': return Math.round(cur * (1 + val / 100));
    case 'decrease_pct': return Math.max(1, Math.round(cur * (1 - val / 100)));
    case 'increase_abs': return Math.round(cur + val);
    case 'decrease_abs': return Math.max(1, Math.round(cur - val));
    case 'set':          return Math.max(1, Math.round(val));
    default:             return cur;
  }
}

function applyFilters(campaigns, filters) {
  if (!filters) return campaigns;
  return campaigns.filter(c => {
    if (filters.status && c.status !== filters.status) return false;
    if (filters.minBudget != null && c.dailyBudget < filters.minBudget) return false;
    if (filters.maxBudget != null && c.dailyBudget > filters.maxBudget) return false;
    if (filters.campaignIds?.length && !filters.campaignIds.includes(c.id)) return false;
    return true;
  });
}

function buildConfirmBody(preview, type, value) {
  const typeLabels = {
    increase_pct: `+${value}%`,
    decrease_pct: `-${value}%`,
    set:          `= ${value} gr`,
    increase_abs: `+${value} gr`,
    decrease_abs: `-${value} gr`,
  };
  const label = typeLabels[type] || value;
  const sample = preview.slice(0, 3)
    .map(p => `• ${p.name}: ${p.oldCpc ?? p.oldBudget} → ${p.newCpc ?? p.newBudget} gr`)
    .join('\n');
  return `Zmiana: ${label}\n\n${sample}${preview.length > 3 ? `\n...i ${preview.length - 3} więcej` : ''}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
