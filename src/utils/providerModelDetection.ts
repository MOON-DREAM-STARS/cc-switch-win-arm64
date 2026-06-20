import type { FetchedModel } from "@/lib/api/model-fetch";
import type {
  CodexCatalogModel,
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

export interface CodexCompositeExactRowValue {
  requestModel: string;
  displayName: string;
  providerId: string;
  upstreamModel: string;
  contextWindow?: string | number;
}

export interface CodexCompositeMappings {
  defaultRoute: CompositeMappingRowValue;
  exactRows: CodexCompositeExactRowValue[];
}

const MANAGED_ROUTE_IDS = new Set([
  "combined-default",
  "combined-role-haiku",
  "combined-role-sonnet",
  "combined-role-opus",
]);

const MANAGED_ROUTE_ROLES = new Set<CompositeRole>([
  "default",
  "haiku",
  "sonnet",
  "opus",
]);

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeCodexManagedRouteId = (requestModel: string): string => {
  const normalized = requestModel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `combined-exact-${normalized}` : "combined-exact";
};

const isManagedCompositeRoute = (
  route: ProviderModelRouterRule,
  appId: AppId,
): boolean => {
  if (route.matchType === "default") return true;

  if (appId === "codex") {
    return (
      route.matchType === "exact" &&
      Boolean(route.id?.startsWith("combined-exact-"))
    );
  }

  if (route.id && MANAGED_ROUTE_IDS.has(route.id)) return true;
  if (route.matchType !== "role") return false;
  const role = asString(route.matchValue).toLowerCase() as CompositeRole;
  return MANAGED_ROUTE_ROLES.has(role);
};

const getEnv = (provider: Provider): Record<string, any> =>
  asRecord(provider.settingsConfig?.env);

const modelFromString = (
  id: string,
  ownedBy: string | null = null,
): FetchedModel => ({
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

export const emptyCodexCompositeMappings = (): CodexCompositeMappings => ({
  defaultRoute: { providerId: "", upstreamModel: "" },
  exactRows: [],
});

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
        modelFromString(
          asString(item.model),
          asString(item.displayName) || null,
        ),
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
      models.map((item: any) =>
        modelFromString(asString(item.id || item.name)),
      ),
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
    baseUrl = asString(
      options.baseURL || options.baseUrl || config.baseURL || config.baseUrl,
    );
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

const makeManagedClaudeRoute = (
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
    (route) => !isManagedCompositeRoute(route, "claude"),
  );
  const managed = (["default", "haiku", "sonnet", "opus"] as const)
    .map((role) => makeManagedClaudeRoute(role, mappings[role]))
    .filter((route): route is ProviderModelRouterRule => Boolean(route));

  return [...preserved, ...managed];
};

export const buildCodexCompositeRoutes = (
  existingRoutes: ProviderModelRouterRule[],
  mappings: CodexCompositeMappings,
): ProviderModelRouterRule[] => {
  const preserved = existingRoutes.filter(
    (route) => !isManagedCompositeRoute(route, "codex"),
  );
  const managed: ProviderModelRouterRule[] = [];

  const defaultProviderId = mappings.defaultRoute.providerId.trim();
  const defaultUpstreamModel = mappings.defaultRoute.upstreamModel.trim();
  if (defaultProviderId && defaultUpstreamModel) {
    managed.push({
      id: "combined-default",
      enabled: true,
      matchType: "default",
      target: {
        providerId: defaultProviderId,
        upstreamModel: defaultUpstreamModel,
      },
    });
  }

  for (const row of mappings.exactRows) {
    const requestModel = row.requestModel.trim();
    const providerId = row.providerId.trim();
    const upstreamModel = row.upstreamModel.trim();
    if (!requestModel || !providerId || !upstreamModel) continue;
    managed.push({
      id: normalizeCodexManagedRouteId(requestModel),
      enabled: true,
      matchType: "exact",
      matchValue: requestModel,
      target: { providerId, upstreamModel },
    });
  }

  return [...preserved, ...managed];
};

export const buildCodexCompositeModelCatalog = (
  rows: CodexCompositeExactRowValue[],
): CodexCatalogModel[] => {
  const seen = new Set<string>();
  const result: CodexCatalogModel[] = [];

  for (const row of rows) {
    const model = row.requestModel.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);

    const catalogRow: CodexCatalogModel = { model };
    const displayName = row.displayName.trim();
    if (displayName) catalogRow.displayName = displayName;

    if (row.contextWindow !== undefined && row.contextWindow !== "") {
      const digits = String(row.contextWindow).replace(/[^0-9]/g, "");
      if (digits) catalogRow.contextWindow = Number(digits);
    }

    result.push(catalogRow);
  }

  return result;
};

export const routeToCodexCompositeMappings = (
  routes: ProviderModelRouterRule[],
  settingsConfig?: Record<string, any>,
): CodexCompositeMappings => {
  const next = emptyCodexCompositeMappings();
  const catalogModels = Array.isArray(settingsConfig?.modelCatalog?.models)
    ? settingsConfig.modelCatalog.models
    : [];
  const catalogByModel = new Map(
    catalogModels.map((item: any) => [asString(item.model), item]),
  );

  for (const route of routes) {
    const providerId = route.target?.providerId ?? "";
    const upstreamModel = route.target?.upstreamModel ?? "";

    if (route.matchType === "default") {
      next.defaultRoute = { providerId, upstreamModel };
      continue;
    }

    if (route.matchType !== "exact") continue;
    const requestModel = asString(route.matchValue);
    if (!requestModel) continue;
    const catalog = asRecord(catalogByModel.get(requestModel));
    next.exactRows.push({
      requestModel,
      displayName: asString(catalog.displayName),
      providerId,
      upstreamModel,
      contextWindow:
        typeof catalog.contextWindow === "number" ||
        typeof catalog.contextWindow === "string"
          ? catalog.contextWindow
          : undefined,
    });
  }

  return next;
};
