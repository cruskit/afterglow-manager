import { useState } from "react";
import type React from "react";
import type { PhotoEntry } from "../types";
import { useWorkspace } from "../context/WorkspaceContext";
import { cn } from "../lib/utils";

interface ImageTileProps {
  entry: PhotoEntry;
  index: number;
  isSelected: boolean;
  isCover?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function ImageTile({ entry, index, isSelected, isCover, onClick, onContextMenu }: ImageTileProps) {
  const { state, resolveImagePath } = useWorkspace();
  const [imgError, setImgError] = useState(false);
  const src = entry.full ? resolveImagePath(entry.full, state.galleryDetails?.slug) : "";

  return (
    <div
      data-testid={`image-tile-${index}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "relative aspect-[3/2] rounded-lg overflow-hidden cursor-pointer transition-all duration-200",
        "bg-afterglow-surface hover:-translate-y-1 hover:shadow-lg",
        isSelected && "ring-2 ring-afterglow-accent"
      )}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={entry.alt}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-afterglow-text/50 text-sm">
          {entry.alt}
        </div>
      )}
      {isCover && (
        <div className="absolute top-0 right-0 bg-gradient-to-b from-black/70 to-transparent px-3 py-2">
          <span className="text-afterglow-accent text-xs font-medium">Cover</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="text-afterglow-text text-sm truncate">{entry.alt}</span>
      </div>
    </div>
  );
}
