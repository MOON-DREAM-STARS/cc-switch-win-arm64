import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";

const renderProviderForm = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProviderForm
        appId="claude"
        submitLabel="保存"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        initialData={{
          name: "Test Provider",
          settingsConfig: { env: {}, config: {} },
          category: "custom",
          meta: {
            model_router: {
              routes: [],
            },
          },
        }}
      />
    </QueryClientProvider>,
  );
};

describe("ProviderForm", () => {
  it("does not render the visible extra Meta JSON editor for ordinary providers", () => {
    renderProviderForm();

    expect(screen.queryByText("额外 Meta JSON（可选）")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("额外 Meta JSON（可选）")).not.toBeInTheDocument();
  });
});
