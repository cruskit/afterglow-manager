import { useCallback } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { GalleryHeader } from "./GalleryHeader";
import { ImageTile } from "./ImageTile";
import { ImageInfoPane } from "./ImageInfoPane";
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
import type { PhotoEntry } from "../types";

interface SortableImageTileProps {
  entry: PhotoEntry;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  id: string;
}

function SortableImageTile({ entry, index, isSelected, onClick, id }: SortableImageTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ImageTile
        entry={entry}
        index={index}
        isSelected={isSelected}
        onClick={onClick}
      />
    </div>
  );
}

export function GalleryDetailView() {
  const { state, dispatch, saveGalleryDetails } = useWorkspace();
  const { galleryDetails, selectedImageIndex } = state;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!galleryDetails) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const fromIndex = galleryDetails.photos.findIndex((_, i) => `image-${i}` === active.id);
      const toIndex = galleryDetails.photos.findIndex((_, i) => `image-${i}` === over.id);

      if (fromIndex !== -1 && toIndex !== -1) {
        dispatch({ type: "REORDER_PHOTOS", fromIndex, toIndex });
        // Update selection to follow the dragged item
        if (selectedImageIndex === fromIndex) {
          dispatch({ type: "SELECT_IMAGE", index: toIndex });
        } else if (selectedImageIndex !== null) {
          let newIndex = selectedImageIndex;
          if (fromIndex < selectedImageIndex && toIndex >= selectedImageIndex) {
            newIndex--;
          } else if (fromIndex > selectedImageIndex && toIndex <= selectedImageIndex) {
            newIndex++;
          }
          if (newIndex !== selectedImageIndex) {
            dispatch({ type: "SELECT_IMAGE", index: newIndex });
          }
        }
        setTimeout(() => saveGalleryDetails(), 50);
      }
    },
    [galleryDetails, selectedImageIndex, dispatch, saveGalleryDetails]
  );

  const handleTileClick = useCallback(
    (index: number) => {
      dispatch({ type: "SELECT_IMAGE", index });
    },
    [dispatch]
  );

  if (!galleryDetails) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading gallery details...
      </div>
    );
  }

  const items = galleryDetails.photos.map((_, i) => `image-${i}`);

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <GalleryHeader />
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
                {galleryDetails.photos.map((entry, i) => (
                  <SortableImageTile
                    key={`image-${i}`}
                    id={`image-${i}`}
                    entry={entry}
                    index={i}
                    isSelected={selectedImageIndex === i}
                    onClick={() => handleTileClick(i)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {galleryDetails.photos.length === 0 && (
            <div className="flex items-center justify-center h-64 text-afterglow-text/50 text-sm">
              No images in this gallery. Add images from the info pane.
            </div>
          )}
        </div>
      </div>
      <ImageInfoPane />
    </div>
  );
}
