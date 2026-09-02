const apiBaseInput = document.getElementById("apiBase");
const tokenInput = document.getElementById("token");
const picksEl = document.getElementById("picks");

async function loadSettings() {
  const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
  apiBaseInput.value = apiBase ?? "";
  tokenInput.value = token ?? "";
  return { apiBase, token };
}

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ apiBase: apiBaseInput.value.trim(), token: tokenInput.value.trim() });
  loadPicks();
});

function renderPicks(picks) {
  if (!picks || picks.length === 0) {
    picksEl.innerHTML = '<p class="empty">Нет активных рекомендаций.</p>';
    return;
  }
  picksEl.innerHTML = "";
  for (const p of picks) {
    const div = document.createElement("div");
    div.className = "pick";
    div.innerHTML = `
      <span class="match">${p.match}</span>
      <span class="details">${p.market_label} · ${p.pick} · кэф ${p.odds ?? "?"} · ставка ${p.stake ?? "?"}</span>
      <button data-stake="${p.stake ?? ""}">Заполнить сумму на странице</button>
      <span class="status"></span>
    `;
    const btn = div.querySelector("button");
    const status = div.querySelector(".status");
    btn.addEventListener("click", async () => {
      const stake = Number(btn.dataset.stake);
      if (!stake) {
        status.textContent = "Нет рекомендованной суммы для этого пика.";
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, { type: "FILL_STAKE", stake }, (response) => {
        if (chrome.runtime.lastError) {
          status.textContent = "Открой вкладку букмекера — расширение туда не встроено.";
          return;
        }
        status.textContent = response?.ok ? "Сумма подставлена. Проверь и подтверди ставку сам(а)." : (response?.error ?? "Не удалось");
      });
    });
    picksEl.appendChild(div);
  }
}

async function loadPicks() {
  const { apiBase, token } = await loadSettings();
  if (!apiBase || !token) {
    picksEl.innerHTML = '<p class="empty">Заполни адрес API и токен выше.</p>';
    return;
  }
  try {
    const res = await fetch(`${apiBase}/api/extension/pending-picks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      picksEl.innerHTML = `<p class="empty">Ошибка API: ${res.status}</p>`;
      return;
    }
    renderPicks(await res.json());
  } catch {
    picksEl.innerHTML = '<p class="empty">Не удалось связаться с API — проверь адрес.</p>';
  }
}

loadPicks();
