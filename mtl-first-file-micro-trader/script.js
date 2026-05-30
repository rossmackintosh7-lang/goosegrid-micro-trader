const els = {
  refreshBtn: document.getElementById('refreshBtn'),
  runScanBtn: document.getElementById('runScanBtn'),
  runScanHero: document.getElementById('runScanHero'),
  resetBtn: document.getElementById('resetBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  connectWalletBtn: document.getElementById('connectWalletBtn'),
  saveWalletBtn: document.getElementById('saveWalletBtn'),
  practiceBuyBtn: document.getElementById('practiceBuyBtn'),
  practiceSellBtn: document.getElementById('practiceSellBtn'),
  loadHistoryBtn: document.getElementById('loadHistoryBtn'),
  assetSelect: document.getElementById('assetSelect'),
  tradeAssetSelect: document.getElementById('tradeAssetSelect'),
  modeSelect: document.getElementById('modeSelect'),
  environmentSelect: document.getElementById('environmentSelect'),
  orderAmount: document.getElementById('orderAmount'),
  thresholdSelect: document.getElementById('thresholdSelect'),
  tradingPot: document.getElementById('tradingPot'),
  profitVault: document.getElementById('profitVault'),
  heroPot: document.getElementById('heroPot'),
  heroVault: document.getElementById('heroVault'),
  heroMode: document.getElementById('heroMode'),
  heroEnvironment: document.getElementById('heroEnvironment'),
  heroPosition: document.getElementById('heroPosition'),
  liveTradingStatus: document.getElementById('liveTradingStatus'),
  liveTradingHint: document.getElementById('liveTradingHint'),
  environmentStatus: document.getElementById('environmentStatus'),
  positionTitle: document.getElementById('positionTitle'),
  positionEntry: document.getElementById('positionEntry'),
  positionSize: document.getElementById('positionSize'),
  positionEnvironment: document.getElementById('positionEnvironment'),
  monitorStatus: document.getElementById('monitorStatus'),
  predictionSignal: document.getElementById('predictionSignal'),
  predictionText: document.getElementById('predictionText'),
  livePnl: document.getElementById('livePnl'),
  sellTarget: document.getElementById('sellTarget'),
  stopLine: document.getElementById('stopLine'),
  monitorMeta: document.getElementById('monitorMeta'),
  predictionUpdated: document.getElementById('predictionUpdated'),
  predictionCards: document.getElementById('predictionCards'),
  walletShort: document.getElementById('walletShort'),
  walletHint: document.getElementById('walletHint'),
  walletAddress: document.getElementById('walletAddress'),
  manualWalletAddress: document.getElementById('manualWalletAddress'),
  marketCards: document.getElementById('marketCards'),
  marketUpdated: document.getElementById('marketUpdated'),
  scanStatus: document.getElementById('scanStatus'),
  scanResult: document.getElementById('scanResult'),
  orderResult: document.getElementById('orderResult'),
  tradeTableBody: document.getElementById('tradeTableBody')
};

let connectedWallet = '';
let appBusy = false;
let lastAutoRefreshAt = 0;
let authPromptPromise = null;

const LOCAL_STORE_KEY = 'goosegrid.microTrader.localState.v2';
const ACCESS_TOKEN_KEY = 'goosegrid.microTrader.accessToken';
const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=gbp&ids=bitcoin,ethereum,solana&order=market_cap_desc&per_page=3&page=1&sparkline=false&price_change_percentage=24h';

const formatGBP = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`;
const formatAmount = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`;
const formatPrice = (price) => Number(price || 0) ? `£${Number(price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '-';
const shortAddress = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'Not connected';
const modeLabel = (mode) => ({ cautious: 'Cautious', balanced: 'Balanced', high_risk: 'High risk' }[mode] || 'Balanced');
const environmentLabel = (environment) => ({ practice: 'Practice', real: 'Real' }[environment] || 'Practice');
const pairLabel = (symbol) => ({ bitcoin: 'BTC/GBP', ethereum: 'ETH/GBP', solana: 'SOL/GBP' }[symbol] || 'BTC/GBP');
const isLikelyEvmAddress = (addr) => /^0x[a-fA-F0-9]{40}$/.test(String(addr || '').trim());
const isLikelyBitcoinAddress = (addr) => /^(bc1)[ac-hj-np-z02-9]{11,87}$/i.test(String(addr || '').trim()) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(String(addr || '').trim());
const isLikelySolanaAddress = (addr) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(addr || '').trim());
const isLikelyPublicCryptoAddress = (addr) => isLikelyEvmAddress(addr) || isLikelyBitcoinAddress(addr) || isLikelySolanaAddress(addr);

async function requestAccessToken() {
  if (!authPromptPromise) {
    authPromptPromise = Promise.resolve().then(() => {
      const token = window.prompt('GooseGrid is private. Paste your access token to continue:');
      if (token) sessionStorage.setItem(ACCESS_TOKEN_KEY, token.trim());
      return token?.trim() || '';
    }).finally(() => {
      authPromptPromise = null;
    });
  }
  return authPromptPromise;
}

async function api(path, options = {}, retryAuth = true) {
  const token = sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Bot-Token': token } : {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && retryAuth) {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    const nextToken = await requestAccessToken();
    if (nextToken) return api(path, options, false);
  }
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error || `Request failed: ${res.status}`);
    error.d1Missing = /D1 binding missing/i.test(error.message);
    throw error;
  }
  return data;
}

function defaultLocalStore() {
  return {
    state: {
      id: 'main',
      trading_pot_pence: 1000,
      profit_vault_pence: 0,
      starting_pot_pence: 1000,
      active_position_json: null,
      active_position: null,
      symbol: 'bitcoin',
      mode: 'balanced',
      trading_environment: 'practice',
      wallet_address: '',
      withdrawal_threshold_pence: 2500
    },
    trades: [],
    markets: [],
    market_source: 'browser',
    updated_at: new Date().toISOString()
  };
}

function readLocalStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_STORE_KEY) || 'null');
    if (!parsed?.state) return defaultLocalStore();
    return {
      ...defaultLocalStore(),
      ...parsed,
      state: { ...defaultLocalStore().state, ...parsed.state }
    };
  } catch {
    return defaultLocalStore();
  }
}

function writeLocalStore(store) {
  localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify({
    ...store,
    updated_at: new Date().toISOString()
  }));
}

function normaliseClientMarkets(rawMarkets) {
  const rows = Array.isArray(rawMarkets)
    ? rawMarkets
    : Object.entries(rawMarkets || {}).map(([id, item]) => ({ id, ...item }));

  return rows
    .map((item) => {
      const id = ['bitcoin', 'ethereum', 'solana'].includes(item.id) ? item.id : String(item.id || '').toLowerCase();
      if (!['bitcoin', 'ethereum', 'solana'].includes(id)) return null;
      return {
        id,
        pair_label: pairLabel(id),
        symbol: String(item.symbol || id).toUpperCase(),
        name: item.name || id,
        image: item.image || null,
        gbp: Number(item.gbp ?? item.current_price ?? 0),
        gbp_24h_change: Number(item.gbp_24h_change ?? item.price_change_percentage_24h_in_currency ?? item.price_change_percentage_24h ?? 0),
        gbp_24h_vol: Number(item.gbp_24h_vol ?? item.total_volume ?? 0),
        market_cap: Number(item.market_cap ?? item.gbp_market_cap ?? 0)
      };
    })
    .filter(Boolean);
}

function findClientMarket(markets, symbol) {
  return normaliseClientMarkets(markets).find((market) => market.id === symbol) || null;
}

async function fetchBrowserMarkets() {
  const store = readLocalStore();
  try {
    const res = await fetch(COINGECKO_MARKETS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CoinGecko market data failed with status ${res.status}`);
    const markets = normaliseClientMarkets(await res.json());
    writeLocalStore({ ...store, markets, market_source: 'browser-coingecko' });
    return { ok: true, markets, source: 'browser-coingecko' };
  } catch {
    return { ok: true, markets: store.markets || [], source: store.markets?.length ? 'browser-cache' : 'browser-empty' };
  }
}

