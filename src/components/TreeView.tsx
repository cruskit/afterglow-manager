import { useState, useEffect } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { cn } from "../lib/utils";
import { FolderOpen, Folder, Settings, Upload } from "lucide-react";
import { hasCredentials, loadSettings } from "../commands";
import type { AppSettings } from "../types";
import { SettingsDialog } from "./SettingsDialog";
import { PublishPreviewDialog } from "./PublishPreviewDialog";

export function TreeView() {
  const { state } = useWorkspace();
  const { dispatch } = useWorkspace();
  const { folderName, subdirectories, selectedTreeNode, folderPath } = state;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [hasCreds, setHasCreds] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    const checkCreds = async () => {
      try {
        const has = await hasCredentials();
        setHasCreds(has);
        if (has) {
          const s = await loadSettings();
          setSettings(s);
        }
      } catch {
        // Ignore errors during initial check
      }
    };
    checkCreds();
  }, [settingsOpen]); // Re-check when settings dialog closes

  const publishEnabled = !!folderPath && hasCreds && !!settings?.lastValidatedUser;

  return (
    <>
      <div className="w-60 min-w-60 h-full border-r border-border bg-background flex flex-col">
        <div className="flex-1 overflow-y-auto p-2">
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

        {/* Sidebar Footer */}
        <div className="border-t border-border p-2 flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-md hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
            title="Settings"
            data-testid="settings-button"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPublishOpen(true)}
            disabled={!publishEnabled}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
              publishEnabled
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
            title={
              publishEnabled
                ? "Publish workspace to S3"
                : "Configure AWS credentials in Settings to publish."
            }
            data-testid="publish-button"
          >
            <Upload className="w-4 h-4" />
            Publish
          </button>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {publishOpen && settings && folderPath && (
        <PublishPreviewDialog
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          folderPath={folderPath}
          bucket={settings.bucket}
          region={settings.region}
          s3Root={settings.s3Prefix}
        />
      )}
    </>
  );
}
