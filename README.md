# Decentralized Escrow — Stellar / Soroban (Orange Belt)

A production-ready, fully-tested decentralized escrow system built on
Stellar's Soroban smart-contract platform. Two contracts — **Factory** and
**Escrow** — communicate via cross-contract calls, emit rich events, and
are paired with a mobile-responsive React frontend and a CI/CD pipeline.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                 Frontend (React)              │
│  Freighter wallet → Soroban RPC → Factory     │
└──────────────────┬───────────────────────────┘
                   │ contract calls
┌──────────────────▼───────────────────────────┐
│              Factory Contract                 │
│  • Deploys new Escrow instances (deploy_v2)  │
│  • Tracks all escrows in a Vec<Address>      │
│  • Cross-contract queries Escrow for status  │
│  • Emits `esc_new` event on creation         │
└──────────────────┬───────────────────────────┘
                   │ cross-contract call
┌──────────────────▼───────────────────────────┐
│              Escrow Contract (N instances)     │
│  • State machine: Pending→Funded→(Released   │
│    | Refunded | Disputed→Resolved)           │
│  • SAC token transfer, auth checks, TTL mgmt │
│  • Events: created, funded, released,        │
│    refunded, disputed, resolved, cancelled    │
└──────────────────────────────────────────────┘
```

### Contract Lifecycle

```
Pending ──fund()──▶ Funded ──release()──▶ Released
  │                    │
  │                    ├──refund()──▶ Refunded
  │                    │
  │                    ├──claim_timeout_refund()──▶ Refunded
  │                    │
  │                    ├──open_dispute()──▶ Disputed
  │                    │                       │
  │                    │  resolve_dispute(true)──▶ Released
  │                    │  resolve_dispute(false)─▶ Refunded
  │                    │
  cancel()──▶ Cancelled
```

---

## Repository Structure

```
.
├── .github/workflows/main.yml   # CI/CD pipeline
├── contracts/
│   ├── Cargo.toml               # Workspace root
│   ├── common/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs           # Shared types, errors, EscrowInterface
│   ├── escrow/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs           # Escrow contract + 6 tests
│   └── factory/
│       ├── Cargo.toml
│       └── src/lib.rs           # Factory contract + 4 tests
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── index.css
│       ├── App.jsx              # Main UI (mobile-responsive)
│       ├── App.test.jsx         # 3 frontend tests
│       ├── contracts.js         # Soroban client helpers
│       ├── hooks/useFreighter.js
│       └── test-setup.js
└── README.md
```

---

## Prerequisites

| Tool               | Version    |
|--------------------|------------|
| Rust               | ≥ 1.86.0   |
| Soroban CLI        | ≥ 22.0.0   |
| Node.js            | ≥ 22       |
| npm                | ≥ 10       |
| Freighter (browser)| Latest     |

---

## Quick Start

### 1. Clone & install Rust dependencies

```bash
git clone <repo-url>
cd task3
```

### 2. Build contracts

```bash
cd contracts
stellar contract build -p escrow
stellar contract build -p factory
```

### 3. Run contract tests

```bash
cargo test --workspace -p escrow-common -p escrow -p factory
```

### 4. Deploy to Stellar Testnet

```bash
# Upload Escrow Wasm
ESCROW_WASM_HASH=$(stellar contract install \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source <ADMIN_SECRET> \
  --network testnet)

# Deploy Factory with admin + Escrow Wasm hash
FACTORY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/factory.wasm \
  --source <ADMIN_SECRET> \
  --network testnet \
  -- --admin <ADMIN_PUBKEY> --escrow_wasm_hash "$ESCROW_WASM_HASH")
```

### 5. Start frontend

```bash
cd frontend
cp .env.example .env   # fill VITE_FACTORY_CONTRACT_ID with FACTORY_ID above
npm install
npm run dev
```

### 6. Run frontend tests

```bash
npm test
```

---

## CI/CD

The GitHub Actions pipeline (`.github/workflows/main.yml`) runs on every push
and PR to `main`:

- **contracts job**: Installs Rust, Soroban CLI, builds both contracts, and
  runs `cargo test` for all workspace members.
- **frontend job**: Installs Node, runs `npm test` and `eslint`.

---

## Event Streaming

| Event name       | Emitted by | When                                      |
|------------------|------------|-------------------------------------------|
| `created`         | Escrow     | Constructor completes                     |
| `funded`          | Escrow     | Buyer deposits SAC tokens                 |
| `released`        | Escrow     | Buyer releases to seller                  |
| `refunded`        | Escrow     | Seller returns to buyer (voluntary)       |
| `disputed`        | Escrow     | Either party opens a dispute              |
| `resolved`        | Escrow     | Arbiter resolves a dispute                |
| `cancelled`       | Escrow     | Either party cancels before funding       |
| `timeout`         | Escrow     | Buyer claims after deadline               |
| `esc_new`         | Factory    | A new Escrow instance is deployed         |

---

## Test Coverage

### Contracts (10 tests total)

| Contract | Test                                       | What it verifies                          |
|----------|--------------------------------------------|-------------------------------------------|
| Escrow   | `test_full_happy_path_release`              | Pending→Fund→Release, balances            |
| Escrow   | `test_seller_refund`                        | Fund→Refund, buyer gets money back        |
| Escrow   | `test_dispute_resolution_favors_seller`     | Dispute→Resolve→Released to seller        |
| Escrow   | `test_timeout_refund_after_deadline`        | Fund→timeout→Refund                       |
| Escrow   | `test_cannot_release_before_funding`        | Error path: release before fund           |
| Escrow   | `test_cannot_double_fund`                   | Error path: fund twice                    |
| Factory  | `test_create_escrow_deploys_and_registers`  | Deploy count, list, cross-contract status |
| Factory  | `test_cross_contract_status_updates_after_funding` | Factory reads live Funded status   |
| Factory  | `test_multiple_escrows_get_unique_addresses`| Deterministic salt gives unique addrs     |
| Factory  | `test_admin_can_update_wasm_hash`           | Admin upgrades Wasm hash                  |

### Frontend (3 tests)

| Test                                   | What it verifies                   |
|----------------------------------------|------------------------------------|
| Shows wallet loading spinner           | Loading state renders correctly    |
| Shows connectivity error               | Error state when Freighter missing |
| Renders main UI after wallet connects  | Connected state shows full UI      |

---

## Security Considerations

- `require_auth()` is called on every state-mutating function.
- Buyer-seller equality is rejected at construction (`InvalidParties`).
- Zero and negative amounts are rejected.
- Past deadlines are rejected at construction.
- TTL is bumped on every storage write to prevent ledger eviction.
- Only the designated arbiter can resolve disputes.
- Only the admin can upgrade the Escrow Wasm hash.
