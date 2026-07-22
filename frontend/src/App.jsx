import { useState, useCallback, useEffect } from "react";
import {
  Contract,
  rpc,
  TransactionBuilder,
  nativeToScVal,
  Networks,
} from "@stellar/stellar-sdk";
import { useFreighter } from "./hooks/useFreighter.js";
import {
  fetchEscrows,
  fetchEscrowStatus,
  fetchEscrowDetails,
  STATUS_LABEL,
} from "./contracts.js";

const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
const FACTORY_ID = import.meta.env.VITE_FACTORY_CONTRACT_ID;

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

        const signed = await window.freighter.signTransaction(
          tx.toXDR(),
          { network: NETWORK_PASSPHRASE, networkPassphrase: NETWORK_PASSPHRASE }
        );

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
          <span className="text-xs text-gray-400">Seller Address (Gâ€¦)</span>
          <input
            name="seller"
            value={form.seller}
            onChange={handleChange}
            required
            disabled={disabled}
            placeholder="Gâ€¦"
            className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Arbiter Address (Gâ€¦)</span>
          <input
            name="arbiter"
            value={form.arbiter}
            onChange={handleChange}
            required
            disabled={disabled}
            placeholder="Gâ€¦"
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
            placeholder="Câ€¦"
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
        {loading ? "Creatingâ€¦" : disabled ? "Wallet Required" : "Create Escrow"}
      </button>
    </form>
  );
}

function EscrowCard({ address }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const factory = new Contract(FACTORY_ID);
        const status = await fetchEscrowStatus(factory, address);
        const full = await fetchEscrowDetails(factory, address);
        if (!cancelled) {
          setDetails({ ...full, status: status || full.status });
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
          {address.slice(0, 14)}â€¦
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-6 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <StatusBadge status={details.status} />
        <span className="text-gray-500 text-xs font-mono">
          {address.slice(0, 10)}â€¦{address.slice(-6)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-500 block text-xs">Buyer</span>
          <span className="text-gray-200 font-mono text-xs break-all">
            {details.buyer?.slice(0, 12)}â€¦
          </span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Seller</span>
          <span className="text-gray-200 font-mono text-xs break-all">
            {details.seller?.slice(0, 12)}â€¦
          </span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Amount</span>
          <span className="text-white font-semibold">
            {(Number(details.amount) / 10 ** 7).toFixed(7)} XLM
          </span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Deadline</span>
          <span className="text-gray-200">
            Ledger #{details.deadline_ledger?.toString()}
          </span>
        </div>
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
          <p className="text-gray-400 text-sm">Connecting walletâ€¦</p>
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
            Stellar / Soroban â€” Orange Belt
            {demoMode && (
              <span className="ml-2 inline-block px-2 py-0.5 bg-amber-700/40 text-amber-200 border border-amber-600 rounded-full text-xs font-medium">
                DEMO MODE
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-gray-500 font-mono bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-800">
            {effectivePublicKey?.slice(0, 8)}â€¦{effectivePublicKey?.slice(-6)}
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

          <section className="mt-10">
            <h2 className="text-xl font-bold text-white mb-5">
              My Escrows{" "}
              {escrowsLoading && (
                <span className="text-sm text-gray-500 font-normal">loadingâ€¦</span>
              )}
            </h2>
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
                <EscrowCard key={addr} address={addr} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default App;




