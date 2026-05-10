import { fetchMarkets, json } from '../_lib/bot.js';

export async function onRequestGet() {
  try {
    const markets = await fetchMarkets();
    return json({ markets, source: 'CoinGecko simple price API', fetched_at: new Date().toISOString() });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
