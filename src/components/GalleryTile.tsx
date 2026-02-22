import { useState } from "react";
import type React from "react";
import type { GalleryEntry } from "../types";
import { useWorkspace } from "../context/WorkspaceContext";
import { cn } from "../lib/utils";

interface GalleryTileProps {
  entry: GalleryEntry;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  photoCount?: { tracked: number; total: number };
}

export function GalleryTile({ entry, index, isSelected, onClick, onDoubleClick, onContextMenu, photoCount }: GalleryTileProps) {
  const { resolveImagePath } = useWorkspace();
  const [imgError, setImgError] = useState(false);
  const coverSrc = entry.cover ? resolveImagePath(entry.cover) : "";

  return (
    <div
      data-testid={`gallery-tile-${index}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "relative aspect-[3/2] rounded-lg overflow-hidden cursor-pointer transition-all duration-200",
        "bg-afterglow-surface hover:-translate-y-1 hover:shadow-lg",
        isSelected && "ring-2 ring-afterglow-accent"
      )}
    >
      {coverSrc && !imgError ? (
        <img
          src={coverSrc}
          alt={entry.name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-afterglow-text/50 text-sm">
          {entry.name}
        </div>
      )}
      {photoCount !== undefined && (
        <div className="absolute top-0 right-0 bg-gradient-to-b from-black/70 to-transparent px-3 py-2">
          <span className="text-afterglow-text text-xs">{photoCount.tracked}/{photoCount.total} photos</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 flex justify-between items-end">
        <span className="text-afterglow-text text-sm font-medium truncate">{entry.name}</span>
        <span className="text-afterglow-text/70 text-xs whitespace-nowrap ml-2">{entry.date}</span>
      </div>
    </div>
  );
}
