import { errorJson, getDb, json, loadState, methodNotAllowed } from '../_lib/bot.js';

function isLikelyEvmAddress(address) {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isLikelyBitcoinAddress(address) {
  return typeof address === 'string' && (
    /^(bc1)[ac-hj-np-z02-9]{11,87}$/i.test(address) ||
    /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)
  );
}

function isLikelySolanaAddress(address) {
  return typeof address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function isLikelyPublicCryptoAddress(address) {
  return isLikelyEvmAddress(address) || isLikelyBitcoinAddress(address) || isLikelySolanaAddress(address);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return methodNotAllowed('POST');

  try {
    const body = await context.request.json();
    const wallet = String(body.wallet_address || '').trim();
    if (!isLikelyPublicCryptoAddress(wallet)) {
      return json({ ok: false, error: 'That does not look like a supported public crypto address.' }, 400);
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
