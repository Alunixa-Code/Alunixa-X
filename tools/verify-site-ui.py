"""Verify the static site without contacting live APIs or changing application state."""
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".tmp/upstream-v110-20261020/site-ui"
OUTPUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    requests = []
    try:
        page = browser.new_page(reduced_motion="reduce")
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
        page.route("https://api.github.com/**", lambda route: route.fulfill(
            content_type="application/json",
            body=json.dumps({"tag_name": "v9.8.7", "stargazers_count": 1, "assets": []}),
        ))
        page.goto((ROOT / "docs/index.html").as_uri(), wait_until="networkidle")
        controls = page.locator(".screenshot-controls button")
        expect(controls).to_have_count(3)
        for width, height in [(1440, 900), (960, 720), (390, 844)]:
            page.set_viewport_size({"width": width, "height": height})
            for language in ["en", "zh"]:
                menu = page.locator("[data-menu-button]")
                if menu.is_visible() and menu.get_attribute("aria-expanded") != "true":
                    menu.click()
                page.locator(f'.language-switch [data-language="{language}"]').click()
                expect(page.locator("html")).to_have_attribute("lang", "en" if language == "en" else "zh-CN")
                if menu.is_visible() and menu.get_attribute("aria-expanded") == "true":
                    menu.click()
                controls.first.scroll_into_view_if_needed()
                page.wait_for_timeout(120)
                dimensions = page.locator(".screenshot-track").bounding_box()
                for index in [0, 1, 2, 0]:
                    before = page.evaluate("scrollY")
                    controls.nth(index).click()
                    expect(page.locator(".screenshot-track figure:visible")).to_have_count(1)
                    expect(controls.nth(index)).to_have_attribute("aria-pressed", "true")
                    image = page.locator(".screenshot-track figure:visible img")
                    expect(image).to_be_visible()
                    page.wait_for_function(
                        "() => [...document.querySelectorAll('.screenshot-track figure:not([hidden]) img')]"
                        ".every(img => img.complete && img.naturalWidth > 0)"
                    )
                    assert abs(page.evaluate("scrollY") - before) <= 1, "gallery changed scroll position"
                    box = page.locator(".screenshot-track").bounding_box()
                    assert abs(box["height"] - dimensions["height"]) <= 1, "gallery height shifted"
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal overflow"
                assert page.locator(".skip-link").evaluate(
                    "node => node === document.activeElement || node.getBoundingClientRect().bottom <= 0"
                ), "unfocused skip link covers page content under reduced motion"
                expect(controls.nth(1)).to_have_text(
                    "Advanced model configuration" if language == "en" else "高级多模型配置")
                page.locator("#showcase").screenshot(path=str(OUTPUT / f"gallery-{width}-{language}.png"))
        for element in page.locator('img[src],script[src],link[rel="stylesheet"]').all():
            resource = element.get_attribute("src") or element.get_attribute("href")
            parsed = urlparse(resource)
            if parsed.scheme or not parsed.path:
                continue
            resource_path = (ROOT / "docs" / unquote(parsed.path)).resolve()
            assert resource_path.is_relative_to(ROOT / "docs"), "asset outside the deployed docs tree"
            assert resource_path.is_file(), f"missing published asset: {resource}"
        assert not errors, errors
        assert not any("Ad-List" in url or "/sponsors.json" in url for url in requests), requests
        page.close()
        fallback = browser.new_page(java_script_enabled=False)
        fallback.goto((ROOT / "docs/index.html").as_uri(), wait_until="load")
        expect(fallback.locator("#showcase figure")).to_have_count(3)
        assert all(figure.is_visible() for figure in fallback.locator("#showcase figure").all())
        fallback.close()
        print(json.dumps({"status": "PASS", "checks": [
            "three real screenshots", "stable selection and scroll position",
            "desktop/tablet/mobile", "Chinese and English", "all images decoded",
            "no horizontal overflow", "no promotion requests", "no-JavaScript fallback", "no page errors",
        ]}))
    finally:
        browser.close()
