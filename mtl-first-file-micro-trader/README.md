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
Build output directory: /

## D1

Create a database named:

mtl_micro_trader

Run:

schema/schema.sql

Add a D1 binding to your Pages project:

Variable name: DB
Database: mtl_micro_trader

Redeploy after adding the binding.
