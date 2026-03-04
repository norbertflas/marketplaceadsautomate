import React, { useState, useEffect } from 'react';

const PLAN_NAMES = {
  free:          'Brak licencji',
  starter:       'Starter (darmowy)',
  standard:      'Standard – 19 zł/mies.',
  pro:           'Pro – 39 zł/mies.',
  pro_ai:        'Pro AI – 59 zł/mies.',
  agency_starter:'Agency Starter – 99 zł/mies.',
  agency_pro:    'Agency Pro – 249 zł/mies.',
  agency_elite:  'Agency Elite – 499 zł/mies.',
};

export default function Settings({ license, onLicenseChange }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateResult, setActivateResult] = useState(null);
  const [settings, setSettings] = useState({
    vatRate: 23,
    billingDayStart: 26,
    notifications: true,
    darkMode: false,
    backendUrl: 'https://api.allegro-ads-automate.pl',
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (resp?.success?.data?.settings) {
      setSettings(s => ({ ...s, ...resp.success.data.settings }));
    }
    // Try again with proper response
    if (resp?.data?.settings) {
      setSettings(s => ({ ...s, ...resp.data.settings }));
    }
  }

  async function activateLicense() {
    if (!licenseKey.trim()) return;
    setActivating(true);
    setActivateResult(null);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'ACTIVATE_LICENSE', key: licenseKey.trim() });
      setActivateResult(resp);
      if (resp?.success && resp?.license) {
        onLicenseChange(resp.license);
      }
    } finally {
      setActivating(false);
    }
  }

  async function saveSettings() {
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }

  async function deactivateLicense() {
    if (!confirm('Czy na pewno chcesz dezaktywować licencję?')) return;
    await chrome.storage.local.set({ license: null });
    onLicenseChange(null);
  }

  const planName = PLAN_NAMES[license?.plan] || PLAN_NAMES.free;
  const isActive = license?.plan && license.plan !== 'free';
  const expiresAt = license?.expiresAt ? new Date(license.expiresAt).toLocaleDateString('pl-PL') : null;

  return (
    <div>
      {/* License section */}
      <div className="card">
        <div className="card-title">🔑 Licencja</div>

        {isActive ? (
          <>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Plan:</span>
                <strong>{planName}</strong>
              </div>
              {license.allegroLogin && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Konto Allegro:</span>
                  <span>{license.allegroLogin}</span>
                </div>
              )}
              {expiresAt && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Ważna do:</span>
                  <span>{expiresAt}</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <a
                href="https://allegro-ads-automate.pl/konto"
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ textDecoration: 'none', flex: 1, textAlign: 'center' }}
              >
                Zarządzaj subskrypcją
              </a>
              <button className="btn btn-danger btn-sm" onClick={deactivateLicense}>
                Dezaktywuj
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="alert alert-warning" style={{ marginBottom: 10 }}>
              ⚠️ Brak aktywnej licencji. Większość funkcji jest zablokowana.
            </div>
            <div className="form-group">
              <label>Klucz licencyjny</label>
              <input
                type="text"
                placeholder="AAA-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={e => setLicenseKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && activateLicense()}
              />
            </div>
            <button
              className="btn btn-primary btn-full"
              onClick={activateLicense}
              disabled={activating || !licenseKey.trim()}
            >
              {activating ? 'Weryfikacja...' : 'Aktywuj licencję'}
            </button>
            {activateResult && (
              <div className={`alert ${activateResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 8 }}>
                {activateResult.success
                  ? `✓ Licencja aktywowana: ${PLAN_NAMES[activateResult.license?.plan] || ''}`
                  : `✕ ${activateResult.error}`
                }
              </div>
            )}
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <a
                href="https://allegro-ads-automate.pl/cennik"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, color: 'var(--accent)' }}
              >
                Kup licencję → od 19 zł/mies. (30 dni za darmo)
              </a>
            </div>
          </>
        )}
      </div>

      {/* Settings section */}
      <div className="card">
        <div className="card-title">⚙️ Ustawienia</div>

        <div className="form-group">
          <label>Stawka VAT (%)</label>
          <input
            type="number"
            min={0} max={100}
            value={settings.vatRate}
            onChange={e => setSettings(s => ({ ...s, vatRate: parseInt(e.target.value) }))}
          />
        </div>

        <div className="form-group">
          <label>Dzień początku okresu rozliczeniowego</label>
          <input
            type="number"
            min={1} max={31}
            value={settings.billingDayStart}
            onChange={e => setSettings(s => ({ ...s, billingDayStart: parseInt(e.target.value) }))}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
            Allegro: domyślnie 26. dnia miesiąca
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Powiadomienia</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Po wykonaniu harmonogramu</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={e => setSettings(s => ({ ...s, notifications: e.target.checked }))}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Tryb ciemny</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Panel Allegro Ads</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.darkMode}
              onChange={e => setSettings(s => ({ ...s, darkMode: e.target.checked }))}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <button
          className="btn btn-primary btn-full"
          onClick={saveSettings}
        >
          {settingsSaved ? '✓ Zapisano' : 'Zapisz ustawienia'}
        </button>
      </div>

      {/* About */}
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
        Allegro Ads Automate v1.0.0 ·{' '}
        <a href="https://allegro-ads-automate.pl" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          allegro-ads-automate.pl
        </a>
      </div>
    </div>
  );
}
