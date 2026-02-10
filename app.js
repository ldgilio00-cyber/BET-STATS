/* Fit Planner — app.js (offline-first)
   ✅ Multi schede + multi diete
   ✅ Sessione dedicata (1 serie alla volta) + timer
   ✅ Storico esercizio (Ultima/Best)
   ✅ Suggerimento progressione (PT)
   ✅ Grafico progressione esercizio (canvas)
*/

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/BET-STATS/sw.js").catch(() => {});
}

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const todayISO = () => new Date().toISOString().slice(0, 10);

const KEY = "fitplanner_v7";

function safeParse(raw){ try { return JSON.parse(raw); } catch { return null; } }
function clone(o){ return JSON.parse(JSON.stringify(o)); }

const DEFAULT = {
  settings: { weightKg: 68, mealsPerDay: 5, kcal: 2900, p: 140, c: 380, f: 80 },

  plans: [],
  activePlanId: null,

  diets: [],
  activeDietId: null,

  sessions: [],
  activeSessionId: null,
  activeExIndex: 0,
  activeSetIndex: 0,

  ui: {
    planEditId: null, planEditDayId: null,
    dietEditId: null, dietEditDayIndex: 0, dietEditMeal: 1,
    exProgName: "", exProgMode: "best"
  }
};

let state = loadState();

function loadState(){
  const s = safeParse(localStorage.getItem(KEY));
  return (s && typeof s === "object") ? s : clone(DEFAULT);
}
function saveState(){ localStorage.setItem(KEY, JSON.stringify(state)); }

function toast(msg){
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove("show"), 1400);
}

