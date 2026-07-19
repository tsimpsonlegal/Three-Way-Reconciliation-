"""Browser automation for Qualia (dds.qualia.io).

Playwright's sync API must be used from the thread that created it, so all
browser work runs on a single dedicated worker thread. Public methods post a
command onto a queue and block on a Future for the result, which makes the
bot safe to call from any web-server request thread.

The bot NEVER clicks a final Save/Create button on its own path through a
form — filling and saving are separate commands so the user can visually
review the Qualia window between the two.
"""

import base64
import queue
import threading
from concurrent.futures import Future


class BotError(Exception):
    """Raised for expected automation failures with a user-facing message."""


# Candidate texts for navigation links / buttons inside a Qualia order.
PAYOFFS_NAV_TEXTS = ["Payoffs", "Payoff"]
DISBURSEMENT_NAV_TEXTS = ["Disbursements", "Disbursement", "Balancing & Disbursements"]
ADD_BUTTON_TEXTS = ["Add Payoff", "New Payoff", "Add a Payoff", "Add Disbursement",
                    "New Disbursement", "Add", "New", "Create"]
SAVE_BUTTON_TEXTS = ["Save", "Create", "Add Payoff", "Add Disbursement", "Done", "Submit"]


class QualiaBot:
    def __init__(self, base_url="https://dds.qualia.io"):
        self.base_url = base_url.rstrip("/")
        self._q = queue.Queue()
        self._closed = False
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._ready = Future()
        self._thread.start()
        # Surface browser-launch errors to the caller immediately.
        self._ready.result(timeout=120)

    # ------------------------------------------------------------------ API
    # Each public method runs its underscore twin on the worker thread.

    def login(self, username, password):
        return self._call("login", username, password)

    def login_status(self):
        return self._call("login_status")

    def lookup_order(self, file_number):
        return self._call("lookup_order", file_number, timeout=180)

    def open_section(self, section):
        return self._call("open_section", section, timeout=120)

    def fill_fields(self, field_map):
        return self._call("fill_fields", field_map, timeout=300)

    def click_save(self):
        return self._call("click_save")

    def screenshot(self):
        return self._call("screenshot")

    def close(self):
        if self._closed:
            return
        self._closed = True
        fut = Future()
        self._q.put(("__close__", (), fut))
        try:
            fut.result(timeout=30)
        except Exception:
            pass

    @property
    def alive(self):
        return self._thread.is_alive() and not self._closed

    # ------------------------------------------------------- worker plumbing
    def _call(self, name, *args, timeout=90):
        if self._closed:
            raise BotError("The browser session has been closed. Please reconnect.")
        fut = Future()
        self._q.put((name, args, fut))
        return fut.result(timeout=timeout)

    def _worker(self):
        try:
            from playwright.sync_api import sync_playwright
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(
                headless=False, args=["--start-maximized"]
            )
            self._ctx = self._browser.new_context(no_viewport=True)
            self.page = self._ctx.new_page()
            self._ready.set_result(True)
        except Exception as exc:  # pragma: no cover - environment dependent
            self._ready.set_exception(exc)
            return

        while True:
            name, args, fut = self._q.get()
            if name == "__close__":
                try:
                    self._browser.close()
                    self._pw.stop()
                except Exception:
                    pass
                fut.set_result(True)
                return
            try:
                fut.set_result(getattr(self, "_" + name)(*args))
            except BotError as exc:
                fut.set_exception(exc)
            except Exception as exc:
                fut.set_exception(BotError(f"Browser automation error: {exc}"))

    # --------------------------------------------------------------- helpers
    def _first_visible(self, locator):
        """Return the first visible element of a locator, or None."""
        try:
            n = locator.count()
        except Exception:
            return None
        for i in range(min(n, 10)):
            item = locator.nth(i)
            try:
                if item.is_visible():
                    return item
            except Exception:
                continue
        return None

    def _screenshot_b64(self, full_page=False):
        try:
            png = self.page.screenshot(full_page=full_page)
            return base64.b64encode(png).decode("ascii")
        except Exception:
            return None

    # --------------------------------------------------------------- actions
    def _login(self, username, password):
        page = self.page
        page.goto(self.base_url + "/login", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)

        user_input = (
            self._first_visible(page.locator("input[type='email']"))
            or self._first_visible(page.locator(
                "input[name*='email' i], input[name*='user' i], "
                "input[placeholder*='email' i], input[placeholder*='user' i]"))
            or self._first_visible(page.locator("input[type='text']"))
        )
        if user_input is None:
            raise BotError(
                "Could not find the username field on the Qualia login page. "
                "The page may still be loading — try Connect again, or log in "
                "manually in the Chrome window and then continue.")
        user_input.fill(username)

        pw_input = self._first_visible(page.locator("input[type='password']"))
        if pw_input is None:
            # Some login flows ask for the email first, then the password.
            user_input.press("Enter")
            page.wait_for_timeout(2500)
            pw_input = self._first_visible(page.locator("input[type='password']"))
        if pw_input is None:
            raise BotError(
                "Could not find the password field. Log in manually in the "
                "Chrome window, then click Continue in the app.")
        pw_input.fill(password)
        pw_input.press("Enter")
        page.wait_for_timeout(4000)
        return self._login_status()

    def _login_status(self):
        page = self.page
        url = page.url or ""
        on_login = "/login" in url or "sign" in url.lower()
        has_password_box = self._first_visible(
            page.locator("input[type='password']")) is not None
        logged_in = not (on_login and has_password_box)
        return {
            "logged_in": logged_in,
            "url": url,
            "screenshot": self._screenshot_b64(),
        }

    def _lookup_order(self, file_number):
        page = self.page
        file_number = file_number.strip()

        # Land somewhere with the global search / orders list available.
        for path in ("/orders", "/"):
            try:
                page.goto(self.base_url + path, wait_until="domcontentloaded",
                          timeout=45000)
                page.wait_for_timeout(2000)
                break
            except Exception:
                continue

        search = (
            self._first_visible(page.locator(
                "input[placeholder*='search' i], input[type='search'], "
                "input[aria-label*='search' i]"))
        )
        if search is not None:
            search.click()
            search.fill(file_number)
            page.wait_for_timeout(2500)
            search.press("Enter")
            page.wait_for_timeout(3000)

        # Click something that displays the exact file number.
        target = self._first_visible(
            page.get_by_text(file_number, exact=True))
        if target is None:
            target = self._first_visible(
                page.get_by_text(file_number, exact=False))
        clicked = False
        if target is not None:
            try:
                target.click()
                page.wait_for_timeout(3500)
                clicked = True
            except Exception:
                clicked = False

        body_text = ""
        try:
            body_text = page.locator("body").inner_text(timeout=5000)
        except Exception:
            pass
        found = file_number in body_text

        headings = []
        try:
            for h in page.locator("h1, h2, h3").all()[:8]:
                try:
                    t = h.inner_text().strip()
                    if t and t not in headings:
                        headings.append(t)
                except Exception:
                    continue
        except Exception:
            pass

        return {
            "found": found,
            "clicked_result": clicked,
            "url": page.url,
            "title": page.title(),
            "headings": headings,
            "screenshot": self._screenshot_b64(),
        }

    def _open_section(self, section):
        page = self.page
        texts = PAYOFFS_NAV_TEXTS if section == "payoff" else DISBURSEMENT_NAV_TEXTS
        nav_clicked = None
        for text in texts:
            link = self._first_visible(
                page.locator("a, button, [role='tab'], [role='link'], li, span")
                .filter(has_text=text))
            if link is not None:
                try:
                    link.click()
                    page.wait_for_timeout(2500)
                    nav_clicked = text
                    break
                except Exception:
                    continue

        add_clicked = None
        for text in ADD_BUTTON_TEXTS:
            btn = self._first_visible(
                page.locator("button, a, [role='button']").filter(has_text=text))
            if btn is not None:
                try:
                    btn.click()
                    page.wait_for_timeout(2000)
                    add_clicked = text
                    break
                except Exception:
                    continue

        return {
            "nav_clicked": nav_clicked,
            "add_clicked": add_clicked,
            "url": page.url,
            "screenshot": self._screenshot_b64(),
        }

    def _fill_fields(self, field_map):
        """field_map: list of {key, labels: [...], value} dicts.

        Tries several strategies per field. Returns per-field success so the
        UI can show exactly what still needs to be entered by hand.
        """
        results = []
        for field in field_map:
            value = (field.get("value") or "").strip()
            if not value:
                results.append({"key": field["key"], "filled": False,
                                "skipped": True})
                continue
            ok = False
            for label in field.get("labels", []):
                if self._fill_one(label, value):
                    ok = True
                    break
            results.append({"key": field["key"], "filled": ok,
                            "skipped": False})
        return {"results": results, "screenshot": self._screenshot_b64()}

    def _fill_one(self, label, value):
        page = self.page
        # Strategy 1: accessible label association.
        try:
            loc = page.get_by_label(label, exact=False)
            el = self._first_visible(loc)
            if el is not None:
                el.fill(value)
                return True
        except Exception:
            pass
        # Strategy 2: placeholder text.
        try:
            el = self._first_visible(page.get_by_placeholder(label, exact=False))
            if el is not None:
                el.fill(value)
                return True
        except Exception:
            pass
        # Strategy 3: a <label>-ish element followed by an input in the same
        # container (common in React form kits without proper label wiring).
        try:
            lab = self._first_visible(page.locator("label", has_text=label))
            if lab is not None:
                el = self._first_visible(
                    lab.locator("xpath=following::input[not(@type='hidden')] | "
                                "following::textarea").first)
                if el is not None:
                    el.fill(value)
                    return True
        except Exception:
            pass
        return False

    def _click_save(self):
        page = self.page
        for text in SAVE_BUTTON_TEXTS:
            btn = self._first_visible(
                page.locator("button, [role='button'], input[type='submit']")
                .filter(has_text=text))
            if btn is not None:
                try:
                    btn.click()
                    page.wait_for_timeout(2500)
                    return {"clicked": text,
                            "screenshot": self._screenshot_b64()}
                except Exception:
                    continue
        return {"clicked": None, "screenshot": self._screenshot_b64()}

    def _screenshot(self):
        return {"screenshot": self._screenshot_b64()}