function localAnalysis(store) {
  const state = store.state || defaultLocalStore().state;
  const position = state.active_position;
  const markets = normaliseClientMarkets(store.markets || []);
  if (!position) {
    return {
      ok: true,
      state,
      position_analysis: {
        has_position: false,
        signal_label: 'No open trade',
        message: 'Open a practice position to get live sell guidance.'
      },
      market_analysis: markets.map((market) => marketPrediction(market)),
      market_source: store.market_source || 'browser'
    };
  }

  const market = findClientMarket(markets, position.symbol);
  const modeRules = {
    cautious: { takeProfitPct: 1.2, stopLossPct: -0.8 },
    balanced: { takeProfitPct: 2, stopLossPct: -1 },
    high_risk: { takeProfitPct: 4, stopLossPct: -2.5 }
  }[state.mode] || { takeProfitPct: 2, stopLossPct: -1 };
  const entry = Number(position.entry_price || 0);
  const current = Number(market?.gbp || entry);
  const size = Number(position.position_size_pence || position.pot_at_entry_pence || state.trading_pot_pence || 1000);
  const pnlPct = entry ? ((current - entry) / entry) * 100 : 0;
  const pnlPence = Math.round(size * (pnlPct / 100));
  const targetPrice = entry * (1 + modeRules.takeProfitPct / 100);
  const stopPrice = entry * (1 + modeRules.stopLossPct / 100);
  const signalLabel = pnlPct >= modeRules.takeProfitPct ? 'Sell signal' : pnlPct <= modeRules.stopLossPct ? 'Risk exit' : 'Hold / watch';

  return {
    ok: true,
    state,
    position_analysis: {
      has_position: true,
      signal_label: signalLabel,
      message: signalLabel === 'Sell signal'
        ? `Target reached at ${pnlPct.toFixed(2)}% P/L. Consider closing the practice trade or tightening your stop.`
        : signalLabel === 'Risk exit'
          ? `Stop line reached at ${pnlPct.toFixed(2)}% P/L. Consider closing the practice trade to limit the loss.`
          : `Watching ${pairLabel(position.symbol)}. Target is £${targetPrice.toFixed(2)} and stop line is £${stopPrice.toFixed(2)}.`,
      pnl_pence: pnlPence,
      pnl_pct: pnlPct,
      target_price: targetPrice,
      stop_price: stopPrice
    },
    market_analysis: markets.map((marketRow) => marketPrediction(marketRow)),
    market_source: store.market_source || 'browser',
    updated_at: new Date().toISOString()
  };
}

