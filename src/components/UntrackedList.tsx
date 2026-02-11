import { Plus } from "lucide-react";

interface UntrackedListProps {
  title: string;
  items: string[];
  emptyMessage: string;
  onAdd: (item: string) => void;
  onAddAll?: () => void;
}

export function UntrackedList({ title, items, emptyMessage, onAdd, onAddAll }: UntrackedListProps) {
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          {onAddAll && items.length > 1 && (
            <button
              onClick={onAddAll}
              className="w-full mb-2 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add All
            </button>
          )}
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {items.map((item) => (
              <div key={item} className="flex items-center justify-between px-2 py-1 text-sm rounded hover:bg-accent/50">
                <span className="truncate text-xs">{item}</span>
                <button
                  onClick={() => onAdd(item)}
                  className="ml-2 px-2 py-0.5 text-xs rounded border border-border hover:bg-accent transition-colors flex-shrink-0"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
