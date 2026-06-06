import { describe, expect, it } from "vitest";
import type { Provider } from "@/types";
import {
  COMBINED_PROVIDER_ID,
  COMBINED_PROVIDER_NAME,
  createManagedCombinedProvider,
  filterManagedCombinedProvider,
  isManagedCombinedProvider,
  isModelRouterProvider,
  normalizeManagedCombinedProvider,
} from "@/utils/combinedProviderUtils";

const ordinaryProvider: Provider = {
  id: "ordinary-provider",
  name: "普通 Provider",
  settingsConfig: { env: {} },
};

describe("combinedProviderUtils", () => {
  it("creates a managed model-router provider with a stable id and default name", () => {
    const provider = createManagedCombinedProvider();

    expect(provider.id).toBe(COMBINED_PROVIDER_ID);
    expect(provider.name).toBe(COMBINED_PROVIDER_NAME);
    expect(provider.settingsConfig).toEqual({ env: {} });
    expect(provider.meta?.providerType).toBe("model_router");
    expect(provider.meta?.managedModelRouterProvider).toBe(true);
    expect(provider.meta?.modelRouter).toEqual({ version: 1, routes: [] });
  });

  it("detects managed combined providers without treating all model routers as managed", () => {
    const managed = createManagedCombinedProvider();
    const legacyRouter: Provider = {
      id: "legacy-router",
      name: "Legacy Router",
      settingsConfig: {},
      meta: { providerType: "model_router" },
    };

    expect(isModelRouterProvider(managed)).toBe(true);
    expect(isModelRouterProvider(legacyRouter)).toBe(true);
    expect(isManagedCombinedProvider(managed)).toBe(true);
    expect(isManagedCombinedProvider(legacyRouter)).toBe(false);
  });

  it("normalizes a managed provider without losing routes or sort metadata", () => {
    const existing: Provider = {
      id: COMBINED_PROVIDER_ID,
      name: "旧名称",
      settingsConfig: { stale: true },
      createdAt: 123,
      sortIndex: 7,
      meta: {
        providerType: "model_router",
        managedModelRouterProvider: true,
        modelRouter: {
          version: 1,
          routes: [
            {
              id: "combined-default",
              matchType: "default",
              target: { providerId: "ordinary-provider", upstreamModel: "claude-3" },
            },
          ],
        },
      },
    };

    const normalized = normalizeManagedCombinedProvider(existing);

    expect(normalized.name).toBe(COMBINED_PROVIDER_NAME);
    expect(normalized.createdAt).toBe(123);
    expect(normalized.sortIndex).toBe(7);
    expect(normalized.meta?.modelRouter?.routes).toEqual(
      existing.meta?.modelRouter?.routes,
    );
  });

  it("fills missing model-router defaults while normalizing malformed managed providers", () => {
    const existing: Provider = {
      id: COMBINED_PROVIDER_ID,
      name: "组合provider",
      settingsConfig: { env: {} },
      meta: {
        providerType: "model_router",
        managedModelRouterProvider: true,
        modelRouter: {},
      },
    };

    const normalized = normalizeManagedCombinedProvider(existing);

    expect(normalized.meta?.modelRouter).toEqual({ version: 1, routes: [] });
  });

  it("filters only the managed combined provider when disabled", () => {
    const managed = createManagedCombinedProvider();
    const legacyRouter: Provider = {
      id: "legacy-router",
      name: "Legacy Router",
      settingsConfig: {},
      meta: { providerType: "model_router" },
    };

    const providers = {
      [ordinaryProvider.id]: ordinaryProvider,
      [managed.id]: managed,
      [legacyRouter.id]: legacyRouter,
    };

    expect(Object.keys(filterManagedCombinedProvider(providers, false))).toEqual([
      ordinaryProvider.id,
      legacyRouter.id,
    ]);
    expect(Object.keys(filterManagedCombinedProvider(providers, true))).toEqual([
      ordinaryProvider.id,
      managed.id,
      legacyRouter.id,
    ]);
  });
});