function marketPrediction(market) {
  const change = Number(market.gbp_24h_change || 0);
  if (change >= 0.5) return { symbol: market.id, pair_label: pairLabel(market.id), direction: 'UP', label: change >= 2 ? 'Strong momentum' : 'Positive momentum', confidence: 'medium', change_24h: change };
  if (change <= -0.5) return { symbol: market.id, pair_label: pairLabel(market.id), direction: 'DOWN', label: change <= -2 ? 'Sell pressure' : 'Softening', confidence: 'medium', change_24h: change };
  return { symbol: market.id, pair_label: pairLabel(market.id), direction: 'SIDEWAYS', label: 'Range / wait', confidence: 'medium', change_24h: change };
}

function setBusy(isBusy) {
  appBusy = isBusy;
  [els.runScanBtn, els.runScanHero, els.refreshBtn, els.saveSettingsBtn, els.resetBtn, els.connectWalletBtn, els.saveWalletBtn].forEach(btn => {
    if (btn) btn.disabled = isBusy;
  });
  const orderLocked = els.environmentSelect?.value === 'real';
  [els.practiceBuyBtn, els.practiceSellBtn].forEach(btn => {
    if (btn) btn.disabled = appBusy || orderLocked;
  });
}

function syncOrderButtons() {
  const orderLocked = els.environmentSelect?.value === 'real';
  [els.practiceBuyBtn, els.practiceSellBtn].forEach(btn => {
    if (btn) btn.disabled = appBusy || orderLocked;
  });
}

