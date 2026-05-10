import { getDb, json, loadState } from '../_lib/bot.js';

function isLikelyEvmAddress(address) {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const wallet = String(body.wallet_address || '').trim();
    if (!isLikelyEvmAddress(wallet)) {
      return json({ error: 'That does not look like a valid EVM wallet address.' }, 400);
    }
    const db = await getDb(env);
    await loadState(db);
    await db.prepare(`
      UPDATE bot_state
      SET wallet_address = ?, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(wallet).run();
    const state = await loadState(db);
    return json({ state });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
