const PASSWORD = "12324";
const STORAGE_KEY = "raffle-local-cache";

const SUPABASE_URL = "https://ajdamkwsfnvtxwlocqiz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xruuPBgLYdBn3gZZnZRSAA_nDRm5zB5";
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const defaultInventory = [
  { id: crypto.randomUUID(), name: "一獎", stock: 1 },
  { id: crypto.randomUUID(), name: "二獎", stock: 3 },
  { id: crypto.randomUUID(), name: "小禮物", stock: 20 },
];

const elements = {
  winnerLabel: document.querySelector("#winnerLabel"),
  winnerName: document.querySelector("#winnerName"),
  totalStock: document.querySelector("#totalStock"),
  drawCount: document.querySelector("#drawCount"),
  drawButton: document.querySelector("#drawButton"),
  undoButton: document.querySelector("#undoButton"),
  unlockButton: document.querySelector("#unlockButton"),
  inventoryList: document.querySelector("#inventoryList"),
  inventoryForm: document.querySelector("#inventoryForm"),
  itemName: document.querySelector("#itemName"),
  itemStock: document.querySelector("#itemStock"),
  historyList: document.querySelector("#historyList"),
  exportButton: document.querySelector("#exportButton"),
  modeBadge: document.querySelector("#modeBadge"),
  modeHint: document.querySelector("#modeHint"),
  passwordDialog: document.querySelector("#passwordDialog"),
  passwordInput: document.querySelector("#passwordInput"),
  passwordSubmit: document.querySelector("#passwordSubmit"),
  passwordError: document.querySelector("#passwordError"),
};

let supabaseClient = null;
let inventory = [];
let history = [];
let unlocked = false;
let ready = false;
let statusMessage = "載入中";

function loadLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : defaultInventory,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { inventory: defaultInventory, history: [] };
  }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ inventory, history }));
}

async function connectDatabase() {
  if (SUPABASE_ENABLED) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm");
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return loadFromSupabase();
  }

  const local = loadLocal();
  inventory = local.inventory;
  history = local.history;
  ready = true;
  statusMessage = "本機模式";
  render();
}

async function loadFromSupabase() {
  const [itemsResult, logsResult] = await Promise.all([
    supabaseClient.from("raffle_items").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("raffle_logs").select("*").order("created_at", { ascending: false }),
  ]);

  if (itemsResult.error || logsResult.error) {
    throw new Error((itemsResult.error || logsResult.error).message);
  }

  inventory = itemsResult.data.map((row) => ({
    id: row.id,
    name: row.name,
    stock: row.stock,
  }));
  history = logsResult.data.map((row) => ({
    id: row.id,
    prizeId: row.prize_id,
    name: row.prize_name,
    time: new Date(row.created_at).toLocaleString("zh-TW"),
  }));

  ready = true;
  statusMessage = "雲端模式";
  render();
}

function totalStock() {
  return inventory.reduce((sum, item) => sum + item.stock, 0);
}

function setMessage(label, name) {
  elements.winnerLabel.textContent = label;
  elements.winnerName.textContent = name;
}

async function persistInventory() {
  if (!SUPABASE_ENABLED) {
    saveLocal();
    return;
  }

  const updates = inventory.map((item) =>
    supabaseClient.from("raffle_items").upsert({
      id: item.id,
      name: item.name,
      stock: item.stock,
    }),
  );
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed) throw new Error(failed.error.message);
}

async function reloadFromRemote() {
  if (!SUPABASE_ENABLED) return;
  await loadFromSupabase();
}

