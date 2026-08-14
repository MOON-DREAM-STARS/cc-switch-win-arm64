import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskUsageTable } from "@/components/usage/TaskUsageTable";
import type {
  AgentTaskUsageFilter,
  AgentTaskUsageRow,
  AgentUsageCapability,
  AgentUsageMeasure,
} from "@/types/usage";

const useAgentTaskUsageMock = vi.hoisted(() => vi.fn());
const useAgentUsageCapabilitiesMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("@/lib/query/usage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/query/usage")>(
      "@/lib/query/usage",
    );
  return {
    ...actual,
    useAgentTaskUsage: (...args: unknown[]) => useAgentTaskUsageMock(...args),
    useAgentUsageCapabilities: (...args: unknown[]) =>
      useAgentUsageCapabilitiesMock(...args),
  };
});

const measure = (
  overrides: Partial<AgentUsageMeasure> = {},
): AgentUsageMeasure => ({
  dataSource: "fixture",
  requestCount: 2,
  inputTokens: 3,
  outputTokens: 4,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalCostUsd: "0.001",
  precision: "request_exact",
  timeSemantics: "event_time",
  requestCountSemantics: "assistant_message",
  partial: false,
  warnings: [],
  ...overrides,
});

const row = (
  overrides: Partial<AgentTaskUsageRow> = {},
): AgentTaskUsageRow => ({
  appType: "claude",
  sessionId: "root-session",
  rootSessionId: "root-session",
  root: {
    appType: "claude",
    sessionId: "root-session",
    parentSessionId: null,
    rootSessionId: "root-session",
    nodeKind: "root",
    relationConfidence: "explicit",
    title: "Root task",
    projectDir: "/workspace/project",
    sourcePath: null,
    createdAt: 100,
    lastActiveAt: 200,
    lastSyncedAt: 200,
  },
  selfUsage: measure(),
  descendantUsage: null,
  totalUsage: measure(),
  descendantSessionCount: 0,
  precision: "request_exact",
  partial: false,
  warnings: [],
  sourceDimensions: [],
  ...overrides,
});

const capability = (
  appType: AgentUsageCapability["appType"],
  overrides: Partial<AgentUsageCapability> = {},
): AgentUsageCapability => ({
  appType,
  sessionEnumeration: "supported",
  usageStatus: "supported",
  supportsDescendants: appType === "claude" || appType === "codex",
  tokenStatus: "supported",
  costStatus: "supported",
  precision: "request_exact",
  timeSemantics: "event_time",
  requestCountSemantics: "assistant_message",
  notes: "fixture",
  ...overrides,
});

const installQueryResult = (
  items: AgentTaskUsageRow[],
  total = items.length,
) => {
  useAgentTaskUsageMock.mockReturnValue({
    data: {
      items,
      total,
      limit: 20,
      offset: 0,
      hasMore: total > items.length,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
  });
};

const lastFilter = (): AgentTaskUsageFilter =>
  useAgentTaskUsageMock.mock.calls.at(-1)?.[0] as AgentTaskUsageFilter;

const setContainerWidth = (width: number) => {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", descriptor);
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  };
};