function renderEnvironment(environment) {
  const value = environment === 'real' ? 'real' : 'practice';
  const label = environmentLabel(value);
  els.heroEnvironment.textContent = label;
  els.environmentStatus.textContent = label;
  els.environmentSelect.value = value;

  if (value === 'real') {
    els.liveTradingStatus.textContent = 'Locked';
    els.liveTradingHint.textContent = 'Real orders need exchange keys, limits, and explicit approval.';
    els.orderResult.textContent = 'Real mode selected. Buy and sell are locked until a live exchange adapter is configured. Switch back to Practice to manage practice positions.';
  } else {
    els.liveTradingStatus.textContent = 'Practice';
    els.liveTradingHint.textContent = 'Practice buys and sells are simulated.';
  }
  syncOrderButtons();
}

function renderPosition(position) {
  if (!position) {
    els.positionTitle.textContent = 'No open position';
    els.positionEntry.textContent = '-';
    els.positionSize.textContent = '-';
    els.positionEnvironment.textContent = '-';
    els.heroPosition.textContent = 'None';
    return;
  }

  els.positionTitle.textContent = `${pairLabel(position.symbol)} open`;
  els.positionEntry.textContent = `£${Number(position.entry_price || 0).toFixed(2)}`;
  els.positionSize.textContent = formatAmount(position.position_size_pence || position.pot_at_entry_pence || 0);
  els.positionEnvironment.textContent = environmentLabel(position.environment || 'practice');
  els.heroPosition.textContent = `${pairLabel(position.symbol)} @ £${Number(position.entry_price || 0).toFixed(2)}`;
}

function renderState(state) {
  const s = state || {};
  els.tradingPot.textContent = formatGBP(s.trading_pot_pence);
  els.profitVault.textContent = formatGBP(s.profit_vault_pence);
  els.heroPot.textContent = formatGBP(s.trading_pot_pence);
  els.heroVault.textContent = formatGBP(s.profit_vault_pence);
  els.heroMode.textContent = modeLabel(s.mode);
  renderEnvironment(s.trading_environment);
  renderPosition(s.active_position);

  if (s.symbol) {
    els.assetSelect.value = s.symbol;
    els.tradeAssetSelect.value = s.symbol;
  }
  if (s.mode) els.modeSelect.value = s.mode;
  if (s.withdrawal_threshold_pence) els.thresholdSelect.value = String(s.withdrawal_threshold_pence);
  if (s.trading_pot_pence) els.orderAmount.value = (Number(s.trading_pot_pence) / 100).toFixed(2);

  if (s.wallet_address) {
    connectedWallet = s.wallet_address;
    if (els.manualWalletAddress) els.manualWalletAddress.value = s.wallet_address;
    els.walletAddress.textContent = s.wallet_address;
    els.walletShort.textContent = shortAddress(s.wallet_address);
    els.walletHint.textContent = 'Saved as future profit destination';
  }
}

function marketList(markets) {
  if (Array.isArray(markets)) return markets;
  return Object.entries(markets || {}).map(([id, item]) => ({ id, ...item }));
}

function renderMarkets(markets, source = '') {
  const rows = marketList(markets).map((item) => {
    const id = item.id;
    const price = Number(item.gbp ?? item.current_price ?? 0);
    const volume = Number(item.gbp_24h_vol ?? item.total_volume ?? 0);
    const change = Number(item.gbp_24h_change || 0);
    const cls = change >= 0 ? 'change-up' : 'change-down';
    return `
      <div class="market-card">
        <div>
          <strong>${item.pair_label || pairLabel(id)}</strong><br />
          <small>24h volume: ${volume ? `£${Math.round(volume).toLocaleString()}` : 'n/a'}</small>
        </div>
        <div>
          <strong>£${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><br />
          <small class="${cls}">${change.toFixed(2)}%</small>
        </div>
      </div>
    `;
  }).join('');
  els.marketCards.innerHTML = rows || '<p>No market data yet.</p>';
  els.marketUpdated.textContent = ({ coinbase: 'Coinbase live', cache: 'Cached', 'stale-cache': 'Stale cache' }[source]) || 'Live-ish';
}

