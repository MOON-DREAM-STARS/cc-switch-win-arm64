import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subscriptionApi } from "@/lib/api";

/**
 * Root lifetime account timers for the opt-in activation entry. Timers are
 * created per account and only call the dedicated automatic IPC; ordinary
 * quota query observers never reach this hook.
 */
export function useCodexQuotaAutoPolling() {
  const queryClient = useQueryClient();
  const timers = useRef(new Map<string, { interval: number; timer: number }>());
  const { data: states = [] } = useQuery({
    queryKey: ["codex_oauth", "quota_activation", "states"],
    queryFn: subscriptionApi.listCodexQuotaActivationStates,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
    enabled:
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>),
  });

  useEffect(() => {
    const desired = new Map<string, number>();
    for (const state of states) {
      if (!state.enabled) continue;
      const interval = state.effectiveIntervalMinutes ?? 0;
      if (interval <= 0) continue;
      desired.set(state.accountId, interval);
    }

    for (const [accountId, entry] of timers.current) {
      if (desired.get(accountId) === entry.interval) continue;
      window.clearInterval(entry.timer);
      timers.current.delete(accountId);
    }
    for (const [accountId, interval] of desired) {
      if (timers.current.has(accountId)) continue;
      const timer = window.setInterval(() => {
        void subscriptionApi
          .pollCodexOauthQuotaForActivation(accountId, interval)
          .then((result) => {
            if (result.quota) {
              queryClient.setQueryData(
                ["codex_oauth", "quota", result.accountId],
                result.quota,
              );
            }
            void queryClient.invalidateQueries({
              queryKey: ["codex_oauth", "quota_activation", "states"],
            });
          })
          .catch(() => undefined);
      }, interval * 60_000);
      timers.current.set(accountId, { interval, timer });
    }
    return () => {
      // Keep timers across state refetches; they are cleared on unmount below.
    };
  }, [queryClient, states]);

  useEffect(
    () => () => {
      for (const entry of timers.current.values())
        window.clearInterval(entry.timer);
      timers.current.clear();
    },
    [],
  );
}
