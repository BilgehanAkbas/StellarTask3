import { useState, useCallback, useEffect, useRef } from "react";
import {
  Contract,
  nativeToScVal,
  rpc,
  TransactionBuilder,
  Networks,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { useFreighter } from "./hooks/useFreighter.js";
import {
  fetchEscrows,
  fetchEscrowStatus,
  fetchEscrowDetails,
  fundEscrow,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
  resolveDispute,
  claimTimeout,
  cancelEscrow,
  pollContractEvents,
  STATUS_LABEL,
  EVENT_TOPICS,
} from "./contracts.js";

const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const FACTORY_ID = import.meta.env.VITE_FACTORY_CONTRACT_ID;

const EVENT_POLL_INTERVAL = 5000;

function StatusBadge({ status }) {
  const colors = {
    Pending: "bg-yellow-700/40 text-yellow-200 border-yellow-600",
    Funded: "bg-green-700/40 text-green-200 border-green-600",
    Disputed: "bg-red-700/40 text-red-200 border-red-600",
    Released: "bg-emerald-700/40 text-emerald-200 border-emerald-600",
    Refunded: "bg-slate-600/40 text-slate-200 border-slate-500",
    Cancelled: "bg-gray-600/40 text-gray-300 border-gray-500",
  };
  return (
    <span
      className={`inline-block px-3 py-1 text-xs font-semibold rounded-full border ${colors[status] || colors.Pending}`}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function ConnectivityError({ message, onRetry, onSkip }) {
  return (
    <div className="max-w-md mx-auto mt-20 p-8 bg-gray-900 border border-gray-700 rounded-2xl text-center">
      <svg
        className="mx-auto mb-4 w-12 h-12 text-amber-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <h2 className="text-xl font-bold text-white mb-2">Wallet Required</h2>
      <p className="text-gray-400 mb-6">{message}</p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors"
        >
          Retry Connection
        </button>
        <button
          onClick={onSkip}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold rounded-xl transition-colors"
        >
          Continue in Demo Mode
        </button>
      </div>
    </div>
  );
}

function CreateEscrowForm({ publicKey, onCreated, disabled }) {
  const [form, setForm] = useState({
    seller: "",
    arbiter: "",
    token: "",
    amount: "",
    deadlineDays: "7",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const amountRaw = BigInt(Math.floor(parseFloat(form.amount) * 10 ** 7));
        const server = new rpc.Server(RPC_URL);
        const factory = new Contract(FACTORY_ID);
        const sourceAccount = await server.getAccount(publicKey);

        const tx = new TransactionBuilder(sourceAccount, {
          fee: "100000",
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(
            factory.call(
              "create_escrow",
              nativeToScVal(publicKey),
              nativeToScVal(form.seller),
              nativeToScVal(form.arbiter),
              nativeToScVal(form.token),
              nativeToScVal(amountRaw),
              nativeToScVal(
                Math.floor(Date.now() / 5000) + parseInt(form.deadlineDays) * 17280
              )
            )
          )
          .setTimeout(30)
          .build();

        const { signedTxXdr: signed } = await signTransaction(tx, {
          network: NETWORK_PASSPHRASE,
          networkPassphrase: NETWORK_PASSPHRASE,
        });

        const txResult = await server.sendTransaction(signed);
        if (txResult.status === "ERROR") {
          if (txResult.errorResultXdr) {
            throw new Error("Transaction failed: " + txResult.errorResultXdr.slice(0, 100));
          }
          throw new Error("Transaction failed on-chain");
        }
        setForm({ seller: "", arbiter: "", token: "", amount: "", deadlineDays: "7" });
        onCreated();
      } catch (err) {
        setError(err.message || "Transaction failed");
      } finally {
        setLoading(false);
      }
    },
    [form, publicKey, onCreated]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4"
    >
      <h3 className="text-lg font-bold text-white">New Escrow Agreement</h3>
      {disabled && (
        <div className="p-3 bg-amber-900/30 border border-amber-700 rounded-lg text-amber-200 text-sm">
          Demo mode: form is read-only. Connect Freighter to create real escrows.
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-sm">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-gray-400">Seller Address (G...)</span>
          <input
            name="seller"
            value={form.seller}
            onChange={handleChange}
            required
            disabled={disabled}
            placeholder="G..."
            className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Arbiter Address (G...)</span>
          <input
            name="arbiter"
            value={form.arbiter}
            onChange={handleChange}
            required
            disabled={disabled}
            placeholder="G..."
            className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Token Contract ID</span>
          <input
            name="token"
            value={form.token}
            onChange={handleChange}
            required
            placeholder="C..."
            className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Amount (XLM)</span>
          <input
            name="amount"
            value={form.amount}
            onChange={handleChange}
            required
            type="number"
            step="0.0000001"
            min="0"
            placeholder="0"
            className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Deadline (days)</span>
          <input
            name="deadlineDays"
            value={form.deadlineDays}
            onChange={handleChange}
            required
            type="number"
            min="1"
            className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={loading || disabled}
        className="w-full sm:w-auto px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
      >
        {loading ? "Creating..." : disabled ? "Wallet Required" : "Create Escrow"}
      </button>
    </form>
  );
}

function EscrowCard({ address, publicKey, onActionComplete, demoMode }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const factory = new Contract(FACTORY_ID);
        const status = await fetchEscrowStatus(factory, address);
        const full = await fetchEscrowDetails(factory, address);
        if (!cancelled) {
          setDetails({ ...full, status: status || full.status, _address: address });
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const handleAction = useCallback(async (actionFn, ...args) => {
    setActionError(null);
    setActionLoading(actionFn.name);
    try {
      await actionFn(publicKey, address, ...args);
      onActionComplete();
    } catch (err) {
      setActionError(err.message || "Action failed");
    } finally {
      setActionLoading(null);
    }
  }, [publicKey, address, onActionComplete]);

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-3/4 mb-3" />
        <div className="h-4 bg-gray-700 rounded w-1/2" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <p className="text-red-400 text-sm">{error}</p>
        <p className="text-gray-500 text-xs mt-1 font-mono break-all">
          {address.slice(0, 14)}...
        </p>
      </div>
    );
  }

  const status = details.status;
  const isBuyer = publicKey && details.buyer === publicKey;
  const isSeller = publicKey && details.seller === publicKey;
  const isArbiter = publicKey && details.arbiter === publicKey;
  const amountDisplay = (Number(details.amount) / 10 ** 7).toFixed(7);

  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-6 transition-colors">
      {actionError && (
        <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-200 text-xs">
          {actionError}
        </div>
      )}

      <div
        className={`flex items-center justify-between mb-4 ${isExpanded ? "" : "cursor-pointer"}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <div className="relative">
            <div className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${
              status === "Pending" || status === "Funded" || status === "Disputed"
                ? "bg-green-500 animate-pulse"
                : "bg-gray-500"
            }`} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs font-mono">
            {address.slice(0, 10)}...{address.slice(-6)}
          </span>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div>
          <span className="text-gray-500 block text-xs">Buyer</span>
          <span className="text-gray-200 font-mono text-xs break-all">
            {isBuyer ? (
              <span className="text-indigo-400">You ({details.buyer?.slice(0, 10)}...)</span>
            ) : details.buyer?.slice(0, 12) + "..."}
          </span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Seller</span>
          <span className="text-gray-200 font-mono text-xs break-all">
            {isSeller ? (
              <span className="text-indigo-400">You ({details.seller?.slice(0, 10)}...)</span>
            ) : details.seller?.slice(0, 12) + "..."}
          </span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Amount</span>
          <span className="text-white font-semibold">
            {amountDisplay} XLM
          </span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Deadline</span>
          <span className="text-gray-200">
            Ledger #{details.deadline_ledger?.toString()}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-800 pt-4 mt-2">
          <div className="grid grid-cols-1 gap-2 mb-3">
            <div className="text-xs text-gray-500">
              <span className="text-gray-400">Token:</span>{" "}
              <span className="font-mono">{details.token?.slice(0, 14)}...</span>
            </div>
            <div className="text-xs text-gray-500">
              <span className="text-gray-400">Arbiter:</span>{" "}
              <span className="font-mono">
                {isArbiter ? <span className="text-indigo-400">You</span> : details.arbiter?.slice(0, 14) + "..."}
              </span>
            </div>
          </div>

          {!demoMode && status !== "Released" && status !== "Refunded" && status !== "Cancelled" && (
            <div className="flex flex-wrap gap-2">
              {status === "Pending" && isBuyer && (
                <ActionButton
                  label="Fund"
                  loading={actionLoading === "fundEscrow"}
                  onClick={() => handleAction(fundEscrow)}
                  className="bg-green-600 hover:bg-green-500"
                />
              )}
              {status === "Funded" && isBuyer && (
                <ActionButton
                  label="Release"
                  loading={actionLoading === "releaseEscrow"}
                  onClick={() => handleAction(releaseEscrow)}
                  className="bg-indigo-600 hover:bg-indigo-500"
                />
              )}
              {status === "Funded" && isSeller && (
                <ActionButton
                  label="Refund Buyer"
                  loading={actionLoading === "refundEscrow"}
                  onClick={() => handleAction(refundEscrow)}
                  className="bg-amber-600 hover:bg-amber-500"
                />
              )}
              {status === "Funded" && isBuyer && (
                <ActionButton
                  label="Open Dispute"
                  loading={actionLoading === "disputeEscrow"}
                  onClick={() => handleAction(disputeEscrow, publicKey)}
                  className="bg-red-600 hover:bg-red-500"
                />
              )}
              {status === "Funded" && isSeller && (
                <ActionButton
                  label="Open Dispute"
                  loading={actionLoading === "disputeEscrow"}
                  onClick={() => handleAction(disputeEscrow, publicKey)}
                  className="bg-red-600 hover:bg-red-500"
                />
              )}
              {status === "Funded" && isBuyer && (
                <ActionButton
                  label="Claim Timeout"
                  loading={actionLoading === "claimTimeout"}
                  onClick={() => handleAction(claimTimeout)}
                  className="bg-slate-600 hover:bg-slate-500"
                />
              )}
              {status === "Disputed" && isArbiter && (
                <>
                  <ActionButton
                    label="Resolve → Seller"
                    loading={actionLoading === "resolveDispute"}
                    onClick={() => handleAction(resolveDispute, true)}
                    className="bg-emerald-600 hover:bg-emerald-500"
                  />
                  <ActionButton
                    label="Resolve → Buyer"
                    loading={actionLoading === "resolveDispute"}
                    onClick={() => handleAction(resolveDispute, false)}
                    className="bg-amber-600 hover:bg-amber-500"
                  />
                </>
              )}
              {status === "Pending" && (isBuyer || isSeller) && (
                <ActionButton
                  label="Cancel"
                  loading={actionLoading === "cancelEscrow"}
                  onClick={() => handleAction(cancelEscrow, publicKey)}
                  className="bg-gray-600 hover:bg-gray-500"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, loading, onClick, className }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      {loading ? (
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Processing...
        </span>
      ) : (
        label
      )}
    </button>
  );
}

function EventLog({ events }) {
  if (events.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        Live Events
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {events.map((ev, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
              ev.type === "contract" ? "bg-indigo-700/40 text-indigo-200" : "bg-gray-700 text-gray-300"
            }`}>
              {ev.topic}
            </span>
            <span className="text-gray-500">
              {ev.contractId?.slice(0, 8)}...{ev.contractId?.slice(-6)}
            </span>
            <span className="text-gray-600">
              L{ev.ledger}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const { publicKey, error: walletError, loading: walletLoading, connect } = useFreighter();
  const [escrows, setEscrows] = useState([]);
  const [escrowsLoading, setEscrowsLoading] = useState(false);
  const [escrowsError, setEscrowsError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [events, setEvents] = useState([]);
  const eventPollRef = useRef(null);

  const effectivePublicKey = demoMode ? "GDEMO1234567890ABCDEFG1234567890ABCDEF" : publicKey;

  const loadEscrows = useCallback(async () => {
    if (!effectivePublicKey) return;
    setEscrowsLoading(true);
    setEscrowsError(null);
    try {
      if (demoMode) {
        setEscrows([]);
        setEscrowsLoading(false);
        return;
      }
      const list = await fetchEscrows(new Contract(FACTORY_ID));
      setEscrows(Array.isArray(list) ? list : []);
    } catch (err) {
      setEscrowsError(err.message);
    } finally {
      setEscrowsLoading(false);
    }
  }, [effectivePublicKey, demoMode]);

  useEffect(() => {
    loadEscrows();
  }, [loadEscrows, refreshKey]);

  useEffect(() => {
    if (demoMode || !FACTORY_ID) return;

    let cancelled = false;
    const pollEvents = async () => {
      try {
        const allEvents = [];
        const topics = Object.values(EVENT_TOPICS);
        for (const topic of topics) {
          const ev = await pollContractEvents(Math.max(1, Date.now() / 5000 - 10000), [
            {
              type: "contract",
              contractIds: [FACTORY_ID],
              topics: [[topic]],
            },
          ]);
          allEvents.push(...ev.map((e) => ({
            topic,
            ledger: e.ledger,
            contractId: e.contractId,
            timestamp: Date.now(),
            type: "contract",
          })));
        }
        if (!cancelled) {
          setEvents((prev) => {
            const merged = [...allEvents, ...prev].slice(0, 30);
            const seen = new Set();
            return merged.filter((e) => {
              const key = `${e.topic}-${e.ledger}-${e.contractId}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          });
        }
      } catch {
        // Silent fail for event polling
      }
    };

    pollEvents();
    eventPollRef.current = setInterval(pollEvents, EVENT_POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (eventPollRef.current) clearInterval(eventPollRef.current);
    };
  }, [demoMode]);

  const handleCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (walletError && !demoMode) {
    return (
      <ConnectivityError
        message={walletError}
        onRetry={connect}
        onSkip={() => setDemoMode(true)}
      />
    );
  }

  if (walletLoading && !demoMode) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Connecting wallet...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Decentralized Escrow
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Stellar / Soroban — Orange Belt
            {demoMode && (
              <span className="ml-2 inline-block px-2 py-0.5 bg-amber-700/40 text-amber-200 border border-amber-600 rounded-full text-xs font-medium">
                DEMO MODE
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-gray-500 font-mono bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-800">
            {effectivePublicKey?.slice(0, 8)}...{effectivePublicKey?.slice(-6)}
          </span>
          <button
            onClick={demoMode ? () => setDemoMode(false) : connect}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-medium transition-colors"
          >
            {demoMode ? "Exit Demo" : effectivePublicKey ? "Reconnect" : "Connect Freighter"}
          </button>
        </div>
      </header>

      {effectivePublicKey && (
        <>
          <CreateEscrowForm
            publicKey={effectivePublicKey}
            onCreated={handleCreated}
            disabled={demoMode}
          />

          {events.length > 0 && (
            <div className="mt-6">
              <EventLog events={events} />
            </div>
          )}

          <section className="mt-10">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-white">
                My Escrows{" "}
                {escrowsLoading && (
                  <span className="text-sm text-gray-500 font-normal">loading...</span>
                )}
              </h2>
              <button
                onClick={handleCreated}
                disabled={demoMode}
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 disabled:opacity-50 transition-colors"
              >
                Refresh
              </button>
            </div>
            {escrowsError && (
              <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl text-red-200 text-sm mb-4">
                {escrowsError}
                <button
                  onClick={handleCreated}
                  className="ml-4 underline hover:text-red-100"
                >
                  Retry
                </button>
              </div>
            )}
            {!escrowsLoading && escrows.length === 0 && !escrowsError && (
              <p className="text-gray-500 text-sm">
                No escrows yet. Create one above.
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              {escrows.map((addr) => (
                <EscrowCard
                  key={addr}
                  address={addr}
                  publicKey={demoMode ? null : publicKey}
                  onActionComplete={handleCreated}
                  demoMode={demoMode}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default App;
