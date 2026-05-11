import { errorJson, getDb, json, loadState, methodNotAllowed, MODES, PAIRS, TRADING_ENVIRONMENTS } from '../_lib/bot.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return methodNotAllowed('POST');

  try {
    const body = await context.request.json();
    const symbol = PAIRS[body.symbol] ? body.symbol : 'bitcoin';
    const mode = MODES[body.mode] ? body.mode : 'balanced';
    const tradingEnvironment = TRADING_ENVIRONMENTS[body.trading_environment] ? body.trading_environment : 'practice';
    const threshold = Number(body.withdrawal_threshold_pence || 2500);
    const db = getDb(context.env);
    await loadState(db);
    await db.prepare(`
      UPDATE bot_state
      SET symbol = ?, mode = ?, trading_environment = ?, withdrawal_threshold_pence = ?, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(symbol, mode, tradingEnvironment, threshold).run();
    const state = await loadState(db);
    return json({ ok: true, state });
  } catch (error) {
    return errorJson(error);
  }
}
