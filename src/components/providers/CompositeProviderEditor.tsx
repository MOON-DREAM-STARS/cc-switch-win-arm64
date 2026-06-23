import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parse as parseToml } from "smol-toml";
import {
  ArrowLeft,
  Download,
  Loader2,
  Package,
  Save,
  Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import JsonEditor from "@/components/JsonEditor";
import { IconPicker } from "@/components/IconPicker";
import { ProviderIcon } from "@/components/ProviderIcon";
import { CodexCommonConfigModal } from "@/components/providers/forms/CodexCommonConfigModal";
import { ModelInputWithFetch } from "@/components/providers/forms/shared";
import {
  hasClaudeOneMMarker,
  setClaudeOneMMarker,
  stripClaudeOneMMarker,
} from "@/components/providers/forms/hooks/useModelState";
import { useCodexCommonConfig } from "@/components/providers/forms/hooks/useCodexCommonConfig";
import { useCommonConfigSnippet } from "@/components/providers/forms/hooks/useCommonConfigSnippet";
import { getIconMetadata } from "@/icons/extracted/metadata";
import type {
  Provider,
  ProviderModelRouterRule,
  ProviderModelRouterTestConfig,
} from "@/types";
import type { AppId } from "@/lib/api";
import { fetchModelsForConfig, type FetchedModel } from "@/lib/api/model-fetch";
import {
  buildCodexCompositeModelCatalog,
  buildCodexCompositeRoutes,
  buildCompositeRoutes,
  emptyCodexCompositeMappings,
  getDetectableOrdinaryProviders,
  getModelFetchDescriptor,
  routeToCodexCompositeMappings,
  type CodexCompositeExactRowValue,
  type CodexCompositeMappings,
  type CompositeMappings,
  type CompositeRole,
  type ModelFetchDescriptor,
} from "@/utils/providerModelDetection";
import { updateCommonConfigSnippet, updateTomlCommonConfigSnippet } from "@/utils/providerConfigUtils";

interface CompositeProviderEditorProps {
  open: boolean;
  appId: AppId;
  provider: Provider | null;
  providers: Record<string, Provider>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    provider: Provider;
    originalId?: string;
  }) => Promise<void> | void;
}

type DetectionState = Record<
  string,
  {
    status: "idle" | "detecting" | "ready" | "failed" | "unavailable";
    models: FetchedModel[];
    message?: string;
  }
>;

type DetectionRefreshSummary = {
  total: number;
  ready: number;
  failed: number;
  unavailable: number;
};

const NO_PROVIDER_VALUE = "__none__";
const MODEL_DETECTION_CONCURRENCY = 4;
const COMPOSITE_ROLE_ORDER: CompositeRole[] = [
  "default",
  "sonnet",
  "opus",
  "haiku",
];

const COMPOSITE_CONFIG_FORBIDDEN_TOP_LEVEL_KEYS = new Set([
  "models",
  "modelcatalog",
  "defaultmodel",
  "modelrouter",
  "routes",
  "providerid",
  "upstreammodel",
  "baseurl",
  "url",
  "modelsurl",
  "apikey",
  "auth",
]);

const COMPOSITE_CONFIG_FORBIDDEN_ROUTE_KEYS = new Set([
  "modelrouter",
  "routes",
  "providerid",
  "upstreammodel",
]);

const COMPOSITE_CONFIG_FORBIDDEN_ENV_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODELS_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_API_BASE",
  "CODEX_API_KEY",
  "CODEX_BASE_URL",
  "GOOGLE_GEMINI_BASE_URL",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "BASE_URL",
  "API_KEY",
]);

const COMPOSITE_CONFIG_FORBIDDEN_ENV_PATTERNS = [
  /(^|_)MODEL(S)?$/i,
  /(^|_)BASE_?URL($|_)/i,
  /(^|_)MODELS_?URL($|_)/i,
  /(^|_)API_?KEY($|_)/i,
  /(^|_)AUTH_?TOKEN($|_)/i,
];

const emptyMappings = (): CompositeMappings => ({
  default: { providerId: "", upstreamModel: "" },
  haiku: { providerId: "", upstreamModel: "" },
  sonnet: { providerId: "", upstreamModel: "" },
  opus: { providerId: "", upstreamModel: "" },
});

const emptyCodexRow = (): CodexCompositeExactRowValue => ({
  requestModel: "",
  displayName: "",
  providerId: "",
  upstreamModel: "",
  contextWindow: "",
});

const toCodexContextWindowValue = (
  value: string | number | undefined,
): string => (value === undefined ? "" : String(value));

const defaultModelRouterTestConfig = (): ProviderModelRouterTestConfig => ({
  enabled: false,
  mode: "all_routes",
});

const roleLabels: Array<{
  role: CompositeRole;
  key: string;
  defaultLabel: string;
}> = [
  {
    role: "default",
    key: "combinedProvider.mapping.default",
    defaultLabel: "默认模型",
  },
  {
    role: "haiku",
    key: "combinedProvider.mapping.haiku",
    defaultLabel: "Haiku",
  },
  {
    role: "sonnet",
    key: "combinedProvider.mapping.sonnet",
    defaultLabel: "Sonnet",
  },
  { role: "opus", key: "combinedProvider.mapping.opus", defaultLabel: "Opus" },
];

const supportsClaudeOneM = (appId: AppId, _role: CompositeRole): boolean =>
  appId === "claude";

const getVisibleModelValue = (appId: AppId, upstreamModel: string): string =>
  appId === "claude" ? stripClaudeOneMMarker(upstreamModel) : upstreamModel;

const mappingGridClassName = (appId: AppId): string =>
  appId === "claude"
    ? "md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_120px]"
    : "md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]";

const getStoredModelValue = (
  appId: AppId,
  role: CompositeRole,
  currentUpstreamModel: string,
  nextVisibleModel: string,
): string => {
  if (appId !== "claude") return nextVisibleModel;
  if (supportsClaudeOneM(appId, role)) {
    return setClaudeOneMMarker(
      nextVisibleModel,
      hasClaudeOneMMarker(currentUpstreamModel),
    );
  }
  return stripClaudeOneMMarker(nextVisibleModel);
};

const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const formatCompositeCommonConfig = (
  appId: AppId,
  value: unknown,
): string => {
  if (appId === "codex") {
    const config = isPlainObject(value) ? value : {};
    return typeof config.config === "string" ? config.config : "";
  }
  return JSON.stringify(sanitizeCompositeCommonConfig(value), null, 2);
};

const getNormalizedConfigKey = (key: string): string =>
  key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const getConfigPath = (path: string[], key: string): string =>
  [...path, key].join(".");

const isEnvObjectPath = (path: string[]): boolean => {
  const last = path[path.length - 1];
  return last ? getNormalizedConfigKey(last) === "env" : false;
};

const isRouteConfigPath = (path: string[]): boolean =>
  path.some((segment) =>
    ["modelrouter", "modelrouterrules", "routes", "routing"].includes(
      getNormalizedConfigKey(segment),
    ),
  );

const isForbiddenCompositeEnvKey = (key: string): boolean =>
  COMPOSITE_CONFIG_FORBIDDEN_ENV_KEYS.has(key.toUpperCase()) ||
  COMPOSITE_CONFIG_FORBIDDEN_ENV_PATTERNS.some((pattern) => pattern.test(key));

const isForbiddenCompositeConfigPath = (
  path: string[],
  key: string,
): boolean => {
  const normalizedKey = getNormalizedConfigKey(key);
  if (isEnvObjectPath(path)) return isForbiddenCompositeEnvKey(key);
  if (path.length === 0) {
    return COMPOSITE_CONFIG_FORBIDDEN_TOP_LEVEL_KEYS.has(normalizedKey);
  }
  if (isRouteConfigPath(path)) {
    return COMPOSITE_CONFIG_FORBIDDEN_ROUTE_KEYS.has(normalizedKey);
  }
  return false;
};

const sanitizeCompositeCommonConfigValue = (
  value: unknown,
  path: string[] = [],
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCompositeCommonConfigValue(item, path));
  }

  if (!isPlainObject(value)) return value;

  const sanitized: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isForbiddenCompositeConfigPath(path, key)) continue;
    sanitized[key] = sanitizeCompositeCommonConfigValue(nestedValue, [
      ...path,
      key,
    ]);
  }
  return sanitized;
};

