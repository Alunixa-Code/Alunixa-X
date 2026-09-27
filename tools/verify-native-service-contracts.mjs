// Read-only verification against the installed ASAR. Never imports an application
// module, calls its services, attaches CDP, or modifies any live configuration.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "../apps/alunixa-x-manager/node_modules/typescript/lib/typescript.js";
import { readAsarAssets } from "./audit-codex-bundle.mjs";

const asar = process.argv[2];
if (!asar) throw new Error("Usage: node tools/verify-native-service-contracts.mjs <app.asar>");
const injection = fs.readFileSync(new URL("../assets/inject/renderer-inject.js", import.meta.url), "utf8");
const resolverNames = ["codexModuleFunctionSource", "codexSettingStorageFromModule",
  "codexHostRpcFromModule", "codexServiceTierDispatcherFromModule", "codexTerminalManagerFromModule"];
const functions = resolverNames.map(name => {
  const match = injection.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n");
const context = vm.createContext({});
vm.runInContext(functions, context, { timeout: 1000 });
let passed = false;
for (const asset of readAsarAssets(asar)) {
  const file = ts.createSourceFile(asset.name, asset.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const exports = new Map(), declarations = [], assignments = [];
  for (const node of file.statements) {
    if (!ts.isExportDeclaration(node) || !node.exportClause || !ts.isNamedExports(node.exportClause)) continue;
    for (const item of node.exportClause.elements) exports.set(item.propertyName?.text || item.name.text, item.name.text);
  }
  function visit(node) {
    if (ts.isFunctionDeclaration(node) || ts.isClassExpression(node) || ts.isClassDeclaration(node)) declarations.push(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) assignments.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const module = {};
  for (const node of declarations) {
    const source = node.getText(file);
    const parent = node.parent;
    const symbol = ts.isBinaryExpression(parent) ? parent.left.getText(file)
      : ts.isVariableDeclaration(parent) ? parent.name.getText(file) : node.name?.text;
    if (ts.isFunctionDeclaration(node)) {
      const contract = source.includes("get-setting") || source.includes("set-setting")
        || ["...", "params", "select", "signal", "source"].every(marker => source.includes(marker));
      if (!exports.has(symbol) || !source.startsWith("async function") || source.length > 2000 || !contract) continue;
      // Defining a function does not run its body; the resolver checks the native shape.
      module[exports.get(symbol)] = vm.runInContext(`(${source})`, context, { timeout: 1000 });
    } else if (source.includes("dispatchHostMessage(") && source.includes("subscribe(")
        || source.includes("subscribeToSessionSnapshot(") && source.includes("runHeadlessAction(")) {
      const instance = assignments.find(assignment => exports.has(assignment.left.getText(file))
        && (assignment.right.getText(file) === `${symbol}.getInstance()`
          || new RegExp(`^new ${symbol.replace(/[$]/g, "\\$")}\\b`).test(assignment.right.getText(file))));
      if (!instance) continue;
      // Verify the exported instance's AST method surface without executing native
      // constructors, static initializers, ESM imports or service methods.
      module[exports.get(instance.left.getText(file))] = Object.fromEntries(node.members
        .filter(member => ts.isMethodDeclaration(member)
          && !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword))
        .map(member => [member.name.getText(file), function notInvoked() {
          throw new Error("Contract verification must not invoke native services");
        }]));
    }
  }
  const settings = context.codexSettingStorageFromModule(module, false);
  const rpc = context.codexHostRpcFromModule(module, false);
  const dispatcher = context.codexServiceTierDispatcherFromModule(module);
  const terminal = context.codexTerminalManagerFromModule(module);
  if (settings && rpc && dispatcher && terminal) {
    console.log(JSON.stringify({ asset: asset.name, settings: true, hostRpc: true, dispatcher: true,
      terminal: true, mode: "exported-native-contracts-without-running-services" }));
    passed = true;
  }
}
assert.ok(passed, "No loaded native bundle exposes all required service contracts");
console.log("NATIVE_SERVICE_CONTRACTS_PASS");
