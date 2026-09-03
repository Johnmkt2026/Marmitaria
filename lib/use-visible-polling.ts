'use client';

import { useEffect } from 'react';

export function useVisiblePolling(refresh: () => void | Promise<void>, enabled = true, intervalMs = 10000) {
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
    const run = () => { if (document.visibilityState === 'visible') void refresh(); };
    const start = () => { stop(); if (document.visibilityState === 'visible') timer = window.setInterval(run, intervalMs); };
    const visibility = () => { if (document.visibilityState === 'visible') { run(); start(); } else stop(); };
    start();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', run);
    return () => { stop(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', run); };
  }, [enabled, intervalMs, refresh]);
}
