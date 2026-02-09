if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/BET-STATS/sw.js").catch(() => {});
}

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const todayISO = () => new Date().toISOString().slice(0, 10);
const KEY = "fitplanner_v3";

const DEFAULT = {
  settings: { weightKg: 68, mealsPerDay: 5, kcal: 2900, p: 140, c: 380, f: 80 },
  workoutPlan: null,
  dietPlan: null,
  sessions: [],
  activeSessionId: null,
  activeExIndex: 0,
  activeSetIndex: 0
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

/* ---------- rest parsing ---------- */
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
        { ex:"Panca inclinata manubri", sets:3, repMin:8, repMax:10, rir:"1-2", rest:"90" },
        { ex:"Rematore bilanciere (o T-bar)", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
        { ex:"Alzate laterali", sets:3, repMin:12, repMax:20, rir:"0-1", rest:"60" },
        { ex:"Curl manubri inclinato", sets:2, repMin:10, repMax:12, rir:"0-1", rest:"60" },
        { ex:"Pushdown cavo", sets:2, repMin:10, repMax:12, rir:"0-1", rest:"60" }
      ]},
      { id:"tue", name:"Martedì – LOWER 1", exercises:[
        { ex:"Squat", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:30" },
        { ex:"Stacco rumeno (RDL)", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
        { ex:"Leg press", sets:3, repMin:10, repMax:12, rir:"1", rest:"90" },
        { ex:"Leg curl", sets:3, repMin:10, repMax:14, rir:"0-1", rest:"75" },
        { ex:"Calf raise in piedi", sets:4, repMin:8, repMax:12, rir:"0-1", rest:"60" },
        { ex:"Crunch al cavo", sets:3, repMin:10, repMax:15, rir:"1", rest:"60" }
      ]},
      { id:"thu", name:"Giovedì – UPPER 2", exercises:[
        { ex:"Military press", sets:4, repMin:5, repMax:7, rir:"1-2", rest:"2:00" },
        { ex:"Lat machine presa larga", sets:3, repMin:8, repMax:12, rir:"1-2", rest:"90" },
        { ex:"Panca inclinata bilanciere", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
        { ex:"Rematore chest-supported", sets:3, repMin:8, repMax:12, rir:"1", rest:"90" },
        { ex:"Croci ai cavi", sets:2, repMin:12, repMax:15, rir:"0-1", rest:"60" },
        { ex:"Face pull", sets:2, repMin:12, repMax:20, rir:"0-1", rest:"60" },
        { ex:"Curl EZ", sets:3, repMin:8, repMax:12, rir:"0-1", rest:"60" },
        { ex:"French press", sets:3, repMin:8, repMax:12, rir:"0-1", rest:"75" }
      ]},
      { id:"fri", name:"Venerdì – LOWER 2", exercises:[
        { ex:"Stacco tecnico", sets:3, repMin:3, repMax:5, rir:"2", rest:"2:30" },
        { ex:"Hip thrust", sets:4, repMin:6, repMax:10, rir:"1-2", rest:"2:00" },
        { ex:"Front squat", sets:3, repMin:6, repMax:9, rir:"1-2", rest:"2:00" },
        { ex:"Bulgarian split squat", sets:3, repMin:8, repMax:10, rir:"1", rest:"90" },
        { ex:"Leg curl seduto", sets:2, repMin:12, repMax:15, rir:"0-1", rest:"75" },
        { ex:"Calf raise seduto", sets:4, repMin:12, repMax:20, rir:"0-1", rest:"60" },
        { ex:"Plank zavorrato", sets:3, repMin:30, repMax:45, rir:"-", rest:"60", unit:"sec" }
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
  return { name:"Routine massa pulita", week:Array.from({length:7},()=>structuredClone(day)) };
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

  // bind input
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

/* ---------- diet ---------- */
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

/* progress */
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

/* home & settings */
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

/* buttons */
$("btnLoadDefault")?.addEventListener("click",()=>{
  state.workoutPlan=defaultWorkout4Days();
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

/* placeholders editor (per ora) */
$("btnOpenPlanEditor")?.addEventListener("click",()=>{
  alert("Editor scheda: lo aggiungiamo adesso (crea/modifica giorni+esercizi).");
});
$("btnOpenDietEditor")?.addEventListener("click",()=>{
  alert("Editor dieta: lo aggiungiamo adesso (pasti+alimenti, quantità).");
});

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

/* boot */
function boot(){
  if(!state.workoutPlan) state.workoutPlan=defaultWorkout4Days();
  if(!state.dietPlan) state.dietPlan=defaultDietWeek();
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