/* app.js — PWA Tracker Scommesse (offline-first) con BOOKMAKERS + bankroll separato
   Versione storage: ts_v6 (migra da ts_v5/precedenti)

   ✅ Include:
   - Bookmakers con budget separato + disponibile per book
   - Bets con bookmaker obbligatorio
   - Stake scalato SOLO dal book selezionato quando la bet è “In corso”
   - Chiusura: Vinta/Persa/Void/Cashout con rientro sullo stesso book
   - Stake limitato al disponibile (mai negativo)
   - Disponibile totale = somma disponibili book
   - ROI calcolabile sul bankroll iniziale (non sul puntato) + stats base
   - Export/Import JSON
*/

/* -------------------- PWA offline -------------------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

/* -------------------- Helpers -------------------- */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const n2 = (x) => {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
};

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function clamp(min, v, max) {
  return Math.max(min, Math.min(max, v));
}

function isoNow() {
  return new Date().toISOString();
}

function toISODateOnly(d = new Date()) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---- Money/Percent format (it-IT) + NBSP dopo valuta ---- */
function fmt2(n) {
  const val = n2(n);
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

const money = (n, currency = "€") => `${currency}\u00A0${fmt2(n)}`;
const pct = (n) => `${fmt2(n)}%`;

/* -------------------- Storage + State -------------------- */
const KEY = "ts_v6";
const OLD_KEYS = ["ts_v5", "ts_v4", "ts_v3", "ts_v2", "ts_v1", "ts_v0", "ts"];

const DEFAULT = {
  schema: 6,
  settings: {
    currency: "€",
    // ROI mode:
    // - "bankroll_start": ROI = profit / bankroll iniziale
    // - "staked": ROI = profit / stake totale (classico)
    roiMode: "bankroll_start",
  },
  // mantenuto per compatibilità (il bankroll reale è la somma dei budgetStart dei bookmakers)
  budgetStart: 0,
  bookmakers: [],
  tipsters: [],
  transactions: [], // {id, bookmakerId, type:'deposit'|'withdraw'|'adjust', amount, date, note}
  bets: [],
};

let STATE = loadState();

/* -------------------- Normalizzazione + Migrazione -------------------- */
function normalizeState(s) {
  const state = (s && typeof s === "object") ? s : structuredClone(DEFAULT);

  if (!state.settings || typeof state.settings !== "object") state.settings = structuredClone(DEFAULT.settings);
  if (!state.settings.currency) state.settings.currency = "€";
  if (!state.settings.roiMode) state.settings.roiMode = "bankroll_start";

  if (!Array.isArray(state.bookmakers)) state.bookmakers = [];
  if (!Array.isArray(state.tipsters)) state.tipsters = [];
  if (!Array.isArray(state.transactions)) state.transactions = [];
  if (!Array.isArray(state.bets)) state.bets = [];

  if (typeof state.budgetStart !== "number") state.budgetStart = Number(state.budgetStart) || 0;

  // Normalizza bookmakers
  state.bookmakers = state.bookmakers
    .filter(Boolean)
    .map((b) => ({
      id: String(b.id || uid()),
      name: String(b.name || "Bookmaker"),
      budgetStart: n2(b.budgetStart ?? 0),
      available: n2(b.available ?? b.budgetStart ?? 0),
      createdAt: b.createdAt || isoNow(),
    }));

  // Normalizza transactions
  state.transactions = state.transactions
    .filter(Boolean)
    .map((t) => ({
      id: String(t.id || uid()),
      bookmakerId: String(t.bookmakerId || ""),
      type: (t.type === "withdraw" || t.type === "adjust") ? t.type : "deposit",
      amount: n2(t.amount ?? 0),
      date: t.date || toISODateOnly(),
      note: String(t.note || ""),
      createdAt: t.createdAt || isoNow(),
    }))
    .filter((t) => !!t.bookmakerId);

  // Normalizza tipsters
  state.tipsters = state.tipsters
    .filter(Boolean)
    .map((t) => ({
      id: String(t.id || uid()),
      name: String(t.name || "Tipster"),
      note: String(t.note || ""),
      createdAt: t.createdAt || isoNow(),
    }));

  // Normalizza bets
  state.bets = state.bets
    .filter(Boolean)
    .map(normalizeBet)
    .filter((b) => !!b.bookmakerId);

  return state;
}

function normalizeBet(b) {
  const statusRaw = String(b.status || b.stato || "open").toLowerCase();
  const status = (statusRaw === "closed" || statusRaw === "chiusa") ? "closed" : "open";

  const resultRaw = String(b.result || b.esito || "").toLowerCase();
  const result =
    (resultRaw === "win" || resultRaw === "vinta") ? "win" :
    (resultRaw === "lose" || resultRaw === "persa") ? "lose" :
    (resultRaw === "void") ? "void" :
    (resultRaw === "cashout") ? "cashout" :
    (status === "closed" ? "win" : "");

  const openedAt = b.openedAt || b.date || toISODateOnly();
  const closedAt = b.closedAt || (status === "closed" ? (b.date || toISODateOnly()) : "");

  const stake = n2(b.stake ?? b.puntata ?? 0);
  const odds = n2(b.odds ?? b.quota ?? 0);
  const cashoutReturn = n2(b.cashoutReturn ?? b.cashout ?? 0);

  const typeRaw = String(b.type || b.tipo || "singola").toLowerCase();
  const type =
    (typeRaw === "multipla" || typeRaw === "combo" || typeRaw === "parlay") ? "multipla" :
    (typeRaw === "sistema") ? "sistema" :
    (typeRaw === "lay") ? "lay" :
    (typeRaw === "back") ? "back" :
    "singola";

  const tags = Array.isArray(b.tags)
    ? b.tags.map(String)
    : String(b.tags || "").split(",").map(s => s.trim()).filter(Boolean);

  const legs = Array.isArray(b.legs) ? b.legs.map((l) => ({
    event: String(l.event || ""),
    market: String(l.market || ""),
    pick: String(l.pick || ""),
    odds: n2(l.odds ?? 0),
  })) : [];

  return {
    id: String(b.id || uid()),
    bookmakerId: String(b.bookmakerId || b.book || ""),
    tipsterId: String(b.tipsterId || ""),
    sport: String(b.sport || ""),
    competition: String(b.competition || ""),
    type,
    stake,
    odds,
    status,
    result,
    cashoutReturn,
    note: String(b.note || ""),
    tags,
    legs,
    openedAt,
    closedAt,
    createdAt: b.createdAt || isoNow(),
    updatedAt: b.updatedAt || isoNow(),
  };
}

function loadState() {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const s = normalizeState(safeParse(raw));
    recomputeAllBalances(s);
    saveState(s);
    return s;
  }

  for (const k of OLD_KEYS) {
    const oldRaw = localStorage.getItem(k);
    if (!oldRaw) continue;
    const old = safeParse(oldRaw);

    const migrated = migrateToV6(old);
    const s = normalizeState(migrated);
    recomputeAllBalances(s);
    saveState(s);
    return s;
  }

  const fresh = normalizeState(structuredClone(DEFAULT));
  ensureAtLeastOneBookmaker(fresh);
  recomputeAllBalances(fresh);
  saveState(fresh);
  return fresh;
}

