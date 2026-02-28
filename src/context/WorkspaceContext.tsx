import React, { createContext, useContext, useReducer, useCallback, useRef } from "react";
import type {
  WorkspaceState,
  WorkspaceAction,
  GalleryEntry,
  GalleryDetails,
  PhotoEntry,
} from "../types";
import {
  openFolderDialog,
  scanDirectory,
  readJsonFile,
  writeJsonFile,
  fileExists,
} from "../commands";
import {
  migrateGalleries,
  migrateGalleryDetails,
  CURRENT_GALLERIES_SCHEMA,
  CURRENT_DETAILS_SCHEMA,
} from "../migrations";
import { convertFileSrc } from "@tauri-apps/api/core";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tiff", "tif"];

function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

function getMonthYear(): string {
  const now = new Date();
  return now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function filenameWithoutExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.substring(0, lastDot) : filename;
}

const initialState: WorkspaceState = {
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

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "SET_FOLDER":
      return {
        ...initialState,
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
      const entry = { ...action.entry };
      if (entry.tags !== undefined && entry.tags.length === 0) {
        entry.tags = undefined;
      }
      galleries[action.index] = { ...galleries[action.index], ...entry };
      const newTags = entry.tags ?? [];
      const knownTags = newTags.length > 0
        ? [...new Set([...state.knownTags, ...newTags])].sort()
        : state.knownTags;
      return { ...state, galleries, knownTags };
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
    case "SET_GALLERY_DETAILS": {
      const slug = action.details.slug;
      const prev = state.galleryCounts[slug];
      return {
        ...state,
        galleryDetails: action.details,
        galleryDetailsLastModified: action.lastModified,
        galleryCounts: prev
          ? { ...state.galleryCounts, [slug]: { ...prev, tracked: action.details.photos.length } }
          : state.galleryCounts,
      };
    }
    case "UPDATE_GALLERY_DETAILS_HEADER":
      if (!state.galleryDetails) return state;
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, ...action.updates },
      };
    case "UPDATE_PHOTO": {
      if (!state.galleryDetails) return state;
      const photos = [...state.galleryDetails.photos];
      const photoEntry = { ...action.entry };
      if (photoEntry.tags !== undefined && photoEntry.tags.length === 0) {
        photoEntry.tags = undefined;
      }
      const updated = { ...photos[action.index], ...photoEntry };
      // Mirror thumbnail = full
      if (photoEntry.full !== undefined) {
        updated.thumbnail = photoEntry.full;
      }
      photos[action.index] = updated;
      const newTags = photoEntry.tags ?? [];
      const knownTags = newTags.length > 0
        ? [...new Set([...state.knownTags, ...newTags])].sort()
        : state.knownTags;
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
        knownTags,
      };
    }
    case "DELETE_PHOTO": {
      if (!state.galleryDetails) return state;
      const photos = state.galleryDetails.photos.filter((_, i) => i !== action.index);
      const slug = state.galleryDetails.slug;
      const prev = state.galleryCounts[slug];
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
        selectedImageIndex: null,
        galleryCounts: prev
          ? { ...state.galleryCounts, [slug]: { ...prev, tracked: photos.length } }
          : state.galleryCounts,
      };
    }
    case "ADD_PHOTO": {
      if (!state.galleryDetails) return state;
      const photos = [...state.galleryDetails.photos, action.entry];
      const slug = state.galleryDetails.slug;
      const prev = state.galleryCounts[slug];
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
        galleryCounts: prev
          ? { ...state.galleryCounts, [slug]: { ...prev, tracked: photos.length } }
          : state.galleryCounts,
      };
    }
    case "ADD_PHOTOS": {
      if (!state.galleryDetails) return state;
      const photos = [...state.galleryDetails.photos, ...action.entries];
      const slug = state.galleryDetails.slug;
      const prev = state.galleryCounts[slug];
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
        galleryCounts: prev
          ? { ...state.galleryCounts, [slug]: { ...prev, tracked: photos.length } }
          : state.galleryCounts,
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
    case "SET_GALLERY_COUNTS":
      return { ...state, galleryCounts: action.counts };
    case "SET_GALLERY_COUNT":
      return {
        ...state,
        galleryCounts: {
          ...state.galleryCounts,
          [action.slug]: { tracked: action.tracked, total: action.total },
        },
      };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_KNOWN_TAGS":
      return { ...state, knownTags: action.tags };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
  openFolder: () => Promise<void>;
  loadGalleries: () => Promise<void>;
  saveGalleries: () => Promise<void>;
  loadGalleryDetails: (slug: string) => Promise<void>;
  saveGalleryDetails: () => Promise<void>;
  loadSubdirectories: () => Promise<void>;
  loadDirImages: (slug: string) => Promise<void>;
  addUntrackedGallery: (dirName: string) => Promise<void>;
  addUntrackedImage: (filename: string) => Promise<void>;
  addAllUntrackedImages: () => Promise<void>;
  resolveImagePath: (jsonPath: string, slug?: string) => string;
  debouncedSaveGalleries: () => void;
  debouncedSaveGalleryDetails: () => void;
  refreshGalleryCount: (slug: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const saveTimerGalleries = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerDetails = useRef<ReturnType<typeof setTimeout> | null>(null);

  const galleriesJsonPath = useCallback(() => {
    return `${stateRef.current.folderPath}/galleries.json`;
  }, []);

  const galleryDetailsJsonPath = useCallback(
    (slug: string) => {
      return `${stateRef.current.folderPath}/${slug}/gallery-details.json`;
    },
    []
  );

  const resolveImagePath = useCallback(
    (jsonPath: string, slug?: string): string => {
      if (!stateRef.current.folderPath) return "";
      // Without slug: jsonPath is relative to workspace root (e.g. "sunset/01.jpg" for covers)
      // With slug: jsonPath is relative to the gallery dir (e.g. "01.jpg" for photos)
      const relativePath = slug ? `${slug}/${jsonPath}` : jsonPath;
      const absPath = `${stateRef.current.folderPath}/${relativePath}`;
      return convertFileSrc(absPath);
    },
    []
  );

  const loadSubdirectories = useCallback(async () => {
    if (!stateRef.current.folderPath) return;
    const listing = await scanDirectory(stateRef.current.folderPath);
    dispatch({ type: "SET_SUBDIRECTORIES", subdirectories: listing.directories });
  }, []);

  const loadDirImages = useCallback(async (slug: string) => {
    if (!stateRef.current.folderPath) return;
    const listing = await scanDirectory(`${stateRef.current.folderPath}/${slug}`);
    dispatch({ type: "SET_DIR_IMAGES", images: listing.images });
  }, []);

  const loadGalleryCounts = useCallback(async (galleries: GalleryEntry[]) => {
    if (!stateRef.current.folderPath) return;
    const counts: Record<string, { tracked: number; total: number }> = {};
    await Promise.all(
      galleries.map(async (g) => {
        try {
          const dirPath = `${stateRef.current.folderPath}/${g.slug}`;
          const [listing, detailsExist] = await Promise.all([
            scanDirectory(dirPath),
            fileExists(`${dirPath}/gallery-details.json`),
          ]);
          const total = listing.images.filter(isImageFile).length;
          let tracked = 0;
          if (detailsExist) {
            const raw = await readJsonFile(`${dirPath}/gallery-details.json`);
            const photos = (raw as { photos?: unknown[] }).photos ?? [];
            tracked = photos.length;
          }
          counts[g.slug] = { tracked, total };
        } catch {
          // If unreadable, omit the count
        }
      })
    );
    dispatch({ type: "SET_GALLERY_COUNTS", counts });
  }, []);

  const refreshGalleryCount = useCallback(async (slug: string) => {
    if (!stateRef.current.folderPath) return;
    try {
      const dirPath = `${stateRef.current.folderPath}/${slug}`;
      const listing = await scanDirectory(dirPath);
      const total = listing.images.filter(isImageFile).length;
      let tracked = 0;
      if (stateRef.current.galleryDetails?.slug === slug) {
        // Use in-memory count to avoid stale disk reads during pending debounced saves
        tracked = stateRef.current.galleryDetails.photos.length;
      } else {
        const detailsExist = await fileExists(`${dirPath}/gallery-details.json`);
        if (detailsExist) {
          const raw = await readJsonFile(`${dirPath}/gallery-details.json`);
          const photos = (raw as { photos?: unknown[] }).photos ?? [];
          tracked = photos.length;
        }
      }
      dispatch({ type: "SET_GALLERY_COUNT", slug, tracked, total });
    } catch {
      // ignore
    }
  }, []);

  const loadGalleries = useCallback(async () => {
    if (!stateRef.current.folderPath) return;
    const path = galleriesJsonPath();
    try {
      const exists = await fileExists(path);
      if (!exists) {
        await writeJsonFile(path, { schemaVersion: CURRENT_GALLERIES_SCHEMA, galleries: [] });
        dispatch({ type: "SET_GALLERIES", galleries: [], lastModified: null });
        return;
      }
      const raw = await readJsonFile(path);
      const { data, migrated } = migrateGalleries(raw);
      if (migrated) {
        await writeJsonFile(path, data);
      }
      dispatch({ type: "SET_GALLERIES", galleries: data.galleries, lastModified: Date.now() });
      loadGalleryCounts(data.galleries);
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: `Failed to read galleries.json: ${e}` });
    }
  }, [galleriesJsonPath, loadGalleryCounts]);

  const saveGalleries = useCallback(async () => {
    if (!stateRef.current.folderPath) return;
    try {
      await writeJsonFile(galleriesJsonPath(), {
        schemaVersion: CURRENT_GALLERIES_SCHEMA,
        galleries: stateRef.current.galleries,
      });
      dispatch({ type: "SET_GALLERIES", galleries: stateRef.current.galleries, lastModified: Date.now() });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: `Failed to save galleries.json: ${e}` });
    }
  }, [galleriesJsonPath]);

  const debouncedSaveGalleries = useCallback(() => {
    if (saveTimerGalleries.current) clearTimeout(saveTimerGalleries.current);
    saveTimerGalleries.current = setTimeout(() => {
      saveGalleries();
    }, 300);
  }, [saveGalleries]);

  const loadGalleryDetails = useCallback(
    async (slug: string) => {
      if (!stateRef.current.folderPath) return;
      const path = galleryDetailsJsonPath(slug);
      try {
        const exists = await fileExists(path);
        if (!exists) {
          // Auto-create with all images in directory
          const listing = await scanDirectory(`${stateRef.current.folderPath}/${slug}`);
          const images = listing.images.filter(isImageFile).sort();
          const details: GalleryDetails = {
            name: slug,
            slug,
            date: getMonthYear(),
            description: "",
            photos: images.map((filename) => ({
              thumbnail: filename,
              full: filename,
              alt: filenameWithoutExtension(filename),
            })),
          };
          await writeJsonFile(path, { schemaVersion: CURRENT_DETAILS_SCHEMA, ...details });
          dispatch({ type: "SET_GALLERY_DETAILS", details, lastModified: Date.now() });
          return;
        }
        const raw = await readJsonFile(path);
        const { data, migrated } = migrateGalleryDetails(raw);
        if (migrated) {
          await writeJsonFile(path, data);
        }
        const { schemaVersion: _, ...details } = data;
        dispatch({ type: "SET_GALLERY_DETAILS", details, lastModified: Date.now() });
      } catch (e) {
        dispatch({ type: "SET_ERROR", error: `Failed to read gallery-details.json: ${e}` });
      }
    },
    [galleryDetailsJsonPath]
  );

  const saveGalleryDetails = useCallback(async () => {
    if (!stateRef.current.folderPath || !stateRef.current.galleryDetails) return;
    const slug = stateRef.current.galleryDetails.slug;
    try {
      await writeJsonFile(galleryDetailsJsonPath(slug), {
        schemaVersion: CURRENT_DETAILS_SCHEMA,
        ...stateRef.current.galleryDetails,
      });
      dispatch({
        type: "SET_GALLERY_DETAILS",
        details: stateRef.current.galleryDetails,
        lastModified: Date.now(),
      });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: `Failed to save gallery-details.json: ${e}` });
    }
  }, [galleryDetailsJsonPath]);

  const debouncedSaveGalleryDetails = useCallback(() => {
    if (saveTimerDetails.current) clearTimeout(saveTimerDetails.current);
    saveTimerDetails.current = setTimeout(() => {
      saveGalleryDetails();
    }, 300);
  }, [saveGalleryDetails]);

  const openFolder = useCallback(async () => {
    const path = await openFolderDialog();
    if (!path) return;
    const name = path.split("/").pop() ?? path.split("\\").pop() ?? path;
    dispatch({ type: "SET_FOLDER", path, name });
  }, []);

  const addUntrackedGallery = useCallback(
    async (dirName: string) => {
      if (!stateRef.current.folderPath) return;

      // Get images in the directory for cover
      const listing = await scanDirectory(`${stateRef.current.folderPath}/${dirName}`);
      const images = listing.images.filter(isImageFile).sort();
      const firstImage = images.length > 0 ? images[0] : "";
      const cover = firstImage ? `${dirName}/${firstImage}` : "";

      const entry: GalleryEntry = {
        name: dirName,
        slug: dirName,
        date: getMonthYear(),
        cover,
      };

      dispatch({ type: "ADD_GALLERY", entry });

      // Save galleries.json immediately
      const updatedGalleries = [...stateRef.current.galleries, entry];
      await writeJsonFile(galleriesJsonPath(), {
        schemaVersion: CURRENT_GALLERIES_SCHEMA,
        galleries: updatedGalleries,
      });
      dispatch({ type: "SET_GALLERIES", galleries: updatedGalleries, lastModified: Date.now() });

      // Create gallery-details.json if it doesn't exist
      const detailsPath = galleryDetailsJsonPath(dirName);
      const detailsExist = await fileExists(detailsPath);
      if (!detailsExist) {
        const details: GalleryDetails = {
          name: dirName,
          slug: dirName,
          date: getMonthYear(),
          description: "",
          photos: images.map((filename) => ({
            thumbnail: filename,
            full: filename,
            alt: filenameWithoutExtension(filename),
          })),
        };
        await writeJsonFile(detailsPath, { schemaVersion: CURRENT_DETAILS_SCHEMA, ...details });
      }

      // Select the newly added gallery
      const newIndex = updatedGalleries.length - 1;
      dispatch({ type: "SELECT_GALLERY", index: newIndex });

      // Refresh subdirectories and initialize badge for the new gallery
      await loadSubdirectories();
      refreshGalleryCount(dirName).catch(() => {});
    },
    [galleriesJsonPath, galleryDetailsJsonPath, loadSubdirectories, refreshGalleryCount]
  );

  const addUntrackedImage = useCallback(
    async (filename: string) => {
      if (!stateRef.current.galleryDetails) return;
      const { slug } = stateRef.current.galleryDetails;
      const entry: PhotoEntry = {
        thumbnail: filename,
        full: filename,
        alt: filenameWithoutExtension(filename),
      };
      dispatch({ type: "ADD_PHOTO", entry });

      // Save immediately - need to get updated state
      const updatedDetails = {
        ...stateRef.current.galleryDetails,
        photos: [...stateRef.current.galleryDetails.photos, entry],
      };
      await writeJsonFile(galleryDetailsJsonPath(slug), {
        schemaVersion: CURRENT_DETAILS_SCHEMA,
        ...updatedDetails,
      });
      dispatch({ type: "SET_GALLERY_DETAILS", details: updatedDetails, lastModified: Date.now() });

      // Select the new image
      const newIndex = updatedDetails.photos.length - 1;
      dispatch({ type: "SELECT_IMAGE", index: newIndex });
    },
    [galleryDetailsJsonPath]
  );

  const addAllUntrackedImages = useCallback(async () => {
    if (!stateRef.current.galleryDetails) return;
    const { slug, photos } = stateRef.current.galleryDetails;

    // Get tracked filenames
    const trackedFilenames = new Set(
      photos.map((p) => p.full.split("/").pop()?.toLowerCase() ?? "")
    );

    // Get untracked
    const untracked = stateRef.current.currentDirImages
      .filter((img) => !trackedFilenames.has(img.toLowerCase()))
      .sort();

    if (untracked.length === 0) return;

    const entries: PhotoEntry[] = untracked.map((filename) => ({
      thumbnail: filename,
      full: filename,
      alt: filenameWithoutExtension(filename),
    }));

    dispatch({ type: "ADD_PHOTOS", entries });

    const updatedDetails = {
      ...stateRef.current.galleryDetails,
      photos: [...stateRef.current.galleryDetails.photos, ...entries],
    };
    await writeJsonFile(galleryDetailsJsonPath(slug), {
      schemaVersion: CURRENT_DETAILS_SCHEMA,
      ...updatedDetails,
    });
    dispatch({ type: "SET_GALLERY_DETAILS", details: updatedDetails, lastModified: Date.now() });

    // Select first newly added
    const firstNewIndex = updatedDetails.photos.length - entries.length;
    dispatch({ type: "SELECT_IMAGE", index: firstNewIndex });
  }, [galleryDetailsJsonPath]);

  const value: WorkspaceContextValue = {
    state,
    dispatch,
    openFolder,
    loadGalleries,
    saveGalleries,
    loadGalleryDetails,
    saveGalleryDetails,
    loadSubdirectories,
    loadDirImages,
    addUntrackedGallery,
    addUntrackedImage,
    addAllUntrackedImages,
    resolveImagePath,
    debouncedSaveGalleries,
    debouncedSaveGalleryDetails,
    refreshGalleryCount,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
