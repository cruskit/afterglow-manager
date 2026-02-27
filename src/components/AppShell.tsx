import { useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspace } from "../context/WorkspaceContext";
import { getAllTags, startWatching, stopWatching, removePhotoFromGalleryDetails } from "../commands";
import { TreeView } from "./TreeView";
import { GalleriesView } from "./GalleriesView";
import { GalleryDetailView } from "./GalleryDetailView";

interface FsChangeEvent {
  kind: string;
  gallerySlug: string | null;
  filename: string | null;
}

export function AppShell() {
  const {
    state,
    loadGalleries,
    loadSubdirectories,
    loadGalleryDetails,
    loadDirImages,
    dispatch,
    debouncedSaveGalleries,
    debouncedSaveGalleryDetails,
    refreshGalleryCount,
  } = useWorkspace();
  const { viewMode, selectedTreeNode } = state;

  const stateRef = useRef(state);
  stateRef.current = state;

  // Load galleries and subdirectories when folder opens
  useEffect(() => {
    if (state.folderPath) {
      loadGalleries();
      loadSubdirectories();
      getAllTags(state.folderPath)
        .then((tags) => dispatch({ type: "SET_KNOWN_TAGS", tags }))
        .catch(() => {});
    }
  }, [state.folderPath, loadGalleries, loadSubdirectories, dispatch]);

  // Load gallery details when a subdirectory is selected
  useEffect(() => {
    if (selectedTreeNode) {
      loadGalleryDetails(selectedTreeNode);
      loadDirImages(selectedTreeNode);
    }
  }, [selectedTreeNode, loadGalleryDetails, loadDirImages]);

  // File system change handler
  const handleFsChange = useCallback(
    (payload: FsChangeEvent) => {
      const s = stateRef.current;
      if (!s.folderPath) return;

      const { kind, gallerySlug: slug, filename } = payload;

      switch (kind) {
        case "dir-created":
          loadSubdirectories();
          break;

        case "dir-removed":
          loadSubdirectories();
          if (slug) {
            const galleryIndex = s.galleries.findIndex((g) => g.slug === slug);
            if (galleryIndex !== -1) {
              dispatch({ type: "DELETE_GALLERY", index: galleryIndex });
              debouncedSaveGalleries();
            }
            if (s.selectedTreeNode === slug) {
              dispatch({ type: "SELECT_TREE_NODE", node: null });
            }
          }
          break;

        case "image-created":
          if (slug && slug === s.selectedTreeNode) {
            loadDirImages(slug);
          }
          if (slug) {
            refreshGalleryCount(slug);
          }
          break;

        case "image-removed":
          if (slug && slug === s.selectedTreeNode) {
            loadDirImages(slug);
            if (s.galleryDetails && filename) {
              const photoIndex = s.galleryDetails.photos.findIndex(
                (p) => p.full.endsWith(filename) || p.thumbnail.endsWith(filename)
              );
              if (photoIndex !== -1) {
                dispatch({ type: "DELETE_PHOTO", index: photoIndex });
                debouncedSaveGalleryDetails();
              }
            }
          } else if (slug && filename) {
            removePhotoFromGalleryDetails(s.folderPath, slug, filename).catch(() => {});
          }
          if (slug) {
            refreshGalleryCount(slug);
          }
          break;
      }
    },
    [
      loadSubdirectories,
      loadDirImages,
      dispatch,
      debouncedSaveGalleries,
      debouncedSaveGalleryDetails,
      refreshGalleryCount,
    ]
  );

  // File system watcher
  useEffect(() => {
    if (!state.folderPath) return;
    startWatching(state.folderPath).catch(() => {});
    const unlistenPromise = listen<FsChangeEvent>("workspace-fs-change", (event) => {
      handleFsChange(event.payload);
    });
    return () => {
      stopWatching().catch(() => {});
      unlistenPromise.then((fn) => fn());
    };
  }, [state.folderPath, handleFsChange]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewMode === "gallery-detail") {
          dispatch({ type: "SELECT_IMAGE", index: null });
        } else if (viewMode === "galleries") {
          dispatch({ type: "SELECT_GALLERY", index: null });
        }
      }
    },
    [viewMode, dispatch]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <TreeView />
      {viewMode === "galleries" && <GalleriesView />}
      {viewMode === "gallery-detail" && <GalleryDetailView />}
    </div>
  );
}