const sanitizeCompositeCommonConfig = (value: unknown): Record<string, any> => {
  if (!isPlainObject(value)) return {};
  return sanitizeCompositeCommonConfigValue(value) as Record<string, any>;
};

const collectForbiddenCompositeConfigPaths = (
  value: unknown,
  path: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectForbiddenCompositeConfigPaths(item, [...path, String(index)]),
    );
  }

  if (!isPlainObject(value)) return [];

  const forbiddenPaths: string[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = getConfigPath(path, key);
    if (isForbiddenCompositeConfigPath(path, key)) {
      forbiddenPaths.push(nextPath);
      continue;
    }
    forbiddenPaths.push(
      ...collectForbiddenCompositeConfigPaths(nestedValue, [...path, key]),
    );
  }
  return forbiddenPaths;
};

const validateCompositeCommonConfigText = (
  text: string,
): { config: Record<string, any>; forbiddenPaths: string[] } => {
  const trimmed = text.trim();
  const parsed = trimmed ? JSON.parse(trimmed) : {};
  if (!isPlainObject(parsed)) {
    throw new Error("root-must-be-object");
  }

  const forbiddenPaths = collectForbiddenCompositeConfigPaths(parsed);
  return { config: parsed, forbiddenPaths };
};

const validateCodexCompositeCommonConfigText = (
  text: string,
): { config: string } => {
  const trimmed = text.trim();
  if (!trimmed) return { config: "" };
  parseToml(text);
  return { config: text };
};

const codexCompositeSettingsFromConfig = (
  baseSettingsConfig: Record<string, any> | undefined,
  configText: string,
): Record<string, any> => {
  const nextSettingsConfig = isPlainObject(baseSettingsConfig)
    ? { ...baseSettingsConfig }
    : {};
  nextSettingsConfig.auth = isPlainObject(nextSettingsConfig.auth)
    ? nextSettingsConfig.auth
    : {};
  nextSettingsConfig.config = configText;
  return nextSettingsConfig;
};

const mergeClaudeCommonConfigPreview = (
  baseText: string,
  snippetText: string,
): string => {
  const { updatedConfig, error } = updateCommonConfigSnippet(
    baseText,
    snippetText,
    true,
  );
  return error ? baseText : updatedConfig;
};

const mergeCodexCommonConfigPreview = (
  baseText: string,
  snippetText: string,
): string => {
  const { updatedConfig, error } = updateTomlCommonConfigSnippet(
    baseText,
    snippetText,
    true,
  );
  return error ? baseText : updatedConfig;
};

const routeToMappings = (
  routes: ProviderModelRouterRule[],
): CompositeMappings => {
  const mappings = emptyMappings();
  for (const route of routes) {
    const providerId = route.target?.providerId ?? "";
    const upstreamModel = route.target?.upstreamModel ?? "";
    if (!providerId && !upstreamModel) continue;

    if (route.matchType === "default") {
      mappings.default = { providerId, upstreamModel };
      continue;
    }

    if (route.matchType === "role") {
      const role = route.matchValue?.trim().toLowerCase();
      if (role === "default") {
        mappings.default = { providerId, upstreamModel };
      } else if (role === "haiku" || role === "sonnet" || role === "opus") {
        mappings[role] = { providerId, upstreamModel };
      }
    }
  }
  return mappings;
};