async function addHistoryRecord(record) {
  if (!SUPABASE_ENABLED) {
    history.unshift(record);
    saveLocal();
    return;
  }

  const { error } = await supabaseClient.from("raffle_logs").insert({
    id: record.id,
    prize_id: record.prizeId,
    prize_name: record.name,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function deleteHistoryRecord(recordId) {
  if (!SUPABASE_ENABLED) return;
  const { error } = await supabaseClient.from("raffle_logs").delete().eq("id", recordId);
  if (error) throw error;
}

async function drawPrize() {
  const total = totalStock();
  if (total <= 0) {
    setMessage("庫存不足", "沒有獎品了");
    return;
  }

  let ticket = Math.floor(Math.random() * total);
  const winner = inventory.find((item) => {
    ticket -= item.stock;
    return ticket < 0;
  });

  if (!winner) return;

  winner.stock -= 1;
  const record = {
    id: crypto.randomUUID(),
    prizeId: winner.id,
    name: winner.name,
    time: new Date().toLocaleString("zh-TW"),
  };
  history.unshift(record);
  setMessage("恭喜抽中", winner.name);
  await persistInventory();
  await addHistoryRecord(record);
  render();
}

async function undoLastDraw() {
  const last = history.shift();
  if (!last) return;
  const item = inventory.find((prize) => prize.id === last.prizeId);
  if (item) item.stock += 1;
  await persistInventory();
  await deleteHistoryRecord(last.id);
  setMessage("已復原", last.name);
  render();
}

function render() {
  elements.modeBadge.textContent = SUPABASE_ENABLED ? "雲端模式" : "本機模式";
  elements.modeHint.textContent = SUPABASE_ENABLED
    ? "資料會同步到 Supabase。"
    : "尚未設定資料庫，先用本機資料。";
  elements.totalStock.textContent = totalStock();
  elements.drawCount.textContent = history.length;
  elements.drawButton.disabled = !ready || totalStock() === 0;
  elements.undoButton.disabled = !ready || history.length === 0;
  elements.inventoryForm.classList.toggle("hidden", !unlocked);
  elements.unlockButton.textContent = unlocked ? "已解鎖" : "鎖定";
  elements.unlockButton.classList.toggle("unlocked", unlocked);
  elements.exportButton.disabled = !ready;
  elements.unlockButton.disabled = !ready;
  elements.passwordSubmit.disabled = !ready;
  elements.itemName.disabled = !ready;
  elements.itemStock.disabled = !ready;
  renderInventory();
  renderHistory();
}

function renderInventory() {
  elements.inventoryList.innerHTML = "";
  inventory.forEach((item) => {
    const row = document.createElement("div");
    row.className = "item-row";

    const name = document.createElement("strong");
    name.textContent = item.name;

    const controls = document.createElement("div");
    controls.className = "item-controls";

    if (unlocked) {
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = item.stock;
      input.addEventListener("change", async () => {
        item.stock = Math.max(0, Number.parseInt(input.value, 10) || 0);
        await persistInventory();
        render();
      });

      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-button";
      deleteButton.type = "button";
      deleteButton.textContent = "刪除";
      deleteButton.addEventListener("click", async () => {
        inventory = inventory.filter((prize) => prize.id !== item.id);
        await persistInventory();
        render();
      });

      controls.append(input, deleteButton);
    } else {
      const stock = document.createElement("strong");
      stock.textContent = `${item.stock} 個`;
      controls.append(stock);
    }

    row.append(name, controls);
    elements.inventoryList.append(row);
  });
}

function renderHistory() {
  elements.historyList.innerHTML = "";
  if (history.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "尚無紀錄";
    elements.historyList.append(empty);
    return;
  }

  history.forEach((record) => {
    const item = document.createElement("li");
    item.textContent = `${record.time} 抽中 ${record.name}`;
    elements.historyList.append(item);
  });
}

function unlockInventory() {
  if (unlocked) {
    unlocked = false;
    render();
    return;
  }
  elements.passwordInput.value = "";
  elements.passwordError.textContent = "";
  elements.passwordDialog.showModal();
  elements.passwordInput.focus();
}

async function addInventoryItem(event) {
  event.preventDefault();
  const name = elements.itemName.value.trim();
  const stock = Math.max(0, Number.parseInt(elements.itemStock.value, 10) || 0);
  if (!name) return;
  inventory.push({ id: crypto.randomUUID(), name, stock });
  elements.itemName.value = "";
  elements.itemStock.value = "1";
  await persistInventory();
  render();
}

async function exportHistory() {
  const rows = ["時間,獎品"].concat(history.map((item) => `"${item.time}","${item.name}"`));
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "抽獎紀錄.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

elements.drawButton.addEventListener("click", drawPrize);
elements.undoButton.addEventListener("click", undoLastDraw);
elements.unlockButton.addEventListener("click", unlockInventory);
elements.inventoryForm.addEventListener("submit", addInventoryItem);
elements.exportButton.addEventListener("click", exportHistory);
elements.passwordSubmit.addEventListener("click", (event) => {
  event.preventDefault();
  if (elements.passwordInput.value === PASSWORD) {
    unlocked = true;
    elements.passwordDialog.close();
    render();
  } else {
    elements.passwordError.textContent = "密碼錯誤";
  }
});

setMessage("準備中", "正在連線");
connectDatabase().catch((error) => {
  inventory = defaultInventory;
  history = [];
  ready = true;
  statusMessage = `連線失敗，改用本機模式`;
  setMessage("連線失敗", error.message || "資料庫連線失敗");
  saveLocal();
  render();
});

render();
