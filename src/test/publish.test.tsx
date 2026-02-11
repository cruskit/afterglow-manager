import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./test-utils";
import { SettingsDialog } from "../components/SettingsDialog";
import { PublishPreviewDialog } from "../components/PublishPreviewDialog";

// Mock invoke for all tests
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("SettingsDialog", () => {
  const defaultMocks = () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "load_settings":
          return Promise.resolve({
            bucket: "",
            region: "",
            s3Prefix: "galleries/",
            lastValidatedUser: "",
            lastValidatedAccount: "",
            lastValidatedArn: "",
            cloudFrontDistributionId: "",
          });
        case "has_credentials":
          return Promise.resolve(false);
        case "get_credential_hint":
          return Promise.resolve(null);
        default:
          return Promise.resolve(null);
      }
    });
  };

  it("renders nothing when closed", () => {
    const { container } = renderWithProviders(
      <SettingsDialog open={false} onClose={() => {}} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the dialog when open", async () => {
    defaultMocks();
    renderWithProviders(
      <SettingsDialog open={true} onClose={() => {}} />
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Validate")).toBeInTheDocument();
  });

  it("shows credential input fields when no credentials saved", async () => {
    defaultMocks();
    renderWithProviders(
      <SettingsDialog open={true} onClose={() => {}} />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText("AKIAIOSFODNN7EXAMPLE")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")).toBeInTheDocument();
    });
  });

  it("shows masked credentials when credentials exist", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "load_settings":
          return Promise.resolve({
            bucket: "my-bucket",
            region: "us-east-1",
            s3Prefix: "galleries/",
            lastValidatedUser: "AIDA123",
            lastValidatedAccount: "123456789012",
            lastValidatedArn: "arn:aws:iam::123456789012:user/test",
            cloudFrontDistributionId: "",
          });
        case "has_credentials":
          return Promise.resolve(true);
        case "get_credential_hint":
          return Promise.resolve("ABCD");
        default:
          return Promise.resolve(null);
      }
    });

    renderWithProviders(
      <SettingsDialog open={true} onClose={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText("••••••••••••ABCD")).toBeInTheDocument();
      expect(screen.getByText("••••••••••••")).toBeInTheDocument();
      expect(screen.getByText("Change Credentials")).toBeInTheDocument();
    });
  });

  it("shows input fields after clicking Change Credentials", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "load_settings":
          return Promise.resolve({
            bucket: "",
            region: "",
            s3Prefix: "galleries/",
            lastValidatedUser: "",
            lastValidatedAccount: "",
            lastValidatedArn: "",
            cloudFrontDistributionId: "",
          });
        case "has_credentials":
          return Promise.resolve(true);
        case "get_credential_hint":
          return Promise.resolve("ABCD");
        default:
          return Promise.resolve(null);
      }
    });

    renderWithProviders(
      <SettingsDialog open={true} onClose={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText("Change Credentials")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Change Credentials"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("AKIAIOSFODNN7EXAMPLE")).toBeInTheDocument();
    });
  });

  it("shows S3 configuration fields", async () => {
    defaultMocks();
    renderWithProviders(
      <SettingsDialog open={true} onClose={() => {}} />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText("my-gallery-bucket")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("us-east-1")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("galleries/")).toBeInTheDocument();
    });
  });

  it("calls onClose when Cancel is clicked", async () => {
    defaultMocks();
    const onClose = vi.fn();
    renderWithProviders(
      <SettingsDialog open={true} onClose={onClose} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows validation error when fields are empty", async () => {
    defaultMocks();
    renderWithProviders(
      <SettingsDialog open={true} onClose={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText("Validate")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Validate"));

    await waitFor(() => {
      expect(screen.getByTestId("validation-error")).toBeInTheDocument();
    });
  });

  it("shows validation success with identity info", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "load_settings":
          return Promise.resolve({
            bucket: "",
            region: "",
            s3Prefix: "galleries/",
            lastValidatedUser: "AIDA123",
            lastValidatedAccount: "123456789012",
            lastValidatedArn: "arn:aws:iam::123456789012:user/test",
            cloudFrontDistributionId: "",
          });
        case "has_credentials":
          return Promise.resolve(true);
        case "get_credential_hint":
          return Promise.resolve("ABCD");
        default:
          return Promise.resolve(null);
      }
    });

    renderWithProviders(
      <SettingsDialog open={true} onClose={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("validation-success")).toBeInTheDocument();
      expect(screen.getByText("Credentials validated")).toBeInTheDocument();
    });
  });

  it("saves non-credential settings on Save when credentials already exist", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "load_settings") {
        return Promise.resolve({
          bucket: "my-bucket",
          region: "us-east-1",
          s3Prefix: "galleries/",
          lastValidatedUser: "USER",
          lastValidatedAccount: "123",
          lastValidatedArn: "arn",
          cloudFrontDistributionId: "",
        });
      }
      if (cmd === "has_credentials") return Promise.resolve(true);
      if (cmd === "get_credential_hint") return Promise.resolve("ABCD");
      if (cmd === "save_settings") return Promise.resolve();
      return Promise.resolve(null);
    });

    const onClose = vi.fn();
    renderWithProviders(
      <SettingsDialog open={true} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText("Save")).toBeInTheDocument();
      expect(screen.getByText("Save")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", expect.any(Object));
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe("PublishPreviewDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = renderWithProviders(
      <PublishPreviewDialog
        open={false}
        onClose={() => {}}
        folderPath="/test"
        bucket="bucket"
        region="us-east-1"
        prefix="galleries/"
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows loading state when opening", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // Never resolves
    renderWithProviders(
      <PublishPreviewDialog
        open={true}
        onClose={() => {}}
        folderPath="/test"
        bucket="bucket"
        region="us-east-1"
        prefix="galleries/"
      />
    );
    expect(screen.getByText("Publish to S3")).toBeInTheDocument();
    expect(screen.getByText("Scanning files...")).toBeInTheDocument();
  });

  it("shows preview summary after loading", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "publish_preview") {
        return Promise.resolve({
          planId: "test-plan",
          toUpload: [
            { localPath: "/test/photo.jpg", s3Key: "galleries/photo.jpg", sizeBytes: 1024, contentType: "image/jpeg" },
          ],
          toDelete: ["galleries/old.jpg"],
          unchanged: 3,
          totalFiles: 5,
        });
      }
      return Promise.resolve(null);
    });

    renderWithProviders(
      <PublishPreviewDialog
        open={true}
        onClose={() => {}}
        folderPath="/test"
        bucket="bucket"
        region="us-east-1"
        prefix="galleries/"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("preview-summary")).toBeInTheDocument();
    });
    expect(screen.getByText("5 files in workspace")).toBeInTheDocument();
    expect(screen.getByText("new or changed files")).toBeInTheDocument();
    expect(screen.getByText("files to remove from S3")).toBeInTheDocument();
    expect(screen.getByText("files already up to date")).toBeInTheDocument();
    expect(screen.getByText("Publish Now")).toBeInTheDocument();
  });

  it("disables Publish Now when nothing to sync", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "publish_preview") {
        return Promise.resolve({
          planId: "test-plan",
          toUpload: [],
          toDelete: [],
          unchanged: 5,
          totalFiles: 5,
        });
      }
      return Promise.resolve(null);
    });

    renderWithProviders(
      <PublishPreviewDialog
        open={true}
        onClose={() => {}}
        folderPath="/test"
        bucket="bucket"
        region="us-east-1"
        prefix="galleries/"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Everything is up to date. Nothing to sync.")).toBeInTheDocument();
    });
    expect(screen.getByText("Publish Now")).toBeDisabled();
  });

  it("shows error when preview fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "publish_preview") {
        return Promise.reject(new Error("AccessDenied"));
      }
      return Promise.resolve(null);
    });

    renderWithProviders(
      <PublishPreviewDialog
        open={true}
        onClose={() => {}}
        folderPath="/test"
        bucket="bucket"
        region="us-east-1"
        prefix="galleries/"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("publish-error")).toBeInTheDocument();
    });
    expect(screen.getByText("AccessDenied")).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked in preview", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "publish_preview") {
        return Promise.resolve({
          planId: "test-plan",
          toUpload: [{ localPath: "/a", s3Key: "b", sizeBytes: 1, contentType: "image/jpeg" }],
          toDelete: [],
          unchanged: 0,
          totalFiles: 1,
        });
      }
      return Promise.resolve(null);
    });

    const onClose = vi.fn();
    renderWithProviders(
      <PublishPreviewDialog
        open={true}
        onClose={onClose}
        folderPath="/test"
        bucket="bucket"
        region="us-east-1"
        prefix="galleries/"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
