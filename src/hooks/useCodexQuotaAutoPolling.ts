import { useEffect, useRef } from "react";
import {
  QueryClientContext,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useContext } from "react";
import { subscriptionApi } from "@/lib/api";
import type { CodexQuotaActivationState } from "@/lib/api";
import type { SubscriptionQuota } from "@/types/subscription";

export const CODEX_QUOTA_ACTIVATION_STATES_QUERY_KEY = [
  "codex_oauth",
  "quota_activation",
  "states",
] as const;

export function mergeNewerCodexQuota(
  current: SubscriptionQuota | undefined,
  incoming: SubscriptionQuota,
): SubscriptionQuota {
  if (
    current?.queriedAt != null &&
    incoming.queriedAt != null &&
    incoming.queriedAt < current.queriedAt
  ) {
    return current;
  }
  return incoming;
}

export function useCodexQuotaActivationStates(
  options: { polling?: boolean } = {},
) {
  const polling = options.polling ?? false;
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) {
    return {
      data: undefined,
      isError: false,
      isPending: false,
    } as const;
  }
  return useQuery<CodexQuotaActivationState[]>({
    queryKey: CODEX_QUOTA_ACTIVATION_STATES_QUERY_KEY,
    queryFn: subscriptionApi.listCodexQuotaActivationStates,
    refetchInterval: polling ? 60_000 : false,
    refetchIntervalInBackground: polling,
    staleTime: 30_000,
    enabled:
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>),
  });
}

/**
 * Root lifetime account timers for the opt-in activation entry. Timers are
 * created per account and only call the dedicated automatic IPC; ordinary
 * quota query observers never reach this hook.
 */
export function useCodexQuotaAutoPolling() {
  const queryClient = useQueryClient();
  const timers = useRef(new Map<string, { interval: number; timer: number }>());
  const { data: states = [] } = useCodexQuotaActivationStates({
    polling: true,
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
          .pollCodexOauthQuotaForActivation(accountId)
          .then((result) => {
            if (result.quota) {
              const quota = result.quota;
              queryClient.setQueryData<SubscriptionQuota>(
                ["codex_oauth", "quota", result.accountId],
                (current) => mergeNewerCodexQuota(current, quota),
              );
            }
            queryClient.setQueryData<CodexQuotaActivationState[]>(
              CODEX_QUOTA_ACTIVATION_STATES_QUERY_KEY,
              (current) =>
                current?.map((state) =>
                  state.accountId === result.accountId
                    ? {
                        ...state,
                        lastPolledAtMs: Date.now(),
                        lastAttemptAtMs: result.attempted
                          ? Date.now()
                          : state.lastAttemptAtMs,
                        lastAttemptStatus: result.status,
                        lastReason: result.reason ?? state.lastReason,
                      }
                    : state,
                ),
            );
            void queryClient.invalidateQueries({
              queryKey: CODEX_QUOTA_ACTIVATION_STATES_QUERY_KEY,
            });
          })
          .catch((error: unknown) => {
            const reason =
              error instanceof Error
                ? error.message
                : "automatic_quota_poll_failed";
            queryClient.setQueryData<CodexQuotaActivationState[]>(
              CODEX_QUOTA_ACTIVATION_STATES_QUERY_KEY,
              (current) =>
                current?.map((state) =>
                  state.accountId === accountId
                    ? {
                        ...state,
                        lastPolledAtMs: Date.now(),
                        lastAttemptStatus: "poll_failed",
                        lastReason: reason.slice(0, 256),
                      }
                    : state,
                ),
            );
          });
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
