import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Loader2, Upload, Trash2, CheckCircle, AlertCircle } from "lucide-react";
import type { PublishPlan, PublishProgress, PublishResult, PublishError, ThumbnailProgress } from "../types";
import { publishPreview, publishExecute, publishCancel } from "../commands";

interface PublishPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  folderPath: string;
  bucket: string;
  region: string;
  s3Root: string;
}

type DialogPhase =
  | { phase: "loading"; status: "thumbnails"; thumbProgress: ThumbnailProgress | null }
  | { phase: "loading"; status: "scanning" }
  | { phase: "preview"; plan: PublishPlan }
  | { phase: "publishing"; plan: PublishPlan; progress: PublishProgress | null; startTime: number }
  | { phase: "complete"; result: PublishResult }
  | { phase: "error"; message: string; file: string; uploaded: number; deleted: number; plan: PublishPlan }
  | { phase: "cancelled"; uploaded: number; deleted: number };

export function PublishPreviewDialog({
  open,
  onClose,
  folderPath,
  bucket,
  region,
  s3Root,
}: PublishPreviewDialogProps) {
  const [state, setState] = useState<DialogPhase>({ phase: "loading", status: "thumbnails", thumbProgress: null });
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const planIdRef = useRef<string | null>(null);

  const loadPreview = useCallback(async () => {
    setState({ phase: "loading", status: "thumbnails", thumbProgress: null });
    try {
      const plan = await publishPreview(folderPath, bucket, region, s3Root);
      planIdRef.current = plan.planId;
      setState({ phase: "preview", plan });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ phase: "error", message, file: "", uploaded: 0, deleted: 0, plan: { planId: "", toUpload: [], toDelete: [], unchanged: 0, totalFiles: 0 } });
    }
  }, [folderPath, bucket, region, s3Root]);

  useEffect(() => {
    if (open) {
      loadPreview();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, loadPreview]);

  useEffect(() => {
    if (!open) return;

    const unlistenThumbnails = listen<ThumbnailProgress>("publish-thumbnail-progress", (event) => {
      const p = event.payload;
      // Transition to scanning when all done (total 0 = nothing to generate, or current reached total)
      if (p.total === 0 || p.current >= p.total) {
        setState((prev) => {
          if (prev.phase !== "loading") return prev;
          return { phase: "loading", status: "scanning" };
        });
      } else {
        setState((prev) => {
          if (prev.phase !== "loading" || prev.status !== "thumbnails") return prev;
          return { phase: "loading", status: "thumbnails", thumbProgress: p };
        });
      }
    });

    const unlistenProgress = listen<PublishProgress>("publish-progress", (event) => {
      setState((prev) => {
        if (prev.phase !== "publishing") return prev;
        return { ...prev, progress: event.payload };
      });
    });

    const unlistenComplete = listen<PublishResult>("publish-complete", (event) => {
      if (timerRef.current) clearInterval(timerRef.current);
      setState({ phase: "complete", result: event.payload });
    });

    const unlistenError = listen<PublishError>("publish-error", (event) => {
      if (timerRef.current) clearInterval(timerRef.current);
      setState((prev) => {
        const plan = prev.phase === "publishing" ? prev.plan : { planId: "", toUpload: [], toDelete: [], unchanged: 0, totalFiles: 0 };
        const progress = prev.phase === "publishing" ? prev.progress : null;
        return {
          phase: "error",
          message: event.payload.error,
          file: event.payload.file,
          uploaded: progress?.current ?? 0,
          deleted: 0,
          plan,
        };
      });
    });

    return () => {
      unlistenThumbnails.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [open]);

  const handlePublish = async () => {
    if (state.phase !== "preview") return;
    const plan = state.plan;
    const startTime = Date.now();
    setState({ phase: "publishing", plan, progress: null, startTime });
    setElapsed(0);

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      await publishExecute(plan.planId);
    } catch (e) {
      if (timerRef.current) clearInterval(timerRef.current);
      const message = e instanceof Error ? e.message : String(e);
      setState({ phase: "error", message, file: "", uploaded: 0, deleted: 0, plan });
    }
  };

  const handleCancel = async () => {
    if (planIdRef.current) {
      await publishCancel(planIdRef.current);
    }
  };

  const handleRetry = () => {
    if (state.phase === "error" && state.plan.planId) {
      const plan = state.plan;
      const startTime = Date.now();
      setState({ phase: "publishing", plan, progress: null, startTime });
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      publishExecute(plan.planId).catch((e) => {
        if (timerRef.current) clearInterval(timerRef.current);
        const message = e instanceof Error ? e.message : String(e);
        setState({ phase: "error", message, file: "", uploaded: 0, deleted: 0, plan });
      });
    }
  };

  const formatElapsed = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!open) return null;

  const canDismiss = state.phase !== "publishing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={canDismiss ? onClose : undefined}
      />
      <div className="relative bg-background border border-border rounded-lg shadow-lg p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold mb-4">Publish to S3</h2>

        {state.phase === "loading" && (
          <div className="py-4">
            {state.status === "thumbnails" ? (
              state.thumbProgress ? (
                <>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">
                      Generating thumbnails ({state.thumbProgress.current}/{state.thumbProgress.total})
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 mb-3">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.round((state.thumbProgress.current / state.thumbProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {state.thumbProgress.filename}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-4 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Generating thumbnails...</span>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center py-4 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Scanning files...</span>
              </div>
            )}
          </div>
        )}

        {state.phase === "preview" && (
          <div>
            <div className="space-y-2 mb-6" data-testid="preview-summary">
              <div className="text-sm">
                <span className="text-muted-foreground">Total files:</span>{" "}
                <span className="font-medium">{state.plan.totalFiles} files in workspace</span>
              </div>
              <div className="text-sm flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-medium">{state.plan.toUpload.length}</span>{" "}
                <span className="text-muted-foreground">new or changed files</span>
              </div>
              <div className="text-sm flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                <span className="font-medium">{state.plan.toDelete.length}</span>{" "}
                <span className="text-muted-foreground">files to remove from S3</span>
              </div>
              <div className="text-sm flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                <span className="font-medium">{state.plan.unchanged}</span>{" "}
                <span className="text-muted-foreground">files already up to date</span>
              </div>
            </div>

            {state.plan.toUpload.length === 0 && state.plan.toDelete.length === 0 ? (
              <div className="text-sm text-muted-foreground mb-6">
                Everything is up to date. Nothing to sync.
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={state.plan.toUpload.length === 0 && state.plan.toDelete.length === 0}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                Publish Now
              </button>
            </div>
          </div>
        )}

        {state.phase === "publishing" && (
          <div>
            <div className="mb-4">
              {state.progress && (
                <>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">
                      {state.progress.current} / {state.progress.total} files
                    </span>
                    <span className="text-muted-foreground">{formatElapsed(elapsed)}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 mb-3">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.round((state.progress.current / state.progress.total) * 100)}%`,
                      }}
                      role="progressbar"
                      aria-valuenow={state.progress.current}
                      aria-valuemin={0}
                      aria-valuemax={state.progress.total}
                    />
                  </div>
                  <div className="text-sm text-muted-foreground truncate" data-testid="current-file">
                    {state.progress.action === "invalidate" ? "Invalidating CloudFront cache..." : state.progress.action === "upload" ? "Uploading" : "Deleting"}{" "}
                    {state.progress.file}
                  </div>
                </>
              )}
              {!state.progress && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Starting...
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state.phase === "complete" && (
          <div>
            <div className="flex items-center gap-2 text-green-500 mb-4" data-testid="publish-success">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Published successfully</span>
            </div>
            <div className="text-sm text-muted-foreground mb-6">
              {state.result.uploaded} uploaded, {state.result.deleted} deleted,{" "}
              {state.result.unchanged} unchanged.
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {state.phase === "error" && (
          <div>
            <div className="flex items-center gap-2 text-destructive mb-3" data-testid="publish-error">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Error</span>
            </div>
            <div className="text-sm text-destructive mb-2">{state.message}</div>
            {state.file && (
              <div className="text-sm text-muted-foreground mb-4">
                Failed on: {state.file}
              </div>
            )}
            {state.uploaded > 0 && (
              <div className="text-sm text-muted-foreground mb-4">
                Completed {state.uploaded} uploads before error.
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                Close
              </button>
              {state.plan.planId && (
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {state.phase === "cancelled" && (
          <div>
            <div className="text-sm text-muted-foreground mb-4">
              Publishing cancelled. {state.uploaded} uploaded, {state.deleted} deleted.
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
