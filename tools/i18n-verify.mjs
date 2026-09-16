// Check every frontend t()/tf() call against English and Russian dictionaries.
// Also enforce backend key/regex parity, interpolation and capture placeholders.
// No network access or additional dependency is needed.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.join(repoRoot, "apps", "alunixa-x-manager");
const srcRoot = path.join(appRoot, "src");
const require = createRequire(path.join(appRoot, "package.json"));
const ts = require("typescript");
const usedPlain = new Set();
const usedTemplate = new Set();
let ok = true;

function fail(message) {
  ok = false;
  console.error(`  ${message}`);
}

function scanDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(file);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.|^i18n-(en|ru)\.ts$/.test(entry.name)) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const argument = node.arguments[0];
          if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
            if (node.expression.text === "t") usedPlain.add(argument.text);
            if (node.expression.text === "tf") usedTemplate.add(argument.text);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}

function loadCatalog(language) {
  const file = path.join(srcRoot, `i18n-${language}.ts`);
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context, { filename: file, timeout: 5000 });
  const prefix = language.toUpperCase();
  return {
    plain: context.exports[`${prefix}_PLAIN`],
    template: context.exports[`${prefix}_TEMPLATE`],
    backend: context.exports[`${prefix}_BACKEND`],
    patterns: context.exports[`${prefix}_BACKEND_PATTERNS`],
  };
}

function checkKeys(label, expected, dictionary) {
  const actual = new Set(Object.keys(dictionary));
  console.log(`${label}: ${expected.size} referenced, ${actual.size} translated`);
  for (const key of expected) if (!actual.has(key)) fail(`${label} MISSING: ${JSON.stringify(key)}`);
  for (const key of actual) if (!expected.has(key)) fail(`${label} STALE: ${JSON.stringify(key)}`);
}

function placeholders(text, regex) {
  return JSON.stringify((text.match(regex) ?? []).sort());
}

scanDirectory(srcRoot);
const en = loadCatalog("en");
const ru = loadCatalog("ru");
for (const [language, catalog] of [["en", en], ["ru", ru]]) {
  checkKeys(`${language} plain`, usedPlain, catalog.plain);
  checkKeys(`${language} template`, usedTemplate, catalog.template);
  for (const [section, dictionary] of Object.entries(catalog)) {
    if (section === "patterns") continue;
    for (const [key, value] of Object.entries(dictionary)) {
      if (typeof value !== "string") {
        fail(`${language} ${section}: non-string value for ${JSON.stringify(key)}`);
        continue;
      }
      if (section === "template" && placeholders(key, /\{\d+\}/g) !== placeholders(value, /\{\d+\}/g)) {
        fail(`${language} template: placeholder mismatch for ${JSON.stringify(key)}`);
      }
      if (language === "ru" && /\p{Script=Han}/u.test(value)) {
        fail(`ru ${section}: untranslated Chinese in ${JSON.stringify(key)}`);
      }
      // Existing composition fragments may intentionally translate to an empty string.
      if (language === "ru" && !value.trim() && en[section][key]?.trim()) {
        fail(`ru ${section}: empty translation for ${JSON.stringify(key)}`);
      }
    }
  }
}
checkKeys("ru backend", new Set(Object.keys(en.backend)), ru.backend);
if (en.patterns.length !== ru.patterns.length) fail("Backend regex count mismatch");
en.patterns.forEach(([pattern, replacement], index) => {
  const translated = ru.patterns[index];
  if (!translated || pattern.source !== translated[0].source || pattern.flags !== translated[0].flags) {
    fail(`Backend regex mismatch at ${index}`);
  } else if (placeholders(replacement, /\$\d+/g) !== placeholders(translated[1], /\$\d+/g)) {
    fail(`Backend capture placeholder mismatch at ${index}`);
  } else if (/\p{Script=Han}/u.test(translated[1])) {
    fail(`Untranslated backend replacement at ${index}`);
  }
});
console.log(`Backend patterns: ${en.patterns.length} English, ${ru.patterns.length} Russian`);
if (!ok) process.exit(1);
console.log("\nEnglish and Russian dictionaries, placeholders and backend patterns match.");