function saveState(s = STATE) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.error("Errore salvataggio localStorage:", e);
  }
}

function migrateToV6(old) {
  const base = structuredClone(DEFAULT);
  if (!old || typeof old !== "object") return base;

  if (old.settings && typeof old.settings === "object") {
    base.settings = { ...base.settings, ...old.settings };
  }

  base.budgetStart = n2(old.budgetStart ?? old.bankrollStart ?? old.budget ?? 0);

  if (Array.isArray(old.bookmakers) && old.bookmakers.length) {
    base.bookmakers = old.bookmakers;
    base.transactions = Array.isArray(old.transactions) ? old.transactions : [];
  } else {
    base.bookmakers = [{
      id: uid(),
      name: "Main",
      budgetStart: base.budgetStart,
      available: base.budgetStart,
      createdAt: isoNow(),
    }];
  }

  if (Array.isArray(old.tipsters)) base.tipsters = old.tipsters;

  const fallbackBookId = (base.bookmakers[0] && base.bookmakers[0].id) ? base.bookmakers[0].id : "";
  if (Array.isArray(old.bets)) {
    base.bets = old.bets.map((b) => ({
      ...b,
      bookmakerId: b.bookmakerId || b.bookmaker || b.book || fallbackBookId,
    }));
  }

  return base;
}

function ensureAtLeastOneBookmaker(s = STATE) {
  if (!Array.isArray(s.bookmakers) || s.bookmakers.length === 0) {
    s.bookmakers = [{
      id: uid(),
      name: "Main",
      budgetStart: n2(s.budgetStart || 0),
      available: n2(s.budgetStart || 0),
      createdAt: isoNow(),
    }];
  }
}

