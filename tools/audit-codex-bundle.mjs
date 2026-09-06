import fs from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "../apps/alunixa-x-manager/node_modules/typescript/lib/typescript.js";

export function readAsarAssets(path) {
  const fd = fs.openSync(path, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error("Truncated ASAR header");
    const size = prefix.readUInt32LE(12);
    if (size > 32 * 1024 * 1024) throw new Error("ASAR header exceeds audit limit");
    const header = Buffer.alloc(size);
    if (fs.readSync(fd, header, 0, size, 16) !== size) throw new Error("Truncated ASAR index");
    const entries = JSON.parse(header.toString()).files?.webview?.files?.assets?.files;
    if (!entries) throw new Error("Codex webview assets are unavailable");
    return Object.entries(entries)
      .filter(([name]) => /^app-(initial|main)-.*\.js$/.test(name))
      .map(([name, entry]) => {
        if (entry.unpacked || entry.size > 32 * 1024 * 1024) throw new Error(`Unsupported asset: ${name}`);
        const body = Buffer.alloc(entry.size);
        const offset = 8 + prefix.readUInt32LE(4) + Number(entry.offset);
        if (!Number.isSafeInteger(offset) || offset < 16 + size) throw new Error("Invalid ASAR offset");
        if (fs.readSync(fd, body, 0, body.length, offset) !== body.length) throw new Error(`Truncated asset: ${name}`);
        return { name, source: body.toString() };
      });
  } finally {
    fs.closeSync(fd);
  }
}

export function auditBundleSource(name, source) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const exported = new Map();
  for (const node of file.statements) {
    if (!ts.isExportDeclaration(node) || !ts.isNamedExports(node.exportClause ?? file)) continue;
    for (const element of node.exportClause.elements) {
      exported.set(element.propertyName?.text || element.name.text, element.name.text);
    }
  }
  const contracts = {
    projectless: ["projectless-thread-cwd", "projectlessOutputDirectory", "workspaceRoots"],
    settingRead: ["get-setting"],
    settingWrite: ["set-setting"],
    hostRpc: ["...", "params", "select", "signal", "source"],
    dispatcher: ["dispatchMessage(", "subscribe(", "dispatchHostMessage("],
    terminal: ["getSnapshot(", "write(", "handleHostEvent(", "subscribeToSessionSnapshot(", "closeSessionForConversation("],
    requestClient: ["sendRequest(", "requestClient", "getConversation("],
  };
  const matches = Object.fromEntries(Object.keys(contracts).map((key) => [key, []]));
  const visit = (node) => {
    const isFunction = ts.isFunctionDeclaration(node);
    const isClass = ts.isClassExpression(node) || ts.isClassDeclaration(node);
    if (isFunction || isClass) {
      const text = node.getText(file);
      const symbol = node.name?.text
        || (ts.isBinaryExpression(node.parent) ? node.parent.left.getText(file) : "")
        || (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(file) : "");
      for (const [key, markers] of Object.entries(contracts)) {
        const classContract = ["dispatcher", "terminal", "requestClient"].includes(key);
        if (classContract !== isClass || (!isClass && !text.startsWith("async function"))) continue;
        if (markers.every((marker) => text.includes(marker))) {
          matches[key].push({ symbol, export: exported.get(symbol) ?? null, bytes: text.length });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { asset: name, bytes: Buffer.byteLength(source), exportedSymbols: exported.size, contracts: matches };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node tools/audit-codex-bundle.mjs <Codex app.asar>");
  const reports = readAsarAssets(path).map(({ name, source }) => auditBundleSource(name, source));
  const initial = reports.find((report) => report.asset.startsWith("app-initial-"));
  const missing = Object.entries(initial?.contracts ?? {}).filter(([, values]) => !values.length).map(([key]) => key);
  console.log(JSON.stringify({ mode: "read-only-static-contract-audit", reports, missing }, null, 2));
  if (!initial || missing.length) process.exitCode = 1;
}
