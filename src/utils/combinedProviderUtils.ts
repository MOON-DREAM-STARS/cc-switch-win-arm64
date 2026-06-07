import type { Provider, ProviderModelRouterConfig } from "@/types";

export const COMBINED_PROVIDER_ID = "cc-switch-combined-provider";
export const COMBINED_PROVIDER_NAME = "组合provider";

const DEFAULT_MODEL_ROUTER: ProviderModelRouterConfig = {
  version: 1,
  routes: [],
};

const normalizeModelRouterConfig = (
  config?: ProviderModelRouterConfig,
): ProviderModelRouterConfig => ({
  ...(config ?? {}),
  version: config?.version ?? DEFAULT_MODEL_ROUTER.version,
  routes: Array.isArray(config?.routes) ? config.routes : [],
});

export const isModelRouterProvider = (provider?: Provider | null): boolean =>
  provider?.meta?.providerType === "model_router";

export const isManagedCombinedProvider = (
  provider?: Provider | null,
): boolean =>
  Boolean(
    provider &&
      provider.id === COMBINED_PROVIDER_ID &&
      provider.meta?.managedModelRouterProvider === true,
  );

export const createManagedCombinedProvider = (
  existing?: Provider | null,
): Provider => {
  const { model_router: _modelRouterAlias, ...meta } = existing?.meta ?? {};

  const name = existing?.name?.trim()
    ? existing.name
    : COMBINED_PROVIDER_NAME;

  return {
    ...(existing ?? {}),
    id: COMBINED_PROVIDER_ID,
    name,
    settingsConfig: existing?.settingsConfig ?? { env: {} },
    meta: {
      ...meta,
      providerType: "model_router",
      managedModelRouterProvider: true,
      modelRouter: normalizeModelRouterConfig(
        existing?.meta?.modelRouter ?? existing?.meta?.model_router,
      ),
    },
  };
};

export const normalizeManagedCombinedProvider = (provider: Provider): Provider =>
  createManagedCombinedProvider(provider);

export const filterManagedCombinedProvider = (
  providers: Record<string, Provider>,
  enabled: boolean,
): Record<string, Provider> => {
  if (enabled) return providers;

  return Object.fromEntries(
    Object.entries(providers).filter(
      ([, provider]) => !isManagedCombinedProvider(provider),
    ),
  );
};
