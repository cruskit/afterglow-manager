import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { UpdateProvider } from "./context/UpdateContext";
import { Toaster } from "sonner";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WorkspaceProvider>
      <UpdateProvider>
        <App />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              color: "#e0e0e0",
            },
          }}
        />
      </UpdateProvider>
    </WorkspaceProvider>
  </React.StrictMode>,
);
