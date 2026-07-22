import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { App } from "./App.jsx";

vi.mock("./hooks/useFreighter.js", () => ({
  useFreighter: vi.fn(),
}));

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn().mockResolvedValue(true),
  getAddress: vi.fn().mockResolvedValue({ address: "GABCDEFG1234567890ABCDEFG1234567890ABCDEF" }),
  requestAccess: vi.fn().mockResolvedValue(undefined),
  signTransaction: vi.fn().mockResolvedValue(""),
}));

vi.mock("@stellar/stellar-sdk", () => {
  const mockContract = {
    contractId: "CDEFG1234567890",
    call: vi.fn().mockResolvedValue({ returnValue: [] }),
  };
  const mockRpcServer = {
    getAccount: vi.fn().mockResolvedValue({ accountId: () => "GABCDEFG1234567890ABCDEFG1234567890ABCDEF" }),
    simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: [] } }),
    sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING" }),
  };
  const mockRpc = {
    Server: vi.fn(() => mockRpcServer),
  };
  return {
    Contract: vi.fn(() => mockContract),
    rpc: mockRpc,
    TransactionBuilder: vi.fn(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn(() => ({ toXDR: () => "" })),
    })),
    nativeToScVal: vi.fn((v) => v),
    scValToNative: vi.fn((v) => v),
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
  };
});

import { useFreighter } from "./hooks/useFreighter.js";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows wallet loading spinner", () => {
    useFreighter.mockReturnValue({
      publicKey: null,
      error: null,
      loading: true,
      connect: vi.fn(),
    });
    render(<App />);
    expect(screen.getByText(/connecting wallet/i)).toBeInTheDocument();
  });

  it("shows connectivity error when freighter is missing", () => {
    useFreighter.mockReturnValue({
      publicKey: null,
      error: "Freighter extension not detected.",
      loading: false,
      connect: vi.fn(),
    });
    render(<App />);
    expect(screen.getByText(/wallet required/i)).toBeInTheDocument();
  });

  it("renders main UI after wallet connects", async () => {
    useFreighter.mockReturnValue({
      publicKey: "GABCDEFG1234567890ABCDEFG1234567890ABCDEF",
      error: null,
      loading: false,
      connect: vi.fn(),
    });
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText(/decentralized escrow/i)).toBeInTheDocument();
  });
});


