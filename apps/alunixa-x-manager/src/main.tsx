import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/* ── Bundled fonts (offline, no Google Fonts request) ──
     Fontsource packages ship woff2 files that Vite bundles into dist/.
     CSS @font-face declarations are injected at build time.              */
import "@fontsource/jetbrains-mono";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

const app = document.getElementById("app");

if (app instanceof HTMLElement) {
  createRoot(app).render(<App />);
}
