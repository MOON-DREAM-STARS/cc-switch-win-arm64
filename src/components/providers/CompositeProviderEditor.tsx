import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import type { Provider, ProviderModelRouterRule } from "@/types";
import type { AppId } from "@/lib/api";
import { fetchModelsForConfig, type FetchedModel } from "@/lib/api/model-fetch";
import {
  buildCompositeRoutes,
  getDetectableOrdinaryProviders,
  getModelFetchDescriptor,
  type CompositeMappings,
  type CompositeRole,
} from "@/utils/providerModelDetection";

interface CompositeProviderEditorProps {
  open: boolean;
  appId: AppId;
  provider: Provider | null;
  providers: Record<string, Provider>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { provider: Provider; originalId?: string }) => Promise<void> | void;
}

type DetectionState = Record<
  string,
  {
    status: "idle" | "detecting" | "ready" | "failed" | "unavailable";
    models: FetchedModel[];
    message?: string;
  }
>;

const emptyMappings = (): CompositeMappings => ({
  default: { providerId: "", upstreamModel: "" },
  haiku: { providerId: "", upstreamModel: "" },
  sonnet: { providerId: "", upstreamModel: "" },
  opus: { providerId: "", upstreamModel: "" },
});

const roleLabels: Array<{ role: CompositeRole; key: string; defaultLabel: string }> = [
  { role: "default", key: "combinedProvider.mapping.default", defaultLabel: "默认模型" },
  { role: "haiku", key: "combinedProvider.mapping.haiku", defaultLabel: "Haiku" },
  { role: "sonnet", key: "combinedProvider.mapping.sonnet", defaultLabel: "Sonnet" },
  { role: "opus", key: "combinedProvider.mapping.opus", defaultLabel: "Opus" },
];

