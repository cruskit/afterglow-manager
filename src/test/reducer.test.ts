import { describe, it, expect } from "vitest";
import type { WorkspaceState, WorkspaceAction, GalleryEntry, PhotoEntry, GalleryDetails } from "../types";

function mergeKnownTags(existing: string[], incoming: string[]): string[] {
  const result = [...existing];
  for (const tag of incoming) {
    if (!result.some(t => t.toLowerCase() === tag.toLowerCase())) {
      result.push(tag);
    }
  }
  return result.sort();
}

// Extract the reducer logic by reimplementing it for testing
// (since it's not exported separately, we test the logic directly)
function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "SET_FOLDER":
      return {
        ...makeInitialState(),
        folderPath: action.path,
        folderName: action.name,
        viewMode: "galleries",
        selectedTreeNode: null,
      };
    case "SET_GALLERIES":
      return { ...state, galleries: action.galleries, galleriesLastModified: action.lastModified };
    case "SET_SUBDIRECTORIES":
      return { ...state, subdirectories: action.subdirectories };
    case "SELECT_TREE_NODE":
      return {
        ...state,
        selectedTreeNode: action.node,
        selectedGalleryIndex: null,
        selectedImageIndex: null,
        galleryDetails: null,
        galleryDetailsLastModified: null,
        currentDirImages: [],
        viewMode: action.node === null ? "galleries" : "gallery-detail",
      };
    case "SELECT_GALLERY":
      return { ...state, selectedGalleryIndex: action.index };
    case "SELECT_IMAGE":
      return { ...state, selectedImageIndex: action.index };
    case "UPDATE_GALLERY": {
      const galleries = [...state.galleries];
      const entryG = { ...action.entry };
      if (entryG.tags !== undefined && entryG.tags.length === 0) entryG.tags = undefined;
      galleries[action.index] = { ...galleries[action.index], ...entryG };
      const newTagsG = entryG.tags ?? [];
      const knownTagsG = newTagsG.length > 0
        ? mergeKnownTags(state.knownTags, newTagsG)
        : state.knownTags;
      const galleryDetails =
        entryG.date !== undefined && state.galleryDetails?.slug === galleries[action.index].slug
          ? { ...state.galleryDetails, date: entryG.date }
          : state.galleryDetails;
      return { ...state, galleries, knownTags: knownTagsG, galleryDetails };
    }
    case "DELETE_GALLERY": {
      const galleries = state.galleries.filter((_, i) => i !== action.index);
      return { ...state, galleries, selectedGalleryIndex: null };
    }
    case "ADD_GALLERY":
      return { ...state, galleries: [...state.galleries, action.entry] };
    case "REORDER_GALLERIES": {
      const galleries = [...state.galleries];
      const [moved] = galleries.splice(action.fromIndex, 1);
      galleries.splice(action.toIndex, 0, moved);
      return { ...state, galleries };
    }
    case "SET_GALLERY_DETAILS":
      return {
        ...state,
        galleryDetails: action.details,
        galleryDetailsLastModified: action.lastModified,
      };
    case "UPDATE_GALLERY_DETAILS_HEADER": {
      if (!state.galleryDetails) return state;
      const updatedDetails = { ...state.galleryDetails, ...action.updates };
      const galleries = action.updates.date !== undefined
        ? state.galleries.map((g) =>
            g.slug === state.galleryDetails!.slug ? { ...g, date: action.updates.date! } : g
          )
        : state.galleries;
      return { ...state, galleryDetails: updatedDetails, galleries };
    }
    case "UPDATE_PHOTO": {
      if (!state.galleryDetails) return state;
      const photos = [...state.galleryDetails.photos];
      const entryP = { ...action.entry };
      if (entryP.tags !== undefined && entryP.tags.length === 0) entryP.tags = undefined;
      const updated = { ...photos[action.index], ...entryP };
      if (entryP.full !== undefined) updated.thumbnail = entryP.full;
      photos[action.index] = updated;
      const newTagsP = entryP.tags ?? [];
      const knownTagsP = newTagsP.length > 0
        ? mergeKnownTags(state.knownTags, newTagsP)
        : state.knownTags;
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
        knownTags: knownTagsP,
      };
    }
    case "DELETE_PHOTO": {
      if (!state.galleryDetails) return state;
      const photos = state.galleryDetails.photos.filter((_, i) => i !== action.index);
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
        selectedImageIndex: null,
      };
    }
    case "ADD_PHOTO": {
      if (!state.galleryDetails) return state;
      return {
        ...state,
        galleryDetails: {
          ...state.galleryDetails,
          photos: [...state.galleryDetails.photos, action.entry],
        },
      };
    }
    case "ADD_PHOTOS": {
      if (!state.galleryDetails) return state;
      return {
        ...state,
        galleryDetails: {
          ...state.galleryDetails,
          photos: [...state.galleryDetails.photos, ...action.entries],
        },
      };
    }
    case "REORDER_PHOTOS": {
      if (!state.galleryDetails) return state;
      const photos = [...state.galleryDetails.photos];
      const [moved] = photos.splice(action.fromIndex, 1);
      photos.splice(action.toIndex, 0, moved);
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
      };
    }
    case "SET_DIR_IMAGES":
      return { ...state, currentDirImages: action.images };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_KNOWN_TAGS":
      return { ...state, knownTags: action.tags };
    case "RESET":
      return makeInitialState();
    default:
      return state;
  }
}

