import {
  AlertCircle,
  Coins,
  ChevronDown,
  ChevronUp,
  Layers3,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAgentSessionUsage } from "@/lib/query/usage";
import type {
  AgentSessionUsageSummary,
  AgentUsageAppType,
  AgentUsageMeasure,
  AgentUsageRequestCountSemantics,
} from "@/types/usage";
import { cn } from "@/lib/utils";
import { formatKnownTokenTotal } from "@/components/usage/format";

type SessionUsageSummaryProps = {
  appType: AgentUsageAppType;
  sessionId: string;
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
}: MeasureCardProps) {
  const effectiveCountLabel = measure
    ? requestCountLabel(measure.requestCountSemantics, t)
    : countUnavailableLabel;
  const countValue =
    measure?.requestCount === null || measure == null
      ? unavailableLabel
      : formatNumber(measure.requestCount, language);
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium" title={label}>
          {label}
        </span>
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
      </div>
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const language = i18n.resolvedLanguage || i18n.language || "en-US";
  const unavailableLabel = t("sessionManager.usageUnavailableShort", {
    defaultValue: "Unavailable",
  });

  useEffect(() => {
    setDetailsOpen(false);
  }, [appType, sessionId]);

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
  const totalIsPartial = data.partial || Boolean(data.totalUsage?.partial);
  const measures = [data.totalUsage, data.selfUsage, data.descendantUsage];
  const measureHasPartial = measures.some(
    (measure) => measure?.partial || measure?.warnings.length,
  );
  const measureHasDetails =
    measureHasPartial ||
    measures.some(
      (measure) =>
        measure?.timeSemantics != null &&
        measure.timeSemantics !== "event_time",
    );
  const detailTimeSemantics = measures.find(
    (measure) =>
      measure?.timeSemantics && measure.timeSemantics !== "event_time",
  )?.timeSemantics;
  const syncWindow = detailTimeSemantics === "sync_window_end";
  const hasDataDetails =
    totalIsPartial || measureHasDetails || data.warnings.length > 0;
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
          />
        )}
      </div>

      {hasDataDetails && (
        <div className="mt-2 min-w-0">
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={detailsOpen}
            aria-controls="session-usage-data-details"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? (
              <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span>
              {t(
                detailsOpen
                  ? "sessionManager.usageDataDetailsClose"
                  : "sessionManager.usageDataDetails",
                {
                  defaultValue: detailsOpen
                    ? "Hide data details"
                    : "Data details",
                },
              )}
            </span>
          </button>
          {detailsOpen && (
            <div
              id="session-usage-data-details"
              data-testid="session-usage-data-details"
              className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded-md border border-border/50 bg-background/30 px-2 py-1.5 text-[10px] text-muted-foreground"
            >
              <AlertCircle
                className="mt-0.5 size-3 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-1">
                {(totalIsPartial ||
                  measureHasPartial ||
                  data.warnings.length > 0) && (
                  <div>
                    {t("sessionManager.usagePartialHint", {
                      defaultValue:
                        "Some usage fields are partial or unavailable.",
                    })}
                  </div>
                )}
                {syncWindow && (
                  <div className="flex items-start gap-1">
                    <MessageSquare
                      className="mt-0.5 size-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {t("sessionManager.usageSyncWindowHint", {
                        defaultValue: "Sync-window increment; not per-request.",
                      })}
                    </span>
                  </div>
                )}
                {detailTimeSemantics === "session_time" && (
                  <div>
                    {t("sessionManager.usageSessionTimeHint", {
                      defaultValue: "Usage is aggregated by session time.",
                    })}
                  </div>
                )}
                {detailTimeSemantics === "unavailable" && (
                  <div>
                    {t("sessionManager.usageTimeUnavailableHint", {
                      defaultValue: "Source time is unavailable.",
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