function renderTrades(trades) {
  if (!trades || !trades.length) {
    els.tradeTableBody.innerHTML = '<tr><td colspan="7">No trades yet.</td></tr>';
    return;
  }
  els.tradeTableBody.innerHTML = trades.map(t => {
    const pnl = Number(t.pnl_pence || 0);
    const pnlCls = pnl >= 0 ? 'change-up' : 'change-down';
    return `
      <tr>
        <td>${new Date(t.created_at).toLocaleString()}</td>
        <td>${pairLabel(t.symbol)}</td>
        <td>${t.action}</td>
        <td>${t.entry_price ? `£${Number(t.entry_price).toFixed(2)}` : '-'}</td>
        <td>${t.exit_price ? `£${Number(t.exit_price).toFixed(2)}` : '-'}</td>
        <td class="${pnlCls}">${pnl ? formatGBP(pnl) : '-'}</td>
        <td>${t.reason || '-'}</td>
      </tr>
    `;
  }).join('');
}

function renderAnalysis(data) {
  const position = data?.position_analysis || {};
  const markets = data?.market_analysis || [];
  els.monitorStatus.textContent = position.signal_label || 'Watching';
  els.predictionSignal.textContent = position.signal_label || 'No open trade';
  els.predictionText.textContent = position.message || 'Open a practice position to get live sell guidance.';

  if (position.has_position) {
    const pnl = Number(position.pnl_pence || 0);
    els.livePnl.textContent = `${formatGBP(pnl)} (${Number(position.pnl_pct || 0).toFixed(2)}%)`;
    els.livePnl.className = pnl >= 0 ? 'change-up' : 'change-down';
    els.sellTarget.textContent = formatPrice(position.target_price);
    els.stopLine.textContent = formatPrice(position.stop_price);
  } else {
    els.livePnl.textContent = '-';
    els.livePnl.className = '';
    els.sellTarget.textContent = '-';
    els.stopLine.textContent = '-';
  }

  const source = data?.market_source || 'cache';
  const updated = data?.updated_at ? new Date(data.updated_at).toLocaleTimeString() : 'now';
  els.monitorMeta.textContent = `Updated ${updated}. Source: ${source}. Signals are estimates, not financial advice.`;
  els.predictionUpdated.textContent = source === 'stale-cache' ? 'Stale cache' : 'Live-ish';

  els.predictionCards.innerHTML = markets.map((market) => `
    <div class="market-card">
      <div>
        <strong>${market.pair_label}</strong><br />
        <small>${market.label} · ${market.confidence} confidence</small>
      </div>
      <div>
        <strong>${market.direction}</strong><br />
        <small class="${market.direction === 'UP' ? 'change-up' : market.direction === 'DOWN' ? 'change-down' : ''}">${Number(market.change_24h || 0).toFixed(2)}%</small>
      </div>
    </div>
  `).join('') || '<p>No predictions yet.</p>';
}

async function renderLocalMode(message = 'Using browser memory because this deployment has no D1 binding. Your wallet, settings, open practice trade and trade log are saved in this browser.') {
  const store = readLocalStore();
  const marketData = await fetchBrowserMarkets();
  const nextStore = { ...readLocalStore(), markets: marketData.markets, market_source: marketData.source };
  writeLocalStore(nextStore);
  renderState(nextStore.state);
  renderMarkets(nextStore.markets, nextStore.market_source);
  renderTrades(nextStore.trades);
  renderAnalysis(localAnalysis(nextStore));
  els.scanStatus.textContent = 'Local';
  els.scanResult.textContent = message;
}

