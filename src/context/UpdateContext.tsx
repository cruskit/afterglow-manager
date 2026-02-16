import { createContext, useContext } from "react";
import { useUpdateChecker, type UpdateStatus } from "../hooks/useUpdateChecker";
import { UpdateDialog } from "../components/UpdateDialog";

interface UpdateContextValue {
  status: UpdateStatus;
  currentVersion: string;
  checkForUpdate: (silent: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const update = useUpdateChecker();

  return (
    <UpdateContext.Provider value={update}>
      {children}
      <UpdateDialog status={update.status} />
    </UpdateContext.Provider>
  );
}

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdate must be used within UpdateProvider");
  return ctx;
}
