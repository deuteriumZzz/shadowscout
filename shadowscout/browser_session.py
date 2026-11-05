"""Opens a real Chrome window on your bookmaker, logged in via a persistent
profile dir — you log in by hand once (password, 2FA, captcha, all in your
hands), Chrome remembers the session after that via cookies on disk. No
password is ever read, stored, or typed by this code.

Same shape as CrossJob-AI's GetMatchSession/RabotaRuSession (plain selenium +
persistent profile, manual login) — not LinkedInSession's
undetected-chromedriver: that library exists specifically to defeat
anti-bot fingerprinting, and doing that against a real-money betting account
is a different risk than doing it against a job board.

SITES below are homepages, not deep links to search/live-odds — I have no
way to verify a given bookmaker's URL scheme (1xbet in particular runs on
shifting mirror domains by region), and a wrong guessed deep link fails
silently. Point each entry at whatever URL actually works for your account.
"""

from __future__ import annotations

from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

SITES = {
    "1xbet": "https://1xbet.com",
    "fonbet": "https://fonbet.ru",
    "bet365": "https://www.bet365.com",
    "leon": "https://leon.ru",
    "winline": "https://winline.ru",
}

PROFILE_ROOT = Path(".bookmaker_profiles")

# ponytail: module-level, so a driver stays referenced (and its Chrome
# window open) across calls within the bot process instead of being
# garbage-collected between "Ставлю" clicks.
_active: dict[str, webdriver.Chrome] = {}


def open_bookmaker(site_key: str) -> None:
    """Reuses the already-open window for `site_key` if there is one,
    otherwise launches Chrome on its persistent profile and navigates to the
    site. Never touches the bet slip — finding the match and confirming the
    stake stays on you."""
    if site_key not in SITES:
        raise ValueError(f"Unknown bookmaker {site_key!r}, known: {list(SITES)}")

    driver = _active.get(site_key)
    if driver is not None:
        try:
            driver.get(SITES[site_key])
            return
        except Exception:
            _active.pop(site_key, None)

    profile_dir = PROFILE_ROOT / site_key
    profile_dir.mkdir(parents=True, exist_ok=True)
    options = Options()
    options.add_argument(f"--user-data-dir={profile_dir.resolve()}")
    options.add_argument("--start-maximized")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    driver.get(SITES[site_key])
    _active[site_key] = driver


def demo():
    try:
        open_bookmaker("not_a_real_site")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unknown site")
    assert set(SITES) == {"1xbet", "fonbet", "bet365", "leon", "winline"}
    print("ok")


if __name__ == "__main__":
    demo()