function saveLocalSettings() {
  const store = readLocalStore();
  store.state = {
    ...store.state,
    symbol: els.assetSelect.value,
    mode: els.modeSelect.value,
    trading_environment: els.environmentSelect.value,
    withdrawal_threshold_pence: Number(els.thresholdSelect.value)
  };
  writeLocalStore(store);
  renderState(store.state);
  els.scanResult.textContent = 'Settings saved in this browser. D1 is unavailable on this deployment.';
}

function saveLocalWallet(wallet) {
  const store = readLocalStore();
  store.state = { ...store.state, wallet_address: wallet };
  writeLocalStore(store);
  renderState(store.state);
  els.scanResult.textContent = 'Wallet saved in this browser. D1 is unavailable on this deployment.';
}

async function placeLocalOrder(side) {
  const store = readLocalStore();
  const state = store.state;
  if (els.environmentSelect.value === 'real') {
    els.orderResult.textContent = 'Real trading is locked. Switch to Practice to manage browser-saved practice trades.';
    return;
  }

  const marketData = await fetchBrowserMarkets();
  store.markets = marketData.markets;
  store.market_source = marketData.source;

  const symbol = els.tradeAssetSelect.value || state.symbol || 'bitcoin';
  const market = findClientMarket(store.markets, symbol);
  if (!market?.gbp) {
    els.orderResult.textContent = 'No market price is available yet. Refresh and try again.';
    writeLocalStore(store);
    return;
  }

  if (side === 'BUY') {
    if (state.active_position) {
      els.orderResult.textContent = `Practice position already open on ${pairLabel(state.active_position.symbol)}. Sell it before buying again.`;
      return;
    }
    const amountPence = Math.min(Math.max(100, Math.round(Number(els.orderAmount.value || 0) * 100)), Number(state.trading_pot_pence || 1000));
    const position = {
      symbol,
      pair_label: pairLabel(symbol),
      entry_price: Number(market.gbp),
      entered_at: new Date().toISOString(),
      mode: state.mode,
      environment: 'practice',
      position_size_pence: amountPence,
      quantity_estimate: amountPence / 100 / Number(market.gbp)
    };
    state.symbol = symbol;
    state.active_position = position;
    state.active_position_json = JSON.stringify(position);
    store.trades = [{
      id: crypto.randomUUID(),
      symbol,
      action: 'PRACTICE_BUY',
      entry_price: Number(market.gbp),
      exit_price: null,
      pot_before_pence: state.trading_pot_pence,
      pot_after_pence: state.trading_pot_pence,
      pnl_pence: 0,
      pnl_pct: 0,
      reason: `Browser-saved practice buy opened for ${formatGBP(amountPence)} at £${Number(market.gbp).toFixed(2)}.`,
      mode: state.mode,
      environment: 'practice',
      created_at: new Date().toISOString()
    }, ...(store.trades || [])].slice(0, 40);
    els.orderResult.textContent = `Practice buy saved in this browser on ${pairLabel(symbol)} for ${formatGBP(amountPence)}.`;
  } else {
    const active = state.active_position;
    if (!active) {
      els.orderResult.textContent = 'No open practice position to sell.';
      return;
    }
    const activeMarket = findClientMarket(store.markets, active.symbol) || market;
    const exitPrice = Number(activeMarket.gbp || active.entry_price);
    const entryPrice = Number(active.entry_price);
    const positionSize = Number(active.position_size_pence || active.pot_at_entry_pence || state.trading_pot_pence || 1000);
    const potBefore = Number(state.trading_pot_pence || 1000);
    const pnlPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    const pnlPence = Math.round(positionSize * (pnlPct / 100));
    const potAfterRaw = Math.max(0, potBefore + pnlPence);
    const skimmed = Math.max(0, potAfterRaw - 1000);
    state.trading_pot_pence = skimmed > 0 ? 1000 : potAfterRaw;
    state.profit_vault_pence = Number(state.profit_vault_pence || 0) + skimmed;
    state.active_position = null;
    state.active_position_json = null;
    store.trades = [{
      id: crypto.randomUUID(),
      symbol: active.symbol,
      action: 'PRACTICE_SELL',
      entry_price: entryPrice,
      exit_price: exitPrice,
      pot_before_pence: potBefore,
      pot_after_pence: state.trading_pot_pence,
      pnl_pence: pnlPence,
      pnl_pct: pnlPct,
      reason: `Browser-saved practice sell closed at ${pnlPct.toFixed(2)}%.`,
      mode: state.mode,
      environment: 'practice',
      created_at: new Date().toISOString()
    }, ...(store.trades || [])].slice(0, 40);
    els.orderResult.textContent = `Practice sell saved in this browser. P/L ${formatGBP(pnlPence)}.`;
  }

  writeLocalStore(store);
  renderState(store.state);
  renderMarkets(store.markets, store.market_source);
  renderTrades(store.trades);
  renderAnalysis(localAnalysis(store));
}

