import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import { useManagedCombinedProvider } from "@/hooks/useManagedCombinedProvider";
import {
  COMBINED_PROVIDER_ID,
  createManagedCombinedProvider,
} from "@/utils/combinedProviderUtils";

const apiMocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  updateTrayMenu: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  providersApi: {
    add: (...args: unknown[]) => apiMocks.add(...args),
    update: (...args: unknown[]) => apiMocks.update(...args),
    updateTrayMenu: (...args: unknown[]) => apiMocks.updateTrayMenu(...args),
  },
}));

const ordinaryProvider: Provider = {
  id: "ordinary-provider",
  name: "普通 Provider",
  settingsConfig: { env: {} },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

beforeEach(() => {
  apiMocks.add.mockReset().mockResolvedValue(true);
  apiMocks.update.mockReset().mockResolvedValue(true);
  apiMocks.updateTrayMenu.mockReset().mockResolvedValue(true);
});

describe("useManagedCombinedProvider", () => {
  it("creates the managed provider once when enabled and missing", async () => {
    const { wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ providers }) =>
        useManagedCombinedProvider({
          appId: "claude",
          providers,
          enabled: true,
          isLoading: false,
        }),
      {
        wrapper,
        initialProps: {
          providers: { [ordinaryProvider.id]: ordinaryProvider },
        },
      },
    );

    expect(result.current.visibleProviders).toEqual({
      [ordinaryProvider.id]: ordinaryProvider,
      [COMBINED_PROVIDER_ID]: expect.objectContaining({
        id: COMBINED_PROVIDER_ID,
        name: "组合provider",
        meta: expect.objectContaining({
          providerType: "model_router",
          managedModelRouterProvider: true,
        }),
      }),
    });

    await waitFor(() => expect(apiMocks.add).toHaveBeenCalledTimes(1));
    expect(apiMocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: COMBINED_PROVIDER_ID,
        name: "组合provider",
        meta: expect.objectContaining({
          providerType: "model_router",
          managedModelRouterProvider: true,
        }),
      }),
      "claude",
    );

    rerender({ providers: { [ordinaryProvider.id]: ordinaryProvider } });
    await act(async () => {});

    expect(apiMocks.add).toHaveBeenCalledTimes(1);
    expect(result.current.visibleProviders).toEqual({
      [ordinaryProvider.id]: ordinaryProvider,
      [COMBINED_PROVIDER_ID]: expect.objectContaining({
        id: COMBINED_PROVIDER_ID,
        name: "组合provider",
        meta: expect.objectContaining({
          providerType: "model_router",
          managedModelRouterProvider: true,
        }),
      }),
    });
  });

  it("shows an existing managed provider while enabled and hides it while disabled", () => {
    const managed = createManagedCombinedProvider();
    const providers = {
      [ordinaryProvider.id]: ordinaryProvider,
      [managed.id]: managed,
    };
    const { wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useManagedCombinedProvider({
          appId: "claude",
          providers,
          enabled,
          isLoading: false,
        }),
      { wrapper, initialProps: { enabled: true } },
    );

    expect(result.current.visibleProviders[COMBINED_PROVIDER_ID]).toEqual(
      managed,
    );

    rerender({ enabled: false });

    expect(
      result.current.visibleProviders[COMBINED_PROVIDER_ID],
    ).toBeUndefined();
    expect(result.current.visibleProviders[ordinaryProvider.id]).toEqual(
      ordinaryProvider,
    );
  });
});