/* -------------------- Bankroll engine -------------------- */
function recomputeAllBalances(s = STATE) {
  ensureAtLeastOneBookmaker(s);

  const map = new Map();
  for (const b of s.bookmakers) {
    map.set(b.id, { ...b, available: n2(b.budgetStart) });
  }

  for (const t of s.transactions) {
    const bk = map.get(t.bookmakerId);
    if (!bk) continue;
    if (t.type === "deposit") bk.available = n2(bk.available + t.amount);
    else if (t.type === "withdraw") bk.available = n2(bk.available - t.amount);
    else if (t.type === "adjust") bk.available = n2(bk.available + t.amount);
  }

  const events = [];
  for (const bet of s.bets) {
    const opened = bet.openedAt || bet.createdAt || toISODateOnly();
    events.push({ when: opened, kind: "open", betId: bet.id });

    if (bet.status === "closed") {
      const closed = bet.closedAt || opened;
      events.push({ when: closed, kind: "close", betId: bet.id });
    }
  }

  events.sort((a, b) => String(a.when).localeCompare(String(b.when)));

  const byId = new Map(s.bets.map((b) => [b.id, b]));

  for (const ev of events) {
    const bet = byId.get(ev.betId);
    if (!bet) continue;
    const bk = map.get(bet.bookmakerId);
    if (!bk) continue;

    if (ev.kind === "open") {
      const stake = Math.max(0, n2(bet.stake));
      const used = clamp(0, stake, bk.available);
      bk.available = n2(bk.available - used);
    } else {
      const stake = Math.max(0, n2(bet.stake));
      const odds = Math.max(0, n2(bet.odds));
      const r = bet.result;

      if (r === "win") {
        bk.available = n2(bk.available + (stake * odds));
      } else if (r === "void") {
        bk.available = n2(bk.available + stake);
      } else if (r === "cashout") {
        const ret = n2(bet.cashoutReturn || 0) || stake;
        bk.available = n2(bk.available + ret);
      }
    }

    bk.available = Math.max(0, n2(bk.available));
  }

  s.bookmakers = Array.from(map.values()).map((b) => ({
    ...b,
    available: n2(b.available),
  }));

  s.budgetStart = n2(s.bookmakers.reduce((sum, b) => sum + n2(b.budgetStart), 0));
}

/* -------------------- CRUD Bookmakers -------------------- */
function addBookmaker(name, budgetStart) {
  const b = {
    id: uid(),
    name: String(name || "Bookmaker"),
    budgetStart: n2(budgetStart || 0),
    available: n2(budgetStart || 0),
    createdAt: isoNow(),
  };
  STATE.bookmakers.push(b);
  recomputeAllBalances(STATE);
  saveAndRender();
  return b.id;
}

function updateBookmaker(bookmakerId, patch = {}) {
  const i = STATE.bookmakers.findIndex((b) => b.id === bookmakerId);
  if (i < 0) return;
  const cur = STATE.bookmakers[i];
  STATE.bookmakers[i] = {
    ...cur,
    name: patch.name != null ? String(patch.name) : cur.name,
    budgetStart: patch.budgetStart != null ? n2(patch.budgetStart) : cur.budgetStart,
  };
  recomputeAllBalances(STATE);
  saveAndRender();
}

function deleteBookmaker(bookmakerId) {
  const usedInBets = STATE.bets.some((b) => b.bookmakerId === bookmakerId);
  const usedInTx = STATE.transactions.some((t) => t.bookmakerId === bookmakerId);
  if (usedInBets || usedInTx) {
    alert("Non puoi eliminare questo bookmaker: è usato da bet o movimenti.");
    return;
  }
  STATE.bookmakers = STATE.bookmakers.filter((b) => b.id !== bookmakerId);
  ensureAtLeastOneBookmaker(STATE);
  recomputeAllBalances(STATE);
  saveAndRender();
}

/* -------------------- CRUD Bets -------------------- */
function addBet(betInput) {
  const bet = normalizeBet({
    ...betInput,
    id: uid(),
    createdAt: isoNow(),
    updatedAt: isoNow(),
  });

  const bk = STATE.bookmakers.find((b) => b.id === bet.bookmakerId);
  if (!bk) {
    alert("Bookmaker non valido.");
    return null;
  }

  if (bet.status === "open") {
    const maxStake = n2(bk.available);
    if (bet.stake > maxStake) bet.stake = maxStake;
  }

  STATE.bets.unshift(bet);
  recomputeAllBalances(STATE);
  saveAndRender();
  return bet.id;
}

