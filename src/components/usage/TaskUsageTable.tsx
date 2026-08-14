import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import {
  useAgentTaskUsage,
  useAgentUsageCapabilities,
} from "@/lib/query/usage";
import {
  type AgentTaskUsageFilter,
  type AgentTaskUsageRow,
  type AgentUsageCapability,
  type AgentUsageMeasure,
  type AgentUsageAppType,
  type UsageRangeSelection,
} from "@/types/usage";
import { resolveUsageRange } from "@/lib/usageRange";
import { fmtInt, fmtUsd, formatKnownTokenTotal } from "./format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TASK_PAGE_SIZE = 20;
const TASK_TABLE_MIN_WIDTH = 1280;

interface TaskUsageTableProps {
  range: UsageRangeSelection;
  refreshIntervalMs: number;
  /** Keep the dashboard's app selector useful when the task tab is opened. */
  initialAppType?: AgentUsageAppType;
}

/** Convert the dashboard's date picker state to the canonical task query range. */
export function toAgentUsageRange(selection: UsageRangeSelection) {
  const { startDate, endDate } = resolveUsageRange(selection);
  return { startAt: startDate, endAt: endDate };
}

function agentLabel(
  appType: AgentUsageAppType,
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  const labels: Record<AgentUsageAppType, [string, string]> = {
    claude: ["usage.appFilter.claude", "Claude Code"],
    "claude-desktop": [
      "usage.appFilter.claudeDesktop",
      "Claude Desktop / Cowork",
    ],
    codex: ["usage.appFilter.codex", "Codex"],
    gemini: ["usage.appFilter.gemini", "Gemini CLI"],
    grokbuild: ["usage.appFilter.grokbuild", "Grok Build"],
    opencode: ["usage.appFilter.opencode", "OpenCode"],
    openclaw: ["usage.appFilter.openclaw", "OpenClaw"],
    hermes: ["usage.appFilter.hermes", "Hermes"],
  };
  const [key, fallback] = labels[appType];
  return t(key, { defaultValue: fallback });
}

function precisionLabel(
  precision: AgentUsageMeasure["precision"],
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  const labels: Record<AgentUsageMeasure["precision"], [string, string]> = {
    request_exact: ["usage.task.precision.requestExact", "Request-exact"],
    session_exact: ["usage.task.precision.sessionExact", "Session-exact"],
    sync_window_delta: [
      "usage.task.precision.syncWindowDelta",
      "Sync-window delta",
    ],
    estimated: ["usage.task.precision.estimated", "Estimated"],
    unavailable: ["usage.task.precision.unavailable", "Unavailable"],
  };
  const [key, fallback] = labels[precision];
  return t(key, { defaultValue: fallback });
}

function timeSemanticsLabel(
  semantics: AgentUsageMeasure["timeSemantics"],
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  const labels: Record<AgentUsageMeasure["timeSemantics"], [string, string]> = {
    event_time: ["usage.task.time.event", "Event time"],
    session_time: ["usage.task.time.session", "Session time"],
    sync_window_end: ["usage.task.time.syncWindow", "Sync-window end"],
    unavailable: ["usage.task.time.unavailable", "Time unavailable"],
  };
  const [key, fallback] = labels[semantics];
  return t(key, { defaultValue: fallback });
}

function requestCountSemanticsLabel(
  semantics: AgentUsageMeasure["requestCountSemantics"],
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  const labels: Record<
    AgentUsageMeasure["requestCountSemantics"],
    [string, string]
  > = {
    http_request: ["usage.task.count.httpRequest", "HTTP requests"],
    assistant_message: [
      "usage.task.count.assistantMessage",
      "Assistant messages",
    ],
    agent_call: ["usage.task.count.agentCall", "Agent calls"],
    unavailable: ["usage.task.count.unavailable", "Count unavailable"],
  };
  const [key, fallback] = labels[semantics];
  return t(key, { defaultValue: fallback });
}

function nullableInteger(value: number | null | undefined) {
  return value == null ? "—" : fmtInt(value);
}

function displayCost(measure: AgentUsageMeasure | null) {
  if (!measure || measure.totalCostUsd == null) return "—";
  return fmtUsd(measure.totalCostUsd, 4, "—");
}

function taskTitle(row: AgentTaskUsageRow) {
  return row.root?.title?.trim() || row.rootSessionId || row.sessionId;
}

function taskProject(row: AgentTaskUsageRow) {
  return row.root?.projectDir?.trim() || "—";
}

