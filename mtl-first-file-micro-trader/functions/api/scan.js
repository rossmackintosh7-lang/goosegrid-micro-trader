import {
  STARTING_POT_PENCE,
  MODES,
  PAIRS,
  chooseSignal,
  errorJson,
  findMarket,
  getDb,
  getMarketSnapshot,
  insertTrade,
  json,
  loadState,
  loadTrades,
  methodNotAllowed
} from '../_lib/bot.js';

async function readScanBody(request) {
  if (request.method === 'GET') return {};
  return await request.json().catch(() => ({}));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!['GET', 'POST'].includes(request.method)) return methodNotAllowed('GET or POST');

  try {
    const body = await readScanBody(request);
    const requestedSymbol = PAIRS[body.symbol] ? body.symbol : null;
    const requestedMode = MODES[body.mode] ? body.mode : null;
    const requestedThreshold = Number(body.withdrawal_threshold_pence || 0) || null;

    const db = getDb(env);
    let state = await loadState(db);

    const symbol = requestedSymbol || state.symbol || 'bitcoin';
    const mode = requestedMode || state.mode || 'balanced';
    const threshold = requestedThreshold || state.withdrawal_threshold_pence || 2500;

    await db.prepare(`
      UPDATE bot_state
      SET symbol = ?, mode = ?, withdrawal_threshold_pence = ?, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(symbol, mode, threshold).run();

    state = await loadState(db);
    const snapshot = await getMarketSnapshot(db, { maxAgeSeconds: 180, allowStale: true });
    const markets = snapshot.markets;
    const market = findMarket(markets, symbol);
    if (!market || !market.gbp) {
      return json({ ok: false, error: `No GBP market data returned for ${symbol}.` }, 500);
    }

    const currentPrice = Number(market.gbp);
    const rules = MODES[mode] || MODES.balanced;
    const active = state.active_position;
    let action = 'WAIT';
    let message = '';
    let trade = null;

    if (active) {
      const entry = Number(active.entry_price);
      const potBefore = Number(state.trading_pot_pence || STARTING_POT_PENCE);
      const pnlPct = ((currentPrice - entry) / entry) * 100;
      const pnlPence = Math.round(potBefore * (pnlPct / 100));
      const potAfterRaw = Math.max(0, potBefore + pnlPence);

      if (pnlPct >= rules.takeProfitPct) {
        const skimmed = Math.max(0, potAfterRaw - STARTING_POT_PENCE);
        const finalPot = potAfterRaw > STARTING_POT_PENCE ? STARTING_POT_PENCE : potAfterRaw;
        const newVault = Number(state.profit_vault_pence || 0) + skimmed;
        trade = await insertTrade(db, {
          symbol,
          action: 'TAKE_PROFIT',
          entry_price: entry,
          exit_price: currentPrice,
          pot_before_pence: potBefore,
          pot_after_pence: finalPot,
          pnl_pence: pnlPence,
          pnl_pct: pnlPct,
          reason: skimmed > 0
            ? `Take-profit hit at ${pnlPct.toFixed(2)}%. Skimmed ${skimmed}p into vault and reset pot to £10.`
            : `Take-profit hit at ${pnlPct.toFixed(2)}%. Pot stayed below £10, so no vault skim was made.`,
          mode
        });
        await db.prepare(`
          UPDATE bot_state
          SET trading_pot_pence = ?, profit_vault_pence = ?, active_position_json = NULL, updated_at = datetime('now')
          WHERE id = 'main'
        `).bind(finalPot, newVault).run();
        action = 'TAKE_PROFIT';
        message = skimmed > 0
          ? `Paper take-profit hit on ${PAIRS[symbol]} at £${currentPrice.toFixed(2)}. Profit was skimmed into the vault; trading pot reset to £10.`
          : `Paper take-profit hit on ${PAIRS[symbol]} at £${currentPrice.toFixed(2)}. Trading pot is now £${(finalPot / 100).toFixed(2)}.`;
      } else if (pnlPct <= rules.stopLossPct) {
        trade = await insertTrade(db, {
          symbol,
          action: 'STOP_LOSS',
          entry_price: entry,
          exit_price: currentPrice,
          pot_before_pence: potBefore,
          pot_after_pence: potAfterRaw,
          pnl_pence: pnlPence,
          pnl_pct: pnlPct,
          reason: `Stop-loss hit at ${pnlPct.toFixed(2)}%. Trading pot reduced; no vault movement.`,
          mode
        });
        await db.prepare(`
          UPDATE bot_state
          SET trading_pot_pence = ?, active_position_json = NULL, updated_at = datetime('now')
          WHERE id = 'main'
        `).bind(potAfterRaw).run();
        action = 'STOP_LOSS';
        message = `Paper stop-loss hit on ${PAIRS[symbol]} at £${currentPrice.toFixed(2)}. Trading pot is now £${(potAfterRaw / 100).toFixed(2)}.`;
      } else {
        action = 'HOLD';
        message = `Holding paper ${PAIRS[symbol]} position. Current unrealised P/L is ${pnlPct.toFixed(2)}%. Take-profit ${rules.takeProfitPct}%, stop-loss ${rules.stopLossPct}%.`;
      }
    } else {
      const signal = chooseSignal({ market, mode });
      if (signal.shouldBuy && Number(state.trading_pot_pence || 0) >= 500) {
        const position = {
          symbol,
          pair_label: PAIRS[symbol],
          entry_price: currentPrice,
          entered_at: new Date().toISOString(),
          mode,
          pot_at_entry_pence: Number(state.trading_pot_pence || STARTING_POT_PENCE)
        };
        await db.prepare(`
          UPDATE bot_state
          SET active_position_json = ?, updated_at = datetime('now')
          WHERE id = 'main'
        `).bind(JSON.stringify(position)).run();
        trade = await insertTrade(db, {
          symbol,
          action: 'PAPER_BUY',
          entry_price: currentPrice,
          exit_price: null,
          pot_before_pence: Number(state.trading_pot_pence || STARTING_POT_PENCE),
          pot_after_pence: Number(state.trading_pot_pence || STARTING_POT_PENCE),
          pnl_pence: 0,
          pnl_pct: 0,
          reason: signal.reason,
          mode
        });
        action = 'PAPER_BUY';
        message = `Paper buy opened on ${PAIRS[symbol]} at £${currentPrice.toFixed(2)}. ${signal.reason}`;
      } else {
        action = 'WAIT';
        message = signal.reason;
      }
    }

    await db.prepare(`
      INSERT INTO scans (id, symbol, mode, price, change_24h, action, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      symbol,
      mode,
      currentPrice,
      Number(market.gbp_24h_change || 0),
      action,
      message
    ).run();

    const newState = await loadState(db);
    const trades = await loadTrades(db, 40);
    return json({ ok: true, action, message, state: newState, market, markets, trades, trade, market_source: snapshot.source, market_warning: snapshot.warning || null });
  } catch (error) {
    return errorJson(error);
  }
}
