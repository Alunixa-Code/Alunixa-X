"""Exercise the manager's deferred full-screen interaction in isolated Chromium."""

import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE = runpy.run_path(str(Path(__file__).with_name("verify-image-models-ui.py")))
INIT = BASE["INIT"]


def trigger(page):
    target = page.get_by_role("button", name="Agent control system")
    for _ in range(7):
        target.click(delay=25)
    expect(page.locator(".signal-archive")).to_be_visible()


def reveal(page):
    page.locator(
        ".signal-archive-skip, .signal-archive-choices, .signal-archive-ending-actions"
    ).first.wait_for(state="visible")
    skip = page.locator(".signal-archive-skip")
    if skip.is_visible():
        skip.click()
        page.locator(".signal-archive-choices button, .signal-archive-ending-actions").first.wait_for(
            state="visible"
        )


def choose(page, label):
    reveal(page)
    page.locator(".signal-archive-choices button").filter(has_text=label).click()
    page.wait_for_timeout(260)


def main():
    with BASE["server_url"]() as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            errors = []
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script(INIT)
            page.goto(url, wait_until="networkidle")
            trigger(page)
            expect(page.get_by_role("heading", name="中继站在你之前醒来")).to_be_visible()
            page.screenshot(path=str(ROOT / ".tmp" / "signal-archive-intro.png"), full_page=True)

            for label in [
                "报上一个仍记得的名字", "走进记忆库", "从第一秒听到最后一秒", "一字不改地保留",
                "还没有听完信标", "绘出信号绕行十七年的轨迹", "回答：“有。你被听见了。”",
                "下降到反应堆下方", "一个矛盾也可以是真实的人", "把原话与回答送向群星",
            ]:
                choose(page, label)
            reveal(page)
            expect(page.locator(".signal-archive-ending-mark")).to_have_text("HE · 有人听见")
            page.screenshot(path=str(ROOT / ".tmp" / "signal-archive-he.png"), full_page=True)
            page.get_by_role("button", name="从最初的呼吸重新开始", exact=True).click()
            page.wait_for_timeout(300)

            for label in [
                "保持沉默，只听它呼吸", "走进记忆库", "先比对所有重复的时间戳", "一字不改地保留",
                "还没有听完信标", "绘出信号绕行十七年的轨迹", "反问：“你希望谁在这里？”",
                "下降到反应堆下方", "一个矛盾也可以是真实的人", "不回信。打开观察窗。",
            ]:
                choose(page, label)
            reveal(page)
            expect(page.locator(".signal-archive-ending-mark")).to_have_text("TE · 黎明没有回信")
            page.screenshot(path=str(ROOT / ".tmp" / "signal-archive-te.png"), full_page=True)
            page.keyboard.press("Escape")
            expect(page.locator(".signal-archive")).to_have_count(0)

            page.evaluate("localStorage.setItem('alunixa-x-lang','en')")
            page.reload(wait_until="networkidle")
            trigger(page)
            expect(page.get_by_role("heading", name="The relay wakes before you")).to_be_visible()
            page.keyboard.press("Escape")

            page.evaluate("localStorage.setItem('alunixa-x-lang','ru')")
            page.reload(wait_until="networkidle")
            trigger(page)
            expect(page.get_by_role("heading", name="Ретранслятор просыпается раньше тебя")).to_be_visible()
            page.screenshot(path=str(ROOT / ".tmp" / "signal-archive-ru.png"), full_page=True)
            page.keyboard.press("Escape")

            reduced = browser.new_page(viewport={"width": 900, "height": 680}, reduced_motion="reduce")
            reduced.add_init_script(INIT)
            reduced.goto(url, wait_until="networkidle")
            trigger(reduced)
            expect(reduced.locator(".signal-archive-skip")).to_have_count(0)
            expect(reduced.locator(".signal-archive-copy")).to_contain_text("备用电池")
            assert reduced.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            reduced.screenshot(path=str(ROOT / ".tmp" / "signal-archive-compact.png"), full_page=True)
            reduced.close()

            assert not errors, errors
            endings = page.evaluate(
                "JSON.parse(localStorage.getItem('alunixa-x-surface-memory-v1')).endings.sort().join(',')"
            )
            assert endings == "he,te", endings
            print(
                "SIGNAL_ARCHIVE_UI_PASS: deferred trigger, HE/TE routes, replay, escape cleanup, "
                "zh/en/ru, reduced motion and compact viewport"
            )
        finally:
            browser.close()


if __name__ == "__main__":
    main()
