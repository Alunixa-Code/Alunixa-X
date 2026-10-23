import { createRoot } from "react-dom/client";
import "./tailwind-source.css";
import "../src/styles.css";
import "@fontsource/jetbrains-mono";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

const previewLanguage = new URLSearchParams(window.location.search).get("lang");
if (previewLanguage === "en" || previewLanguage === "zh" || previewLanguage === "ru") {
  window.localStorage.setItem("alunixa-x-lang", previewLanguage);
}

async function start() {
  const { App } = await import("../src/App");
  const app = document.getElementById("app");
  if (app instanceof HTMLElement) {
    createRoot(app).render(<App />);
  }
}

void start();
