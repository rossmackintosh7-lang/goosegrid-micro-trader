import { getDb, json, loadState } from '../_lib/bot.js';

export async function onRequestGet({ env }) {
  try {
    const db = await getDb(env);
    const state = await loadState(db);
    return json({ state });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
