import {
  STARTING_POT_PENCE,
  PAIRS,
  TRADING_ENVIRONMENTS,
  calculateSimulatedPnl,
  errorJson,
  findMarket,
  getDb,
  getMarketSnapshot,
  insertTrade,
  json,
  loadState,
  loadTrades,
  methodNotAllowed,
  requireFreshSnapshot
} from '../_lib/bot.js';

function toPence(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function realTradingLocked() {
  const error = new Error('Real trading is locked. Configure a supported exchange adapter, API keys, spending limits, and explicit live-trading approval before real orders are enabled.');
  error.status = 403;
  return error;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');

  try {
    const body = await request.json().catch(() => ({}));
    const db = getDb(env);
    const state = await loadState(db);

    const requestedEnvironment = TRADING_ENVIRONMENTS[body.trading_environment]
      ? body.trading_environment
      : state.trading_environment || 'practice';
    const side = String(body.side || '').trim().toUpperCase();
    if (!['BUY', 'SELL'].includes(side)) {
      return json({ ok: false, error: 'Order side must be BUY or SELL.' }, 400);
    }

    if (requestedEnvironment === 'real') {
      throw realTradingLocked();
    }

    await db.prepare(`
      UPDATE bot_state
      SET trading_environment = ?, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(requestedEnvironment).run();

    const active = state.active_position;
    const symbol = PAIRS[body.symbol] ? body.symbol : active?.symbol || state.symbol || 'bitcoin';
    const snapshot = requireFreshSnapshot(await getMarketSnapshot(db, { maxAgeSeconds: 60, allowStale: false }));
    const market = findMarket(snapshot.markets, symbol);
    if (!market || !market.gbp) {
      return json({ ok: false, error: `No GBP market data returned for ${symbol}.` }, 500);
    }

    const currentPrice = Number(market.gbp);
    const potBefore = Number(state.trading_pot_pence || STARTING_POT_PENCE);
    let message = '';
    let trade = null;

    if (side === 'BUY') {
      if (active) {
        return json({ ok: false, error: `Practice position already open on ${PAIRS[active.symbol] || active.symbol}. Sell it before buying again.` }, 400);
      }

      const orderSizePence = Math.min(toPence(body.amount_pence, potBefore), potBefore);
      if (orderSizePence < 100) {
        return json({ ok: false, error: 'Practice buy amount must be at least £1.00.' }, 400);
      }

      const position = {
        symbol,
        pair_label: PAIRS[symbol],
        entry_price: currentPrice,
        entered_at: new Date().toISOString(),
        mode: state.mode || 'manual',
        environment: 'practice',
        position_size_pence: orderSizePence,
        quantity_estimate: orderSizePence / 100 / currentPrice
      };

      await db.prepare(`
        UPDATE bot_state
        SET symbol = ?, active_position_json = ?, updated_at = datetime('now')
        WHERE id = 'main'
      `).bind(symbol, JSON.stringify(position)).run();

      trade = await insertTrade(db, {
        symbol,
        action: 'PRACTICE_BUY',
        entry_price: currentPrice,
        exit_price: null,
        pot_before_pence: potBefore,
        pot_after_pence: potBefore,
        pnl_pence: 0,
        pnl_pct: 0,
        reason: `Manual practice buy opened for £${(orderSizePence / 100).toFixed(2)} at £${currentPrice.toFixed(2)}.`,
        mode: state.mode || 'manual',
        environment: 'practice'
      });
      message = `Practice buy opened on ${PAIRS[symbol]} for £${(orderSizePence / 100).toFixed(2)} at £${currentPrice.toFixed(2)}.`;
    } else {
      if (!active) {
        return json({ ok: false, error: 'No open practice position to sell.' }, 400);
      }

      const activeSymbol = active.symbol;
      const activeMarket = findMarket(snapshot.markets, activeSymbol);
      if (!activeMarket || !activeMarket.gbp) {
        return json({ ok: false, error: `No GBP market data returned for ${activeSymbol}.` }, 500);
      }

      const exitPrice = Number(activeMarket.gbp);
      const entryPrice = Number(active.entry_price);
      const positionSizePence = Number(active.position_size_pence || active.pot_at_entry_pence || potBefore);
      const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const { feePence, pnlPence } = calculateSimulatedPnl(positionSizePence, pnlPct);
      const potAfterRaw = Math.max(0, potBefore + pnlPence);
      const skimmed = Math.max(0, potAfterRaw - STARTING_POT_PENCE);
      const finalPot = skimmed > 0 ? STARTING_POT_PENCE : potAfterRaw;
      const newVault = Number(state.profit_vault_pence || 0) + skimmed;

      await db.prepare(`
        UPDATE bot_state
        SET trading_pot_pence = ?, profit_vault_pence = ?, active_position_json = NULL, updated_at = datetime('now')
        WHERE id = 'main'
      `).bind(finalPot, newVault).run();

      trade = await insertTrade(db, {
        symbol: activeSymbol,
        action: 'PRACTICE_SELL',
        entry_price: entryPrice,
        exit_price: exitPrice,
        pot_before_pence: potBefore,
        pot_after_pence: finalPot,
        pnl_pence: pnlPence,
        pnl_pct: pnlPct,
        reason: skimmed > 0
          ? `Manual practice sell closed at ${pnlPct.toFixed(2)}%. Simulated fees ${(feePence / 100).toFixed(2)}. Skimmed ${(skimmed / 100).toFixed(2)} into vault.`
          : `Manual practice sell closed at ${pnlPct.toFixed(2)}%. Simulated fees ${(feePence / 100).toFixed(2)}.`,
        mode: state.mode || 'manual',
        environment: 'practice'
      });
      message = `Practice sell closed ${PAIRS[activeSymbol]} at £${exitPrice.toFixed(2)}. P/L £${(pnlPence / 100).toFixed(2)}.`;
    }

    const newState = await loadState(db);
    const trades = await loadTrades(db, 40);
    return json({
      ok: true,
      action: trade.action,
      message,
      state: newState,
      market,
      markets: snapshot.markets,
      trades,
      trade,
      market_source: snapshot.source,
      market_warning: snapshot.warning || null
    });
  } catch (error) {
    return errorJson(error);
  }
}
