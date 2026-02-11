import { useWorkspace } from "../context/WorkspaceContext";

export function WelcomeScreen() {
  const { openFolder } = useWorkspace();

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background">
      <div className="flex flex-col items-center gap-6">
        <div className="text-6xl font-bold text-afterglow-accent tracking-tight">AG</div>
        <h1 className="text-2xl font-semibold">AfterGlowManager</h1>
        <p className="text-muted-foreground">Manage your galleries</p>
        <button
          onClick={openFolder}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity font-medium"
        >
          Open Folder
        </button>
      </div>
    </div>
  );
}
