import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getLocale, subscribeLanguage } from "./i18n";
import "./styles.css";

/* ── Bundled fonts (offline, no Google Fonts request) ──
     Fontsource packages ship woff2 files that Vite bundles into dist/.
     CSS @font-face declarations are injected at build time.
     界面字体已对齐 DSH：改走系统字体栈（--font-sans），不再打包 Inter；
     这里只保留 DSH 代码字体栈里排第二的 JetBrains Mono 作等宽回退。      */
import "@fontsource/jetbrains-mono";

const app = document.getElementById("app");
document.documentElement.lang = getLocale();
subscribeLanguage(() => { document.documentElement.lang = getLocale(); });

if (app instanceof HTMLElement) {
  createRoot(app).render(<App />);
}
