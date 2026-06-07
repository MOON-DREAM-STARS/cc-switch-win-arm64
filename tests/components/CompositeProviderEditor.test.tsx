import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const selectProvider = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  providerName: string,
) => {
  const trigger = screen.getByRole("combobox", { name: label });
  await user.click(trigger);
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: providerName }));
  await waitFor(() => expect(trigger).toHaveTextContent(providerName));
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
    const user = userEvent.setup();
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

    await selectProvider(user, "默认模型 Provider", "普通 Provider");
    await user.type(screen.getByLabelText("默认模型 Model"), "stored-default");
    await selectProvider(user, "Sonnet Provider", "普通 Provider");
    await user.type(screen.getByLabelText("Sonnet Model"), "stored-sonnet");
    await user.click(screen.getByRole("button", { name: "保存" }));

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

  it("preserves icon identity fields and saves edited provider identity with model router meta", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const providerWithIdentity: Provider = {
      ...combinedProvider,
      name: "Original Composite",
      notes: "original notes",
      websiteUrl: "https://old.example.com",
      icon: "anthropic",
      iconColor: "#111111",
      meta: {
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
          ],
        },
      },
    };

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={providerWithIdentity}
        providers={{
          [providerWithIdentity.id]: providerWithIdentity,
          [ordinaryProvider.id]: ordinaryProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    await user.clear(screen.getByLabelText("provider.name"));
    await user.type(screen.getByLabelText("provider.name"), "Updated Composite");
    await user.clear(screen.getByLabelText("provider.notes"));
    await user.type(screen.getByLabelText("provider.notes"), "updated notes");
    await user.clear(screen.getByLabelText("provider.websiteUrl"));
    await user.type(
      screen.getByLabelText("provider.websiteUrl"),
      "https://new.example.com",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider).toEqual(
      expect.objectContaining({
        name: "Updated Composite",
        notes: "updated notes",
        websiteUrl: "https://new.example.com",
        icon: "anthropic",
        iconColor: "#111111",
        meta: expect.objectContaining({
          providerType: "model_router",
          managedModelRouterProvider: true,
          modelRouter: {
            version: 1,
            routes: [
              {
                id: "combined-default",
                enabled: true,
                matchType: "default",
                target: {
                  providerId: "ordinary",
                  upstreamModel: "stored-default",
                },
              },
            ],
          },
        }),
      }),
    );
  });

  it("does not submit when a model is entered without selecting a provider", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={combinedProvider}
        providers={{
          [combinedProvider.id]: combinedProvider,
          [ordinaryProvider.id]: ordinaryProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    await user.type(screen.getByLabelText("默认模型 Model"), "stored-default");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