export function CompositeProviderEditor({
  open,
  appId,
  provider,
  providers,
  onOpenChange,
  onSubmit,
}: CompositeProviderEditorProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("");
  const [iconDialogOpen, setIconDialogOpen] = useState(false);
  const [mappings, setMappings] = useState<CompositeMappings>(emptyMappings);
  const [codexMappings, setCodexMappings] = useState<CodexCompositeMappings>(
    emptyCodexCompositeMappings,
  );
  const [modelRouterTestConfig, setModelRouterTestConfig] =
    useState<ProviderModelRouterTestConfig>(defaultModelRouterTestConfig);
  const [settingsConfigText, setSettingsConfigText] = useState("{}");
  const [settingsConfigError, setSettingsConfigError] = useState("");
  const [settingsConfigDirty, setSettingsConfigDirty] = useState(false);
  const [detection, setDetection] = useState<DetectionState>({});
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isCommonConfigModalOpen, setIsCommonConfigModalOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const handleClose = useCallback(() => {
    if (isDirty && !window.confirm("有未保存的更改，确定要离开吗？")) return;
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  const handleSettingsConfigChange = useCallback(
    (value: string) => {
      setSettingsConfigText(value);
      setSettingsConfigDirty(true);
      setIsDirty(true);
      if (settingsConfigError) setSettingsConfigError("");
    },
    [settingsConfigError],
  );

  const handleCommonConfigChange = useCallback(
    (value: string) => {
      const shouldKeepClean =
        open &&
        provider?.meta?.commonConfigEnabled === true &&
        !settingsConfigDirty &&
        !isDirty &&
        settingsConfigText ===
          formatCompositeCommonConfig(appId, provider.settingsConfig);

      setSettingsConfigText(value);
      if (!shouldKeepClean) {
        setSettingsConfigDirty(true);
        setIsDirty(true);
      }
      if (settingsConfigError) setSettingsConfigError("");
    },
    [
      appId,
      open,
      provider,
      settingsConfigDirty,
      isDirty,
      settingsConfigText,
      settingsConfigError,
    ],
  );

  const claudeCommonConfig = useCommonConfigSnippet({
    settingsConfig: settingsConfigText,
    onConfigChange: handleCommonConfigChange,
    initialData:
      appId === "claude" && provider
        ? { settingsConfig: provider.settingsConfig }
        : undefined,
    initialEnabled:
      appId === "claude" ? provider?.meta?.commonConfigEnabled : undefined,
    enabled: appId === "claude" && open,
  });

  const codexCommonConfig = useCodexCommonConfig({
    codexConfig: settingsConfigText,
    onConfigChange: handleCommonConfigChange,
    initialData:
      appId === "codex" && provider
        ? { settingsConfig: provider.settingsConfig }
        : undefined,
    initialEnabled:
      appId === "codex" ? provider?.meta?.commonConfigEnabled : undefined,
    selectedPresetId: provider?.id,
    enabled: appId === "codex" && open,
  });

  const activeCommonConfig =
    appId === "codex"
      ? {
          useCommonConfig: codexCommonConfig.useCommonConfig,
          commonConfigSnippet: codexCommonConfig.commonConfigSnippet,
          commonConfigError: codexCommonConfig.commonConfigError,
          handleCommonConfigToggle: codexCommonConfig.handleCommonConfigToggle,
          handleCommonConfigSnippetChange:
            codexCommonConfig.handleCommonConfigSnippetChange,
          handleExtract: codexCommonConfig.handleExtract,
          isExtracting: codexCommonConfig.isExtracting,
          isLoading: codexCommonConfig.isLoading,
          clearError: codexCommonConfig.clearCommonConfigError,
        }
      : {
          useCommonConfig: claudeCommonConfig.useCommonConfig,
          commonConfigSnippet: claudeCommonConfig.commonConfigSnippet,
          commonConfigError: claudeCommonConfig.commonConfigError,
          handleCommonConfigToggle: claudeCommonConfig.handleCommonConfigToggle,
          handleCommonConfigSnippetChange:
            claudeCommonConfig.handleCommonConfigSnippetChange,
          handleExtract: claudeCommonConfig.handleExtract,
          isExtracting: claudeCommonConfig.isExtracting,
          isLoading: claudeCommonConfig.isLoading,
          clearError: () => {},
        };

  const initialClaudeCompositeConfigText =
    appId === "claude" && provider
      ? formatCompositeCommonConfig(appId, provider.settingsConfig)
      : "{}";

  const initialCodexCompositeConfigText =
    appId === "codex" && provider
      ? formatCompositeCommonConfig(appId, provider.settingsConfig)
      : "";

  const showClaudeCommonConfigPreviewLoading =
    appId === "claude" &&
    open &&
    provider?.meta?.commonConfigEnabled === true &&
    !settingsConfigDirty &&
    !isDirty &&
    settingsConfigText === initialClaudeCompositeConfigText &&
    (activeCommonConfig.isLoading ||
      activeCommonConfig.commonConfigSnippet.trim().length > 0);

  const detectionRunRef = useRef(0);

  const ordinaryProviders = useMemo(
    () => getDetectableOrdinaryProviders(providers, provider?.id ?? ""),
    [providers, provider?.id],
  );

  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"));

    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open || !provider) return;
    setName(provider.name ?? "");
    setNotes(provider.notes ?? "");
    setWebsiteUrl(provider.websiteUrl ?? "");
    setIcon(provider.icon ?? "");
    setIconColor(provider.iconColor ?? "");
    setIconDialogOpen(false);
    setMappings(
      routeToMappings(
        provider.meta?.modelRouter?.routes ??
          provider.meta?.model_router?.routes ??
          [],
      ),
    );
    const initialCodexMappings = routeToCodexCompositeMappings(
      provider.meta?.modelRouter?.routes ??
        provider.meta?.model_router?.routes ??
        [],
      provider.settingsConfig,
    );
    setCodexMappings({
      defaultRoute: initialCodexMappings.defaultRoute,
      exactRows: initialCodexMappings.exactRows.map((row) => ({
        ...row,
        contextWindow: toCodexContextWindowValue(row.contextWindow),
      })),
    });
    setModelRouterTestConfig({
      ...defaultModelRouterTestConfig(),
      ...(provider.meta?.modelRouterTestConfig ?? {}),
    });
    setSettingsConfigText(formatCompositeCommonConfig(appId, provider.settingsConfig));
    setSettingsConfigError("");
    setSettingsConfigDirty(false);
    setIsDirty(false);
  }, [open, provider, appId]);

  useEffect(() => {
    if (
      !open ||
      !provider ||
      appId !== "claude" ||
      provider.meta?.commonConfigEnabled !== true ||
      claudeCommonConfig.isLoading ||
      settingsConfigDirty ||
      isDirty ||
      settingsConfigText !== initialClaudeCompositeConfigText ||
      !claudeCommonConfig.commonConfigSnippet.trim()
    ) {
      return;
    }

    const hydratedSettingsConfigText = mergeClaudeCommonConfigPreview(
      initialClaudeCompositeConfigText,
      claudeCommonConfig.commonConfigSnippet,
    );
    if (hydratedSettingsConfigText !== settingsConfigText) {
      setSettingsConfigText(hydratedSettingsConfigText);
    }
  }, [
    open,
    provider,
    appId,
    claudeCommonConfig.isLoading,
    claudeCommonConfig.commonConfigSnippet,
    settingsConfigDirty,
    isDirty,
    settingsConfigText,
    initialClaudeCompositeConfigText,
  ]);

  useEffect(() => {
    if (
      !open ||
      !provider ||
      appId !== "codex" ||
      provider.meta?.commonConfigEnabled !== true ||
      codexCommonConfig.isLoading ||
      settingsConfigDirty ||
      isDirty ||
      settingsConfigText !== initialCodexCompositeConfigText ||
      !codexCommonConfig.commonConfigSnippet.trim()
    ) {
      return;
    }

    const hydratedSettingsConfigText = mergeCodexCommonConfigPreview(
      initialCodexCompositeConfigText,
      codexCommonConfig.commonConfigSnippet,
    );
    if (hydratedSettingsConfigText !== settingsConfigText) {
      setSettingsConfigText(hydratedSettingsConfigText);
    }
  }, [
    open,
    provider,
    appId,
    codexCommonConfig.isLoading,
    codexCommonConfig.commonConfigSnippet,
    settingsConfigDirty,
    isDirty,
    settingsConfigText,
    initialCodexCompositeConfigText,
  ]);

  const refreshModelDetection = useCallback(
    async (providerIds?: string[]): Promise<DetectionRefreshSummary> => {
      const runId = ++detectionRunRef.current;
      const providerIdSet = providerIds?.length
        ? new Set(providerIds)
        : undefined;
      const targetProviders = providerIdSet
        ? ordinaryProviders.filter((ordinaryProvider) =>
            providerIdSet.has(ordinaryProvider.id),
          )
        : ordinaryProviders;

      const summary: DetectionRefreshSummary = {
        total: targetProviders.length,
        ready: 0,
        failed: 0,
        unavailable: 0,
      };
      const initialDetection: DetectionState = {};
      const networkTasks: Array<{
        providerId: string;
        descriptor: Extract<ModelFetchDescriptor, { source: "network" }>;
      }> = [];

      for (const ordinaryProvider of targetProviders) {
        const descriptor = getModelFetchDescriptor(ordinaryProvider, appId);
        if (descriptor.source === "stored") {
          initialDetection[ordinaryProvider.id] = {
            status: "ready",
            models: descriptor.models,
          };
          summary.ready += 1;
          continue;
        }

        if (descriptor.source === "unavailable") {
          initialDetection[ordinaryProvider.id] = {
            status: "unavailable",
            models: [],
            message: descriptor.reason,
          };
          summary.unavailable += 1;
          continue;
        }

        initialDetection[ordinaryProvider.id] = {
          status: "detecting",
          models: [],
        };
        networkTasks.push({ providerId: ordinaryProvider.id, descriptor });
      }

      setDetection((prev) =>
        providerIdSet ? { ...prev, ...initialDetection } : initialDetection,
      );

      for (
        let offset = 0;
        offset < networkTasks.length;
        offset += MODEL_DETECTION_CONCURRENCY
      ) {
        const batch = networkTasks.slice(
          offset,
          offset + MODEL_DETECTION_CONCURRENCY,
        );
        const results = await Promise.allSettled(
          batch.map(({ descriptor }) =>
            fetchModelsForConfig(
              descriptor.baseUrl,
              descriptor.apiKey,
              descriptor.isFullUrl,
              descriptor.modelsUrl,
            ),
          ),
        );

        if (runId !== detectionRunRef.current) return summary;
        const batchUpdates: DetectionState = {};
        results.forEach((result, index) => {
          const providerId = batch[index].providerId;
          if (result.status === "fulfilled") {
            batchUpdates[providerId] = {
              status: "ready",
              models: result.value,
            };
            summary.ready += 1;
            return;
          }

          batchUpdates[providerId] = {
            status: "failed",
            models: [],
            message:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          };
          summary.failed += 1;
        });
        setDetection((prev) => ({ ...prev, ...batchUpdates }));
      }

      return summary;
    },
    [appId, ordinaryProviders],
  );

  useEffect(() => {
    if (!open) {
      detectionRunRef.current += 1;
      setDetection({});
      return;
    }

    void refreshModelDetection();
    return () => {
      detectionRunRef.current += 1;
    };
  }, [open, refreshModelDetection]);

  const effectiveIconColor = icon
    ? iconColor || getIconMetadata(icon)?.defaultColor
    : undefined;
  const iconButtonLabel = icon
    ? t("providerIcon.clickToChange", {
        defaultValue: "点击更换图标",
      })
    : t("providerIcon.clickToSelect", {
        defaultValue: "点击选择图标",
      });
  const quickSetSourceRole = COMPOSITE_ROLE_ORDER.find((role) => {
    const mapping = mappings[role];
    return mapping.providerId.trim() && mapping.upstreamModel.trim();
  });

  const compositeConfigToggles = useMemo(() => {
    try {
      const config = JSON.parse(settingsConfigText);
      return {
        hideAttribution:
          config?.attribution?.commit === "" && config?.attribution?.pr === "",
        teammates:
          config?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1" ||
          config?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === 1,
        enableToolSearch:
          config?.env?.ENABLE_TOOL_SEARCH === "true" ||
          config?.env?.ENABLE_TOOL_SEARCH === "1",
        effortMax: config?.env?.CLAUDE_CODE_EFFORT_LEVEL === "max",
        disableAutoUpgrade:
          config?.env?.DISABLE_AUTOUPDATER === "1" ||
          config?.env?.DISABLE_AUTOUPDATER === 1,
      };
    } catch {
      return {
        hideAttribution: false,
        teammates: false,
        enableToolSearch: false,
        effortMax: false,
        disableAutoUpgrade: false,
      };
    }
  }, [settingsConfigText]);

  const handleCompositeConfigToggle = useCallback(
    (toggleKey: string, checked: boolean) => {
      try {
        const config = JSON.parse(settingsConfigText || "{}");
        switch (toggleKey) {
          case "hideAttribution":
            if (checked) config.attribution = { commit: "", pr: "" };
            else delete config.attribution;
            break;
          case "teammates":
            if (!config.env) config.env = {};
            if (checked) config.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
            else {
              delete config.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
              if (Object.keys(config.env).length === 0) delete config.env;
            }
            break;
          case "enableToolSearch":
            if (!config.env) config.env = {};
            if (checked) config.env.ENABLE_TOOL_SEARCH = "true";
            else {
              delete config.env.ENABLE_TOOL_SEARCH;
              if (Object.keys(config.env).length === 0) delete config.env;
            }
            break;
          case "effortMax":
            if (!config.env) config.env = {};
            if (checked) config.env.CLAUDE_CODE_EFFORT_LEVEL = "max";
            else {
              delete config.env.CLAUDE_CODE_EFFORT_LEVEL;
              if (Object.keys(config.env).length === 0) delete config.env;
            }
            break;
          case "disableAutoUpgrade":
            if (!config.env) config.env = {};
            if (checked) config.env.DISABLE_AUTOUPDATER = "1";
            else {
              delete config.env.DISABLE_AUTOUPDATER;
              if (Object.keys(config.env).length === 0) delete config.env;
            }
            break;
        }
        const newText = JSON.stringify(config, null, 2);
        setSettingsConfigText(newText);
        setSettingsConfigDirty(true);
        setIsDirty(true);
        if (settingsConfigError) setSettingsConfigError("");
      } catch {
        // Don't modify if JSON is invalid
      }
    },
    [settingsConfigText, settingsConfigError],
  );

  const handleQuickSetMappings = () => {
    if (!quickSetSourceRole) return;
    const source = mappings[quickSetSourceRole];
    setMappings(
      COMPOSITE_ROLE_ORDER.reduce((next, role) => {
        next[role] = {
          providerId: source.providerId,
          upstreamModel: source.upstreamModel,
        };
        return next;
      }, {} as CompositeMappings),
    );
    setIsDirty(true);
    toast.success(
      t("combinedProvider.mapping.quickSetSuccess", {
        defaultValue: "已应用到全部模型角色",
      }),
    );
  };

  const updateCodexDefaultRoute = (
    patch: Partial<{ providerId: string; upstreamModel: string }>,
  ) => {
    setCodexMappings((prev) => ({
      ...prev,
      defaultRoute: { ...prev.defaultRoute, ...patch },
    }));
    setIsDirty(true);
  };

  const updateCodexExactRow = (
    index: number,
    patch: Partial<CodexCompositeExactRowValue>,
  ) => {
    setCodexMappings((prev) => ({
      ...prev,
      exactRows: prev.exactRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    }));
    setIsDirty(true);
  };

  const addCodexExactRow = () => {
    setCodexMappings((prev) => ({
      ...prev,
      exactRows: [...prev.exactRows, emptyCodexRow()],
    }));
    setIsDirty(true);
  };

  const removeCodexExactRow = (index: number) => {
    setCodexMappings((prev) => ({
      ...prev,
      exactRows: prev.exactRows.filter((_, rowIndex) => rowIndex !== index),
    }));
    setIsDirty(true);
  };

  const handleRefreshSelectedModels = async () => {
    const selectedProviderIds = Array.from(
      new Set(
        appId === "codex"
          ? [
              codexMappings.defaultRoute.providerId,
              ...codexMappings.exactRows.map((row) => row.providerId),
            ].filter(Boolean)
          : COMPOSITE_ROLE_ORDER.map(
              (role) => mappings[role].providerId,
            ).filter(Boolean),
      ),
    );
    setIsRefreshingModels(true);
    try {
      const summary = await refreshModelDetection(
        selectedProviderIds.length > 0 ? selectedProviderIds : undefined,
      );
      if (summary.ready > 0) {
        toast.success(
          t("combinedProvider.mapping.fetchModelsSuccess", {
            defaultValue: "模型列表已刷新",
          }),
        );
      } else if (summary.failed > 0) {
        toast.error(
          t("combinedProvider.mapping.fetchModelsFailed", {
            defaultValue: "模型列表刷新失败，可手动填写。",
          }),
        );
      } else if (summary.unavailable > 0) {
        toast.info(
          t("combinedProvider.mapping.fetchModelsUnavailable", {
            defaultValue: "没有可刷新的模型列表，可手动填写。",
          }),
        );
      }
    } finally {
      setIsRefreshingModels(false);
    }
  };

  const updateMapping = (
    role: CompositeRole,
    patch: Partial<{ providerId: string; upstreamModel: string }>,
  ) => {
    setMappings((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        ...patch,
      },
    }));
    setIsDirty(true);
  };

  const handleIconSelect = (selectedIcon: string) => {
    const meta = getIconMetadata(selectedIcon);
    setIcon(selectedIcon);
    setIconColor(meta?.defaultColor ?? "");
    setIsDirty(true);
  };

  const handleSubmit = async () => {
    if (!provider) return;

    if (appId === "codex") {
      const defaultProviderId = codexMappings.defaultRoute.providerId.trim();
      const defaultUpstreamModel =
        codexMappings.defaultRoute.upstreamModel.trim();
      const seenRequestModels = new Set<string>();
      let hasCompleteValidRoute = Boolean(
        defaultProviderId && defaultUpstreamModel,
      );

      if (defaultUpstreamModel && !defaultProviderId) {
        toast.error(
          t("combinedProvider.validation.modelWithoutProvider", {
            defaultValue: "请选择 Provider 后再填写模型。",
          }),
        );
        return;
      }
      if (defaultProviderId && !providers[defaultProviderId]) {
        toast.error(
          t("combinedProvider.validation.providerNotFound", {
            defaultValue: "模型映射引用的 Provider 不存在，请重新选择。",
          }),
        );
        return;
      }
      if (defaultProviderId && !defaultUpstreamModel) {
        toast.error(
          t("combinedProvider.validation.providerWithoutModel", {
            defaultValue: "已选择 Provider，请填写实际请求模型。",
          }),
        );
        return;
      }

      for (const row of codexMappings.exactRows) {
        const requestModel = row.requestModel.trim();
        const providerId = row.providerId.trim();
        const upstreamModel = row.upstreamModel.trim();
        if (
          !requestModel &&
          !providerId &&
          !upstreamModel &&
          !row.displayName.trim()
        ) {
          continue;
        }
        if (requestModel && seenRequestModels.has(requestModel)) {
          toast.error(
            t("combinedProvider.codex.validation.duplicateRequestModel", {
              defaultValue: "请求模型不能重复。",
            }),
          );
          return;
        }
        if (requestModel) seenRequestModels.add(requestModel);
        if (upstreamModel && !providerId) {
          toast.error(
            t("combinedProvider.validation.modelWithoutProvider", {
              defaultValue: "请选择 Provider 后再填写模型。",
            }),
          );
          return;
        }
        if ((providerId || upstreamModel) && !requestModel) {
          toast.error(
            t("combinedProvider.codex.validation.requestModelRequired", {
              defaultValue: "请先填写请求模型。",
            }),
          );
          return;
        }
        if (providerId && !providers[providerId]) {
          toast.error(
            t("combinedProvider.validation.providerNotFound", {
              defaultValue: "模型映射引用的 Provider 不存在，请重新选择。",
            }),
          );
          return;
        }
        if (providerId && !upstreamModel) {
          toast.error(
            t("combinedProvider.validation.providerWithoutModel", {
              defaultValue: "已选择 Provider，请填写实际请求模型。",
            }),
          );
          return;
        }
        if (requestModel && providerId && upstreamModel) {
          hasCompleteValidRoute = true;
        }
      }

      if (!hasCompleteValidRoute) {
        toast.error(
          t("combinedProvider.validation.noCompleteRoute", {
            defaultValue: "请至少配置一条完整的模型映射。",
          }),
        );
        return;
      }

      let commonSettingsConfig = codexCompositeSettingsFromConfig(
        provider.settingsConfig,
        settingsConfigText,
      );
      if (settingsConfigDirty) {
        try {
          const result = validateCodexCompositeCommonConfigText(settingsConfigText);
          commonSettingsConfig = codexCompositeSettingsFromConfig(
            provider.settingsConfig,
            result.config,
          );
        } catch (error) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : t("codexConfig.invalidToml", {
                  defaultValue: "TOML 格式无效",
                });
          setSettingsConfigError(message);
          toast.error(message);
          return;
        }
      }

      const routes = buildCodexCompositeRoutes(
        provider.meta?.modelRouter?.routes ??
          provider.meta?.model_router?.routes ??
          [],
        codexMappings,
      );
      const { model_router: _modelRouterAlias, ...meta } = provider.meta ?? {};
      const trimmedName = name.trim();
      const trimmedNotes = notes.trim();
      const trimmedWebsiteUrl = websiteUrl.trim();
      const trimmedIcon = icon.trim();
      const trimmedIconColor = iconColor.trim();
      const updatedProvider: Provider = {
        ...provider,
        name:
          trimmedName ||
          t("combinedProvider.name", { defaultValue: "组合provider" }),
        notes: trimmedNotes || undefined,
        websiteUrl: trimmedWebsiteUrl || undefined,
        icon: trimmedIcon || undefined,
        iconColor: trimmedIconColor || undefined,
        settingsConfig: {
          ...commonSettingsConfig,
          modelCatalog: {
            models: buildCodexCompositeModelCatalog(codexMappings.exactRows),
          },
        },
        meta: {
          ...meta,
          providerType: "model_router",
          managedModelRouterProvider:
            provider.meta?.managedModelRouterProvider ?? true,
          commonConfigEnabled: activeCommonConfig.useCommonConfig,
          modelRouter: { version: 1, routes },
          modelRouterTestConfig: modelRouterTestConfig.enabled
            ? modelRouterTestConfig
            : undefined,
        },
      };

      setIsSubmitting(true);
      try {
        await onSubmit({ provider: updatedProvider, originalId: provider.id });
        toast.success(
          t("combinedProvider.saveSuccess", {
            defaultValue: "组合 Provider 已保存",
          }),
        );
        setIsDirty(false);
        onOpenChange(false);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    let hasCompleteValidRoute = false;
    for (const [role, value] of Object.entries(mappings)) {
      const providerId = value.providerId.trim();
      const upstreamModel = value.upstreamModel.trim();
      if (upstreamModel && !providerId) {
        toast.error(
          t("combinedProvider.validation.modelWithoutProvider", {
            role,
            defaultValue: "请选择 Provider 后再填写模型。",
          }),
        );
        return;
      }
      if (providerId && !providers[providerId]) {
        toast.error(
          t("combinedProvider.validation.providerNotFound", {
            role,
            defaultValue: "模型映射引用的 Provider 不存在，请重新选择。",
          }),
        );
        return;
      }
      if (providerId && !upstreamModel) {
        toast.error(
          t("combinedProvider.validation.providerWithoutModel", {
            role,
            defaultValue: "已选择 Provider，请填写实际请求模型。",
          }),
        );
        return;
      }
      if (providerId && upstreamModel) {
        hasCompleteValidRoute = true;
      }
    }

    if (!hasCompleteValidRoute) {
      toast.error(
        t("combinedProvider.validation.noCompleteRoute", {
          defaultValue: "请至少配置一条完整的模型映射。",
        }),
      );
      return;
    }

    let commonSettingsConfig = provider.settingsConfig ?? {};
    if (settingsConfigDirty) {
      try {
        const result = validateCompositeCommonConfigText(settingsConfigText);
        if (result.forbiddenPaths.length > 0) {
          const message = t("combinedProvider.configJson.forbiddenKeys", {
            keys: result.forbiddenPaths.join(", "),
            defaultValue: `配置 JSON 不能包含模型、URL、认证或路由字段：${result.forbiddenPaths.join(", ")}`,
          });
          setSettingsConfigError(message);
          toast.error(message);
          return;
        }
        commonSettingsConfig = result.config;
      } catch (error) {
        const message =
          error instanceof Error && error.message === "root-must-be-object"
            ? t("jsonEditor.mustBeObject", {
                defaultValue: "JSON 必须是对象",
              })
            : t("combinedProvider.configJson.invalidJson", {
                defaultValue: "配置 JSON 格式无效",
              });
        setSettingsConfigError(message);
        toast.error(message);
        return;
      }
    }

    const routes = buildCompositeRoutes(
      provider.meta?.modelRouter?.routes ??
        provider.meta?.model_router?.routes ??
        [],
      mappings,
    );
    const { model_router: _modelRouterAlias, ...meta } = provider.meta ?? {};
    const trimmedName = name.trim();
    const trimmedNotes = notes.trim();
    const trimmedWebsiteUrl = websiteUrl.trim();
    const trimmedIcon = icon.trim();
    const trimmedIconColor = iconColor.trim();
    const updatedProvider: Provider = {
      ...provider,
      name:
        trimmedName ||
        t("combinedProvider.name", { defaultValue: "组合provider" }),
      notes: trimmedNotes || undefined,
      websiteUrl: trimmedWebsiteUrl || undefined,
      icon: trimmedIcon || undefined,
      iconColor: trimmedIconColor || undefined,
      settingsConfig: commonSettingsConfig,
      meta: {
        ...meta,
        providerType: "model_router",
        managedModelRouterProvider:
          provider.meta?.managedModelRouterProvider ?? true,
        commonConfigEnabled: activeCommonConfig.useCommonConfig,
        modelRouter: { version: 1, routes },
        modelRouterTestConfig: modelRouterTestConfig.enabled
          ? modelRouterTestConfig
          : undefined,
      },
    };

    setIsSubmitting(true);
    try {
      await onSubmit({ provider: updatedProvider, originalId: provider.id });
      toast.success(
        t("combinedProvider.saveSuccess", {
          defaultValue: "组合 Provider 已保存",
        }),
      );
      setIsDirty(false);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("combinedProvider.editTitle", {
        defaultValue: "编辑组合provider",
      })}
      onClose={handleClose}
      footer={
        <Button
          type="submit"
          form="composite-provider-form"
          disabled={isSubmitting || !provider}
        >
          <Save className="h-4 w-4 mr-2" />
          {t("common.save", { defaultValue: "保存" })}
        </Button>
      }
    >
      <form
        id="composite-provider-form"
        className="space-y-6 glass rounded-xl p-6 border border-white/10"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="flex justify-center mb-6">
          <Dialog open={iconDialogOpen} onOpenChange={setIconDialogOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="w-20 h-20 p-3 rounded-xl border-2 border-muted hover:border-primary transition-colors cursor-pointer bg-muted/30 hover:bg-muted/50 flex items-center justify-center"
                title={iconButtonLabel}
                aria-label={iconButtonLabel}
              >
                <ProviderIcon
                  icon={icon}
                  name={name || "Provider"}
                  color={effectiveIconColor}
                  size={48}
                />
              </button>
            </DialogTrigger>
            <DialogContent
              variant="fullscreen"
              zIndex="top"
              overlayClassName="bg-[hsl(var(--background))] backdrop-blur-0"
              className="p-0 sm:rounded-none"
            >
              <div className="flex h-full flex-col">
                <div className="flex-shrink-0 py-4 border-b border-border-default bg-muted/40">
                  <div className="px-6 flex items-center gap-4">
                    <DialogClose asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t("common.back", { defaultValue: "返回" })}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    </DialogClose>
                    <DialogTitle className="text-lg font-semibold leading-tight">
                      {t("providerIcon.selectIcon", {
                        defaultValue: "选择图标",
                      })}
                    </DialogTitle>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-2 px-6 py-6 w-full">
                    <IconPicker
                      value={icon}
                      onValueChange={handleIconSelect}
                      color={effectiveIconColor}
                    />
                    <div className="flex justify-end gap-2">
                      <DialogClose asChild>
                        <Button type="button" variant="outline">
                          {t("common.done", { defaultValue: "完成" })}
                        </Button>
                      </DialogClose>
                    </div>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="composite-provider-name">
              {t("provider.name")}
            </Label>
            <Input
              id="composite-provider-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setIsDirty(true);
              }}
              placeholder={t("provider.namePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="composite-provider-notes">
              {t("provider.notes")}
            </Label>
            <Input
              id="composite-provider-notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setIsDirty(true);
              }}
              placeholder={t("provider.notesPlaceholder")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="composite-provider-website-url">
            {t("provider.websiteUrl")}
          </Label>
          <Input
            id="composite-provider-website-url"
            value={websiteUrl}
            onChange={(event) => {
              setWebsiteUrl(event.target.value);
              setIsDirty(true);
            }}
            placeholder={t("providerForm.websiteUrlPlaceholder")}
          />
        </div>

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              {t("combinedProvider.description", {
                defaultValue:
                  "按请求模型把流量路由到当前应用中的普通 Provider。",
              })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("combinedProvider.providerStatusHint", {
                defaultValue:
                  "下方显示可用于组合路由的普通 Provider 及其模型探测状态。",
              })}
            </p>
          </div>
          {ordinaryProviders.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("combinedProvider.noOrdinaryProviders", {
                defaultValue: "当前应用还没有可用于组合的普通 Provider。",
              })}
            </p>
          ) : (
            <div className="space-y-2">
              {ordinaryProviders.map((ordinaryProvider) => {
                const state = detection[ordinaryProvider.id];
                return (
                  <div
                    key={ordinaryProvider.id}
                    className="rounded-lg border border-border/50 bg-muted/20 p-3"
                  >
                    <p className="text-sm font-medium">
                      {ordinaryProvider.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {state?.status === "ready"
                        ? `${state.models.length} models`
                        : state?.status === "detecting"
                          ? t("combinedProvider.detectingModels", {
                              defaultValue: "正在探测模型…",
                            })
                          : state?.status === "failed"
                            ? t("combinedProvider.detectModelsFailed", {
                                defaultValue: "模型探测失败，可手动填写。",
                              })
                            : state?.status === "unavailable"
                              ? state.message
                              : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="space-y-1 border-t border-border/50 pt-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">
                  {t("combinedProvider.mapping.title", {
                    defaultValue: "模型映射",
                  })}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {appId === "codex"
                    ? t("combinedProvider.codex.mapping.hint", {
                        defaultValue:
                          "为 Codex 配置默认兜底路由，并按请求模型名添加精确匹配。",
                      })
                    : t("combinedProvider.mapping.hint", {
                        defaultValue:
                          "为每个 Claude 模型角色选择普通 Provider，并指定要请求的上游模型。",
                      })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {appId === "claude" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleQuickSetMappings}
                    disabled={!quickSetSourceRole}
                  >
                    <Wand2 className="h-4 w-4" />
                    {t("providerForm.quickSetModels", {
                      defaultValue: "一键设置",
                    })}
                  </Button>
                ) : null}
                {appId === "codex" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={addCodexExactRow}
                  >
                    {t("combinedProvider.codex.addModel", {
                      defaultValue: "添加模型",
                    })}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void handleRefreshSelectedModels()}
                  disabled={
                    isRefreshingModels || ordinaryProviders.length === 0
                  }
                >
                  {isRefreshingModels ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {t("providerForm.fetchModels", {
                    defaultValue: "获取模型列表",
                  })}
                </Button>
              </div>
            </div>
          </div>

          {appId === "codex" ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                  {t("combinedProvider.codex.defaultFallback", {
                    defaultValue: "默认兜底",
                  })}
                </div>
                <div className="space-y-2 md:space-y-0">
                  <Label htmlFor="codex-default-provider" className="md:hidden">
                    默认兜底 Provider
                  </Label>
                  <Select
                    value={
                      codexMappings.defaultRoute.providerId || NO_PROVIDER_VALUE
                    }
                    onValueChange={(value) =>
                      updateCodexDefaultRoute({
                        providerId: value === NO_PROVIDER_VALUE ? "" : value,
                        upstreamModel:
                          value === NO_PROVIDER_VALUE
                            ? ""
                            : codexMappings.defaultRoute.upstreamModel,
                      })
                    }
                  >
                    <SelectTrigger
                      id="codex-default-provider"
                      aria-label="默认兜底 Provider"
                    >
                      <SelectValue placeholder="默认兜底 Provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROVIDER_VALUE}>
                        默认兜底 Provider
                      </SelectItem>
                      {ordinaryProviders.map((ordinaryProvider) => (
                        <SelectItem
                          key={ordinaryProvider.id}
                          value={ordinaryProvider.id}
                        >
                          {ordinaryProvider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:space-y-0">
                  <Label
                    htmlFor="codex-default-upstream-model"
                    className="md:hidden"
                  >
                    默认兜底 实际请求模型
                  </Label>
                  <ModelInputWithFetch
                    id="codex-default-upstream-model"
                    value={codexMappings.defaultRoute.upstreamModel}
                    onChange={(value) =>
                      updateCodexDefaultRoute({ upstreamModel: value })
                    }
                    placeholder={t("combinedProvider.manualModelPlaceholder", {
                      defaultValue: "选择或手动输入模型",
                    })}
                    fetchedModels={
                      codexMappings.defaultRoute.providerId
                        ? (detection[codexMappings.defaultRoute.providerId]
                            ?.models ?? [])
                        : []
                    }
                    isLoading={
                      detection[codexMappings.defaultRoute.providerId]
                        ?.status === "detecting"
                    }
                    ariaLabel="默认兜底 实际请求模型"
                    dropdownAriaLabel="默认兜底 实际请求模型 options"
                  />
                </div>
              </div>

              {codexMappings.exactRows.map((row, index) => {
                const state = row.providerId
                  ? detection[row.providerId]
                  : undefined;
                return (
                  <div
                    key={`codex-exact-row-${index}`}
                    className="rounded-lg border border-border/50 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-muted-foreground">
                        {t("combinedProvider.codex.exactRow", {
                          defaultValue: "精确匹配",
                        })}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCodexExactRow(index)}
                      >
                        {t("common.delete", { defaultValue: "删除" })}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`codex-request-model-${index}`}>
                          请求模型
                        </Label>
                        <Input
                          id={`codex-request-model-${index}`}
                          value={row.requestModel}
                          onChange={(event) =>
                            updateCodexExactRow(index, {
                              requestModel: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`codex-display-name-${index}`}>
                          菜单显示名
                        </Label>
                        <Input
                          id={`codex-display-name-${index}`}
                          value={row.displayName}
                          onChange={(event) =>
                            updateCodexExactRow(index, {
                              displayName: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`codex-provider-${index}`}>
                          精确匹配 Provider
                        </Label>
                        <Select
                          value={row.providerId || NO_PROVIDER_VALUE}
                          onValueChange={(value) =>
                            updateCodexExactRow(index, {
                              providerId:
                                value === NO_PROVIDER_VALUE ? "" : value,
                              upstreamModel:
                                value === NO_PROVIDER_VALUE
                                  ? ""
                                  : row.upstreamModel,
                            })
                          }
                        >
                          <SelectTrigger
                            id={`codex-provider-${index}`}
                            aria-label="精确匹配 Provider"
                          >
                            <SelectValue placeholder="精确匹配 Provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_PROVIDER_VALUE}>
                              精确匹配 Provider
                            </SelectItem>
                            {ordinaryProviders.map((ordinaryProvider) => (
                              <SelectItem
                                key={ordinaryProvider.id}
                                value={ordinaryProvider.id}
                              >
                                {ordinaryProvider.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`codex-upstream-model-${index}`}>
                          精确匹配 实际请求模型
                        </Label>
                        <ModelInputWithFetch
                          id={`codex-upstream-model-${index}`}
                          value={row.upstreamModel}
                          onChange={(value) =>
                            updateCodexExactRow(index, { upstreamModel: value })
                          }
                          placeholder={t(
                            "combinedProvider.manualModelPlaceholder",
                            {
                              defaultValue: "选择或手动输入模型",
                            },
                          )}
                          fetchedModels={state?.models ?? []}
                          isLoading={state?.status === "detecting"}
                          ariaLabel="精确匹配 实际请求模型"
                          dropdownAriaLabel="精确匹配 实际请求模型 options"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`codex-context-window-${index}`}>
                          上下文窗口
                        </Label>
                        <Input
                          id={`codex-context-window-${index}`}
                          value={toCodexContextWindowValue(row.contextWindow)}
                          onChange={(event) =>
                            updateCodexExactRow(index, {
                              contextWindow: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div
                className={`hidden grid-cols-1 gap-2 px-1 text-xs font-medium text-muted-foreground md:grid ${mappingGridClassName(appId)}`}
              >
                <span>
                  {t("providerForm.modelRoleLabel", {
                    defaultValue: "模型角色",
                  })}
                </span>
                <span>Provider</span>
                <span>
                  {t("providerForm.requestModelLabel", {
                    defaultValue: "实际请求模型",
                  })}
                </span>
                {appId === "claude" ? (
                  <span>
                    {t("providerForm.modelOneMHeader", {
                      defaultValue: "声明支持 1M",
                    })}
                  </span>
                ) : null}
              </div>

              {roleLabels.map(({ role, key, defaultLabel }) => {
                const label = t(key, { defaultValue: defaultLabel });
                const mapping = mappings[role];
                const selectedProvider = providers[mapping.providerId];
                const state = selectedProvider
                  ? detection[selectedProvider.id]
                  : undefined;
                const models = state?.models ?? [];
                const oneMSupported = supportsClaudeOneM(appId, role);
                const oneMChecked = hasClaudeOneMMarker(mapping.upstreamModel);

                return (
                  <div
                    key={role}
                    className={`grid grid-cols-1 gap-2 ${mappingGridClassName(appId)}`}
                  >
                    <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                      {label}
                    </div>
                    <div className="space-y-2 md:space-y-0">
                      <Label
                        htmlFor={`combined-${role}-provider`}
                        className="md:hidden"
                      >
                        {label} Provider
                      </Label>
                      <Select
                        value={mapping.providerId || NO_PROVIDER_VALUE}
                        onValueChange={(value) =>
                          updateMapping(role, {
                            providerId:
                              value === NO_PROVIDER_VALUE ? "" : value,
                            upstreamModel: "",
                          })
                        }
                      >
                        <SelectTrigger
                          id={`combined-${role}-provider`}
                          aria-label={`${label} Provider`}
                        >
                          <SelectValue
                            placeholder={t("combinedProvider.selectProvider", {
                              defaultValue: "选择 Provider",
                            })}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_PROVIDER_VALUE}>
                            {t("combinedProvider.selectProvider", {
                              defaultValue: "选择 Provider",
                            })}
                          </SelectItem>
                          {ordinaryProviders.map((ordinaryProvider) => (
                            <SelectItem
                              key={ordinaryProvider.id}
                              value={ordinaryProvider.id}
                            >
                              {ordinaryProvider.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:space-y-0">
                      <Label
                        htmlFor={`combined-${role}-model`}
                        className="md:hidden"
                      >
                        {label} Model
                      </Label>
                      <ModelInputWithFetch
                        id={`combined-${role}-model`}
                        value={getVisibleModelValue(
                          appId,
                          mapping.upstreamModel,
                        )}
                        onChange={(value) =>
                          updateMapping(role, {
                            upstreamModel: getStoredModelValue(
                              appId,
                              role,
                              mapping.upstreamModel,
                              value,
                            ),
                          })
                        }
                        placeholder={t(
                          "combinedProvider.manualModelPlaceholder",
                          {
                            defaultValue: "选择或手动输入模型",
                          },
                        )}
                        fetchedModels={models}
                        isLoading={state?.status === "detecting"}
                        ariaLabel={`${label} Model`}
                        dropdownAriaLabel={`${label} Model options`}
                      />
                      {mapping.providerId &&
                        (state?.status === "failed" ||
                          state?.status === "unavailable") && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {state.message || "模型列表获取失败"}
                          </p>
                        )}
                    </div>
                    {appId === "claude" ? (
                      <div className="flex h-9 items-center gap-2">
                        {oneMSupported ? (
                          <>
                            <Checkbox
                              id={`combined-${role}-one-m`}
                              checked={oneMChecked}
                              onCheckedChange={(checked) =>
                                updateMapping(role, {
                                  upstreamModel: setClaudeOneMMarker(
                                    mapping.upstreamModel,
                                    checked === true,
                                  ),
                                })
                              }
                            />
                            <Label
                              htmlFor={`combined-${role}-one-m`}
                              className="cursor-pointer text-sm font-normal"
                            >
                              {label}{" "}
                              {t("providerForm.modelOneMLabel", {
                                defaultValue: "1M",
                              })}
                            </Label>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
        </section>

        <section className="space-y-3">
          <div className="space-y-1 border-t border-border/50 pt-4">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="composite-settings-config"
                className="text-sm font-medium"
              >
                {appId === "codex"
                  ? t("codexConfig.configToml")
                  : t("combinedProvider.configJson.title", {
                      defaultValue: "配置 JSON",
                    })}
              </Label>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeCommonConfig.useCommonConfig}
                    onChange={(e) =>
                      activeCommonConfig.handleCommonConfigToggle(
                        e.target.checked,
                      )
                    }
                    className="w-4 h-4 text-blue-500 bg-white dark:bg-gray-800 border-border-default rounded focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-2"
                  />
                  <span>
                    {appId === "codex"
                      ? t("codexConfig.writeCommonConfig")
                      : t("claudeConfig.writeCommonConfig", {
                          defaultValue: "写入通用配置",
                        })}
                  </span>
                </label>
              </div>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsCommonConfigModalOpen(true)}
                className="text-xs text-blue-400 dark:text-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
              >
                {appId === "codex"
                  ? t("codexConfig.editCommonConfig")
                  : t("claudeConfig.editCommonConfig", {
                      defaultValue: "编辑通用配置",
                    })}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {appId === "codex"
                ? t("codexConfig.commonConfigHint")
                : t("combinedProvider.configJson.hint", {
                    defaultValue:
                      "这里只编辑组合 Provider 的通用配置；模型、Provider、URL 和 API Key 请在模型映射或普通 Provider 中配置。",
                  })}
            </p>
          </div>
          {appId === "claude" ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={compositeConfigToggles.hideAttribution}
                  onChange={(e) =>
                    handleCompositeConfigToggle(
                      "hideAttribution",
                      e.target.checked,
                    )
                  }
                  className="w-4 h-4 text-blue-500 bg-white dark:bg-gray-800 border-border-default rounded focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-2"
                />
                <span>{t("claudeConfig.hideAttribution")}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={compositeConfigToggles.teammates}
                  onChange={(e) =>
                    handleCompositeConfigToggle("teammates", e.target.checked)
                  }
                  className="w-4 h-4 text-blue-500 bg-white dark:bg-gray-800 border-border-default rounded focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-2"
                />
                <span>{t("claudeConfig.enableTeammates")}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={compositeConfigToggles.enableToolSearch}
                  onChange={(e) =>
                    handleCompositeConfigToggle(
                      "enableToolSearch",
                      e.target.checked,
                    )
                  }
                  className="w-4 h-4 text-blue-500 bg-white dark:bg-gray-800 border-border-default rounded focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-2"
                />
                <span>{t("claudeConfig.enableToolSearch")}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={compositeConfigToggles.effortMax}
                  onChange={(e) =>
                    handleCompositeConfigToggle("effortMax", e.target.checked)
                  }
                  className="w-4 h-4 text-blue-500 bg-white dark:bg-gray-800 border-border-default rounded focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-2"
                />
                <span>{t("claudeConfig.effortMax")}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={compositeConfigToggles.disableAutoUpgrade}
                  onChange={(e) =>
                    handleCompositeConfigToggle(
                      "disableAutoUpgrade",
                      e.target.checked,
                    )
                  }
                  className="w-4 h-4 text-blue-500 bg-white dark:bg-gray-800 border-border-default rounded focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-2"
                />
                <span>{t("claudeConfig.disableAutoUpgrade")}</span>
              </label>
            </div>
          ) : null}
          {settingsConfigError || activeCommonConfig.commonConfigError ? (
            <p className="text-xs text-red-500 dark:text-red-400">
              {settingsConfigError || activeCommonConfig.commonConfigError}
            </p>
          ) : null}
          {showClaudeCommonConfigPreviewLoading ? (
            <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
              正在加载通用配置预览…
            </div>
          ) : (
            <JsonEditor
              id="composite-settings-config"
              value={settingsConfigText}
              onChange={handleSettingsConfigChange}
              placeholder={
                appId === "codex"
                  ? `# Common Codex config\n\n# Add your common TOML configuration here`
                  : `{
  "env": {
    "ENABLE_TOOL_SEARCH": "true",
    "DISABLE_AUTOUPDATER": "1"
  },
  "attribution": {
    "commit": "",
    "pr": ""
  }
}`
              }
              darkMode={isDarkMode}
              rows={10}
              showValidation={appId !== "codex"}
              language={appId === "codex" ? "javascript" : "json"}
            />
          )}
          {appId === "codex" ? (
            <CodexCommonConfigModal
              isOpen={isCommonConfigModalOpen}
              onClose={() => {
                activeCommonConfig.clearError();
                setIsCommonConfigModalOpen(false);
              }}
              value={activeCommonConfig.commonConfigSnippet}
              onSave={codexCommonConfig.handleCommonConfigSnippetChange}
              error={activeCommonConfig.commonConfigError}
              onExtract={activeCommonConfig.handleExtract}
              isExtracting={activeCommonConfig.isExtracting}
            />
          ) : (
            <FullScreenPanel
              isOpen={isCommonConfigModalOpen}
              title={t("claudeConfig.editCommonConfigTitle", {
                defaultValue: "编辑通用配置片段",
              })}
              onClose={() => setIsCommonConfigModalOpen(false)}
              footer={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={activeCommonConfig.handleExtract}
                    disabled={activeCommonConfig.isExtracting}
                    className="gap-2"
                  >
                    {activeCommonConfig.isExtracting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {t("claudeConfig.extractFromCurrent", {
                      defaultValue: "从编辑内容提取",
                    })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCommonConfigModalOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setIsCommonConfigModalOpen(false)}
                    className="gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {t("common.save")}
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 p-3 space-y-1.5">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    {t("commonConfig.guideTitle")}
                  </p>
                  <p className="text-xs text-blue-700/80 dark:text-blue-400/80">
                    {t("commonConfig.guidePurpose")}
                  </p>
                  <p className="text-xs text-blue-700/80 dark:text-blue-400/80">
                    {t("commonConfig.guideUsage")}
                  </p>
                  <p className="text-xs text-blue-700/80 dark:text-blue-400/80">
                    {t("commonConfig.guideReExtract")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("commonConfig.guideReassurance")}
                  </p>
                </div>
                {(!activeCommonConfig.commonConfigSnippet ||
                  activeCommonConfig.commonConfigSnippet.trim() === "" ||
                  activeCommonConfig.commonConfigSnippet.trim() === "{}") && (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                    <Package className="h-8 w-8 mb-2 opacity-40" />
                    <p className="text-sm font-medium">
                      {t("commonConfig.emptyTitle")}
                    </p>
                    <p className="text-xs mt-1">{t("commonConfig.emptyHint")}</p>
                  </div>
                )}
                <JsonEditor
                  value={activeCommonConfig.commonConfigSnippet}
                  onChange={activeCommonConfig.handleCommonConfigSnippetChange}
                  placeholder={`{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://your-api-endpoint.com"\n  }\n}`}
                  darkMode={isDarkMode}
                  rows={16}
                  showValidation={true}
                  language="json"
                />
                {activeCommonConfig.commonConfigError && (
                  <p className="text-sm text-red-500 dark:text-red-400">
                    {activeCommonConfig.commonConfigError}
                  </p>
                )}
              </div>
            </FullScreenPanel>
          )}
        </section>

        <section className="space-y-3">
          <div className="space-y-1 border-t border-border/50 pt-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">
                  {t("combinedProvider.testConfig.title", {
                    defaultValue: "组合测试配置",
                  })}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("combinedProvider.testConfig.hint", {
                    defaultValue:
                      "组合 Provider 始终对每条路由执行巡检。开启后使用下方自定义的超时、重试、提示词和阈值；关闭后沿用全局流检配置。巡检请求会自动去掉 thinking 参数和 [1M] 本地标记，避免上游误判。",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="combined-test-config-enabled"
                  className="text-sm text-muted-foreground"
                >
                  {t("combinedProvider.testConfig.enabled", {
                    defaultValue: "使用自定义巡检参数",
                  })}
                </Label>
                <Switch
                  id="combined-test-config-enabled"
                  checked={modelRouterTestConfig.enabled}
                  onCheckedChange={(checked) => {
                    setModelRouterTestConfig((prev) => ({
                      ...prev,
                      enabled: checked,
                    }));
                    setIsDirty(true);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="combined-test-mode">
                {t("combinedProvider.testConfig.mode", {
                  defaultValue: "巡检模式",
                })}
              </Label>
              <Input
                id="combined-test-mode"
                value={t("combinedProvider.testConfig.mode.allRoutes", {
                  defaultValue: "全量巡检（按已配置路由）",
                })}
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="combined-test-timeout">
                {t("providerAdvanced.timeoutSecs", {
                  defaultValue: "超时时间（秒）",
                })}
              </Label>
              <Input
                id="combined-test-timeout"
                type="number"
                min={1}
                max={300}
                value={modelRouterTestConfig.timeoutSecs || ""}
                onChange={(event) => {
                  setModelRouterTestConfig((prev) => ({
                    ...prev,
                    timeoutSecs: event.target.value
                      ? Number.isFinite(Number(event.target.value))
                        ? Number(event.target.value) | 0
                        : prev.timeoutSecs
                      : undefined,
                  }));
                  setIsDirty(true);
                }}
                placeholder="45"
                disabled={!modelRouterTestConfig.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="combined-test-prompt">
                {t("providerAdvanced.testPrompt", {
                  defaultValue: "测试提示词",
                })}
              </Label>
              <Input
                id="combined-test-prompt"
                value={modelRouterTestConfig.testPrompt || ""}
                onChange={(event) => {
                  setModelRouterTestConfig((prev) => ({
                    ...prev,
                    testPrompt: event.target.value || undefined,
                  }));
                  setIsDirty(true);
                }}
                placeholder="Who are you?"
                disabled={!modelRouterTestConfig.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="combined-degraded-threshold">
                {t("providerAdvanced.degradedThreshold", {
                  defaultValue: "降级阈值（毫秒）",
                })}
              </Label>
              <Input
                id="combined-degraded-threshold"
                type="number"
                min={100}
                max={60000}
                value={modelRouterTestConfig.degradedThresholdMs || ""}
                onChange={(event) => {
                  setModelRouterTestConfig((prev) => ({
                    ...prev,
                    degradedThresholdMs: event.target.value
                      ? Number.isFinite(Number(event.target.value))
                        ? Number(event.target.value) | 0
                        : prev.degradedThresholdMs
                      : undefined,
                  }));
                  setIsDirty(true);
                }}
                placeholder="6000"
                disabled={!modelRouterTestConfig.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="combined-max-retries">
                {t("providerAdvanced.maxRetries", {
                  defaultValue: "最大重试次数",
                })}
              </Label>
              <Input
                id="combined-max-retries"
                type="number"
                min={0}
                max={10}
                value={modelRouterTestConfig.maxRetries ?? ""}
                onChange={(event) => {
                  setModelRouterTestConfig((prev) => ({
                    ...prev,
                    maxRetries: event.target.value
                      ? Number.isFinite(Number(event.target.value))
                        ? Number(event.target.value) | 0
                        : prev.maxRetries
                      : undefined,
                  }));
                  setIsDirty(true);
                }}
                placeholder="2"
                disabled={!modelRouterTestConfig.enabled}
              />
            </div>
          </div>
        </section>
      </form>
    </FullScreenPanel>
  );
}
