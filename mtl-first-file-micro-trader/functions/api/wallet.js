import { errorJson, getDb, json, loadState, methodNotAllowed } from '../_lib/bot.js';

function isLikelyEvmAddress(address) {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return methodNotAllowed('POST');

  try {
    const body = await context.request.json();
    const wallet = String(body.wallet_address || '').trim();
    if (!isLikelyEvmAddress(wallet)) {
      return json({ ok: false, error: 'That does not look like a valid EVM wallet address.' }, 400);
    }
    const db = getDb(context.env);
    await loadState(db);
    await db.prepare(`
      UPDATE bot_state
      SET wallet_address = ?, updated_at = datetime('now')
      WHERE id = 'main'
    `).bind(wallet).run();
    const state = await loadState(db);
    return json({ ok: true, state });
  } catch (error) {
    return errorJson(error);
  }
}
