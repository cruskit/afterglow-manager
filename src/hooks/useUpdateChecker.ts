import { useState, useEffect, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";

export type UpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; update: Update; version: string }
  | { phase: "downloading"; progress: number }
  | { phase: "error"; message: string };

export function useUpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>({ phase: "idle" });
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const checkedRef = useRef(false);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const checkForUpdate = useCallback(async (silent: boolean) => {
    setStatus({ phase: "checking" });
    try {
      const update = await check();
      if (update) {
        setStatus({ phase: "available", update, version: update.version });
        if (silent) {
          toast.info(`Update available: v${update.version}`, {
            description: "Open Settings to download and install.",
            duration: 10000,
          });
        }
      } else {
        setStatus({ phase: "idle" });
        if (!silent) {
          toast.success("You're on the latest version.");
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ phase: "error", message });
      if (!silent) {
        toast.error(`Update check failed: ${message}`);
      }
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (status.phase !== "available") return;
    const { update } = status;

    setStatus({ phase: "downloading", progress: 0 });
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
          setStatus({ phase: "downloading", progress });
        } else if (event.event === "Finished") {
          setStatus({ phase: "downloading", progress: 100 });
        }
      });

      // relaunch is handled by the plugin after install
      // The app will restart automatically
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ phase: "error", message });
      toast.error(`Update failed: ${message}`);
    }
  }, [status]);

  // Auto-check on startup with 3s delay
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    const timer = setTimeout(() => {
      checkForUpdate(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return { status, currentVersion, checkForUpdate, downloadAndInstall };
}
