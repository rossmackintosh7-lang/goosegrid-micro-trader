import { fetchMarketsRaw, getDb, getMarketSnapshot, json } from '../_lib/bot.js';

export async function onRequestGet({ env }) {
  try {
    if (env?.DB) {
      const db = await getDb(env);
      const snapshot = await getMarketSnapshot(db, { maxAgeSeconds: 180, allowStale: true });
      return json({ ...snapshot, fetched_at: new Date().toISOString() });
    }

    const markets = await fetchMarketsRaw();
    return json({ markets, source: 'CoinGecko simple price API', fetched_at: new Date().toISOString() });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
