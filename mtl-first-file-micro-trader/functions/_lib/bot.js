export const STARTING_POT_PENCE = 1000;

export const PAIRS = {
  bitcoin: 'BTC/GBP',
  ethereum: 'ETH/GBP',
  solana: 'SOL/GBP'
};

export const MODES = {
  cautious: {
    label: 'Cautious',
    takeProfitPct: 1.2,
    stopLossPct: -0.8,
    buyMinChange: 0.35,
    buyMaxChange: 4.5,
    message: 'Cautious mode waits for positive but not overheated momentum.'
  },
  balanced: {
    label: 'Balanced',
    takeProfitPct: 2.0,
    stopLossPct: -1.0,
    buyMinChange: 0.75,
    buyMaxChange: 6.5,
    message: 'Balanced mode looks for trend plus momentum.'
  },
  high_risk: {
    label: 'High risk',
    takeProfitPct: 4.0,
    stopLossPct: -2.5,
    buyMinChange: -1.25,
    buyMaxChange: 10,
    message: 'High-risk mode allows rebound and stronger momentum entries, still paper-only.'
  }
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function getDb(env) {
  if (!env.DB) {
    throw new Error('D1 binding missing. Add a D1 binding named DB in Cloudflare Pages settings.');
  }
  return env.DB;
}

export async function ensureState(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id TEXT PRIMARY KEY,
      trading_pot_pence INTEGER NOT NULL DEFAULT 1000,
      profit_vault_pence INTEGER NOT NULL DEFAULT 0,
      starting_pot_pence INTEGER NOT NULL DEFAULT 1000,
      active_position_json TEXT,
      symbol TEXT NOT NULL DEFAULT 'bitcoin',
      mode TEXT NOT NULL DEFAULT 'balanced',
      wallet_address TEXT,
      withdrawal_threshold_pence INTEGER NOT NULL DEFAULT 2500,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await ensureMarketCache(db);

  await db.prepare(`
    INSERT OR IGNORE INTO bot_state (
      id, trading_pot_pence, profit_vault_pence, starting_pot_pence, symbol, mode, withdrawal_threshold_pence, created_at, updated_at
    ) VALUES ('main', 1000, 0, 1000, 'bitcoin', 'balanced', 2500, datetime('now'), datetime('now'))
  `).run();
}

export function parsePosition(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function normaliseState(row) {
  if (!row) return null;
  return {
    ...row,
    active_position: parsePosition(row.active_position_json)
  };
}

export async function loadState(db) {
  await ensureState(db);
  const row = await db.prepare(`SELECT * FROM bot_state WHERE id = 'main'`).first();
  return normaliseState(row);
}

export async function ensureMarketCache(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS market_cache (
      id TEXT PRIMARY KEY,
      markets_json TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
}

export async function fetchMarketsRaw() {
  const ids = Object.keys(PAIRS).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=gbp&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'GooseGrid-Micro-Trader/1.1 (+private paper-trading proof build)'
    }
  });
  if (!res.ok) throw new Error(`CoinGecko market data failed with status ${res.status}`);
  return await res.json();
}

export async function readCachedMarkets(db) {
  await ensureMarketCache(db);
  const row = await db.prepare(`SELECT * FROM market_cache WHERE id = 'coingecko'`).first();
  if (!row?.markets_json) return null;
  try {
    return {
      markets: JSON.parse(row.markets_json),
      source: row.source || 'D1 cache',
      updated_at: row.updated_at,
      age_seconds: row.updated_at ? Math.max(0, Math.round((Date.now() - new Date(row.updated_at).getTime()) / 1000)) : null
    };
  } catch {
    return null;
  }
}

export async function saveMarketCache(db, markets, source = 'CoinGecko simple price API') {
  await ensureMarketCache(db);
  await db.prepare(`
    INSERT INTO market_cache (id, markets_json, source, created_at, updated_at)
    VALUES ('coingecko', ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      markets_json = excluded.markets_json,
      source = excluded.source,
      updated_at = datetime('now')
  `).bind(JSON.stringify(markets), source).run();
}

export async function getMarketSnapshot(db, options = {}) {
  const maxAgeSeconds = Number(options.maxAgeSeconds || 180);
  const allowStale = options.allowStale !== false;
  const cached = db ? await readCachedMarkets(db) : null;

  if (cached && cached.age_seconds !== null && cached.age_seconds <= maxAgeSeconds) {
    return { ...cached, source: `D1 cache (${cached.age_seconds}s old)`, cached: true, stale: false };
  }

  try {
    const markets = await fetchMarketsRaw();
    if (db) await saveMarketCache(db, markets);
    return { markets, source: 'CoinGecko simple price API', cached: false, stale: false, updated_at: new Date().toISOString(), age_seconds: 0 };
  } catch (error) {
    if (allowStale && cached) {
      return { ...cached, source: `D1 stale cache (${cached.age_seconds}s old)`, cached: true, stale: true, warning: error.message };
    }
    throw error;
  }
}

export async function fetchMarkets() {
  return await fetchMarketsRaw();
}

export async function loadTrades(db, limit = 25) {
  const result = await db.prepare(`
    SELECT * FROM trades
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).bind(limit).all();
  return result.results || [];
}

export function chooseSignal({ market, mode }) {
  const rules = MODES[mode] || MODES.balanced;
  const change = Number(market?.gbp_24h_change || 0);
  if (change >= rules.buyMinChange && change <= rules.buyMaxChange) {
    return { shouldBuy: true, reason: `${rules.label} buy signal: 24h momentum ${change.toFixed(2)}% sits inside the allowed proof range.` };
  }
  if (change > rules.buyMaxChange) {
    return { shouldBuy: false, reason: `No buy: 24h move ${change.toFixed(2)}% may be overheated for ${rules.label.toLowerCase()} mode.` };
  }
  return { shouldBuy: false, reason: `No buy: 24h move ${change.toFixed(2)}% is below the ${rules.label.toLowerCase()} trigger.` };
}

export async function insertTrade(db, trade) {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO trades (
      id, symbol, action, entry_price, exit_price, pot_before_pence, pot_after_pence, pnl_pence, pnl_pct, reason, mode, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    id,
    trade.symbol,
    trade.action,
    trade.entry_price ?? null,
    trade.exit_price ?? null,
    trade.pot_before_pence ?? null,
    trade.pot_after_pence ?? null,
    trade.pnl_pence ?? null,
    trade.pnl_pct ?? null,
    trade.reason ?? null,
    trade.mode ?? null
  ).run();
}
