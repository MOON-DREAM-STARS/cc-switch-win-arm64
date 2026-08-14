import {
  AlertCircle,
  Coins,
  Layers3,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAgentSessionUsage } from "@/lib/query/usage";
import type {
  AgentSessionUsageSummary,
  AgentUsageAppType,
  AgentUsageMeasure,
  AgentUsagePrecision,
  AgentUsageRequestCountSemantics,
} from "@/types/usage";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatKnownTokenTotal } from "@/components/usage/format";

type SessionUsageSummaryProps = {
  appType: AgentUsageAppType;
  sessionId: string;
};

const precisionLabel = (
  precision: AgentUsagePrecision,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  switch (precision) {
    case "request_exact":
      return t("sessionManager.usagePrecisionRequest", {
        defaultValue: "Request-exact",
      });
    case "session_exact":
      return t("sessionManager.usagePrecisionSession", {
        defaultValue: "Session aggregate",
      });
    case "sync_window_delta":
      return t("sessionManager.usagePrecisionSyncWindow", {
        defaultValue: "Sync-window delta",
      });
    case "estimated":
      return t("sessionManager.usagePrecisionEstimated", {
        defaultValue: "Estimated",
      });
    default:
      return t("sessionManager.usagePrecisionUnavailable", {
        defaultValue: "Unavailable",
      });
  }
};

const requestCountLabel = (
  semantics: AgentUsageRequestCountSemantics,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  switch (semantics) {
    case "http_request":
      return t("sessionManager.usageHttpRequests", {
        defaultValue: "HTTP requests",
      });
    case "assistant_message":
      return t("sessionManager.usageAssistantMessages", {
        defaultValue: "assistant messages",
      });
    case "agent_call":
      return t("sessionManager.usageAgentCalls", {
        defaultValue: "agent calls",
      });
    default:
      return t("sessionManager.usageEventsUnavailable", {
        defaultValue: "event count unavailable",
      });
  }
};

const formatNumber = (value: number, language: string) =>
  new Intl.NumberFormat(language || undefined).format(value);

const formatCost = (
  measure: AgentUsageMeasure | null,
  unavailableLabel: string,
) => {
  if (!measure || measure.totalCostUsd === null) return unavailableLabel;
  const cost = Number.parseFloat(measure.totalCostUsd);
  if (!Number.isFinite(cost)) return unavailableLabel;
  return `$${cost.toFixed(4)}`;
};

const hasDescendantEvidence = (summary: AgentSessionUsageSummary) =>
  summary.supportsDescendants &&
  (summary.descendantSessionCount > 0 || summary.descendantUsage !== null);

type MeasureCardProps = {
  label: string;
  measure: AgentUsageMeasure | null;
  language: string;
  t: ReturnType<typeof useTranslation>["t"];
  countLabel?: string;
  count?: number;
  countUnavailableLabel: string;
  unavailableLabel: string;
  partialLabel: string;
};

function MeasureCard({
  label,
  measure,
  language,
  t,
  countLabel,
  count,
  countUnavailableLabel,
  unavailableLabel,
  partialLabel,
}: MeasureCardProps) {
  const effectiveCountLabel = measure
    ? requestCountLabel(measure.requestCountSemantics, t)
    : countUnavailableLabel;
  const countValue =
    measure?.requestCount === null || measure == null
      ? unavailableLabel
      : formatNumber(measure.requestCount, language);
  const precision = measure?.precision ?? "unavailable";
  const syncWindow =
    measure?.precision === "sync_window_delta" ||
    measure?.timeSemantics === "sync_window_end";

  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium" title={label}>
          {label}
        </span>
        {measure?.partial && (
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
            {partialLabel}
          </Badge>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("sessionManager.usageTokens", { defaultValue: "Tokens" })}
          </div>
          <div
            className="truncate font-semibold tabular-nums"
            data-testid="usage-tokens"
          >
            {formatKnownTokenTotal(measure, language, unavailableLabel)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("sessionManager.usageCost", { defaultValue: "Cost" })}
          </div>
          <div
            className="truncate font-semibold tabular-nums"
            data-testid="usage-cost"
          >
            {formatCost(measure, unavailableLabel)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("sessionManager.usageEvents", { defaultValue: "Source events" })}
          </div>
          <div className="truncate tabular-nums" data-testid="usage-events">
            {countLabel && count !== undefined
              ? count === 0
                ? formatNumber(count, language)
                : `${formatNumber(count, language)} ${countLabel}`
              : measure?.requestCount === null || measure == null
                ? effectiveCountLabel === countUnavailableLabel
                  ? countUnavailableLabel
                  : `${unavailableLabel} (${effectiveCountLabel})`
                : `${countValue} ${effectiveCountLabel}`}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("sessionManager.usagePrecision", { defaultValue: "Precision" })}
          </div>
          <div className="truncate" data-testid="usage-precision">
            {precisionLabel(precision, t)}
          </div>
        </div>
      </div>
      {syncWindow && (
        <div className="mt-2 flex min-w-0 items-start gap-1 text-[10px] text-muted-foreground">
          <MessageSquare
            className="mt-0.5 size-3 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">
            {t("sessionManager.usageSyncWindowHint", {
              defaultValue: "Sync-window increment; not per-request.",
            })}
          </span>
        </div>
      )}
    </div>
  );
}

