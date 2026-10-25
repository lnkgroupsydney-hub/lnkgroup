"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OverviewCountsHook, OverviewCountsState } from '../application/overview-counts-contract.ts';
import { loadOverviewCounts } from './load-overview-counts.ts';

export function useOverviewCounts({ onAccessLost }: { onAccessLost: () => void }): OverviewCountsHook {
  const [state, setState] = useState<OverviewCountsState>({ status: 'loading' });
  const active = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null), accessLost = useRef(onAccessLost);
  useEffect(() => { accessLost.current = onAccessLost; }, [onAccessLost]);
  const cancel = useCallback(() => { active.current = false; generation.current++; controller.current?.abort(); }, []);
  const refresh = useCallback(async () => {
    if (!active.current) return;
    controller.current?.abort();
    const abort = new AbortController(), version = ++generation.current;
    controller.current = abort;
    setState({ status: 'loading' });
    try {
      const result = await loadOverviewCounts(abort.signal);
      if (!active.current || generation.current !== version || abort.signal.aborted) return;
      setState(result.state);
      if (result.accessLost) accessLost.current();
    } catch (cause) {
      if (!active.current || generation.current !== version || abort.signal.aborted || cause instanceof Error && cause.name === 'AbortError') return;
      setState({ status: 'error', message: 'Overview counts could not be loaded. Please retry.' });
    }
  }, []);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void refresh(); });
    return () => { cancelled = true; cancel(); };
  }, [refresh, cancel]);
  return { state, refresh };
}
