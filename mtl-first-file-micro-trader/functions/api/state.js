import { errorJson, getDb, json, loadState, methodNotAllowed } from '../_lib/bot.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');

  try {
    const db = getDb(context.env);
    const state = await loadState(db);
    return json({ ok: true, state });
  } catch (error) {
    return errorJson(error);
  }
}
