import { useWorkspace } from "../context/WorkspaceContext";
import { cn } from "../lib/utils";
import { FolderOpen, Folder } from "lucide-react";

export function TreeView() {
  const { state, dispatch } = useWorkspace();
  const { folderName, subdirectories, selectedTreeNode } = state;

  return (
    <div className="w-60 min-w-60 h-full border-r border-border bg-background overflow-y-auto">
      <div className="p-2">
        <button
          onClick={() => dispatch({ type: "SELECT_TREE_NODE", node: null })}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors",
            selectedTreeNode === null
              ? "bg-accent text-accent-foreground font-medium"
              : "hover:bg-accent/50"
          )}
        >
          <FolderOpen className="w-4 h-4 text-afterglow-accent flex-shrink-0" />
          <span className="truncate">{folderName}</span>
        </button>
        <div className="ml-2 mt-0.5">
          {subdirectories.map((dir) => (
            <button
              key={dir}
              onClick={() => dispatch({ type: "SELECT_TREE_NODE", node: dir })}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors",
                selectedTreeNode === dir
                  ? "bg-accent text-accent-foreground font-medium"
                  : "hover:bg-accent/50"
              )}
            >
              <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{dir}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
