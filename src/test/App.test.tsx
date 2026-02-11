import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./test-utils";
import App from "../App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

describe("App", () => {
  it("renders welcome screen by default", () => {
    renderWithProviders(<App />);
    expect(screen.getByText("AfterGlowManager")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
  });

  it("shows manage your galleries tagline", () => {
    renderWithProviders(<App />);
    expect(screen.getByText("Manage your galleries")).toBeInTheDocument();
  });
});
