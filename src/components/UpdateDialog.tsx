import { Loader2 } from "lucide-react";
import type { UpdateStatus } from "../hooks/useUpdateChecker";

interface UpdateDialogProps {
  status: UpdateStatus;
}

export function UpdateDialog({ status }: UpdateDialogProps) {
  if (status.phase !== "downloading") return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative bg-background border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <h2 className="text-lg font-semibold">Downloading Update</h2>
        </div>

        <div className="mb-3">
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${status.progress}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground mt-2 text-center">
            {status.progress}%
          </p>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          The app will restart automatically when complete.
        </p>
      </div>
    </div>
  );
}