const routeToMappings = (routes: ProviderModelRouterRule[]): CompositeMappings => {
  const mappings = emptyMappings();
  for (const route of routes) {
    const providerId = route.target?.providerId ?? "";
    const upstreamModel = route.target?.upstreamModel ?? "";
    if (!providerId && !upstreamModel) continue;

    if (route.matchType === "default") {
      mappings.default = { providerId, upstreamModel };
      continue;
    }

    if (
      route.matchType === "role" &&
      (route.matchValue === "haiku" ||
        route.matchValue === "sonnet" ||
        route.matchValue === "opus")
    ) {
      mappings[route.matchValue] = { providerId, upstreamModel };
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
  const [mappings, setMappings] = useState<CompositeMappings>(emptyMappings);
  const [detection, setDetection] = useState<DetectionState>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const ordinaryProviders = useMemo(
    () => getDetectableOrdinaryProviders(providers, provider?.id ?? ""),
    [providers, provider?.id],
  );

  useEffect(() => {
    if (!open || !provider) return;
    setMappings(routeToMappings(provider.meta?.modelRouter?.routes ?? []));
  }, [open, provider]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const detect = async () => {
      for (const ordinaryProvider of ordinaryProviders) {
        const descriptor = getModelFetchDescriptor(ordinaryProvider, appId);
        if (descriptor.source === "stored") {
          setDetection((prev) => ({
            ...prev,
            [ordinaryProvider.id]: {
              status: "ready",
              models: descriptor.models,
            },
          }));
          continue;
        }

        if (descriptor.source === "unavailable") {
          setDetection((prev) => ({
            ...prev,
            [ordinaryProvider.id]: {
              status: "unavailable",
              models: [],
              message: descriptor.reason,
            },
          }));
          continue;
        }

        setDetection((prev) => ({
          ...prev,
          [ordinaryProvider.id]: { status: "detecting", models: [] },
        }));
        try {
          const models = await fetchModelsForConfig(
            descriptor.baseUrl,
            descriptor.apiKey,
            descriptor.isFullUrl,
            descriptor.modelsUrl,
          );
          if (cancelled) return;
          setDetection((prev) => ({
            ...prev,
            [ordinaryProvider.id]: { status: "ready", models },
          }));
        } catch (error) {
          if (cancelled) return;
          setDetection((prev) => ({
            ...prev,
            [ordinaryProvider.id]: {
              status: "failed",
              models: [],
              message: error instanceof Error ? error.message : String(error),
            },
          }));
        }
      }
    };

    void detect();
    return () => {
      cancelled = true;
    };
  }, [appId, open, ordinaryProviders]);

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
  };

  const handleSubmit = async () => {
    if (!provider) return;
    for (const [role, value] of Object.entries(mappings)) {
      if (value.upstreamModel.trim() && !value.providerId.trim()) {
        toast.error(
          t("combinedProvider.validation.modelWithoutProvider", {
            role,
            defaultValue: "请选择 Provider 后再填写模型。",
          }),
        );
        return;
      }
    }

    const routes = buildCompositeRoutes(provider.meta?.modelRouter?.routes ?? [], mappings);
    const { model_router: _modelRouterAlias, ...meta } = provider.meta ?? {};
    const updatedProvider: Provider = {
      ...provider,
      name: provider.name || t("combinedProvider.name", { defaultValue: "组合provider" }),
      meta: {
        ...meta,
        providerType: "model_router",
        managedModelRouterProvider: provider.meta?.managedModelRouterProvider ?? true,
        modelRouter: { version: 1, routes },
      },
    };

    setIsSubmitting(true);
    try {
      await onSubmit({ provider: updatedProvider, originalId: provider.id });
      toast.success(
        t("combinedProvider.saveSuccess", { defaultValue: "组合 Provider 已保存" }),
      );
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("combinedProvider.editTitle", { defaultValue: "编辑组合provider" })}
      onClose={() => onOpenChange(false)}
      footer={
        <Button type="button" onClick={handleSubmit} disabled={isSubmitting || !provider}>
          <Save className="h-4 w-4 mr-2" />
          {t("common.save", { defaultValue: "保存" })}
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
          <h3 className="text-sm font-semibold">
            {t("combinedProvider.description", {
              defaultValue: "按请求模型把流量路由到当前应用中的普通 Provider。",
            })}
          </h3>
          {ordinaryProviders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
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
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-background p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{ordinaryProvider.name}</p>
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
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
          <h3 className="text-sm font-semibold">
            {t("combinedProvider.mapping.title", { defaultValue: "模型映射" })}
          </h3>
          {roleLabels.map(({ role, key, defaultLabel }) => {
            const label = t(key, { defaultValue: defaultLabel });
            const selectedProvider = providers[mappings[role].providerId];
            const models = selectedProvider
              ? (detection[selectedProvider.id]?.models ?? [])
              : [];

            return (
              <div key={role} className="grid gap-3 md:grid-cols-[160px_1fr_1fr] md:items-end">
                <div className="text-sm font-medium">{label}</div>
                <div className="space-y-2">
                  <Label htmlFor={`combined-${role}-provider`}>{label} Provider</Label>
                  <select
                    id={`combined-${role}-provider`}
                    aria-label={`${label} Provider`}
                    value={mappings[role].providerId}
                    onChange={(event) =>
                      updateMapping(role, {
                        providerId: event.target.value,
                        upstreamModel: "",
                      })
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">
                      {t("combinedProvider.selectProvider", {
                        defaultValue: "选择 Provider",
                      })}
                    </option>
                    {ordinaryProviders.map((ordinaryProvider) => (
                      <option key={ordinaryProvider.id} value={ordinaryProvider.id}>
                        {ordinaryProvider.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`combined-${role}-model`}>{label} Model</Label>
                  <Input
                    id={`combined-${role}-model`}
                    aria-label={`${label} Model`}
                    value={mappings[role].upstreamModel}
                    onChange={(event) =>
                      updateMapping(role, { upstreamModel: event.target.value })
                    }
                    list={`combined-${role}-models`}
                    placeholder={t("combinedProvider.manualModelPlaceholder", {
                      defaultValue: "选择或手动输入模型",
                    })}
                  />
                  <datalist id={`combined-${role}-models`}>
                    {models.map((model) => (
                      <option key={model.id} value={model.id} />
                    ))}
                  </datalist>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </FullScreenPanel>
  );
}
