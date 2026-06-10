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

const normalizeModelRouterForSync = (provider: Provider) => {
  const config = provider.meta?.modelRouter ?? provider.meta?.model_router;
  return {
    ...(config ?? {}),
    version: config?.version ?? 1,
    routes: Array.isArray(config?.routes) ? config.routes : [],
  };
};

const sortForStableCompare = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortForStableCompare);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          sortForStableCompare((value as Record<string, unknown>)[key]),
        ]),
    );
  }

  return value;
};

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortForStableCompare(value));

const getManagedProviderSyncState = (provider: Provider) => ({
  id: provider.id,
  needsDefaultName: !provider.name?.trim(),
  providerType: provider.meta?.providerType,
  managedModelRouterProvider:
    provider.meta?.managedModelRouterProvider === true,
  modelRouter: normalizeModelRouterForSync(provider),
  hasLegacyModelRouterAlias: Boolean(
    provider.meta && "model_router" in provider.meta,
  ),
});

const isSameManagedProvider = (a: Provider, b: Provider): boolean =>
  stableStringify(getManagedProviderSyncState(a)) ===
  stableStringify(getManagedProviderSyncState(b));

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
    const pendingKey = `${appId}:${action}:${stableStringify(
      getManagedProviderSyncState(nextProvider),
    )}`;

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
