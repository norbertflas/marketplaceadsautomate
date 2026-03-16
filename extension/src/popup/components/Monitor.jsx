import React, { useState, useEffect, useCallback } from 'react';

const TABS = ['products', 'alerts', 'settings'];

export default function Monitor({ license }) {
  const [subTab, setSubTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [snapshots, setSnapshots] = useState([]);

  const loadData = useCallback(async () => {
    try {
      const [productsResp, alertsResp, settingsResp] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'MONITOR_GET_PRODUCTS' }),
        chrome.runtime.sendMessage({ type: 'MONITOR_GET_ALERTS', limit: 50 }),
        chrome.runtime.sendMessage({ type: 'MONITOR_GET_SETTINGS' }),
      ]);
      if (productsResp?.success !== false) setProducts(productsResp || []);
      if (alertsResp?.success !== false) setAlerts(alertsResp || []);
      if (settingsResp) setSettings(settingsResp);
    } catch (err) {
      console.error('Monitor load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleAddProduct() {
    if (!addUrl.trim()) return;
    setAddLoading(true);
    try {
      // Extract offer ID from URL or use as-is
      const offerId = extractOfferId(addUrl.trim());
      if (!offerId) {
        alert('Nieprawidlowy URL oferty Allegro');
        return;
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'MONITOR_ADD_PRODUCT',
        product: {
          offerId,
          title: `Oferta ${offerId}`,
          url: addUrl.trim().startsWith('http') ? addUrl.trim() : `https://allegro.pl/oferta/${offerId}`,
        },
      });

      if (resp?.success) {
        setAddUrl('');
        await loadData();
      } else {
        alert(resp?.error || 'Nie udalo sie dodac produktu');
      }
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRemoveProduct(offerId) {
    await chrome.runtime.sendMessage({ type: 'MONITOR_REMOVE_PRODUCT', offerId });
    await loadData();
  }

  async function handleToggleProduct(offerId, enabled) {
    await chrome.runtime.sendMessage({ type: 'MONITOR_TOGGLE_PRODUCT', offerId, enabled });
    await loadData();
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'MONITOR_CHECK_NOW' });
      if (resp?.error) {
        alert(resp.error);
      }
      await loadData();
    } finally {
      setChecking(false);
    }
  }

  async function handleMarkAllRead() {
    await chrome.runtime.sendMessage({ type: 'MONITOR_MARK_ALL_READ' });
    await loadData();
  }

  async function handleSaveSettings(newSettings) {
    await chrome.runtime.sendMessage({ type: 'MONITOR_SAVE_SETTINGS', settings: newSettings });
    setSettings(newSettings);
  }

  async function handleViewSnapshots(product) {
    setSelectedProduct(product);
    const resp = await chrome.runtime.sendMessage({
      type: 'MONITOR_GET_SNAPSHOTS',
      offerId: product.offerId,
      limit: 50,
    });
    setSnapshots(resp || []);
  }

  const unreadCount = alerts.filter(a => !a.read).length;

  if (loading) {
    return <div className="empty-state"><div style={{ color: 'var(--text-muted)' }}>Ladowanie...</div></div>;
  }

  return (
    <div className="monitor">
      {/* Sub-tabs */}
      <div className="monitor-tabs">
        <button
          className={`monitor-tab ${subTab === 'products' ? 'active' : ''}`}
          onClick={() => { setSubTab('products'); setSelectedProduct(null); }}
        >
          Produkty ({products.length})
        </button>
        <button
          className={`monitor-tab ${subTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setSubTab('alerts')}
        >
          Alerty {unreadCount > 0 && <span className="alert-badge">{unreadCount}</span>}
        </button>
        <button
          className={`monitor-tab ${subTab === 'settings' ? 'active' : ''}`}
          onClick={() => setSubTab('settings')}
        >
          Monitoring
        </button>
      </div>

      {subTab === 'products' && !selectedProduct && (
        <ProductsList
          products={products}
          addUrl={addUrl}
          setAddUrl={setAddUrl}
          addLoading={addLoading}
          checking={checking}
          onAdd={handleAddProduct}
          onRemove={handleRemoveProduct}
          onToggle={handleToggleProduct}
          onCheckNow={handleCheckNow}
          onViewSnapshots={handleViewSnapshots}
        />
      )}

      {subTab === 'products' && selectedProduct && (
        <SnapshotView
          product={selectedProduct}
          snapshots={snapshots}
          onBack={() => setSelectedProduct(null)}
        />
      )}

      {subTab === 'alerts' && (
        <AlertsList
          alerts={alerts}
          onMarkAllRead={handleMarkAllRead}
        />
      )}

      {subTab === 'settings' && settings && (
        <MonitorSettings
          settings={settings}
          onSave={handleSaveSettings}
        />
      )}
    </div>
  );
}

// ── Products List ───────────────────────────────────────────────────────

function ProductsList({ products, addUrl, setAddUrl, addLoading, checking, onAdd, onRemove, onToggle, onCheckNow, onViewSnapshots }) {
  return (
    <>
      {/* Add product form */}
      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-title">Dodaj produkt do monitorowania</div>
        <div className="input-row">
          <div className="form-group" style={{ flex: 3 }}>
            <input
              type="text"
              placeholder="URL oferty lub ID (np. allegro.pl/oferta/...)"
              value={addUrl}
              onChange={e => setAddUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onAdd()}
            />
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={onAdd}
            disabled={addLoading || !addUrl.trim()}
            style={{ alignSelf: 'flex-end', marginBottom: 10 }}
          >
            {addLoading ? '...' : 'Dodaj'}
          </button>
        </div>
      </div>

      {/* Check now button */}
      {products.length > 0 && (
        <button
          className="btn btn-secondary btn-full btn-sm"
          onClick={onCheckNow}
          disabled={checking}
          style={{ marginBottom: 8 }}
        >
          {checking ? 'Sprawdzanie...' : 'Sprawdz teraz'}
        </button>
      )}

      {/* Product list */}
      {products.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">Brak monitorowanych produktow</div>
          <div className="empty-state-desc">
            Dodaj URL oferty z Allegro, aby sledzic zmiany cen, dostepnosci i tresci ofert.
          </div>
        </div>
      ) : (
        <div className="product-list">
          {products.map(p => (
            <div key={p.offerId} className={`product-item ${!p.enabled ? 'disabled' : ''}`}>
              <div className="product-info" onClick={() => onViewSnapshots(p)} style={{ cursor: 'pointer' }}>
                <div className="product-title">{p.title}</div>
                <div className="product-meta">
                  ID: {p.offerId}
                  {p.lastCheckedAt && (
                    <> | Ostatnie sprawdzenie: {formatRelativeTime(p.lastCheckedAt)}</>
                  )}
                </div>
              </div>
              <div className="product-actions">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={e => onToggle(p.offerId, e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => onRemove(p.offerId)}
                  title="Usun"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Snapshot View (Price History) ────────────────────────────────────────

function SnapshotView({ product, snapshots, onBack }) {
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>
        &larr; Powrot do listy
      </button>

      <div className="card">
        <div className="card-title">{product.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          ID: {product.offerId}
        </div>

        {snapshots.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Brak zapisanych snapshotow. Dane pojawia sie po pierwszym sprawdzeniu.
          </div>
        ) : (
          <>
            {/* Price chart (simple ASCII-style) */}
            <PriceChart snapshots={snapshots} />

            {/* Snapshot table */}
            <div className="snapshot-list">
              <div className="snapshot-header">
                <span>Data</span>
                <span>Cena</span>
                <span>Ilosc</span>
                <span>Status</span>
              </div>
              {snapshots.slice().reverse().map((s, i) => (
                <div key={i} className="snapshot-row">
                  <span className="snapshot-date">{formatDate(s.timestamp)}</span>
                  <span className={`snapshot-price ${getPriceClass(snapshots, snapshots.length - 1 - i)}`}>
                    {s.price != null ? `${s.price} PLN` : '-'}
                  </span>
                  <span>{s.quantity ?? '-'}</span>
                  <span>{s.availability || '-'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PriceChart({ snapshots }) {
  const prices = snapshots.filter(s => s.price != null).map(s => s.price);
  if (prices.length < 2) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const chartHeight = 60;
  const chartWidth = 280;
  const stepX = chartWidth / (prices.length - 1);

  const points = prices.map((p, i) => {
    const x = i * stepX;
    const y = chartHeight - ((p - min) / range) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="card" style={{ padding: '8px 12px', marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        Historia cen ({prices.length} pomiarow)
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{max} PLN</span>
        <svg width={chartWidth} height={chartHeight + 4} style={{ flex: 1 }}>
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
        <span>{min} PLN</span>
        <span>Aktualna: {prices[prices.length - 1]} PLN</span>
      </div>
    </div>
  );
}

// ── Alerts List ─────────────────────────────────────────────────────────

function AlertsList({ alerts, onMarkAllRead }) {
  if (alerts.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 16 }}>
        <div className="empty-state-icon">🔔</div>
        <div className="empty-state-title">Brak alertow</div>
        <div className="empty-state-desc">
          Alerty pojawia sie gdy zmienia sie cena, dostepnosc lub tresc monitorowanych ofert.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{alerts.length} alertow</span>
        <button className="btn btn-ghost btn-sm" onClick={onMarkAllRead}>
          Oznacz jako przeczytane
        </button>
      </div>

      {alerts.map(alert => (
        <div key={alert.id} className={`alert-item ${!alert.read ? 'unread' : ''}`}>
          <div className="alert-item-title">{alert.productTitle}</div>
          <div className="alert-item-changes">
            {alert.changes.map((change, i) => (
              <div key={i} className="alert-change">
                {renderChange(change)}
              </div>
            ))}
          </div>
          <div className="alert-item-time">{formatRelativeTime(alert.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Monitor Settings ────────────────────────────────────────────────────

function MonitorSettings({ settings, onSave }) {
  const [form, setForm] = useState(settings);

  function handleChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="card">
        <div className="card-title">Ustawienia monitoringu</div>

        <div className="form-group">
          <label>Interwai sprawdzania (minuty)</label>
          <input
            type="number"
            min="5"
            max="1440"
            value={form.checkIntervalMinutes}
            onChange={e => handleChange('checkIntervalMinutes', parseInt(e.target.value) || 60)}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Min. 5 min, max. 1440 min (24h)
          </div>
        </div>

        <div className="form-group">
          <label>Prog zmiany ceny do powiadomienia (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={form.priceChangeThreshold}
            onChange={e => handleChange('priceChangeThreshold', parseFloat(e.target.value) || 0)}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            0 = powiadomienie o kazdej zmianie ceny
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <SettingToggle
            label="Powiadomienia przeglarkowe"
            checked={form.enableNotifications}
            onChange={v => handleChange('enableNotifications', v)}
          />
          <SettingToggle
            label="Sledz zmiany cen"
            checked={form.trackPrice}
            onChange={v => handleChange('trackPrice', v)}
          />
          <SettingToggle
            label="Sledz dostepnosc"
            checked={form.trackAvailability}
            onChange={v => handleChange('trackAvailability', v)}
          />
          <SettingToggle
            label="Sledz zmiany tytulow"
            checked={form.trackTitle}
            onChange={v => handleChange('trackTitle', v)}
          />
          <SettingToggle
            label="Sledz ilosc sztuk"
            checked={form.trackQuantity}
            onChange={v => handleChange('trackQuantity', v)}
          />
        </div>

        <button
          className="btn btn-primary btn-full"
          style={{ marginTop: 14 }}
          onClick={() => onSave(form)}
        >
          Zapisz ustawienia
        </button>
      </div>
    </div>
  );
}

function SettingToggle({ label, checked, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <label className="toggle">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractOfferId(input) {
  // Full URL: allegro.pl/oferta/product-name-12345678
  const urlMatch = input.match(/(\d{7,})(?:\?|$|#)/);
  if (urlMatch) return urlMatch[1];

  // Just a number
  if (/^\d{7,}$/.test(input)) return input;

  // URL with slug
  const slugMatch = input.match(/oferta\/[^/]+-(\d+)/);
  if (slugMatch) return slugMatch[1];

  return null;
}

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'teraz';
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h temu`;
  const days = Math.floor(hours / 24);
  return `${days}d temu`;
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function getPriceClass(snapshots, index) {
  if (index === 0) return '';
  const prev = snapshots[index - 1]?.price;
  const curr = snapshots[index]?.price;
  if (prev == null || curr == null) return '';
  if (curr < prev) return 'price-down';
  if (curr > prev) return 'price-up';
  return '';
}

function renderChange(change) {
  switch (change.field) {
    case 'price':
      return (
        <span>
          Cena: <strong>{change.oldValue} PLN</strong>
          {' '}{change.direction === 'up' ? '\u2191' : '\u2193'}{' '}
          <strong className={change.direction === 'up' ? 'price-up' : 'price-down'}>
            {change.newValue} PLN
          </strong>
          {' '}({change.percentChange > 0 ? '+' : ''}{change.percentChange}%)
        </span>
      );
    case 'title':
      return <span>Tytul zmieniony: &ldquo;{change.newValue.substring(0, 40)}...&rdquo;</span>;
    case 'availability':
      return <span>Dostepnosc: {change.oldValue} &rarr; {change.newValue}</span>;
    case 'quantity':
      return <span>Ilosc: {change.oldValue} &rarr; {change.newValue} szt.</span>;
    default:
      return <span>{change.field}: {change.oldValue} &rarr; {change.newValue}</span>;
  }
}
