import React, { useState, useEffect } from 'react';

export default function Portfolio({ license }) {
  const [portfolios, setPortfolios] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBudget, setNewBudget] = useState('');
  const [selectedCampaigns, setSelectedCampaigns] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  const hasAccess = license?.plan && license.plan !== 'free';

  useEffect(() => {
    if (hasAccess) {
      loadPortfolios();
      loadCampaigns();
    }
  }, [hasAccess]);

  async function loadPortfolios() {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PORTFOLIOS' });
    if (resp?.success) setPortfolios(resp.portfolios || []);
  }

  async function loadCampaigns() {
    setLoading(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes('salescenter.allegro.com')) {
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CAMPAIGNS' });
        if (resp?.success) setCampaigns(resp.campaigns || []);
      }
    } catch {
      /* tab not available */
    } finally {
      setLoading(false);
    }
  }

  async function createPortfolio() {
    if (!newName.trim() || !newBudget) return;
    const portfolio = {
      id: `p_${Date.now()}`,
      name: newName.trim(),
      budgetGr: Math.round(parseFloat(newBudget) * 100),
      campaignIds: selectedCampaigns,
      active: true,
      spendGr: 0,
      createdAt: new Date().toISOString(),
    };
    const resp = await chrome.runtime.sendMessage({ type: 'SAVE_PORTFOLIO', portfolio });
    if (resp?.success) {
      setPortfolios(prev => [portfolio, ...prev]);
      setCreating(false);
      setNewName('');
      setNewBudget('');
      setSelectedCampaigns([]);
    }
  }

  async function deletePortfolio(id) {
    await chrome.runtime.sendMessage({ type: 'DELETE_PORTFOLIO', id });
    setPortfolios(prev => prev.filter(p => p.id !== id));
  }

  async function toggleActive(portfolio) {
    const updated = { ...portfolio, active: !portfolio.active };
    await chrome.runtime.sendMessage({ type: 'SAVE_PORTFOLIO', portfolio: updated });
    setPortfolios(prev => prev.map(p => p.id === portfolio.id ? updated : p));
  }

  async function checkBudgets() {
    setChecking(true);
    try {
      const tabs = await chrome.tabs.query({ url: 'https://salescenter.allegro.com/*' });
      if (!tabs.length) {
        alert('Otwórz Allegro Ads, aby sprawdzić budżety portfeli.');
        return;
      }
      const resp = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'CHECK_PORTFOLIO_BUDGETS',
      });
      if (resp?.updated) await loadPortfolios();
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }

  function toggleCampaign(id) {
    setSelectedCampaigns(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  }

  if (!hasAccess) {
    return (
      <div>
        <div className="alert alert-warning">
          ⚠️ Ta funkcja wymaga planu Standard lub wyższego.
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">Portfele kampanii</div>
          <div className="empty-state-desc">
            Grupuj kampanie i kontroluj łączny budżet. Kampanie zatrzymują się
            automatycznie gdy budżet portfela zostanie przekroczony.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Portfolio cards */}
      {portfolios.map(p => {
        const spendPln = (p.spendGr || 0) / 100;
        const budgetPln = (p.budgetGr || 0) / 100;
        const pct = budgetPln > 0 ? Math.min(100, (spendPln / budgetPln) * 100) : 0;
        const exceeded = pct >= 100;
        const expanded = expandedId === p.id;

        return (
          <div key={p.id} className="card" style={{ marginBottom: 8 }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {!p.active && <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>⏸</span>}
                  {p.name}
                </div>
                <div style={{ fontSize: 11, color: exceeded ? 'var(--error)' : 'var(--text-muted)', marginTop: 1 }}>
                  {exceeded
                    ? '⛔ Budżet przekroczony – kampanie zatrzymane'
                    : `${spendPln.toFixed(2)} / ${budgetPln.toFixed(2)} zł`}
                </div>
              </div>

              <button
                className="btn btn-ghost btn-sm"
                onClick={() => toggleActive(p)}
                title={p.active ? 'Dezaktywuj monitoring' : 'Aktywuj monitoring'}
                style={{ fontSize: 14 }}
              >
                {p.active ? '⏸' : '▶'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setExpandedId(expanded ? null : p.id)}
              >
                {expanded ? '▲' : '▼'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => deletePortfolio(p.id)}
                title="Usuń portfel"
              >
                ✕
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ marginTop: 6, height: 5, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${pct}%`,
                background: exceeded ? 'var(--error)' : pct > 80 ? 'var(--warning, #f59e0b)' : 'var(--accent)',
                borderRadius: 3,
                transition: 'width 0.3s',
              }} />
            </div>

            {/* Campaign list */}
            {expanded && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                  Kampanie ({p.campaignIds?.length || 0}):
                </div>
                {(p.campaignIds || []).map(cid => {
                  const c = campaigns.find(c => c.id === cid);
                  return (
                    <div key={cid} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ color: 'var(--text)' }}>• {c?.name || cid}</span>
                      <span style={{ color: c?.status === 'ACTIVE' || c?.status === 'ENABLED' ? 'var(--success)' : 'var(--error)' }}>
                        {c?.status || '?'}
                      </span>
                    </div>
                  );
                })}
                {(!p.campaignIds || p.campaignIds.length === 0) && (
                  <div style={{ color: 'var(--text-muted)' }}>Brak kampanii w portfelu</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {portfolios.length === 0 && !creating && (
        <div className="empty-state">
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">Brak portfeli</div>
          <div className="empty-state-desc">
            Utwórz portfel, aby kontrolować łączny budżet wielu kampanii.<br />
            Kampanie zatrzymają się automatycznie po przekroczeniu limitu.
          </div>
        </div>
      )}

      {/* Create form */}
      {creating ? (
        <div className="card">
          <div className="card-title">Nowy portfel</div>

          <div className="form-group">
            <label>Nazwa portfela</label>
            <input
              type="text"
              placeholder="np. Kampanie sezonowe"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Limit budżetu (zł/mies.)</label>
            <input
              type="number"
              placeholder="np. 500"
              value={newBudget}
              min="1"
              step="0.01"
              onChange={e => setNewBudget(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Kampanie ({selectedCampaigns.length} wybranych)</label>
            <div style={{
              maxHeight: 130,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 4,
            }}>
              {loading ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 6 }}>Ładowanie...</div>
              ) : campaigns.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 6 }}>
                  Otwórz listę kampanii w Allegro Ads, aby załadować dane.
                </div>
              ) : campaigns.map(c => (
                <label key={c.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 4px',
                  cursor: 'pointer',
                  fontSize: 11,
                  borderRadius: 4,
                }}>
                  <input
                    type="checkbox"
                    checked={selectedCampaigns.includes(c.id)}
                    onChange={() => toggleCampaign(c.id)}
                  />
                  <span>{c.name}</span>
                  <span style={{
                    marginLeft: 'auto',
                    color: c.status === 'ACTIVE' || c.status === 'ENABLED' ? 'var(--success)' : 'var(--text-muted)',
                    fontSize: 10,
                  }}>
                    {c.status}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => { setCreating(false); setSelectedCampaigns([]); }}>
              Anuluj
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={createPortfolio}
              disabled={!newName.trim() || !newBudget}
            >
              Utwórz portfel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setCreating(true)}>
            + Nowy portfel
          </button>
          {portfolios.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={checkBudgets}
              disabled={checking}
              title="Sprawdź wydatki i zatrzymaj przekroczone kampanie"
            >
              {checking ? '...' : '↻ Sprawdź budżety'}
            </button>
          )}
        </div>
      )}

      <div className="alert alert-info" style={{ marginTop: 10, fontSize: 11 }}>
        ℹ️ Monitoring działa gdy przeglądarka jest otwarta na salescenter.allegro.com
      </div>
    </div>
  );
}
