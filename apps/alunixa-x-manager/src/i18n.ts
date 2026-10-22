// Lightweight source-text-keyed i18n for the Alunixa X manager UI.
//
// The app is authored in Chinese. Every user-facing Chinese literal is wrapped
// with `t("中文")` (plain strings) or `tf("前缀 {0}", [expr])` (interpolated
// strings) by tools/i18n-codemod.mjs. For English and Russian we look the
// source text up in the selected dictionary; otherwise we return the
// original Chinese, so Chinese stays the zero-overhead default.
//
// 语言通过外部 store 通知 React 原地更新；模块级标签使用 getter，保留页面和草稿。

import { EN_BACKEND, EN_BACKEND_PATTERNS, EN_PLAIN, EN_TEMPLATE } from "@/i18n-en";
import { RU_BACKEND, RU_BACKEND_PATTERNS, RU_PLAIN, RU_TEMPLATE } from "@/i18n-ru";

export type Language = "zh" | "en" | "ru";

export const LANGUAGE_OPTIONS = [
  { value: "zh", label: "简体中文", locale: "zh-CN" },
  { value: "en", label: "English", locale: "en-US" },
  { value: "ru", label: "Русский", locale: "ru-RU" },
] as const;

const STORAGE_KEY = "alunixa-x-lang";

export function isLanguage(value: string): value is Language {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

function resolveInitialLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored !== null && isLanguage(stored) ? stored : "zh";
  } catch {
    return "zh";
  }
}

let LANG: Language = resolveInitialLanguage();
const listeners = new Set<() => void>();
const dictionary = () => LANG === "ru"
  ? { plain: RU_PLAIN, template: RU_TEMPLATE, backend: RU_BACKEND, patterns: RU_BACKEND_PATTERNS }
  : { plain: EN_PLAIN, template: EN_TEMPLATE, backend: EN_BACKEND, patterns: EN_BACKEND_PATTERNS };

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getLanguage(): Language {
  return LANG;
}

export function getLocale(): string {
  return LANGUAGE_OPTIONS.find((option) => option.value === LANG)!.locale;
}

/** Translate a plain Chinese literal. Falls back to the source text. */
export function t(zh: string): string {
  if (LANG === "zh") return zh;
  const DICTIONARY = dictionary();
  const plain = DICTIONARY.plain[zh] ?? DICTIONARY.backend[zh];
  if (plain !== undefined) return plain;
  for (const [re, replacement] of DICTIONARY.patterns) {
    if (re.test(zh)) return zh.replace(re, replacement);
  }
  return zh;
}

/**
 * Translate an interpolated literal. `key` carries `{0}`,`{1}`… placeholders in
 * the original (Chinese) order; `args` are the runtime values for each. In
 * Chinese we substitute into the key itself; in other languages we use the
 * looked-up template (also falling back to the key).
 */
export function tf(key: string, args: Array<string | number>): string {
  const template = LANG === "zh" ? key : dictionary().template[key] ?? key;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const value = args[Number(index)];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Persist only the locale; React updates without serializing or losing drafts. */
export function setLanguage(language: Language): boolean {
  if (!isLanguage(language)) return false;
  if (language === LANG) return true;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // A blocked local store must not prevent an in-memory locale change.
  }
  LANG = language;
  for (const listener of listeners) listener();
  return true;
}

export function toggleLanguage(): void {
  setLanguage(LANG === "en" ? "zh" : "en");
}