async function loadAll() {
  try {
    setBusy(true);
    const [stateData, marketData, historyData] = await Promise.all([
      api('/api/state'),
      api('/api/market-data'),
      api('/api/history')
    ]);
    renderState(stateData.state);
    renderMarkets(marketData.markets, marketData.source);
    renderTrades(historyData.trades);
    const analysisData = await api('/api/analysis');
    renderAnalysis(analysisData);
  } catch (err) {
    if (err.d1Missing) {
      await renderLocalMode();
    } else {
      els.scanResult.textContent = err.message;
    }
    console.error(err);
  } finally {
    setBusy(false);
  }
}

async function saveSettings() {
  try {
    setBusy(true);
    const data = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        symbol: els.assetSelect.value,
        mode: els.modeSelect.value,
        trading_environment: els.environmentSelect.value,
        withdrawal_threshold_pence: Number(els.thresholdSelect.value)
      })
    });
    renderState(data.state);
    els.scanResult.textContent = 'Settings saved. Paper bot rules updated.';
  } catch (err) {
    if (err.d1Missing) saveLocalSettings();
    else els.scanResult.textContent = err.message;
  } finally {
    setBusy(false);
  }
}

async function runScan() {
  try {
    setBusy(true);
    els.scanStatus.textContent = 'Scanning';
    const data = await api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        symbol: els.assetSelect.value,
        mode: els.modeSelect.value,
        withdrawal_threshold_pence: Number(els.thresholdSelect.value)
      })
    });
    renderState(data.state);
    renderMarkets(data.markets, data.market_source);
    renderTrades(data.trades);
    const analysisData = await api('/api/analysis');
    renderAnalysis(analysisData);
    els.scanResult.textContent = data.message;
    els.scanStatus.textContent = data.action || 'Done';
  } catch (err) {
    if (err.d1Missing) {
      await renderLocalMode('D1 is unavailable on this deployment. Live monitor is using browser-saved practice state.');
    } else {
      els.scanResult.textContent = err.message;
      els.scanStatus.textContent = 'Error';
    }
  } finally {
    setBusy(false);
  }
}

async function placeOrder(side) {
  try {
    setBusy(true);
    els.orderResult.textContent = `${side === 'BUY' ? 'Buying' : 'Selling'} in ${environmentLabel(els.environmentSelect.value).toLowerCase()} mode...`;
    const amountPence = Math.round(Number(els.orderAmount.value || 0) * 100);
    const data = await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({
        side,
        symbol: els.tradeAssetSelect.value,
        trading_environment: els.environmentSelect.value,
        amount_pence: amountPence
      })
    });
    renderState(data.state);
    renderMarkets(data.markets, data.market_source);
    renderTrades(data.trades);
    const analysisData = await api('/api/analysis');
    renderAnalysis(analysisData);
    els.orderResult.textContent = data.message;
  } catch (err) {
    if (err.d1Missing) await placeLocalOrder(side);
    else els.orderResult.textContent = err.message;
  } finally {
    setBusy(false);
  }
}

