import { describe, expect, it } from "vitest";
import type { Provider } from "@/types";
import {
  buildCompositeRoutes,
  getDetectableOrdinaryProviders,
  getModelFetchDescriptor,
} from "@/utils/providerModelDetection";

const provider = (overrides: Partial<Provider>): Provider => ({
  id: "p1",
  name: "Provider 1",
  settingsConfig: {},
  ...overrides,
});

describe("providerModelDetection", () => {
  it("excludes the current router and other model-router providers", () => {
    const ordinary = provider({ id: "ordinary" });
    const self = provider({
      id: "router",
      meta: { providerType: "model_router", managedModelRouterProvider: true },
    });
    const legacyRouter = provider({
      id: "legacy-router",
      meta: { providerType: "model_router" },
    });

    expect(
      getDetectableOrdinaryProviders(
        {
          ordinary,
          router: self,
          "legacy-router": legacyRouter,
        },
        "router",
      ).map((item) => item.id),
    ).toEqual(["ordinary"]);
  });

  it("uses stored Codex model catalog before network detection", () => {
    const descriptor = getModelFetchDescriptor(
      provider({
        settingsConfig: {
          modelCatalog: {
            models: [
              { model: "gpt-5.4", displayName: "GPT 5.4" },
              { model: "claude-sonnet-4-6" },
            ],
          },
        },
      }),
      "codex",
    );

    expect(descriptor).toEqual({
      source: "stored",
      models: [
        { id: "gpt-5.4", ownedBy: "GPT 5.4" },
        { id: "claude-sonnet-4-6", ownedBy: null },
      ],
    });
  });

  it("builds a Claude network descriptor from env base URL and API key", () => {
    const descriptor = getModelFetchDescriptor(
      provider({
        settingsConfig: {
          env: {
            ANTHROPIC_BASE_URL: "https://api.example.com/v1",
            ANTHROPIC_API_KEY: "sk-test",
          },
        },
        meta: { isFullUrl: true },
      }),
      "claude",
    );

    expect(descriptor).toEqual({
      source: "network",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      isFullUrl: true,
    });
  });

  it("prefers Claude network detection when stored env models and credentials are available", () => {
    const descriptor = getModelFetchDescriptor(
      provider({
        settingsConfig: {
          env: {
            ANTHROPIC_MODEL: "stored-default",
            ANTHROPIC_BASE_URL: "https://api.example.com/v1",
            ANTHROPIC_API_KEY: "sk-test",
            ANTHROPIC_MODELS_URL: "https://api.example.com/v1/models",
          },
        },
      }),
      "claude",
    );

    expect(descriptor).toEqual({
      source: "network",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelsUrl: "https://api.example.com/v1/models",
    });
  });

  it("builds a Codex network descriptor from TOML config base_url", () => {
    const descriptor = getModelFetchDescriptor(
      provider({
        settingsConfig: {
          auth: { OPENAI_API_KEY: "codex-key" },
          config:
            'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://codex.example.com/v1"\n',
        },
      }),
      "codex",
    );

    expect(descriptor).toEqual({
      source: "network",
      baseUrl: "https://codex.example.com/v1",
      apiKey: "codex-key",
    });
  });

  it("reports missing config instead of throwing", () => {
    expect(getModelFetchDescriptor(provider({}), "claude")).toEqual({
      source: "unavailable",
      reason: "missing-base-url",
    });
  });

  it("preserves 1M markers when building composite routes", () => {
    expect(
      buildCompositeRoutes([], {
        default: { providerId: "", upstreamModel: "" },
        sonnet: { providerId: "p1", upstreamModel: "sonnet-model[1M]" },
        haiku: { providerId: "", upstreamModel: "" },
        opus: { providerId: "", upstreamModel: "" },
      }),
    ).toEqual([
      {
        id: "combined-role-sonnet",
        enabled: true,
        matchType: "role",
        matchValue: "sonnet",
        target: { providerId: "p1", upstreamModel: "sonnet-model[1M]" },
      },
    ]);
  });

  it("builds managed default and role routes from mapping rows", () => {
    expect(
      buildCompositeRoutes(
        [
          {
            id: "preserved-exact",
            matchType: "exact",
            matchValue: "claude-custom",
            target: { providerId: "p-old", upstreamModel: "old" },
          },
          {
            id: "combined-role-sonnet",
            matchType: "role",
            matchValue: "sonnet",
            target: { providerId: "stale", upstreamModel: "stale" },
          },
        ],
        {
          default: { providerId: "p1", upstreamModel: "default-model" },
          sonnet: { providerId: "p2", upstreamModel: "sonnet-model" },
          haiku: { providerId: "", upstreamModel: "" },
          opus: { providerId: "p3", upstreamModel: "" },
        },
      ),
    ).toEqual([
      {
        id: "preserved-exact",
        matchType: "exact",
        matchValue: "claude-custom",
        target: { providerId: "p-old", upstreamModel: "old" },
      },
      {
        id: "combined-default",
        enabled: true,
        matchType: "default",
        target: { providerId: "p1", upstreamModel: "default-model" },
      },
      {
        id: "combined-role-sonnet",
        enabled: true,
        matchType: "role",
        matchValue: "sonnet",
        target: { providerId: "p2", upstreamModel: "sonnet-model" },
      },
    ]);
  });
});
