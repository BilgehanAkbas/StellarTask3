import { useState, useCallback, useEffect } from "react";

export function useFreighter() {
  const [publicKey, setPublicKey] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const connect = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (!window.freighterApi && !window.freighter) {
        throw new Error("Freighter extension not detected. Install from https://freighter.app");
      }
      const api = window.freighterApi || window.freighter;
      const key = await api.getPublicKey();
      if (!key) throw new Error("No account selected in Freighter.");
      setPublicKey(key);
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
