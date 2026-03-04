import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './options.css';

function OptionsPage() {
  const [license, setLicense] = useState(null);
  const [settings, setSettings] = useState({
    vatRate: 23,
    billingDayStart: 26,
    notifications: true,
    darkMode: false,
    backendUrl: 'https://api.allegro-ads-automate.pl',
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['license', 'settings'], (data) => {
      if (data.license) setLicense(data.license);
      if (data.settings) setSettings(s => ({ ...s, ...data.settings }));
    });
  }, []);

  async function handleSave() {
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const update = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setSettings(s => ({ ...s, [key]: value }));
  };

  return (
    <div className="options-container">
      <header className="options-header">
        <div className="options-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Allegro Ads Automate
        </div>
        {license?.plan && (
          <span className="options-plan-badge">{license.plan.replace('_', ' ').toUpperCase()}</span>
        )}
      </header>

      <main className="options-main">

        {/* Reports */}
        <section className="options-section">
          <h2>📊 Raporty netto</h2>
          <div className="options-field">
            <label>Stawka VAT (%)</label>
            <input type="number" min={0} max={100} value={settings.vatRate} onChange={update('vatRate')} />
            <div className="field-desc">Używana do przeliczania kwot brutto na netto w raportach. Polska: 23%.</div>
          </div>
          <div className="options-field">
            <label>Dzień początku okresu rozliczeniowego</label>
            <input type="number" min={1} max={31} value={settings.billingDayStart} onChange={update('billingDayStart')} />
            <div className="field-desc">
              Allegro Ads rozlicza od 26. do 25. następnego miesiąca. Zmień jeśli Twój cykl jest inny.
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="options-section">
          <h2>🔔 Powiadomienia</h2>
          <div className="options-field options-field-toggle">
            <div>
              <strong>Powiadomienia systemowe</strong>
              <div className="field-desc">Wyświetlaj powiadomienie po wykonaniu harmonogramu i ważnych zdarzeniach.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.notifications} onChange={update('notifications')} />
              <span className="toggle-slider" />
            </label>
          </div>
        </section>

        {/* Appearance */}
        <section className="options-section">
          <h2>🎨 Wygląd</h2>
          <div className="options-field options-field-toggle">
            <div>
              <strong>Tryb ciemny panelu</strong>
              <div className="field-desc">Przebudowuje CSS panelu salescenter.allegro.com na ciemny motyw.</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.darkMode} onChange={update('darkMode')} />
              <span className="toggle-slider" />
            </label>
          </div>
        </section>

        {/* Backend */}
        <section className="options-section">
          <h2>🔧 Zaawansowane</h2>
          <div className="options-field">
            <label>URL serwera licencji</label>
            <input
              type="url"
              value={settings.backendUrl}
              onChange={update('backendUrl')}
              style={{ maxWidth: '100%' }}
            />
            <div className="field-desc">Nie zmieniaj chyba że wiesz co robisz. Domyślnie: https://api.allegro-ads-automate.pl</div>
          </div>
        </section>

        <div className="options-actions">
          <button className="options-save-btn" onClick={handleSave}>
            {saved ? '✓ Zapisano' : 'Zapisz ustawienia'}
          </button>
        </div>
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<OptionsPage />);
