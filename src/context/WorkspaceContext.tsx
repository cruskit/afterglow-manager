import React, { createContext, useContext, useReducer, useCallback, useRef } from "react";
import type {
  WorkspaceState,
  WorkspaceAction,
  GalleryEntry,
  GalleryDetails,
  PhotoEntry,
  GalleriesJson,
} from "../types";
import {
  openFolderDialog,
  scanDirectory,
  readJsonFile,
  writeJsonFile,
  fileExists,
} from "../commands";
import { convertFileSrc } from "@tauri-apps/api/core";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tiff", "tif"];
const GALLERIES_ROOT = "galleries";

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
  subdirectories: [],
  currentDirImages: [],
  viewMode: "welcome",
  error: null,
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
      galleries[action.index] = { ...galleries[action.index], ...action.entry };
      return { ...state, galleries };
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
    case "UPDATE_GALLERY_DETAILS_HEADER":
      if (!state.galleryDetails) return state;
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, ...action.updates },
      };
    case "UPDATE_PHOTO": {
      if (!state.galleryDetails) return state;
      const photos = [...state.galleryDetails.photos];
      const updated = { ...photos[action.index], ...action.entry };
      // Mirror thumbnail = full
      if (action.entry.full !== undefined) {
        updated.thumbnail = action.entry.full;
      }
      photos[action.index] = updated;
      return {
        ...state,
        galleryDetails: { ...state.galleryDetails, photos },
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
  resolveImagePath: (jsonPath: string) => string;
  debouncedSaveGalleries: () => void;
  debouncedSaveGalleryDetails: () => void;
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
    (jsonPath: string): string => {
      if (!stateRef.current.folderPath) return "";
      // jsonPath is e.g. galleries/coastal-sunset/01.jpg
      // Strip the "galleries/" prefix to get the relative path within the workspace
      const prefix = `${GALLERIES_ROOT}/`;
      const relativePath = jsonPath.startsWith(prefix)
        ? jsonPath.slice(prefix.length)
        : jsonPath;
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

  const loadGalleries = useCallback(async () => {
    if (!stateRef.current.folderPath) return;
    const path = galleriesJsonPath();
    try {
      const exists = await fileExists(path);
      if (!exists) {
        await writeJsonFile(path, []);
        dispatch({ type: "SET_GALLERIES", galleries: [], lastModified: null });
        return;
      }
      const data = await readJsonFile(path);
      if (!Array.isArray(data)) {
        dispatch({ type: "SET_ERROR", error: "galleries.json is not a valid array" });
        return;
      }
      dispatch({ type: "SET_GALLERIES", galleries: data as GalleriesJson, lastModified: Date.now() });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: `Failed to read galleries.json: ${e}` });
    }
  }, [galleriesJsonPath]);

  const saveGalleries = useCallback(async () => {
    if (!stateRef.current.folderPath) return;
    try {
      await writeJsonFile(galleriesJsonPath(), stateRef.current.galleries);
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
              thumbnail: `${GALLERIES_ROOT}/${slug}/${filename}`,
              full: `${GALLERIES_ROOT}/${slug}/${filename}`,
              alt: filenameWithoutExtension(filename),
            })),
          };
          await writeJsonFile(path, details);
          dispatch({ type: "SET_GALLERY_DETAILS", details, lastModified: Date.now() });
          return;
        }
        const data = await readJsonFile(path);
        dispatch({ type: "SET_GALLERY_DETAILS", details: data as GalleryDetails, lastModified: Date.now() });
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
      await writeJsonFile(galleryDetailsJsonPath(slug), stateRef.current.galleryDetails);
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
      const cover = firstImage ? `${GALLERIES_ROOT}/${dirName}/${firstImage}` : "";

      const entry: GalleryEntry = {
        name: dirName,
        slug: dirName,
        date: getMonthYear(),
        cover,
      };

      dispatch({ type: "ADD_GALLERY", entry });

      // Save galleries.json immediately
      const updatedGalleries = [...stateRef.current.galleries, entry];
      await writeJsonFile(galleriesJsonPath(), updatedGalleries);
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
            thumbnail: `${GALLERIES_ROOT}/${dirName}/${filename}`,
            full: `${GALLERIES_ROOT}/${dirName}/${filename}`,
            alt: filenameWithoutExtension(filename),
          })),
        };
        await writeJsonFile(detailsPath, details);
      }

      // Select the newly added gallery
      const newIndex = updatedGalleries.length - 1;
      dispatch({ type: "SELECT_GALLERY", index: newIndex });

      // Refresh subdirectories
      await loadSubdirectories();
    },
    [galleriesJsonPath, galleryDetailsJsonPath, loadSubdirectories]
  );

  const addUntrackedImage = useCallback(
    async (filename: string) => {
      if (!stateRef.current.galleryDetails) return;
      const { slug } = stateRef.current.galleryDetails;
      const entry: PhotoEntry = {
        thumbnail: `${GALLERIES_ROOT}/${slug}/${filename}`,
        full: `${GALLERIES_ROOT}/${slug}/${filename}`,
        alt: filenameWithoutExtension(filename),
      };
      dispatch({ type: "ADD_PHOTO", entry });

      // Save immediately - need to get updated state
      const updatedDetails = {
        ...stateRef.current.galleryDetails,
        photos: [...stateRef.current.galleryDetails.photos, entry],
      };
      await writeJsonFile(galleryDetailsJsonPath(slug), updatedDetails);
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
      thumbnail: `${GALLERIES_ROOT}/${slug}/${filename}`,
      full: `${GALLERIES_ROOT}/${slug}/${filename}`,
      alt: filenameWithoutExtension(filename),
    }));

    dispatch({ type: "ADD_PHOTOS", entries });

    const updatedDetails = {
      ...stateRef.current.galleryDetails,
      photos: [...stateRef.current.galleryDetails.photos, ...entries],
    };
    await writeJsonFile(galleryDetailsJsonPath(slug), updatedDetails);
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
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
