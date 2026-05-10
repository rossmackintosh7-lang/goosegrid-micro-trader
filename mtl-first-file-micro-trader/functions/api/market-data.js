import { errorJson, getDb, getMarketSnapshot, json, methodNotAllowed } from '../_lib/bot.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');

  try {
    const db = getDb(context.env);
    const snapshot = await getMarketSnapshot(db, { maxAgeSeconds: 180, allowStale: true });
    return json({ ...snapshot, fetched_at: new Date().toISOString() });
  } catch (error) {
    return errorJson(error);
  }
}
