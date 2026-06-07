import type { FetchedModel } from "@/lib/api/model-fetch";
import type {
  Provider,
  ProviderModelRouterRole,
  ProviderModelRouterRule,
} from "@/types";
import type { AppId } from "@/lib/api";
import { extractCodexBaseUrl } from "@/utils/providerConfigUtils";
import { isModelRouterProvider } from "@/utils/combinedProviderUtils";

export type ModelFetchDescriptor =
  | { source: "stored"; models: FetchedModel[] }
  | {
      source: "network";
      baseUrl: string;
      apiKey: string;
      isFullUrl?: boolean;
      modelsUrl?: string;
    }
  | {
      source: "unavailable";
      reason: "missing-api-key" | "missing-base-url" | "unsupported";
    };

export type CompositeRole = ProviderModelRouterRole;

export interface CompositeMappingRowValue {
  providerId: string;
  upstreamModel: string;
}

export type CompositeMappings = Record<CompositeRole, CompositeMappingRowValue>;

const MANAGED_ROUTE_IDS = new Set([
  "combined-default",
  "combined-role-haiku",
  "combined-role-sonnet",
  "combined-role-opus",
]);

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const getEnv = (provider: Provider): Record<string, any> =>
  asRecord(provider.settingsConfig?.env);

const modelFromString = (id: string, ownedBy: string | null = null): FetchedModel => ({
  id,
  ownedBy,
});

const uniqueModels = (models: FetchedModel[]): FetchedModel[] => {
  const seen = new Set<string>();
  const result: FetchedModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, ownedBy: model.ownedBy ?? null });
  }
  return result;
};

export const getDetectableOrdinaryProviders = (
  providers: Record<string, Provider>,
  routerProviderId: string,
): Provider[] =>
  Object.values(providers).filter(
    (provider) =>
      provider.id !== routerProviderId && !isModelRouterProvider(provider),
  );

const getStoredModels = (provider: Provider, appId: AppId): FetchedModel[] => {
  const config = provider.settingsConfig ?? {};

  if (appId === "codex") {
    const catalogModels = Array.isArray(config.modelCatalog?.models)
      ? config.modelCatalog.models
      : [];
    return uniqueModels(
      catalogModels.map((item: any) =>
        modelFromString(asString(item.model), asString(item.displayName) || null),
      ),
    );
  }

  if (appId === "opencode") {
    const models = asRecord(config.models);
    return uniqueModels(
      Object.entries(models).map(([id, item]) =>
        modelFromString(id, asString((item as any)?.name) || null),
      ),
    );
  }

  if (appId === "openclaw" || appId === "hermes") {
    const models = Array.isArray(config.models) ? config.models : [];
    return uniqueModels(
      models.map((item: any) => modelFromString(asString(item.id || item.name))),
    );
  }

  if (appId === "gemini") {
    const env = getEnv(provider);
    const model = asString(env.GEMINI_MODEL);
    return model ? [modelFromString(model)] : [];
  }

  if (appId === "claude") {
    const env = getEnv(provider);
    return uniqueModels(
      [
        env.ANTHROPIC_MODEL,
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      ].map((value) => modelFromString(asString(value))),
    );
  }

  return [];
};

export const getModelFetchDescriptor = (
  provider: Provider,
  appId: AppId,
): ModelFetchDescriptor => {
  const config = provider.settingsConfig ?? {};
  const env = getEnv(provider);
  const storedModels = getStoredModels(provider, appId);

  let baseUrl = "";
  let apiKey = "";
  let modelsUrl = "";

  if (appId === "claude") {
    baseUrl = asString(env.ANTHROPIC_BASE_URL);
    apiKey = asString(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
    modelsUrl = asString(env.ANTHROPIC_MODELS_URL);

    if (baseUrl && apiKey) {
      return {
        source: "network",
        baseUrl,
        apiKey,
        ...(provider.meta?.isFullUrl ? { isFullUrl: true } : {}),
        ...(modelsUrl ? { modelsUrl } : {}),
      };
    }
  }

  if (storedModels.length > 0) {
    return { source: "stored", models: storedModels };
  }

  if (appId === "gemini") {
    baseUrl = asString(env.GOOGLE_GEMINI_BASE_URL);
    apiKey = asString(env.GEMINI_API_KEY);
  } else if (appId === "opencode") {
    const options = asRecord(config.options);
    baseUrl = asString(options.baseURL || options.baseUrl || config.baseURL || config.baseUrl);
    apiKey = asString(options.apiKey || config.apiKey);
  } else if (appId === "openclaw") {
    baseUrl = asString(config.baseUrl || config.base_url);
    apiKey = asString(config.apiKey || config.api_key);
  } else if (appId === "hermes") {
    baseUrl = asString(config.base_url || config.baseUrl);
    apiKey = asString(config.api_key || config.apiKey);
  } else if (appId === "codex") {
    const auth = asRecord(config.auth);
    baseUrl =
      asString(config.baseUrl || config.base_url) ||
      extractCodexBaseUrl(asString(config.config)) ||
      "";
    apiKey = asString(auth.OPENAI_API_KEY || config.apiKey);
  } else if (appId !== "claude") {
    return { source: "unavailable", reason: "unsupported" };
  }

  if (!baseUrl) return { source: "unavailable", reason: "missing-base-url" };
  if (!apiKey) return { source: "unavailable", reason: "missing-api-key" };

  return {
    source: "network",
    baseUrl,
    apiKey,
    ...(provider.meta?.isFullUrl ? { isFullUrl: true } : {}),
    ...(modelsUrl ? { modelsUrl } : {}),
  };
};

const makeManagedRoute = (
  role: CompositeRole,
  value: CompositeMappingRowValue,
): ProviderModelRouterRule | null => {
  const providerId = value.providerId.trim();
  const upstreamModel = value.upstreamModel.trim();
  if (!providerId || !upstreamModel) return null;

  if (role === "default") {
    return {
      id: "combined-default",
      enabled: true,
      matchType: "default",
      target: { providerId, upstreamModel },
    };
  }

  return {
    id: `combined-role-${role}`,
    enabled: true,
    matchType: "role",
    matchValue: role,
    target: { providerId, upstreamModel },
  };
};

export const buildCompositeRoutes = (
  existingRoutes: ProviderModelRouterRule[],
  mappings: CompositeMappings,
): ProviderModelRouterRule[] => {
  const preserved = existingRoutes.filter(
    (route) => !route.id || !MANAGED_ROUTE_IDS.has(route.id),
  );
  const managed = (["default", "haiku", "sonnet", "opus"] as const)
    .map((role) => makeManagedRoute(role, mappings[role]))
    .filter((route): route is ProviderModelRouterRule => Boolean(route));

  return [...preserved, ...managed];
};
