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

const networkClaudeProvider: Provider = {
  id: "network-claude",
  name: "Network Claude Provider",
  settingsConfig: {
    env: {
      ANTHROPIC_BASE_URL: "https://api.example.com",
      ANTHROPIC_API_KEY: "test-api-key",
    },
  },
};

const compositeProviderWithDefaultNetworkRoute: Provider = {
  ...combinedProvider,
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
          target: { providerId: "network-claude", upstreamModel: "gpt-5.4-mini" },
        },
      ],
    },
  },
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

describe("CompositeProviderEditor", { timeout: 10_000 }, () => {
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

  it("shows fetched default model options from the dropdown arrow and applies a selection", async () => {
    const user = userEvent.setup();
    fetchMocks.fetchModelsForConfig.mockResolvedValue([
      { id: "gpt-5.4-mini", ownedBy: "openai" },
      { id: "gpt-5.4[1M]", ownedBy: "openai" },
      { id: "gpt-5.5", ownedBy: "openai" },
    ]);

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={compositeProviderWithDefaultNetworkRoute}
        providers={{
          [compositeProviderWithDefaultNetworkRoute.id]:
            compositeProviderWithDefaultNetworkRoute,
          [networkClaudeProvider.id]: networkClaudeProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(fetchMocks.fetchModelsForConfig).toHaveBeenCalledWith(
        "https://api.example.com",
        "test-api-key",
        undefined,
        undefined,
      ),
    );
    expect(await screen.findByText("3 models")).toBeInTheDocument();

    const defaultModelInput = screen.getByLabelText("默认模型 Model");
    const defaultModelRow = defaultModelInput.closest("div")?.parentElement;
    expect(defaultModelRow).toBeTruthy();

    const modelDropdownTrigger = within(defaultModelRow as HTMLElement).getByRole(
      "button",
      { name: "默认模型 Model options" },
    );
    await user.click(modelDropdownTrigger);

    expect(await screen.findByRole("menuitem", { name: "gpt-5.4-mini" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "gpt-5.4[1M]" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "gpt-5.5" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "gpt-5.5" }));
    expect(defaultModelInput).toHaveValue("gpt-5.5");
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

  it("loads an existing marked Sonnet route as decoupled UI and preserves the marker on save", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const providerWithMarkedSonnet: Provider = {
      ...combinedProvider,
      meta: {
        providerType: "model_router",
        managedModelRouterProvider: true,
        modelRouter: {
          version: 1,
          routes: [
            {
              id: "combined-role-sonnet",
              enabled: true,
              matchType: "role",
              matchValue: "sonnet",
              target: {
                providerId: "ordinary",
                upstreamModel: "stored-sonnet[1M]",
              },
            },
          ],
        },
      },
    };

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={providerWithMarkedSonnet}
        providers={{
          [providerWithMarkedSonnet.id]: providerWithMarkedSonnet,
          [ordinaryProvider.id]: ordinaryProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    expect(screen.getByLabelText("Sonnet Model")).toHaveValue("stored-sonnet");
    expect(screen.getByRole("checkbox", { name: "Sonnet 1M" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.meta?.modelRouter?.routes).toEqual([
      {
        id: "combined-role-sonnet",
        enabled: true,
        matchType: "role",
        matchValue: "sonnet",
        target: { providerId: "ordinary", upstreamModel: "stored-sonnet[1M]" },
      },
    ]);
  });

  it("checking Sonnet 1M appends the marker without changing the visible model input", async () => {
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

    await selectProvider(user, "Sonnet Provider", "普通 Provider");
    const sonnetModelInput = screen.getByLabelText("Sonnet Model");
    await user.type(sonnetModelInput, "sonnet-model");
    await user.click(screen.getByRole("checkbox", { name: "Sonnet 1M" }));

    expect(sonnetModelInput).toHaveValue("sonnet-model");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.meta?.modelRouter?.routes).toEqual([
      {
        id: "combined-role-sonnet",
        enabled: true,
        matchType: "role",
        matchValue: "sonnet",
        target: { providerId: "ordinary", upstreamModel: "sonnet-model[1M]" },
      },
    ]);
  });

  it("unchecking Sonnet 1M removes the marker", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const providerWithMarkedSonnet: Provider = {
      ...combinedProvider,
      meta: {
        providerType: "model_router",
        managedModelRouterProvider: true,
        modelRouter: {
          version: 1,
          routes: [
            {
              id: "combined-role-sonnet",
              enabled: true,
              matchType: "role",
              matchValue: "sonnet",
              target: {
                providerId: "ordinary",
                upstreamModel: "stored-sonnet[1M]",
              },
            },
          ],
        },
      },
    };

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={providerWithMarkedSonnet}
        providers={{
          [providerWithMarkedSonnet.id]: providerWithMarkedSonnet,
          [ordinaryProvider.id]: ordinaryProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    const sonnetModelInput = screen.getByLabelText("Sonnet Model");
    await user.click(screen.getByRole("checkbox", { name: "Sonnet 1M" }));

    expect(sonnetModelInput).toHaveValue("stored-sonnet");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.meta?.modelRouter?.routes).toEqual([
      {
        id: "combined-role-sonnet",
        enabled: true,
        matchType: "role",
        matchValue: "sonnet",
        target: { providerId: "ordinary", upstreamModel: "stored-sonnet" },
      },
    ]);
  });

  it("declares an auto-detected default model as 1M", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    fetchMocks.fetchModelsForConfig.mockResolvedValue([
      { id: "auto-default", ownedBy: "anthropic" },
      { id: "auto-sonnet", ownedBy: "anthropic" },
    ]);

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={combinedProvider}
        providers={{
          [combinedProvider.id]: combinedProvider,
          [networkClaudeProvider.id]: networkClaudeProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    await waitFor(() => expect(fetchMocks.fetchModelsForConfig).toHaveBeenCalled());
    await selectProvider(user, "默认模型 Provider", "Network Claude Provider");

    const defaultModelInput = screen.getByLabelText("默认模型 Model");
    const defaultModelRow = defaultModelInput.closest("div")?.parentElement;
    expect(defaultModelRow).toBeTruthy();

    await user.click(
      within(defaultModelRow as HTMLElement).getByRole("button", {
        name: "默认模型 Model options",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "auto-default" }));
    await user.click(screen.getByRole("checkbox", { name: "默认模型 1M" }));

    expect(defaultModelInput).toHaveValue("auto-default");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.meta?.modelRouter?.routes).toEqual([
      {
        id: "combined-default",
        enabled: true,
        matchType: "default",
        target: { providerId: "network-claude", upstreamModel: "auto-default[1M]" },
      },
    ]);
  });

  it("shows Haiku 1M control and preserves the marker on save", async () => {
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

    await selectProvider(user, "Haiku Provider", "普通 Provider");
    const haikuModelInput = screen.getByLabelText("Haiku Model");
    await user.type(haikuModelInput, "haiku-model");
    await user.click(screen.getByRole("checkbox", { name: "Haiku 1M" }));

    expect(haikuModelInput).toHaveValue("haiku-model");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.meta?.modelRouter?.routes).toEqual([
      {
        id: "combined-role-haiku",
        enabled: true,
        matchType: "role",
        matchValue: "haiku",
        target: { providerId: "ordinary", upstreamModel: "haiku-model[1M]" },
      },
    ]);
  });

  it("loads an existing marked Haiku route as decoupled UI and preserves the marker on save", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const providerWithMarkedHaiku: Provider = {
      ...combinedProvider,
      meta: {
        providerType: "model_router",
        managedModelRouterProvider: true,
        modelRouter: {
          version: 1,
          routes: [
            {
              id: "combined-role-haiku",
              enabled: true,
              matchType: "role",
              matchValue: "haiku",
              target: {
                providerId: "ordinary",
                upstreamModel: "stored-haiku[1M]",
              },
            },
          ],
        },
      },
    };

    render(
      <CompositeProviderEditor
        open
        appId="claude"
        provider={providerWithMarkedHaiku}
        providers={{
          [providerWithMarkedHaiku.id]: providerWithMarkedHaiku,
          [ordinaryProvider.id]: ordinaryProvider,
        }}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    expect(screen.getByLabelText("Haiku Model")).toHaveValue("stored-haiku");
    expect(screen.getByRole("checkbox", { name: "Haiku 1M" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.meta?.modelRouter?.routes).toEqual([
      {
        id: "combined-role-haiku",
        enabled: true,
        matchType: "role",
        matchValue: "haiku",
        target: { providerId: "ordinary", upstreamModel: "stored-haiku[1M]" },
      },
    ]);
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
