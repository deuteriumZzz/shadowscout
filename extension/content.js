// Fills the bet-slip's stake input with a number, on message from popup.js.
// Never touches a confirm/place-bet button or submits anything — filling
// the amount is the entire scope; the user always makes the final click
// themselves. See README.md's Disclaimer and PRODUCT.md for why that line
// is deliberate, not an oversight.
//
// SELECTORS is null for every site until real markup from a logged-in
// account confirms the actual DOM (see extension/README.md) — guessing a
// selector for a real-money form is worse than admitting it isn't done yet.
const SELECTORS_BY_HOST = {
  "1xbet.com": null,
  "fonbet.ru": null,
  "bet365.com": null,
  "winline.ru": null,
};

function currentSiteKey() {
  return Object.keys(SELECTORS_BY_HOST).find((host) => location.hostname.endsWith(host));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "FILL_STAKE") return;

  const site = currentSiteKey();
  const selectors = site ? SELECTORS_BY_HOST[site] : null;
  if (!selectors) {
    sendResponse({ ok: false, error: `${site ?? location.hostname}: адаптер ещё не настроен — нужна разметка купона` });
    return;
  }

  const input = document.querySelector(selectors.stakeInput);
  if (!input) {
    sendResponse({ ok: false, error: "Поле суммы не найдено на странице — открой купон со сделанной ставкой" });
    return;
  }

  input.focus();
  input.value = String(msg.stake);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  sendResponse({ ok: true });
});
