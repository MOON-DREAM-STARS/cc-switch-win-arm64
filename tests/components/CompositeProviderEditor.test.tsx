import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import { CompositeProviderEditor } from "@/components/providers/CompositeProviderEditor";
import { COMBINED_PROVIDER_ID } from "@/utils/combinedProviderUtils";

vi.mock("@/components/common/FullScreenPanel", () => ({
  FullScreenPanel: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div>
        <h1>{title}</h1>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

const fetchMocks = vi.hoisted(() => ({
  fetchModelsForConfig: vi.fn(),
}));

vi.mock("@/lib/api/model-fetch", () => ({
  fetchModelsForConfig: (...args: unknown[]) =>
    fetchMocks.fetchModelsForConfig(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const combinedProvider: Provider = {
  id: COMBINED_PROVIDER_ID,
  name: "组合provider",
  settingsConfig: { env: {} },
  meta: {
    providerType: "model_router",
    managedModelRouterProvider: true,
    modelRouter: { version: 1, routes: [] },
  },
};

const ordinaryProvider: Provider = {
  id: "ordinary",
  name: "普通 Provider",
  settingsConfig: {
    env: {
      ANTHROPIC_MODEL: "stored-default",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "stored-sonnet",
    },
  },
};

const routerProvider: Provider = {
  id: "router-2",
  name: "Other Router",
  settingsConfig: {},
  meta: { providerType: "model_router" },
};

describe("CompositeProviderEditor", () => {
  beforeEach(() => {
    fetchMocks.fetchModelsForConfig.mockReset();
  });

  it("lists current-app ordinary providers and excludes model routers", () => {
    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={combinedProvider}
        providers={{
          [combinedProvider.id]: combinedProvider,
          [ordinaryProvider.id]: ordinaryProvider,
          [routerProvider.id]: routerProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getAllByText("普通 Provider").length).toBeGreaterThan(0);
    expect(screen.queryByText("Other Router")).not.toBeInTheDocument();
  });

  it("saves default and role mappings as modelRouter routes", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleOpenChange = vi.fn();

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={combinedProvider}
        providers={{
          [combinedProvider.id]: combinedProvider,
          [ordinaryProvider.id]: ordinaryProvider,
        }}
        onOpenChange={handleOpenChange}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("默认模型 Provider"), {
      target: { value: "ordinary" },
    });
    fireEvent.change(screen.getByLabelText("默认模型 Model"), {
      target: { value: "stored-default" },
    });
    fireEvent.change(screen.getByLabelText("Sonnet Provider"), {
      target: { value: "ordinary" },
    });
    fireEvent.change(screen.getByLabelText("Sonnet Model"), {
      target: { value: "stored-sonnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.meta).toEqual(
      expect.objectContaining({
        providerType: "model_router",
        managedModelRouterProvider: true,
        modelRouter: {
          version: 1,
          routes: [
            {
              id: "combined-default",
              enabled: true,
              matchType: "default",
              target: { providerId: "ordinary", upstreamModel: "stored-default" },
            },
            {
              id: "combined-role-sonnet",
              enabled: true,
              matchType: "role",
              matchValue: "sonnet",
              target: { providerId: "ordinary", upstreamModel: "stored-sonnet" },
            },
          ],
        },
      }),
    );
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });
});