function updateBet(betId, patch = {}) {
  const i = STATE.bets.findIndex((b) => b.id === betId);
  if (i < 0) return;

  const merged = normalizeBet({
    ...STATE.bets[i],
    ...patch,
    id: betId,
    updatedAt: isoNow(),
  });

  const bk = STATE.bookmakers.find((b) => b.id === merged.bookmakerId);
  if (bk && merged.status === "open") {
    const prev = STATE.bets[i];
    const prevStake = n2(prev.stake || 0);
    const estAvail = n2(bk.available + prevStake);
    merged.stake = clamp(0, n2(merged.stake), estAvail);
  }

  STATE.bets[i] = merged;
  recomputeAllBalances(STATE);
  saveAndRender();
}

function deleteBet(betId) {
  STATE.bets = STATE.bets.filter((b) => b.id !== betId);
  recomputeAllBalances(STATE);
  saveAndRender();
}

/* -------------------- Transactions (opzionale) -------------------- */
function addTransaction(bookmakerId, type, amount, date, note = "") {
  const tx = {
    id: uid(),
    bookmakerId,
    type: (type === "withdraw" || type === "adjust") ? type : "deposit",
    amount: n2(amount),
    date: date || toISODateOnly(),
    note: String(note || ""),
    createdAt: isoNow(),
  };
  STATE.transactions.unshift(tx);
  recomputeAllBalances(STATE);
  saveAndRender();
}

function deleteTransaction(txId) {
  STATE.transactions = STATE.transactions.filter((t) => t.id !== txId);
  recomputeAllBalances(STATE);
  saveAndRender();
}

/* -------------------- Stats -------------------- */
function calcBetProfit(b) {
  const stake = Math.max(0, n2(b.stake));
  const odds = Math.max(0, n2(b.odds));
  if (b.status !== "closed") return 0;

  if (b.result === "win") return n2(stake * (odds - 1));
  if (b.result === "lose") return n2(-stake);
  if (b.result === "void") return 0;
  if (b.result === "cashout") {
    const ret = n2(b.cashoutReturn || 0) || stake;
    return n2(ret - stake);
  }
  return 0;
}

function getTotals() {
  const currency = STATE.settings.currency || "€";

  const bankrollStart = n2(STATE.bookmakers.reduce((sum, b) => sum + n2(b.budgetStart), 0));
  const availableTotal = n2(STATE.bookmakers.reduce((sum, b) => sum + n2(b.available), 0));

  const closed = STATE.bets.filter((b) => b.status === "closed");
  const open = STATE.bets.filter((b) => b.status === "open");

  const profit = n2(closed.reduce((sum, b) => sum + calcBetProfit(b), 0));
  const stakedClosed = n2(closed.reduce((sum, b) => sum + n2(b.stake), 0));
  const stakedOpen = n2(open.reduce((sum, b) => sum + n2(b.stake), 0));
  const stakedTotal = n2(stakedClosed + stakedOpen);

  const wins = closed.filter((b) => b.result === "win").length;
  const losses = closed.filter((b) => b.result === "lose").length;
  const voids = closed.filter((b) => b.result === "void").length;
  const cashouts = closed.filter((b) => b.result === "cashout").length;

  const closedCount = closed.length;
  const hitRate = closedCount ? (wins / closedCount) * 100 : 0;

  const roiMode = STATE.settings.roiMode || "bankroll_start";
  const denom = roiMode === "staked" ? stakedClosed : bankrollStart;
  const roi = denom > 0 ? (profit / denom) * 100 : 0;

  return {
    currency,
    bankrollStart,
    availableTotal,
    profit,
    stakedClosed,
    stakedOpen,
    stakedTotal,
    wins, losses, voids, cashouts,
    closedCount,
    hitRate,
    roi,
    roiMode,
  };
}

/* -------------------- Minimal Router + Render -------------------- */
const VIEWS = ["dashboard", "bets", "bookmakers", "stats", "settings"];

function currentView() {
  const h = (location.hash || "#dashboard").replace("#", "");
  return VIEWS.includes(h) ? h : "dashboard";
}

function showOnly(view) {
  for (const v of VIEWS) {
    const el = $(`view-${v}`);
    if (el) el.style.display = (v === view) ? "block" : "none";
  }
  $$("[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-nav") === view);
  });
}

