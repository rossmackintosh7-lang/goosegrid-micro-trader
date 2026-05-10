import { errorJson, getDb, json, loadState, methodNotAllowed, STARTING_POT_PENCE } from '../_lib/bot.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return methodNotAllowed('POST');

  try {
    const db = getDb(context.env);
    await loadState(db);
    await db.prepare(`
      UPDATE bot_state
      SET trading_pot_pence = ?, profit_vault_pence = 0, starting_pot_pence = ?, active_position_json = NULL, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(STARTING_POT_PENCE, STARTING_POT_PENCE).run();
    const state = await loadState(db);
    return json({ ok: true, state });
  } catch (error) {
    return errorJson(error);
  }
}
