import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionUsageSummary } from "@/components/sessions/SessionUsageSummary";
import type {
  AgentSessionUsageSummary,
  AgentUsageMeasure,
} from "@/types/usage";

const useAgentSessionUsageMock = vi.hoisted(() => vi.fn());

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

const renderSummary = (sessionId = "root-session") =>
  render(<SessionUsageSummary appType="codex" sessionId={sessionId} />);

describe("SessionUsageSummary", () => {
  beforeEach(() => {
    useAgentSessionUsageMock.mockReset();
    useAgentSessionUsageMock.mockReturnValue({
      data: summary(),
      isLoading: false,
      isError: false,
    });
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
    expect(screen.queryByText(/descendant-1|child-1/i)).not.toBeInTheDocument();
  });

  it("hides the descendant aggregate for a self-only source", () => {
    renderSummary();

    expect(screen.getByText("This task")).toBeInTheDocument();
    expect(screen.queryByText("All descendants")).not.toBeInTheDocument();
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

    renderSummary();

    expect(screen.getByTestId("session-usage-total-tokens")).toHaveTextContent(
      "16+",
    );
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sync-window delta").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Sync-window increment; not per-request.").length,
    ).toBeGreaterThan(0);
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
