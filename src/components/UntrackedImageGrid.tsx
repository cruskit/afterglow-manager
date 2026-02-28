import { useState } from "react";
import { Plus } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";

interface UntrackedImageGridProps {
  items: string[];
  slug: string;
  onAdd: (filename: string) => void;
  onAddAll: () => void;
}

export function UntrackedImageGrid({ items, slug, onAdd, onAddAll }: UntrackedImageGridProps) {
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <h4 className="text-sm font-semibold mb-2">Untracked Images</h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">All images are tracked.</p>
      ) : (
        <>
          {items.length > 1 && (
            <button
              onClick={onAddAll}
              className="w-full mb-2 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add All
            </button>
          )}
          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {items.map((filename) => (
              <UntrackedImageTile
                key={filename}
                filename={filename}
                slug={slug}
                onAdd={onAdd}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface UntrackedImageTileProps {
  filename: string;
  slug: string;
  onAdd: (filename: string) => void;
}

function UntrackedImageTile({ filename, slug, onAdd }: UntrackedImageTileProps) {
  const { resolveImagePath } = useWorkspace();
  const [imgError, setImgError] = useState(false);
  const src = resolveImagePath(filename, slug);

  return (
    <div
      title={filename}
      tabIndex={0}
      onDoubleClick={() => onAdd(filename)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAdd(filename);
        }
      }}
      className="relative aspect-[3/2] rounded-lg overflow-hidden cursor-pointer bg-afterglow-surface hover:ring-1 ring-afterglow-accent focus:outline-none focus:ring-1"
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={filename}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-afterglow-text/50 text-xs p-1 text-center">
          {filename}
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
        <span className="text-afterglow-text text-xs truncate block">{filename}</span>
      </div>
    </div>
  );
}
