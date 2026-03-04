import React, { useState, useEffect } from 'react';

const TYPE_LABELS = {
  cpc_change:    'Zmiana CPC',
  budget_change: 'Zmiana budżetu',
  schedule:      'Harmonogram',
  status_change: 'Zmiana statusu',
};

const SOURCE_LABELS = {
  manual:    'Ręcznie',
  scheduler: 'Auto',
};

export default function History({ license }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoading(true);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      if (resp?.success) setHistory(resp.history || []);
    } finally {
      setLoading(false);
    }
  }

  async function undoEntry(entry) {
    setUndoing(entry.id);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'UNDO_CHANGE', entryId: entry.id });
      if (resp?.success) {
        await loadHistory();
      } else {
        alert(`Nie można cofnąć: ${resp?.error || 'Nieznany błąd'}`);
      }
    } finally {
      setUndoing(null);
    }
  }

  async function clearHistory() {
    if (!confirm('Usunąć całą historię zmian?')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    setHistory([]);
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function formatChange(entry) {
    if (entry.type === 'cpc_change') {
      return `CPC: ${entry.previousValue ?? '?'} → ${entry.newValue ?? '?'} gr`;
    }
    if (entry.type === 'budget_change') {
      return `Budżet: ${entry.previousValue ?? '?'} → ${entry.newValue ?? '?'} gr/dzień`;
    }
    if (entry.type === 'schedule') {
      return `${entry.scheduleName}: ${entry.success ? `+${entry.affectedCampaigns ?? 0} kampanii` : entry.error}`;
    }
    return JSON.stringify(entry.newValue ?? '');
  }

  const filtered = filter === 'all' ? history : history.filter(e => e.source === filter || e.type === filter);

  const hasAccess = license?.plan && license.plan !== 'free';

  if (!hasAccess) {
    return (
      <div>
        <div className="alert alert-warning">⚠️ Historia zmian wymaga planu Standard lub wyższego.</div>
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">Historia zmian</div>
          <div className="empty-state-desc">Pełny log wszystkich działań z możliwością cofnięcia jednym kliknięciem.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}
        >
          <option value="all">Wszystkie</option>
          <option value="manual">Ręczne</option>
          <option value="scheduler">Harmonogram</option>
          <option value="cpc_change">Zmiany CPC</option>
          <option value="budget_change">Zmiany budżetu</option>
        </select>

        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={loadHistory}>↻</button>
          {history.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={clearHistory}>🗑 Wyczyść</button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Ładowanie...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">Brak historii</div>
          <div className="empty-state-desc">
            Historia zmian pojawi się po pierwszej operacji na kampaniach.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '4px 14px' }}>
          {filtered.slice(0, 50).map(entry => (
            <div
              key={entry.id}
              className={`history-item ${entry.undone ? 'history-undone' : ''}`}
            >
              <div style={{ marginTop: 2 }}>
                <span
                  className="status-dot"
                  style={{ background: entry.status === 'success' || entry.success ? 'var(--success)' : 'var(--error)' }}
                />
              </div>
              <div className="history-main">
                <div className="history-campaign">
                  {entry.campaignName || entry.scheduleName || 'N/A'}
                </div>
                <div className="history-detail">{formatChange(entry)}</div>
                <div className="history-source">
                  {SOURCE_LABELS[entry.source] || entry.source}
                  {entry.undone && ' · cofnięto'}
                </div>
              </div>
              <div className="history-meta">
                <div className="history-time">{formatTime(entry.timestamp)}</div>
                {!entry.undone && entry.previousValue !== undefined && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 4, fontSize: 11, padding: '3px 7px' }}
                    onClick={() => undoEntry(entry)}
                    disabled={undoing === entry.id}
                    title="Cofnij tę zmianę"
                  >
                    {undoing === entry.id ? '...' : '↩ Cofnij'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {filtered.length > 50 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>
              Pokazano ostatnie 50 z {filtered.length} wpisów
            </div>
          )}
        </div>
      )}
    </div>
  );
}
