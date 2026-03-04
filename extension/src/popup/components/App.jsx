import React, { useState, useEffect } from 'react';
import Dashboard from './Dashboard.jsx';
import Scheduler from './Scheduler.jsx';
import History from './History.jsx';
import Settings from './Settings.jsx';

const TABS = [
  { id: 'dashboard', label: 'CPC', icon: '⚡' },
  { id: 'scheduler', label: 'Harmonogram', icon: '🕐' },
  { id: 'history',   label: 'Historia', icon: '📋' },
  { id: 'settings',  label: 'Ustawienia', icon: '⚙️' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [license, setLicense] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadState();
  }, []);

  async function loadState() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (resp?.success) {
        setLicense(resp.data.license);
      }
    } catch (err) {
      console.error('Failed to load state:', err);
    } finally {
      setLoading(false);
    }
  }

  const planLabel = license?.plan || 'free';
  const planBadge = `badge-${planLabel}`;

  if (loading) {
    return (
      <div className="popup-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="popup-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Allegro Ads Automate
        </div>
        <span className={`popup-license-badge ${planBadge}`}>
          {planLabel === 'free' ? 'Brak licencji' : planLabel.replace('_', ' ')}
        </span>
      </header>

      <nav className="tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="tab-content">
        {activeTab === 'dashboard' && <Dashboard license={license} />}
        {activeTab === 'scheduler' && <Scheduler license={license} />}
        {activeTab === 'history'   && <History license={license} />}
        {activeTab === 'settings'  && <Settings license={license} onLicenseChange={setLicense} />}
      </div>
    </div>
  );
}