function rowKey(row: AgentTaskUsageRow) {
  return `${row.appType}:${row.rootSessionId || row.sessionId}`;
}

function measureStatus(
  row: AgentTaskUsageRow,
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  if (!row.totalUsage) {
    return t("usage.task.status.unavailable", { defaultValue: "Unavailable" });
  }
  if (row.partial || row.totalUsage.partial) {
    return t("usage.task.status.partial", { defaultValue: "Partial" });
  }
  return t("usage.task.status.available", { defaultValue: "Available" });
}

function taskTokenTotal(
  measure: AgentUsageMeasure | null,
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  return formatKnownTokenTotal(
    measure,
    undefined,
    t("usage.task.unavailable", { defaultValue: "Unavailable" }),
  );
}

function capabilityStatus(capability: AgentUsageCapability) {
  const statuses = [
    capability.sessionEnumeration,
    capability.usageStatus,
    capability.tokenStatus,
    capability.costStatus,
  ];
  if (statuses.includes("unavailable")) return "unavailable" as const;
  if (statuses.includes("partial")) return "partial" as const;
  return "supported" as const;
}

function useWideTaskLayout(
  containerRef: RefObject<HTMLElement>,
  minWidth: number,
) {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => setIsWide(container.clientWidth >= minWidth);
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, minWidth]);

  return isWide;
}