describe("TaskUsageTable", () => {
  beforeEach(() => {
    useAgentTaskUsageMock.mockReset();
    useAgentUsageCapabilitiesMock.mockReset();
    useAgentUsageCapabilitiesMock.mockReturnValue({
      data: [
        capability("claude"),
        capability("codex", {
          requestCountSemantics: "agent_call",
          tokenStatus: "partial",
          costStatus: "partial",
        }),
        capability("hermes", {
          usageStatus: "partial",
          tokenStatus: "partial",
          costStatus: "partial",
          precision: "sync_window_delta",
          timeSemantics: "sync_window_end",
          requestCountSemantics: "unavailable",
        }),
      ],
      isLoading: false,
      isError: false,
    });
    installQueryResult([row()], 21);
  });

  it("passes app, date, title, project and project-dir filters with limit/offset", async () => {
    render(
      <TaskUsageTable
        range={{ preset: "custom", customStartDate: 100, customEndDate: 200 }}
        refreshIntervalMs={0}
      />,
    );

    expect(lastFilter()).toMatchObject({
      range: { startAt: 100, endAt: 200 },
      limit: 20,
      offset: 0,
    });

    fireEvent.change(screen.getByLabelText("Agent"), {
      target: { value: "codex" },
    });
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "build" },
    });
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "cc-switch" },
    });
    fireEvent.change(screen.getByLabelText("Project directory"), {
      target: { value: "/workspace" },
    });

    await waitFor(() =>
      expect(lastFilter()).toMatchObject({
        appType: "codex",
        title: "build",
        project: "cc-switch",
        projectDir: "/workspace",
        range: { startAt: 100, endAt: 200 },
        offset: 0,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(lastFilter()).toMatchObject({ limit: 20, offset: 20 }),
    );
    expect(screen.queryByLabelText("Rows per page")).not.toBeInTheDocument();
  });

  it("renders a complete narrow card without horizontal table clipping", async () => {
    const longTitle =
      "A very long Codex task title that must remain inspectable";
    const longProject =
      "/workspace/cc-switch/projects/a/very/long/project/path";
    installQueryResult([
      row({
        root: {
          ...row().root!,
          title: longTitle,
          projectDir: longProject,
        },
      }),
    ]);

    render(
      <TaskUsageTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("task-usage-cards")).toBeInTheDocument(),
    );
    expect(screen.getByTitle(longTitle)).toBeInTheDocument();
    expect(screen.getByTitle(longProject)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(1);
  });

  it("uses the five-column table only when the container is wide enough", async () => {
    const restoreWidth = setContainerWidth(1400);
    const view = render(
      <TaskUsageTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("task-usage-table")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("task-usage-cards")).not.toBeInTheDocument();
    view.unmount();
    restoreWidth();
  });

  it("keeps one root row for a 100-child aggregate and expands only the compact breakdown", () => {
    const root = row({
      descendantSessionCount: 100,
      descendantUsage: measure({
        inputTokens: 100,
        outputTokens: 200,
        requestCount: 100,
      }),
      totalUsage: measure({
        inputTokens: 103,
        outputTokens: 204,
        requestCount: 102,
      }),
    });
    installQueryResult([root]);

    render(
      <TaskUsageTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );

    expect(screen.getByTestId("task-usage-cards")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(1);
    expect(screen.queryByTestId(/^task-breakdown-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/child session/i)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Self \/ descendants/ }),
    );

    expect(screen.getByTestId(/^task-breakdown-/)).toBeInTheDocument();
    expect(screen.getByText("Self")).toBeInTheDocument();
    expect(screen.getByText("Descendants")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(1);
  });

  it("keeps partial, sync-window and unavailable semantics truthful", () => {
    const partial = row({
      sessionId: "partial",
      rootSessionId: "partial",
      root: {
        ...row().root!,
        sessionId: "partial",
        rootSessionId: "partial",
        title: "Partial task",
      },
      selfUsage: measure({
        inputTokens: 3,
        outputTokens: 4,
        cacheCreationTokens: null,
        totalCostUsd: null,
        requestCountSemantics: "agent_call",
        partial: true,
      }),
      totalUsage: measure({
        inputTokens: 3,
        outputTokens: 4,
        cacheCreationTokens: null,
        totalCostUsd: null,
        requestCountSemantics: "agent_call",
        partial: true,
      }),
      precision: "request_exact",
      partial: true,
    });
    const hermes = row({
      appType: "hermes",
      sessionId: "hermes",
      rootSessionId: "hermes",
      root: {
        ...row().root!,
        appType: "hermes",
        sessionId: "hermes",
        rootSessionId: "hermes",
        title: "Hermes sync window",
      },
      selfUsage: measure({
        inputTokens: 5,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        requestCount: null,
        totalCostUsd: null,
        precision: "sync_window_delta",
        timeSemantics: "sync_window_end",
        requestCountSemantics: "unavailable",
        partial: true,
      }),
      totalUsage: measure({
        inputTokens: 5,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        requestCount: null,
        totalCostUsd: null,
        precision: "sync_window_delta",
        timeSemantics: "sync_window_end",
        requestCountSemantics: "unavailable",
        partial: true,
      }),
      precision: "sync_window_delta",
      partial: true,
    });
    const unavailable = row({
      sessionId: "unavailable",
      rootSessionId: "unavailable",
      root: {
        ...row().root!,
        sessionId: "unavailable",
        rootSessionId: "unavailable",
        title: "Unavailable task",
      },
      selfUsage: null,
      totalUsage: null,
      precision: "unavailable",
      partial: true,
    });
    installQueryResult([partial, hermes, unavailable]);

    render(
      <TaskUsageTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );

    expect(screen.getByText(/7\+/)).toBeInTheDocument();
    expect(screen.getByText("Agent calls")).toBeInTheDocument();
    expect(screen.getAllByText(/Sync-window delta/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Count unavailable/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("HTTP requests")).not.toBeInTheDocument();
  });

  it("renders loading, error and empty states instead of fabricating metrics", () => {
    useAgentTaskUsageMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
    });
    const view = render(
      <TaskUsageTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    useAgentTaskUsageMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("fixture failure"),
      isFetching: false,
    });
    view.rerender(
      <TaskUsageTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load tasks");

    useAgentTaskUsageMock.mockReturnValue({
      data: { items: [], total: 0, limit: 20, offset: 0, hasMore: false },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    view.rerender(
      <TaskUsageTable range={{ preset: "today" }} refreshIntervalMs={0} />,
    );
    expect(
      screen.getByText("No root tasks match these filters."),
    ).toBeInTheDocument();
  });
});
