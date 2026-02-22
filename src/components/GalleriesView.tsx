import React, { useCallback, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { GalleryTile } from "./GalleryTile";
import { GalleryInfoPane } from "./GalleryInfoPane";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GalleryEntry } from "../types";

interface SortableGalleryTileProps {
  entry: GalleryEntry;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  photoCount?: { tracked: number; total: number };
  id: string;
}

function SortableGalleryTile({ entry, index, isSelected, onClick, onDoubleClick, onContextMenu, photoCount, id }: SortableGalleryTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <GalleryTile
        entry={entry}
        index={index}
        isSelected={isSelected}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        photoCount={photoCount}
      />
    </div>
  );
}

export function GalleriesView() {
  const { state, dispatch, saveGalleries } = useWorkspace();
  const { galleries, selectedGalleryIndex } = state;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const fromIndex = galleries.findIndex((_, i) => `gallery-${i}` === active.id);
      const toIndex = galleries.findIndex((_, i) => `gallery-${i}` === over.id);

      if (fromIndex !== -1 && toIndex !== -1) {
        dispatch({ type: "REORDER_GALLERIES", fromIndex, toIndex });
        // Update selection to follow the dragged item
        if (selectedGalleryIndex === fromIndex) {
          dispatch({ type: "SELECT_GALLERY", index: toIndex });
        } else if (selectedGalleryIndex !== null) {
          // Adjust selection if it was shifted by the reorder
          let newIndex = selectedGalleryIndex;
          if (fromIndex < selectedGalleryIndex && toIndex >= selectedGalleryIndex) {
            newIndex--;
          } else if (fromIndex > selectedGalleryIndex && toIndex <= selectedGalleryIndex) {
            newIndex++;
          }
          if (newIndex !== selectedGalleryIndex) {
            dispatch({ type: "SELECT_GALLERY", index: newIndex });
          }
        }
        setTimeout(() => saveGalleries(), 50);
      }
    },
    [galleries, selectedGalleryIndex, dispatch, saveGalleries]
  );

  const handleTileClick = useCallback(
    (index: number) => {
      dispatch({ type: "SELECT_GALLERY", index });
    },
    [dispatch]
  );

  const handleTileDoubleClick = useCallback(
    (index: number) => {
      const gallery = galleries[index];
      if (gallery) {
        dispatch({ type: "SELECT_TREE_NODE", node: gallery.slug });
      }
    },
    [galleries, dispatch]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      dispatch({ type: "SELECT_GALLERY", index });
      setContextMenu({ x: e.clientX, y: e.clientY, index });
    },
    [dispatch]
  );

  const handleOpenFromMenu = useCallback(() => {
    if (!contextMenu) return;
    const gallery = galleries[contextMenu.index];
    if (gallery) {
      dispatch({ type: "SELECT_TREE_NODE", node: gallery.slug });
    }
    setContextMenu(null);
  }, [contextMenu, galleries, dispatch]);

  const handleDeleteFromMenu = useCallback(() => {
    if (!contextMenu) return;
    setConfirmDeleteIndex(contextMenu.index);
    setContextMenu(null);
  }, [contextMenu]);

  const handleConfirmDelete = useCallback(async () => {
    if (confirmDeleteIndex === null) return;
    dispatch({ type: "DELETE_GALLERY", index: confirmDeleteIndex });
    setConfirmDeleteIndex(null);
    setTimeout(() => saveGalleries(), 50);
  }, [confirmDeleteIndex, dispatch, saveGalleries]);

  const items = galleries.map((_, i) => `gallery-${i}`);

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto bg-background p-6">
        {state.error && (
          <div className="mb-4 p-3 bg-destructive/20 text-destructive rounded-md text-sm">
            {state.error}
            <button
              onClick={() => dispatch({ type: "SET_ERROR", error: null })}
              className="ml-2 underline"
            >
              Dismiss
            </button>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={rectSortingStrategy}>
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
              {galleries.map((entry, i) => {
                const liveCount = state.galleryCounts[entry.slug];
                return (
                  <SortableGalleryTile
                    key={`gallery-${i}`}
                    id={`gallery-${i}`}
                    entry={entry}
                    index={i}
                    isSelected={selectedGalleryIndex === i}
                    onClick={() => handleTileClick(i)}
                    onDoubleClick={() => handleTileDoubleClick(i)}
                    onContextMenu={(e) => handleContextMenu(e, i)}
                    photoCount={liveCount}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
        {galleries.length === 0 && !state.error && (
          <div className="flex items-center justify-center h-full text-afterglow-text/50 text-sm">
            No galleries yet. Add subdirectories from the info pane.
          </div>
        )}
      </div>
      <GalleryInfoPane />

      {contextMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
      )}
      {contextMenu && (
        <div
          style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x }}
          className="z-50 bg-background border border-border rounded-md shadow-lg py-1 min-w-36 text-sm"
        >
          <button
            onClick={handleOpenFromMenu}
            className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors"
          >
            Open Gallery
          </button>
          <div className="border-t border-border my-1" />
          <button
            onClick={handleDeleteFromMenu}
            className="w-full text-left px-3 py-1.5 text-destructive hover:bg-muted transition-colors"
          >
            Delete Gallery
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteIndex !== null}
        title="Delete Gallery"
        message={`Delete "${confirmDeleteIndex !== null ? galleries[confirmDeleteIndex]?.name : ""}" from the list of galleries that will be published. This will not delete the files on disk.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteIndex(null)}
      />
    </div>
  );
}
