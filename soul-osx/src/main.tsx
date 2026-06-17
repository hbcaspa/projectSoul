import ReactDOM from "react-dom/client";
import App from "./App";
import { SoulProvider } from "./lib/store";
import { UIProvider } from "./lib/ui";
import { RegistryProvider } from "./lib/useRegistry";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <SoulProvider>
    <RegistryProvider>
      <UIProvider>
        <App />
      </UIProvider>
    </RegistryProvider>
  </SoulProvider>
);
