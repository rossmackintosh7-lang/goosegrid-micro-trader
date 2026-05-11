import {
  analyseMarkets,
  analyseOpenPosition,
  errorJson,
  getDb,
  getMarketSnapshot,
  json,
  loadState,
  methodNotAllowed
} from '../_lib/bot.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');

  try {
    const db = getDb(context.env);
    const state = await loadState(db);
    const snapshot = await getMarketSnapshot(db, { maxAgeSeconds: 180, allowStale: true });
    const positionAnalysis = analyseOpenPosition({ state, markets: snapshot.markets });
    const marketAnalysis = analyseMarkets(snapshot.markets);

    return json({
      ok: true,
      state,
      position_analysis: positionAnalysis,
      market_analysis: marketAnalysis,
      markets: snapshot.markets,
      market_source: snapshot.source,
      market_warning: snapshot.warning || null,
      updated_at: new Date().toISOString(),
      disclaimer: 'Market signals are estimates for decision support only, not financial advice.'
    });
  } catch (error) {
    return errorJson(error);
  }
}