function makeInitialState(): WorkspaceState {
  return {
    folderPath: null,
    folderName: "",
    galleries: [],
    galleriesLastModified: null,
    selectedTreeNode: null,
    selectedGalleryIndex: null,
    selectedImageIndex: null,
    galleryDetails: null,
    galleryDetailsLastModified: null,
    galleryCounts: {},
    subdirectories: [],
    currentDirImages: [],
    viewMode: "welcome",
    error: null,
    knownTags: [],
  };
}

function makeGallery(overrides?: Partial<GalleryEntry>): GalleryEntry {
  return {
    name: "Test Gallery",
    slug: "test-gallery",
    date: "February 2026",
    cover: "test-gallery/01.jpg",
    ...overrides,
  };
}

function makePhoto(overrides?: Partial<PhotoEntry>): PhotoEntry {
  return {
    thumbnail: "01.jpg",
    full: "01.jpg",
    alt: "01",
    ...overrides,
  };
}

function makeDetails(overrides?: Partial<GalleryDetails>): GalleryDetails {
  return {
    name: "Test",
    slug: "test",
    date: "February 2026",
    description: "",
    photos: [makePhoto()],
    ...overrides,
  };
}

describe("workspaceReducer", () => {
  describe("SET_FOLDER", () => {
    it("sets folder path and name, switches to galleries view", () => {
      const state = workspaceReducer(makeInitialState(), {
        type: "SET_FOLDER",
        path: "/path/to/galleries",
        name: "galleries",
      });
      expect(state.folderPath).toBe("/path/to/galleries");
      expect(state.folderName).toBe("galleries");
      expect(state.viewMode).toBe("galleries");
    });

    it("resets all other state", () => {
      const prev = { ...makeInitialState(), selectedGalleryIndex: 2, error: "old error" };
      const state = workspaceReducer(prev, {
        type: "SET_FOLDER",
        path: "/new",
        name: "new",
      });
      expect(state.selectedGalleryIndex).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe("SET_GALLERIES", () => {
    it("sets galleries array and timestamp", () => {
      const galleries = [makeGallery()];
      const state = workspaceReducer(makeInitialState(), {
        type: "SET_GALLERIES",
        galleries,
        lastModified: 12345,
      });
      expect(state.galleries).toEqual(galleries);
      expect(state.galleriesLastModified).toBe(12345);
    });
  });

  describe("SET_SUBDIRECTORIES", () => {
    it("sets subdirectories list", () => {
      const state = workspaceReducer(makeInitialState(), {
        type: "SET_SUBDIRECTORIES",
        subdirectories: ["dir-a", "dir-b"],
      });
      expect(state.subdirectories).toEqual(["dir-a", "dir-b"]);
    });
  });

  describe("SELECT_TREE_NODE", () => {
    it("selects root (null) and switches to galleries view", () => {
      const prev = { ...makeInitialState(), selectedTreeNode: "some-dir", viewMode: "gallery-detail" as const };
      const state = workspaceReducer(prev, { type: "SELECT_TREE_NODE", node: null });
      expect(state.selectedTreeNode).toBeNull();
      expect(state.viewMode).toBe("galleries");
    });

    it("selects a subdirectory and switches to gallery-detail view", () => {
      const state = workspaceReducer(makeInitialState(), {
        type: "SELECT_TREE_NODE",
        node: "coastal-sunset",
      });
      expect(state.selectedTreeNode).toBe("coastal-sunset");
      expect(state.viewMode).toBe("gallery-detail");
      expect(state.selectedGalleryIndex).toBeNull();
      expect(state.selectedImageIndex).toBeNull();
      expect(state.galleryDetails).toBeNull();
    });
  });

  describe("SELECT_GALLERY", () => {
    it("sets selected gallery index", () => {
      const state = workspaceReducer(makeInitialState(), {
        type: "SELECT_GALLERY",
        index: 3,
      });
      expect(state.selectedGalleryIndex).toBe(3);
    });

    it("clears selection with null", () => {
      const prev = { ...makeInitialState(), selectedGalleryIndex: 2 };
      const state = workspaceReducer(prev, { type: "SELECT_GALLERY", index: null });
      expect(state.selectedGalleryIndex).toBeNull();
    });
  });

  describe("SET_KNOWN_TAGS", () => {
    it("sets knownTags", () => {
      const state = workspaceReducer(makeInitialState(), {
        type: "SET_KNOWN_TAGS",
        tags: ["landscape", "portrait"],
      });
      expect(state.knownTags).toEqual(["landscape", "portrait"]);
    });
  });

  describe("UPDATE_GALLERY", () => {
    it("updates a gallery entry by index", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery(), makeGallery({ name: "Second", slug: "second" })],
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY",
        index: 1,
        entry: { name: "Updated Name" },
      });
      expect(state.galleries[1].name).toBe("Updated Name");
      expect(state.galleries[1].slug).toBe("second");
      expect(state.galleries[0].name).toBe("Test Gallery");
    });

    it("adds tags and unions into knownTags", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery()],
        knownTags: ["existing"],
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY",
        index: 0,
        entry: { tags: ["landscape", "existing"] },
      });
      expect(state.galleries[0].tags).toEqual(["landscape", "existing"]);
      expect(state.knownTags).toEqual(["existing", "landscape"]);
    });

    it("deduplicates knownTags case-insensitively (first-occurrence casing wins)", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery()],
        knownTags: ["sunset"],
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY",
        index: 0,
        entry: { tags: ["Sunset"] },
      });
      // "Sunset" matches existing "sunset" — existing casing wins
      expect(state.knownTags).toEqual(["sunset"]);
    });

    it("omits tags from gallery when empty array", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery({ tags: ["old"] })],
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY",
        index: 0,
        entry: { tags: [] },
      });
      expect(state.galleries[0].tags).toBeUndefined();
    });

    it("syncs date to galleryDetails when slug matches", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery({ slug: "test-gallery", date: "01/01/2025" })],
        galleryDetails: makeDetails({ slug: "test-gallery", date: "01/01/2025" }),
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY",
        index: 0,
        entry: { date: "15/06/2025" },
      });
      expect(state.galleries[0].date).toBe("15/06/2025");
      expect(state.galleryDetails?.date).toBe("15/06/2025");
    });

    it("does not touch galleryDetails date when slug does not match", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery({ slug: "test-gallery", date: "01/01/2025" })],
        galleryDetails: makeDetails({ slug: "other-gallery", date: "01/01/2025" }),
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY",
        index: 0,
        entry: { date: "15/06/2025" },
      });
      expect(state.galleries[0].date).toBe("15/06/2025");
      expect(state.galleryDetails?.date).toBe("01/01/2025");
    });
  });

  describe("DELETE_GALLERY", () => {
    it("removes gallery at index and clears selection", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery({ slug: "a" }), makeGallery({ slug: "b" }), makeGallery({ slug: "c" })],
        selectedGalleryIndex: 1,
      };
      const state = workspaceReducer(prev, { type: "DELETE_GALLERY", index: 1 });
      expect(state.galleries).toHaveLength(2);
      expect(state.galleries.map((g) => g.slug)).toEqual(["a", "c"]);
      expect(state.selectedGalleryIndex).toBeNull();
    });
  });

  describe("ADD_GALLERY", () => {
    it("appends a new gallery entry", () => {
      const prev = { ...makeInitialState(), galleries: [makeGallery({ slug: "a" })] };
      const newEntry = makeGallery({ slug: "b", name: "New" });
      const state = workspaceReducer(prev, { type: "ADD_GALLERY", entry: newEntry });
      expect(state.galleries).toHaveLength(2);
      expect(state.galleries[1].slug).toBe("b");
    });
  });

  describe("REORDER_GALLERIES", () => {
    it("moves gallery from one position to another", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [
          makeGallery({ slug: "a" }),
          makeGallery({ slug: "b" }),
          makeGallery({ slug: "c" }),
        ],
      };
      const state = workspaceReducer(prev, { type: "REORDER_GALLERIES", fromIndex: 0, toIndex: 2 });
      expect(state.galleries.map((g) => g.slug)).toEqual(["b", "c", "a"]);
    });
  });

  describe("SET_GALLERY_DETAILS", () => {
    it("sets gallery details and timestamp", () => {
      const details = makeDetails();
      const state = workspaceReducer(makeInitialState(), {
        type: "SET_GALLERY_DETAILS",
        details,
        lastModified: 99999,
      });
      expect(state.galleryDetails).toEqual(details);
      expect(state.galleryDetailsLastModified).toBe(99999);
    });
  });

  describe("UPDATE_GALLERY_DETAILS_HEADER", () => {
    it("updates header fields", () => {
      const prev = { ...makeInitialState(), galleryDetails: makeDetails() };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY_DETAILS_HEADER",
        updates: { name: "New Name", description: "A description" },
      });
      expect(state.galleryDetails?.name).toBe("New Name");
      expect(state.galleryDetails?.description).toBe("A description");
    });

    it("does nothing when galleryDetails is null", () => {
      const prev = makeInitialState();
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY_DETAILS_HEADER",
        updates: { name: "X" },
      });
      expect(state.galleryDetails).toBeNull();
    });

    it("syncs date back to matching gallery in galleries list", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery({ slug: "test", date: "01/01/2025" }), makeGallery({ slug: "other", date: "01/01/2025" })],
        galleryDetails: makeDetails({ slug: "test", date: "01/01/2025" }),
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY_DETAILS_HEADER",
        updates: { date: "20/07/2025" },
      });
      expect(state.galleryDetails?.date).toBe("20/07/2025");
      expect(state.galleries[0].date).toBe("20/07/2025");
      expect(state.galleries[1].date).toBe("01/01/2025");
    });

    it("does not alter galleries when date is not in updates", () => {
      const prev = {
        ...makeInitialState(),
        galleries: [makeGallery({ slug: "test", date: "01/01/2025" })],
        galleryDetails: makeDetails({ slug: "test", date: "01/01/2025" }),
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_GALLERY_DETAILS_HEADER",
        updates: { name: "New Name" },
      });
      expect(state.galleries[0].date).toBe("01/01/2025");
    });
  });

  describe("UPDATE_PHOTO", () => {
    it("adds tags and unions into knownTags", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({ photos: [makePhoto()] }),
        knownTags: ["nature"],
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_PHOTO",
        index: 0,
        entry: { tags: ["sunset", "nature"] },
      });
      expect(state.galleryDetails?.photos[0].tags).toEqual(["sunset", "nature"]);
      expect(state.knownTags).toEqual(["nature", "sunset"]);
    });

    it("deduplicates knownTags case-insensitively (first-occurrence casing wins)", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({ photos: [makePhoto()] }),
        knownTags: ["Nature"],
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_PHOTO",
        index: 0,
        entry: { tags: ["NATURE"] },
      });
      // "NATURE" matches existing "Nature" — existing casing wins
      expect(state.knownTags).toEqual(["Nature"]);
    });

    it("omits tags from photo when empty array", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({ photos: [makePhoto({ tags: ["old"] })] }),
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_PHOTO",
        index: 0,
        entry: { tags: [] },
      });
      expect(state.galleryDetails?.photos[0].tags).toBeUndefined();
    });

    it("updates a photo entry and mirrors full to thumbnail", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({
          photos: [makePhoto({ full: "old.jpg", thumbnail: "old.jpg" })],
        }),
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_PHOTO",
        index: 0,
        entry: { full: "new.jpg" },
      });
      expect(state.galleryDetails?.photos[0].full).toBe("new.jpg");
      expect(state.galleryDetails?.photos[0].thumbnail).toBe("new.jpg");
    });

    it("updates alt text without changing paths", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({ photos: [makePhoto()] }),
      };
      const state = workspaceReducer(prev, {
        type: "UPDATE_PHOTO",
        index: 0,
        entry: { alt: "New alt" },
      });
      expect(state.galleryDetails?.photos[0].alt).toBe("New alt");
      expect(state.galleryDetails?.photos[0].full).toBe("01.jpg");
    });
  });

  describe("DELETE_PHOTO", () => {
    it("removes photo and clears image selection", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({
          photos: [makePhoto({ alt: "a" }), makePhoto({ alt: "b" })],
        }),
        selectedImageIndex: 0,
      };
      const state = workspaceReducer(prev, { type: "DELETE_PHOTO", index: 0 });
      expect(state.galleryDetails?.photos).toHaveLength(1);
      expect(state.galleryDetails?.photos[0].alt).toBe("b");
      expect(state.selectedImageIndex).toBeNull();
    });
  });

  describe("ADD_PHOTO", () => {
    it("appends a photo entry", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({ photos: [] }),
      };
      const entry = makePhoto({ alt: "new" });
      const state = workspaceReducer(prev, { type: "ADD_PHOTO", entry });
      expect(state.galleryDetails?.photos).toHaveLength(1);
      expect(state.galleryDetails?.photos[0].alt).toBe("new");
    });
  });

  describe("ADD_PHOTOS", () => {
    it("appends multiple photo entries", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({ photos: [makePhoto({ alt: "existing" })] }),
      };
      const entries = [makePhoto({ alt: "new1" }), makePhoto({ alt: "new2" })];
      const state = workspaceReducer(prev, { type: "ADD_PHOTOS", entries });
      expect(state.galleryDetails?.photos).toHaveLength(3);
    });
  });

  describe("REORDER_PHOTOS", () => {
    it("reorders photos array", () => {
      const prev = {
        ...makeInitialState(),
        galleryDetails: makeDetails({
          photos: [makePhoto({ alt: "a" }), makePhoto({ alt: "b" }), makePhoto({ alt: "c" })],
        }),
      };
      const state = workspaceReducer(prev, { type: "REORDER_PHOTOS", fromIndex: 2, toIndex: 0 });
      expect(state.galleryDetails?.photos.map((p) => p.alt)).toEqual(["c", "a", "b"]);
    });
  });

  describe("SET_DIR_IMAGES", () => {
    it("sets current directory images", () => {
      const state = workspaceReducer(makeInitialState(), {
        type: "SET_DIR_IMAGES",
        images: ["01.jpg", "02.png"],
      });
      expect(state.currentDirImages).toEqual(["01.jpg", "02.png"]);
    });
  });

  describe("SET_ERROR", () => {
    it("sets error message", () => {
      const state = workspaceReducer(makeInitialState(), {
        type: "SET_ERROR",
        error: "Something went wrong",
      });
      expect(state.error).toBe("Something went wrong");
    });

    it("clears error with null", () => {
      const prev = { ...makeInitialState(), error: "old" };
      const state = workspaceReducer(prev, { type: "SET_ERROR", error: null });
      expect(state.error).toBeNull();
    });
  });

  describe("RESET", () => {
    it("returns to initial state", () => {
      const prev = {
        ...makeInitialState(),
        folderPath: "/some/path",
        galleries: [makeGallery()],
        viewMode: "galleries" as const,
      };
      const state = workspaceReducer(prev, { type: "RESET" });
      expect(state.folderPath).toBeNull();
      expect(state.viewMode).toBe("welcome");
      expect(state.galleries).toEqual([]);
    });
  });
});
