import { getDb, json, loadState, STARTING_POT_PENCE } from '../_lib/bot.js';

export async function onRequestPost({ env }) {
  try {
    const db = await getDb(env);
    await loadState(db);
    await db.prepare(`
      UPDATE bot_state
      SET trading_pot_pence = ?, profit_vault_pence = 0, starting_pot_pence = ?, active_position_json = NULL, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(STARTING_POT_PENCE, STARTING_POT_PENCE).run();
    const state = await loadState(db);
    return json({ state });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
