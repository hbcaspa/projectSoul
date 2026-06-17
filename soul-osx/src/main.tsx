import ReactDOM from "react-dom/client";
import App from "./App";
import { SoulProvider } from "./lib/store";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <SoulProvider>
    <App />
  </SoulProvider>
);