/* ---- helper per stampare start/disponibile senza “doppioni” ---- */
function renderBudgetLine(b, currency) {
  const same = n2(b.available) === n2(b.budgetStart);
  if (same) {
    return `<div class="sub">Budget: <b>${money(b.available, currency)}</b></div>`;
  }
  return `
    <div class="sub">Start: ${money(b.budgetStart, currency)}</div>
    <div class="sub">Disponibile: <b>${money(b.available, currency)}</b></div>
  `;
}

function renderDashboard() {
  const el = $("view-dashboard");
  if (!el) return;

  const t = getTotals();
  el.innerHTML = `
    <div class="card">
      <h2>Dashboard</h2>
      <div class="kpi-grid">
        <div class="kpi"><div class="k">Bankroll iniziale</div><div class="v">${money(t.bankrollStart, t.currency)}</div></div>
        <div class="kpi"><div class="k">Disponibile totale</div><div class="v">${money(t.availableTotal, t.currency)}</div></div>
        <div class="kpi"><div class="k">Profit (chiuse)</div><div class="v">${money(t.profit, t.currency)}</div></div>
        <div class="kpi"><div class="k">ROI (${escapeHtml(t.roiMode)})</div><div class="v">${pct(t.roi)}</div></div>
        <div class="kpi"><div class="k">Hit rate</div><div class="v">${pct(t.hitRate)}</div></div>
        <div class="kpi"><div class="k">In corso (stake)</div><div class="v">${money(t.stakedOpen, t.currency)}</div></div>
      </div>

      <h3>Bookmakers</h3>
      <div class="list">
        ${STATE.bookmakers.map((b) => `
          <div class="row">
            <div class="col">
              <div class="title">${escapeHtml(b.name)}</div>
              ${renderBudgetLine(b, t.currency)}
            </div>
            <div class="col right">
              <div class="title">${money(b.available, t.currency)}</div>
              <div class="sub">Disponibile</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderBookmakers() {
  const el = $("view-bookmakers");
  if (!el) return;

  const t = getTotals();
  el.innerHTML = `
    <div class="card">
      <h2>Bookmakers</h2>

      <form id="form-add-bookmaker" class="form">
        <div class="grid">
          <label>Nome
            <input id="bm-name" type="text" placeholder="es. Bet365" required />
          </label>
          <label>Budget iniziale
            <input id="bm-start" type="number" step="0.01" placeholder="0" />
          </label>
        </div>
        <button type="submit">Aggiungi bookmaker</button>
      </form>

      <div class="spacer"></div>

      <div class="list">
        ${STATE.bookmakers.map((b) => `
          <div class="row">
            <div class="col">
              <div class="title">${escapeHtml(b.name)}</div>
              ${renderBudgetLine(b, t.currency)}
            </div>
            <div class="col right">
              <button data-edit-bm="${escapeHtml(b.id)}">Modifica</button>
              <button data-del-bm="${escapeHtml(b.id)}" class="danger">Elimina</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const f = $("form-add-bookmaker");
  if (f) {
    f.onsubmit = (e) => {
      e.preventDefault();
      const name = ($("bm-name")?.value || "").trim();
      const start = Number($("bm-start")?.value || 0);
      if (!name) return;
      addBookmaker(name, start);
      if ($("bm-name")) $("bm-name").value = "";
      if ($("bm-start")) $("bm-start").value = "";
    };
  }

  $$("[data-del-bm]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-del-bm");
      if (!id) return;
      if (confirm("Eliminare questo bookmaker?")) deleteBookmaker(id);
    };
  });

  $$("[data-edit-bm]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-edit-bm");
      if (!id) return;
      const bm = STATE.bookmakers.find((x) => x.id === id);
      if (!bm) return;

      const newName = prompt("Nome bookmaker:", bm.name);
      if (newName == null) return;

      const newStartRaw = prompt("Budget iniziale:", String(bm.budgetStart));
      if (newStartRaw == null) return;

      updateBookmaker(id, {
        name: newName.trim() || bm.name,
        budgetStart: Number(newStartRaw),
      });
    };
  });
}

