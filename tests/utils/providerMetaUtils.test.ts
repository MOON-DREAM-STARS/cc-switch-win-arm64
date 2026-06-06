import { describe, expect, it } from "vitest";
import type { ProviderMeta } from "@/types";
import {
  ensureModelRouterMetaConfig,
  mergeProviderMeta,
  mergeProviderMetaWithExtra,
  splitProviderMeta,
  stripModelRouterMetaConfig,
  stringifyProviderExtraMeta,
} from "@/utils/providerMetaUtils";

const buildEndpoint = (url: string) => ({
  url,
  addedAt: 1,
});

describe("mergeProviderMeta", () => {
  it("returns undefined when no initial meta and no endpoints", () => {
    expect(mergeProviderMeta(undefined, null)).toBeUndefined();
    expect(mergeProviderMeta(undefined, undefined)).toBeUndefined();
  });

  it("creates meta when endpoints are provided for new provider", () => {
    const result = mergeProviderMeta(undefined, {
      "https://example.com": buildEndpoint("https://example.com"),
    });

    expect(result).toEqual({
      custom_endpoints: {
        "https://example.com": buildEndpoint("https://example.com"),
      },
    });
  });

  it("overrides custom endpoints but preserves other fields", () => {
    const initial: ProviderMeta = {
      usage_script: {
        enabled: true,
        language: "javascript",
        code: "console.log(1);",
      },
      custom_endpoints: {
        "https://old.com": buildEndpoint("https://old.com"),
      },
    };

    const result = mergeProviderMeta(initial, {
      "https://new.com": buildEndpoint("https://new.com"),
    });

    expect(result).toEqual({
      usage_script: initial.usage_script,
      custom_endpoints: {
        "https://new.com": buildEndpoint("https://new.com"),
      },
    });
  });

  it("removes custom endpoints when result is empty but keeps other meta", () => {
    const initial: ProviderMeta = {
      usage_script: {
        enabled: true,
        language: "javascript",
        code: "console.log(1);",
      },
      custom_endpoints: {
        "https://example.com": buildEndpoint("https://example.com"),
      },
    };

    const result = mergeProviderMeta(initial, null);

    expect(result).toEqual({
      usage_script: initial.usage_script,
    });
  });

  it("returns undefined when removing last field", () => {
    const initial: ProviderMeta = {
      custom_endpoints: {
        "https://example.com": buildEndpoint("https://example.com"),
      },
    };

    expect(mergeProviderMeta(initial, null)).toBeUndefined();
  });

  it("keeps model_router in extra meta bucket", () => {
    const initial: ProviderMeta = {
      providerType: "model_router",
      endpointAutoSelect: true,
      modelRouter: {
        version: 1,
        routes: [
          {
            matchType: "role",
            matchValue: "sonnet",
            target: {
              providerId: "primary",
              upstreamModel: "gpt-5.4",
            },
          },
        ],
      },
    };

    const { managedMeta, extraMeta } = splitProviderMeta(initial);

    expect(managedMeta).toEqual({
      providerType: "model_router",
      endpointAutoSelect: true,
    });
    expect(extraMeta).toEqual({
      modelRouter: initial.modelRouter,
    });
    expect(JSON.parse(stringifyProviderExtraMeta(initial))).toEqual({
      modelRouter: initial.modelRouter,
    });
  });

  it("merges extra meta back without overriding managed fields", () => {
    expect(
      mergeProviderMetaWithExtra(
        {
          providerType: "model_router",
          endpointAutoSelect: false,
        },
        {
          modelRouter: {
            version: 1,
            routes: [],
          },
          providerType: "should-be-ignored",
        },
      ),
    ).toEqual({
      modelRouter: {
        version: 1,
        routes: [],
      },
      providerType: "model_router",
      endpointAutoSelect: false,
    });
  });

  it("injects modelRouter template into empty meta config", () => {
    const parsed = JSON.parse(ensureModelRouterMetaConfig(""));

    expect(parsed.modelRouter).toBeTruthy();
    expect(parsed.modelRouter.routes?.[0]?.matchType).toBe("role");
  });

  it("preserves other extra meta when enabling modelRouter", () => {
    const parsed = JSON.parse(
      ensureModelRouterMetaConfig(
        JSON.stringify({ foo: "bar" }),
      ),
    );

    expect(parsed.foo).toBe("bar");
    expect(parsed.modelRouter).toBeTruthy();
  });

  it("removes modelRouter meta when disabling router mode", () => {
    expect(
      stripModelRouterMetaConfig(
        JSON.stringify({
          modelRouter: { routes: [] },
          foo: "bar",
        }),
      ),
    ).toBe(JSON.stringify({ foo: "bar" }, null, 2));

    expect(
      stripModelRouterMetaConfig(
        JSON.stringify({
          modelRouter: { routes: [] },
        }),
      ),
    ).toBe("");
  });
});
