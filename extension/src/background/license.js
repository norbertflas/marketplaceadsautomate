/**
 * License validation module
 */

const LICENSE_CHECK_INTERVAL_HOURS = 24;

export async function validateLicense(force = false) {
  const { license, settings } = await chrome.storage.local.get(['license', 'settings']);

  if (!license?.key) {
    return { valid: false, reason: 'no_license' };
  }

  // Check if we need to re-validate
  const lastValidated = license.validatedAt ? new Date(license.validatedAt) : null;
  const hoursSince = lastValidated
    ? (Date.now() - lastValidated.getTime()) / 1000 / 3600
    : Infinity;

  if (!force && hoursSince < LICENSE_CHECK_INTERVAL_HOURS) {
    // Use cached license if not expired
    const expired = license.expiresAt && new Date(license.expiresAt) < new Date();
    return { valid: !expired, plan: license.plan, cached: true };
  }

  try {
    const backendUrl = settings?.backendUrl || 'https://api.allegro-ads-automate.pl';
    const resp = await fetch(`${backendUrl}/api/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: license.key }),
    });

    const data = await resp.json();

    await chrome.storage.local.set({
      license: {
        ...license,
        plan: data.plan,
        expiresAt: data.expiresAt,
        allegroLogin: data.allegroLogin,
        validatedAt: new Date().toISOString(),
        valid: data.valid,
      },
    });

    return { valid: data.valid, plan: data.plan };
  } catch {
    // Offline: trust local cache if not expired
    const expired = license.expiresAt && new Date(license.expiresAt) < new Date();
    return { valid: !expired, plan: license.plan, offline: true };
  }
}

export function getPlanFeatures(plan) {
  const features = {
    free: {
      scheduler: false,
      globalCpc: false,
      bulkEdit: false,
      history: false,
      reports: false,
      portfolio: false,
      ai: false,
      maxCampaigns: 0,
    },
    starter: {
      scheduler: false,
      globalCpc: false,
      bulkEdit: false,
      history: false,
      reports: false,
      portfolio: false,
      ai: false,
      maxCampaigns: 0,
      keywordPlanner: true,
      darkMode: true,
    },
    standard: {
      scheduler: true,
      globalCpc: true,
      bulkEdit: true,
      history: true,
      reports: true,
      portfolio: false,
      ai: false,
      maxCampaigns: 500,
      keywordPlanner: true,
      darkMode: true,
    },
    pro: {
      scheduler: true,
      globalCpc: true,
      bulkEdit: true,
      history: true,
      reports: true,
      portfolio: true,
      ai: false,
      maxCampaigns: 2000,
      keywordPlanner: true,
      darkMode: true,
      abTesting: true,
      alerts: true,
    },
    pro_ai: {
      scheduler: true,
      globalCpc: true,
      bulkEdit: true,
      history: true,
      reports: true,
      portfolio: true,
      ai: true,
      maxCampaigns: Infinity,
      keywordPlanner: true,
      darkMode: true,
      abTesting: true,
      alerts: true,
    },
  };

  return features[plan] || features.free;
}
