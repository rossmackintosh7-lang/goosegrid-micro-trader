import { getDb, json, loadState, MODES, PAIRS } from '../_lib/bot.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const symbol = PAIRS[body.symbol] ? body.symbol : 'bitcoin';
    const mode = MODES[body.mode] ? body.mode : 'balanced';
    const threshold = Number(body.withdrawal_threshold_pence || 2500);
    const db = await getDb(env);
    await loadState(db);
    await db.prepare(`
      UPDATE bot_state
      SET symbol = ?, mode = ?, withdrawal_threshold_pence = ?, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(symbol, mode, threshold).run();
    const state = await loadState(db);
    return json({ state });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
