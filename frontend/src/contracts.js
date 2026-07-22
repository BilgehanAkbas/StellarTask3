import {
  Contract,
  rpc,
  scValToNative,
  nativeToScVal,
  TransactionBuilder,
  Networks,
} from "@stellar/stellar-sdk";

const FACTORY_ID = import.meta.env.VITE_FACTORY_CONTRACT_ID;
const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

export function getFactory() {
  return new Contract(FACTORY_ID);
}

export function getServer() {
  return new rpc.Server(RPC_URL);
}

export async function fetchEscrows(factory, server) {
  if (!server) server = getServer();
  try {
    const account = await server.getAccount(factory.contractId);
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

export async function fetchEscrowStatus(factory, address) {
  try {
    const server = getServer();
    const account = await server.getAccount(factory.contractId);
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(factory.call("get_escrow_status", nativeToScVal(address)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if (result.result?.retval) {
      return scValToNative(result.result.retval);
    }
    throw new Error("No return value");
  } catch (err) {
    throw err;
  }
}

export async function fetchEscrowDetails(factory, address) {
  try {
    const server = getServer();
    const account = await server.getAccount(factory.contractId);
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(factory.call("get_escrow_details", nativeToScVal(address)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if (result.result?.retval) {
      return scValToNative(result.result.retval);
    }
    throw new Error("No return value");
  } catch (err) {
    throw err;
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
