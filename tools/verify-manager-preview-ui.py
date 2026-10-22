"""Verify the public preview uses the current manager and only demo state."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".tmp/upstream-v1101-20261022/ui"
OUTPUT.mkdir(parents=True, exist_ok=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT / "docs")))
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url))
            page.goto(f"http://127.0.0.1:{server.server_port}/manager-preview/index.html?lang=zh",
                      wait_until="networkidle")
            page.get_by_role("button", name="Codex增强", exact=True).click()
            page.screenshot(path=str(OUTPUT / "preview-inspect.png"), full_page=True)
            if errors:
                raise AssertionError(errors)
            checkbox = page.get_by_label("会话项目移动", exact=True)
            first = checkbox.is_checked()
            checkbox.locator("..").click()
            page.get_by_role("button", name="保存增强设置", exact=True).click()
            expect(page.get_by_text("saved fixture", exact=False)).to_have_count(0)
            page.keyboard.press("Escape")
            expect(checkbox).not_to_be_checked() if first else expect(checkbox).to_be_checked()
            checkbox.locator("..").click()
            page.get_by_role("button", name="保存增强设置", exact=True).click()
            page.keyboard.press("Escape")
            expect(checkbox).to_be_checked() if first else expect(checkbox).not_to_be_checked()
            page.get_by_role("button", name="请求日志", exact=True).click()
            expect(page.get_by_role("heading", name="请求日志", exact=True).first).to_be_visible()
            page.get_by_role("button", name="代理设置", exact=True).click()
            expect(page.get_by_text("请求避震", exact=True).first).to_be_visible()
            for locale in ["en", "ru", "zh"]:
                page.locator(".rail-language-select").select_option(locale)
                expect(page.locator(".rail-language-select")).to_have_value(locale)
                page.set_viewport_size({"width": 960, "height": 720})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=str(OUTPUT / "public-preview.png"), full_page=True)
            assert not errors, errors
            external = [url for url in requests if not url.startswith(
                (f"http://127.0.0.1:{server.server_port}/", "data:", "blob:"))]
            assert not external, external
            print(json.dumps({"status": "PASS", "checks": [
                "current production manager", "two in-memory saves", "request logs and proxy settings",
                "three languages", "narrow layout", "no external requests", "no page errors",
            ]}))
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
    thread.join()
