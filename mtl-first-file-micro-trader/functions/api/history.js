import { getDb, json, loadTrades } from '../_lib/bot.js';

export async function onRequestGet({ env }) {
  try {
    const db = await getDb(env);
    const trades = await loadTrades(db, 40);
    return json({ trades });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
