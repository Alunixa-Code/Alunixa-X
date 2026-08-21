import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const hash = (file) => createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex");

const expectedImages = new Map([
  ["assets/brand/alunixa-x-icon.png", "b5c748d7fa799065a97b31a1a9176b32bf3091ae86b73ecd6b00b09f18126650"],
  ["assets/brand/alunixa-x-social.png", "c4370972fdcde405625930f2e3423cdf354201f4375e25c4e2de1e7b3552c605"],
  ["docs/images/alunixa-x-dashboard.png", "57fbfdb85d4533a2ef580f6f876763f454fd1db8aee806a7f2fce822c0bbf9e7"],
  ["docs/images/alunixa-x-dashboard-compact-runtime.png", "cf6f01060f1dfd06e4e0320c378e340c32e8408b4c60b84f74eedcf1db8687dc"],
  ["apps/alunixa-x-manager/src-tauri/icons/icon.png", "b5c748d7fa799065a97b31a1a9176b32bf3091ae86b73ecd6b00b09f18126650"],
  ["apps/alunixa-x-manager/src-tauri/icons/icon.ico", "aa74f520d54f4aadeb264df7fa771a82a116716e98940d67e7a819eb4b4279c2"],
  ["assets/images/sponsor-alipay.jpg", "8e50166194d3e78953248b94506737156767bbfb9059d82736d04f1c5827afa2"],
  ["assets/images/sponsor-wechat.jpg", "37c111fad288fc98f056ce3489eb5b29d689790f9a94ead5fdb96fda75a66d86"],
]);

const requiredMarkers = new Map([
  ["Cargo.toml", ['repository = "https://github.com/Alunixa-Code/Alunixa-X"']],
  ["README.md", ["# Alunixa X", "assets/brand/alunixa-x-icon.png", "docs/images/alunixa-x-dashboard.png", "https://github.com/Alunixa-Code/Alunixa-X/releases/latest"]],
  ["README_EN.md", ["<h1 align=\"center\">Alunixa X</h1>", "assets/brand/alunixa-x-social.png", "https://github.com/Alunixa-Code/Alunixa-X/issues"]],
  ["CONTRIBUTING.md", ["https://github.com/Alunixa-Code/Alunixa-X.git"]],
  ["apps/alunixa-x-manager/src/App.tsx", ["ALUNIXA X", "AGENT CONTROL SYSTEM", "AGENT RAIL", "https://github.com/Alunixa-Code/Alunixa-X"]],
  ["apps/alunixa-x-manager/src-tauri/tauri.conf.json", ['"productName": "Alunixa X"', '"identifier": "io.github.alunixacode.alunixax"']],
  ["crates/alunixa-x-core/src/update.rs", ['"Alunixa-Code/Alunixa-X"', "https://api.github.com/repos/Alunixa-Code/Alunixa-X/releases/latest"]],
  ["assets/inject/renderer-inject.js", ["Alunixa X", "https://github.com/Alunixa-Code/Alunixa-X"]],
  [".github/ISSUE_TEMPLATE/config.yml", ["https://github.com/Alunixa-Code/Alunixa-X/discussions"]],
]);

const staleMarkers = [
  "https://github.com/Alunixa-Code/CodexPlusPlusPlus",
  "https://api.github.com/repos/Alunixa-Code/CodexPlusPlusPlus",
  "https://github.com/ygzzfyh123/CodexPPP",
  "https://api.github.com/repos/ygzzfyh123/CodexPPP",
];

const failures = [];
for (const [file, markers] of requiredMarkers) {
  const text = readFileSync(resolve(root, file), "utf8");
  for (const marker of markers) {
    if (!text.includes(marker)) failures.push(`${file} is missing required Alunixa X marker: ${marker}`);
  }
  for (const marker of staleMarkers) {
    if (text.includes(marker)) failures.push(`${file} still references stale repository marker: ${marker}`);
  }
}

for (const [file, expected] of expectedImages) {
  const actual = hash(file);
  if (actual !== expected) failures.push(`${file} SHA-256 changed: expected ${expected}, got ${actual}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`branding guard: ${failure}`);
  process.exit(1);
}

console.log("Alunixa X name, repository, UI signature, icon, social preview, and owner assets are consistent.");