/* ---------------- defaults ---------------- */
function defaultWorkout4Days(){
  return {
    id: uid().slice(0,8),
    name: "Ipertrofia 4 giorni (Upper/Lower)",
    days: [
      { id:"mon", name:"Lunedì – UPPER 1", exercises:[
        { ex:"Panca piana bilanciere", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:30" },
        { ex:"Trazioni zavorrate", sets:4, repMin:6, repMax:8, rir:"1-2", rest:"2:00" },
        { ex:"Panca inclinata manubri", sets:3, repMin:8, repMax:10, rir:"1-2", rest:"90" }
      ]},
      { id:"tue", name:"Martedì – LOWER 1", exercises:[
        { ex:"Squat", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:30" },
        { ex:"Stacco rumeno (RDL)", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
        { ex:"Leg press", sets:3, repMin:10, repMax:12, rir:"1", rest:"90" }
      ]},
      { id:"thu", name:"Giovedì – UPPER 2", exercises:[
        { ex:"Military press", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:00" },
        { ex:"Lat machine presa larga", sets:3, repMin:8, repMax:12, rir:"1-2", rest:"90" },
        { ex:"Croci ai cavi", sets:2, repMin:12, repMax:15, rir:"0-1", rest:"60" }
      ]},
      { id:"fri", name:"Venerdì – LOWER 2", exercises:[
        { ex:"Stacco tecnico", sets:3, repMin:3, repMax:5, rir:"2", rest:"2:30" },
        { ex:"Hip thrust", sets:4, repMin:6, repMax:10, rir:"1-2", rest:"2:00" },
        { ex:"Calf raise seduto", sets:4, repMin:12, repMax:20, rir:"0-1", rest:"60" }
      ]}
    ]
  };
}

function defaultDietWeek(){
  const day = {
    meals:{
      1:[{food:"Yogurt greco 0%",qty:250,unit:"g"},{food:"Avena",qty:80,unit:"g"},{food:"Banana",qty:1,unit:"pz"}],
      2:[{food:"Whey",qty:30,unit:"g"}],
      3:[{food:"Riso basmati",qty:120,unit:"g"},{food:"Petto di pollo",qty:200,unit:"g"},{food:"Verdure",qty:300,unit:"g"},{food:"Olio EVO",qty:10,unit:"g"}],
      4:[{food:"Pane",qty:120,unit:"g"},{food:"Bresaola",qty:120,unit:"g"}],
      5:[{food:"Uova intere",qty:3,unit:"pz"},{food:"Albumi",qty:200,unit:"g"},{food:"Patate",qty:400,unit:"g"},{food:"Olio EVO",qty:10,unit:"g"}]
    }
  };
  return {
    id: uid().slice(0,8),
    name:"Routine massa pulita",
    week:Array.from({length:7},()=>clone(day))
  };
}

/* ---------------- helpers ---------------- */
function parseRestToSeconds(rest){
  if (!rest) return 90;
  const s = String(rest).trim();
  if (s.includes(":")){
    const [m,sec] = s.split(":");
    const mm = Number(m), ss = Number(sec);
    if (isFinite(mm) && isFinite(ss)) return Math.max(0, mm*60 + ss);
  }
  const n = Number(s.replace(/[^\d]/g, ""));
  if (isFinite(n) && n > 0) return n;
  return 90;
}
function fmtMMSS(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec/60);
  const s = sec % 60;
  return String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
}
function moveItem(arr, from, to){
  if (to < 0 || to >= arr.length) return;
  const x = arr.splice(from,1)[0];
  arr.splice(to,0,x);
}
function getActivePlan(){ return state.plans.find(p => p.id === state.activePlanId) || null; }
function getActiveDiet(){ return state.diets.find(d => d.id === state.activeDietId) || null; }

function toNum(v){
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return isFinite(n) ? n : NaN;
}
function toKg(v){ const n=toNum(v); return (isFinite(n)&&n>0)?n:NaN; }
function toReps(v){ const n=toNum(v); return (isFinite(n)&&n>=0)?n:NaN; }
function normName(s){ return String(s||"").trim().toLowerCase(); }

/* ================= STORICO + SUGGERIMENTI ================= */
function getExerciseLastBest(exName){
  const currentId = state.activeSessionId;
  const name = normName(exName);
  let last=null;
  let bestKg=null;

  const sessions = [...state.sessions]
    .filter(s => s && s.id !== currentId)
    .sort((a,b) => (a.date||"") < (b.date||"") ? 1 : -1);

  for (const s of sessions){
    for (const it of (s.items||[])){
      if (normName(it.ex) !== name) continue;
      for (const st of (it.sets||[])){
        const kg = toKg(st.kg);
        const reps = toReps(st.reps);
        if (isFinite(kg)){
          if (bestKg===null || kg>bestKg) bestKg=kg;
          if (!last){
            last = { date: s.date||"", kg, reps: isFinite(reps)?reps:null, rir: st.rir?String(st.rir):"" };
          }
        }
      }
    }
    if (last && bestKg!==null) break;
  }

  return { last, bestKg };
}

function fmtHistoryLine(h){
  const l = h?.last;
  const lastTxt = l
    ? `Ultima: ${l.kg.toFixed(1).replace(".0","")}kg${l.reps?` x ${l.reps}`:""}${l.rir?` (RIR ${l.rir})`:""} • ${l.date}`
    : "";
  const bestTxt = (h?.bestKg!==null && h?.bestKg!==undefined) ? `Best: ${h.bestKg.toFixed(1).replace(".0","")}kg` : "";
  return lastTxt && bestTxt ? `${lastTxt}  |  ${bestTxt}` : (lastTxt || bestTxt);
}

function suggestNextTarget(exName, target){
  const { last } = getExerciseLastBest(exName);
  if (!last || !isFinite(last.kg)) return null;

  const repMin = Number(target?.repMin || 0);
  const repMax = Number(target?.repMax || 0);
  const lastReps = last.reps;

  const bump = (kg) => kg < 20 ? 1 : Math.max(1, Math.round(kg * 0.025 * 2) / 2);
  const cut  = (kg) => kg < 20 ? 1 : Math.max(1, Math.round(kg * 0.025 * 2) / 2);

  let msg = "";
  let kgSug = last.kg;

  if (isFinite(lastReps) && repMax>0 && lastReps >= repMax){
    const inc = bump(last.kg);
    kgSug = last.kg + inc;
    msg = `Hai toccato il top range (${last.kg}kg x ${lastReps}). Prova ${kgSug.toFixed(1).replace(".0","")}kg (≈ +${inc}).`;
  } else if (isFinite(lastReps) && repMin>0 && lastReps < repMin){
    const dec = cut(last.kg);
    kgSug = Math.max(0, last.kg - dec);
    msg = `Sotto range (${last.kg}kg x ${lastReps}). Prova ${kgSug.toFixed(1).replace(".0","")}kg (≈ -${dec}).`;
  } else {
    msg = `Mantieni ${last.kg.toFixed(1).replace(".0","")}kg e prova +1 rep (se tecnica ok).`;
  }

  return { kgSuggested: kgSug, message: msg, last };
}

/* ================= PROGRESSIONE GRAFICO ================= */
function getAllExerciseNames(){
  const set = new Set();
  for (const s of state.sessions){
    for (const it of (s.items||[])){
      if (it?.ex) set.add(it.ex.trim());
    }
  }
  for (const p of state.plans){
    for (const d of (p.days||[])){
      for (const ex of (d.exercises||[])){
        if (ex?.ex) set.add(ex.ex.trim());
      }
    }
  }
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

function getExerciseDailySeries(exName){
  const name = normName(exName);
  const byDate = new Map(); // date -> { best, sum, n, volume }

  for (const s of state.sessions){
    const date = s.date || "";
    for (const it of (s.items||[])){
      if (normName(it.ex) !== name) continue;
      for (const st of (it.sets||[])){
        const kg = toKg(st.kg);
        const reps = toReps(st.reps);
        if (!isFinite(kg)) continue;

        const obj = byDate.get(date) || { best: 0, sum: 0, n: 0, volume: 0 };
        obj.best = Math.max(obj.best, kg);
        obj.sum += kg;
        obj.n += 1;
        if (isFinite(reps)) obj.volume += kg * reps;
        byDate.set(date, obj);
      }
    }
  }

  return Array.from(byDate.entries())
    .map(([date,v])=>({ date, best:v.best, avg: v.n? (v.sum/v.n):0, volume: v.volume }))
    .sort((a,b)=> (a.date<b.date?-1:1));
}

function drawChart(canvas, rows, mode){
  if(!canvas) return;
  const ctx = canvas.getContext("2d");

  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0,0,w,h);

  if(!rows.length){
    ctx.globalAlpha = 0.7;
    ctx.font = `${14*devicePixelRatio}px system-ui`;
    ctx.fillText("Nessun dato per questo esercizio.", 12*devicePixelRatio, 28*devicePixelRatio);
    ctx.globalAlpha = 1;
    return;
  }

  const pad = 18*devicePixelRatio;
  const ys = rows.map(r=>r[mode]);

  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.15 || 1;
  const min = Math.max(0, yMin - yPad);
  const max = yMax + yPad;

  const xTo = (i) => pad + (i/(Math.max(1, rows.length-1))) * (w - pad*2);
  const yTo = (v) => (h - pad) - ((v - min) / (max - min)) * (h - pad*2);

  // assi
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1*devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-pad, h-pad);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // linea
  ctx.lineWidth = 2*devicePixelRatio;
  ctx.beginPath();
  rows.forEach((r,i)=>{
    const x=xTo(i), y=yTo(r[mode]);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // punti
  rows.forEach((r,i)=>{
    const x=xTo(i), y=yTo(r[mode]);
    ctx.beginPath(); ctx.arc(x,y,3.5*devicePixelRatio,0,Math.PI*2); ctx.fill();
  });

  // label ultimo punto
  const last = rows[rows.length-1];
  ctx.font = `${12*devicePixelRatio}px system-ui`;
  ctx.globalAlpha = 0.8;
  const label = `${last.date} • ${last[mode].toFixed(1).replace(".0","")}`;
  ctx.fillText(label, pad, pad-4*devicePixelRatio);
  ctx.globalAlpha = 1;
}

function renderExerciseProgressUI(){
  const sel = $("exProgressSelect");
  const modeSel = $("exProgressMode");
  const sum = $("exProgressSummary");
  const canvas = $("exProgressChart");
  if(!sel || !modeSel || !sum || !canvas) return;

  const names = getAllExerciseNames();
  sel.innerHTML = "";
  names.forEach(n=>{
    const o=document.createElement("option");
    o.value=n; o.textContent=n;
    sel.appendChild(o);
  });

  // restore preferenze
  if (state.ui.exProgMode) modeSel.value = state.ui.exProgMode;
  if (state.ui.exProgName && names.includes(state.ui.exProgName)) sel.value = state.ui.exProgName;
  if (!sel.value && names[0]) sel.value = names[0];

  const refresh = ()=>{
    state.ui.exProgName = sel.value;
    state.ui.exProgMode = modeSel.value;
    saveState();

    const rows = getExerciseDailySeries(sel.value);
    const mode = modeSel.value;

    if (!rows.length){
      sum.textContent = "Nessun dato per questo esercizio: fai almeno una sessione e inserisci i carichi.";
    } else {
      const first = rows[0][mode];
      const last = rows[rows.length-1][mode];
      const delta = last - first;
      const sign = delta>=0 ? "+" : "";
      sum.textContent = `Andamento: ${rows.length} date • ${sign}${delta.toFixed(1).replace(".0","")} (${mode})`;
    }
    drawChart(canvas, rows, mode);
  };

  sel.onchange = refresh;
  modeSel.onchange = refresh;
  refresh();
}

/* ---------------- views/tabs ---------------- */
function setView(view){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.view===view));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-"+view)?.classList.remove("hidden");

  if(view==="progress"){
    renderHistory();
    renderPR();
    renderExerciseProgressUI();
  }
}
document.addEventListener("click",(e)=>{
  const tab=e.target.closest(".tab"); if(tab) setView(tab.dataset.view);
  const jump=e.target.closest("[data-jump]"); if(jump) setView(jump.dataset.jump);
});

/* ---------------- selectors active plan/diet ---------------- */
function populateActivePlanSelect(){
  const sel = $("activePlanSelect"); if(!sel) return;
  sel.innerHTML = "";
  state.plans.forEach(p=>{
    const o=document.createElement("option");
    o.value=p.id; o.textContent=p.name;
    sel.appendChild(o);
  });
  sel.value = state.activePlanId || (state.plans[0]?.id || "");
}
function populateActiveDietSelect(){
  const sel = $("activeDietSelect"); if(!sel) return;
  sel.innerHTML = "";
  state.diets.forEach(d=>{
    const o=document.createElement("option");
    o.value=d.id; o.textContent=d.name;
    sel.appendChild(o);
  });
  sel.value = state.activeDietId || (state.diets[0]?.id || "");
}

$("activePlanSelect")?.addEventListener("change", ()=>{
  state.activePlanId = $("activePlanSelect").value;
  saveState();
  populateDays();
  renderDayPreview();
  homeRefresh();
});
$("activeDietSelect")?.addEventListener("change", ()=>{
  state.activeDietId = $("activeDietSelect").value;
  saveState();
  renderDietPreview();
});

/* ---------------- workout preview ---------------- */
function populateDays(){
  const sel=$("daySelect");
  const plan = getActivePlan();
  if(!sel || !plan) return;
  sel.innerHTML="";
  plan.days.forEach(d=>{
    const o=document.createElement("option");
    o.value=d.id; o.textContent=d.name;
    sel.appendChild(o);
  });
  if (!sel.value && plan.days[0]) sel.value = plan.days[0].id;
}

function renderDayPreview(){
  const box=$("dayPreview"), sel=$("daySelect");
  const plan = getActivePlan();
  if(!box||!sel||!plan) return;
  const day=plan.days.find(d=>d.id===sel.value); if(!day) return;
  box.innerHTML="";
  day.exercises.forEach(ex=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <div class="itemTop">
        <div class="itemTitle">${ex.ex}</div>
        <div class="badge">${ex.sets} • ${ex.repMin}-${ex.repMax} • RIR ${ex.rir}</div>
      </div>
      <div class="muted small">Recupero: ${ex.rest}</div>`;
    box.appendChild(div);
  });
}
$("daySelect")?.addEventListener("change", renderDayPreview);

/* ================= SESSION ================= */
let timer={running:false,remaining:0,interval:null};

function timerSet(seconds){
  timer.remaining=Math.max(0,Math.floor(seconds));
  $("timerTime").textContent=fmtMMSS(timer.remaining);
}
function timerStop(){ timer.running=false; clearInterval(timer.interval); timer.interval=null; }
function timerStart(){
  if(timer.running) return;
  timer.running=true;
  timer.interval=setInterval(()=>{
    timer.remaining=Math.max(0,timer.remaining-1);
    $("timerTime").textContent=fmtMMSS(timer.remaining);
    if(timer.remaining<=0){
      timerStop();
      toast("Recupero finito");
    }
  },1000);
}
function timerAutoFromExercise(){
  const s=activeSession(); if(!s) return;
  const it=s.items[state.activeExIndex];
  timerStop();
  timerSet(parseRestToSeconds(it.target.rest));
  timerStart();
}

function openSessionUI(){
  $("session").classList.remove("hidden");
  document.body.classList.add("session-open");
  document.body.style.overflow="hidden";
}
function closeSessionUI(){
  $("session").classList.add("hidden");
  document.body.classList.remove("session-open");
  document.body.style.overflow="";
  timerStop();
}

function startSession(dayId){
  const plan = getActivePlan();
  if(!plan) return;
  const day = plan.days.find(d=>d.id===dayId);
  if(!day) return;

  const session={
    id:uid(),
    date:todayISO(),
    planId: plan.id,
    dayId:day.id,
    dayName:day.name,
    items:day.exercises.map(ex=>({
      ex:ex.ex,
      unit:ex.unit||"reps",
      target:{sets:ex.sets,repMin:ex.repMin,repMax:ex.repMax,rir:ex.rir,rest:ex.rest},
      sets:Array.from({length:ex.sets},()=>({kg:"",reps:"",rir:""}))
    })),
    closed:false
  };

  state.sessions.push(session);
  state.activeSessionId=session.id;
  state.activeExIndex=0;
  state.activeSetIndex=0;
  saveState();

  openSessionUI();
  renderSession();
  toast("Sessione avviata");
}

function activeSession(){
  if(!state.activeSessionId) return null;
  return state.sessions.find(s=>s.id===state.activeSessionId)||null;
}

function renderSingleSet(){
  const s=activeSession(); if(!s) return;
  const it=s.items[state.activeExIndex];
  const idx=state.activeSetIndex;
  const st=it.sets[idx];

  const hist = getExerciseLastBest(it.ex);
  const histLine = fmtHistoryLine(hist);

  const sug = suggestNextTarget(it.ex, it.target);
  const sugLine = sug?.message || "";

  $("singleSetBox").innerHTML=`
    <div class="singleCard">
      <div class="singleTop">
        <div class="singleTitle">Serie ${idx+1} di ${it.sets.length}</div>
        <div class="badge">ATTIVA</div>
      </div>

      ${histLine ? `<div class="tip" style="margin:0 0 10px 0">${histLine}</div>` : ""}
      ${sugLine ? `<div class="tip" style="margin:0 0 10px 0"><b>Suggerimento:</b> ${sugLine}</div>` : ""}

      <div class="singleGrid">
        <label class="field">
          <span>Kg</span>
          <input inputmode="decimal" id="inKg" value="${st.kg}">
        </label>
        <label class="field">
          <span>Reps</span>
          <input inputmode="numeric" id="inReps" value="${st.reps}">
        </label>
        <label class="field">
          <span>RIR</span>
          <input inputmode="numeric" id="inRir" value="${st.rir}">
        </label>
      </div>

      <div class="muted small">Scheda: ${it.target.repMin}-${it.target.repMax} reps • RIR ${it.target.rir}</div>
    </div>
  `;

  // auto-compila kg suggerito SOLO se vuoto
  if (sug?.kgSuggested && !String(st.kg||"").trim()){
    st.kg = sug.kgSuggested.toFixed(1).replace(".0","");
    saveState();
    $("inKg").value = st.kg;
  }

  $("inKg").addEventListener("input",(e)=>{ st.kg=e.target.value; saveState(); });
  $("inReps").addEventListener("input",(e)=>{ st.reps=e.target.value; saveState(); });
  $("inRir").addEventListener("input",(e)=>{ st.rir=e.target.value; saveState(); });
}

function renderSession(){
  const s=activeSession();
  if(!s) return closeSessionUI();

  $("sessionDay").textContent=s.dayName;
  $("sessionDate").textContent=s.date;

  const it=s.items[state.activeExIndex];
  $("exName").textContent=it.ex;

  const t=it.target;
  const hist = getExerciseLastBest(it.ex);
  const histLine = fmtHistoryLine(hist);

  const sug = suggestNextTarget(it.ex, it.target);
  const sugShort = sug ? `Suggerito: ${sug.kgSuggested.toFixed(1).replace(".0","")}kg` : "";

  $("exTarget").textContent =
    `Target: ${t.sets}x ${t.repMin}-${t.repMax} • RIR ${t.rir} • Rec ${t.rest}` +
    (histLine ? `  —  ${histLine}` : "") +
    (sugShort ? `  —  ${sugShort}` : "");

  if(!timer.running && timer.remaining===0){
    timerSet(parseRestToSeconds(it.target.rest));
  }
  renderSingleSet();
}

function saveSetAndAutoTimer(){
  const s=activeSession(); if(!s) return;
  const it=s.items[state.activeExIndex];
  const idx=state.activeSetIndex;
  const st=it.sets[idx];

  if(!String(st.reps||"").trim()){
    toast("Inserisci reps");
    return;
  }
  toast(`Serie ${idx+1} salvata`);
  timerAutoFromExercise();
}

function nextSet(){
  const s=activeSession(); if(!s) return;
  const it=s.items[state.activeExIndex];
  if(state.activeSetIndex < it.sets.length-1){
    state.activeSetIndex++;
    saveState();
    renderSession();
  } else toast("Ultima serie: passa al prossimo esercizio");
}
function nextExercise(){
  const s=activeSession(); if(!s) return;
  if(state.activeExIndex < s.items.length-1){
    state.activeExIndex++;
    state.activeSetIndex=0;
    saveState();
    timerStop();
    timerSet(parseRestToSeconds(s.items[state.activeExIndex].target.rest));
    renderSession();
  } else toast("Ultimo esercizio");
}
function prevExercise(){
  const s=activeSession(); if(!s) return;
  if(state.activeExIndex>0){
    state.activeExIndex--;
    state.activeSetIndex=0;
    saveState();
    timerStop();
    timerSet(parseRestToSeconds(s.items[state.activeExIndex].target.rest));
    renderSession();
  }
}

/* session buttons */
$("btnSaveSet")?.addEventListener("click", saveSetAndAutoTimer);
$("btnNextSet")?.addEventListener("click", nextSet);
$("btnNextExercise")?.addEventListener("click", nextExercise);
$("btnNextEx")?.addEventListener("click", nextExercise);
$("btnPrevEx")?.addEventListener("click", prevExercise);

$("btnSessionExit")?.addEventListener("click", ()=>{
  closeSessionUI();
  state.activeSessionId=null;
  saveState();
});
$("btnSessionFinish")?.addEventListener("click", ()=>{
  const s=activeSession(); if(!s) return;
  s.closed=true;
  state.activeSessionId=null;
  timerStop();
  saveState();
  closeSessionUI();
  renderHistory();
  renderPR();
  toast("Sessione chiusa e salvata");
});

$("btnTimerStart")?.addEventListener("click", timerStart);
$("btnTimerPause")?.addEventListener("click", ()=>{ timerStop(); toast("Timer in pausa"); });
$("btnTimerSkip")?.addEventListener("click", ()=>{ timerStop(); timerSet(0); toast("Recupero saltato"); });

/* =================== LIBRERIA SCHEDE + EDITOR =================== */
function renderPlansList(){
  const box = $("plansList"); if(!box) return;
  box.innerHTML = "";
  if (!state.plans.length){
    box.innerHTML = `<div class="muted">Nessuna scheda. Clicca “Nuova scheda”.</div>`;
    return;
  }
  state.plans.forEach(p=>{
    const div=document.createElement("div");
    div.className="item";
    const isActive = p.id === state.activePlanId;
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${p.name} ${isActive ? "• (attiva)" : ""}</div>
        <div class="badge">${p.days.length} giorni</div>
      </div>
      <div class="miniActions">
        <button class="iconBtn primary" data-plan-use="${p.id}">Usa</button>
        <button class="iconBtn" data-plan-edit="${p.id}">Modifica</button>
        <button class="iconBtn" data-plan-dup="${p.id}">Duplica</button>
        <button class="iconBtn danger" data-plan-del="${p.id}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });
}

function openPlans(){
  renderPlansList();
  setView("plans");
}

function planEditing(){
  return state.plans.find(p=>p.id===state.ui.planEditId) || null;
}
function planDayById(plan, id){
  return plan.days.find(d=>d.id===id) || null;
}

function openPlanEditor(planId){
  const p = state.plans.find(x=>x.id===planId);
  if(!p) return;

  state.ui.planEditId = p.id;
  state.ui.planEditDayId = p.days[0]?.id || null;
  saveState();

  $("planEditTitle").textContent = `Editor Scheda: ${p.name}`;
  $("planName").value = p.name;
  $("newDayName").value = "";

  populatePlanDaySelect();
  renderPlanDaysList();
  renderPlanExercisesList();
  setView("planedit");
}

function populatePlanDaySelect(){
  const sel = $("planDaySelect");
  const plan = planEditing();
  if(!sel || !plan) return;
  sel.innerHTML = "";
  plan.days.forEach(d=>{
    const o=document.createElement("option");
    o.value=d.id; o.textContent=d.name;
    sel.appendChild(o);
  });
  sel.value = state.ui.planEditDayId || (plan.days[0]?.id || "");
}

function renderPlanDaysList(){
  const box = $("planDaysList");
  const plan = planEditing();
  if(!box || !plan) return;
  box.innerHTML = "";
  plan.days.forEach((d)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${d.name}</div>
        <div class="badge">${d.exercises.length} esercizi</div>
      </div>
      <div class="miniActions">
        <button class="iconBtn primary" data-peday-select="${d.id}">Seleziona</button>
        <button class="iconBtn" data-peday-up="${d.id}">↑</button>
        <button class="iconBtn" data-peday-down="${d.id}">↓</button>
        <button class="iconBtn danger" data-peday-del="${d.id}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });
}

function renderPlanExercisesList(){
  const box = $("planExercisesList");
  const plan = planEditing();
  if(!box || !plan) return;

  const dayId = $("planDaySelect")?.value || state.ui.planEditDayId;
  const day = planDayById(plan, dayId);
  if(!day){
    box.innerHTML = `<div class="muted">Seleziona un giorno.</div>`;
    return;
  }
  state.ui.planEditDayId = day.id;
  saveState();

  box.innerHTML = "";
  if(!day.exercises.length){
    box.innerHTML = `<div class="muted">Nessun esercizio. Aggiungine uno sopra.</div>`;
    return;
  }

  day.exercises.forEach((ex,idx)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${idx+1}. ${ex.ex}</div>
        <div class="badge">${ex.sets}x ${ex.repMin}-${ex.repMax} • RIR ${ex.rir} • ${ex.rest}</div>
      </div>
      <div class="miniActions">
        <button class="iconBtn" data-peex-up="${idx}">↑</button>
        <button class="iconBtn" data-peex-down="${idx}">↓</button>
        <button class="iconBtn danger" data-peex-del="${idx}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });
}

document.addEventListener("click",(e)=>{
  const use = e.target.closest("[data-plan-use]");
  const edit = e.target.closest("[data-plan-edit]");
  const dup = e.target.closest("[data-plan-dup]");
  const del = e.target.closest("[data-plan-del]");

  if(use){
    state.activePlanId = use.dataset.planUse;
    saveState();
    populateActivePlanSelect();
    populateDays();
    renderDayPreview();
    homeRefresh();
    renderPlansList();
    toast("Scheda impostata");
  }
  if(edit) openPlanEditor(edit.dataset.planEdit);

  if(dup){
    const p = state.plans.find(x=>x.id===dup.dataset.planDup);
    if(!p) return;
    const c = clone(p);
    c.id = uid().slice(0,8);
    c.name = `${p.name} (copia)`;
    state.plans.push(c);
    saveState();
    renderPlansList();
    populateActivePlanSelect();
    toast("Scheda duplicata");
  }

  if(del){
    const id = del.dataset.planDel;
    if(!confirm("Eliminare questa scheda?")) return;
    const idx = state.plans.findIndex(x=>x.id===id);
    if(idx>=0) state.plans.splice(idx,1);
    if(state.activePlanId===id) state.activePlanId = state.plans[0]?.id || null;
    saveState();
    renderPlansList();
    populateActivePlanSelect();
    populateDays();
    renderDayPreview();
    homeRefresh();
    toast("Scheda eliminata");
  }

  const plan = planEditing();
  if(!plan) return;

  const sel = e.target.closest("[data-peday-select]");
  const up  = e.target.closest("[data-peday-up]");
  const dn  = e.target.closest("[data-peday-down]");
  const ddel = e.target.closest("[data-peday-del]");

  if(sel){
    state.ui.planEditDayId = sel.dataset.pedaySelect;
    saveState();
    populatePlanDaySelect();
    renderPlanExercisesList();
    toast("Giorno selezionato");
  }
  if(up||dn||ddel){
    const id2 = (up?.dataset.pedayUp) || (dn?.dataset.pedayDown) || (ddel?.dataset.pedayDel);
    const i = plan.days.findIndex(d=>d.id===id2);
    if(i<0) return;
    if(up) moveItem(plan.days, i, i-1);
    if(dn) moveItem(plan.days, i, i+1);
    if(ddel){
      if(!confirm("Eliminare il giorno?")) return;
      plan.days.splice(i,1);
      if(state.ui.planEditDayId===id2) state.ui.planEditDayId = plan.days[0]?.id || null;
    }
    saveState();
    populatePlanDaySelect();
    renderPlanDaysList();
    renderPlanExercisesList();
    populateDays(); renderDayPreview();
  }

  const exUp = e.target.closest("[data-peex-up]");
  const exDn = e.target.closest("[data-peex-down]");
  const exDel = e.target.closest("[data-peex-del]");
  if(exUp||exDn||exDel){
    const day = planDayById(plan, $("planDaySelect").value);
    if(!day) return;
    const idx = Number(exUp?.dataset.peexUp || exDn?.dataset.peexDown || exDel?.dataset.peexDel);
    if(exUp) moveItem(day.exercises, idx, idx-1);
    if(exDn) moveItem(day.exercises, idx, idx+1);
    if(exDel){
      if(!confirm("Eliminare esercizio?")) return;
      day.exercises.splice(idx,1);
    }
    saveState();
    renderPlanExercisesList();
    populateDays(); renderDayPreview();
  }
});

$("btnPlanSaveName")?.addEventListener("click", ()=>{
  const plan = planEditing(); if(!plan) return;
  plan.name = $("planName").value.trim() || "Scheda";
  saveState();
  populateActivePlanSelect();
  renderPlansList();
  $("planEditTitle").textContent = `Editor Scheda: ${plan.name}`;
  homeRefresh();
  toast("Nome salvato");
});

$("btnAddDay")?.addEventListener("click", ()=>{
  const plan = planEditing(); if(!plan) return;
  const name = $("newDayName").value.trim();
  if(!name){ toast("Inserisci nome giorno"); return; }
  const id = uid().slice(0,6);
  plan.days.push({ id, name, exercises: [] });
  state.ui.planEditDayId = id;
  saveState();
  $("newDayName").value="";
  populatePlanDaySelect();
  renderPlanDaysList();
  renderPlanExercisesList();
  populateDays(); renderDayPreview();
  toast("Giorno aggiunto");
});

$("planDaySelect")?.addEventListener("change", ()=>{
  state.ui.planEditDayId = $("planDaySelect").value;
  saveState();
  renderPlanExercisesList();
});

$("btnAddExercise")?.addEventListener("click", ()=>{
  const plan = planEditing(); if(!plan) return;
  const day = planDayById(plan, $("planDaySelect").value);
  if(!day){ toast("Seleziona un giorno"); return; }

  const ex = $("exNameIn").value.trim();
  if(!ex){ toast("Inserisci esercizio"); return; }

  const sets = Number($("exSetsIn").value||0);
  const repMin = Number($("exRepMinIn").value||0);
  const repMax = Number($("exRepMaxIn").value||0);
  const rir = $("exRirIn").value.trim() || "1-2";
  const rest = $("exRestIn").value.trim() || "90";
  if(!(sets>0 && repMin>0 && repMax>0)){ toast("Controlla serie e reps"); return; }

  day.exercises.push({ ex, sets, repMin, repMax, rir, rest });
  saveState();
  $("exNameIn").value="";
  renderPlanExercisesList();
  populateDays(); renderDayPreview();
  toast("Esercizio aggiunto");
});

$("btnDuplicateDay")?.addEventListener("click", ()=>{
  const plan = planEditing(); if(!plan) return;
  const day = planDayById(plan, $("planDaySelect").value);
  if(!day){ toast("Seleziona un giorno"); return; }
  const c = clone(day);
  c.id = uid().slice(0,6);
  c.name = day.name + " (copia)";
  plan.days.push(c);
  state.ui.planEditDayId = c.id;
  saveState();
  populatePlanDaySelect();
  renderPlanDaysList();
  renderPlanExercisesList();
  toast("Giorno duplicato");
});

$("btnPlanDelete")?.addEventListener("click", ()=>{
  const plan = planEditing(); if(!plan) return;
  if(!confirm("Eliminare questa scheda?")) return;
  const id = plan.id;
  const idx = state.plans.findIndex(p=>p.id===id);
  if(idx>=0) state.plans.splice(idx,1);
  if(state.activePlanId===id) state.activePlanId = state.plans[0]?.id || null;
  state.ui.planEditId = null;
  state.ui.planEditDayId = null;
  saveState();
  populateActivePlanSelect();
  populateDays(); renderDayPreview(); homeRefresh();
  openPlans();
  toast("Scheda eliminata");
});

/* =================== LIBRERIA DIETE + EDITOR =================== */
function renderDietsList(){
  const box = $("dietsList"); if(!box) return;
  box.innerHTML = "";
  if (!state.diets.length){
    box.innerHTML = `<div class="muted">Nessuna dieta. Clicca “Nuova dieta”.</div>`;
    return;
  }
  state.diets.forEach(d=>{
    const div=document.createElement("div");
    div.className="item";
    const isActive = d.id === state.activeDietId;
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${d.name} ${isActive ? "• (attiva)" : ""}</div>
        <div class="badge">7 giorni</div>
      </div>
      <div class="miniActions">
        <button class="iconBtn primary" data-diet-use="${d.id}">Usa</button>
        <button class="iconBtn" data-diet-edit="${d.id}">Modifica</button>
        <button class="iconBtn" data-diet-dup="${d.id}">Duplica</button>
        <button class="iconBtn danger" data-diet-del="${d.id}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });
}

function openDiets(){
  renderDietsList();
  setView("diets");
}

function dietEditing(){ return state.diets.find(d=>d.id===state.ui.dietEditId) || null; }

function populateDietEditDays(){
  const sel = $("dietEditDaySelect"); if(!sel) return;
  sel.innerHTML = "";
  const labels=["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  for(let i=0;i<7;i++){
    const o=document.createElement("option");
    o.value=String(i); o.textContent=labels[i];
    sel.appendChild(o);
  }
  sel.value = String(state.ui.dietEditDayIndex || 0);
}

function renderDietFoodsList(){
  const d = dietEditing();
  const box = $("dietFoodsList");
  if(!d || !box) return;

  const di = Number($("dietEditDaySelect").value);
  const mi = Number($("dietEditMealSelect").value);

  state.ui.dietEditDayIndex = di;
  state.ui.dietEditMeal = mi;
  saveState();

  const items = d.week[di].meals[mi] || [];
  box.innerHTML = "";

  if(!items.length){
    box.innerHTML = `<div class="muted">Nessun alimento in questo pasto. Aggiungine uno sopra.</div>`;
    return;
  }

  items.forEach((it, idx)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${it.food}</div>
        <div class="badge">${it.qty} ${it.unit}</div>
      </div>
      <div class="miniActions">
        <button class="iconBtn" data-food-up="${idx}">↑</button>
        <button class="iconBtn" data-food-down="${idx}">↓</button>
        <button class="iconBtn danger" data-food-del="${idx}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });
}

function openDietEditor(dietId){
  const d = state.diets.find(x=>x.id===dietId);
  if(!d) return;

  state.ui.dietEditId = d.id;
  saveState();

  $("dietEditTitle").textContent = `Editor Dieta: ${d.name}`;
  $("dietName").value = d.name;

  populateDietEditDays();
  $("dietEditMealSelect").value = String(state.ui.dietEditMeal || 1);
  renderDietFoodsList();
  setView("dietedit");
}

document.addEventListener("click",(e)=>{
  const use = e.target.closest("[data-diet-use]");
  const edit = e.target.closest("[data-diet-edit]");
  const dup = e.target.closest("[data-diet-dup]");
  const del = e.target.closest("[data-diet-del]");

  if(use){
    state.activeDietId = use.dataset.dietUse;
    saveState();
    populateActiveDietSelect();
    renderDietPreview();
    renderDietsList();
    toast("Dieta impostata");
  }
  if(edit) openDietEditor(edit.dataset.dietEdit);

  if(dup){
    const d = state.diets.find(x=>x.id===dup.dataset.dietDup);
    if(!d) return;
    const c = clone(d);
    c.id = uid().slice(0,8);
    c.name = `${d.name} (copia)`;
    state.diets.push(c);
    saveState();
    renderDietsList();
    populateActiveDietSelect();
    toast("Dieta duplicata");
  }

  if(del){
    const id = del.dataset.dietDel;
    if(!confirm("Eliminare questa dieta?")) return;
    const idx = state.diets.findIndex(x=>x.id===id);
    if(idx>=0) state.diets.splice(idx,1);
    if(state.activeDietId===id) state.activeDietId = state.diets[0]?.id || null;
    saveState();
    renderDietsList();
    populateActiveDietSelect();
    renderDietPreview();
    toast("Dieta eliminata");
  }

  const d = dietEditing();
  if(!d) return;

  const up = e.target.closest("[data-food-up]");
  const dn = e.target.closest("[data-food-down]");
  const fdel = e.target.closest("[data-food-del]");
  if(up||dn||fdel){
    const di = Number($("dietEditDaySelect").value);
    const mi = Number($("dietEditMealSelect").value);
    const arr = d.week[di].meals[mi] || [];
    const idx = Number(up?.dataset.foodUp || dn?.dataset.foodDown || fdel?.dataset.foodDel);

    if(up) moveItem(arr, idx, idx-1);
    if(dn) moveItem(arr, idx, idx+1);
    if(fdel){
      if(!confirm("Eliminare alimento?")) return;
      arr.splice(idx,1);
    }
    d.week[di].meals[mi] = arr;
    saveState();
    renderDietFoodsList();
    renderDietPreview();
  }
});

$("btnDietSaveName")?.addEventListener("click", ()=>{
  const d = dietEditing(); if(!d) return;
  d.name = $("dietName").value.trim() || "Dieta";
  saveState();
  populateActiveDietSelect();
  renderDietsList();
  $("dietEditTitle").textContent = `Editor Dieta: ${d.name}`;
  toast("Nome salvato");
});
$("dietEditDaySelect")?.addEventListener("change", renderDietFoodsList);
$("dietEditMealSelect")?.addEventListener("change", renderDietFoodsList);

$("btnAddFood")?.addEventListener("click", ()=>{
  const d = dietEditing(); if(!d) return;
  const di = Number($("dietEditDaySelect").value);
  const mi = Number($("dietEditMealSelect").value);

  const food = $("foodNameIn").value.trim();
  const qty = Number($("foodQtyIn").value || 0);
  const unit = $("foodUnitIn").value;

  if(!food){ toast("Inserisci alimento"); return; }
  if(!(qty>0)){ toast("Quantità non valida"); return; }

  const arr = d.week[di].meals[mi] || [];
  arr.push({ food, qty, unit });
  d.week[di].meals[mi] = arr;
  saveState();

  $("foodNameIn").value="";
  renderDietFoodsList();
  renderDietPreview();
  toast("Alimento aggiunto");
});

$("btnCopyDayToAll")?.addEventListener("click", ()=>{
  const d = dietEditing(); if(!d) return;
  const di = Number($("dietEditDaySelect").value);
  if(!confirm("Copiare questo giorno su tutti i giorni?")) return;
  const dayCopy = clone(d.week[di]);
  for(let i=0;i<7;i++) d.week[i] = clone(dayCopy);
  saveState();
  renderDietFoodsList();
  renderDietPreview();
  toast("Giorno copiato su tutti");
});

$("btnCopyMealToAllDays")?.addEventListener("click", ()=>{
  const d = dietEditing(); if(!d) return;
  const di = Number($("dietEditDaySelect").value);
  const mi = Number($("dietEditMealSelect").value);
  if(!confirm("Copiare questo pasto su tutti i giorni?")) return;
  const mealCopy = clone(d.week[di].meals[mi] || []);
  for(let i=0;i<7;i++) d.week[i].meals[mi] = clone(mealCopy);
  saveState();
  renderDietFoodsList();
  renderDietPreview();
  toast("Pasto copiato su tutti");
});

$("btnDietDelete")?.addEventListener("click", ()=>{
  const d = dietEditing(); if(!d) return;
  if(!confirm("Eliminare questa dieta?")) return;
  const id = d.id;
  const idx = state.diets.findIndex(x=>x.id===id);
  if(idx>=0) state.diets.splice(idx,1);
  if(state.activeDietId===id) state.activeDietId = state.diets[0]?.id || null;
  state.ui.dietEditId = null;
  saveState();
  populateActiveDietSelect();
  renderDietPreview();
  openDiets();
  toast("Dieta eliminata");
});

/* ---------------- diet preview ---------------- */
function populateDietDays(){
  const sel=$("dietDaySelect"); if(!sel) return;
  sel.innerHTML="";
  const labels=["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  for(let i=0;i<7;i++){
    const o=document.createElement("option");
    o.value=String(i); o.textContent=labels[i];
    sel.appendChild(o);
  }
  sel.value = "0";
}

function renderDietPreview(){
  const box=$("dietPreview"), daySel=$("dietDaySelect"), mealSel=$("mealSelect");
  const diet = getActiveDiet();
  if(!box || !diet || !daySel || !mealSel) return;

  const di=Number(daySel.value||0), mi=Number(mealSel.value||1);
  const items=diet.week[di].meals[mi]||[];

  box.innerHTML="";
  if(!items.length){
    box.innerHTML = `<div class="muted">Pasto vuoto. Vai su “Le mie diete” → Modifica.</div>`;
    return;
  }
  items.forEach(it=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <div class="itemTop">
        <div class="itemTitle">${it.food}</div>
        <div class="badge">${it.qty} ${it.unit}</div>
      </div>`;
    box.appendChild(div);
  });
}

$("dietDaySelect")?.addEventListener("change", renderDietPreview);
$("mealSelect")?.addEventListener("change", renderDietPreview);

/* ---------------- grocery ---------------- */
function generateGrocery(){
  const diet = getActiveDiet();
  if(!diet) return null;
  const agg=new Map();
  for(let d=0;d<7;d++){
    for(let m=1;m<=5;m++){
      for(const it of (diet.week[d].meals[m]||[])){
        const key=`${it.food}||${it.unit}`;
        agg.set(key,(agg.get(key)||0)+Number(it.qty||0));
      }
    }
  }
  return Array.from(agg.entries()).map(([k,qty])=>{
    const [food,unit]=k.split("||");
    return {food,qty,unit};
  }).sort((a,b)=>a.food.localeCompare(b.food));
}
function showGrocery(){
  const list=generateGrocery();
  if(!list){ toast("Seleziona una dieta"); return; }
  alert("LISTA SPESA SETTIMANALE\n\n"+list.map(x=>`• ${x.food}: ${x.qty} ${x.unit}`).join("\n"));
}

/* ---------------- progress ---------------- */
function renderHistory(){
  const box=$("sessionHistory"); if(!box) return;
  box.innerHTML="";
  const sessions=[...state.sessions].sort((a,b)=>a.date<b.date?1:-1);
  if(!sessions.length){ box.innerHTML=`<div class="muted">Nessuna sessione.</div>`; return; }
  sessions.slice(0,60).forEach(s=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <div class="itemTop">
        <div class="itemTitle">${s.dayName}</div>
        <div class="badge">${s.date}${s.closed?"":" • (aperta)"}</div>
      </div>`;
    box.appendChild(div);
  });
}

function renderPR(){
  const box=$("prBox"); if(!box) return;
  box.innerHTML="";
  const pr=new Map();
  for(const s of state.sessions){
    for(const it of (s.items||[])){
      for(const st of (it.sets||[])){
        const kg=toKg(st.kg);
        if(!isFinite(kg)) continue;
        pr.set(it.ex, Math.max(pr.get(it.ex)||0, kg));
      }
    }
  }
  if(!pr.size){ box.innerHTML=`<div class="muted">Inserisci sessioni per PR.</div>`; return; }
  Array.from(pr.entries()).sort((a,b)=>b[1]-a[1]).slice(0,40).forEach(([ex,kg])=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div class="itemTop"><div class="itemTitle">${ex}</div><div class="badge">${kg.toFixed(1).replace(".0","")} kg</div></div>`;
    box.appendChild(div);
  });
}

