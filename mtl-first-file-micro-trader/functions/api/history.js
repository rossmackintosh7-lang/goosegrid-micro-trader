import { errorJson, getDb, json, loadTrades, methodNotAllowed } from '../_lib/bot.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');

  try {
    const db = getDb(context.env);
    const trades = await loadTrades(db, 40);
    return json({ ok: true, trades });
  } catch (error) {
    return errorJson(error);
  }
}
