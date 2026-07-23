import {
  Contract,
  rpc,
  scValToNative,
  nativeToScVal,
  TransactionBuilder,
  Networks,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

const FACTORY_ID = import.meta.env.VITE_FACTORY_CONTRACT_ID;
const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

export function getFactory() {
  return new Contract(FACTORY_ID);
}

export function getServer() {
  return new rpc.Server(RPC_URL);
}

// Soroban encodes a simple (unit-variant-only) Rust enum, like EscrowStatus,
// as an ScVec containing a single Symbol — e.g. EscrowStatus::Funded becomes
// ["Funded"] once decoded via scValToNative, not the bare string "Funded".
// Every status comparison in the UI (`status === "Funded"`) needs a plain
// string, so unwrap it here, once, centrally.
function unwrapEnum(value) {
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }
  return value;
}

function normalizeEscrowData(data) {
  if (data && typeof data === "object" && "status" in data) {
    return { ...data, status: unwrapEnum(data.status) };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Contract error decoding
//
// The Escrow contract's business-logic checks (wrong status, unauthorized
// caller, deadline not reached, ...) are defined as `EscrowError` codes in
// contracts/common/src/lib.rs. Soroban RPC catches all of these during
// *simulation*, before anything is ever signed or sent — `server
// .prepareTransaction()` throws a raw diagnostic string in that case (see
// `simResponse.error` in the SDK's rpc/server.js). That string contains a
// substring like `Error(Contract, #4)`, which is the only place the specific
// numeric error code is exposed; the compact on-chain TransactionResult XDR
// used for post-send failures only carries a generic "trapped" code, not the
// contract's custom error number, so those failures fall back to a plain
// message instead of trying to decode a code that isn't there.
// ---------------------------------------------------------------------------

const CONTRACT_ERROR_MESSAGES = {
  1: "Bu escrow hâlâ 'Pending' durumunda; bu işlem ancak fon yatırılmadan önce yapılabilir.",
  2: "Bu işlem yalnızca 'Funded' durumundaki bir escrow üzerinde yapılabilir.",
  3: "Bu escrow'da açık bir anlaşmazlık (dispute) yok.",
  4: "Deadline ledger'ı henüz gelmedi; timeout talebi için erken.",
  5: "Deadline zaten geçmiş görünüyor; bu haliyle escrow oluşturulamaz.",
  6: "Geçersiz tutar (0 veya negatif olamaz).",
  7: "Buyer ve seller aynı adres olamaz.",
  8: "Bu işlemi yapmaya yetkin yok — cüzdanın bu escrow'daki buyer/seller/arbiter rolüyle eşleşmiyor.",
  9: "Escrow bulunamadı ya da henüz başlatılmamış.",
  10: "Kontrat WASM hash'i ayarlanmamış (factory yapılandırma sorunu).",
};

function parseSimulationErrorCode(message) {
  const match = String(message || "").match(/Error\(Contract,\s*#(\d+)\)/);
  return match ? Number(match[1]) : null;
}

// Wraps a thrown error from server.prepareTransaction()/simulateTransaction()
// with a human-readable message when it recognizes the contract's error code,
// while keeping the original diagnostic text accessible via `err.cause` for
// debugging (visible in the browser console, not shown in the UI).
function describeSimulationFailure(err) {
  const raw = err instanceof Error ? err.message : String(err);
  const code = parseSimulationErrorCode(raw);
  const friendly =
    code != null && CONTRACT_ERROR_MESSAGES[code]
      ? CONTRACT_ERROR_MESSAGES[code]
      : "İşlem simülasyonu başarısız oldu. Sözleşme koşulları şu an sağlanmıyor olabilir.";
  const wrapped = new Error(friendly);
  wrapped.cause = raw;
  return wrapped;
}

// Post-send failures (rejected by the network, or failed after simulation
// already passed — e.g. a concurrent transaction changed the escrow's state
// first). The compact result XDR doesn't carry the contract's specific error
// number, so we can only give a generic, non-cryptic explanation here.
function describeSubmissionFailure(rawXdrOrMessage) {
  const wrapped = new Error(
    "İşlem zincire gönderildi ama başarısız oldu. Muhtemelen bu escrow'un durumu, işlemin " +
      "onaylanmasından hemen önce başka bir işlemle değişti (örn. karşı taraf zaten release/dispute açtı). " +
      "Sayfayı yenileyip güncel durumu kontrol et."
  );
  wrapped.cause = rawXdrOrMessage;
  return wrapped;
}

export async function fetchEscrows(factory, server, sourceAddress) {
  if (!server) server = getServer();
  if (!sourceAddress) return [];
  try {
    const account = await server.getAccount(sourceAddress);
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(factory.call("get_all_escrows"))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if (result.result?.retval) {
      return scValToNative(result.result.retval);
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchEscrowStatus(factory, address, sourceAddress) {
  const server = getServer();
  if (!sourceAddress) throw new Error("No wallet address available for simulation");
  const account = await server.getAccount(sourceAddress);
  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(factory.call("get_escrow_status", nativeToScVal(address, { type: "address" })))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (result.result?.retval) {
    return unwrapEnum(scValToNative(result.result.retval));
  }
  throw new Error("No return value");
}

export async function fetchEscrowDetails(factory, address, sourceAddress) {
  const server = getServer();
  if (!sourceAddress) throw new Error("No wallet address available for simulation");
  const account = await server.getAccount(sourceAddress);
  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(factory.call("get_escrow_details", nativeToScVal(address, { type: "address" })))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (result.result?.retval) {
    return normalizeEscrowData(scValToNative(result.result.retval));
  }
  throw new Error("No return value");
}

// Reads the SEP-41 `decimals()` view of a token contract, so amount
// formatting doesn't have to hardcode XLM's 7 decimals. Falls back to 7
// (XLM's own precision) if the call fails, so a bad/unreachable token
// contract never breaks the whole card.
const decimalsCache = new Map();

export async function fetchTokenDecimals(tokenAddress, sourceAddress, server) {
  if (!tokenAddress || !sourceAddress) return 7;
  if (decimalsCache.has(tokenAddress)) return decimalsCache.get(tokenAddress);

  try {
    if (!server) server = getServer();
    const token = new Contract(tokenAddress);
    const account = await server.getAccount(sourceAddress);
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(token.call("decimals"))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    const decimals = result.result?.retval ? scValToNative(result.result.retval) : 7;
    decimalsCache.set(tokenAddress, decimals);
    return decimals;
  } catch {
    decimalsCache.set(tokenAddress, 7);
    return 7;
  }
}

export async function fetchLatestLedger(server) {
  if (!server) server = getServer();
  const latest = await server.getLatestLedger();
  return latest.sequence;
}

export async function fundEscrow(publicKey, escrowAddress, server) {
  if (!server) server = getServer();
  const escrow = new Contract(escrowAddress);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(escrow.call("fund"))
    .setTimeout(30)
    .build();

  return signAndSend(tx, server);
}

export async function releaseEscrow(publicKey, escrowAddress, server) {
  if (!server) server = getServer();
  const escrow = new Contract(escrowAddress);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(escrow.call("release"))
    .setTimeout(30)
    .build();

  return signAndSend(tx, server);
}

export async function refundEscrow(publicKey, escrowAddress, server) {
  if (!server) server = getServer();
  const escrow = new Contract(escrowAddress);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(escrow.call("refund"))
    .setTimeout(30)
    .build();

  return signAndSend(tx, server);
}

export async function disputeEscrow(publicKey, escrowAddress, initiator, server) {
  if (!server) server = getServer();
  const escrow = new Contract(escrowAddress);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(escrow.call("open_dispute", nativeToScVal(initiator, { type: "address" })))
    .setTimeout(30)
    .build();

  return signAndSend(tx, server);
}

export async function resolveDispute(publicKey, escrowAddress, releaseToSeller, server) {
  if (!server) server = getServer();
  const escrow = new Contract(escrowAddress);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(escrow.call("resolve_dispute", nativeToScVal(releaseToSeller)))
    .setTimeout(30)
    .build();

  return signAndSend(tx, server);
}

export async function claimTimeout(publicKey, escrowAddress, server) {
  if (!server) server = getServer();
  const escrow = new Contract(escrowAddress);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(escrow.call("claim_timeout_refund"))
    .setTimeout(30)
    .build();

  return signAndSend(tx, server);
}

export async function cancelEscrow(publicKey, escrowAddress, initiator, server) {
  if (!server) server = getServer();
  const escrow = new Contract(escrowAddress);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(escrow.call("cancel", nativeToScVal(initiator, { type: "address" })))
    .setTimeout(30)
    .build();

  return signAndSend(tx, server);
}

export async function waitForTransaction(server, hash, { timeoutMs = 30000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await server.getTransaction(hash);
    if (result.status !== "NOT_FOUND") {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for transaction confirmation.");
}

// Shared by every write action (fund/release/refund/dispute/resolve/timeout/
// cancel) and by CreateEscrowForm's submit handler. Centralizing this means
// every action gets the same friendly-error treatment instead of each call
// site inventing its own ad-hoc XDR slicing.
export async function signAndSend(tx, server) {
  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err) {
    // This is where ~all of the contract's business-logic checks
    // (NotFunded, Unauthorized, DeadlineNotReached, ...) actually surface,
    // because Soroban validates them during simulation, before signing.
    throw describeSimulationFailure(err);
  }

  const xdr = preparedTx.toEnvelope
    ? preparedTx.toEnvelope().toXDR("base64")
    : preparedTx.toXDR();
  const { signedTxXdr } = await signTransaction(xdr, {
    network: NETWORK_PASSPHRASE,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(signedTx);
  if (sendResult.status === "ERROR") {
    throw describeSubmissionFailure(sendResult.errorResultXdr || "Transaction rejected on submit");
  }

  const finalResult = await waitForTransaction(server, sendResult.hash);
  if (finalResult.status !== "SUCCESS") {
    throw describeSubmissionFailure(finalResult.resultXdr || "Transaction failed to apply on-chain");
  }
  return finalResult;
}

export async function pollContractEvents(startLedger, filters) {
  try {
    const server = getServer();
    const response = await server.getEvents({
      startLedger,
      filters,
      limit: 100,
    });
    return response.events || [];
  } catch {
    return [];
  }
}

export const STATUS_LABEL = {
  Pending: "Pending",
  Funded: "Funded",
  Disputed: "Disputed",
  Released: "Released",
  Refunded: "Refunded",
  Cancelled: "Cancelled",
};

export const EVENT_TOPICS = {
  created: "created",
  funded: "funded",
  released: "released",
  refunded: "refunded",
  disputed: "disputed",
  resolved: "resolved",
  cancelled: "cancelled",
  timeout: "timeout",
  esc_new: "esc_new",
};