/* ---------------- home & settings ---------------- */
function homeRefresh(){
  $("homeKcal").textContent=`${state.settings.kcal} kcal`;
  $("homeSessions").textContent=String(state.sessions.length);
  $("homePlanName").textContent=getActivePlan()?.name || "—";

  const plan = getActivePlan();
  const dow=new Date().getDay();
  let today="Riposo";
  if(plan){
    const map={1:"mon",2:"tue",4:"thu",5:"fri"};
    const id=map[dow];
    const d=id?plan.days.find(x=>x.id===id):null;
    if(d) today=d.name;
  }
  $("homeTodayWorkout").textContent=today;
}

function renderSettings(){
  $("setWeight").value=state.settings.weightKg;
  $("setMeals").value=state.settings.mealsPerDay;
  $("setKcal").value=state.settings.kcal;
  $("setP").value=state.settings.p;
  $("setC").value=state.settings.c;
  $("setF").value=state.settings.f;

  $("kcalTarget").textContent=state.settings.kcal;
  $("pTarget").textContent=state.settings.p+" g";
  $("cTarget").textContent=state.settings.c+" g";
  $("fTarget").textContent=state.settings.f+" g";
}

/* ---------------- buttons navigation ---------------- */
$("btnOpenPlans")?.addEventListener("click", openPlans);
$("btnPlansBack")?.addEventListener("click", ()=>setView("workout"));
$("btnPlanEditBack")?.addEventListener("click", openPlans);

