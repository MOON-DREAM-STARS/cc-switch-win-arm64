import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
} from "lucide-react";
import {
  useAgentTaskUsage,
  useAgentTaskUsageFilterOptions,
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
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

function shortSessionId(row: AgentTaskUsageRow) {
  const sessionId = row.rootSessionId || row.sessionId;
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

function taskTitle(
  row: AgentTaskUsageRow,
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  const title = row.root?.title?.trim();
  return (
    title ||
    `${t("usage.task.titleUnavailable", {
      defaultValue: "Task title not provided",
    })} · ${shortSessionId(row)}`
  );
}

function taskTitleTooltip(row: AgentTaskUsageRow) {
  return row.root?.title?.trim() || row.rootSessionId || row.sessionId;
}

function projectBasename(projectDir: string) {
  const trimmed = projectDir.trim();
  if (!trimmed) return "";
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, "");
  if (!withoutTrailingSeparators) return trimmed;
  if (/^[A-Za-z]:$/.test(withoutTrailingSeparators)) return trimmed;
  const separator = Math.max(
    withoutTrailingSeparators.lastIndexOf("/"),
    withoutTrailingSeparators.lastIndexOf("\\"),
  );
  return separator >= 0
    ? withoutTrailingSeparators.slice(separator + 1) || trimmed
    : withoutTrailingSeparators;
}

function taskProject(row: AgentTaskUsageRow) {
  const projectDir = row.root?.projectDir?.trim();
  if (!projectDir) return null;
  return {
    name: projectBasename(projectDir),
    path: projectDir,
  };
}

function rowKey(row: AgentTaskUsageRow) {
  return `${row.appType}:${row.rootSessionId || row.sessionId}`;
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

interface TaskFilterComboboxOption {
  value: string;
  label: string;
  description?: string;
}

function TaskFilterCombobox({
  label,
  placeholder,
  searchPlaceholder,
  loadingText,
  emptyText,
  clearText,
  value,
  options,
  loading,
  onChange,
}: {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  loadingText: string;
  emptyText: string;
  clearText: string;
  value: string;
  options: TaskFilterComboboxOption[];
  loading?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-busy={loading || undefined}
          className="flex min-h-9 h-auto w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border-default bg-background px-3 py-1.5 text-left text-sm text-foreground shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        >
          <span className="min-w-0 truncate">
            {selected ? (
              <>
                <span className="block truncate">{selected.label}</span>
                {selected.description && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {selected.description}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="z-[1000] w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command label={searchPlaceholder}>
          <CommandInput aria-label={label} placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{loading ? loadingText : emptyText}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear_task_filter__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  {clearText}
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={
                    option.description
                      ? [option.label, option.description]
                      : [option.label]
                  }
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${
                      value === option.value ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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

function hasUsageQualityDetails(row: AgentTaskUsageRow) {
  const measures = [row.totalUsage, row.selfUsage, row.descendantUsage];
  return Boolean(
    row.partial ||
      row.warnings.length > 0 ||
      measures.some(
        (measure) =>
          measure?.partial ||
          measure?.warnings.length ||
          (measure?.timeSemantics != null &&
            measure.timeSemantics !== "event_time"),
      ),
  );
}

function hasUsageDetails(row: AgentTaskUsageRow) {
  return row.descendantSessionCount > 0 || hasUsageQualityDetails(row);
}

function UsageDataDetails({
  row,
  t,
}: {
  row: AgentTaskUsageRow;
  t: (key: string, options?: { defaultValue?: string }) => string;
}) {
  const measures = [row.totalUsage, row.selfUsage, row.descendantUsage];
  const partial = Boolean(
    row.partial ||
      row.warnings.length > 0 ||
      measures.some((measure) => measure?.partial || measure?.warnings.length),
  );
  const timeSemantics = measures.find(
    (measure) =>
      measure?.timeSemantics && measure.timeSemantics !== "event_time",
  )?.timeSemantics;

  if (!partial && !timeSemantics) return null;

  return (
    <div
      data-testid={`task-data-details-${rowKey(row)}`}
      className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs text-muted-foreground"
    >
      {partial && (
        <div>
          {t("usage.task.partialHint", {
            defaultValue: "Some usage fields are partial or unavailable.",
          })}
        </div>
      )}
      {timeSemantics === "sync_window_end" && (
        <div className="mt-1">
          {t("usage.task.syncWindowHint", {
            defaultValue: "Sync-window increment; not per-request.",
          })}
        </div>
      )}
      {timeSemantics === "session_time" && (
        <div className="mt-1">
          {t("usage.task.sessionTimeHint", {
            defaultValue: "Usage is aggregated by session time.",
          })}
        </div>
      )}
      {timeSemantics === "unavailable" && (
        <div className="mt-1">
          {t("usage.task.timeUnavailableHint", {
            defaultValue: "Source time is unavailable.",
          })}
        </div>
      )}
    </div>
  );
}

function TaskUsageDetails({
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
  const descendantEvidence = row.descendantSessionCount > 0;
  const qualityDetails = hasUsageQualityDetails(row);

  if (!hasUsageDetails(row)) return null;

  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-1.5 text-xs"
        aria-expanded={expanded}
        aria-controls={`task-details-${key}`}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {descendantEvidence
          ? t("usage.task.viewBreakdown", {
              defaultValue: "Self / descendants",
            })
          : t(
              expanded
                ? "usage.task.dataDetailsClose"
                : "usage.task.dataDetails",
              {
                defaultValue: expanded ? "Hide data details" : "Data details",
              },
            )}
        {descendantEvidence && (
          <span className="text-muted-foreground">
            ({row.descendantSessionCount})
          </span>
        )}
      </Button>
      {expanded && (
        <div
          id={`task-details-${key}`}
          className="mt-2 space-y-2"
          data-testid={`task-details-${key}`}
        >
          {qualityDetails && <UsageDataDetails row={row} t={t} />}
          {descendantEvidence && (
            <div data-testid={`task-breakdown-${key}`} className="space-y-2">
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
    </div>
  );
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
  const title = taskTitle(row, t);
  const titleTooltip = taskTitleTooltip(row);
  const project = taskProject(row);
  const total = row.totalUsage;
  const countLabel = total
    ? requestCountSemanticsLabel(total.requestCountSemantics, t)
    : requestCountSemanticsLabel("unavailable", t);

  return (
    <TableRow data-testid={`task-row-${key}`}>
      <TableCell className="min-w-[220px] max-w-[360px] align-top">
        <div className="truncate font-medium" title={titleTooltip}>
          {title}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {agentLabel(row.appType, t)}
        </div>
      </TableCell>
      <TableCell className="min-w-[200px] max-w-[360px] align-top">
        {project ? (
          <>
            <div className="truncate font-medium" title={project.path}>
              {project.name}
            </div>
            <div
              className="mt-1 break-all text-xs text-muted-foreground"
              title={project.path}
            >
              {project.path}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="min-w-[170px] align-top">
        <div className="font-semibold tabular-nums">
          {taskTokenTotal(total, t)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {t("usage.tokens", { defaultValue: "tokens" })}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {displayCost(total)}
        </div>
        <TaskUsageDetails
          row={row}
          expanded={expanded}
          onToggle={onToggle}
          t={t}
        />
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
  const title = taskTitle(row, t);
  const titleTooltip = taskTitleTooltip(row);
  const project = taskProject(row);
  const total = row.totalUsage;
  const countLabel = total
    ? requestCountSemanticsLabel(total.requestCountSemantics, t)
    : requestCountSemanticsLabel("unavailable", t);

  return (
    <article
      data-testid={`task-row-${key}`}
      className="min-w-0 rounded-lg border border-border/60 bg-card/40 p-3 backdrop-blur-sm"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div
            className="line-clamp-2 break-words font-medium"
            title={titleTooltip}
          >
            {title}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {agentLabel(row.appType, t)}
          </div>
          {project ? (
            <div className="mt-2 min-w-0" title={project.path}>
              <div className="truncate font-medium">{project.name}</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">
                {project.path}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">—</div>
          )}
        </div>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-3 gap-x-4 gap-y-2 border-t border-border/50 pt-3 text-xs">
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
      </div>

      <TaskUsageDetails
        row={row}
        expanded={expanded}
        onToggle={onToggle}
        t={t}
      />
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
      titleExact: title.trim() || undefined,
      projectDirExact: projectDir.trim() || undefined,
      range: queryRange,
      limit: TASK_PAGE_SIZE,
      offset: page * TASK_PAGE_SIZE,
    }),
    [agentAppType, page, projectDir, queryRange, title],
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
  const filterOptionsQuery = useAgentTaskUsageFilterOptions(
    {
      appType: agentAppType === "all" ? undefined : agentAppType,
      range: queryRange,
    },
    {
      refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    },
  );

  const capabilities = capabilitiesQuery.data ?? [];
  const filterOptions = filterOptionsQuery.data;
  const titleOptions = (filterOptions?.titles ?? []).map((value) => ({
    value,
    label: value,
  }));
  const projectOptions = (filterOptions?.projects ?? []).map((option) => ({
    value: option.projectDir,
    label: projectBasename(option.projectDir),
    description: option.projectDir,
  }));

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / TASK_PAGE_SIZE) : 0;

  useEffect(() => {
    setPage(0);
    setExpandedRows([]);
  }, [
    agentAppType,
    projectDir,
    range.customEndDate,
    range.customStartDate,
    range.liveEndTime,
    range.preset,
    title,
  ]);

  useEffect(() => {
    setTitle("");
    setProjectDir("");
  }, [
    agentAppType,
    queryRange.startAt,
    queryRange.endAt,
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
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:min-w-[220px] sm:flex-1">
            <span>{t("usage.task.title", { defaultValue: "Task title" })}</span>
            <TaskFilterCombobox
              label={t("usage.task.title", { defaultValue: "Task title" })}
              placeholder={t("usage.task.selectTitle", {
                defaultValue: "Select task title",
              })}
              searchPlaceholder={t("usage.task.searchTitle", {
                defaultValue: "Search task titles",
              })}
              loadingText={t("usage.task.loadingOptions", {
                defaultValue: "Loading options…",
              })}
              emptyText={t("usage.task.noFilterOptions", {
                defaultValue: "No matching options",
              })}
              clearText={t("usage.task.clearFilter", {
                defaultValue: "Clear selection",
              })}
              value={title}
              options={titleOptions}
              loading={filterOptionsQuery.isLoading}
              onChange={setTitle}
            />
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-muted-foreground sm:min-w-[220px] sm:flex-1">
            <span>{t("usage.task.project", { defaultValue: "Project" })}</span>
            <TaskFilterCombobox
              label={t("usage.task.project", { defaultValue: "Project" })}
              placeholder={t("usage.task.selectProject", {
                defaultValue: "Select project",
              })}
              searchPlaceholder={t("usage.task.searchProject", {
                defaultValue: "Search projects",
              })}
              loadingText={t("usage.task.loadingOptions", {
                defaultValue: "Loading options…",
              })}
              emptyText={t("usage.task.noFilterOptions", {
                defaultValue: "No matching options",
              })}
              clearText={t("usage.task.clearFilter", {
                defaultValue: "Clear selection",
              })}
              value={projectDir}
              options={projectOptions}
              loading={filterOptionsQuery.isLoading}
              onChange={setProjectDir}
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
        {filterOptionsQuery.isError && (
          <p
            className="mt-2 text-xs text-amber-600 dark:text-amber-400"
            role="status"
          >
            {t("usage.task.filterOptionsUnavailable", {
              defaultValue: "Task title and project options are unavailable.",
            })}
          </p>
        )}
        {(isFetching || filterOptionsQuery.isFetching) && !isLoading && (
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
                    <TableHead className="text-right">
                      {t("usage.task.count", { defaultValue: "Count" })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
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
