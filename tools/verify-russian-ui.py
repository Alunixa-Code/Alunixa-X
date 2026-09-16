"""Verify the production manager in isolated Chromium with in-memory Tauri calls.

Run after npm --prefix apps/alunixa-x-manager run vite:build.
No real settings, account, Codex process or desktop application is accessed.
"""
import re
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = runpy.run_path(str(Path(__file__).with_name("verify-image-models-ui.py")))
INIT = BASE["INIT"] + r"""
(() => {
  if (!localStorage.getItem("alunixa-x-lang")) localStorage.setItem("alunixa-x-lang", "ru");
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const ok = (value={}) => ({status:"ok",message:"",...value});
  window.__tray = null;
  window.__TAURI_INTERNALS__.invoke = async (cmd,args) => {
    if(cmd==="update_tray_labels"){window.__tray=args; return;}
    if(cmd==="load_image_models")return {models:[],revision:"1"};
    if(cmd==="list_dream_skin_themes")return ok({themes:[],activeDraft:null});
    if(cmd==="refresh_dream_skin_community")return ok({themes:[],total:0});
    if(cmd==="load_ccs_providers")return ok({providers:[]});
    if(cmd==="read_live_context_entries")return ok({entries:{mcpServers:[],skills:[],plugins:[]}});
    if(cmd==="load_watcher_state")return ok({enabled:false,disabled_flag:"fixture"});
    if(cmd==="read_latest_logs")return ok({path:"fixture/alunixa-x.log",text:"",lines:0});
    if(cmd==="copy_diagnostics")return ok({report:"Isolated localization fixture"});
    if(cmd==="get_manager_autostart")return false;
    return invoke(cmd,args);
  };
})();
"""


def no_chinese_page_copy(page):
    # Native names in language options are intentionally not translated.
    texts = page.locator("body").evaluate("""root => {
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT), values=[];
      while(walker.nextNode()){
        const n=walker.currentNode, el=n.parentElement;
        if(el && !el.closest('script,style,option') && el.getClientRects().length)
          values.push(n.textContent);
      }
      return values.join('\\n');
    }""")
    assert not re.search(r"[\u3400-\u9fff]", texts), texts


def main():
    with BASE["server_url"]() as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script(INIT)
            page.goto(url, wait_until="networkidle")
            expect(page.locator("html")).to_have_attribute("lang", "ru-RU")
            expect(page.get_by_role("combobox", name="Язык интерфейса")).to_have_value("ru")
            page.wait_for_function("window.__tray?.showLabel === 'Показать окно'")
            assert page.evaluate("window.__tray.quitLabel") == "Выход"
            no_chinese_page_copy(page)
            assert page.locator(".nav-label").evaluate_all(
                "nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1)"
            ), "Russian navigation labels must wrap instead of clipping"
            screenshots = ROOT / ".tmp"
            screenshots.mkdir(exist_ok=True)
            page.screenshot(path=str(screenshots / "russian-overview-dark.png"), full_page=True)
            for label in [
                "Настройки провайдера", "Модели изображений", "Глубина рассуждений",
                "Оформление", "Инструменты и плагины", "Возможности агента",
                "Установка и обслуживание", "О программе", "Настройки",
            ]:
                page.locator(".nav").get_by_role("button", name=label, exact=True).click()
                expect(page.locator(".topbar h1")).to_have_text(label)
                no_chinese_page_copy(page)
                if label == "Оформление":
                    expect(page.get_by_text("Живые обои", exact=True)).to_be_visible()
                    page.screenshot(path=str(screenshots / "russian-wallpaper-dark.png"), full_page=True)
            unsupported = page.evaluate("window.__unsupportedCommands")
            assert unsupported == [], unsupported
            # Real reload: module-level routes and tray labels must switch together.
            page.get_by_role("combobox", name="Язык интерфейса").select_option("en")
            expect(page.get_by_role("heading", name="Сменить язык интерфейса", exact=True)).to_be_visible()
            page.get_by_role("button", name="Отмена", exact=True).click()
            expect(page.get_by_role("combobox", name="Язык интерфейса")).to_have_value("ru")
            assert page.evaluate("localStorage.getItem('alunixa-x-lang')") == "ru"
            page.get_by_role("combobox", name="Язык интерфейса").select_option("en")
            page.get_by_role("button", name="Сменить язык", exact=True).click()
            expect(page.locator("html")).to_have_attribute("lang", "en-US")
            expect(page.locator(".topbar h1")).to_have_text("Overview")
            page.wait_for_function("window.__tray?.showLabel === 'Show window'")
            page.get_by_role("combobox", name="Interface language").select_option("zh")
            page.get_by_role("button", name="Change language", exact=True).click()
            expect(page.locator("html")).to_have_attribute("lang", "zh-CN")
            expect(page.locator(".topbar h1")).to_have_text("概览")
            page.wait_for_function("window.__tray?.showLabel === '显示窗口'")
            page.get_by_role("combobox", name="界面语言").select_option("ru")
            page.get_by_role("button", name="切换语言", exact=True).click()
            expect(page.locator("html")).to_have_attribute("lang", "ru-RU")
            page.reload(wait_until="networkidle")
            expect(page.locator(".topbar h1")).to_have_text("Обзор")
            page.get_by_role("button", name="Светлая тема", exact=True).click()
            expect(page.locator("html")).to_have_class("light")
            page.screenshot(path=str(screenshots / "russian-overview-light.png"), full_page=True)
            for width in [1100, 900]:
                page.set_viewport_size({"width": width, "height": 900})
                page.get_by_role("combobox", name="Язык интерфейса").scroll_into_view_if_needed()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                assert page.locator(".language-picker").bounding_box()["x"] >= 0
                page.screenshot(path=str(screenshots / f"russian-width-{width}.png"), full_page=True)
            page.evaluate("""() => {
              const original=Storage.prototype.setItem;
              Storage.prototype.setItem=function(key,value){
                if(key==='alunixa-x-lang')throw new Error('fixture storage blocked');
                return original.call(this,key,value);
              };
            }""")
            page.get_by_role("combobox", name="Язык интерфейса").select_option("en")
            page.get_by_role("button", name="Сменить язык", exact=True).click()
            expect(page.get_by_text(
                "Не удалось сохранить язык. Проверьте локальное хранилище и повторите попытку.",
                exact=True,
            )).to_be_visible()
            expect(page.get_by_role("combobox", name="Язык интерфейса")).to_have_value("ru")
            expect(page.locator("html")).to_have_attribute("lang", "ru-RU")
            assert not errors, errors
            unsupported = page.evaluate("window.__unsupportedCommands")
            assert unsupported == [], unsupported
            print("RUSSIAN_UI_PASS: 10 routes, zero Chinese fallback, dark/light, 900/1100/1440px,")
            print("cancel + ru/en/zh/ru persisted reloads, storage-failure protection,")
            print("translated tray payloads, no clipped navigation and no page errors")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
