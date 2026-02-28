import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./test-utils";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { UntrackedList } from "../components/UntrackedList";
import { GalleryTile } from "../components/GalleryTile";
import { ImageTile } from "../components/ImageTile";
import { TagInput } from "../components/TagInput";

// Mock invoke for all tests
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("WelcomeScreen", () => {
  it("renders the app title and open folder button", () => {
    renderWithProviders(<WelcomeScreen />);
    expect(screen.getByText("AfterGlowManager")).toBeInTheDocument();
    expect(screen.getByText("Manage your galleries")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
  });

  it("calls openFolder when button is clicked", async () => {
    mockInvoke.mockResolvedValue(null);
    renderWithProviders(<WelcomeScreen />);
    fireEvent.click(screen.getByText("Open Folder"));
    expect(mockInvoke).toHaveBeenCalledWith("open_folder_dialog");
  });
});

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = renderWithProviders(
      <ConfirmDialog
        open={false}
        title="Test"
        message="Test message"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders title and message when open", () => {
    renderWithProviders(
      <ConfirmDialog
        open={true}
        title="Delete Item"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Delete Item")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        open={true}
        title="Test"
        message="Test"
        confirmLabel="Yes, delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Yes, delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        open={true}
        title="Test"
        message="Test"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("uses default confirm label when not specified", () => {
    renderWithProviders(
      <ConfirmDialog
        open={true}
        title="Test"
        message="Test"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });
});

describe("UntrackedList", () => {
  it("shows empty message when no items", () => {
    renderWithProviders(
      <UntrackedList
        title="Untracked Galleries"
        items={[]}
        emptyMessage="All subdirectories are tracked."
        onAdd={() => {}}
      />
    );
    expect(screen.getByText("Untracked Galleries")).toBeInTheDocument();
    expect(screen.getByText("All subdirectories are tracked.")).toBeInTheDocument();
  });

  it("renders items with Add buttons", () => {
    renderWithProviders(
      <UntrackedList
        title="Untracked Galleries"
        items={["dir-a", "dir-b"]}
        emptyMessage="None"
        onAdd={() => {}}
      />
    );
    expect(screen.getByText("dir-a")).toBeInTheDocument();
    expect(screen.getByText("dir-b")).toBeInTheDocument();
    expect(screen.getAllByText("Add")).toHaveLength(2);
  });

  it("calls onAdd with item name when Add is clicked", () => {
    const onAdd = vi.fn();
    renderWithProviders(
      <UntrackedList
        title="Test"
        items={["my-dir"]}
        emptyMessage="None"
        onAdd={onAdd}
      />
    );
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledWith("my-dir");
  });

  it("shows Add All button when multiple items and onAddAll provided", () => {
    const onAddAll = vi.fn();
    renderWithProviders(
      <UntrackedList
        title="Test"
        items={["a", "b"]}
        emptyMessage="None"
        onAdd={() => {}}
        onAddAll={onAddAll}
      />
    );
    expect(screen.getByText("Add All")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add All"));
    expect(onAddAll).toHaveBeenCalledTimes(1);
  });

  it("does not show Add All for single item", () => {
    renderWithProviders(
      <UntrackedList
        title="Test"
        items={["a"]}
        emptyMessage="None"
        onAdd={() => {}}
        onAddAll={() => {}}
      />
    );
    expect(screen.queryByText("Add All")).not.toBeInTheDocument();
  });
});

describe("GalleryTile", () => {
  const defaultEntry = {
    name: "Coastal Sunset",
    slug: "coastal-sunset",
    date: "February 2026",
    cover: "galleries/coastal-sunset/01.jpg",
  };

  it("renders gallery name and date", () => {
    renderWithProviders(
      <GalleryTile
        entry={defaultEntry}
        index={0}
        isSelected={false}
        onClick={() => {}}
        onDoubleClick={() => {}}
      />
    );
    expect(screen.getAllByText("Coastal Sunset").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("February 2026")).toBeInTheDocument();
  });

  it("shows selected ring when isSelected is true", () => {
    renderWithProviders(
      <GalleryTile
        entry={defaultEntry}
        index={0}
        isSelected={true}
        onClick={() => {}}
        onDoubleClick={() => {}}
      />
    );
    const tile = screen.getByTestId("gallery-tile-0");
    expect(tile.className).toContain("ring-2");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    renderWithProviders(
      <GalleryTile
        entry={defaultEntry}
        index={0}
        isSelected={false}
        onClick={onClick}
        onDoubleClick={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("gallery-tile-0"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onDoubleClick when double-clicked", () => {
    const onDoubleClick = vi.fn();
    renderWithProviders(
      <GalleryTile
        entry={defaultEntry}
        index={0}
        isSelected={false}
        onClick={() => {}}
        onDoubleClick={onDoubleClick}
      />
    );
    fireEvent.doubleClick(screen.getByTestId("gallery-tile-0"));
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it("shows placeholder when cover is empty", () => {
    renderWithProviders(
      <GalleryTile
        entry={{ ...defaultEntry, cover: "" }}
        index={0}
        isSelected={false}
        onClick={() => {}}
        onDoubleClick={() => {}}
      />
    );
    // The name should appear as placeholder text inside the tile body
    const tile = screen.getByTestId("gallery-tile-0");
    expect(tile).toBeInTheDocument();
  });
});

describe("TagInput", () => {
  it("renders existing tags as chips", () => {
    renderWithProviders(
      <TagInput tags={["landscape", "nature"]} knownTags={[]} onChange={() => {}} />
    );
    expect(screen.getByText("landscape")).toBeInTheDocument();
    expect(screen.getByText("nature")).toBeInTheDocument();
  });

  it("calls onChange with tag removed when × clicked", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TagInput tags={["landscape", "nature"]} knownTags={[]} onChange={onChange} />
    );
    const removeButtons = screen.getAllByRole("button", { name: /Remove tag/ });
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(["nature"]);
  });

  it("adds tag on Enter key", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TagInput tags={[]} knownTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "sunset" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["sunset"]);
  });

  it("preserves tag case as entered", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TagInput tags={[]} knownTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Wildlife" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Wildlife"]);
  });

  it("reuses canonical casing from knownTags when adding a tag", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TagInput tags={[]} knownTags={["Wildlife"]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "WILDLIFE" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Wildlife"]);
  });

  it("does not add a duplicate tag (case-insensitive)", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TagInput tags={["Wildlife"]} knownTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "wildlife" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows suggestions filtered by input", () => {
    renderWithProviders(
      <TagInput tags={[]} knownTags={["landscape", "sunset", "portrait"]} onChange={() => {}} />
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "sun" } });
    expect(screen.getByText("sunset")).toBeInTheDocument();
    expect(screen.queryByText("landscape")).not.toBeInTheDocument();
  });

  it("does not show already-added tags in suggestions dropdown", () => {
    renderWithProviders(
      <TagInput tags={["landscape"]} knownTags={["landscape", "sunset"]} onChange={() => {}} />
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "land" } });
    // "landscape" appears as a chip but should not appear in the suggestions dropdown list
    const allLandscape = screen.queryAllByText("landscape");
    // Only the chip should contain "landscape", not a dropdown li item
    const inList = allLandscape.filter((el) => el.closest("li"));
    expect(inList).toHaveLength(0);
  });

  it("removes last tag on Backspace when input is empty", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TagInput tags={["landscape", "nature"]} knownTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith(["landscape"]);
  });
});

describe("ImageTile", () => {
  const defaultEntry = {
    thumbnail: "galleries/test/01.jpg",
    full: "galleries/test/01.jpg",
    alt: "Sunset view",
  };

  it("renders alt text", () => {
    renderWithProviders(
      <ImageTile
        entry={defaultEntry}
        index={0}
        isSelected={false}
        onClick={() => {}}
      />
    );
    expect(screen.getAllByText("Sunset view").length).toBeGreaterThanOrEqual(1);
  });

  it("shows selected ring when isSelected is true", () => {
    renderWithProviders(
      <ImageTile
        entry={defaultEntry}
        index={2}
        isSelected={true}
        onClick={() => {}}
      />
    );
    const tile = screen.getByTestId("image-tile-2");
    expect(tile.className).toContain("ring-2");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    renderWithProviders(
      <ImageTile
        entry={defaultEntry}
        index={0}
        isSelected={false}
        onClick={onClick}
      />
    );
    fireEvent.click(screen.getByTestId("image-tile-0"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
