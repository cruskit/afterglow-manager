import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { WorkspaceProvider } from "../context/WorkspaceContext";
import { UpdateProvider } from "../context/UpdateContext";

function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <UpdateProvider>{children}</UpdateProvider>
    </WorkspaceProvider>
  );
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export { render };
