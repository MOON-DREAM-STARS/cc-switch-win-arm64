import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { providersApi, type AppId } from "@/lib/api";
import type { Provider } from "@/types";
import {
  COMBINED_PROVIDER_ID,
  createManagedCombinedProvider,
  filterManagedCombinedProvider,
  normalizeManagedCombinedProvider,
} from "@/utils/combinedProviderUtils";

interface UseManagedCombinedProviderOptions {
  appId: AppId;
  providers: Record<string, Provider>;
  enabled: boolean;
  isLoading: boolean;
}

interface UseManagedCombinedProviderResult {
  visibleProviders: Record<string, Provider>;
}

const isSameManagedProvider = (a: Provider, b: Provider): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function useManagedCombinedProvider({
  appId,
  providers,
  enabled,
  isLoading,
}: UseManagedCombinedProviderOptions): UseManagedCombinedProviderResult {
  const queryClient = useQueryClient();
  const pendingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || isLoading) return;

    const existing = providers[COMBINED_PROVIDER_ID];
    const nextProvider = existing
      ? normalizeManagedCombinedProvider(existing)
      : createManagedCombinedProvider();
    const action = existing ? "update" : "add";
    const pendingKey = `${appId}:${action}:${JSON.stringify(nextProvider)}`;

    if (pendingKeyRef.current === pendingKey) return;
    if (existing && isSameManagedProvider(existing, nextProvider)) return;

    pendingKeyRef.current = pendingKey;

    const persist = async () => {
      try {
        if (existing) {
          await providersApi.update(nextProvider, appId);
        } else {
          await providersApi.add(nextProvider, appId);
        }
        await queryClient.invalidateQueries({ queryKey: ["providers", appId] });
        try {
          await providersApi.updateTrayMenu();
        } catch (error) {
          console.error(
            "Failed to update tray menu after combined provider sync",
            error,
          );
        }
      } catch (error) {
        console.error("Failed to sync managed combined provider", error);
        pendingKeyRef.current = null;
      }
    };

    void persist();
  }, [appId, enabled, isLoading, providers, queryClient]);

  const visibleProviders = useMemo(() => {
    if (!enabled) {
      return filterManagedCombinedProvider(providers, false);
    }

    const existing = providers[COMBINED_PROVIDER_ID];
    const managed = existing
      ? normalizeManagedCombinedProvider(existing)
      : createManagedCombinedProvider();

    return {
      ...providers,
      [COMBINED_PROVIDER_ID]: managed,
    };
  }, [enabled, providers]);

  return { visibleProviders };
}
