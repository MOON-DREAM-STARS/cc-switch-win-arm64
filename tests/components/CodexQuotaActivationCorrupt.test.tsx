import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexOAuthSection } from "@/components/providers/forms/CodexOAuthSection";
import { subscriptionApi } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  useCodexOauth: vi.fn(),
  accountUsers: vi.fn(),
  useCodexQuotaActivationStates: vi.fn(),
}));

vi.mock("@/components/providers/forms/hooks/useCodexOauth", () => ({
  useCodexOauth: mocks.useCodexOauth,
}));
vi.mock("@/components/providers/forms/hooks/useManagedAccountUsers", () => ({
  useManagedAccountUsers: () => mocks.accountUsers,
}));
vi.mock("@/hooks/useCodexQuotaAutoPolling", () => ({
  CODEX_QUOTA_ACTIVATION_STATES_QUERY_KEY: [
    "codex_oauth",
    "quota_activation",
    "states",
  ],
  useCodexQuotaActivationStates: mocks.useCodexQuotaActivationStates,
}));
vi.mock("@/components/CodexOauthAccountQuota", () => ({
  default: () => null,
}));

describe("Codex OAuth activation corrupt-account control", () => {
  beforeEach(() => {
    mocks.accountUsers.mockReset();
    mocks.accountUsers.mockReturnValue([]);
    mocks.useCodexOauth.mockReturnValue({
      accounts: [
        {
          id: "account-corrupt",
          provider: "codex_oauth",
          login: "corrupt@example.com",
          avatar_url: null,
          authenticated_at: 0,
          is_default: true,
          github_domain: "",
          reauth_required: false,
          requires_reauth: false,
        },
      ],
      defaultAccountId: "account-corrupt",
      isStatusSuccess: true,
      isStatusError: false,
      hasAnyAccount: true,
      pollingState: "idle",
      deviceCode: null,
      error: null,
      isPolling: false,
      isAddingAccount: false,
      isRemovingAccount: false,
      isSettingDefaultAccount: false,
      addAccount: vi.fn(),
      reauthAccount: vi.fn(),
      retryAuth: vi.fn(),
      removeAccount: vi.fn(),
      setDefaultAccount: vi.fn(),
      cancelAuth: vi.fn(),
      logout: vi.fn(),
      refetchStatus: vi.fn(),
    });
    mocks.useCodexQuotaActivationStates.mockReturnValue({
      data: [
        {
          accountId: "account-corrupt",
          enabled: false,
          effectiveIntervalMinutes: null,
          authorizationRevision: 7,
          state: { kind: "awaiting_baseline" },
          stateError: "invalid Codex activation state",
          updatedAt: 1,
        },
      ],
      isError: false,
    });
  });

  it("reaches a direct disable action instead of trying to re-enable bad JSON", async () => {
    const user = userEvent.setup();
    const setEnabled = vi
      .spyOn(subscriptionApi, "setCodexQuotaActivationEnabled")
      .mockResolvedValue({
        accountId: "account-corrupt",
        enabled: false,
        authorizationRevision: 8,
        state: { kind: "awaiting_baseline" },
        updatedAt: 2,
      });

    render(<CodexOAuthSection />);
    const toggle = screen.getByRole("switch", {
      name: "关闭损坏账号的自动激活",
    });
    await user.click(toggle);

    expect(setEnabled).toHaveBeenCalledWith(
      "account-corrupt",
      false,
      undefined,
    );
    setEnabled.mockRestore();
  });
});
