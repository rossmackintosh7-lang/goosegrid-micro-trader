const els = {
  refreshBtn: document.getElementById('refreshBtn'),
  runScanBtn: document.getElementById('runScanBtn'),
  runScanHero: document.getElementById('runScanHero'),
  resetBtn: document.getElementById('resetBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  connectWalletBtn: document.getElementById('connectWalletBtn'),
  saveWalletBtn: document.getElementById('saveWalletBtn'),
  loadHistoryBtn: document.getElementById('loadHistoryBtn'),
  assetSelect: document.getElementById('assetSelect'),
  modeSelect: document.getElementById('modeSelect'),
  thresholdSelect: document.getElementById('thresholdSelect'),
  tradingPot: document.getElementById('tradingPot'),
  profitVault: document.getElementById('profitVault'),
  heroPot: document.getElementById('heroPot'),
  heroVault: document.getElementById('heroVault'),
  heroMode: document.getElementById('heroMode'),
  heroPosition: document.getElementById('heroPosition'),
  walletShort: document.getElementById('walletShort'),
  walletHint: document.getElementById('walletHint'),
  walletAddress: document.getElementById('walletAddress'),
  marketCards: document.getElementById('marketCards'),
  marketUpdated: document.getElementById('marketUpdated'),
  scanStatus: document.getElementById('scanStatus'),
  scanResult: document.getElementById('scanResult'),
  tradeTableBody: document.getElementById('tradeTableBody')
};

let connectedWallet = '';

const formatGBP = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`;
const shortAddress = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : 'Not connected';
const modeLabel = (mode) => ({ cautious: 'Cautious', balanced: 'Balanced', high_risk: 'High risk' }[mode] || 'Balanced');
const pairLabel = (symbol) => ({ bitcoin: 'BTC/GBP', ethereum: 'ETH/GBP', solana: 'SOL/GBP' }[symbol] || 'BTC/GBP');

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function setBusy(isBusy) {
  [els.runScanBtn, els.runScanHero, els.refreshBtn, els.saveSettingsBtn, els.resetBtn].forEach(btn => {
    if (btn) btn.disabled = isBusy;
  });
}

function renderState(state) {
  const s = state || {};
  els.tradingPot.textContent = formatGBP(s.trading_pot_pence);
  els.profitVault.textContent = formatGBP(s.profit_vault_pence);
  els.heroPot.textContent = formatGBP(s.trading_pot_pence);
  els.heroVault.textContent = formatGBP(s.profit_vault_pence);
  els.heroMode.textContent = modeLabel(s.mode);
  els.heroPosition.textContent = s.active_position ? `${pairLabel(s.active_position.symbol)} @ £${Number(s.active_position.entry_price || 0).toFixed(2)}` : 'None';

  if (s.symbol) els.assetSelect.value = s.symbol;
  if (s.mode) els.modeSelect.value = s.mode;
  if (s.withdrawal_threshold_pence) els.thresholdSelect.value = String(s.withdrawal_threshold_pence);

  if (s.wallet_address) {
    connectedWallet = s.wallet_address;
    els.walletAddress.textContent = s.wallet_address;
    els.walletShort.textContent = shortAddress(s.wallet_address);
    els.walletHint.textContent = 'Saved as future profit destination';
  }
}

function renderMarkets(markets) {
  const rows = Object.entries(markets || {}).map(([id, item]) => {
    const change = Number(item.gbp_24h_change || 0);
    const cls = change >= 0 ? 'change-up' : 'change-down';
    return `
      <div class="market-card">
        <div>
          <strong>${pairLabel(id)}</strong><br />
          <small>24h volume: ${item.gbp_24h_vol ? `£${Math.round(item.gbp_24h_vol).toLocaleString()}` : 'n/a'}</small>
        </div>
        <div>
          <strong>£${Number(item.gbp || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><br />
          <small class="${cls}">${change.toFixed(2)}%</small>
        </div>
      </div>
    `;
  }).join('');
  els.marketCards.innerHTML = rows || '<p>No market data yet.</p>';
  els.marketUpdated.textContent = 'Live-ish';
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

async function loadAll() {
  try {
    setBusy(true);
    const [stateData, marketData, historyData] = await Promise.all([
      api('/api/state'),
      api('/api/market-data'),
      api('/api/history')
    ]);
    renderState(stateData.state);
    renderMarkets(marketData.markets);
    renderTrades(historyData.trades);
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
    renderMarkets(data.markets);
    renderTrades(data.trades);
    els.scanResult.textContent = data.message;
    els.scanStatus.textContent = data.action || 'Done';
  } catch (err) {
    els.scanResult.textContent = err.message;
    els.scanStatus.textContent = 'Error';
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
  } catch (err) {
    els.scanResult.textContent = err.message;
  } finally {
    setBusy(false);
  }
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      els.walletAddress.textContent = 'No browser wallet found. Install MetaMask, Coinbase Wallet extension, or another EVM wallet.';
      return;
    }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    connectedWallet = accounts?.[0] || '';
    els.walletAddress.textContent = connectedWallet || 'No account returned';
    els.walletShort.textContent = shortAddress(connectedWallet);
  } catch (err) {
    els.walletAddress.textContent = err.message || 'Wallet connection declined.';
  }
}

async function saveWallet() {
  if (!connectedWallet) {
    els.walletAddress.textContent = 'Connect a wallet first.';
    return;
  }
  try {
    const data = await api('/api/wallet', {
      method: 'POST',
      body: JSON.stringify({ wallet_address: connectedWallet })
    });
    renderState(data.state);
    els.scanResult.textContent = 'Wallet saved as future profit destination.';
  } catch (err) {
    els.scanResult.textContent = err.message;
  }
}

els.refreshBtn.addEventListener('click', loadAll);
els.loadHistoryBtn.addEventListener('click', loadAll);
els.saveSettingsBtn.addEventListener('click', saveSettings);
els.runScanBtn.addEventListener('click', runScan);
els.runScanHero.addEventListener('click', runScan);
els.resetBtn.addEventListener('click', resetBot);
els.connectWalletBtn.addEventListener('click', connectWallet);
els.saveWalletBtn.addEventListener('click', saveWallet);

loadAll();
