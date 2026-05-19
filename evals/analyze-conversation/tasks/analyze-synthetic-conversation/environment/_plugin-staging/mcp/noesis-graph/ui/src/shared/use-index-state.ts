import { useEffect, useState } from "react";
import type { IndexStateData } from "../../../ui-contracts/index-state/index-state-data.js";

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 30000;
const ENDPOINT = "/api/health/index";

export function useIndexState(): IndexStateData | null {
  const [state, setState] = useState<IndexStateData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<IndexStateData | null> {
      try {
        const response = await fetch(ENDPOINT);
        if (!response.ok) return null;
        return (await response.json()) as IndexStateData;
      } catch {
        return null;
      }
    }

    function scheduleNext(current: IndexStateData | null): number {
      return current?.state === "consistent" ? SLOW_POLL_MS : FAST_POLL_MS;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    async function loop() {
      const next = await poll();
      if (cancelled) return;
      setState(next);
      timer = setTimeout(loop, scheduleNext(next));
    }

    loop();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return state;
}