function renderBets() {
  const el = $("view-bets");
  if (!el) return;

  const t = getTotals();
  const booksOptions = STATE.bookmakers
    .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`)
    .join("");

  el.innerHTML = `
    <div class="card">
      <h2>Bets</h2>

      <form id="form-add-bet" class="form">
        <div class="grid">
          <label>Data
            <input id="bet-date" type="date" value="${toISODateOnly()}" />
          </label>
          <label>Bookmaker
            <select id="bet-book" required>${booksOptions}</select>
          </label>
          <label>Tipo
            <select id="bet-type">
              <option value="singola">Singola</option>
              <option value="multipla">Multipla</option>
              <option value="sistema">Sistema</option>
              <option value="back">Back</option>
              <option value="lay">Lay</option>
            </select>
          </label>
          <label>Stake
            <input id="bet-stake" type="number" step="0.01" placeholder="0" required />
          </label>
          <label>Quota
            <input id="bet-odds" type="number" step="0.01" placeholder="0" />
          </label>

          <label>Stato
            <select id="bet-status">
              <option value="open">In corso</option>
              <option value="closed">Chiusa</option>
            </select>
          </label>

          <label>Esito (se chiusa)
            <select id="bet-result">
              <option value="win">Vinta</option>
              <option value="lose">Persa</option>
              <option value="void">Void</option>
              <option value="cashout">Cashout</option>
            </select>
          </label>

          <label>Rientro Cashout (opz.)
            <input id="bet-cashout" type="number" step="0.01" placeholder="0" />
          </label>

          <label>Sport (opz.)
            <input id="bet-sport" type="text" placeholder="es. Calcio" />
          </label>
          <label>Competizione (opz.)
            <input id="bet-comp" type="text" placeholder="es. Serie A" />
          </label>

          <label>Tag (csv)
            <input id="bet-tags" type="text" placeholder="es. value, live" />
          </label>

          <label>Note
            <input id="bet-note" type="text" placeholder="opzionale" />
          </label>
        </div>

        <button type="submit">Aggiungi bet</button>
      </form>

      <div class="spacer"></div>

      <div class="tabs">
        <button id="tab-all" class="active">Tutte</button>
        <button id="tab-open">In corso</button>
        <button id="tab-closed">Chiuse</button>
      </div>

      <div class="list" id="bets-list"></div>
    </div>
  `;

  let filter = "all";
  const btnAll = $("tab-all");
  const btnOpen = $("tab-open");
  const btnClosed = $("tab-closed");

  function setTab(tname) {
    filter = tname;
    if (btnAll) btnAll.classList.toggle("active", tname === "all");
    if (btnOpen) btnOpen.classList.toggle("active", tname === "open");
    if (btnClosed) btnClosed.classList.toggle("active", tname === "closed");
    paintList();
  }

  if (btnAll) btnAll.onclick = () => setTab("all");
  if (btnOpen) btnOpen.onclick = () => setTab("open");
  if (btnClosed) btnClosed.onclick = () => setTab("closed");

  const form = $("form-add-bet");
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();

      const bookmakerId = $("bet-book")?.value || "";
      const bk = STATE.bookmakers.find((b) => b.id === bookmakerId);
      if (!bk) return;

      const status = $("bet-status")?.value || "open";
      let stake = n2(Number($("bet-stake")?.value || 0));

      if (status === "open") stake = clamp(0, stake, bk.available);

      const bet = {
        bookmakerId,
        openedAt: $("bet-date")?.value || toISODateOnly(),
        closedAt: status === "closed" ? ($("bet-date")?.value || toISODateOnly()) : "",
        status,
        result: status === "closed" ? ($("bet-result")?.value || "win") : "",
        cashoutReturn: Number($("bet-cashout")?.value || 0),
        type: $("bet-type")?.value || "singola",
        stake,
        odds: Number($("bet-odds")?.value || 0),
        sport: ($("bet-sport")?.value || "").trim(),
        competition: ($("bet-comp")?.value || "").trim(),
        tags: ($("bet-tags")?.value || "").trim(),
        note: ($("bet-note")?.value || "").trim(),
      };

      if (bet.status === "closed" && bet.result === "cashout") {
        const r = n2(bet.cashoutReturn || 0);
        bet.cashoutReturn = r > 0 ? r : stake;
      }

      addBet(bet);

      if ($("bet-stake")) $("bet-stake").value = "";
      if ($("bet-odds")) $("bet-odds").value = "";
      if ($("bet-cashout")) $("bet-cashout").value = "";
      if ($("bet-sport")) $("bet-sport").value = "";
      if ($("bet-comp")) $("bet-comp").value = "";
      if ($("bet-tags")) $("bet-tags").value = "";
      if ($("bet-note")) $("bet-note").value = "";

      setTab(filter);
    };
  }

  function paintList() {
    const list = $("bets-list");
    if (!list) return;

    const filtered = STATE.bets.filter((b) => {
      if (filter === "open") return b.status === "open";
      if (filter === "closed") return b.status === "closed";
      return true;
    });

    list.innerHTML = filtered.map((b) => {
      const bm = STATE.bookmakers.find((x) => x.id === b.bookmakerId);
      const bmName = bm ? bm.name : "—";
      const p = calcBetProfit(b);
      const pTxt = b.status === "closed" ? money(p, t.currency) : "—";
      const resTxt = b.status === "closed" ? b.result : "open";

      return `
        <div class="row bet">
          <div class="col">
            <div class="title">
              ${escapeHtml(bmName)} • ${escapeHtml(b.type)} • ${escapeHtml(b.openedAt)}
            </div>
            <div class="sub">
              Stake: <b>${money(b.stake, t.currency)}</b>
              &nbsp;•&nbsp; Quota: <b>${fmt2(b.odds)}</b>
              &nbsp;•&nbsp; Stato: <b>${escapeHtml(resTxt)}</b>
              ${b.sport ? `&nbsp;•&nbsp; ${escapeHtml(b.sport)}` : ""}
              ${b.competition ? `&nbsp;•&nbsp; ${escapeHtml(b.competition)}` : ""}
            </div>
            ${b.tags?.length ? `<div class="sub">Tag: ${escapeHtml(Array.isArray(b.tags) ? b.tags.join(", ") : b.tags)}</div>` : ""}
            ${b.note ? `<div class="sub">${escapeHtml(b.note)}</div>` : ""}
          </div>

          <div class="col right">
            <div class="title">${pTxt}</div>
            <div class="sub">${b.status === "closed" ? "Profit" : "In corso"}</div>
            <div class="actions">
              <button data-edit-bet="${escapeHtml(b.id)}">Modifica</button>
              <button data-del-bet="${escapeHtml(b.id)}" class="danger">Cancella</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    // bind delete
    $$("[data-del-bet]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-del-bet");
        if (!id) return;
        if (confirm("Cancellare questa bet?")) deleteBet(id);
      };
    });

    // bind edit (prompt semplice)
    $$("[data-edit-bet]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-edit-bet");
        if (!id) return;
        const b = STATE.bets.find((x) => x.id === id);
        if (!b) return;

        const newStake = prompt("Stake:", String(b.stake));
        if (newStake == null) return;

        const newOdds = prompt("Quota:", String(b.odds));
        if (newOdds == null) return;

        const newStatus = prompt("Stato (open/closed):", b.status);
        if (newStatus == null) return;

        const newBook = prompt("Bookmaker ID (lascia vuoto per non cambiare):", "");
        // NB: volutamente semplice — se vuoi mettiamo una modal vera dopo

        let patch = {
          stake: Number(newStake),
          odds: Number(newOdds),
          status: (String(newStatus).toLowerCase() === "closed") ? "closed" : "open",
        };

        if (newBook && newBook.trim()) patch.bookmakerId = newBook.trim();

        if (patch.status === "closed") {
          const newResult = prompt("Esito (win/lose/void/cashout):", b.result || "win");
          if (newResult == null) return;
          patch.result = String(newResult).toLowerCase();
          patch.closedAt = b.closedAt || b.openedAt || toISODateOnly();

          if (patch.result === "cashout") {
            const r = prompt("Rientro cashout:", String(b.cashoutReturn || b.stake));
            if (r != null) patch.cashoutReturn = Number(r);
          }
        } else {
          patch.result = "";
          patch.closedAt = "";
        }

        updateBet(id, patch);
      };
    });
  }

  paintList();
}

