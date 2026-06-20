import type { CustomEndpoint, ProviderMeta } from "@/types";

const MANAGED_PROVIDER_META_KEYS = new Set<string>([
  "custom_endpoints",
  "commonConfigEnabled",
  "claudeDesktopMode",
  "claudeDesktopModelRoutes",
  "usage_script",
  "endpointAutoSelect",
  "isPartner",
  "partnerPromotionKey",
  "testConfig",
  "costMultiplier",
  "pricingModelSource",
  "apiFormat",
  "authBinding",
  "apiKeyField",
  "isFullUrl",
  "promptCacheKey",
  "codexFastMode",
  "codexChatReasoning",
  "providerType",
  "githubAccountId",
]);

const isNonEmptyObject = (
  value: Record<string, unknown> | undefined,
): value is Record<string, unknown> =>
  Boolean(value && Object.keys(value).length > 0);

export function splitProviderMeta(meta: ProviderMeta | undefined): {
  managedMeta: ProviderMeta | undefined;
  extraMeta: Record<string, unknown> | undefined;
} {
  if (!meta) {
    return {
      managedMeta: undefined,
      extraMeta: undefined,
    };
  }

  const managedMeta: Record<string, unknown> = {};
  const extraMeta: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (value === undefined) continue;

    if (MANAGED_PROVIDER_META_KEYS.has(key)) {
      managedMeta[key] = value;
      continue;
    }

    extraMeta[key] = value;
  }

  return {
    managedMeta: isNonEmptyObject(managedMeta)
      ? (managedMeta as ProviderMeta)
      : undefined,
    extraMeta: isNonEmptyObject(extraMeta) ? extraMeta : undefined,
  };
}

export function stringifyProviderExtraMeta(
  meta: ProviderMeta | undefined,
): string {
  const { extraMeta } = splitProviderMeta(meta);
  return extraMeta ? JSON.stringify(extraMeta, null, 2) : "";
}

export function mergeProviderMetaWithExtra(
  managedMeta: ProviderMeta | undefined,
  extraMeta: Record<string, unknown> | undefined,
): ProviderMeta | undefined {
  const merged = {
    ...(extraMeta ?? {}),
    ...(managedMeta ?? {}),
  };

  return Object.keys(merged).length > 0 ? (merged as ProviderMeta) : undefined;
}

export function ensureModelRouterMetaConfig(value: string | undefined): string {
  const text = value?.trim();

  if (!text) {
    return JSON.stringify(
      {
        modelRouter: {
          routes: [
            {
              matchType: "role",
              matchValue: "sonnet",
              target: {
                providerId: "target-provider-id",
                upstreamModel: "gpt-5.4",
              },
              fallbacks: [],
            },
          ],
        },
      },
      null,
      2,
    );
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid meta object");
    }

    if (parsed.modelRouter) {
      return JSON.stringify(parsed, null, 2);
    }

    return JSON.stringify(
      {
        ...parsed,
        modelRouter: {
          routes: [
            {
              matchType: "role",
              matchValue: "sonnet",
              target: {
                providerId: "target-provider-id",
                upstreamModel: "gpt-5.4",
              },
              fallbacks: [],
            },
          ],
        },
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify(
      {
        modelRouter: {
          routes: [
            {
              matchType: "role",
              matchValue: "sonnet",
              target: {
                providerId: "target-provider-id",
                upstreamModel: "gpt-5.4",
              },
              fallbacks: [],
            },
          ],
        },
      },
      null,
      2,
    );
  }
}

export function stripModelRouterMetaConfig(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "";
    }

    const { modelRouter, model_router, ...rest } = parsed;
    return Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "";
  } catch {
    return text;
  }
}

/**
 * 合并供应商元数据中的自定义端点。
 * - 当 customEndpoints 为空对象时，明确删除自定义端点但保留其它元数据。
 * - 当 customEndpoints 为 null/undefined 时，不修改端点（保留原有端点）。
 * - 当 customEndpoints 存在时，覆盖原有自定义端点。
 * - 若结果为空对象且非明确清空场景则返回 undefined，避免写入空 meta。
 */
export function mergeProviderMeta(
  initialMeta: ProviderMeta | undefined,
  customEndpoints: Record<string, CustomEndpoint> | null | undefined,
): ProviderMeta | undefined {
  const hasCustomEndpoints =
    !!customEndpoints && Object.keys(customEndpoints).length > 0;

  // 明确清空：传入空对象（非 null/undefined）表示用户想要删除所有端点
  const isExplicitClear =
    customEndpoints !== null &&
    customEndpoints !== undefined &&
    Object.keys(customEndpoints).length === 0;

  if (hasCustomEndpoints) {
    return {
      ...(initialMeta ? { ...initialMeta } : {}),
      custom_endpoints: customEndpoints!,
    };
  }

  // 明确清空端点
  if (isExplicitClear) {
    if (!initialMeta) {
      // 新供应商且用户没有添加端点（理论上不会到这里）
      return undefined;
    }

    if ("custom_endpoints" in initialMeta) {
      const { custom_endpoints, ...rest } = initialMeta;
      // 保留其他字段（如 usage_script）
      // 即使 rest 为空，也要返回空对象（让后端知道要清空 meta）
      return Object.keys(rest).length > 0 ? rest : {};
    }

    // initialMeta 中本来就没有 custom_endpoints
    return { ...initialMeta };
  }

  // null/undefined：用户没有修改端点，保持不变
  if (!initialMeta) {
    return undefined;
  }

  if ("custom_endpoints" in initialMeta) {
    const { custom_endpoints, ...rest } = initialMeta;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }

  return { ...initialMeta };
}
