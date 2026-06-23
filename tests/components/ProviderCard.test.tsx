import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderCard } from "@/components/providers/ProviderCard";
import type { Provider } from "@/types";
import { COMBINED_PROVIDER_ID } from "@/utils/combinedProviderUtils";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: string | { defaultValue?: string },
    ): string => {
      const defaults: Record<string, string> = {
        "common.edit": "Edit",
        "common.delete": "Delete",
        "modelTest.testProvider": "Test model",
        "provider.connectivityCheck": "Connectivity check",
        "provider.configureUsage": "Configure usage",
        "provider.duplicate": "Duplicate",
        "provider.enable": "Enable",
        "provider.inUse": "In use",
        "provider.needsRouting": "Needs routing",
        "provider.blockedByProxy": "Blocked",
      };

      if (key in defaults) return defaults[key];
      if (typeof options === "string") return options;
      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock("@/lib/query/failover", () => ({
  useProviderHealth: () => ({ data: null }),
}));

vi.mock("@/lib/query/queries", () => ({
  useUsageQuery: () => ({ data: null }),
}));

vi.mock("@/components/SubscriptionQuotaFooter", () => ({
  default: () => <div data-testid="subscription-quota" />,
}));

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "provider-1",
    name: "Test Provider",
    settingsConfig: {},
    category: "third_party",
    ...overrides,
  };
}

describe("ProviderCard", () => {
  it("shows a needs-routing badge for managed combined providers", () => {
    const provider = createProvider({
      id: COMBINED_PROVIDER_ID,
      name: "Combined provider",
      settingsConfig: { env: {} },
      meta: {
        providerType: "model_router",
        managedModelRouterProvider: true,
      },
    });

    render(
      <ProviderCard
        provider={provider}
        isCurrent={false}
        appId="gemini"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onConfigureUsage={vi.fn()}
        onOpenWebsite={vi.fn()}
        onDuplicate={vi.fn()}
        onTest={vi.fn()}
        isProxyRunning={true}
      />,
    );

    expect(screen.getByText("Needs routing")).toBeInTheDocument();
  });

  it("keeps managed combined provider actions enabled during proxy takeover", () => {
    const provider = createProvider({
      id: COMBINED_PROVIDER_ID,
      name: "Combined provider",
      settingsConfig: { env: {} },
      meta: {
        providerType: "model_router",
        managedModelRouterProvider: true,
      },
    });
    const onSwitch = vi.fn();
    const onTest = vi.fn();
    const onConfigureUsage = vi.fn();

    const { container } = render(
      <ProviderCard
        provider={provider}
        isCurrent={false}
        appId="claude"
        onSwitch={onSwitch}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onConfigureUsage={onConfigureUsage}
        onOpenWebsite={vi.fn()}
        onDuplicate={vi.fn()}
        onTest={onTest}
        isProxyRunning={true}
        isProxyTakeover={true}
      />,
    );

    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled();

    const testButton = container.querySelector<HTMLButtonElement>(
      'button[title="Connectivity check"]',
    );
    const usageButton = container.querySelector<HTMLButtonElement>(
      'button[title="Configure usage"]',
    );

    expect(testButton).toBeEnabled();
    expect(usageButton).toBeEnabled();

    fireEvent.click(testButton!);
    fireEvent.click(usageButton!);

    expect(onTest).toHaveBeenCalledWith(provider);
    expect(onConfigureUsage).toHaveBeenCalledWith(provider);
  });

  it("keeps ordinary official providers blocked during proxy takeover", () => {
    const provider = createProvider({
      id: "official-claude",
      name: "Claude Official",
      category: "official",
      settingsConfig: { env: {} },
    });

    const { container } = render(
      <ProviderCard
        provider={provider}
        isCurrent={false}
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onConfigureUsage={vi.fn()}
        onOpenWebsite={vi.fn()}
        onDuplicate={vi.fn()}
        onTest={vi.fn()}
        isProxyRunning={true}
        isProxyTakeover={true}
      />,
    );

    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeDisabled();
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[title="Connectivity check"]',
      ),
    ).toHaveClass("cursor-not-allowed");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[title="Configure usage"]',
      ),
    ).toBeEnabled();
  });
});
