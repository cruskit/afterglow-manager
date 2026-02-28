import { useCallback } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { DateInput } from "./DateInput";

export function GalleryHeader() {
  const { state, dispatch, debouncedSaveGalleryDetails, debouncedSaveGalleries } = useWorkspace();
  const { galleryDetails } = state;

  const handleChange = useCallback(
    (field: string, value: string) => {
      dispatch({ type: "UPDATE_GALLERY_DETAILS_HEADER", updates: { [field]: value } });
    },
    [dispatch]
  );

  const handleBlur = useCallback(() => {
    debouncedSaveGalleryDetails();
    debouncedSaveGalleries();
  }, [debouncedSaveGalleryDetails, debouncedSaveGalleries]);

  if (!galleryDetails) return null;

  return (
    <div className="bg-background border-b border-border p-4">
      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Name</label>
          <input
            type="text"
            value={galleryDetails.name}
            onChange={(e) => handleChange("name", e.target.value)}
            onBlur={handleBlur}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Date</label>
          <DateInput
            value={galleryDetails.date}
            onChange={(val) => handleChange("date", val)}
            onBlur={handleBlur}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Slug</label>
          <p className="text-sm text-foreground/70 px-3 py-1.5">{galleryDetails.slug}</p>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Description</label>
          <input
            type="text"
            value={galleryDetails.description}
            onChange={(e) => handleChange("description", e.target.value)}
            onBlur={handleBlur}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
    </div>
  );
}