/* -------------------- Stats view -------------------- */
function renderStats() {
  const el = $("view-stats");
  if (!el) return;

  const t = getTotals();

  el.innerHTML = `
    <div class="card">
      <h2>Statistiche</h2>

      <div class="kpi-grid">
        <div class="kpi"><div class="k">Profit (chiuse)</div><div class="v">${money(t.profit, t.currency)}</div></div>
        <div class="kpi"><div class="k">ROI (${escapeHtml(t.roiMode)})</div><div class="v">${pct(t.roi)}</div></div>
        <div class="kpi"><div class="k">Hit rate</div><div class="v">${pct(t.hitRate)}</div></div>
        <div class="kpi"><div class="k">Chiuse</div><div class="v">${t.closedCount}</div></div>
        <div class="kpi"><div class="k">Vinte / Perse</div><div class="v">${t.wins} / ${t.losses}</div></div>
        <div class="kpi"><div class="k">Void / Cashout</div><div class="v">${t.voids} / ${t.cashouts}</div></div>
      </div>

      <h3>Per bookmaker</h3>
      <div class="list">
        ${STATE.bookmakers.map((b) => {
          const closed = STATE.bets.filter(x => x.bookmakerId === b.id && x.status === "closed");
          const profit = n2(closed.reduce((s, x) => s + calcBetProfit(x), 0));
          const staked = n2(closed.reduce((s, x) => s + n2(x.stake), 0));
          const denom = (t.roiMode === "staked") ? staked : n2(b.budgetStart);
          const roi = denom > 0 ? (profit / denom) * 100 : 0;

          return `
            <div class="row">
              <div class="col">
                <div class="title">${escapeHtml(b.name)}</div>
                ${renderBudgetLine(b, t.currency)}
              </div>
              <div class="col right">
                <div class="title">${money(profit, t.currency)}</div>
                <div class="sub">ROI: ${pct(roi)}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

/* -------------------- Settings view -------------------- */
function renderSettings() {
  const el = $("view-settings");
  if (!el) return;

  const cur = STATE.settings || {};
  el.innerHTML = `
    <div class="card">
      <h2>Impostazioni</h2>

      <form id="form-settings" class="form">
        <div class="grid">
          <label>Valuta
            <input id="set-currency" type="text" value="${escapeHtml(cur.currency || "€")}" />
          </label>

          <label>ROI calcolato su
            <select id="set-roi">
              <option value="bankroll_start" ${cur.roiMode === "bankroll_start" ? "selected" : ""}>Bankroll iniziale</option>
              <option value="staked" ${cur.roiMode === "staked" ? "selected" : ""}>Stake (classico)</option>
            </select>
          </label>
        </div>

        <button type="submit">Salva</button>
      </form>

      <div class="spacer"></div>

      <h3>Backup</h3>
      <div class="grid">
        <button id="btn-export">Export JSON</button>
        <label class="file">
          Import JSON
          <input id="file-import" type="file" accept="application/json" />
        </label>
      </div>

      <div class="spacer"></div>

      <button id="btn-reset" class="danger">Reset (cancella tutto)</button>
    </div>
  `;

  const f = $("form-settings");
  if (f) {
    f.onsubmit = (e) => {
      e.preventDefault();
      STATE.settings.currency = ($("set-currency")?.value || "€").trim() || "€";
      STATE.settings.roiMode = $("set-roi")?.value || "bankroll_start";
      saveAndRender();
    };
  }

  // Export
  const be = $("btn-export");
  if (be) {
    be.onclick = () => {
      const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tracker_scommesse_${toISODateOnly()}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
    };
  }

  // Import
  const fi = $("file-import");
  if (fi) {
    fi.onchange = async () => {
      const file = fi.files?.[0];
      if (!file) return;
      const txt = await file.text();
      const data = safeParse(txt);
      if (!data) {
        alert("File non valido.");
        return;
      }
      const s = normalizeState(data);
      recomputeAllBalances(s);
      STATE = s;
      saveAndRender();
      fi.value = "";
    };
  }

  // Reset
  const br = $("btn-reset");
  if (br) {
    br.onclick = () => {
      if (!confirm("Sei sicuro? Cancella tutto.")) return;
      STATE = normalizeState(structuredClone(DEFAULT));
      ensureAtLeastOneBookmaker(STATE);
      recomputeAllBalances(STATE);
      saveAndRender();
      location.hash = "#dashboard";
    };
  }
}

/* -------------------- App render + events -------------------- */
function renderApp() {
  const view = currentView();
  showOnly(view);

  if (view === "dashboard") renderDashboard();
  if (view === "bets") renderBets();
  if (view === "bookmakers") renderBookmakers();
  if (view === "stats") renderStats();
  if (view === "settings") renderSettings();
}

function saveAndRender() {
  saveState(STATE);
  renderApp();
}

// nav clicks (se presenti)
function bindNav() {
  $$("[data-nav]").forEach((btn) => {
    btn.onclick = () => {
      const v = btn.getAttribute("data-nav");
      if (!v) return;
      location.hash = `#${v}`;
    };
  });
}

window.addEventListener("hashchange", renderApp);

// bootstrap
bindNav();
recomputeAllBalances(STATE);
renderApp();
