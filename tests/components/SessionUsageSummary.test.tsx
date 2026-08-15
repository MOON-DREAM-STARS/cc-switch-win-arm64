import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionUsageSummary } from "@/components/sessions/SessionUsageSummary";
import type {
  AgentSessionUsageSummary,
  AgentUsageMeasure,
} from "@/types/usage";

const useAgentSessionUsageMock = vi.hoisted(() => vi.fn());

const resizeObserverInstances: TestResizeObserver[] = [];

class TestResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObserverInstances.push(this);
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      typeof options === "string" ? options : (options?.defaultValue ?? key),
    i18n: {
      resolvedLanguage: "en-US",
      language: "en-US",
    },
  }),
}));

vi.mock("@/lib/query/usage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/query/usage")>(
      "@/lib/query/usage",
    );
  return {
    ...actual,
    useAgentSessionUsage: (...args: unknown[]) =>
      useAgentSessionUsageMock(...args),
  };
});

const measure = (
  overrides: Partial<AgentUsageMeasure> = {},
): AgentUsageMeasure => ({
  dataSource: "fixture",
  requestCount: 2,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalCostUsd: "0.01",
  precision: "request_exact",
  timeSemantics: "event_time",
  requestCountSemantics: "assistant_message",
  partial: false,
  warnings: [],
  ...overrides,
});

const summary = (
  overrides: Partial<AgentSessionUsageSummary> = {},
): AgentSessionUsageSummary => {
  const selfUsage = measure();
  return {
    appType: "codex",
    requestedSessionId: "root-session",
    sessionId: "root-session",
    rootSessionId: "root-session",
    rootResolved: true,
    root: null,
    supportsDescendants: false,
    selfUsage,
    descendantUsage: null,
    totalUsage: selfUsage,
    descendantSessionCount: 0,
    precision: selfUsage.precision,
    partial: false,
    warnings: [],
    sourceDimensions: [],
    ...overrides,
  };
};

const renderSummary = (
  sessionId = "root-session",
  detailContainerRef?: { current: HTMLElement | null },
) =>
  render(
    <SessionUsageSummary
      appType="codex"
      sessionId={sessionId}
      detailContainerRef={detailContainerRef}
    />,
  );

const createDetailContainerRef = (width: number, height: number) => {
  const size = { width, height };
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { configurable: true, get: () => size.width },
    clientHeight: { configurable: true, get: () => size.height },
  });

  return {
    ref: { current: container },
    setSize: (nextWidth: number, nextHeight: number) => {
      size.width = nextWidth;
      size.height = nextHeight;
    },
  };
};