function MeasureBreakdown({
  label,
  measure,
  t,
}: {
  label: string;
  measure: AgentUsageMeasure | null;
  t: (key: string, options?: { defaultValue?: string }) => string;
}) {
  if (!measure) {
    return (
      <div className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}:</span>{" "}
        {t("usage.task.unavailable", { defaultValue: "Usage unavailable" })}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {precisionLabel(measure.precision, t)}
        </span>
        <span className="text-muted-foreground">
          {timeSemanticsLabel(measure.timeSemantics, t)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground sm:grid-cols-4">
        <span>
          {t("usage.inputTokens", { defaultValue: "Input" })}:{" "}
          {nullableInteger(measure.inputTokens)}
        </span>
        <span>
          {t("usage.outputTokens", { defaultValue: "Output" })}:{" "}
          {nullableInteger(measure.outputTokens)}
        </span>
        <span>
          {t("usage.cacheReadTokens", { defaultValue: "Cache read" })}:{" "}
          {nullableInteger(measure.cacheReadTokens)}
        </span>
        <span>
          {t("usage.cacheCreationTokens", {
            defaultValue: "Cache creation",
          })}
          : {nullableInteger(measure.cacheCreationTokens)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>
          {t("usage.cost", { defaultValue: "Cost" })}: {displayCost(measure)}
        </span>
        <span>
          {measure.requestCount == null ? "—" : fmtInt(measure.requestCount)}{" "}
          {requestCountSemanticsLabel(measure.requestCountSemantics, t)}
        </span>
      </div>
    </div>
  );
}

function TaskUsageRowView({
  row,
  expanded,
  onToggle,
  t,
}: {
  row: AgentTaskUsageRow;
  expanded: boolean;
  onToggle: () => void;
  t: (key: string, options?: { defaultValue?: string }) => string;
}) {
  const key = rowKey(row);
  const title = taskTitle(row);
  const project = taskProject(row);
  const descendantEvidence = row.descendantSessionCount > 0;
  const total = row.totalUsage;
  const countLabel = total
    ? requestCountSemanticsLabel(total.requestCountSemantics, t)
    : requestCountSemanticsLabel("unavailable", t);

  return (
    <TableRow data-testid={`task-row-${key}`}>
      <TableCell className="min-w-[220px] max-w-[360px] align-top">
        <div className="truncate font-medium" title={title}>
          {title}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {agentLabel(row.appType, t)}
        </div>
      </TableCell>
      <TableCell className="min-w-[180px] max-w-[320px] align-top">
        <div
          className="break-all text-xs text-muted-foreground"
          title={project}
        >
          {project}
        </div>
      </TableCell>
      <TableCell className="min-w-[170px] align-top">
        <div className="font-semibold tabular-nums">
          {taskTokenTotal(total, t)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {t("usage.tokens", { defaultValue: "tokens" })}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {displayCost(total)} ·{" "}
          {total
            ? precisionLabel(total.precision, t)
            : precisionLabel("unavailable", t)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {countLabel}:{" "}
          {total?.requestCount == null ? "—" : fmtInt(total.requestCount)}
        </div>
        {descendantEvidence && (
          <div className="mt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-xs"
              aria-expanded={expanded}
              aria-controls={`task-breakdown-${key}`}
              onClick={onToggle}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {t("usage.task.viewBreakdown", {
                defaultValue: "Self / descendants",
              })}{" "}
              <span className="text-muted-foreground">
                ({row.descendantSessionCount})
              </span>
            </Button>
            {expanded && (
              <div
                id={`task-breakdown-${key}`}
                data-testid={`task-breakdown-${key}`}
                className="mt-2 space-y-2"
              >
                <MeasureBreakdown
                  label={t("usage.task.self", { defaultValue: "Self" })}
                  measure={row.selfUsage}
                  t={t}
                />
                <MeasureBreakdown
                  label={t("usage.task.descendants", {
                    defaultValue: "Descendants",
                  })}
                  measure={row.descendantUsage}
                  t={t}
                />
              </div>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="min-w-[135px] align-top">
        <span
          className={
            !total
              ? "text-muted-foreground"
              : row.partial || total.partial
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
          }
        >
          {measureStatus(row, t)}
        </span>
        <div className="mt-1 text-xs text-muted-foreground">
          {total
            ? `${precisionLabel(total.precision, t)} · ${timeSemanticsLabel(total.timeSemantics, t)}`
            : t("usage.task.noMeasure", { defaultValue: "No usage measure" })}
        </div>
      </TableCell>
      <TableCell className="min-w-[120px] align-top text-right">
        {total?.requestCount == null ? "—" : fmtInt(total.requestCount)}
        <div className="mt-1 text-xs text-muted-foreground">{countLabel}</div>
      </TableCell>
    </TableRow>
  );
}

function TaskUsageCardView({
  row,
  expanded,
  onToggle,
  t,
}: {
  row: AgentTaskUsageRow;
  expanded: boolean;
  onToggle: () => void;
  t: (key: string, options?: { defaultValue?: string }) => string;
}) {
  const key = rowKey(row);
  const title = taskTitle(row);
  const project = taskProject(row);
  const descendantEvidence = row.descendantSessionCount > 0;
  const total = row.totalUsage;
  const countLabel = total
    ? requestCountSemanticsLabel(total.requestCountSemantics, t)
    : requestCountSemanticsLabel("unavailable", t);
  const status = measureStatus(row, t);
  const statusClass = !total
    ? "text-muted-foreground"
    : row.partial || total.partial
      ? "text-amber-600 dark:text-amber-400"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <article
      data-testid={`task-row-${key}`}
      className="min-w-0 rounded-lg border border-border/60 bg-card/40 p-3 backdrop-blur-sm"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="break-words font-medium" title={title}>
            {title}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {agentLabel(row.appType, t)}
          </div>
          <div
            className="mt-2 break-all text-xs text-muted-foreground"
            title={project}
          >
            {project}
          </div>
        </div>
        <div className="shrink-0 text-left text-xs sm:text-right">
          <div className={statusClass}>{status}</div>
          <div className="mt-1 text-muted-foreground">
            {total
              ? `${precisionLabel(total.precision, t)} · ${timeSemanticsLabel(total.timeSemantics, t)}`
              : t("usage.task.noMeasure", { defaultValue: "No usage measure" })}
          </div>
        </div>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 border-t border-border/50 pt-3 text-xs sm:grid-cols-4">
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("usage.task.total", { defaultValue: "Derived total" })}
          </div>
          <div className="mt-1 truncate font-semibold tabular-nums">
            {taskTokenTotal(total, t)}{" "}
            <span className="font-normal text-muted-foreground">
              {t("usage.tokens", { defaultValue: "tokens" })}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("usage.cost", { defaultValue: "Cost" })}
          </div>
          <div className="mt-1 truncate font-semibold tabular-nums">
            {displayCost(total)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("usage.task.count", { defaultValue: "Count" })}
          </div>
          <div className="mt-1 truncate tabular-nums">
            {total?.requestCount == null ? "—" : fmtInt(total.requestCount)}{" "}
            <span className="text-muted-foreground">{countLabel}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground">
            {t("usage.task.dataStatus", { defaultValue: "Data status" })}
          </div>
          <div className="mt-1 truncate text-muted-foreground">
            {total
              ? `${precisionLabel(total.precision, t)} · ${timeSemanticsLabel(total.timeSemantics, t)}`
              : t("usage.task.noMeasure", { defaultValue: "No usage measure" })}
          </div>
        </div>
      </div>

      {descendantEvidence && (
        <div className="mt-3 border-t border-border/50 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs"
            aria-expanded={expanded}
            aria-controls={`task-breakdown-${key}`}
            onClick={onToggle}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {t("usage.task.viewBreakdown", {
              defaultValue: "Self / descendants",
            })}{" "}
            <span className="text-muted-foreground">
              ({row.descendantSessionCount})
            </span>
          </Button>
          {expanded && (
            <div
              id={`task-breakdown-${key}`}
              data-testid={`task-breakdown-${key}`}
              className="mt-2 space-y-2"
            >
              <MeasureBreakdown
                label={t("usage.task.self", { defaultValue: "Self" })}
                measure={row.selfUsage}
                t={t}
              />
              <MeasureBreakdown
                label={t("usage.task.descendants", {
                  defaultValue: "Descendants",
                })}
                measure={row.descendantUsage}
                t={t}
              />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function TaskUsageTable({
  range,
  refreshIntervalMs,
  initialAppType,
}: TaskUsageTableProps) {
  const { t } = useTranslation();
  const layoutRef = useRef<HTMLDivElement>(null);
  const isWideLayout = useWideTaskLayout(layoutRef, TASK_TABLE_MIN_WIDTH);
  const [agentAppType, setAgentAppType] = useState<AgentUsageAppType | "all">(
    initialAppType ?? "all",
  );
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [projectDir, setProjectDir] = useState("");
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  useEffect(() => {
    setAgentAppType(initialAppType ?? "all");
  }, [initialAppType]);

  const queryRange = useMemo(
    () => toAgentUsageRange(range),
    [
      range.customEndDate,
      range.customStartDate,
      range.liveEndTime,
      range.preset,
    ],
  );

  const filter = useMemo<AgentTaskUsageFilter>(
    () => ({
      appType: agentAppType === "all" ? undefined : agentAppType,
      title: title.trim() || undefined,
      project: project.trim() || undefined,
      projectDir: projectDir.trim() || undefined,
      range: queryRange,
      limit: TASK_PAGE_SIZE,
      offset: page * TASK_PAGE_SIZE,
    }),
    [agentAppType, page, project, projectDir, queryRange, title],
  );

  const { data, isLoading, isError, error, isFetching } = useAgentTaskUsage(
    filter,
    {
      refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    },
  );
  const capabilitiesQuery = useAgentUsageCapabilities({
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });

  const capabilities = capabilitiesQuery.data ?? [];

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / TASK_PAGE_SIZE) : 0;

  useEffect(() => {
    setPage(0);
    setExpandedRows([]);
  }, [
    agentAppType,
    project,
    projectDir,
    range.customEndDate,
    range.customStartDate,
    range.liveEndTime,
    range.preset,
    title,
  ]);

  const toggleExpanded = (key: string) => {
    setExpandedRows((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  return (
    <div
      ref={layoutRef}
      className="min-w-0 space-y-4"
      data-testid="task-usage-layout"
      data-layout={isWideLayout ? "table" : "cards"}
    >
      <div className="rounded-lg border border-border/50 bg-card/50 p-3 backdrop-blur-sm">
        <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:w-40 sm:shrink-0">
            <span>{t("usage.task.agent", { defaultValue: "Agent" })}</span>
            <select
              aria-label={t("usage.task.agent", { defaultValue: "Agent" })}
              value={agentAppType}
              onChange={(event) =>
                setAgentAppType(event.target.value as AgentUsageAppType | "all")
              }
              className="h-9 w-full min-w-0 truncate rounded-md border border-border-default bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">
                {t("usage.task.allAgents", { defaultValue: "All agents" })}
              </option>
              {capabilities.map((capability: AgentUsageCapability) => (
                <option key={capability.appType} value={capability.appType}>
                  {agentLabel(capability.appType, t)}
                  {capabilityStatus(capability) === "unavailable"
                    ? ` — ${t("usage.task.unavailable", {
                        defaultValue: "Unavailable",
                      })}`
                    : capabilityStatus(capability) === "partial"
                      ? ` — ${t("usage.task.partial", {
                          defaultValue: "Partial",
                        })}`
                      : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:min-w-[180px] sm:flex-1">
            <span>{t("usage.task.title", { defaultValue: "Task title" })}</span>
            <Input
              aria-label={t("usage.task.title", { defaultValue: "Task title" })}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("usage.task.searchTitle", {
                defaultValue: "Search title",
              })}
              className="h-9"
            />
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:min-w-[180px] sm:flex-1">
            <span>{t("usage.task.project", { defaultValue: "Project" })}</span>
            <Input
              aria-label={t("usage.task.project", { defaultValue: "Project" })}
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder={t("usage.task.searchProject", {
                defaultValue: "Search project",
              })}
              className="h-9"
            />
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:min-w-[180px] sm:flex-[1.2]">
            <span>
              {t("usage.task.projectDir", {
                defaultValue: "Project directory",
              })}
            </span>
            <Input
              aria-label={t("usage.task.projectDir", {
                defaultValue: "Project directory",
              })}
              value={projectDir}
              onChange={(event) => setProjectDir(event.target.value)}
              placeholder={t("usage.task.searchProjectDir", {
                defaultValue: "Search project path",
              })}
              className="h-9"
            />
          </label>
        </div>
        {capabilitiesQuery.isError && (
          <p
            className="mt-2 text-xs text-amber-600 dark:text-amber-400"
            role="status"
          >
            {t("usage.task.capabilitiesUnavailable", {
              defaultValue: "Agent capability metadata is unavailable.",
            })}
          </p>
        )}
        {isFetching && !isLoading && (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {t("usage.task.refreshing", { defaultValue: "Refreshing…" })}
          </p>
        )}
      </div>

      {isLoading ? (
        <div
          className="h-[320px] animate-pulse rounded-lg border border-border/50 bg-muted/20"
          aria-busy="true"
          aria-label={t("usage.loading", { defaultValue: "Loading" })}
          role="status"
        />
      ) : isError ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive"
          role="alert"
        >
          <div className="font-medium">
            {t("usage.task.loadError", {
              defaultValue: "Unable to load tasks",
            })}
          </div>
          <div className="mt-1 text-xs opacity-80">{String(error)}</div>
        </div>
      ) : (
        <>
          {isWideLayout ? (
            <div
              data-testid="task-usage-table"
              className="overflow-hidden rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("usage.task.task", { defaultValue: "Task" })}
                    </TableHead>
                    <TableHead>
                      {t("usage.task.project", { defaultValue: "Project" })}
                    </TableHead>
                    <TableHead>
                      {t("usage.task.total", { defaultValue: "Derived total" })}
                    </TableHead>
                    <TableHead>
                      {t("usage.task.dataStatus", {
                        defaultValue: "Data status",
                      })}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("usage.task.count", { defaultValue: "Count" })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-32 text-center text-muted-foreground"
                      >
                        {t("usage.task.empty", {
                          defaultValue: "No root tasks match these filters.",
                        })}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => {
                      const key = rowKey(row);
                      return (
                        <TaskUsageRowView
                          key={key}
                          row={row}
                          expanded={expandedRows.includes(key)}
                          onToggle={() => toggleExpanded(key)}
                          t={t}
                        />
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div data-testid="task-usage-cards" className="grid min-w-0 gap-3">
              {rows.length === 0 ? (
                <div className="flex min-h-32 items-center justify-center rounded-lg border border-border/50 bg-card/40 p-4 text-center text-sm text-muted-foreground">
                  {t("usage.task.empty", {
                    defaultValue: "No root tasks match these filters.",
                  })}
                </div>
              ) : (
                rows.map((row) => {
                  const key = rowKey(row);
                  return (
                    <TaskUsageCardView
                      key={key}
                      row={row}
                      expanded={expandedRows.includes(key)}
                      onToggle={() => toggleExpanded(key)}
                      t={t}
                    />
                  );
                })
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {t("usage.task.totalRecords", {
                defaultValue: "{{total}} root tasks",
                total,
              })}
            </span>
            <div className="flex items-center gap-2">
              <span aria-live="polite">
                {totalPages > 0
                  ? t("usage.task.pageSummary", {
                      defaultValue: "Page {{page}} of {{pages}}",
                      page: page + 1,
                      pages: totalPages,
                    })
                  : t("usage.task.noPages", { defaultValue: "No pages" })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("usage.previousPage", {
                  defaultValue: "Previous page",
                })}
                disabled={page === 0 || totalPages === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("usage.nextPage", { defaultValue: "Next page" })}
                disabled={totalPages === 0 || page >= totalPages - 1}
                onClick={() =>
                  setPage((current) =>
                    totalPages > 0
                      ? Math.min(totalPages - 1, current + 1)
                      : current,
                  )
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
