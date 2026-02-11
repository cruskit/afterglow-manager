import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { WorkspaceProvider } from "../context/WorkspaceContext";

function AllProviders({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export { render };
