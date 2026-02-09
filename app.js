/* Fit Planner — app.js
   ✅ Sessione 1 serie alla volta + timer recupero
   ✅ Editor Scheda (giorni + esercizi)
   ✅ Editor Dieta (giorni + pasti + alimenti)
*/

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/BET-STATS/sw.js").catch(() => {});
}

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const todayISO = () => new Date().toISOString().slice(0, 10);
const KEY = "fitplanner_v4";

const DEFAULT = {
  settings: { weightKg: 68, mealsPerDay: 5, kcal: 2900, p: 140, c: 380, f: 80 },
  workoutPlan: null,
  dietPlan: null,
  sessions: [],
  activeSessionId: null,
  activeExIndex: 0,
  activeSetIndex: 0,
  ui: { planEditDayId: null, dietEditDayIndex: 0, dietEditMeal: 1 }
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
  toast._tm = setTimeout(() => t.classList.remove("show"), 1400);
}

let state = loadState();

/* ---------- helpers ---------- */
function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

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

/* ---------- default plans ---------- */
function defaultWorkout4Days(){
  return {
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
  return { name:"Routine massa pulita", week:Array.from({length:7},()=>clone(day)) };
}

/* ---------- views ---------- */
function setView(view){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.view===view));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-"+view)?.classList.remove("hidden");
}

document.addEventListener("click",(e)=>{
  const tab=e.target.closest(".tab"); if(tab) setView(tab.dataset.view);
  const jump=e.target.closest("[data-jump]"); if(jump) setView(jump.dataset.jump);
});

/* ---------- workout preview ---------- */
function populateDays(){
  const sel=$("daySelect"); if(!sel||!state.workoutPlan) return;
  sel.innerHTML="";
  for(const d of state.workoutPlan.days){
    const o=document.createElement("option");
    o.value=d.id; o.textContent=d.name; sel.appendChild(o);
  }
  if (!sel.value && state.workoutPlan.days[0]) sel.value = state.workoutPlan.days[0].id;
}

