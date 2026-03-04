import React, { useState, useEffect } from 'react';

const ACTION_TYPES = [
  { value: 'increase_pct', label: '+X% (procentowo w górę)' },
  { value: 'decrease_pct', label: '-X% (procentowo w dół)' },
  { value: 'set',          label: 'Ustaw na X gr' },
  { value: 'increase_abs', label: '+X gr (dodaj)' },
  { value: 'decrease_abs', label: '-X gr (odejmij)' },
];

export default function Dashboard({ license }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionType, setActionType] = useState('decrease_pct');
  const [actionValue, setActionValue] = useState(10);
  const [filterStatus, setFilterStatus] = useState('');
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  const hasAccess = license?.plan && license.plan !== 'free';

  useEffect(() => {
    if (hasAccess) loadCampaigns();
  }, [hasAccess]);

  async function loadCampaigns() {
    setLoading(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('salescenter.allegro.com')) {
        setCampaigns([]);
        return;
      }
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CAMPAIGNS' });
      if (resp?.success) setCampaigns(resp.campaigns || []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }

  async function applyGlobalChange() {
    if (!hasAccess) return;
    setApplying(true);
    setResult(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('Brak aktywnej zakładki');

      const resp = await chrome.tabs.sendMessage(tab.id, {
        type: 'GLOBAL_CPC_CHANGE',
        params: {
          type: actionType,
          value: parseFloat(actionValue),
          filters: filterStatus ? { status: filterStatus } : null,
          dryRun: false,
        },
      });

      setResult(resp);
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setApplying(false);
    }
  }

  async function previewChange() {
    if (!hasAccess) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const resp = await chrome.tabs.sendMessage(tab.id, {
        type: 'GLOBAL_CPC_CHANGE',
        params: {
          type: actionType,
          value: parseFloat(actionValue),
          filters: filterStatus ? { status: filterStatus } : null,
          dryRun: true,
        },
      });
      if (resp?.preview) {
        setResult({ ...resp, preview: resp.preview.slice(0, 5) });
      }
    } catch (err) {
      setResult({ success: false, error: err.message });
    }
  }

  if (!hasAccess) {
    return (
      <div>
        <div className="alert alert-warning">
          ⚠️ Ta funkcja wymaga planu Standard lub wyższego.
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-title">Aktywuj licencję</div>
          <div className="empty-state-desc">
            Przejdź do zakładki Ustawienia i aktywuj klucz licencyjny.
          </div>
        </div>
        <a
          href="https://allegro-ads-automate.pl/cennik"
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary btn-full"
          style={{ marginTop: 12, textDecoration: 'none' }}
        >
          Kup licencję – od 19 zł/mies.
        </a>
      </div>
    );
  }

  const isAllegroTab = true; // will check in loadCampaigns

  return (
    <div>
      {/* Quick Stats */}
      {campaigns.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Kampanie załadowane:</span>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{campaigns.length}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            <span>Aktywne:</span>
            <span style={{ fontWeight: 600, color: 'var(--success)' }}>
              {campaigns.filter(c => c.status === 'ACTIVE' || c.status === 'ENABLED').length}
            </span>
          </div>
        </div>
      )}

      {/* Global CPC Change */}
      <div className="card">
        <div className="card-title">⚡ Globalna zmiana CPC</div>

        <div className="form-group">
          <label>Typ zmiany</label>
          <select value={actionType} onChange={e => setActionType(e.target.value)}>
            {ACTION_TYPES.map(a => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>
            Wartość: <strong style={{ color: 'var(--accent)' }}>
              {actionType.includes('pct') ? `${actionValue}%` : `${actionValue} gr`}
            </strong>
          </label>
          <div className="slider-row">
            <input
              type="range"
              min={actionType === 'set' ? 1 : 1}
              max={actionType.includes('pct') ? 100 : 500}
              value={actionValue}
              onChange={e => setActionValue(e.target.value)}
            />
            <input
              type="number"
              value={actionValue}
              min={1}
              max={actionType.includes('pct') ? 100 : 9999}
              onChange={e => setActionValue(e.target.value)}
              style={{ width: 70 }}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Filtruj kampanie</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Wszystkie kampanie</option>
            <option value="ACTIVE">Tylko aktywne</option>
            <option value="PAUSED">Tylko wstrzymane</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={previewChange} disabled={applying}>
            Podgląd
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={applyGlobalChange} disabled={applying}>
            {applying ? 'Wykonywanie...' : 'Zastosuj do wszystkich'}
          </button>
        </div>

        {campaigns.length === 0 && !loading && (
          <div className="alert alert-info" style={{ marginTop: 10 }}>
            ℹ️ Otwórz listę kampanii w Allegro Ads, żeby załadować dane.
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className={`alert ${result.success ? 'alert-success' : 'alert-error'}`}>
          {result.success ? (
            <>
              ✓ Zaktualizowano <strong>{result.affectedCampaigns}</strong> kampanii
              {result.failed > 0 && ` (${result.failed} błędów)`}
            </>
          ) : (
            <>✕ Błąd: {result.error}</>
          )}
          {result.preview && result.preview.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: 8 }}>
              {result.preview.map(p => (
                <div key={p.id} style={{ marginBottom: 2 }}>
                  {p.name}: <strong>{p.oldCpc}</strong> → <strong>{p.newCpc}</strong> gr
                </div>
              ))}
              {result.affectedCampaigns > 5 && (
                <div style={{ color: 'var(--text-muted)' }}>...i {result.affectedCampaigns - 5} więcej</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Refresh button */}
      <button className="btn btn-ghost btn-sm btn-full" onClick={loadCampaigns} disabled={loading}>
        {loading ? 'Ładowanie...' : '↻ Odśwież kampanie'}
      </button>
    </div>
  );
}
