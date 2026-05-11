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

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  if (data.ok === false) throw new Error(data.error || 'Request failed');
  return data;
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
  els.marketUpdated.textContent = ({ coingecko: 'Live-ish', cache: 'Cached', 'stale-cache': 'Stale cache' }[source]) || 'Live-ish';
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
    els.scanResult.textContent = err.message;
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
    els.scanResult.textContent = err.message;
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
    els.scanResult.textContent = err.message;
    els.scanStatus.textContent = 'Error';
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
    els.orderResult.textContent = err.message;
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
    els.scanResult.textContent = err.message;
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
    els.scanResult.textContent = err.message;
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
