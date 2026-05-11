-- GooseGrid Micro Trader schema
-- Run this once in Cloudflare D1 before using the app.

CREATE TABLE IF NOT EXISTS bot_state (
  id TEXT PRIMARY KEY,
  trading_pot_pence INTEGER NOT NULL DEFAULT 1000,
  profit_vault_pence INTEGER NOT NULL DEFAULT 0,
  starting_pot_pence INTEGER NOT NULL DEFAULT 1000,
  active_position_json TEXT,
  symbol TEXT NOT NULL DEFAULT 'bitcoin',
  mode TEXT NOT NULL DEFAULT 'balanced',
  trading_environment TEXT NOT NULL DEFAULT 'practice',
  wallet_address TEXT,
  withdrawal_threshold_pence INTEGER NOT NULL DEFAULT 2500,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  entry_price REAL,
  exit_price REAL,
  pot_before_pence INTEGER,
  pot_after_pence INTEGER,
  pnl_pence INTEGER,
  pnl_pct REAL,
  reason TEXT,
  mode TEXT,
  environment TEXT NOT NULL DEFAULT 'practice',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  mode TEXT NOT NULL,
  price REAL,
  change_24h REAL,
  action TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS market_cache (
  id TEXT PRIMARY KEY,
  markets_json TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at DESC);

INSERT OR IGNORE INTO bot_state (
  id, trading_pot_pence, profit_vault_pence, starting_pot_pence, symbol, mode, withdrawal_threshold_pence, created_at, updated_at
) VALUES (
  'main', 1000, 0, 1000, 'bitcoin', 'balanced', 2500, datetime('now'), datetime('now')
);