$("btnOpenDiets")?.addEventListener("click", openDiets);
$("btnDietsBack")?.addEventListener("click", ()=>setView("diet"));
$("btnDietEditBack")?.addEventListener("click", openDiets);

$("btnPlanNew")?.addEventListener("click", ()=>{
  const name = prompt("Nome nuova scheda:", "Nuova scheda");
  if(!name) return;
  const p = { id: uid().slice(0,8), name: name.trim(), days: [] };
  state.plans.push(p);
  state.activePlanId = p.id;
  saveState();
  populateActivePlanSelect();
  populateDays(); renderDayPreview(); homeRefresh();
  openPlanEditor(p.id);
  toast("Scheda creata");
});

$("btnDietNew")?.addEventListener("click", ()=>{
  const name = prompt("Nome nuova dieta:", "Nuova dieta");
  if(!name) return;
  const d = { id: uid().slice(0,8), name: name.trim(), week: defaultDietWeek().week };
  state.diets.push(d);
  state.activeDietId = d.id;
  saveState();
  populateActiveDietSelect();
  renderDietPreview();
  openDietEditor(d.id);
  toast("Dieta creata");
});

$("btnLoadDefaultPlan")?.addEventListener("click", ()=>{
  const p = defaultWorkout4Days();
  state.plans.push(p);
  state.activePlanId = p.id;
  saveState();
  populateActivePlanSelect();
  populateDays(); renderDayPreview();
  homeRefresh();
  toast("Scheda 4gg aggiunta");
});

