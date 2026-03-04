/**
 * Content Script – injected on salescenter.allegro.com
 * Orchestrates: API interception, UI injection, schedule execution
 */

import './content.css';
import { setupApiInterceptor, fetchCampaigns, updateCampaignCpc, updateCampaignBudget } from './api-interceptor.js';
import { injectUI, showToast, showProgress, hideProgress } from './ui-injector.js';
import { executeGlobalCpcChange, executeBulkAction } from './campaign-manager.js';

// ── Init ──────────────────────────────────────────────────────────────────

(function init() {
  setupApiInterceptor();
  injectUI();
  listenForMessages();
  console.log('[Allegro Ads Automate] Content script loaded');
})();

// ── Message Listener ──────────────────────────────────────────────────────

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleContentMessage(message)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  });
}

async function handleContentMessage(message) {
  switch (message.type) {
    case 'EXECUTE_SCHEDULE':
      return executeScheduleAction(message.schedule);

    case 'EXECUTE_UNDO':
      return executeUndo(message.entry);

    case 'GET_CAMPAIGNS':
      return fetchCampaigns();

    case 'GLOBAL_CPC_CHANGE':
      return executeGlobalCpcChange(message.params);

    case 'BULK_ACTION':
      return executeBulkAction(message.params);

    default:
      return { success: false, error: `Unknown message: ${message.type}` };
  }
}

// ── Schedule Execution ────────────────────────────────────────────────────

async function executeScheduleAction(schedule) {
  const { action, filters } = schedule;

  try {
    const campaigns = await fetchCampaigns();
    const filtered = applyFilters(campaigns, filters);

    if (!filtered.length) {
      return { success: true, affectedCampaigns: 0, warning: 'No campaigns matched filters' };
    }

    showProgress(`Harmonogram: ${schedule.name}`, filtered.length);

    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < filtered.length; i++) {
      const campaign = filtered[i];
      showProgress(`Harmonogram: ${schedule.name}`, filtered.length, i + 1);

      try {
        const newCpc = calculateNewCpc(campaign.cpc, action);
        await updateCampaignCpc(campaign.id, newCpc);

        // Log to background
        await chrome.runtime.sendMessage({
          type: 'LOG_CHANGE',
          entry: {
            type: 'cpc_change',
            source: 'scheduler',
            scheduleName: schedule.name,
            campaignId: campaign.id,
            campaignName: campaign.name,
            previousValue: campaign.cpc,
            newValue: newCpc,
            status: 'success',
          },
        });

        succeeded++;
        await sleep(150); // Rate limiting – 150ms between requests
      } catch (err) {
        failed++;
        errors.push({ campaignId: campaign.id, error: err.message });
      }
    }

    hideProgress();

    const msg = `Harmonogram wykonany: ${succeeded} kampanii zaktualizowanych${failed ? `, ${failed} błędów` : ''}`;
    showToast(msg, failed > 0 ? 'warning' : 'success');

    return { success: true, affectedCampaigns: succeeded, failed, errors };
  } catch (err) {
    hideProgress();
    showToast(`Błąd harmonogramu: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

// ── Undo ──────────────────────────────────────────────────────────────────

async function executeUndo(entry) {
  if (!entry.campaignId || entry.previousValue === undefined) {
    return { success: false, error: 'Missing undo data' };
  }

  try {
    if (entry.type === 'cpc_change') {
      await updateCampaignCpc(entry.campaignId, entry.previousValue);
    } else if (entry.type === 'budget_change') {
      await updateCampaignBudget(entry.campaignId, entry.previousValue);
    } else {
      return { success: false, error: `Cannot undo action type: ${entry.type}` };
    }

    showToast(`Cofnięto: ${entry.campaignName} → CPC ${entry.previousValue} gr`, 'success');
    return { success: true };
  } catch (err) {
    showToast(`Błąd cofania: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function calculateNewCpc(currentCpc, action) {
  const current = parseFloat(currentCpc) || 0;
  const value = parseFloat(action.value) || 0;

  switch (action.type) {
    case 'increase_pct':
      return Math.round(current * (1 + value / 100));
    case 'decrease_pct':
      return Math.max(1, Math.round(current * (1 - value / 100)));
    case 'set':
      return Math.max(1, Math.round(value));
    case 'increase_abs':
      return Math.round(current + value);
    case 'decrease_abs':
      return Math.max(1, Math.round(current - value));
    default:
      return current;
  }
}

function applyFilters(campaigns, filters) {
  if (!filters) return campaigns;

  return campaigns.filter(c => {
    if (filters.status && c.status !== filters.status) return false;
    if (filters.minBudget && c.dailyBudget < filters.minBudget) return false;
    if (filters.maxBudget && c.dailyBudget > filters.maxBudget) return false;
    if (filters.campaignIds?.length && !filters.campaignIds.includes(c.id)) return false;
    return true;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
