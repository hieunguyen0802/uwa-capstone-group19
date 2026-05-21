"""
Run once to save login state for each role.

Usage:
    python e2e/save_auth.py ops
    python e2e/save_auth.py hod
    python e2e/save_auth.py academic
    python e2e/save_auth.py hos
"""
import sys
import os
from playwright.sync_api import sync_playwright

ROLE_URLS = {
    "ops":      "http://localhost:3000/school-operations",
    "hod":      "http://localhost:3000/department-head",
    "academic": "http://localhost:3000/workload-platform",
    "hos":      "http://localhost:3000/school-head",
}

OUTPUT_FILES = {
    "ops":      "e2e/fixtures/auth_ops.json",
    "hod":      "e2e/fixtures/auth_hod.json",
    "academic": "e2e/fixtures/auth_academic.json",
    "hos":      "e2e/fixtures/auth_hos.json",
}

def save_auth(role: str) -> None:
    url  = ROLE_URLS[role]
    path = OUTPUT_FILES[role]
    os.makedirs("e2e/fixtures", exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page    = context.new_page()
        page.goto(url)
        print(f"\n>>> 浏览器已打开 {url}")
        print(f">>> 请手动完成 OTP 登录，登录成功后回到终端按 Enter ...")
        input()
        context.storage_state(path=path)
        print(f">>> Auth state 已保存到 {path}")
        browser.close()

if __name__ == "__main__":
    role = sys.argv[1] if len(sys.argv) > 1 else "ops"
    if role not in ROLE_URLS:
        print(f"Unknown role: {role}. Choose from: {list(ROLE_URLS)}")
        sys.exit(1)
    save_auth(role)