function renderDayPreview(){
  const box=$("dayPreview"), sel=$("daySelect");
  if(!box||!sel||!state.workoutPlan) return;
  const day=state.workoutPlan.days.find(d=>d.id===sel.value); if(!day) return;
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

/* ---------- session ---------- */
function startSession(dayId){
  const day = state.workoutPlan.days.find(d=>d.id===dayId);
  if(!day) return;

  const session={
    id:uid(),
    date:todayISO(),
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

/* ---------- timer ---------- */
let timer={running:false,remaining:0,interval:null};
function timerSet(seconds){
  timer.remaining=Math.max(0,Math.floor(seconds));
  $("timerTime").textContent=fmtMMSS(timer.remaining);
}
function timerStop(){
  timer.running=false;
  clearInterval(timer.interval);
  timer.interval=null;
}
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

/* ---------- session UI ---------- */
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

function renderSingleSet(){
  const s=activeSession(); if(!s) return;
  const it=s.items[state.activeExIndex];
  const idx=state.activeSetIndex;
  const st=it.sets[idx];

  const unitLabel = it.unit==="sec" ? "Secondi" : "Reps";

  $("singleSetBox").innerHTML=`
    <div class="singleCard">
      <div class="singleTop">
        <div class="singleTitle">Serie ${idx+1} di ${it.sets.length}</div>
        <div class="badge">ATTIVA</div>
      </div>

      <div class="singleGrid">
        <label class="field">
          <span>Kg</span>
          <input inputmode="decimal" id="inKg" value="${st.kg}">
        </label>
        <label class="field">
          <span>${unitLabel}</span>
          <input inputmode="numeric" id="inReps" value="${st.reps}">
        </label>
        <label class="field">
          <span>RIR</span>
          <input inputmode="numeric" id="inRir" value="${st.rir}">
        </label>
      </div>

      <div class="muted small">Suggerimento: ${it.target.repMin}-${it.target.repMax} • RIR ${it.target.rir}</div>
    </div>
  `;

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

  const unit = it.unit==="sec" ? "sec" : "reps";
  const t=it.target;
  $("exTarget").textContent=`Target: ${t.sets}x ${t.repMin}-${t.repMax} ${unit} • RIR ${t.rir} • Rec ${t.rest}`;

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
    toast("Inserisci reps/secondi");
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
  } else {
    toast("Ultima serie: passa al prossimo esercizio");
  }
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
  } else {
    toast("Ultimo esercizio");
  }
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

/* buttons session */
$("btnSaveSet")?.addEventListener("click", ()=>{ saveSetAndAutoTimer(); });
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

/* timer buttons */
$("btnTimerStart")?.addEventListener("click", timerStart);
$("btnTimerPause")?.addEventListener("click", ()=>{ timerStop(); toast("Timer in pausa"); });
$("btnTimerSkip")?.addEventListener("click", ()=>{ timerStop(); timerSet(0); toast("Recupero saltato"); });

/* ---------- DIETA (view base) ---------- */
function populateDietDays(){
  const sel=$("dietDaySelect"); if(!sel) return;
  sel.innerHTML="";
  const labels=["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  for(let i=0;i<7;i++){
    const o=document.createElement("option");
    o.value=String(i); o.textContent=labels[i];
    sel.appendChild(o);
  }
}
function renderDietEditor(){
  const box=$("dietEditor"), daySel=$("dietDaySelect"), mealSel=$("mealSelect");
  if(!box||!daySel||!mealSel||!state.dietPlan) return;
  const di=Number(daySel.value), mi=Number(mealSel.value);
  const items=state.dietPlan.week[di].meals[mi]||[];
  box.innerHTML="";
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

/* grocery */
function generateGrocery(){
  if(!state.dietPlan) return null;
  const agg=new Map();
  for(let d=0;d<7;d++){
    for(let m=1;m<=5;m++){
      for(const it of (state.dietPlan.week[d].meals[m]||[])){
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
  if(!list){ toast("Carica prima una dieta"); return; }
  alert("LISTA SPESA SETTIMANALE\n\n"+list.map(x=>`• ${x.food}: ${x.qty} ${x.unit}`).join("\n"));
}

/* ---------- PROGRESS ---------- */
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
    for(const it of s.items){
      for(const st of it.sets){
        const kg=Number(String(st.kg).replace(",","."));
        if(!isFinite(kg)||kg<=0) continue;
        pr.set(it.ex, Math.max(pr.get(it.ex)||0, kg));
      }
    }
  }
  if(!pr.size){ box.innerHTML=`<div class="muted">Inserisci sessioni per PR.</div>`; return; }
  Array.from(pr.entries()).sort((a,b)=>b[1]-a[1]).slice(0,40).forEach(([ex,kg])=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div class="itemTop"><div class="itemTitle">${ex}</div><div class="badge">${kg.toFixed(1)} kg</div></div>`;
    box.appendChild(div);
  });
}

/* ---------- HOME & SETTINGS ---------- */
function homeRefresh(){
  $("homeKcal").textContent=`${state.settings.kcal} kcal`;
  $("homeSessions").textContent=String(state.sessions.length);
  $("homePlanName").textContent=state.workoutPlan?.name||"—";
  const dow=new Date().getDay();
  let today="Riposo";
  if(state.workoutPlan){
    const map={1:"mon",2:"tue",4:"thu",5:"fri"};
    const id=map[dow];
    const d=id?state.workoutPlan.days.find(x=>x.id===id):null;
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

/* ---------- EDITOR SCHEDA ---------- */
function planById(id){
  return state.workoutPlan.days.find(d=>d.id===id) || null;
}

function populatePlanDaySelect(){
  const sel = $("planDaySelect"); if(!sel || !state.workoutPlan) return;
  sel.innerHTML = "";
  state.workoutPlan.days.forEach(d=>{
    const o=document.createElement("option");
    o.value=d.id; o.textContent=d.name;
    sel.appendChild(o);
  });
  if (!state.ui.planEditDayId && state.workoutPlan.days[0]) state.ui.planEditDayId = state.workoutPlan.days[0].id;
  sel.value = state.ui.planEditDayId || (state.workoutPlan.days[0]?.id || "");
}

function renderPlanDaysList(){
  const box = $("planDaysList"); if(!box || !state.workoutPlan) return;
  box.innerHTML = "";
  state.workoutPlan.days.forEach((d,idx)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${d.name}</div>
        <div class="badge">${d.exercises.length} esercizi</div>
      </div>
      <div class="row">
        <button class="iconBtn primary" data-plan-select="${d.id}">Seleziona</button>
        <button class="iconBtn" data-day-up="${d.id}">↑</button>
        <button class="iconBtn" data-day-down="${d.id}">↓</button>
        <button class="iconBtn danger" data-day-del="${d.id}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });
}

function renderPlanExercisesList(){
  const box = $("planExercisesList"); if(!box || !state.workoutPlan) return;
  const dayId = $("planDaySelect")?.value || state.ui.planEditDayId;
  const day = planById(dayId);
  if (!day){ box.innerHTML = `<div class="muted">Seleziona un giorno.</div>`; return; }
  state.ui.planEditDayId = day.id;
  saveState();

  box.innerHTML = "";
  day.exercises.forEach((ex,idx)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${idx+1}. ${ex.ex}</div>
        <div class="badge">${ex.sets}x ${ex.repMin}-${ex.repMax} • RIR ${ex.rir} • ${ex.rest}</div>
      </div>
      <div class="row">
        <button class="iconBtn" data-ex-up="${idx}">↑</button>
        <button class="iconBtn" data-ex-down="${idx}">↓</button>
        <button class="iconBtn danger" data-ex-del="${idx}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });
}

function openPlanEditor(){
  $("planName").value = state.workoutPlan?.name || "";
  $("newDayName").value = "";
  populatePlanDaySelect();
  renderPlanDaysList();
  renderPlanExercisesList();
  setView("planedit");
}

function moveItem(arr, from, to){
  if (to < 0 || to >= arr.length) return;
  const x = arr.splice(from,1)[0];
  arr.splice(to,0,x);
}

document.addEventListener("click",(e)=>{
  // days list actions
  const sel = e.target.closest("[data-plan-select]");
  if (sel){
    state.ui.planEditDayId = sel.dataset.planSelect;
    saveState();
    populatePlanDaySelect();
    renderPlanExercisesList();
    toast("Giorno selezionato");
  }

  const up = e.target.closest("[data-day-up]");
  const dn = e.target.closest("[data-day-down]");
  const del = e.target.closest("[data-day-del]");
  if (up || dn || del){
    const id = (up||dn||del).dataset.dayUp || (up||dn||del).dataset.dayDown || (up||dn||del).dataset.dayDel;
    const i = state.workoutPlan.days.findIndex(d=>d.id===id);
    if (i<0) return;

    if (up) moveItem(state.workoutPlan.days, i, i-1);
    if (dn) moveItem(state.workoutPlan.days, i, i+1);
    if (del){
      if (!confirm("Eliminare il giorno?")) return;
      state.workoutPlan.days.splice(i,1);
      if (state.ui.planEditDayId === id) state.ui.planEditDayId = state.workoutPlan.days[0]?.id || null;
    }
    saveState();
    populatePlanDaySelect();
    renderPlanDaysList();
    renderPlanExercisesList();
    populateDays();
    renderDayPreview();
    homeRefresh();
  }

  // exercise actions
  const exUp = e.target.closest("[data-ex-up]");
  const exDn = e.target.closest("[data-ex-down]");
  const exDel = e.target.closest("[data-ex-del]");
  if (exUp || exDn || exDel){
    const dayId = $("planDaySelect")?.value || state.ui.planEditDayId;
    const day = planById(dayId); if(!day) return;
    const idx = Number((exUp||exDn||exDel).dataset.exUp || (exUp||exDn||exDel).dataset.exDown || (exUp||exDn||exDel).dataset.exDel);
    if (!isFinite(idx)) return;

    if (exUp) moveItem(day.exercises, idx, idx-1);
    if (exDn) moveItem(day.exercises, idx, idx+1);
    if (exDel){
      if (!confirm("Eliminare esercizio?")) return;
      day.exercises.splice(idx,1);
    }
    saveState();
    renderPlanExercisesList();
    populateDays();
    renderDayPreview();
  }
});

$("btnAddDay")?.addEventListener("click",()=>{
  const name = $("newDayName").value.trim();
  if(!name){ toast("Inserisci nome giorno"); return; }
  const id = uid().slice(0,6);
  state.workoutPlan.days.push({ id, name, exercises: [] });
  state.ui.planEditDayId = id;
  saveState();
  $("newDayName").value = "";
  populatePlanDaySelect();
  renderPlanDaysList();
  renderPlanExercisesList();
  populateDays();
  renderDayPreview();
  toast("Giorno aggiunto");
});

$("planDaySelect")?.addEventListener("change",()=>{
  state.ui.planEditDayId = $("planDaySelect").value;
  saveState();
  renderPlanExercisesList();
});

$("btnPlanSaveName")?.addEventListener("click",()=>{
  state.workoutPlan.name = $("planName").value.trim() || "Scheda";
  saveState();
  homeRefresh();
  toast("Nome scheda salvato");
});

$("btnAddExercise")?.addEventListener("click",()=>{
  const dayId = $("planDaySelect").value;
  const day = planById(dayId);
  if(!day){ toast("Seleziona un giorno"); return; }

  const ex = $("exNameIn").value.trim();
  if(!ex){ toast("Inserisci nome esercizio"); return; }

  const sets = Number($("exSetsIn").value || 0);
  const repMin = Number($("exRepMinIn").value || 0);
  const repMax = Number($("exRepMaxIn").value || 0);
  const rir = $("exRirIn").value.trim() || "1-2";
  const rest = $("exRestIn").value.trim() || "90";

  if(!(sets>0 && repMin>0 && repMax>0)){ toast("Controlla serie e reps"); return; }

  day.exercises.push({ ex, sets, repMin, repMax, rir, rest });
  saveState();

  $("exNameIn").value="";
  renderPlanExercisesList();
  populateDays();
  renderDayPreview();
  toast("Esercizio aggiunto");
});

$("btnDuplicateDay")?.addEventListener("click",()=>{
  const dayId = $("planDaySelect").value;
  const day = planById(dayId);
  if(!day){ toast("Seleziona un giorno"); return; }
  const copy = clone(day);
  copy.id = uid().slice(0,6);
  copy.name = day.name + " (copia)";
  state.workoutPlan.days.push(copy);
  state.ui.planEditDayId = copy.id;
  saveState();
  populatePlanDaySelect();
  renderPlanDaysList();
  renderPlanExercisesList();
  populateDays();
  renderDayPreview();
  toast("Giorno duplicato");
});

$("btnPlanReset")?.addEventListener("click",()=>{
  if(!confirm("Reset scheda?")) return;
  state.workoutPlan = defaultWorkout4Days();
  state.ui.planEditDayId = state.workoutPlan.days[0]?.id || null;
  saveState();
  openPlanEditor();
  populateDays();
  renderDayPreview();
  homeRefresh();
  toast("Scheda resettata");
});

$("btnPlanBack")?.addEventListener("click",()=>{
  setView("workout");
});

/* ---------- EDITOR DIETA ---------- */
function populateDietEditDays(){
  const sel = $("dietEditDaySelect"); if(!sel) return;
  sel.innerHTML = "";
  const labels=["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  for(let i=0;i<7;i++){
    const o=document.createElement("option");
    o.value=String(i);
    o.textContent=labels[i];
    sel.appendChild(o);
  }
  sel.value = String(state.ui.dietEditDayIndex || 0);
}

function renderDietFoodsList(){
  const box = $("dietFoodsList");
  if(!box || !state.dietPlan) return;
  const di = Number($("dietEditDaySelect").value);
  const mi = Number($("dietEditMealSelect").value);
  state.ui.dietEditDayIndex = di;
  state.ui.dietEditMeal = mi;
  saveState();

  const items = state.dietPlan.week[di].meals[mi] || [];
  box.innerHTML = "";

  items.forEach((it, idx)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${it.food}</div>
        <div class="badge">${it.qty} ${it.unit}</div>
      </div>
      <div class="row">
        <button class="iconBtn" data-food-up="${idx}">↑</button>
        <button class="iconBtn" data-food-down="${idx}">↓</button>
        <button class="iconBtn danger" data-food-del="${idx}">Elimina</button>
      </div>
    `;
    box.appendChild(div);
  });

  if (!items.length){
    box.innerHTML = `<div class="muted">Nessun alimento in questo pasto. Aggiungine uno sopra.</div>`;
  }
}

document.addEventListener("click",(e)=>{
  const up = e.target.closest("[data-food-up]");
  const dn = e.target.closest("[data-food-down]");
  const del = e.target.closest("[data-food-del]");
  if (!(up||dn||del)) return;

  const di = Number($("dietEditDaySelect").value);
  const mi = Number($("dietEditMealSelect").value);
  const arr = state.dietPlan.week[di].meals[mi] || [];
  const idx = Number((up||dn||del).dataset.foodUp || (up||dn||del).dataset.foodDown || (up||dn||del).dataset.foodDel);

  if (up) moveItem(arr, idx, idx-1);
  if (dn) moveItem(arr, idx, idx+1);
  if (del){
    if(!confirm("Eliminare alimento?")) return;
    arr.splice(idx,1);
  }
  state.dietPlan.week[di].meals[mi] = arr;
  saveState();
  renderDietFoodsList();
  renderDietEditor();
});

function openDietEditor(){
  $("dietName").value = state.dietPlan?.name || "";
  populateDietEditDays();
  $("dietEditMealSelect").value = String(state.ui.dietEditMeal || 1);
  renderDietFoodsList();
  setView("dietedit");
}

$("btnDietSaveName")?.addEventListener("click",()=>{
  state.dietPlan.name = $("dietName").value.trim() || "Dieta";
  saveState();
  toast("Nome dieta salvato");
});

$("dietEditDaySelect")?.addEventListener("change", renderDietFoodsList);
$("dietEditMealSelect")?.addEventListener("change", renderDietFoodsList);

$("btnAddFood")?.addEventListener("click",()=>{
  const di = Number($("dietEditDaySelect").value);
  const mi = Number($("dietEditMealSelect").value);

  const food = $("foodNameIn").value.trim();
  const qty = Number($("foodQtyIn").value || 0);
  const unit = $("foodUnitIn").value;

  if(!food){ toast("Inserisci alimento"); return; }
  if(!(qty>0)){ toast("Quantità non valida"); return; }

  const arr = state.dietPlan.week[di].meals[mi] || [];
  arr.push({ food, qty, unit });
  state.dietPlan.week[di].meals[mi] = arr;
  saveState();

  $("foodNameIn").value="";
  renderDietFoodsList();
  renderDietEditor();
  toast("Alimento aggiunto");
});

$("btnCopyDayToAll")?.addEventListener("click",()=>{
  const di = Number($("dietEditDaySelect").value);
  if(!confirm("Copiare questo giorno su tutti i giorni?")) return;
  const dayCopy = clone(state.dietPlan.week[di]);
  for(let i=0;i<7;i++) state.dietPlan.week[i] = clone(dayCopy);
  saveState();
  renderDietFoodsList();
  renderDietEditor();
  toast("Giorno copiato su tutti");
});

$("btnCopyMealToAllDays")?.addEventListener("click",()=>{
  const di = Number($("dietEditDaySelect").value);
  const mi = Number($("dietEditMealSelect").value);
  if(!confirm("Copiare questo pasto su tutti i giorni?")) return;
  const mealCopy = clone(state.dietPlan.week[di].meals[mi] || []);
  for(let i=0;i<7;i++){
    state.dietPlan.week[i].meals[mi] = clone(mealCopy);
  }
  saveState();
  renderDietFoodsList();
  renderDietEditor();
  toast("Pasto copiato su tutti");
});

$("btnDietReset")?.addEventListener("click",()=>{
  if(!confirm("Reset dieta?")) return;
  state.dietPlan = defaultDietWeek();
  state.ui.dietEditDayIndex = 0;
  state.ui.dietEditMeal = 1;
  saveState();
  openDietEditor();
  renderDietEditor();
  toast("Dieta resettata");
});

$("btnDietBack")?.addEventListener("click",()=>{
  setView("diet");
});

/* ---------- SETTINGS SAVE ---------- */
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

/* ---------- Buttons main ---------- */
$("btnLoadDefault")?.addEventListener("click",()=>{
  state.workoutPlan=defaultWorkout4Days();
  state.ui.planEditDayId = state.workoutPlan.days[0]?.id || null;
  saveState();
  populateDays();
  renderDayPreview();
  homeRefresh();
  toast("Scheda caricata");
});
$("daySelect")?.addEventListener("change", renderDayPreview);

$("btnStartDay")?.addEventListener("click",()=>{
  if(!state.workoutPlan){ toast("Carica la scheda"); return; }
  const id=$("daySelect")?.value; if(!id) return;
  startSession(id);
});
$("btnStartSession")?.addEventListener("click",()=>{
  if(!state.workoutPlan){ toast("Carica la scheda"); return; }
  const dow=new Date().getDay();
  const map={1:"mon",2:"tue",4:"thu",5:"fri"};
  const id=map[dow]||state.workoutPlan.days[0].id;
  startSession(id);
});

$("btnTodayMeals")?.addEventListener("click",()=>{
  setView("diet");
  $("dietDaySelect").value=String((new Date().getDay()+6)%7);
  $("mealSelect").value="1";
  renderDietEditor();
});

$("btnLoadDietDefault")?.addEventListener("click",()=>{
  state.dietPlan=defaultDietWeek();
  saveState();
  populateDietDays();
  renderDietEditor();
  toast("Dieta caricata");
});

$("dietDaySelect")?.addEventListener("change", renderDietEditor);
$("mealSelect")?.addEventListener("change", renderDietEditor);

$("btnGenerateGrocery")?.addEventListener("click", showGrocery);
$("btnGrocery")?.addEventListener("click", showGrocery);

$("btnBackup")?.addEventListener("click",()=>setView("settings"));

/* open editors */
$("btnOpenPlanEditor")?.addEventListener("click", openPlanEditor);
$("btnOpenDietEditor")?.addEventListener("click", openDietEditor);

/* backup */
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

/* ---------- boot ---------- */
function boot(){
  if(!state.workoutPlan) state.workoutPlan=defaultWorkout4Days();
  if(!state.dietPlan) state.dietPlan=defaultDietWeek();
  if(!state.ui) state.ui = clone(DEFAULT.ui);
  if(!state.ui.planEditDayId) state.ui.planEditDayId = state.workoutPlan.days[0]?.id || null;

  saveState();

  populateDays();
  renderDayPreview();
  populateDietDays();
  renderDietEditor();
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
}
boot();