function UsageUnavailable({
  t,
  isError = false,
}: {
  t: ReturnType<typeof useTranslation>["t"];
  isError?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      data-testid="session-usage-unavailable"
    >
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        {isError
          ? t("sessionManager.usageLoadFailed", {
              defaultValue: "Session visible; usage unavailable.",
            })
          : t("sessionManager.usageUnavailable", {
              defaultValue: "Session visible; usage not available.",
            })}
      </span>
    </div>
  );
}

export function SessionUsageSummary({
  appType,
  sessionId,
}: SessionUsageSummaryProps) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useAgentSessionUsage(appType, sessionId);
  const language = i18n.resolvedLanguage || i18n.language || "en-US";
  const unavailableLabel = t("sessionManager.usageUnavailableShort", {
    defaultValue: "Unavailable",
  });
  const partialLabel = t("sessionManager.usagePartial", {
    defaultValue: "Partial",
  });

  if (isLoading) {
    return (
      <div
        className="mt-3 flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        data-testid="session-usage-loading"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        <span>
          {t("sessionManager.usageLoading", { defaultValue: "Loading usage…" })}
        </span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mt-3">
        <UsageUnavailable t={t} isError={isError} />
      </div>
    );
  }

  const descendantVisible = hasDescendantEvidence(data);
  const totalPrecision = data.totalUsage?.precision ?? data.precision;
  const totalIsPartial = data.partial || Boolean(data.totalUsage?.partial);
  const syncWindow =
    totalPrecision === "sync_window_delta" ||
    data.totalUsage?.timeSemantics === "sync_window_end";
  const totalLabel = t("sessionManager.usageTaskTotal", {
    defaultValue: "Task total",
  });
  const selfLabel = t("sessionManager.usageSelf", {
    defaultValue: "This task",
  });
  const descendantsLabel = t("sessionManager.usageDescendants", {
    defaultValue: "All descendants",
  });

  return (
    <section
      className="mt-3 min-w-0 rounded-lg border border-border/70 bg-muted/20 p-2.5 sm:p-3"
      aria-label={totalLabel}
      data-testid="session-usage-summary"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Layers3 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{totalLabel}</span>
            {totalIsPartial && (
              <Badge
                variant="outline"
                className="shrink-0 px-1.5 py-0 text-[10px]"
              >
                {partialLabel}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-lg font-semibold tabular-nums",
                !data.totalUsage && "text-muted-foreground",
              )}
              data-testid="session-usage-total-tokens"
            >
              {formatKnownTokenTotal(
                data.totalUsage,
                language,
                unavailableLabel,
              )}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("sessionManager.usageTokens", { defaultValue: "Tokens" })}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge
            variant="secondary"
            className="max-w-full truncate px-1.5 py-0 font-normal"
          >
            {precisionLabel(totalPrecision, t)}
          </Badge>
          {syncWindow && (
            <Badge
              variant="outline"
              className="max-w-full truncate px-1.5 py-0 font-normal"
            >
              {t("sessionManager.usageSyncWindow", {
                defaultValue: "Sync window",
              })}
            </Badge>
          )}
          <span
            className="inline-flex min-w-0 items-center gap-1 truncate"
            title={formatCost(data.totalUsage, unavailableLabel)}
          >
            <Coins className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {formatCost(data.totalUsage, unavailableLabel)}
            </span>
          </span>
        </div>
      </div>

      <div
        className={cn(
          "mt-2 grid min-w-0 gap-2",
          descendantVisible ? "sm:grid-cols-2" : "grid-cols-1",
        )}
      >
        <MeasureCard
          label={selfLabel}
          measure={data.selfUsage}
          language={language}
          t={t}
          countUnavailableLabel={unavailableLabel}
          unavailableLabel={unavailableLabel}
          partialLabel={partialLabel}
        />
        {descendantVisible && (
          <MeasureCard
            label={
              data.descendantSessionCount > 0
                ? `${descendantsLabel} (${formatNumber(data.descendantSessionCount, language)})`
                : descendantsLabel
            }
            measure={data.descendantUsage}
            language={language}
            t={t}
            countUnavailableLabel={unavailableLabel}
            unavailableLabel={unavailableLabel}
            partialLabel={partialLabel}
          />
        )}
      </div>

      {(totalIsPartial || syncWindow || data.warnings.length > 0) && (
        <div className="mt-2 flex min-w-0 items-start gap-1.5 text-[10px] text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {syncWindow
              ? t("sessionManager.usageSyncWindowHint", {
                  defaultValue: "Sync-window increment; not per-request.",
                })
              : t("sessionManager.usagePartialHint", {
                  defaultValue: "Some usage fields are partial or unavailable.",
                })}
          </span>
        </div>
      )}
    </section>
  );
}
