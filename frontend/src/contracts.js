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
  try {
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
  } catch (err) {
    throw err;
  }
}

export async function fetchEscrowDetails(factory, address, sourceAddress) {
  try {
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
  } catch (err) {
    throw err;
  }
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

async function signAndSend(tx, server) {
  const preparedTx = await server.prepareTransaction(tx);
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
    const errMsg = sendResult.errorResultXdr
      ? "Transaction failed: " + sendResult.errorResultXdr.slice(0, 100)
      : "Transaction failed on-chain";
    throw new Error(errMsg);
  }

  const finalResult = await waitForTransaction(server, sendResult.hash);
  if (finalResult.status !== "SUCCESS") {
    const errMsg = finalResult.resultXdr
      ? "Transaction failed: " + String(finalResult.resultXdr).slice(0, 150)
      : "Transaction failed on-chain";
    throw new Error(errMsg);
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