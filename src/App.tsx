import { useWorkspace } from "./context/WorkspaceContext";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { AppShell } from "./components/AppShell";

function AppContent() {
  const { state } = useWorkspace();

  if (state.viewMode === "welcome") {
    return <WelcomeScreen />;
  }

  return <AppShell />;
}

export default function App() {
  return <AppContent />;
}
