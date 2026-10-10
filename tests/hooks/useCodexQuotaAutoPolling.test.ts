import { describe, expect, it } from "vitest";
import { mergeNewerCodexQuota } from "@/hooks/useCodexQuotaAutoPolling";
import type { SubscriptionQuota } from "@/types/subscription";

function quota(queriedAt: number, utilization: number): SubscriptionQuota {
  return {
    tool: "codex_oauth",
    credentialStatus: "valid",
    credentialMessage: null,
    success: true,
    tiers: [
      {
        name: "five_hour",
        utilization,
        resetsAt: null,
      },
    ],
    extraUsage: null,
    error: null,
    queriedAt,
  };
}

describe("Codex quota automatic cache ordering", () => {
  it("keeps a newer manual observation when an older automatic response arrives", () => {
    const newer = quota(20, 12);
    const older = quota(0, 80);
    expect(mergeNewerCodexQuota(newer, older)).toBe(newer);
  });

  it("accepts a newer observation and an error timestamp without inventing freshness", () => {
    const older = quota(0, 80);
    const newer = quota(60, 0);
    expect(mergeNewerCodexQuota(older, newer)).toBe(newer);
    expect(mergeNewerCodexQuota(undefined, newer)).toBe(newer);
  });
});
