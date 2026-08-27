"""Real-browser T4 recovery flows using the locally installed Playwright runtime."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from playwright.sync_api import expect, sync_playwright


REPO = Path(__file__).resolve().parent.parent
CONTROL_TOKEN = "t4-playwright-control-token"


def file_hash(file_path):
    if not file_path.exists():
        return None
    return hashlib.sha256(file_path.read_bytes()).hexdigest()


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def chrome_executable():
    candidates = [
        os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
        os.environ.get("CHROME_PATH"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("未找到可供 Playwright 启动的 Chrome/Edge")


class LocalServer:
    def __init__(self, root, port):
        self.root = Path(root)
        self.port = port
        self.process = None

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.port}"

    def start(self):
        assert self.process is None
        environment = os.environ.copy()
        environment.update({
            "PORT": str(self.port),
            "HOST": "127.0.0.1",
            "NO_OPEN": "1",
            "README_FILE": str(self.root / "DATA.md"),
            "ENTRIES_DIR": str(self.root / "entries"),
            "TRASH_DIR": str(self.root / "trash"),
            "BRAINSTORM_DIR": str(self.root / "brainstorms"),
            "RECOVERED_ORPHANS_DIR": str(self.root / "recovered-orphans"),
            "AUDIT_LOG_FILE": str(self.root / "audit.log"),
            "SERVER_ERROR_LOG_FILE": str(self.root / "server-error.log"),
            "LINGGAN_API_TOKEN": CONTROL_TOKEN,
            "DINGTALK_CLIENT_ID": "",
            "DINGTALK_CLIENT_SECRET": "",
            "WECOM_CORP_ID": "",
            "WECOM_SECRET": "",
        })
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            [os.environ.get("NODE", "node"), str(REPO / "server.js")],
            cwd=REPO,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        deadline = time.time() + 12
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"server exited before ready: {self.process.returncode}")
            try:
                with urllib.request.urlopen(self.origin + "/", timeout=0.5) as response:
                    if response.status == 200:
                        return
            except (OSError, urllib.error.URLError):
                time.sleep(0.05)
        raise RuntimeError("server readiness timeout")

    def terminate_external_session(self):
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=8)
        self.process = None

    def stop(self):
        if self.process is None:
            return
        process = self.process
        if process.poll() is None:
            request = urllib.request.Request(
                self.origin + "/api/control/shutdown",
                data=b"{}",
                method="POST",
                headers={"X-Linggan-Token": CONTROL_TOKEN, "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(request, timeout=2) as response:
                    assert response.status == 202
            except (OSError, urllib.error.URLError):
                process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        self.process = None


def api(page, route, method="GET", body=None):
    return page.evaluate(
        """async ({route, method, body}) => {
          const options = { method, headers: {} };
          if (body !== null) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
          }
          const response = await fetch(route, options);
          return { status: response.status, body: await response.json() };
        }""",
        {"route": route, "method": method, "body": body},
    )


def run():
    real_data = REPO / "DATA.md"
    real_before = file_hash(real_data)
    root = Path(tempfile.mkdtemp(prefix="linggan-t4-playwright-可信恢复-"))
    data_file = root / "DATA.md"
    data_file.write_text(
        "# E2E\n\n## 1. AI 工具\n\n"
        "### ⏳ 1.1 恢复 <img src=x onerror=alert(1)>\n"
        "- **作者 / 来源**：[fixture](https://example.invalid)\n"
        "- **研究要点**：待补充\n",
        encoding="utf-8",
    )
    for directory in ("entries", "trash", "brainstorms", "recovered-orphans"):
        (root / directory).mkdir(parents=True, exist_ok=True)

    server = LocalServer(root, free_port())
    try:
        server.start()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chrome_executable(), headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            page = context.new_page()
            page.goto(server.origin, wait_until="networkidle")
            page.evaluate("""() => {
              localStorage.setItem("linggan_onboarding_v2_seen", "1");
              document.querySelector("#onboardingModal").classList.remove("open");
            }""")

            expect(page.locator("#trustRail")).to_have_attribute("data-state", "healthy")
            assert page.locator("[onerror]").count() == 0, "恢复文本生成了事件属性"
            api_state = api(page, "/api/recovery/status")["body"]["state"]
            assert api_state == page.locator("#trustRail").get_attribute("data-state")

            page.locator("#trustCenterBtn").focus()
            page.keyboard.press("Enter")
            expect(page.locator("#recoveryModal")).to_have_class("modal-overlay recovery-overlay open")
            expect(page.locator("#recoveryTitle")).to_have_text("数据健康")
            expect(page.locator("#recoveryConfirmBtn")).to_be_disabled()
            page.keyboard.press("Escape")
            expect(page.locator("#recoveryModal")).not_to_have_class("modal-overlay recovery-overlay open")
            expect(page.locator("#trustCenterBtn")).to_be_focused()

            page.route(
                "**/api/recovery/status",
                lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "state": "forged"})),
            )
            page.locator("#trustCenterBtn").click()
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "failed")
            page.unroute("**/api/recovery/status")
            page.locator("#recoveryRefreshBtn").click()
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "healthy")
            page.keyboard.press("Escape")

            exported = api(page, "/api/backup")["body"]
            prepared = api(page, "/api/backup/prepare", "POST", {"requestId": str(uuid.uuid4()), "bundle": exported})
            assert prepared["status"] == 201, prepared
            transaction_id = prepared["body"]["transactionId"]
            recovery_status = api(page, "/api/recovery/status")["body"]
            confirmation = next(item for item in recovery_status["confirmations"] if item["action"] == "backup/commit" and item["targetKey"] == transaction_id)
            committed = api(page, "/api/backup/commit", "POST", {
                "requestId": str(uuid.uuid4()),
                "transactionId": transaction_id,
                "confirmationToken": confirmation["token"],
            })
            assert committed["status"] == 200 and committed["body"]["verified"] is True, committed

            journal_file = root / ".linggan" / "import-transactions" / transaction_id / "transaction.json"
            journal = json.loads(journal_file.read_text(encoding="utf-8"))
            journal["state"] = "manual_recovery"
            journal["terminalResult"] = None
            journal_file.write_text(json.dumps(journal, ensure_ascii=False), encoding="utf-8")

            page.locator("#trustCenterBtn").click()
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "action_required")
            candidate = page.locator('#recoveryCandidateList input[name="recoveryCandidate"]').first
            expect(candidate).to_be_visible()
            candidate.check()
            page.locator("#recoveryPreviewBtn").click()
            expect(page.locator("#recoveryPreview")).to_be_visible()
            expect(page.locator("#recoveryPreviewText")).to_contain_text("磁盘修改：否")
            expect(page.locator("#recoveryConfirmBtn")).to_be_enabled()
            page.locator("#recoveryConfirmBtn").click()
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "verified")
            expect(page.locator("#toast")).to_contain_text("已恢复并通过写后验证")

            page.reload(wait_until="networkidle")
            page.evaluate("document.querySelector('#onboardingModal').classList.remove('open')")
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "verified")

            server.terminate_external_session()
            server.start()
            renewed = page.evaluate("""async () => {
              const response = await localApiFetch("/api/upgrade/preview", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
              });
              return { status: response.status, body: await response.json() };
            }""")
            assert renewed["status"] == 200 and renewed["body"]["dryRun"] is True, renewed
            page.evaluate("loadTrustedState({ focusError: true })")
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "healthy")
            page.locator("#trustCenterBtn").click()
            expect(page.locator("#recoveryModal")).to_have_class("modal-overlay recovery-overlay open")

            page.set_viewport_size({"width": 390, "height": 844})
            page.emulate_media(reduced_motion="reduce")
            expect(page.locator("#recoveryRefreshBtn")).to_be_visible()
            expect(page.locator("#recoveryPreviewBtn")).to_be_visible()
            animation_name = page.locator(".recovery-modal").evaluate("element => getComputedStyle(element).animationName")
            assert animation_name == "none"

            context.set_offline(True)
            page.locator("#recoveryRefreshBtn").click()
            expect(page.locator("#recoveryError")).to_be_visible()
            expect(page.locator("#recoveryError")).to_be_focused()
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "failed")
            context.set_offline(False)
            page.locator("#recoveryRefreshBtn").click()
            expect(page.locator("#trustRail")).to_have_attribute("data-state", "healthy")

            context.close()
            browser.close()
            print("e2e: real Playwright desktop/recovery/restart/390px/reduced-motion/offline PASS")
    finally:
        server.stop()
        assert file_hash(real_data) == real_before, "Playwright E2E 修改了真实 DATA.md"
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    run()
