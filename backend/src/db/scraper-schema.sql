-- Allegro Scraper Extension – Database Schema
-- Adds tables for product monitoring, snapshots, and alerts

-- ── Monitored Products ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitored_products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id      UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  offer_id        TEXT NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT,
  seller_id       TEXT,
  seller_login    TEXT,
  image_url       TEXT,
  category_id     TEXT,
  category_name   TEXT,
  enabled         BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(license_id, offer_id)
);

CREATE INDEX IF NOT EXISTS idx_monitored_products_license ON monitored_products(license_id);
CREATE INDEX IF NOT EXISTS idx_monitored_products_offer   ON monitored_products(offer_id);

-- ── Product Snapshots (price/availability history) ───────────────────────
CREATE TABLE IF NOT EXISTS product_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id      UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  offer_id        TEXT NOT NULL,
  price           NUMERIC(12,2),
  original_price  NUMERIC(12,2),
  currency        TEXT DEFAULT 'PLN',
  title           TEXT,
  quantity        INTEGER,
  sold_count      INTEGER,
  availability    TEXT,
  delivery_price  NUMERIC(8,2),
  free_shipping   BOOLEAN,
  rating_score    NUMERIC(3,2),
  rating_count    INTEGER,
  parameters      JSONB,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_offer     ON product_snapshots(offer_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_license   ON product_snapshots(license_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_recorded  ON product_snapshots(recorded_at DESC);

-- ── Product Alerts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_alerts (
  id              TEXT PRIMARY KEY,
  license_id      UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  offer_id        TEXT NOT NULL,
  product_title   TEXT,
  changes         JSONB NOT NULL,
  read            BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_license ON product_alerts(license_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_offer   ON product_alerts(offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unread  ON product_alerts(license_id, read) WHERE read = FALSE;

-- ── Triggers ─────────────────────────────────────────────────────────────
CREATE TRIGGER monitored_products_updated_at BEFORE UPDATE ON monitored_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Retention policy (keep snapshots for 1 year, alerts for 90 days) ────
-- Run periodically via cron:
-- DELETE FROM product_snapshots WHERE recorded_at < NOW() - INTERVAL '1 year';
-- DELETE FROM product_alerts WHERE created_at < NOW() - INTERVAL '90 days';
