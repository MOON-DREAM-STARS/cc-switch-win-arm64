import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import { IconPicker } from "@/components/IconPicker";
import { ProviderIcon } from "@/components/ProviderIcon";
import { ModelInputWithFetch } from "@/components/providers/forms/shared";
import {
  hasClaudeOneMMarker,
  setClaudeOneMMarker,
  stripClaudeOneMMarker,
} from "@/components/providers/forms/hooks/useModelState";
import { getIconMetadata } from "@/icons/extracted/metadata";
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

const NO_PROVIDER_VALUE = "__none__";

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

const supportsClaudeOneM = (appId: AppId, role: CompositeRole): boolean =>
  appId === "claude" && role !== "haiku";

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
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("");
  const [iconDialogOpen, setIconDialogOpen] = useState(false);
  const [mappings, setMappings] = useState<CompositeMappings>(emptyMappings);
  const [detection, setDetection] = useState<DetectionState>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const ordinaryProviders = useMemo(
    () => getDetectableOrdinaryProviders(providers, provider?.id ?? ""),
    [providers, provider?.id],
  );

  useEffect(() => {
    if (!open || !provider) return;
    setName(provider.name ?? "");
    setNotes(provider.notes ?? "");
    setWebsiteUrl(provider.websiteUrl ?? "");
    setIcon(provider.icon ?? "");
    setIconColor(provider.iconColor ?? "");
    setIconDialogOpen(false);
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

  const handleIconSelect = (selectedIcon: string) => {
    const meta = getIconMetadata(selectedIcon);
    setIcon(selectedIcon);
    setIconColor(meta?.defaultColor ?? "");
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
            <Label htmlFor="composite-provider-name">{t("provider.name")}</Label>
            <Input
              id="composite-provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("provider.namePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="composite-provider-notes">{t("provider.notes")}</Label>
            <Input
              id="composite-provider-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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
            onChange={(event) => setWebsiteUrl(event.target.value)}
            placeholder={t("providerForm.websiteUrlPlaceholder")}
          />
        </div>

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              {t("combinedProvider.description", {
                defaultValue: "按请求模型把流量路由到当前应用中的普通 Provider。",
              })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("combinedProvider.providerStatusHint", {
                defaultValue: "下方显示可用于组合路由的普通 Provider 及其模型探测状态。",
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
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="space-y-1 border-t border-border/50 pt-4">
            <h3 className="text-sm font-medium">
              {t("combinedProvider.mapping.title", { defaultValue: "模型映射" })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("combinedProvider.mapping.hint", {
                defaultValue: "为每个 Claude 模型角色选择普通 Provider，并指定要请求的上游模型。",
              })}
            </p>
          </div>

          <div className={`hidden grid-cols-1 gap-2 px-1 text-xs font-medium text-muted-foreground md:grid ${mappingGridClassName(appId)}`}>
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
            const state = selectedProvider ? detection[selectedProvider.id] : undefined;
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
                        providerId: value === NO_PROVIDER_VALUE ? "" : value,
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
                  <Label htmlFor={`combined-${role}-model`} className="md:hidden">
                    {label} Model
                  </Label>
                  <ModelInputWithFetch
                    id={`combined-${role}-model`}
                    value={getVisibleModelValue(appId, mapping.upstreamModel)}
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
                    placeholder={t("combinedProvider.manualModelPlaceholder", {
                      defaultValue: "选择或手动输入模型",
                    })}
                    fetchedModels={models}
                    isLoading={state?.status === "detecting"}
                    ariaLabel={`${label} Model`}
                    dropdownAriaLabel={`${label} Model options`}
                  />
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
                          {label} {t("providerForm.modelOneMLabel", { defaultValue: "1M" })}
                        </Label>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </form>
    </FullScreenPanel>
  );
}
