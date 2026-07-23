#!/usr/bin/env bash
set -euo pipefail

echo "=== Stellar Escrow dApp — Deploy Script ==="
echo ""

NETWORK="${STELLAR_NETWORK:-testnet}"
SOURCE="${STELLAR_SOURCE:-task3-deployer}"
ADMIN="${ADMIN_PUBKEY:-}"

echo "[1/5] Building contracts..."
stellar contract build -p escrow
stellar contract build -p factory

echo ""
echo "[2/5] Uploading Escrow WASM..."
ESCROW_WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source "$SOURCE" \
  --network "$NETWORK" 2>&1 | tail -1)
echo "  Escrow Wasm Hash: $ESCROW_WASM_HASH"

echo ""
echo "[3/5] Uploading Factory WASM..."
FACTORY_WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/factory.wasm \
  --source "$SOURCE" \
  --network "$NETWORK" 2>&1 | tail -1)
echo "  Factory Wasm Hash: $FACTORY_WASM_HASH"

echo ""
echo "[4/5] Deploying Factory contract..."
if [ -z "$ADMIN" ]; then
  ADMIN=$(stellar keys address "$SOURCE")
fi

FACTORY_ID=$(stellar contract deploy \
  --wasm-hash "$FACTORY_WASM_HASH" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- \
  --admin "$ADMIN" \
  --escrow_wasm_hash "$ESCROW_WASM_HASH" 2>&1 | grep '^C[A-Z0-9]\{55\}$' || true)

if [ -z "$FACTORY_ID" ]; then
  FACTORY_ID=$(stellar contract deploy \
    --wasm-hash "$FACTORY_WASM_HASH" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- \
    --admin "$ADMIN" \
    --escrow_wasm_hash "$ESCROW_WASM_HASH" 2>&1 | Select-String '^C[A-Z0-9]{55}$').Line
fi
echo "  Factory Contract ID: $FACTORY_ID"

echo ""
echo "[5/5] Updating frontend .env..."
cat > frontend/.env << EOFF
VITE_FACTORY_CONTRACT_ID=$FACTORY_ID
VITE_ESCROW_WASM_HASH=$ESCROW_WASM_HASH
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK=testnet
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
EOFF

echo ""
echo "=== Deployment Complete ==="
echo "Factory Contract ID: $FACTORY_ID"
echo "Escrow Wasm Hash:    $ESCROW_WASM_HASH"
echo "Factory Wasm Hash:   $FACTORY_WASM_HASH"
echo "Dashboard:           https://stellar.expert/explorer/testnet/contract/$FACTORY_ID"
