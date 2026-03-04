-- Allegro Ads Automate – PostgreSQL Schema
-- Run via: psql -U postgres -d allegro_ads_db -f schema.sql

-- ── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  allegro_login   TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

-- ── Licenses ───────────────────────────────────────────────────────────────
CREATE TYPE license_plan AS ENUM (
  'starter', 'standard', 'pro', 'pro_ai',
  'agency_starter', 'agency_pro', 'agency_elite', 'white_label'
);

CREATE TYPE license_status AS ENUM ('active', 'expired', 'cancelled', 'trial');

CREATE TABLE IF NOT EXISTS licenses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_key       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  plan              license_plan NOT NULL DEFAULT 'starter',
  status            license_status NOT NULL DEFAULT 'trial',
  allegro_login     TEXT,                     -- locked to specific Allegro account
  stripe_subscription_id TEXT UNIQUE,
  trial_ends_at     TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_key     ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_user    ON licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_stripe  ON licenses(stripe_subscription_id);

-- ── License validation log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS license_validations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id    UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  validated_at  TIMESTAMPTZ DEFAULT NOW(),
  ip_address    TEXT,
  user_agent    TEXT,
  result        BOOLEAN NOT NULL
);

-- Retention: keep only last 90 days
CREATE INDEX IF NOT EXISTS idx_validations_license ON license_validations(license_id, validated_at DESC);

-- ── Change History (Agency sync) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS change_history (
  id              UUID PRIMARY KEY,             -- matches Chrome extension ID
  license_id      UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,                -- 'cpc_change', 'budget_change', 'schedule', etc.
  source          TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'scheduler'
  campaign_id     TEXT,
  campaign_name   TEXT,
  schedule_name   TEXT,
  previous_value  NUMERIC,
  new_value       NUMERIC,
  status          TEXT DEFAULT 'success',       -- 'success' | 'error'
  error_msg       TEXT,
  undone          BOOLEAN DEFAULT FALSE,
  undone_at       TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL,         -- timestamp from extension
  synced_at       TIMESTAMPTZ DEFAULT NOW()     -- when synced to backend
);

CREATE INDEX IF NOT EXISTS idx_history_license  ON change_history(license_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_campaign ON change_history(campaign_id, recorded_at DESC);

-- ── Stripe Webhooks Log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT NOW(),
  payload         JSONB
);

-- ── Schedules (server-side backup for agency plans) ────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
  id              TEXT PRIMARY KEY,             -- matches Chrome extension ID
  license_id      UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  enabled         BOOLEAN DEFAULT TRUE,
  days            SMALLINT[] NOT NULL,          -- [1,2,3,4,5] = Mon-Fri
  hour            SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  minute          SMALLINT NOT NULL CHECK (minute BETWEEN 0 AND 59),
  action          JSONB NOT NULL,               -- { type, value }
  filters         JSONB,
  last_run_at     TIMESTAMPTZ,
  last_run_result JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_license ON schedules(license_id);

-- ── Triggers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER licenses_updated_at BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER schedules_updated_at BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
