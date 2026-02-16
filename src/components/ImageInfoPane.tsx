import { useCallback, useRef, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { UntrackedList } from "./UntrackedList";
import { ConfirmDialog } from "./ConfirmDialog";

export function ImageInfoPane() {
  const {
    state,
    dispatch,
    debouncedSaveGalleryDetails,
    addUntrackedImage,
    addAllUntrackedImages,
    saveGalleryDetails,
    resolveImagePath,
  } = useWorkspace();
  const { galleryDetails, selectedImageIndex, currentDirImages } = state;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const altInputRef = useRef<HTMLInputElement>(null);

  const selectedPhoto =
    galleryDetails && selectedImageIndex !== null
      ? galleryDetails.photos[selectedImageIndex]
      : null;

  // Untracked images
  const trackedFilenames = new Set(
    (galleryDetails?.photos ?? []).map((p) => p.full.split("/").pop()?.toLowerCase() ?? "")
  );
  const untrackedImages = currentDirImages
    .filter((img) => !trackedFilenames.has(img.toLowerCase()))
    .sort();

  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      if (selectedImageIndex === null) return;
      dispatch({ type: "UPDATE_PHOTO", index: selectedImageIndex, entry: { [field]: value } });
    },
    [selectedImageIndex, dispatch]
  );

  const handleBlur = useCallback(() => {
    debouncedSaveGalleryDetails();
  }, [debouncedSaveGalleryDetails]);

  const handleDelete = useCallback(async () => {
    if (selectedImageIndex === null) return;
    dispatch({ type: "DELETE_PHOTO", index: selectedImageIndex });
    setConfirmDelete(false);
    setTimeout(() => saveGalleryDetails(), 50);
  }, [selectedImageIndex, dispatch, saveGalleryDetails]);

  const handleAddUntracked = useCallback(
    async (filename: string) => {
      await addUntrackedImage(filename);
      setTimeout(() => altInputRef.current?.focus(), 100);
    },
    [addUntrackedImage]
  );

  return (
    <div className="w-80 min-w-80 h-full border-l border-border bg-background overflow-y-auto p-4">
      {selectedPhoto ? (
        <>
          <h3 className="text-sm font-semibold mb-4">Image Details</h3>

          <label className="block text-xs text-muted-foreground mb-1">Alt Text</label>
          <input
            ref={altInputRef}
            type="text"
            value={selectedPhoto.alt}
            onChange={(e) => handleFieldChange("alt", e.target.value)}
            onBlur={handleBlur}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background mb-3 focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <label className="block text-xs text-muted-foreground mb-1">Full Image Path</label>
          <input
            type="text"
            value={selectedPhoto.full}
            onChange={(e) => handleFieldChange("full", e.target.value)}
            onBlur={handleBlur}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background mb-3 focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {selectedPhoto.full && (
            <div className="mb-3 rounded-md overflow-hidden border border-border aspect-[3/2]">
              <img
                src={resolveImagePath(selectedPhoto.full, galleryDetails?.slug)}
                alt={selectedPhoto.alt}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}

          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full px-3 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
          >
            Remove Image
          </button>

          <ConfirmDialog
            open={confirmDelete}
            title="Remove Image"
            message="Remove this image from the gallery metadata? The file will remain on disk."
            confirmLabel="Remove"
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Select an image to view details.</p>
      )}

      <UntrackedList
        title="Untracked Images"
        items={untrackedImages}
        emptyMessage="All images are tracked."
        onAdd={handleAddUntracked}
        onAddAll={addAllUntrackedImages}
      />
    </div>
  );
}
