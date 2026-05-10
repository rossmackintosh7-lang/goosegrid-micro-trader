# GooseGrid Micro Trader

Private proof build for Ross.

This is a paper-trading proof system, not a live trading bot.

## What it does

- Starts with a £10 paper trading pot.
- Opens simulated paper positions from simple market momentum rules.
- Closes simulated positions at take-profit or stop-loss thresholds.
- Skims simulated profit into a profit vault.
- Saves an EVM wallet address as a future profit destination.
- Logs trades in Cloudflare D1.

## What it does not do

- It does not place real exchange orders.
- It does not ask for seed phrases.
- It does not sign wallet transactions.
- It does not withdraw funds.
- It does not provide financial advice.

## Cloudflare Pages settings

Framework preset: None
Build command: exit 0
Build output directory: .

## D1

Create a database named:

mtl_micro_trader

Run:

schema/schema.sql

Add a D1 binding to your Pages project:

Variable name: DB
Database: mtl_micro_trader
Database ID: 41f648ae-25de-47af-bcd9-5d36a80b9164

Redeploy after adding the binding.


## v1.1 rate-limit fix
This version caches CoinGecko market data in D1 for 3 minutes. The app uses the cache for scans so pressing Refresh and Run market scan no longer causes back-to-back CoinGecko calls. If CoinGecko returns 429, the app falls back to the most recent cached market snapshot when available.

If you already created the D1 database, run this SQL once:

```sql
CREATE TABLE IF NOT EXISTS market_cache (
  id TEXT PRIMARY KEY,
  markets_json TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
