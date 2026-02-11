import { useEffect, useCallback } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { TreeView } from "./TreeView";
import { GalleriesView } from "./GalleriesView";
import { GalleryDetailView } from "./GalleryDetailView";

export function AppShell() {
  const { state, loadGalleries, loadSubdirectories, loadGalleryDetails, loadDirImages, dispatch } =
    useWorkspace();
  const { viewMode, selectedTreeNode } = state;

  // Load galleries and subdirectories when folder opens
  useEffect(() => {
    if (state.folderPath) {
      loadGalleries();
      loadSubdirectories();
    }
  }, [state.folderPath, loadGalleries, loadSubdirectories]);

  // Load gallery details when a subdirectory is selected
  useEffect(() => {
    if (selectedTreeNode) {
      loadGalleryDetails(selectedTreeNode);
      loadDirImages(selectedTreeNode);
    }
  }, [selectedTreeNode, loadGalleryDetails, loadDirImages]);

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
