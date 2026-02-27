import { useCallback, useRef, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { UntrackedList } from "./UntrackedList";
import { ConfirmDialog } from "./ConfirmDialog";
import { TagInput } from "./TagInput";

export function GalleryInfoPane() {
  const { state, dispatch, debouncedSaveGalleries, addUntrackedGallery, saveGalleries } = useWorkspace();
  const { galleries, selectedGalleryIndex, subdirectories, knownTags } = state;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const selectedGallery = selectedGalleryIndex !== null ? galleries[selectedGalleryIndex] : null;

  // Untracked galleries: subdirectories not matching any slug
  const trackedSlugs = new Set(galleries.map((g) => g.slug));
  const untrackedGalleries = subdirectories.filter((d) => !trackedSlugs.has(d)).sort();

  const handleFieldChange = useCallback(
    (field: string, value: string) => {
      if (selectedGalleryIndex === null) return;
      dispatch({ type: "UPDATE_GALLERY", index: selectedGalleryIndex, entry: { [field]: value } });
    },
    [selectedGalleryIndex, dispatch]
  );

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      if (selectedGalleryIndex === null) return;
      dispatch({ type: "UPDATE_GALLERY", index: selectedGalleryIndex, entry: { tags } });
      debouncedSaveGalleries();
    },
    [selectedGalleryIndex, dispatch, debouncedSaveGalleries]
  );

  const handleBlur = useCallback(() => {
    debouncedSaveGalleries();
  }, [debouncedSaveGalleries]);

  const handleDelete = useCallback(async () => {
    if (selectedGalleryIndex === null) return;
    dispatch({ type: "DELETE_GALLERY", index: selectedGalleryIndex });
    setConfirmDelete(false);
    // Need to save after delete - use setTimeout to let state update
    setTimeout(() => saveGalleries(), 50);
  }, [selectedGalleryIndex, dispatch, saveGalleries]);

  const handleAddUntracked = useCallback(
    async (dirName: string) => {
      await addUntrackedGallery(dirName);
      // Focus name field after adding
      setTimeout(() => nameInputRef.current?.focus(), 100);
    },
    [addUntrackedGallery]
  );

  return (
    <div className="w-80 min-w-80 h-full border-l border-border bg-background overflow-y-auto p-4">
      {selectedGallery ? (
        <>
          <h3 className="text-sm font-semibold mb-4">Gallery Details</h3>

          <label className="block text-xs text-muted-foreground mb-1">Name</label>
          <input
            ref={nameInputRef}
            type="text"
            value={selectedGallery.name}
            onChange={(e) => handleFieldChange("name", e.target.value)}
            onBlur={handleBlur}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background mb-3 focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <label className="block text-xs text-muted-foreground mb-1">Date</label>
          <input
            type="text"
            value={selectedGallery.date}
            onChange={(e) => handleFieldChange("date", e.target.value)}
            onBlur={handleBlur}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background mb-3 focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <label className="block text-xs text-muted-foreground mb-1">Slug</label>
          <p className="text-sm text-foreground/70 mb-4">{selectedGallery.slug}</p>

          <label className="block text-xs text-muted-foreground mb-1">Tags</label>
          <div className="mb-4">
            <TagInput
              tags={selectedGallery.tags ?? []}
              knownTags={knownTags}
              onChange={handleTagsChange}
            />
          </div>

          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full px-3 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
          >
            Delete Gallery
          </button>

          <ConfirmDialog
            open={confirmDelete}
            title="Delete Gallery"
            message={`Delete "${selectedGallery.name}" from the list of galleries that will be published. This will not delete the files on disk.`}
            confirmLabel="Delete"
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Select a gallery to view details.</p>
      )}

      <UntrackedList
        title="Untracked Galleries"
        items={untrackedGalleries}
        emptyMessage="All subdirectories are tracked."
        onAdd={handleAddUntracked}
      />
    </div>
  );
}