describe("SessionUsageSummary", () => {
  beforeEach(() => {
    resizeObserverInstances.length = 0;
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    useAgentSessionUsageMock.mockReset();
    useAgentSessionUsageMock.mockReturnValue({
      data: summary(),
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows self, descendant aggregate, API-derived total, and count without child rows", () => {
    const selfUsage = measure({ inputTokens: 10, outputTokens: 5 });
    const descendantUsage = measure({
      inputTokens: 20,
      outputTokens: 5,
      requestCount: 3,
      requestCountSemantics: "agent_call",
    });
    const totalUsage = measure({
      inputTokens: 30,
      outputTokens: 10,
      requestCount: 5,
      requestCountSemantics: "agent_call",
      totalCostUsd: "0.03",
    });
    useAgentSessionUsageMock.mockReturnValue({
      data: summary({
        supportsDescendants: true,
        selfUsage,
        descendantUsage,
        totalUsage,
        descendantSessionCount: 2,
      }),
      isLoading: false,
      isError: false,
    });

    renderSummary();

    expect(screen.getByText("Task total")).toBeInTheDocument();
    expect(screen.getByTestId("session-usage-total-tokens")).toHaveTextContent(
      "40",
    );
    expect(screen.getByText("This task")).toBeInTheDocument();
    expect(screen.getByText("All descendants (2)")).toBeInTheDocument();
    expect(screen.getAllByText(/agent calls/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Request-exact")).not.toBeInTheDocument();
    expect(screen.queryByText("Precision")).not.toBeInTheDocument();
    expect(screen.queryByTestId("usage-precision")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Data details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/descendant-1|child-1/i)).not.toBeInTheDocument();
  });

  it("hides the descendant aggregate for a self-only source", () => {
    renderSummary();

    expect(screen.getByText("This task")).toBeInTheDocument();
    expect(screen.queryByText("All descendants")).not.toBeInTheDocument();
  });

  it("collapses usage details in a compact detail card and expands them on demand", async () => {
    const detailContainer = createDetailContainerRef(800, 700);
    const selfUsage = measure({ inputTokens: 10, outputTokens: 5 });
    const descendantUsage = measure({ inputTokens: 20, outputTokens: 5 });
    useAgentSessionUsageMock.mockReturnValue({
      data: summary({
        supportsDescendants: true,
        selfUsage,
        descendantUsage,
        totalUsage: measure({ inputTokens: 30, outputTokens: 10 }),
        descendantSessionCount: 1,
      }),
      isLoading: false,
      isError: false,
    });

    renderSummary("compact-session", detailContainer.ref);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Expand usage/ }),
      ).toHaveAttribute("aria-expanded", "false");
    });
    expect(screen.getByTestId("session-usage-total-tokens")).toHaveTextContent(
      "40",
    );
    expect(screen.queryByText("This task")).not.toBeInTheDocument();
    expect(screen.queryByText("All descendants (1)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Expand usage/ }));

    expect(
      screen.getByRole("button", { name: /Collapse usage/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("This task")).toBeInTheDocument();
    expect(screen.getByText("All descendants (1)")).toBeInTheDocument();
  });

  it("resets compact usage after resizing back from a wide detail card", async () => {
    const detailContainer = createDetailContainerRef(1200, 900);
    useAgentSessionUsageMock.mockReturnValue({
      data: summary({
        supportsDescendants: true,
        descendantUsage: measure(),
        descendantSessionCount: 1,
      }),
      isLoading: false,
      isError: false,
    });

    renderSummary("resize-session", detailContainer.ref);
    expect(
      screen.queryByTestId("session-usage-toggle"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("This task")).toBeInTheDocument();

    detailContainer.setSize(800, 700);
    act(() => resizeObserverInstances[0].trigger());

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Expand usage/ }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Expand usage/ }));
    expect(screen.getByText("This task")).toBeInTheDocument();

    detailContainer.setSize(1200, 900);
    act(() => resizeObserverInstances[0].trigger());
    await waitFor(() =>
      expect(
        screen.queryByTestId("session-usage-toggle"),
      ).not.toBeInTheDocument(),
    );

    detailContainer.setSize(800, 700);
    act(() => resizeObserverInstances[0].trigger());
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Expand usage/ }),
      ).toHaveAttribute("aria-expanded", "false");
    });
    expect(screen.queryByText("This task")).not.toBeInTheDocument();
  });

  it("keeps unavailable and partial values distinct from explicit zero and marks sync windows", () => {
    const partialSyncMeasure = measure({
      requestCount: null,
      inputTokens: 12,
      outputTokens: 4,
      cacheCreationTokens: null,
      totalCostUsd: null,
      precision: "sync_window_delta",
      timeSemantics: "sync_window_end",
      requestCountSemantics: "unavailable",
      partial: true,
    });
    useAgentSessionUsageMock.mockReturnValue({
      data: summary({
        selfUsage: partialSyncMeasure,
        totalUsage: partialSyncMeasure,
        precision: "sync_window_delta",
        partial: true,
      }),
      isLoading: false,
      isError: false,
    });

    const view = renderSummary();

    expect(screen.getByTestId("session-usage-total-tokens")).toHaveTextContent(
      "16+",
    );
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("Partial")).not.toBeInTheDocument();
    expect(screen.queryByText("Sync-window delta")).not.toBeInTheDocument();
    const detailsButton = screen.getByRole("button", { name: "Data details" });
    expect(detailsButton).toBeInTheDocument();
    fireEvent.click(detailsButton);
    expect(
      screen.getByText("Some usage fields are partial or unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sync-window increment; not per-request."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/HTTP requests/)).not.toBeInTheDocument();

    const zero = measure({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCostUsd: "0",
      requestCount: 0,
    });
    useAgentSessionUsageMock.mockReturnValue({
      data: summary({ selfUsage: zero, totalUsage: zero }),
      isLoading: false,
      isError: false,
    });
    view.unmount();
    renderSummary("zero-session");

    expect(screen.getAllByText("$0.0000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("keeps the total unavailable when every token component is unknown", () => {
    const unknown = measure({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      totalCostUsd: null,
      partial: true,
    });
    useAgentSessionUsageMock.mockReturnValue({
      data: summary({ selfUsage: unknown, totalUsage: unknown, partial: true }),
      isLoading: false,
      isError: false,
    });

    renderSummary("unknown-session");

    expect(screen.getByTestId("session-usage-total-tokens")).toHaveTextContent(
      "Unavailable",
    );
    const detailsButton = screen.getByRole("button", { name: "Data details" });
    fireEvent.click(detailsButton);
    expect(
      screen.getByText("Some usage fields are partial or unavailable."),
    ).toBeInTheDocument();
  });

  it("does not retain the previous selection while the next query loads", () => {
    useAgentSessionUsageMock.mockReturnValue({
      data: summary(),
      isLoading: false,
      isError: false,
    });
    const view = renderSummary("first-session");
    expect(screen.getByTestId("session-usage-summary")).toBeInTheDocument();

    useAgentSessionUsageMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    view.rerender(
      <SessionUsageSummary appType="codex" sessionId="second-session" />,
    );

    expect(screen.getByTestId("session-usage-loading")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-usage-summary"),
    ).not.toBeInTheDocument();
  });
});
