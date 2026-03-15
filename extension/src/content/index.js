/**
 * Content Script – injected on salescenter.allegro.com
 * Orchestrates: API interception, UI injection, schedule execution
 */

import './content.css';
import { setupApiInterceptor, fetchCampaigns, updateCampaignCpc, updateCampaignBudget, removeOfferFromCampaign, fetchCampaignStats } from './api-interceptor.js';
import { injectUI, showToast, showProgress, hideProgress, watchOfferStatsPage } from './ui-injector.js';
import { executeGlobalCpcChange, executeBulkAction } from './campaign-manager.js';

// ── Init ──────────────────────────────────────────────────────────────────

(function init() {
  setupApiInterceptor();
  injectUI();
  watchOfferStatsPage();
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

    case 'REMOVE_OFFER_FROM_CAMPAIGN':
      return removeOfferFromCampaign(message.campaignId, message.offerId);

    case 'CHECK_PORTFOLIO_BUDGETS':
      return checkPortfolioBudgets();

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

// ── Portfolio Budget Check ────────────────────────────────────────────────

async function checkPortfolioBudgets() {
  const { portfolios } = await chrome.storage.local.get('portfolios');
  const activePortfolios = (portfolios || []).filter(p => p.active && p.campaignIds?.length);
  if (!activePortfolios.length) return { success: true, updated: false };

  // Fetch campaigns with latest stats
  let campaigns;
  try {
    campaigns = await fetchCampaignStats();
  } catch {
    const result = await fetchCampaigns();
    campaigns = result.campaigns || [];
  }

  const spendMap = {};
  let anyExceeded = false;

  for (const portfolio of activePortfolios) {
    // Sum spend for all campaigns in this portfolio
    let totalSpendGr = 0;
    for (const cid of portfolio.campaignIds) {
      const c = campaigns.find(x => x.id === cid);
      if (c?.stats?.cost) {
        totalSpendGr += Math.round(parseFloat(c.stats.cost) || 0);
      } else if (c?.stats?.spend) {
        totalSpendGr += Math.round(parseFloat(c.stats.spend) || 0);
      }
    }
    spendMap[portfolio.id] = totalSpendGr;

    const exceeded = totalSpendGr >= portfolio.budgetGr;
    if (exceeded) {
      anyExceeded = true;
      // Pause all active campaigns in this portfolio
      const targets = campaigns.filter(
        c => portfolio.campaignIds.includes(c.id) &&
             (c.status === 'ACTIVE' || c.status === 'ENABLED')
      );
      for (const c of targets) {
        try {
          await pauseCampaign(c.id);
          await sleep(150);
        } catch {
          /* continue */
        }
      }
      showToast(
        `Portfel „${portfolio.name}" przekroczył budżet – kampanie wstrzymane`,
        'warning',
        6000
      );
    }
  }

  // Persist updated spend values
  await chrome.runtime.sendMessage({ type: 'UPDATE_PORTFOLIO_SPEND', spendMap });

  return { success: true, updated: true, anyExceeded };
}

async function pauseCampaign(campaignId) {
  const { getSessionToken } = await import('./api-interceptor.js');
  const token = getSessionToken();
  if (!token) return;

  const endpoints = [
    `https://edge.salescenter.allegro.com/ads/v1/campaigns/${campaignId}`,
    `https://salescenter.allegro.com/api/v1/ads/campaigns/${campaignId}`,
  ];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ status: 'PAUSED' }),
      });
      if (resp.ok || resp.status === 204) return;
    } catch {
      continue;
    }
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
