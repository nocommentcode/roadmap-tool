import { useEffect, useRef, useState } from 'react';
import type { Fixture } from '../types';

export type Connection = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribes to the server's SSE stream. The server pushes the whole state whenever
 * it moves — 143KB over localhost, which is cheaper than reasoning about patches.
 *
 * `tick` re-renders on a timer so relative times ("1h 46m", "40m ago") stay honest
 * without the server having to send anything.
 */
export function useRoadmapState() {
  const [state, setState] = useState<Fixture | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [, setTick] = useState(0);
  const everConnected = useRef(false);

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('state', (e) => {
      setState(JSON.parse((e as MessageEvent).data));
      setConnection('live');
      everConnected.current = true;
    });
    es.onopen = () => setConnection('live');
    es.onerror = () => setConnection(everConnected.current ? 'reconnecting' : 'connecting');

    return () => es.close();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const refresh = () => void fetch('/api/refresh', { method: 'POST' });

  return { state, connection, refresh };
}
