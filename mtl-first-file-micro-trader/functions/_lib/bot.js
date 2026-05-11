export const STARTING_POT_PENCE = 1000;
export const DB_MISSING_ERROR = 'D1 binding missing. Required binding name: DB.';

export const PAIRS = {
  bitcoin: 'BTC/GBP',
  ethereum: 'ETH/GBP',
  solana: 'SOL/GBP'
};

export const TRADING_ENVIRONMENTS = {
  practice: 'Practice',
  real: 'Real'
};

const MARKET_IDS = Object.keys(PAIRS);
const COINGECKO_MARKETS_URL = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=gbp&ids=${MARKET_IDS.join(',')}&order=market_cap_desc&per_page=3&page=1&sparkline=false&price_change_percentage=24h`;

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
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export function errorJson(error, status = error?.status || 500) {
  return json({ ok: false, error: error?.message || 'Unexpected server error.' }, status);
}

export function methodNotAllowed(allowed) {
  return json({ ok: false, error: `Method not allowed. Use ${allowed}.` }, 405);
}

export function getDb(env) {
  if (!env?.DB) {
    const error = new Error(DB_MISSING_ERROR);
    error.status = 500;
    throw error;
  }
  return env.DB;
}

async function ensureColumn(db, table, column, definition) {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (error) {
    if (!/duplicate column|already exists/i.test(error.message || '')) {
      throw error;
    }
  }
}

export async function ensureSchema(db) {
  await db.prepare(`
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
    )
  `).run();

  await db.prepare(`
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
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      mode TEXT NOT NULL,
      price REAL,
      change_24h REAL,
      action TEXT,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS market_cache (
      id TEXT PRIMARY KEY,
      markets_json TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at DESC)`).run();
  await ensureColumn(db, 'bot_state', 'trading_environment', `TEXT NOT NULL DEFAULT 'practice'`);
  await ensureColumn(db, 'trades', 'environment', `TEXT NOT NULL DEFAULT 'practice'`);
}

export async function ensureState(db) {
  await ensureSchema(db);

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
    trading_environment: TRADING_ENVIRONMENTS[row.trading_environment] ? row.trading_environment : 'practice',
    active_position: parsePosition(row.active_position_json)
  };
}

export async function loadState(db) {
  await ensureState(db);
  const row = await db.prepare(`SELECT * FROM bot_state WHERE id = 'main'`).first();
  return normaliseState(row);
}

export async function ensureMarketCache(db) {
  await ensureSchema(db);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseD1Timestamp(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

export function normaliseMarkets(rawMarkets) {
  const rows = Array.isArray(rawMarkets)
    ? rawMarkets
    : Object.entries(rawMarkets || {}).map(([id, item]) => ({ id, ...item }));

  return rows
    .map((item) => {
      const id = MARKET_IDS.includes(item.id) ? item.id : String(item.id || '').toLowerCase();
      if (!MARKET_IDS.includes(id)) return null;

      return {
        id,
        pair_label: PAIRS[id],
        symbol: String(item.symbol || id).toUpperCase(),
        name: item.name || id,
        image: item.image || null,
        gbp: asNumber(item.gbp ?? item.current_price),
        gbp_24h_change: asNumber(
          item.gbp_24h_change ??
          item.price_change_percentage_24h_in_currency ??
          item.price_change_percentage_24h
        ),
        gbp_24h_vol: asNumber(item.gbp_24h_vol ?? item.total_volume),
        market_cap: asNumber(item.market_cap ?? item.gbp_market_cap)
      };
    })
    .filter(Boolean)
    .sort((a, b) => MARKET_IDS.indexOf(a.id) - MARKET_IDS.indexOf(b.id));
}

export function findMarket(markets, symbol) {
  const normalised = normaliseMarkets(markets);
  return normalised.find((market) => market.id === symbol) || null;
}

export async function fetchMarketsRaw() {
  const response = await fetch(COINGECKO_MARKETS_URL, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'GooseGrid-Micro-Trader/1.1 (+private paper-trading proof build)'
    }
  });

  if (!response.ok) {
    throw new Error(`CoinGecko market data failed with status ${response.status}`);
  }

  return normaliseMarkets(await response.json());
}

export async function readCachedMarkets(db) {
  await ensureMarketCache(db);
  const row = await db.prepare(`
    SELECT * FROM market_cache
    WHERE id IN ('latest', 'coingecko')
    ORDER BY CASE id WHEN 'latest' THEN 0 ELSE 1 END
    LIMIT 1
  `).first();
  if (!row?.markets_json) return null;

  const updatedAt = parseD1Timestamp(row.updated_at);

  try {
    return {
      markets: normaliseMarkets(JSON.parse(row.markets_json)),
      source: row.source || 'cache',
      updated_at: row.updated_at,
      age_seconds: updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null
    };
  } catch {
    return null;
  }
}

export async function saveMarketCache(db, markets, source = 'CoinGecko simple price API') {
  await ensureMarketCache(db);
  const normalised = normaliseMarkets(markets);
  await db.prepare(`
    INSERT INTO market_cache (id, markets_json, source, created_at, updated_at)
    VALUES ('latest', ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      markets_json = excluded.markets_json,
      source = excluded.source,
      updated_at = datetime('now')
  `).bind(JSON.stringify(normalised), source).run();
}

export async function getMarketSnapshot(db, options = {}) {
  const maxAgeSeconds = Number(options.maxAgeSeconds || 180);
  const allowStale = options.allowStale !== false;
  const cached = await readCachedMarkets(db);

  if (cached && cached.age_seconds !== null && cached.age_seconds <= maxAgeSeconds) {
    return { ok: true, markets: cached.markets, source: 'cache', cached: true, stale: false, updated_at: cached.updated_at, age_seconds: cached.age_seconds };
  }

  try {
    const markets = await fetchMarketsRaw();
    await saveMarketCache(db, markets, 'coingecko');
    return { ok: true, markets, source: 'coingecko', cached: false, stale: false, updated_at: new Date().toISOString(), age_seconds: 0 };
  } catch (error) {
    if (allowStale && cached) {
      return { ok: true, markets: cached.markets, source: 'stale-cache', cached: true, stale: true, updated_at: cached.updated_at, age_seconds: cached.age_seconds, warning: error.message };
    }
    throw error;
  }
}

export async function fetchMarkets() {
  return await fetchMarketsRaw();
}

export async function loadTrades(db, limit = 25) {
  await ensureSchema(db);
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

export function analyseOpenPosition({ state, markets }) {
  const active = state?.active_position;
  if (!active) {
    return {
      has_position: false,
      signal: 'NO_POSITION',
      signal_label: 'No open trade',
      message: 'Open a practice position to get live sell guidance.',
      confidence: 'n/a'
    };
  }

  const symbol = active.symbol || state.symbol || 'bitcoin';
  const market = findMarket(markets, symbol);
  if (!market || !market.gbp) {
    return {
      has_position: true,
      signal: 'NO_MARKET',
      signal_label: 'No market data',
      message: `No live GBP market data is available for ${PAIRS[symbol] || symbol}.`,
      confidence: 'low'
    };
  }

  const rules = MODES[state.mode] || MODES.balanced;
  const entry = Number(active.entry_price || 0);
  const current = Number(market.gbp || 0);
  const positionSizePence = Number(active.position_size_pence || active.pot_at_entry_pence || state.trading_pot_pence || STARTING_POT_PENCE);
  const pnlPct = entry > 0 ? ((current - entry) / entry) * 100 : 0;
  const pnlPence = Math.round(positionSizePence * (pnlPct / 100));
  const targetPrice = entry * (1 + rules.takeProfitPct / 100);
  const stopPrice = entry * (1 + rules.stopLossPct / 100);
  const change24h = Number(market.gbp_24h_change || 0);
  const distanceToTargetPct = targetPrice > 0 ? ((targetPrice - current) / targetPrice) * 100 : 0;
  const distanceToStopPct = stopPrice > 0 ? ((current - stopPrice) / stopPrice) * 100 : 0;

  let signal = 'HOLD';
  let signalLabel = 'Hold / watch';
  let message = `Watching ${PAIRS[symbol]}. Target is £${targetPrice.toFixed(2)} and stop line is £${stopPrice.toFixed(2)}.`;
  let confidence = 'medium';

  if (pnlPct >= rules.takeProfitPct) {
    signal = 'SELL_SIGNAL';
    signalLabel = 'Sell signal';
    message = `Target reached at ${pnlPct.toFixed(2)}% P/L. Consider closing the practice trade or tightening your stop.`;
    confidence = 'high';
  } else if (pnlPct <= rules.stopLossPct) {
    signal = 'RISK_EXIT';
    signalLabel = 'Risk exit';
    message = `Stop line reached at ${pnlPct.toFixed(2)}% P/L. Consider closing the practice trade to limit the loss.`;
    confidence = 'high';
  } else if (pnlPct > 0 && pnlPct >= rules.takeProfitPct * 0.75) {
    signal = change24h < 0 ? 'PROTECT_PROFIT' : 'SELL_WINDOW_NEAR';
    signalLabel = change24h < 0 ? 'Protect profit' : 'Sell window near';
    message = `Trade is ${pnlPct.toFixed(2)}% up and close to the ${rules.label.toLowerCase()} target. Watch for £${targetPrice.toFixed(2)} or a momentum fade.`;
  } else if (pnlPct > 0 && change24h < -0.5) {
    signal = 'PROTECT_PROFIT';
    signalLabel = 'Protect profit';
    message = `Trade is green, but 24h momentum is fading at ${change24h.toFixed(2)}%. Consider a tighter sell trigger.`;
  } else if (change24h > rules.buyMaxChange) {
    signal = 'OVERHEATED';
    signalLabel = 'Overheated';
    message = `24h move is ${change24h.toFixed(2)}%, above the ${rules.label.toLowerCase()} comfort band. Avoid chasing; watch for reversal.`;
  } else if (change24h < rules.buyMinChange) {
    signal = 'WEAK_MOMENTUM';
    signalLabel = 'Weak momentum';
    message = `24h move is ${change24h.toFixed(2)}%, below the ${rules.label.toLowerCase()} momentum trigger. Hold only if your stop line still fits.`;
  }

  return {
    has_position: true,
    signal,
    signal_label: signalLabel,
    message,
    confidence,
    symbol,
    pair_label: PAIRS[symbol],
    current_price: current,
    entry_price: entry,
    target_price: targetPrice,
    stop_price: stopPrice,
    distance_to_target_pct: distanceToTargetPct,
    distance_to_stop_pct: distanceToStopPct,
    pnl_pct: pnlPct,
    pnl_pence: pnlPence,
    change_24h: change24h,
    position_size_pence: positionSizePence,
    updated_at: new Date().toISOString(),
    note: 'Signal only. Not financial advice.'
  };
}

export function analyseMarkets(markets) {
  return normaliseMarkets(markets).map((market) => {
    const change = Number(market.gbp_24h_change || 0);
    let direction = 'SIDEWAYS';
    let label = 'Range / wait';
    let confidence = 'medium';

    if (change >= 2) {
      direction = 'UP';
      label = 'Strong momentum';
      confidence = change > 6 ? 'low' : 'medium';
    } else if (change >= 0.5) {
      direction = 'UP';
      label = 'Positive momentum';
    } else if (change <= -2) {
      direction = 'DOWN';
      label = 'Sell pressure';
    } else if (change <= -0.5) {
      direction = 'DOWN';
      label = 'Softening';
    }

    return {
      symbol: market.id,
      pair_label: PAIRS[market.id],
      price: market.gbp,
      change_24h: change,
      direction,
      label,
      confidence
    };
  });
}

export async function insertTrade(db, trade) {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO trades (
      id, symbol, action, entry_price, exit_price, pot_before_pence, pot_after_pence, pnl_pence, pnl_pct, reason, mode, environment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    trade.mode ?? null,
    trade.environment ?? 'practice'
  ).run();
  return { id, ...trade };
}
