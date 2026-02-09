/* app.js — Fit Planner (offline-first)
   ✅ Allenamento: scheda + sessione + log + PR (basic)
   ✅ Dieta: 5 pasti fissi + macro target + lista spesa settimanale
   ✅ Backup: Export/Import JSON
*/

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

const $ = (id) => document.getElementById(id);
const money = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const KEY = "fitplanner_v1";

const DEFAULT = {
  settings: { weightKg: 68, mealsPerDay: 5, kcal: 2900, p: 140, c: 380, f: 80 },
  workoutPlan: null,
  dietPlan: null,
  sessions: [], // {id,date,dayName,items:[{ex,sets:[{kg,reps,rir}]}]}
};

function safeParse(raw){ try { return JSON.parse(raw); } catch { return null; } }
function loadState(){
  const s = safeParse(localStorage.getItem(KEY));
  return (s && typeof s === "object") ? s : structuredClone(DEFAULT);
}
function saveState(){ localStorage.setItem(KEY, JSON.stringify(state)); }

function toast(msg){
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove("show"), 1600);
}

let state = loadState();

/* -------------------- Default workout (4gg) -------------------- */
function defaultWorkout4Days(){
  return {
    name: "Ipertrofia 4 giorni (Upper/Lower)",
    days: [
      {
        id: "mon",
        name: "Lunedì – UPPER 1",
        exercises: [
          { ex:"Panca piana bilanciere", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:30" },
          { ex:"Trazioni zavorrate", sets:4, repMin:6, repMax:8, rir:"1-2", rest:"2:00" },
          { ex:"Panca inclinata manubri", sets:3, repMin:8, repMax:10, rir:"1-2", rest:"1:30" },
          { ex:"Rematore bilanciere (o T-bar)", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
          { ex:"Alzate laterali", sets:3, repMin:12, repMax:20, rir:"0-1", rest:"1:00" },
          { ex:"Curl manubri inclinato", sets:2, repMin:10, repMax:12, rir:"0-1", rest:"1:00" },
          { ex:"Pushdown cavo", sets:2, repMin:10, repMax:12, rir:"0-1", rest:"1:00" }
        ]
      },
      {
        id: "tue",
        name: "Martedì – LOWER 1",
        exercises: [
          { ex:"Squat", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:30" },
          { ex:"Stacco rumeno (RDL)", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
          { ex:"Leg press", sets:3, repMin:10, repMax:12, rir:"1", rest:"1:30" },
          { ex:"Leg curl", sets:3, repMin:10, repMax:14, rir:"0-1", rest:"1:15" },
          { ex:"Calf raise in piedi", sets:4, repMin:8, repMax:12, rir:"0-1", rest:"1:00" },
          { ex:"Crunch al cavo", sets:3, repMin:10, repMax:15, rir:"1", rest:"1:00" }
        ]
      },
      {
        id: "thu",
        name: "Giovedì – UPPER 2",
        exercises: [
          { ex:"Military press", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:00" },
          { ex:"Lat machine presa larga", sets:3, repMin:8, repMax:12, rir:"1-2", rest:"1:30" },
          { ex:"Panca inclinata bilanciere", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
          { ex:"Rematore chest-supported", sets:3, repMin:8, repMax:12, rir:"1", rest:"1:30" },
          { ex:"Croci ai cavi", sets:2, repMin:12, repMax:15, rir:"0-1", rest:"1:00" },
          { ex:"Face pull", sets:2, repMin:12, repMax:20, rir:"0-1", rest:"1:00" },
          { ex:"Curl EZ", sets:3, repMin:8, repMax:12, rir:"0-1", rest:"1:00" },
          { ex:"French press", sets:3, repMin:8, repMax:12, rir:"0-1", rest:"1:15" }
        ]
      },
      {
        id: "fri",
        name: "Venerdì – LOWER 2",
        exercises: [
          { ex:"Stacco tecnico", sets:3, repMin:3, repMax:5, rir:"2", rest:"2:30" },
          { ex:"Hip thrust", sets:4, repMin:6, repMax:10, rir:"1-2", rest:"2:00" },
          { ex:"Front squat", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
          { ex:"Bulgarian split squat", sets:3, repMin:8, repMax:10, rir:"1", rest:"1:30" },
          { ex:"Leg curl seduto", sets:2, repMin:12, repMax:15, rir:"0-1", rest:"1:15" },
          { ex:"Calf raise seduto", sets:4, repMin:12, repMax:20, rir:"0-1", rest:"1:00" },
          { ex:"Plank zavorrato", sets:3, repMin:30, repMax:45, rir:"-", rest:"1:00", unit:"sec" }
        ]
      }
    ]
  };
}

/* -------------------- Default diet (5 pasti, no pesce) -------------------- */
function defaultDietWeek(){
  // Struttura: week[0..6] -> meals[1..5] -> items [{food, qty, unit, note}]
  // Semplice e ripetibile: stessa giornata ripetuta (routine)
  const day = {
    meals: {
      1: [
        { food:"Yogurt greco 0%", qty:250, unit:"g" },
        { food:"Fiocchi d'avena", qty:80, unit:"g" },
        { food:"Banana", qty:1, unit:"pz" },
        { food:"Burro d'arachidi", qty:15, unit:"g" }
      ],
      2: [
        { food:"Whey", qty:30, unit:"g", note:"Post-allenamento" },
        { food:"Gallette di riso", qty:6, unit:"pz" }
      ],
      3: [
        { food:"Riso basmati", qty:120, unit:"g" },
        { food:"Petto di pollo", qty:200, unit:"g" },
        { food:"Olio EVO", qty:10, unit:"g" },
        { food:"Verdure (a scelta)", qty:300, unit:"g" }
      ],
      4: [
        { food:"Pane", qty:120, unit:"g" },
        { food:"Bresaola", qty:120, unit:"g" },
        { food:"Frutta", qty:1, unit:"pz" }
      ],
      5: [
        { food:"Uova intere", qty:3, unit:"pz" },
        { food:"Albumi", qty:200, unit:"g" },
        { food:"Patate", qty:400, unit:"g" },
        { food:"Olio EVO", qty:10, unit:"g" }
      ]
    }
  };
  return {
    name: "Massa pulita (no pesce) – routine",
    week: Array.from({length:7}, () => structuredClone(day))
  };
}

/* -------------------- UI: tabs -------------------- */
function setView(view){
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const el = document.getElementById("view-" + view);
  if (el) el.classList.remove("hidden");
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) setView(tab.dataset.view);

  const jump = e.target.closest("[data-jump]");
  if (jump) setView(jump.dataset.jump);
});

/* -------------------- Populate selects -------------------- */
function populateDays(){
  const sel = $("daySelect");
  if (!sel) return;
  sel.innerHTML = "";
  const plan = state.workoutPlan;
  if (!plan) return;
  for (const d of plan.days){
    const o = document.createElement("option");
    o.value = d.id;
    o.textContent = d.name;
    sel.appendChild(o);
  }
}

function populateDietDays(){
  const sel = $("dietDaySelect");
  if (!sel) return;
  sel.innerHTML = "";
  const labels = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  for (let i=0;i<7;i++){
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = labels[i];
    sel.appendChild(o);
  }
}

/* -------------------- Workout preview + session -------------------- */
let activeSessionId = null;

function renderDayPreview(){
  const box = $("dayPreview");
  const sel = $("daySelect");
  if (!box || !sel || !state.workoutPlan) return;
  const day = state.workoutPlan.days.find(d => d.id === sel.value);
  if (!day) return;

  box.innerHTML = "";
  for (const ex of day.exercises){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-head">
        <div class="item-title">${ex.ex}</div>
        <div class="badge">${ex.sets} serie • ${ex.repMin}-${ex.repMax} reps • RIR ${ex.rir}</div>
      </div>
      <div class="muted">Recupero: ${ex.rest}</div>
    `;
    box.appendChild(div);
  }
}

function startSessionFromDay(dayId){
  const plan = state.workoutPlan;
  if (!plan) return;
  const day = plan.days.find(d => d.id === dayId);
  if (!day) return;

  const session = {
    id: uid(),
    date: todayISO(),
    dayId: day.id,
    dayName: day.name,
    items: day.exercises.map(ex => ({
      ex: ex.ex,
      target: { sets: ex.sets, repMin: ex.repMin, repMax: ex.repMax, rir: ex.rir, rest: ex.rest, unit: ex.unit || "reps" },
      sets: Array.from({length: ex.sets}, () => ({ kg:"", reps:"", rir:"" }))
    }))
  };

  state.sessions.push(session);
  activeSessionId = session.id;
  saveState();
  renderSessionBox();
  toast("Sessione avviata");
}

function getActiveSession(){
  if (!activeSessionId) return null;
  return state.sessions.find(s => s.id === activeSessionId) || null;
}

function renderSessionBox(){
  const box = $("sessionBox");
  if (!box) return;
  const s = getActiveSession();
  if (!s){
    box.innerHTML = `<div class="muted">Nessuna sessione attiva.</div>`;
    return;
  }

  box.innerHTML = "";
  const head = document.createElement("div");
  head.className = "item";
  head.innerHTML = `
    <div class="item-head">
      <div class="item-title">${s.dayName}</div>
      <div class="badge ok">${s.date}</div>
    </div>
    <div class="row">
      <button class="btn danger" id="btnEndSession">Chiudi sessione</button>
    </div>
  `;
  box.appendChild(head);

  for (let i=0;i<s.items.length;i++){
    const it = s.items[i];
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML = `
      <div class="item-head">
        <div class="item-title">${it.ex}</div>
        <div class="badge">Target: ${it.target.sets}x ${it.target.repMin}-${it.target.repMax} • RIR ${it.target.rir}</div>
      </div>
      <div class="muted">Rec: ${it.target.rest}</div>
      <div class="list" id="setlist-${i}"></div>
    `;
    box.appendChild(card);

    const setlist = card.querySelector(`#setlist-${i}`);
    for (let k=0;k<it.sets.length;k++){
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <span class="badge">Serie ${k+1}</span>
        <label class="field" style="min-width:120px">
          <span>Kg</span>
          <input inputmode="decimal" data-s="${s.id}" data-i="${i}" data-k="${k}" data-f="kg" value="${it.sets[k].kg}">
        </label>
        <label class="field" style="min-width:120px">
          <span>${it.target.unit === "sec" ? "Secondi" : "Reps"}</span>
          <input inputmode="numeric" data-s="${s.id}" data-i="${i}" data-k="${k}" data-f="reps" value="${it.sets[k].reps}">
        </label>
        <label class="field" style="min-width:120px">
          <span>RIR</span>
          <input inputmode="numeric" data-s="${s.id}" data-i="${i}" data-k="${k}" data-f="rir" value="${it.sets[k].rir}">
        </label>
      `;
      setlist.appendChild(row);
    }
  }
}

document.addEventListener("input", (e) => {
  const inp = e.target.closest("input[data-s][data-i][data-k][data-f]");
  if (!inp) return;
  const sid = inp.dataset.s;
  const i = Number(inp.dataset.i);
  const k = Number(inp.dataset.k);
  const f = inp.dataset.f;
  const s = state.sessions.find(x => x.id === sid);
  if (!s) return;
  s.items[i].sets[k][f] = inp.value;
  saveState();
});

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "btnEndSession"){
    activeSessionId = null;
    toast("Sessione chiusa (salvata nello storico)");
    renderSessionBox();
    renderHistory();
    renderPR();
  }
});

/* -------------------- Diet editor -------------------- */
function renderDietEditor(){
  const box = $("dietEditor");
  const daySel = $("dietDaySelect");
  const mealSel = $("mealSelect");
  if (!box || !daySel || !mealSel) return;
  if (!state.dietPlan) return;

  const di = Number(daySel.value);
  const mi = Number(mealSel.value);
  const day = state.dietPlan.week[di];
  const items = day.meals[mi] || [];

  box.innerHTML = "";

  const header = document.createElement("div");
  header.className = "item";
  header.innerHTML = `
    <div class="item-head">
      <div class="item-title">Pasto ${mi}</div>
      <div class="badge">Elementi: ${items.length}</div>
    </div>
    <div class="row">
      <button class="btn" id="btnAddFood">Aggiungi alimento</button>
    </div>
  `;
  box.appendChild(header);

  items.forEach((it, idx) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-head">
        <div class="item-title">${it.food}</div>
        <div class="badge">${it.qty} ${it.unit}</div>
      </div>
      <div class="row">
        <label class="field" style="min-width:220px">
          <span>Alimento</span>
          <input data-d="${di}" data-m="${mi}" data-idx="${idx}" data-f="food" value="${it.food}">
        </label>
        <label class="field" style="min-width:120px">
          <span>Quantità</span>
          <input inputmode="decimal" data-d="${di}" data-m="${mi}" data-idx="${idx}" data-f="qty" value="${it.qty}">
        </label>
        <label class="field" style="min-width:120px">
          <span>Unità</span>
          <input data-d="${di}" data-m="${mi}" data-idx="${idx}" data-f="unit" value="${it.unit}">
        </label>
        <button class="btn danger" data-delfood="1" data-d="${di}" data-m="${mi}" data-idx="${idx}">Elimina</button>
      </div>
      ${it.note ? `<div class="muted">${it.note}</div>` : ``}
    `;
    box.appendChild(div);
  });
}

document.addEventListener("input", (e) => {
  const inp = e.target.closest("input[data-d][data-m][data-idx][data-f]");
  if (!inp) return;
  const d = Number(inp.dataset.d), m = Number(inp.dataset.m), idx = Number(inp.dataset.idx);
  const f = inp.dataset.f;
  const day = state.dietPlan?.week?.[d];
  if (!day) return;
  const item = day.meals[m][idx];
  if (!item) return;
  item[f] = (f === "qty") ? Number(inp.value || 0) : inp.value;
  saveState();
});

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "btnAddFood"){
    const di = Number($("dietDaySelect").value);
    const mi = Number($("mealSelect").value);
    state.dietPlan.week[di].meals[mi].push({ food:"Nuovo alimento", qty:100, unit:"g" });
    saveState();
    renderDietEditor();
  }
  const del = e.target.closest("[data-delfood]");
  if (del){
    const d = Number(del.dataset.d), m = Number(del.dataset.m), idx = Number(del.dataset.idx);
    state.dietPlan.week[d].meals[m].splice(idx,1);
    saveState();
    renderDietEditor();
  }
});

/* -------------------- Grocery list (weekly) -------------------- */
function generateGrocery(){
  if (!state.dietPlan) return null;

  const agg = new Map(); // key=food|unit -> qty
  for (let d=0; d<7; d++){
    const day = state.dietPlan.week[d];
    for (let m=1; m<=5; m++){
      const items = day.meals[m] || [];
      for (const it of items){
        const key = `${it.food}||${it.unit}`;
        const prev = agg.get(key) || 0;
        const add = (typeof it.qty === "number") ? it.qty : Number(it.qty||0);
        agg.set(key, prev + add);
      }
    }
  }

  const list = Array.from(agg.entries()).map(([key, qty]) => {
    const [food, unit] = key.split("||");
    return { food, qty, unit };
  }).sort((a,b)=>a.food.localeCompare(b.food));

  return list;
}

function showGrocery(){
  const list = generateGrocery();
  if (!list){ toast("Carica prima una dieta"); return; }

  // semplice popup
  const lines = list.map(x => `• ${x.food}: ${x.qty} ${x.unit}`).join("\n");
  alert("LISTA SPESA SETTIMANALE\n\n" + lines + "\n\n(Export JSON consigliato per salvarla)");
}

/* -------------------- Progress: history + PR basic -------------------- */
function renderHistory(){
  const box = $("sessionHistory");
  if (!box) return;
  box.innerHTML = "";
  const sessions = [...state.sessions].sort((a,b)=> (a.date < b.date ? 1 : -1));
  if (!sessions.length){
    box.innerHTML = `<div class="muted">Nessuna sessione registrata.</div>`;
    return;
  }
  for (const s of sessions.slice(0,50)){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-head">
        <div class="item-title">${s.dayName}</div>
        <div class="badge ok">${s.date}</div>
      </div>
      <div class="muted">Esercizi: ${s.items.length}</div>
    `;
    box.appendChild(div);
  }
}

function renderPR(){
  const box = $("prBox");
  if (!box) return;
  box.innerHTML = "";

  // PR semplice: massimo kg registrato per esercizio
  const pr = new Map(); // ex -> maxKg
  for (const s of state.sessions){
    for (const it of s.items){
      for (const st of it.sets){
        const kg = Number(String(st.kg).replace(",", "."));
        if (!isFinite(kg) || kg <= 0) continue;
        const cur = pr.get(it.ex) || 0;
        if (kg > cur) pr.set(it.ex, kg);
      }
    }
  }

  if (!pr.size){
    box.innerHTML = `<div class="muted">Inserisci qualche sessione per vedere i PR.</div>`;
    return;
  }

  const list = Array.from(pr.entries()).sort((a,b)=>b[1]-a[1]).slice(0,30);
  for (const [ex, kg] of list){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-head">
        <div class="item-title">${ex}</div>
        <div class="badge ok">${money(kg)} kg</div>
      </div>
    `;
    box.appendChild(div);
  }
}

/* -------------------- Home KPI -------------------- */
function homeRefresh(){
  $("homeKcal").textContent = state.settings.kcal + " kcal";

  // “Allenamento oggi”: se è lun/mar/gio/ven mostra quel giorno
  const dow = new Date().getDay(); // 0 dom ... 6 sab
  let dayName = "Riposo";
  if (state.workoutPlan){
    const map = {1:"mon",2:"tue",4:"thu",5:"fri"};
    const id = map[dow];
    if (id){
      const d = state.workoutPlan.days.find(x => x.id === id);
      if (d) dayName = d.name;
    }
  }
  $("homeTodayWorkout").textContent = dayName;
}

/* -------------------- Settings -------------------- */
function renderSettings(){
  $("setWeight").value = state.settings.weightKg;
  $("setMeals").value = state.settings.mealsPerDay;
  $("setKcal").value = state.settings.kcal;
  $("setP").value = state.settings.p;
  $("setC").value = state.settings.c;
  $("setF").value = state.settings.f;

  $("kcalTarget").textContent = state.settings.kcal;
  $("pTarget").textContent = state.settings.p + " g";
  $("cTarget").textContent = state.settings.c + " g";
  $("fTarget").textContent = state.settings.f + " g";
}

$("btnSaveSettings")?.addEventListener("click", () => {
  state.settings.weightKg = Number($("setWeight").value || 0);
  state.settings.mealsPerDay = Number($("setMeals").value || 5);
  state.settings.kcal = Number($("setKcal").value || 0);
  state.settings.p = Number($("setP").value || 0);
  state.settings.c = Number($("setC").value || 0);
  state.settings.f = Number($("setF").value || 0);
  saveState();
  renderSettings();
  homeRefresh();
  toast("Impostazioni salvate");
});

/* -------------------- Buttons -------------------- */
$("btnLoadDefault")?.addEventListener("click", () => {
  state.workoutPlan = defaultWorkout4Days();
  saveState();
  populateDays();
  renderDayPreview();
  homeRefresh();
  toast("Scheda 4gg caricata");
});

$("btnResetWorkout")?.addEventListener("click", () => {
  if (!confirm("Reset scheda?")) return;
  state.workoutPlan = null;
  saveState();
  $("dayPreview").innerHTML = "";
  $("daySelect").innerHTML = "";
  homeRefresh();
  toast("Scheda resettata");
});

$("daySelect")?.addEventListener("change", () => renderDayPreview());

$("btnStartDay")?.addEventListener("click", () => {
  const sel = $("daySelect");
  if (!sel?.value){ toast("Carica prima la scheda"); return; }
  startSessionFromDay(sel.value);
});

$("btnStartSession")?.addEventListener("click", () => {
  setView("workout");
  // se oggi è giorno allenamento, prova ad avviare quel day
  if (!state.workoutPlan){ toast("Carica prima la scheda"); return; }
  const dow = new Date().getDay();
  const map = {1:"mon",2:"tue",4:"thu",5:"fri"};
  const id = map[dow] || state.workoutPlan.days[0].id;
  $("daySelect").value = id;
  renderDayPreview();
  startSessionFromDay(id);
});

$("btnTodayMeals")?.addEventListener("click", () => {
  setView("diet");
  $("dietDaySelect").value = String((new Date().getDay() + 6) % 7); // lun=0
  $("mealSelect").value = "1";
  renderDietEditor();
});

$("btnLoadDietDefault")?.addEventListener("click", () => {
  state.dietPlan = defaultDietWeek();
  saveState();
  populateDietDays();
  renderDietEditor();
  toast("Dieta (routine) caricata");
});

$("dietDaySelect")?.addEventListener("change", () => renderDietEditor());
$("mealSelect")?.addEventListener("change", () => renderDietEditor());

$("btnGenerateGrocery")?.addEventListener("click", () => showGrocery());
$("btnGrocery")?.addEventListener("click", () => showGrocery());

/* Backup */
$("btnExport")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fitplanner_backup_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("fileImport")?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const txt = await f.text();
  const obj = safeParse(txt);
  if (!obj){ toast("JSON non valido"); return; }
  // merge semplice (o sostituzione)
  if (!confirm("Import: vuoi SOSTITUIRE tutti i dati? (OK=Sostituisci, Annulla=Unisci)")){
    // Unisci (sessions concat, settings preferisci import se presenti)
    state.settings = obj.settings || state.settings;
    state.workoutPlan = obj.workoutPlan || state.workoutPlan;
    state.dietPlan = obj.dietPlan || state.dietPlan;
    state.sessions = [...state.sessions, ...(obj.sessions || [])];
  } else {
    state = obj;
  }
  saveState();
  boot();
  toast("Import completato");
});

$("btnBackup")?.addEventListener("click", () => setView("settings"));

/* -------------------- Boot -------------------- */
function boot(){
  // init defaults if empty
  if (!state.workoutPlan) state.workoutPlan = defaultWorkout4Days();
  if (!state.dietPlan) state.dietPlan = defaultDietWeek();
  saveState();

  populateDays();
  populateDietDays();
  renderDayPreview();
  renderSessionBox();
  renderDietEditor();
  renderSettings();
  renderHistory();
  renderPR();
  homeRefresh();
}

boot();