async function resetBot() {
  const yes = window.confirm('Reset the paper pot, profit vault and open paper position? Trade history stays for proof unless you clear D1 manually.');
  if (!yes) return;
  try {
    setBusy(true);
    const data = await api('/api/reset', { method: 'POST' });
    renderState(data.state);
    els.scanResult.textContent = 'Paper bot reset to £10 pot and £0 vault.';
    els.orderResult.textContent = 'Practice platform reset.';
  } catch (err) {
    if (err.d1Missing) {
      const store = readLocalStore();
      store.state = {
        ...store.state,
        trading_pot_pence: 1000,
        profit_vault_pence: 0,
        active_position: null,
        active_position_json: null,
        trading_environment: 'practice'
      };
      writeLocalStore(store);
      renderState(store.state);
      renderAnalysis(localAnalysis(store));
      els.scanResult.textContent = 'Practice platform reset in this browser.';
      els.orderResult.textContent = 'Practice platform reset in this browser.';
    } else {
      els.scanResult.textContent = err.message;
    }
  } finally {
    setBusy(false);
  }
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      els.walletAddress.textContent = 'No browser wallet found. Paste your public crypto address above, then save it.';
      return;
    }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    connectedWallet = accounts?.[0] || '';
    if (els.manualWalletAddress && connectedWallet) els.manualWalletAddress.value = connectedWallet;
    els.walletAddress.textContent = connectedWallet || 'No account returned';
    els.walletShort.textContent = shortAddress(connectedWallet);
  } catch (err) {
    els.walletAddress.textContent = err.message || 'Wallet connection declined.';
  }
}

async function saveWallet() {
  const wallet = String(els.manualWalletAddress?.value || connectedWallet || '').trim();
  if (!wallet) {
    els.walletAddress.textContent = 'Connect a wallet or paste a public address first.';
    return;
  }
  if (!isLikelyPublicCryptoAddress(wallet)) {
    els.walletAddress.textContent = 'Enter a supported public crypto address, such as 0x..., bc1..., 1..., 3..., or a Solana address.';
    return;
  }
  try {
    setBusy(true);
    const data = await api('/api/wallet', {
      method: 'POST',
      body: JSON.stringify({ wallet_address: wallet })
    });
    renderState(data.state);
    els.scanResult.textContent = 'Wallet saved as future profit destination.';
  } catch (err) {
    if (err.d1Missing) saveLocalWallet(wallet);
    else els.scanResult.textContent = err.message;
  } finally {
    setBusy(false);
  }
}

function previewManualWallet() {
  const wallet = String(els.manualWalletAddress?.value || '').trim();
  if (!wallet) return;
  connectedWallet = wallet;
  els.walletAddress.textContent = wallet;
  els.walletShort.textContent = shortAddress(wallet);
  els.walletHint.textContent = isLikelyPublicCryptoAddress(wallet) ? 'Unsaved public address' : 'Check address format before saving';
}

els.refreshBtn.addEventListener('click', loadAll);
els.loadHistoryBtn.addEventListener('click', loadAll);
els.saveSettingsBtn.addEventListener('click', saveSettings);
els.runScanBtn.addEventListener('click', runScan);
els.runScanHero.addEventListener('click', runScan);
els.resetBtn.addEventListener('click', resetBot);
els.practiceBuyBtn.addEventListener('click', () => placeOrder('BUY'));
els.practiceSellBtn.addEventListener('click', () => placeOrder('SELL'));
els.environmentSelect.addEventListener('change', () => renderEnvironment(els.environmentSelect.value));
els.connectWalletBtn.addEventListener('click', connectWallet);
els.saveWalletBtn.addEventListener('click', saveWallet);
els.manualWalletAddress.addEventListener('input', previewManualWallet);

loadAll();

setInterval(() => {
  const now = Date.now();
  if (appBusy || now - lastAutoRefreshAt < 55000) return;
  lastAutoRefreshAt = now;
  loadAll();
}, 60000);
