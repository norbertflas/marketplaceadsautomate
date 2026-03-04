import React, { useState, useEffect } from 'react';

const DAYS = [
  { id: 1, label: 'Pn' },
  { id: 2, label: 'Wt' },
  { id: 3, label: 'Śr' },
  { id: 4, label: 'Cz' },
  { id: 5, label: 'Pt' },
  { id: 6, label: 'Sb' },
  { id: 0, label: 'Nd' },
];

const ACTION_TYPES = [
  { value: 'decrease_pct', label: 'Obniż CPC o %' },
  { value: 'increase_pct', label: 'Zwiększ CPC o %' },
  { value: 'set',          label: 'Ustaw CPC na gr' },
  { value: 'decrease_abs', label: 'Obniż CPC o gr' },
  { value: 'increase_abs', label: 'Zwiększ CPC o gr' },
];

const DEFAULT_FORM = {
  name: '',
  enabled: true,
  days: [1, 2, 3, 4, 5],
  hour: 22,
  minute: 0,
  action: { type: 'decrease_pct', value: 20 },
  filters: { status: 'ACTIVE' },
};

export default function Scheduler({ license }) {
  const [schedules, setSchedules] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  const hasAccess = license?.plan && ['standard', 'pro', 'pro_ai', 'agency_starter', 'agency_pro', 'agency_elite'].includes(license.plan);

  useEffect(() => {
    loadSchedules();
  }, []);

  async function loadSchedules() {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (resp?.success) setSchedules(resp.data.schedules || []);
  }

  async function saveSchedule() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const schedule = {
        ...form,
        id: editId || `sch_${Date.now()}`,
      };
      await chrome.runtime.sendMessage({ type: 'SAVE_SCHEDULE', schedule });
      setShowForm(false);
      setEditId(null);
      setForm(DEFAULT_FORM);
      await loadSchedules();
    } finally {
      setSaving(false);
    }
  }

  async function deleteSchedule(id) {
    await chrome.runtime.sendMessage({ type: 'DELETE_SCHEDULE', id });
    await loadSchedules();
  }

  async function toggleSchedule(schedule) {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SCHEDULE',
      schedule: { ...schedule, enabled: !schedule.enabled },
    });
    await loadSchedules();
  }

  function editSchedule(s) {
    setForm(s);
    setEditId(s.id);
    setShowForm(true);
  }

  function toggleDay(dayId) {
    const days = form.days.includes(dayId)
      ? form.days.filter(d => d !== dayId)
      : [...form.days, dayId];
    setForm(f => ({ ...f, days }));
  }

  function describeSchedule(s) {
    const dayNames = DAYS.reduce((acc, d) => ({ ...acc, [d.id]: d.label }), {});
    const days = s.days.sort((a, b) => {
      const order = [1,2,3,4,5,6,0];
      return order.indexOf(a) - order.indexOf(b);
    }).map(d => dayNames[d]).join(', ');
    const time = `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`;
    const a = s.action;
    const actionStr = a.type.includes('pct')
      ? `${a.type === 'increase_pct' ? '+' : '-'}${a.value}% CPC`
      : `CPC = ${a.value} gr`;
    return `${days} o ${time} → ${actionStr}`;
  }

  if (!hasAccess) {
    return (
      <div>
        <div className="alert alert-warning">
          ⚠️ Harmonogram wymaga planu Standard lub wyższego.
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">🕐</div>
          <div className="empty-state-title">Automatyczny harmonogram CPC</div>
          <div className="empty-state-desc">
            Ustaw automatyczne zmiany stawek wg godziny i dnia tygodnia.<br />
            Np. obniż CPC o 30% w weekendy o 22:00.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!showForm ? (
        <>
          <button className="btn btn-primary btn-full" style={{ marginBottom: 12 }} onClick={() => { setShowForm(true); setEditId(null); setForm(DEFAULT_FORM); }}>
            + Nowy harmonogram
          </button>

          {schedules.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🕐</div>
              <div className="empty-state-title">Brak harmonogramów</div>
              <div className="empty-state-desc">Dodaj pierwszy harmonogram klikając przycisk powyżej.</div>
            </div>
          ) : (
            <div className="card" style={{ padding: '6px 14px' }}>
              {schedules.map(s => (
                <div key={s.id} className="schedule-item">
                  <label className="toggle">
                    <input type="checkbox" checked={s.enabled} onChange={() => toggleSchedule(s)} />
                    <span className="toggle-slider" />
                  </label>
                  <div className="schedule-info">
                    <div className="schedule-name">{s.name}</div>
                    <div className="schedule-desc">{describeSchedule(s)}</div>
                  </div>
                  <div className="schedule-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => editSchedule(s)} title="Edytuj">✏️</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteSchedule(s.id)} title="Usuń">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="alert alert-info" style={{ marginTop: 12, fontSize: 12 }}>
            ℹ️ Harmonogram działa tylko gdy przeglądarka jest otwarta i jesteś zalogowany na salescenter.allegro.com
          </div>
        </>
      ) : (
        <div>
          <div className="card">
            <div className="card-title">{editId ? 'Edytuj harmonogram' : 'Nowy harmonogram'}</div>

            <div className="form-group">
              <label>Nazwa</label>
              <input
                type="text"
                placeholder="np. Nocna redukcja CPC"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Dni tygodnia</label>
              <div className="day-picker">
                {DAYS.map(d => (
                  <button
                    key={d.id}
                    className={`day-btn ${form.days.includes(d.id) ? 'selected' : ''}`}
                    onClick={() => toggleDay(d.id)}
                    type="button"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="input-row">
              <div className="form-group">
                <label>Godzina</label>
                <input
                  type="number"
                  min={0} max={23}
                  value={form.hour}
                  onChange={e => setForm(f => ({ ...f, hour: parseInt(e.target.value) }))}
                />
              </div>
              <div className="form-group">
                <label>Minuta</label>
                <input
                  type="number"
                  min={0} max={59} step={5}
                  value={form.minute}
                  onChange={e => setForm(f => ({ ...f, minute: parseInt(e.target.value) }))}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Akcja</label>
              <select
                value={form.action.type}
                onChange={e => setForm(f => ({ ...f, action: { ...f.action, type: e.target.value } }))}
              >
                {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>
                Wartość: <strong style={{ color: 'var(--accent)' }}>
                  {form.action.type.includes('pct') ? `${form.action.value}%` : `${form.action.value} gr`}
                </strong>
              </label>
              <div className="slider-row">
                <input
                  type="range"
                  min={1}
                  max={form.action.type.includes('pct') ? 100 : 500}
                  value={form.action.value}
                  onChange={e => setForm(f => ({ ...f, action: { ...f.action, value: parseInt(e.target.value) } }))}
                />
                <input
                  type="number"
                  min={1}
                  value={form.action.value}
                  onChange={e => setForm(f => ({ ...f, action: { ...f.action, value: parseInt(e.target.value) } }))}
                  style={{ width: 70 }}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Filtruj kampanie</label>
              <select
                value={form.filters?.status || ''}
                onChange={e => setForm(f => ({ ...f, filters: { ...f.filters, status: e.target.value || undefined } }))}
              >
                <option value="">Wszystkie kampanie</option>
                <option value="ACTIVE">Tylko aktywne</option>
                <option value="PAUSED">Tylko wstrzymane</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => { setShowForm(false); setEditId(null); }}>
              Anuluj
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={saveSchedule}
              disabled={saving || !form.name.trim() || form.days.length === 0}
            >
              {saving ? 'Zapisywanie...' : 'Zapisz harmonogram'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
