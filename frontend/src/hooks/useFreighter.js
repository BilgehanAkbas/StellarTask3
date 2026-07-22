import { useState, useCallback, useEffect } from "react";
import { isConnected, getAddress, requestAccess } from "@stellar/freighter-api";

export function useFreighter() {
  const [publicKey, setPublicKey] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const connect = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const connected = await isConnected();
      if (!connected || !connected.isConnected) {
        throw new Error("Freighter extension not detected. Install from https://freighter.app");
      }
      await requestAccess();
      const { address } = await getAddress();
      if (!address) throw new Error("No account selected in Freighter.");
      setPublicKey(address);
    } catch (err) {
      setError(err.message || "Failed to connect Freighter");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    connect();
  }, [connect]);

  return { publicKey, error, loading, connect };
}
