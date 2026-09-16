import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as en from "./i18n-en.ts";
import * as ru from "./i18n-ru.ts";

const source = fs.readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function runtime(stored: string | null, blocked = false) {
  let value = stored;
  let reloads = 0;
  const context = {
    exports: {} as {
      getLanguage(): string;
      getLocale(): string;
      t(key: string): string;
      tf(key: string, values: (string | number)[]): string;
      setLanguage(language: string): boolean;
    },
    require(name: string) {
      if (name === "@/i18n-en") return en;
      if (name === "@/i18n-ru") return ru;
      throw new Error(`Unexpected import ${name}`);
    },
    window: {
      localStorage: {
        getItem(key: string) {
          assert.equal(key, "alunixa-x-lang");
          if (blocked) throw new Error("Storage unavailable");
          return value;
        },
        setItem(key: string, next: string) {
          assert.equal(key, "alunixa-x-lang");
          if (blocked) throw new Error("Storage unavailable");
          value = next;
        },
      },
      location: { reload() { reloads++; } },
    },
  };
  vm.runInNewContext(compiled, context, { timeout: 5000 });
  return { api: context.exports, get stored() { return value; }, get reloads() { return reloads; } };
}

for (const [language, locale, overview] of [
  ["zh", "zh-CN", "概览"],
  ["en", "en-US", "Overview"],
  ["ru", "ru-RU", "Обзор"],
]) {
  test(`${language}: persistent language, locale and module-load translation`, () => {
    const r = runtime(language);
    assert.equal(r.api.getLanguage(), language);
    assert.equal(r.api.getLocale(), locale);
    assert.equal(r.api.t("概览"), overview);
    assert.equal(r.api.t("unchanged-provider-data"), "unchanged-provider-data");
    assert.equal(r.api.setLanguage(language), true);
    assert.equal(r.reloads, 0);
  });
}

test("Russian translates every current UI/backend key without silently using English or Chinese", () => {
  const r = runtime("ru");
  for (const [key, translation] of Object.entries(ru.RU_PLAIN)) {
    assert.equal(r.api.t(key), translation, key);
  }
  for (const [key, translation] of Object.entries(ru.RU_BACKEND)) {
    assert.equal(r.api.t(key), ru.RU_PLAIN[key] ?? translation, key);
  }
  assert.match(r.api.t("生图模型"), /Модели/);
  assert.match(r.api.t("动态壁纸"), /Живые/);
});

test("Russian interpolation preserves all arguments, literal dollars, paths, zero and missing values", () => {
  const r = runtime("ru");
  const file = "C:\\проект\\файл $&.png";
  assert.equal(r.api.tf("模型「{0}」：{1}", [file, 0]), `Модель «${file}»: 0`);
  assert.equal(r.api.tf("未知 {0}/{1}", [file]), `未知 ${file}/{1}`);
  for (const [key, value] of Object.entries(ru.RU_TEMPLATE)) {
    assert.equal(r.api.tf(key, []), value);
  }
});

test("Russian backend patterns preserve dynamic diagnostic content", () => {
  const r = runtime("ru");
  const detail = "C:\\Проекты\\config.toml (OS error 5)";
  assert.equal(r.api.t(`保存配置文件失败：${detail}`), `Не удалось сохранить файл конфигурации: ${detail}`);
  assert.equal(r.api.t("已从「provider-a」获取 21 个模型。"), "От «provider-a» получено моделей: 21.");
});

test("language change persists once and reloads, without changing the current module snapshot", () => {
  const r = runtime("en");
  assert.equal(r.api.setLanguage("ru"), true);
  assert.equal(r.stored, "ru");
  assert.equal(r.reloads, 1);
  assert.equal(r.api.getLanguage(), "en");
  assert.equal(runtime(r.stored).api.t("概览"), "Обзор");
});

test("unknown and missing saved values retain the existing Chinese default", () => {
  for (const value of [null, "", "fr", "ru-RU", "__proto__"]) {
    assert.equal(runtime(value).api.getLanguage(), "zh");
  }
});

test("blocked storage does not reload and discard unsaved edits", () => {
  const r = runtime("en", true);
  assert.equal(r.api.getLanguage(), "zh");
  assert.equal(r.api.setLanguage("ru"), false);
  assert.equal(r.reloads, 0);
  assert.equal(r.stored, "en");
});

test("invalid runtime language cannot be persisted or trigger reload", () => {
  const r = runtime("en");
  assert.equal(r.api.setLanguage("de"), false);
  assert.equal(r.stored, "en");
  assert.equal(r.reloads, 0);
});

test("manager language is separate from native Codex locale and updates tray for all three languages", () => {
  const app = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const main = fs.readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  assert.match(app, /aria-label=\{t\("界面语言"\)\}/);
  assert.match(app, /showLabel: t\("显示窗口"\)/);
  assert.match(app, /quitLabel: t\("退出"\)/);
  assert.match(app, /const changeLanguage = async[\s\S]*?setConfirmDialog[\s\S]*?confirmed && !setLanguage/);
  assert.match(main, /document\.documentElement\.lang = getLocale\(\)/);
  assert.doesNotMatch(source, /codexAppForceChineseLocale|update_settings|config\.toml/);
  assert.doesNotMatch(app, /toLocaleString\("zh-CN"\)|toggleLanguage/);
});