$("btnLoadDefaultDiet")?.addEventListener("click", ()=>{
  const d = defaultDietWeek();
  state.diets.push(d);
  state.activeDietId = d.id;
  saveState();
  populateActiveDietSelect();
  renderDietPreview();
  toast("Dieta base aggiunta");
});

$("btnStartDay")?.addEventListener("click", ()=>{
  const plan = getActivePlan();
  if(!plan){ toast("Crea o seleziona una scheda"); return; }
  const id=$("daySelect")?.value; if(!id) return;
  startSession(id);
});

$("btnStartSession")?.addEventListener("click", ()=>{
  const plan = getActivePlan();
  if(!plan){ toast("Crea o seleziona una scheda"); return; }
  const dow=new Date().getDay();
  const map={1:"mon",2:"tue",4:"thu",5:"fri"};
  const id=map[dow]||plan.days[0]?.id;
  if(!id){ toast("La scheda non ha giorni"); return; }
  startSession(id);
});

$("btnTodayMeals")?.addEventListener("click", ()=>{
  setView("diet");
  $("dietDaySelect").value = String((new Date().getDay()+6)%7);
  $("mealSelect").value = "1";
  renderDietPreview();
});

$("btnGenerateGrocery")?.addEventListener("click", showGrocery);
$("btnGrocery")?.addEventListener("click", showGrocery);
$("btnBackup")?.addEventListener("click", ()=>setView("settings"));

$("btnSaveSettings")?.addEventListener("click",()=>{
  state.settings.weightKg=Number($("setWeight").value||0);
  state.settings.mealsPerDay=Number($("setMeals").value||5);
  state.settings.kcal=Number($("setKcal").value||0);
  state.settings.p=Number($("setP").value||0);
  state.settings.c=Number($("setC").value||0);
  state.settings.f=Number($("setF").value||0);
  saveState();
  renderSettings();
  homeRefresh();
  toast("Impostazioni salvate");
});

/* ---------------- backup ---------------- */
$("btnExport")?.addEventListener("click",()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`fitplanner_backup_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("fileImport")?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const txt=await f.text();
  const obj=safeParse(txt);
  if(!obj){ toast("JSON non valido"); return; }
  state=obj;
  saveState();
  boot();
  toast("Import completato");
});

/* ---------------- init helpers ---------------- */
function ensureBaseData(){
  if(!state.plans) state.plans = [];
  if(!state.diets) state.diets = [];
  if(!state.sessions) state.sessions = [];

  if(!state.activePlanId) state.activePlanId = state.plans[0]?.id || null;
  if(!state.activeDietId) state.activeDietId = state.diets[0]?.id || null;

  // migrazioni leggere (se arrivassi da versioni vecchie)
  if(state.workoutPlan && !state.plans.length){
    const p = clone(state.workoutPlan);
    p.id = uid().slice(0,8);
    state.plans = [p];
    state.activePlanId = p.id;
    delete state.workoutPlan;
  }
  if(state.dietPlan && !state.diets.length){
    const d = clone(state.dietPlan);
    d.id = uid().slice(0,8);
    state.diets = [d];
    state.activeDietId = d.id;
    delete state.dietPlan;
  }
}

function boot(){
  ensureBaseData();

  populateActivePlanSelect();
  populateDays();
  renderDayPreview();

  populateActiveDietSelect();
  populateDietDays();
  renderDietPreview();

  renderSettings();
  renderHistory();
  renderPR();
  homeRefresh();

  if(state.activeSessionId){
    openSessionUI();
    renderSession();
  } else {
    closeSessionUI();
  }

  // progress UI (solo quando entri, ma inizializzo se già presente)
  renderExerciseProgressUI();

  saveState();
}
boot();