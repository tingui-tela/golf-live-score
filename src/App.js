import { useState, useEffect, useCallback, useRef } from "react";

const ALL_PLAYERS = ["Metra","Garza","Herny","Tingui","Gouk","Grassu","Nano","Marto"];
const HOLES = 18;
const SCORES_KEY  = "golf_scores_v3";
const SETUP_KEY   = "golf_setup_v13";
const COURSES_KEY = "golf_courses_v2";
const BONUS_KEY   = "golf_bonus_v1";

// ─── Google Sheets sync ──────────────────────────────────────────────
const GAS_URL = "https://script.google.com/macros/s/AKfycby4b0aSHVbXSs8S5SG_AP6KQd4idqTXUZKrjeMJTuYhdtnA9dlkBeEqY9pFXcNDkxyM/exec";

const gasRead = async () => {
  try {
    const r = await fetch(GAS_URL, { redirect: "follow" });
    return await r.json();
  } catch { return {}; }
};

const gasWrite = async (key, value) => {
  try {
    await fetch(GAS_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ key, value }),
    });
  } catch {}
};

// ─── Default courses ─────────────────────────────────────────────────
const DEFAULT_COURSES = [
  {
    id: "san_andres",
    name: "San Andrés",
    par:     [4,4,4,3,4,5,3,5,4,5,3,5,4,4,4,3,4,4],
    hcpHole: [3,7,11,18,9,15,13,1,5,12,18,2,8,16,4,14,6,10],
  },
  {
    id: "lomas_athletic",
    name: "Lomas Athletic",
    par:     [4,3,4,4,3,5,4,4,5,4,4,4,3,5,5,4,3,4],
    hcpHole: [11,17,1,9,15,3,7,13,5,14,2,10,16,12,4,8,18,6],
  },
  {
    id: "san-eliseo",
    name: "San Eliseo Golf",
    par:     [4,5,4,3,4,4,4,3,5,4,4,3,5,4,4,4,3,5],
    hcpHole: [7,5,1,15,9,3,11,17,13,8,2,16,6,14,10,4,18,12],
  }
];

// ─── Team config ─────────────────────────────────────────────────────
const TEAM_DEFS = [
  { id:"A", label:"Equipo A", color:"#60a5fa", bg:"#060f1a", border:"#1e3a5f", badgeBg:"#1e3a8a", badgeColor:"#93c5fd" },
  { id:"B", label:"Equipo B", color:"#f87171", bg:"#1a0606", border:"#5f1e1e", badgeBg:"#7f1d1d", badgeColor:"#fca5a5" },
  { id:"C", label:"Equipo C", color:"#4ade80", bg:"#061a0a", border:"#1a5f1e", badgeBg:"#14532d", badgeColor:"#86efac" },
  { id:"D", label:"Equipo D", color:"#fbbf24", bg:"#1a1406", border:"#5f4a1e", badgeBg:"#78350f", badgeColor:"#fde68a" },
];
const makeEmptyTeams = (n) => Object.fromEntries(TEAM_DEFS.slice(0,n).map(t=>[t.id,[]]));

// ─── Rotation ────────────────────────────────────────────────────────
const buildRotation = (teams, activeTeamDefs, selectedPlayers) => {
  const result = {};
  const sizes = activeTeamDefs.map(t=>(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p)).length);
  const minSize = Math.min(...sizes.filter(s=>s>0));
  for (const t of activeTeamDefs) {
    const players = (teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));
    const n = players.length;
    const byeCount = Math.max(0, n - minSize);
    if (byeCount === 0) {
      result[t.id] = Array.from({length:HOLES}, ()=>players);
    } else {
      result[t.id] = Array.from({length:HOLES}, (_,hi)=>{
        const sitting = new Set();
        for (let b=0; b<byeCount; b++) {
          let idx = (hi*byeCount+b)%n, att=0;
          while (sitting.has(idx)&&att<n){idx=(idx+1)%n;att++;}
          sitting.add(idx);
        }
        return players.filter((_,i)=>!sitting.has(i));
      });
    }
  }
  return result;
};
const activePlayers = (rotation, teamId, hole) => rotation[teamId]?.[hole-1]||[];
const playerHolesInRotation = (rotation, teamId, p) => (rotation[teamId]||[]).filter(a=>a.includes(p)).length;

// ─── Golf helpers ────────────────────────────────────────────────────
const strokesOnHole = (hcp, holeHcp) => {
  if (!hcp||hcp<=0) return 0;
  let s=Math.floor(hcp/18);
  if (holeHcp<=(hcp%18)) s++;
  return s;
};
const sfPoints = (score, par, hcp, holeHcp) => {
  if (!score||score<=0) return null;
  const d = score-(par+strokesOnHole(hcp,holeHcp));
  if (d<=-3) return 5; if (d===-2) return 4; if (d===-1) return 3;
  if (d===0) return 2;  if (d===1) return 1; return 0;
};
const netScore = (score, hcp, holeHcp) => score>0 ? score-strokesOnHole(hcp,holeHcp) : null;
const sfLabel = (pts) => {
  const map={5:{label:"Albatros",color:"#a855f7"},4:{label:"Aguila",color:"#FFD700"},3:{label:"Birdie",color:"#ff6b35"},2:{label:"Par neto",color:"#4ade80"},1:{label:"Bogey",color:"#94a3b8"},0:{label:"0 pts",color:"#4b5563"}};
  return pts!==null ? map[pts]||null : null;
};
const scoreColor = (score, par) => {
  if (!score) return "#374151";
  const d=score-par;
  if (d<=-2) return "#FFD700"; if (d===-1) return "#ff6b35"; if (d===0) return "#4ade80";
  if (d===1) return "#94a3b8"; if (d===2) return "#f87171"; return "#ef4444";
};
const medal=[0,"🥇","🥈","🥉"];
const fvp=(n)=>n===0?"E":n>0?`+${n}`:`${n}`;
const vpc=(n)=>n<0?"#FFD700":n===0?"#4ade80":n<=2?"#94a3b8":"#f87171";
const sfc=(p)=>p>=36?"#FFD700":p>=30?"#4ade80":p>=20?"#94a3b8":"#6b7280";

// ─── Laguñada ────────────────────────────────────────────────────────
const lagHoleScore = (ap, hole, scores, handicaps, variant, HCP_HOLE) => {
  const nets = ap.map(p=>{
    const s=scores[p]?.[hole]; const hcp=parseInt(handicaps[p])||0;
    const n=netScore(s,hcp,HCP_HOLE[hole-1]); return n!==null?n:null;
  }).filter(n=>n!==null).sort((a,b)=>a-b);
  if (!nets.length) return null;
  return variant==="1ball" ? nets[0] : nets.slice(0,2).reduce((a,b)=>a+b,0);
};
const holePar = (hole, variant, PAR) => variant==="1ball"?PAR[hole-1]:PAR[hole-1]*2;
const calcTeamScore = (rotation, teamId, scores, handicaps, variant, PAR, HCP_HOLE) => {
  let total=0,played=0,parAcc=0;
  for (let h=1;h<=HOLES;h++) {
    const ap=activePlayers(rotation,teamId,h);
    const v=lagHoleScore(ap,h,scores,handicaps,variant,HCP_HOLE);
    if (v!==null){total+=v;played++;parAcc+=holePar(h,variant,PAR);}
  }
  return {total,played,parAcc,diff:total-parAcc};
};

// ─── Course Editor ───────────────────────────────────────────────────
function CourseEditor({course, onSave, onCancel}) {
  const [name,setName]=useState(course?.name||"");
  const [par,setPar]=useState(course?.par||Array(18).fill(4));
  const [hcp,setHcp]=useState(course?.hcpHole||Array.from({length:18},(_,i)=>i+1));
  const [hcpRaw,setHcpRaw]=useState((course?.hcpHole||Array.from({length:18},(_,i)=>i+1)).map(String));
  const [scanning,setScanning]=useState(false);
  const [scanMsg,setScanMsg]=useState("");
  const fileRef=useRef();
  const totalPar=par.reduce((a,b)=>a+b,0);
  const valid=name.trim().length>0&&par.every(p=>p>=3&&p<=6)&&hcp.every(h=>h>=1&&h<=18)&&new Set(hcp).size===18;

  const handleHcpChange=(i,val)=>{
    const newRaw=[...hcpRaw]; newRaw[i]=val; setHcpRaw(newRaw);
    const newHcp=[...hcp];
    const parsed=parseInt(val);
    newHcp[i]=isNaN(parsed)?hcp[i]:parsed;
    setHcp(newHcp);
  };

  const handleHcpBlur=(i)=>{
    const newRaw=[...hcpRaw];
    const parsed=parseInt(hcpRaw[i]);
    if(isNaN(parsed)||parsed<1||parsed>18){
      newRaw[i]=String(hcp[i]);
    } else {
      newRaw[i]=String(parsed);
    }
    setHcpRaw(newRaw);
  };

  const handlePhoto=async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    setScanning(true); setScanMsg("Leyendo la tarjeta...");
    try {
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
      const resp=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:`Esta es la tarjeta de score de un campo de golf de 18 hoyos. Extraé el par de cada hoyo y el handicap (HCP) de cada hoyo en orden del hoyo 1 al 18. Respondé SOLO con JSON sin texto ni backticks: {"name":"NOMBRE","par":[4,4,3,...],"hcpHole":[1,5,3,...]}`}]},{role:"assistant",content:[{type:"text",text:"{"}]}]})});
      const data=await resp.json();
      const text="{"+data.content?.map(c=>c.text||"").join("").replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(text);
      if (parsed.par?.length===18&&parsed.hcpHole?.length===18){
        setPar(parsed.par.map(Number));
        setHcp(parsed.hcpHole.map(Number));
        setHcpRaw(parsed.hcpHole.map(String));
        if(parsed.name)setName(parsed.name);
        setScanMsg("✅ Tarjeta leída correctamente");
      } else setScanMsg("No pude leer todos los datos. Completá manualmente.");
    } catch {setScanMsg("Error al leer la imagen. Completá manualmente.");}
    setScanning(false);
  };

  return (
    <div style={{background:"#0a0f0a",minHeight:"100vh",fontFamily:"Georgia,serif",color:"#e2e8f0"}}>
      <div style={{background:"linear-gradient(135deg,#052e16,#0a2010)",borderBottom:"1px solid #166534",padding:"14px 16px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10}}>
        <button onClick={onCancel} style={{background:"transparent",border:"none",color:"#4ade80",cursor:"pointer",fontSize:20}}>←</button>
        <div style={{flex:1,fontSize:16,fontWeight:"bold",color:"#4ade80"}}>{course?.id?"Editar cancha":"Nueva cancha"}</div>
        <button onClick={()=>valid&&onSave({id:course?.id||("course_"+Date.now()),name:name.trim(),par,hcpHole:hcp})} disabled={!valid} style={{padding:"8px 16px",borderRadius:8,border:"none",background:valid?"#16a34a":"#1a2e1a",color:valid?"#fff":"#4b5563",cursor:valid?"pointer":"not-allowed",fontSize:13,fontWeight:"bold"}}>Guardar</button>
      </div>
      <div style={{padding:16}}>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Nombre de la cancha</div>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej: Club de Golf San Andrés" style={{width:"100%",boxSizing:"border-box",background:"#0f1a0f",border:"1px solid #166534",borderRadius:8,color:"#e2e8f0",padding:"10px 12px",fontSize:15,outline:"none"}}/>
        </div>
        <div style={{marginBottom:16,background:"#0a1a3a",border:"1px solid #1e3a5f",borderRadius:10,padding:14}}>
          <div style={{fontSize:13,color:"#60a5fa",fontWeight:"bold",marginBottom:6}}>📷 Importar desde foto de tarjeta</div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current.click()} disabled={scanning} style={{width:"100%",padding:"11px",borderRadius:8,border:"none",background:scanning?"#1e3a5f":"#1d4ed8",color:"#fff",cursor:scanning?"not-allowed":"pointer",fontSize:14,fontWeight:"bold"}}>{scanning?"Analizando...":"📸 Sacar / Subir foto de tarjeta"}</button>
          {scanMsg&&<div style={{marginTop:8,fontSize:12,color:scanMsg.startsWith("✅")?"#4ade80":"#fbbf24",textAlign:"center"}}>{scanMsg}</div>}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1}}>Par y HCP por hoyo</div>
          <div style={{fontSize:13,fontWeight:"bold",color:"#4ade80"}}>Par total: {totalPar}</div>
        </div>
        {new Set(hcp).size!==18&&<div style={{marginBottom:10,padding:"8px 12px",background:"#1a0a00",border:"1px solid #92400e",borderRadius:8,fontSize:12,color:"#fbbf24"}}>⚠️ Los HCP deben ser del 1 al 18 sin repetir</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          {Array.from({length:18},(_,i)=>i).map(i=>(
            <div key={i} style={{background:"#0f1a0f",border:"1px solid #1a2e1a",borderRadius:10,padding:"10px 8px"}}>
              <div style={{fontSize:11,color:"#6b7280",textAlign:"center",marginBottom:6,fontWeight:"bold"}}>Hoyo {i+1}</div>
              <div style={{display:"flex",gap:6}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:"#6b7280",textAlign:"center",marginBottom:3}}>Par</div>
                  <select value={par[i]} onChange={e=>{const n=[...par];n[i]=parseInt(e.target.value);setPar(n);}} style={{width:"100%",background:"#0a2010",border:"1px solid #166534",borderRadius:6,color:"#4ade80",fontSize:15,fontWeight:"bold",padding:"5px 0",textAlign:"center",outline:"none"}}>
                    {[3,4,5,6].map(v=><option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:"#6b7280",textAlign:"center",marginBottom:3}}>HCP</div>
                  <input
                    type="number" min="1" max="18"
                    value={hcpRaw[i]}
                    onChange={e=>handleHcpChange(i,e.target.value)}
                    onBlur={()=>handleHcpBlur(i)}
                    style={{width:"100%",boxSizing:"border-box",background:"#0a1a3a",border:`1px solid ${hcp.filter((v,j)=>v===hcp[i]&&j!==i).length>0?"#dc2626":"#1e3a5f"}`,borderRadius:6,color:"#93c5fd",fontSize:15,fontWeight:"bold",padding:"5px 4px",textAlign:"center",outline:"none"}}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
export default function GolfScorecard() {
  const [scores,s_scores]         = useState({});
  const [activePlayer,s_ap]       = useState(null);
  const [activeHole,s_ah]         = useState(null);
  const [inputVal,s_iv]           = useState("");
  const [view,s_view]             = useState("setup");
  const [myPlayer,s_myPlayer]     = useState(null);
  const [lastUpdate,s_lu]         = useState(null);
  const [loading,s_loading]       = useState(true);
  const [syncing,s_syncing]       = useState(false);
  const [selectedPlayers,s_sel]   = useState([]);
  const [handicaps,s_hcaps]       = useState({});
  const [handicapsMedal,s_hcapsM]  = useState({});
  const [playerList,s_plist]      = useState(ALL_PLAYERS);
  const [newPlayerName,s_npn]     = useState("");
  const [showAdd,s_showAdd]       = useState(false);
  const [gameMode,s_mode]         = useState("stableford");
  const [showResult,s_showResult] = useState(false);
  const [lagunadaVariant,s_lv]    = useState("1ball");
  const [numTeams,s_numTeams]     = useState(2);
  const [teams,s_teams]           = useState(makeEmptyTeams(2));
  const [setupTab,s_setupTab]     = useState("players");
  const [showRotation,s_showRot]  = useState(false);
  const [courses,s_courses]       = useState(DEFAULT_COURSES);
  const [activeCourseId,s_acid]   = useState("san_andres");
  const [editingCourse,s_editing] = useState(null);
  // ── NUEVO: bonus por equipo ───────────────────────────────────────
  const [teamBonus,s_teamBonus]   = useState({});

  const activeCourse = courses.find(c=>c.id===activeCourseId)||courses[0];
  const PAR      = activeCourse.par;
  const HCP_HOLE = activeCourse.hcpHole;
  const TOTAL_PAR= PAR.reduce((a,b)=>a+b,0);

  const activeTeamDefs = TEAM_DEFS.slice(0,numTeams);
  const rotation = buildRotation(teams,activeTeamDefs,selectedPlayers);
  const teamSizes = activeTeamDefs.map(t=>(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p)).length);
  const hasUnequalTeams = teamSizes.some(s=>s>0)&&new Set(teamSizes.filter(s=>s>0)).size>1;
  const minTeamSize = teamSizes.filter(s=>s>0).length>0?Math.min(...teamSizes.filter(s=>s>0)):0;

  // ── Save setup → local + Google Sheets ────────────────────────────
  const saveSetup = async (sel,hcaps,hcapsM,plist,mode,lv,nt,tm,cid) => {
    const data = {selectedPlayers:sel,handicaps:hcaps,handicapsMedal:hcapsM,playerList:plist,gameMode:mode,lagunadaVariant:lv,numTeams:nt,teams:tm,activeCourseId:cid};
    try { localStorage.setItem(SETUP_KEY,JSON.stringify(data)); } catch(e) {}
    // Sync to GAS (no await para no bloquear UI)
    lastWriteRef.current = Date.now();
    gasWrite(SETUP_KEY, JSON.stringify(data));
  };

  // ── Save courses → local + Google Sheets ──────────────────────────
  const saveCourses = async (c) => {
    try { localStorage.setItem(COURSES_KEY,JSON.stringify(c)); } catch(e) {}
    gasWrite(COURSES_KEY, JSON.stringify(c));
  };

  // ── Save scores → Google Sheets ────────────────────────────────────
  const saveScores = async (ns) => {
    const val = JSON.stringify(ns);
    try { localStorage.setItem(SCORES_KEY,val); } catch(e) {}
    lastWriteRef.current = Date.now();
    s_syncing(true);
    await gasWrite(SCORES_KEY, val);
    s_syncing(false);
    s_lu(new Date().toLocaleTimeString("es-AR"));
  };

  // ── Save bonus → Google Sheets ─────────────────────────────────────
  const saveBonus = async (nb) => {
    s_teamBonus(nb);
    gasWrite(BONUS_KEY, JSON.stringify(nb));
    try { localStorage.setItem(BONUS_KEY, JSON.stringify(nb)); } catch(e) {}
  };

  // ── Load: todo desde Google Sheets (setup + courses + scores + bonus)
  const loadData = useCallback(async () => {
    s_syncing(true);
    try {
      const all = await gasRead();

      // Courses
      const coursesRaw = all[COURSES_KEY] || localStorage.getItem(COURSES_KEY);
      if (coursesRaw) {
        try {
          const loaded = JSON.parse(typeof coursesRaw === "string" ? coursesRaw : coursesRaw);
          const merged = [...DEFAULT_COURSES];
          for (const c of loaded) {
            if (!merged.find(x=>x.id===c.id)) merged.push(c);
            else { const idx=merged.findIndex(x=>x.id===c.id); if(idx>=0) merged[idx]=c; }
          }
          s_courses(merged);
        } catch {}
      }

      // Setup — preferir GAS sobre localStorage
      const setupRaw = all[SETUP_KEY] || localStorage.getItem(SETUP_KEY);
      if (setupRaw) {
        try {
          const d = JSON.parse(typeof setupRaw === "string" ? setupRaw : setupRaw);
          s_sel(d.selectedPlayers||[]);
          s_hcaps(d.handicaps||{});
          s_hcapsM(d.handicapsMedal||{});
          s_plist(d.playerList||ALL_PLAYERS);
          s_mode(d.gameMode||"stableford");
          s_lv(d.lagunadaVariant||"1ball");
          const nt=d.numTeams||2;
          s_numTeams(nt);
          s_teams(d.teams||makeEmptyTeams(nt));
          if (d.activeCourseId) s_acid(d.activeCourseId);
          if (d.selectedPlayers?.length>0) s_view("grid");
        } catch {}
      }

      // Scores
      if (all[SCORES_KEY]) {
        try { s_scores(JSON.parse(all[SCORES_KEY])); } catch {}
      }

      // Bonus
      const bonusRaw = all[BONUS_KEY] || localStorage.getItem(BONUS_KEY);
      if (bonusRaw) {
        try { s_teamBonus(JSON.parse(typeof bonusRaw === "string" ? bonusRaw : bonusRaw)); } catch {}
      }

    } catch {}
    s_syncing(false);
    s_loading(false);
  },[]);

  // ── Ref para bloquear el poll 15s después de un write local ────────
  const lastWriteRef = useRef(0);

  // ── Poll Google Sheets every 8 seconds ────────────────────────────
  useEffect(()=>{
    loadData();
    const iv = setInterval(async()=>{
      // Si hace menos de 15s que este dispositivo escribió, no pisamos
      if (Date.now() - lastWriteRef.current < 15000) return;
      try {
        const all = await gasRead();
        if (all[SCORES_KEY]) { try { s_scores(JSON.parse(all[SCORES_KEY])); } catch {} }
        if (all[SETUP_KEY]) {
          try {
            const d=JSON.parse(all[SETUP_KEY]);
            s_sel(d.selectedPlayers||[]);
            s_hcaps(d.handicaps||{});
            s_hcapsM(d.handicapsMedal||{});
            s_plist(d.playerList||ALL_PLAYERS);
            s_mode(d.gameMode||"stableford");
            s_lv(d.lagunadaVariant||"1ball");
            const nt=d.numTeams||2; s_numTeams(nt);
            s_teams(d.teams||makeEmptyTeams(nt));
            if(d.activeCourseId) s_acid(d.activeCourseId);
          } catch {}
        }
        if (all[COURSES_KEY]) {
          try {
            const loaded=JSON.parse(all[COURSES_KEY]);
            const merged=[...DEFAULT_COURSES];
            for(const c of loaded){if(!merged.find(x=>x.id===c.id))merged.push(c);else{const idx=merged.findIndex(x=>x.id===c.id);if(idx>=0)merged[idx]=c;}}
            s_courses(merged);
          } catch {}
        }
        if (all[BONUS_KEY]) { try { s_teamBonus(JSON.parse(all[BONUS_KEY])); } catch {} }
        s_lu(new Date().toLocaleTimeString("es-AR"));
      } catch {}
    }, 8000);
    return ()=>clearInterval(iv);
  },[loadData]);

  const togglePlayer=(p)=>{const n=selectedPlayers.includes(p)?selectedPlayers.filter(x=>x!==p):[...selectedPlayers,p];s_sel(n);saveSetup(n,handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,teams,activeCourseId);};
  const setHandicap=(p,v)=>{const n={...handicaps,[p]:v};s_hcaps(n);saveSetup(selectedPlayers,n,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,teams,activeCourseId);};
  const setHandicapMedal=(p,v)=>{const n={...handicapsMedal,[p]:v};s_hcapsM(n);saveSetup(selectedPlayers,handicaps,n,playerList,gameMode,lagunadaVariant,numTeams,teams,activeCourseId);};
  const setMode=(m)=>{s_mode(m);saveSetup(selectedPlayers,handicaps,handicapsMedal,playerList,m,lagunadaVariant,numTeams,teams,activeCourseId);};
  const setLV=(lv)=>{s_lv(lv);saveSetup(selectedPlayers,handicaps,handicapsMedal,playerList,gameMode,lv,numTeams,teams,activeCourseId);};
  const setCourse=(id)=>{s_acid(id);saveSetup(selectedPlayers,handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,teams,id);};
  const changeNumTeams=(nt)=>{const validIds=TEAM_DEFS.slice(0,nt).map(t=>t.id);const newTeams=Object.fromEntries(validIds.map(id=>[id,teams[id]||[]]));s_numTeams(nt);s_teams(newTeams);saveSetup(selectedPlayers,handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,nt,newTeams,activeCourseId);};
  const assignTeam=(player,teamId)=>{const alreadyIn=teams[teamId]?.includes(player);const newTeams=Object.fromEntries(Object.entries(teams).map(([id,pls])=>[id,pls.filter(p=>p!==player)]));if(!alreadyIn)newTeams[teamId]=[...(newTeams[teamId]||[]),player];s_teams(newTeams);saveSetup(selectedPlayers,handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,newTeams,activeCourseId);};
  const playerTeam=(player)=>activeTeamDefs.find(t=>(teams[t.id]||[]).includes(player));

  // saveCourse ahora sincroniza también a GAS
  const saveCourse=(c)=>{
    const updated=courses.find(x=>x.id===c.id)?courses.map(x=>x.id===c.id?c:x):[...courses,c];
    s_courses(updated);s_acid(c.id);
    saveCourses(updated);
    saveSetup(selectedPlayers,handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,teams,c.id);
    s_editing(null);
  };
  const deleteCourse=(id)=>{if(DEFAULT_COURSES.find(c=>c.id===id))return;const updated=courses.filter(c=>c.id!==id);s_courses(updated);if(activeCourseId===id){s_acid("san_andres");saveSetup(selectedPlayers,handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,teams,"san_andres");}saveCourses(updated);};

  const addNewPlayer=()=>{const name=newPlayerName.trim();if(!name||playerList.includes(name))return;const nl=[...playerList,name],ns=[...selectedPlayers,name];s_plist(nl);s_sel(ns);s_npn("");s_showAdd(false);saveSetup(ns,handicaps,handicapsMedal,nl,gameMode,lagunadaVariant,numTeams,teams,activeCourseId);};

  const [showResetConfirm, s_showResetConfirm] = useState(false);

  const nuevaRonda = async () => {
    s_scores({});
    s_syncing(true);
    await gasWrite(SCORES_KEY, JSON.stringify({}));
    s_syncing(false);
    s_sel([]);
    s_teams(makeEmptyTeams(numTeams));
    s_teamBonus({});
    gasWrite(BONUS_KEY, JSON.stringify({}));
    try { localStorage.setItem(SETUP_KEY, JSON.stringify({selectedPlayers:[],handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,teams:makeEmptyTeams(numTeams),activeCourseId})); } catch(e) {}
    gasWrite(SETUP_KEY, JSON.stringify({selectedPlayers:[],handicaps,handicapsMedal,playerList,gameMode,lagunadaVariant,numTeams,teams:makeEmptyTeams(numTeams),activeCourseId}));
    s_view("setup");
    s_setupTab("players");
    s_showResetConfirm(false);
    s_lu(null);
  };

  const handleCell=(player,hole)=>{s_ap(player);s_ah(hole);s_iv(scores[player]?.[hole]||"");};
  const commitScore=async()=>{
    if(!activePlayer||!activeHole)return;
    const val=parseInt(inputVal);
    const ns={...scores};
    if(!ns[activePlayer])ns[activePlayer]={};
    if(!isNaN(val)&&val>0)ns[activePlayer][activeHole]=val;else delete ns[activePlayer][activeHole];
    s_scores(ns);await saveScores(ns);s_ap(null);s_ah(null);s_iv("");
  };

  const playerTotal=(p)=>Object.values(scores[p]||{}).reduce((a,b)=>a+b,0);
  const holesPlayed=(p)=>Object.keys(scores[p]||{}).length;
  const playerSF=(p)=>{const hcp=parseInt(handicaps[p])||0;const s=scores[p]||{};let pts=0;for(let h=1;h<=HOLES;h++)if(s[h])pts+=sfPoints(s[h],PAR[h-1],hcp,HCP_HOLE[h-1])||0;return pts;};
  const playerVsPar=(p)=>{const s=scores[p]||{};let t=0,pp=0;for(let h=1;h<=HOLES;h++)if(s[h]){t+=s[h];pp+=PAR[h-1];}return t-pp;};
  const playerNet=(p)=>playerVsPar(p)-(parseInt(handicapsMedal[p])||0);

  const PLAYERS=selectedPlayers;
  const allDone=PLAYERS.length>0&&PLAYERS.every(p=>holesPlayed(p)===18);
  const leaderboard=[...PLAYERS].filter(p=>holesPlayed(p)>0).sort((a,b)=>gameMode==="medal"?playerNet(a)-playerNet(b):playerSF(b)-playerSF(a));
  const finalBoard=[...PLAYERS].filter(p=>holesPlayed(p)===18).sort((a,b)=>gameMode==="medal"?playerNet(a)-playerNet(b):playerSF(b)-playerSF(a));

  const hasTeams=activeTeamDefs.every(t=>(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p)).length>0);
  const teamScores=Object.fromEntries(activeTeamDefs.map(t=>[t.id,calcTeamScore(rotation,t.id,scores,handicaps,lagunadaVariant,PAR,HCP_HOLE)]));
  const rankedTeams=[...activeTeamDefs].sort((a,b)=>{
    const sa=teamScores[a.id].diff-(parseInt(teamBonus[a.id])||0);
    const sb=teamScores[b.id].diff-(parseInt(teamBonus[b.id])||0);
    return sa-sb;
  });

  // Score final con bonus incluido
  const teamFinalDiff=(teamId)=>{
    const st=teamScores[teamId];
    const bonus=parseInt(teamBonus[teamId])||0;
    return st.diff-bonus;
  };

  // ── Print helpers ──────────────────────────────────────────────────
  const printRotation=()=>{
    const today=new Date().toLocaleDateString("es-AR",{day:"2-digit",month:"long",year:"numeric"});
    const vLabel=lagunadaVariant==="1ball"?"1 Pelota":"2 Pelotas";
    const teamSections=activeTeamDefs.map(t=>{
      const players=(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));
      const n=players.length; const byePerHole=Math.max(0,n-minTeamSize);
      if(byePerHole===0)return`<div style="margin-bottom:14px"><h3 style="color:#166534;margin:0 0 4px">${t.label} — juegan todos los hoyos</h3><p style="margin:0">${players.join(", ")}</p></div>`;
      const countRows=players.map(p=>`<span style="display:inline-block;margin:2px 4px;padding:2px 8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;font-size:11px"><b>${p}</b>: ${playerHolesInRotation(rotation,t.id,p)} hoyos</span>`).join("");
      const rows=Array.from({length:HOLES},(_,hi)=>hi+1).map(h=>{const active=activePlayers(rotation,t.id,h);const sitting=players.filter(p=>!active.includes(p));return`<tr style="background:${h%2===0?"#f9fafb":"#fff"}"><td style="padding:4px 8px;text-align:center;font-weight:bold;color:#166534">${h}</td><td style="padding:4px 8px;font-size:11px;color:#6b7280">P${PAR[h-1]}·HCP${HCP_HOLE[h-1]}</td><td style="padding:4px 8px">${active.join(", ")}</td><td style="padding:4px 8px;color:#dc2626;font-weight:bold">${sitting.join(", ")||"—"}</td></tr>`;}).join("");
      return`<div style="margin-bottom:18px"><h3 style="color:#166534;margin:0 0 4px">${t.label} — ${n} jugadores · descansa ${byePerHole}/hoyo</h3><div style="margin-bottom:6px">${countRows}</div><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="background:#f0fdf4"><th style="padding:4px 8px">H</th><th>Par/HCP</th><th style="text-align:left">Juegan</th><th style="text-align:left;color:#dc2626">Descansa</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join("");
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rotacion</title><style>body{font-family:Georgia,serif;padding:18px;color:#111}h1{color:#166534;margin:0}@media print{body{padding:8px}}</style></head><body><h1>Lagunada ${vLabel} · ${activeCourse.name}</h1><p style="color:#6b7280;margin:4px 0 14px">${today} · ${numTeams} equipos</p>${teamSections}<div style="margin-top:14px;font-size:10px;color:#9ca3af;text-align:center">Golf Live Score</div></body></html>`;
    const win=window.open("","_blank");win.document.write(html);win.document.close();setTimeout(()=>win.print(),600);
  };

  const printResult=()=>{
    const today=new Date().toLocaleDateString("es-AR",{day:"2-digit",month:"long",year:"numeric"});
    const modeLabel=gameMode==="medal"?"Medal":"Stableford";
    const indRows=finalBoard.map((p,i)=>{const hcp=parseInt(handicaps[p])||0,sf=playerSF(p),net=playerNet(p),tm=playerTeam(p);const pos=i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;const res=gameMode==="medal"?`<td style="text-align:center;font-weight:bold">${playerTotal(p)} (${fvp(net)} neto)</td>`:`<td style="text-align:center;font-weight:bold;color:#15803d">${sf} pts</td>`;return`<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:7px;text-align:center">${pos}</td><td style="padding:7px;font-weight:bold">${p}${tm?` <span style="font-size:10px;padding:1px 5px;background:#dbeafe;border-radius:3px">${tm.label}</span>`:""}</td><td style="padding:7px;text-align:center;color:#6b7280">${gameMode==="medal"?(parseInt(handicapsMedal[p])||"-"):(hcp||"-")}</td>${res}</tr>`;}).join("");
    let lagSection="";
    if(hasTeams){const vLabel=lagunadaVariant==="1ball"?"1 Pelota":"2 Pelotas";const tRows=rankedTeams.map((t,i)=>{const fd=teamFinalDiff(t.id);const bonus=parseInt(teamBonus[t.id])||0;const players=(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));const pos=i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;return`<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:7px;text-align:center">${pos}</td><td style="padding:7px;font-weight:bold">${t.label}</td><td style="padding:7px;font-size:12px">${players.join(", ")}</td><td style="padding:7px;text-align:center;font-weight:bold;color:${fd<0?"#15803d":fd>0?"#dc2626":"#374151"}">${teamScores[t.id].played>0?fvp(fd):"—"}${bonus>0?` (+${bonus} bonus)`:""}</td></tr>`;}).join("");lagSection=`<h2 style="font-size:14px;color:#1e40af;margin:18px 0 6px">Lagunada ${vLabel}</h2><table style="margin-bottom:14px"><thead><tr><th>Pos.</th><th style="text-align:left">Equipo</th><th style="text-align:left">Jugadores</th><th>Neto vs Par</th></tr></thead><tbody>${tRows}</tbody></table>`;}
    const holeRows=finalBoard.map(p=>{const hcp=parseInt(handicaps[p])||0;const cells=Array.from({length:HOLES},(_,i)=>i+1).map(h=>{const s=scores[p]?.[h];const pts=s?sfPoints(s,PAR[h-1],hcp,HCP_HOLE[h-1]):null;const bg=!s?"":s-PAR[h-1]<=-2?"#fef9c3":s-PAR[h-1]===-1?"#ffedd5":s-PAR[h-1]===0?"#dcfce7":s-PAR[h-1]===1?"#f1f5f9":"#fee2e2";return`<td style="padding:3px;text-align:center;background:${bg};font-size:10px"><div style="font-weight:bold">${s||"-"}</div>${gameMode!=="medal"?`<div style="font-size:8px;color:#15803d">${pts!==null?pts+"p":""}</div>`:""}</td>`;}).join("");return`<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:3px 7px;font-weight:bold;font-size:11px;white-space:nowrap">${p}<br><span style="font-size:9px;color:#6b7280;font-weight:normal">SF ${handicaps[p]||0}/M ${handicapsMedal[p]||0}</span></td>${cells}<td style="padding:3px 5px;text-align:center;font-weight:bold;font-size:11px">${gameMode==="medal"?playerTotal(p):playerSF(p)+" pts"}</td>${gameMode==="medal"?`<td style="padding:3px 5px;text-align:center;font-weight:bold;font-size:11px;color:#15803d">${fvp(playerNet(p))}</td>`:""}</tr>`;}).join("");
    const parRow=Array.from({length:HOLES},(_,i)=>`<td style="padding:2px 3px;text-align:center;font-size:9px;color:#6b7280">${PAR[i]}</td>`).join("");
    const hcpRow=Array.from({length:HOLES},(_,i)=>`<td style="padding:2px 3px;text-align:center;font-size:8px;color:#9ca3af">${HCP_HOLE[i]}</td>`).join("");
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${activeCourse.name} ${today}</title><style>body{font-family:Georgia,serif;margin:0;padding:14px;color:#111;background:#fff}h1{margin:0;font-size:20px;color:#166534}.sub{color:#6b7280;font-size:12px;margin:3px 0 14px}table{border-collapse:collapse;width:100%}th{background:#f0fdf4;padding:7px;font-size:11px;color:#166534;border-bottom:2px solid #bbf7d0}@media print{body{padding:8px}}</style></head><body><h1>⛳ ${activeCourse.name}</h1><div class="sub">${modeLabel} · ${today} · Par ${TOTAL_PAR}</div><h2 style="font-size:13px;color:#166534;margin-bottom:6px">Resultado Final</h2><table style="margin-bottom:18px"><thead><tr><th style="width:34px">Pos.</th><th style="text-align:left">Jugador</th><th>HCP</th><th>${gameMode==="medal"?"Score / Neto":"Puntos"}</th></tr></thead><tbody>${indRows}</tbody></table>${lagSection}<h2 style="font-size:13px;color:#166634;margin-bottom:6px">Scorecard</h2><div style="overflow-x:auto"><table style="font-size:10px"><thead><tr style="background:#f0fdf4"><th style="text-align:left;padding:3px 7px">Jugador</th>${Array.from({length:HOLES},(_,i)=>`<th style="padding:2px 3px;text-align:center">H${i+1}</th>`).join("")}<th>${gameMode==="medal"?"TOT":"PTS"}</th>${gameMode==="medal"?"<th>NETO</th>":""}</tr><tr><td style="padding:2px 7px;font-size:9px;color:#6b7280">Par</td>${parRow}<td></td></tr><tr><td style="padding:2px 7px;font-size:8px;color:#9ca3af">HCP</td>${hcpRow}<td></td></tr></thead><tbody>${holeRows}</tbody></table></div><div style="margin-top:14px;font-size:10px;color:#9ca3af;text-align:center">Golf Live Score · ${activeCourse.name}</div></body></html>`;
    const win=window.open("","_blank");win.document.write(html);win.document.close();setTimeout(()=>win.print(),700);
  };

  if (loading) return (
    <div style={{background:"#0a0f0a",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
      <div style={{color:"#4ade80",fontSize:18}}>Cargando...</div>
      <div style={{color:"#6b7280",fontSize:12}}>Conectando con Google Sheets...</div>
    </div>
  );

  if (editingCourse!==null) return <CourseEditor course={editingCourse==="new"?null:editingCourse} onSave={saveCourse} onCancel={()=>s_editing(null)}/>;

  // ══ ROTATION MODAL ═══════════════════════════════════════════════════
  const RotationModal=()=>(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,overflowY:"auto"}}>
      <div style={{background:"#0a0f0a",minHeight:"100vh",fontFamily:"Georgia,serif",color:"#e2e8f0"}}>
        <div style={{background:"linear-gradient(135deg,#052e16,#0a2010)",borderBottom:"1px solid #166534",padding:"14px 16px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10}}>
          <button onClick={()=>s_showRot(false)} style={{background:"transparent",border:"none",color:"#4ade80",cursor:"pointer",fontSize:20}}>←</button>
          <div style={{flex:1}}><div style={{fontSize:15,fontWeight:"bold",color:"#4ade80"}}>📋 Orden de Juego — Laguñada</div><div style={{fontSize:11,color:"#6b7280"}}>{lagunadaVariant==="1ball"?"1 Pelota":"2 Pelotas"} · {numTeams} equipos</div></div>
          <button onClick={printRotation} style={{padding:"7px 12px",borderRadius:8,border:"none",background:"#16a34a",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:"bold"}}>🖨️ PDF</button>
        </div>
        <div style={{padding:16}}>
          {!hasUnequalTeams
            ?<div style={{padding:14,background:"#0f1a0f",borderRadius:10,color:"#4ade80",fontSize:13,textAlign:"center"}}>Todos los equipos tienen igual cantidad de jugadores — todos juegan los 18 hoyos.</div>
            :<>
              <div style={{padding:"10px 14px",background:"#0a1a3a",borderRadius:10,border:"1px solid #1e3a5f",marginBottom:14,fontSize:12,color:"#93c5fd"}}>ℹ️ El equipo más grande rota quién descansa por hoyo para equilibrar.</div>
              {activeTeamDefs.map(t=>{const players=(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));const n=players.length;const byePerHole=Math.max(0,n-minTeamSize);
                if(byePerHole===0)return(<div key={t.id} style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:10,padding:"12px 14px",marginBottom:12}}><div style={{fontSize:13,fontWeight:"bold",color:t.color,marginBottom:4}}>{t.label} — {n} jugadores</div><div style={{fontSize:12,color:"#4ade80"}}>✅ Juegan todos los 18 hoyos</div><div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{players.join(", ")}</div></div>);
                return(<div key={t.id} style={{marginBottom:14}}>
                  <div style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:"10px 10px 0 0",padding:"12px 14px"}}>
                    <div style={{fontSize:13,fontWeight:"bold",color:t.color,marginBottom:6}}>{t.label} — {n} jugadores · descansa {byePerHole}/hoyo</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{players.map(p=>(<div key={p} style={{padding:"3px 10px",background:"rgba(0,0,0,0.3)",borderRadius:16,fontSize:11}}><span style={{color:"#e2e8f0",fontWeight:"bold"}}>{p}</span><span style={{color:t.color,marginLeft:5}}>{playerHolesInRotation(rotation,t.id,p)} hoyos</span></div>))}</div>
                  </div>
                  <div style={{background:"#0f1a0f",border:`1px solid ${t.border}`,borderTop:"none",borderRadius:"0 0 10px 10px",overflow:"hidden"}}>
                    <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                      <thead><tr style={{background:"#0a1a0a"}}><th style={{padding:"5px 8px",textAlign:"center",color:"#6b7280",width:40}}>H</th><th style={{padding:"5px 8px",textAlign:"left",color:"#6b7280"}}>Juegan</th><th style={{padding:"5px 8px",textAlign:"left",color:"#f87171"}}>Descansa</th></tr></thead>
                      <tbody>{Array.from({length:HOLES},(_,hi)=>hi+1).map(h=>{const active=activePlayers(rotation,t.id,h);const sitting=players.filter(p=>!active.includes(p));return(<tr key={h} style={{borderTop:"1px solid #1a2e1a",background:h%2===0?"#0d140d":"#0a0f0a"}}><td style={{padding:"5px 8px",textAlign:"center",fontWeight:"bold",color:t.color}}>{h}<div style={{fontSize:8,color:"#6b7280",fontWeight:"normal"}}>P{PAR[h-1]}</div></td><td style={{padding:"5px 8px",color:"#e2e8f0",fontSize:12}}>{active.join(", ")}</td><td style={{padding:"5px 8px",color:"#f87171",fontWeight:"bold",fontSize:12}}>{sitting.length>0?sitting.join(", "):<span style={{color:"#374151"}}>—</span>}</td></tr>);})}</tbody>
                    </table>
                  </div>
                </div>);
              })}
            </>
          }
          <button onClick={printRotation} style={{width:"100%",marginTop:8,padding:13,borderRadius:10,border:"none",background:"#16a34a",color:"#fff",cursor:"pointer",fontSize:15,fontWeight:"bold"}}>🖨️ Imprimir / Guardar PDF</button>
        </div>
      </div>
    </div>
  );

  // ══ RESULT ═══════════════════════════════════════════════════════════
  if (showResult) return (
    <div style={{background:"#0a0f0a",minHeight:"100vh",fontFamily:"Georgia,serif",color:"#e2e8f0"}}>
      <div style={{background:"linear-gradient(135deg,#052e16,#0a2010)",borderBottom:"1px solid #166534",padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>s_showResult(false)} style={{background:"transparent",border:"none",color:"#4ade80",cursor:"pointer",fontSize:20}}>←</button>
        <div><div style={{fontSize:18,fontWeight:"bold",color:"#4ade80"}}>🏆 Resultado Final</div><div style={{fontSize:11,color:"#6b7280"}}>{gameMode==="medal"?"Medal":"Stableford"} · {activeCourse.name} · Par {TOTAL_PAR}</div></div>
      </div>
      <div style={{padding:16}}>
        <div style={{display:"flex",justifyContent:"center",alignItems:"flex-end",gap:8,marginBottom:20,marginTop:8}}>
          {[1,0,2].map(i=>{const p=finalBoard[i];if(!p)return<div key={i} style={{width:80}}/>;const isFirst=i===0;return(<div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",width:100}}><div style={{fontSize:isFirst?28:22}}>{medal[i+1]}</div><div style={{fontWeight:"bold",fontSize:isFirst?15:13,color:isFirst?"#FFD700":"#e2e8f0",textAlign:"center",marginBottom:4}}>{p}</div><div style={{fontWeight:"bold",color:isFirst?"#FFD700":"#4ade80",fontSize:isFirst?18:14,marginBottom:4}}>{gameMode==="medal"?fvp(playerNet(p)):`${playerSF(p)} pts`}</div><div style={{background:isFirst?"#166534":"#1a2e1a",borderRadius:"6px 6px 0 0",width:"100%",height:isFirst?110:90,display:"flex",alignItems:"center",justifyContent:"center",fontSize:isFirst?22:18,color:"#4ade80",fontWeight:"bold"}}>#{i+1}</div></div>);})}
        </div>
        <div style={{background:"#0f1a0f",borderRadius:10,border:"1px solid #1a2e1a",overflow:"hidden",marginBottom:14}}>
          <div style={{padding:"10px 14px",borderBottom:"1px solid #1a2e1a",fontSize:12,color:"#6b7280",textTransform:"uppercase",letterSpacing:1}}>Ranking individual</div>
          {finalBoard.map((p,i)=>{const hcp=parseInt(handicaps[p])||0,sf=playerSF(p),net=playerNet(p),tm=playerTeam(p);return(<div key={p} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:i<finalBoard.length-1?"1px solid #1a2e1a":"none",background:i===0?"#0a2010":"transparent"}}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{fontSize:18,width:26,textAlign:"center"}}>{i<3?medal[i+1]:<span style={{color:"#4b5563",fontSize:13}}>#{i+1}</span>}</div><div><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:"bold",fontSize:14}}>{p}</span>{tm&&<span style={{fontSize:9,background:tm.badgeBg,color:tm.badgeColor,borderRadius:3,padding:"1px 5px"}}>{tm.label}</span>}</div><div style={{fontSize:11,color:"#6b7280"}}>SF {hcp} / M {parseInt(handicapsMedal[p])||0} · Bruto: {playerTotal(p)}</div></div></div><div style={{textAlign:"right"}}>{gameMode==="medal"?<><div style={{fontSize:18,fontWeight:"bold",color:vpc(net)}}>{fvp(net)}</div><div style={{fontSize:10,color:"#6b7280"}}>neto</div></>:<div style={{fontSize:20,fontWeight:"bold",color:sfc(sf)}}>{sf} pts</div>}</div></div>);})}
        </div>
        {hasTeams&&(<div style={{background:"#0a0f1a",borderRadius:10,border:"1px solid #1e3a5f",overflow:"hidden",marginBottom:14}}><div style={{padding:"10px 14px",borderBottom:"1px solid #1e3a5f",fontSize:12,color:"#60a5fa",textTransform:"uppercase",letterSpacing:1}}>Laguñada · {lagunadaVariant==="1ball"?"1 Pelota":"2 Pelotas"}</div>{rankedTeams.map((t,i)=>{const st=teamScores[t.id];const fd=teamFinalDiff(t.id);const bonus=parseInt(teamBonus[t.id])||0;const players=(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));return(<div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:i<activeTeamDefs.length-1?"1px solid #1e3a5f":"none"}}><div><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:16}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</span><span style={{fontWeight:"bold",fontSize:15,color:t.color}}>{t.label}</span></div><div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{players.join(", ")}</div>{bonus>0&&<div style={{fontSize:10,color:"#fbbf24",marginTop:1}}>+{bonus} bonus</div>}</div><div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:"bold",color:fd<0?"#FFD700":fd===0?"#4ade80":"#f87171"}}>{st.played>0?fvp(fd):"—"}</div><div style={{fontSize:10,color:"#6b7280"}}>neto vs par</div></div></div>);})}</div>)}
        <button onClick={printResult} style={{width:"100%",padding:14,borderRadius:10,border:"none",background:"#16a34a",color:"#fff",cursor:"pointer",fontSize:16,fontWeight:"bold"}}>📄 Generar PDF / Imprimir</button>
      </div>
    </div>
  );

  // ══ SETUP ════════════════════════════════════════════════════════════
  if (view==="setup") return (
    <div style={{background:"#0a0f0a",minHeight:"100vh",fontFamily:"Georgia,serif",color:"#e2e8f0"}}>
      <div style={{background:"linear-gradient(135deg,#052e16,#0a2010)",borderBottom:"1px solid #166534",padding:"16px 20px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:22,fontWeight:"bold",color:"#4ade80"}}>⛳ Golf Live Score</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>Configuración · Par {TOTAL_PAR}</div>
          </div>
          {Object.keys(scores).length>0&&(
            <button onClick={()=>s_showResetConfirm(true)} style={{padding:"8px 14px",borderRadius:8,border:"2px solid #dc2626",background:"transparent",color:"#f87171",cursor:"pointer",fontSize:12,fontWeight:"bold"}}>🔄 Nueva ronda</button>
          )}
        </div>
        <div style={{marginTop:6,display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:syncing?"#fbbf24":"#4ade80"}}/>
          <span style={{fontSize:10,color:syncing?"#fbbf24":"#4ade80"}}>{syncing?"Sincronizando...":"Conectado · Google Sheets"}</span>
        </div>
      </div>

      {showResetConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#0f1a0f",border:"2px solid #dc2626",borderRadius:16,padding:24,maxWidth:320,width:"100%",textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:18,fontWeight:"bold",color:"#f87171",marginBottom:8}}>¿Nueva ronda?</div>
            <div style={{fontSize:14,color:"#6b7280",marginBottom:20}}>Se van a borrar todos los scores actuales. Esta acción no se puede deshacer.</div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>s_showResetConfirm(false)} style={{flex:1,padding:"12px",borderRadius:10,border:"1px solid #374151",background:"transparent",color:"#9ca3af",cursor:"pointer",fontSize:14,fontWeight:"bold"}}>Cancelar</button>
              <button onClick={nuevaRonda} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:"bold"}}>{syncing?"Borrando...":"Sí, borrar todo"}</button>
            </div>
          </div>
        </div>
      )}
      <div style={{padding:16}}>
        <div style={{display:"flex",gap:3,marginBottom:14,background:"#0f1a0f",borderRadius:10,padding:4}}>
          {[["course","🏌️ Cancha"],["players","👤 Jugadores"],["teams","🤝 Laguñada"]].map(([tab,label])=>(
            <button key={tab} onClick={()=>s_setupTab(tab)} style={{flex:1,padding:"8px 4px",borderRadius:7,border:"none",background:setupTab===tab?"#16a34a":"transparent",color:setupTab===tab?"#fff":"#6b7280",cursor:"pointer",fontSize:11,fontWeight:"bold"}}>{label}</button>
          ))}
        </div>

        {setupTab==="course"&&<>
          <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Seleccionar cancha</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
            {courses.map(c=>{const active=c.id===activeCourseId;const isDefault=!!DEFAULT_COURSES.find(d=>d.id===c.id);return(
              <div key={c.id} style={{background:active?"#0a2010":"#0f1a0f",border:`2px solid ${active?"#16a34a":"#1a2e1a"}`,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
                <div onClick={()=>setCourse(c.id)} style={{flex:1,cursor:"pointer"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>{active&&<span>✅</span>}<span style={{fontWeight:"bold",fontSize:15,color:active?"#4ade80":"#e2e8f0"}}>{c.name}</span>{isDefault&&<span style={{fontSize:9,background:"#1a2e1a",color:"#6b7280",borderRadius:3,padding:"1px 5px"}}>default</span>}</div>
                  <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>Par {c.par.reduce((a,b)=>a+b,0)} · {c.par.slice(0,9).reduce((a,b)=>a+b,0)} / {c.par.slice(9).reduce((a,b)=>a+b,0)}</div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>s_editing(c)} style={{padding:"6px 10px",borderRadius:7,border:"1px solid #374151",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:12}}>✏️</button>
                  {!isDefault&&<button onClick={()=>deleteCourse(c.id)} style={{padding:"6px 10px",borderRadius:7,border:"1px solid #5f1e1e",background:"transparent",color:"#f87171",cursor:"pointer",fontSize:12}}>🗑️</button>}
                </div>
              </div>
            );})}
          </div>
          <button onClick={()=>s_editing("new")} style={{width:"100%",padding:13,borderRadius:10,border:"2px dashed #166534",background:"transparent",color:"#4ade80",cursor:"pointer",fontSize:14,fontWeight:"bold"}}>＋ Nueva cancha</button>
        </>}

        {setupTab==="players"&&<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Modalidad individual</div>
            <div style={{display:"flex",gap:6}}>
              {[["stableford","🎯 Stableford"],["medal","🏅 Medal"],["ambos","🎯🤝 Ambos"]].map(([m,label])=>(
                <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"9px 4px",borderRadius:8,border:`2px solid ${gameMode===m?"#16a34a":"#1a2e1a"}`,background:gameMode===m?"#052e16":"transparent",color:gameMode===m?"#4ade80":"#6b7280",cursor:"pointer",fontSize:11,fontWeight:"bold"}}>{label}</button>
              ))}
            </div>
            <div style={{marginTop:8,padding:"8px 12px",background:"#0f1a0f",borderRadius:8,fontSize:12,color:"#6b7280"}}>
              {gameMode==="stableford"&&"Puntos Stableford por hoyo según HCP."}
              {gameMode==="medal"&&"Score bruto total menos hándicap."}
              {gameMode==="ambos"&&"Stableford individual + Laguñada de equipos en simultáneo."}
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1}}>Jugadores y hándicap</div>
            <button onClick={()=>s_showAdd(!showAdd)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #16a34a",background:"transparent",color:"#4ade80",cursor:"pointer",fontSize:12}}>+ Nuevo</button>
          </div>
          {showAdd&&(<div style={{background:"#0f1a0f",border:"1px solid #16a34a",borderRadius:10,padding:12,marginBottom:10,display:"flex",gap:8}}><input value={newPlayerName} onChange={e=>s_npn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNewPlayer()} placeholder="Nombre" style={{flex:1,background:"#0a2010",border:"1px solid #166534",borderRadius:6,color:"#e2e8f0",padding:"8px 10px",fontSize:14,outline:"none"}}/><button onClick={addNewPlayer} style={{padding:"8px 16px",borderRadius:6,border:"none",background:"#16a34a",color:"#fff",cursor:"pointer",fontWeight:"bold"}}>Agregar</button></div>)}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {playerList.map(p=>{const sel=selectedPlayers.includes(p);return(
              <div key={p} style={{background:sel?"#0a2010":"#0f1a0f",border:`1px solid ${sel?"#16a34a":"#1a2e1a"}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
                <div onClick={()=>togglePlayer(p)} style={{width:22,height:22,borderRadius:5,border:`2px solid ${sel?"#16a34a":"#374151"}`,background:sel?"#16a34a":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{sel&&<span style={{color:"#fff",fontSize:14}}>✓</span>}</div>
                <div onClick={()=>togglePlayer(p)} style={{flex:1,fontWeight:sel?"bold":"normal",color:sel?"#e2e8f0":"#6b7280",cursor:"pointer",fontSize:14}}>{p}</div>
                {sel&&<div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}><div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}><span style={{fontSize:9,color:"#4ade80",fontWeight:"bold"}}>SF</span><input type="number" min="0" max="54" value={handicaps[p]??""} onChange={e=>setHandicap(p,e.target.value)} placeholder="0" style={{width:48,background:"#0f2a0f",border:"1px solid #166534",borderRadius:6,color:"#4ade80",fontSize:15,fontWeight:"bold",padding:"4px 4px",textAlign:"center",outline:"none"}}/></div><div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}><span style={{fontSize:9,color:"#fbbf24",fontWeight:"bold"}}>Medal</span><input type="number" min="0" max="54" value={handicapsMedal[p]??""} onChange={e=>setHandicapMedal(p,e.target.value)} placeholder="0" style={{width:48,background:"#1a1400",border:"1px solid #92400e",borderRadius:6,color:"#fbbf24",fontSize:15,fontWeight:"bold",padding:"4px 4px",textAlign:"center",outline:"none"}}/></div></div>}
              </div>
            );})}
          </div>
        </>}

        {setupTab==="teams"&&<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Variante Laguñada</div>
            <div style={{display:"flex",gap:8,marginBottom:8}}>{[["1ball","1 Pelota"],["2ball","2 Pelotas"]].map(([v,label])=>(<button key={v} onClick={()=>setLV(v)} style={{flex:1,padding:"10px",borderRadius:8,border:`2px solid ${lagunadaVariant===v?"#2563eb":"#1a2e1a"}`,background:lagunadaVariant===v?"#0a1a3a":"transparent",color:lagunadaVariant===v?"#60a5fa":"#6b7280",cursor:"pointer",fontSize:13,fontWeight:"bold"}}>{label}</button>))}</div>
            <div style={{padding:"8px 12px",background:"#0f1a0f",borderRadius:8,fontSize:12,color:"#6b7280"}}>{lagunadaVariant==="1ball"?"El mejor score neto del equipo en cada hoyo.":"La suma de los 2 mejores scores netos."}</div>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Cantidad de equipos</div>
            <div style={{display:"flex",gap:8}}>{[2,3,4].map(n=>(<button key={n} onClick={()=>changeNumTeams(n)} style={{flex:1,padding:"14px 0",borderRadius:8,border:`2px solid ${numTeams===n?"#2563eb":"#1a2e1a"}`,background:numTeams===n?"#0a1a3a":"transparent",color:numTeams===n?"#60a5fa":"#6b7280",cursor:"pointer",fontSize:22,fontWeight:"bold"}}>{n}</button>))}</div>
          </div>
          {selectedPlayers.length===0
            ?<div style={{color:"#4b5563",textAlign:"center",padding:20,fontSize:13}}>Primero seleccioná jugadores en la pestaña Jugadores</div>
            :<>
              <div style={{fontSize:11,color:"#6b7280",marginBottom:10}}>Tocá el equipo para asignar · tocá de nuevo para quitar:</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {selectedPlayers.map(p=>{const pt=playerTeam(p);return(
                  <div key={p} style={{background:pt?pt.bg:"#0f1a0f",border:`1px solid ${pt?pt.border:"#1a2e1a"}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flex:1}}><span style={{fontSize:14,fontWeight:"bold"}}>{p}</span><span style={{fontSize:11,color:"#6b7280",marginLeft:8}}>SF {handicaps[p]||0} / M {handicapsMedal[p]||0}</span>{pt&&<span style={{marginLeft:8,fontSize:10,background:pt.badgeBg,color:pt.badgeColor,borderRadius:3,padding:"1px 6px"}}>{pt.label}</span>}</div>
                    <div style={{display:"flex",gap:5}}>{activeTeamDefs.map(t=>{const active=(teams[t.id]||[]).includes(p);return<button key={t.id} onClick={()=>assignTeam(p,t.id)} style={{width:34,height:34,borderRadius:7,border:`2px solid ${active?t.color:t.border}`,background:active?t.bg:"transparent",color:active?t.color:t.color+"60",cursor:"pointer",fontSize:12,fontWeight:"bold"}}>{t.id}</button>;})}</div>
                  </div>
                );})}
              </div>
              {hasTeams&&(
                <div style={{marginTop:12}}>
                  {hasUnequalTeams
                    ?<div style={{background:"#1a0a00",border:"2px solid #92400e",borderRadius:10,padding:"12px 14px"}}><div style={{fontSize:13,color:"#fbbf24",fontWeight:"bold",marginBottom:6}}>⚠️ Equipos desiguales — se aplicará rotación</div><button onClick={()=>s_showRot(true)} style={{width:"100%",padding:"10px",borderRadius:8,border:"none",background:"#92400e",color:"#fef3c7",cursor:"pointer",fontSize:13,fontWeight:"bold"}}>📋 Ver orden de juego</button></div>
                    :<div style={{background:"#060f1a",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 14px"}}><div style={{fontSize:12,color:"#60a5fa",marginBottom:6}}>✅ Equipos iguales — todos juegan los 18 hoyos</div>{activeTeamDefs.map(t=><div key={t.id} style={{fontSize:11,color:t.color,marginTop:3}}>· {t.label}: {(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p)).join(", ")||"(vacío)"}</div>)}</div>
                  }
                </div>
              )}
            </>
          }
        </>}

        <button onClick={()=>selectedPlayers.length>0&&s_view("grid")} disabled={selectedPlayers.length===0} style={{width:"100%",marginTop:18,padding:14,borderRadius:10,border:"none",background:selectedPlayers.length>0?"#16a34a":"#1a2e1a",color:selectedPlayers.length>0?"#fff":"#4b5563",cursor:selectedPlayers.length>0?"pointer":"not-allowed",fontSize:16,fontWeight:"bold"}}>
          {selectedPlayers.length>0?`Empezar · ${activeCourse.name} · ${selectedPlayers.length} jugadores ⛳`:"Seleccioná al menos un jugador"}
        </button>
      </div>
      {showRotation&&<RotationModal/>}
    </div>
  );

  // ══ MAIN GAME ════════════════════════════════════════════════════════
  const isSF = gameMode!=="medal";
  return (
    <div style={{background:"#0a0f0a",minHeight:"100vh",fontFamily:"Georgia,serif",color:"#e2e8f0"}}>
      <div style={{background:"linear-gradient(135deg,#052e16,#0a2010)",borderBottom:"1px solid #166534",padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:20,fontWeight:"bold",color:"#4ade80"}}>⛳ {activeCourse.name}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}>
              <span style={{fontSize:11,color:"#6b7280"}}>{gameMode==="medal"?"🏅 Medal":gameMode==="ambos"?"🎯🤝 Stableford+Laguñada":"🎯 Stableford"} · Par {TOTAL_PAR}</span>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:syncing?"#fbbf24":"#4ade80"}}/>
                <span style={{fontSize:9,color:syncing?"#fbbf24":"#4ade80"}}>{syncing?"Guardando...":lastUpdate?`Act. ${lastUpdate}`:"en vivo"}</span>
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[["grid","🏌️"],["leaderboard","🏆"],["lagunada","🤝"],["myholes","👤"]].map(([v,label])=>(
              <button key={v} onClick={()=>s_view(v)} style={{padding:"6px 10px",borderRadius:6,border:"none",cursor:"pointer",fontSize:13,fontWeight:"bold",background:view===v?"#16a34a":"#1a2e1a",color:view===v?"#fff":"#6b7280"}}>{label}</button>
            ))}
            <button onClick={()=>s_view("setup")} style={{padding:"6px 10px",borderRadius:6,border:"1px solid #374151",background:"transparent",color:"#6b7280",cursor:"pointer",fontSize:11}}>⚙️</button>
            <button onClick={()=>s_showResetConfirm(true)} style={{padding:"6px 10px",borderRadius:6,border:"1px solid #dc2626",background:"transparent",color:"#f87171",cursor:"pointer",fontSize:11,fontWeight:"bold"}}>🔄</button>
          </div>
        </div>
        {allDone&&<button onClick={()=>s_showResult(true)} style={{marginTop:10,width:"100%",padding:"10px",borderRadius:8,border:"none",background:"linear-gradient(90deg,#ca8a04,#eab308)",color:"#000",cursor:"pointer",fontSize:14,fontWeight:"bold"}}>🏆 Ronda completa! Ver resultado y PDF</button>}
      </div>

      {view!=="leaderboard"&&view!=="lagunada"&&(
        <div style={{padding:"10px 14px",borderBottom:"1px solid #1a2e1a"}}>
          <div style={{fontSize:10,color:"#6b7280",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Tu jugador</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {PLAYERS.map(p=>(<button key={p} onClick={()=>s_myPlayer(p)} style={{padding:"5px 10px",borderRadius:20,border:"1px solid",borderColor:myPlayer===p?"#16a34a":"#1a2e1a",background:myPlayer===p?"#052e16":"transparent",color:myPlayer===p?"#4ade80":"#94a3b8",cursor:"pointer",fontSize:12}}>{p}{handicaps[p]||handicapsMedal[p]?` (${handicaps[p]||0}/${handicapsMedal[p]||0})`:""}</button>))}
          </div>
        </div>
      )}

      {/* ── LAGUÑADA ─────────────────────────────────────────────────── */}
      {view==="lagunada"&&(
        <div style={{padding:16}}>
          <div style={{display:"flex",gap:8,marginBottom:10}}>{[["1ball","1 Pelota"],["2ball","2 Pelotas"]].map(([v,label])=>(<button key={v} onClick={()=>setLV(v)} style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${lagunadaVariant===v?"#2563eb":"#1e3a5f"}`,background:lagunadaVariant===v?"#0a1a3a":"#0a0f0a",color:lagunadaVariant===v?"#60a5fa":"#6b7280",cursor:"pointer",fontSize:12,fontWeight:"bold"}}>{label}</button>))}</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:11,color:"#6b7280"}}>{numTeams} equipos{hasUnequalTeams?" · con rotación":""}</div>
            {hasTeams&&<button onClick={()=>s_showRot(true)} style={{padding:"5px 12px",borderRadius:8,border:"1px solid #92400e",background:"transparent",color:"#fbbf24",cursor:"pointer",fontSize:11,fontWeight:"bold"}}>📋 Orden</button>}
          </div>
          {!hasTeams
            ?<div style={{color:"#4b5563",textAlign:"center",marginTop:40,fontSize:14}}><div style={{fontSize:30,marginBottom:10}}>🤝</div>Asigná jugadores a equipos en ⚙️</div>
            :<>
              {/* Tarjetas de equipo con BONUS — orden fijo A/B/C/D para que el input no salte */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                {activeTeamDefs.map((t)=>{
                  const st=teamScores[t.id];
                  const fd=teamFinalDiff(t.id);
                  const bonus=parseInt(teamBonus[t.id])||0;
                  const players=(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));
                  const rank=rankedTeams.findIndex(rt=>rt.id===t.id);
                  const isLead=rank===0&&st.played>0&&fd<teamFinalDiff(rankedTeams[1]?.id);
                  const teamSFtotal=players.reduce((acc,p)=>acc+playerSF(p),0);
                  return(<div key={t.id} style={{background:t.bg,border:`2px solid ${isLead?"#FFD700":t.border}`,borderRadius:12,padding:"12px 10px",textAlign:"center",position:"relative"}}>
                    {isLead&&st.played>0&&<div style={{position:"absolute",top:-8,left:"50%",transform:"translateX(-50%)",fontSize:16}}>🏆</div>}
                    <div style={{fontSize:11,color:t.color,fontWeight:"bold",marginBottom:2}}>{t.label}</div>
                    <div style={{fontSize:10,color:"#6b7280",marginBottom:6}}>{players.join(", ")}</div>
                    <div style={{fontSize:26,fontWeight:"bold",color:fd<0?"#FFD700":fd===0?"#4ade80":"#f87171"}}>{st.played>0?fvp(fd):"—"}</div>
                    <div style={{fontSize:9,color:"#6b7280"}}>Laguñada · {st.played}/18</div>
                    {/* BONUS input */}
                    <div style={{marginTop:6,borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:6,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                      <span style={{fontSize:10,color:"#fbbf24",fontWeight:"bold"}}>Bonus</span>
                      <input
                        type="number" min="0" max="99"
                        value={teamBonus[t.id]??""} 
                        onChange={e=>{const nb={...teamBonus,[t.id]:e.target.value};saveBonus(nb);}}
                        placeholder="0"
                        style={{width:44,background:"#1a1400",border:"1px solid #92400e",borderRadius:6,color:"#fbbf24",fontSize:15,fontWeight:"bold",padding:"3px 4px",textAlign:"center",outline:"none"}}
                      />
                    </div>
                    {gameMode==="ambos"&&st.played>0&&<div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:4,marginTop:4}}><div style={{fontSize:13,fontWeight:"bold",color:"#4ade80"}}>{teamSFtotal} pts SF</div></div>}
                  </div>);
                })}
              </div>

              <div style={{background:"#0f1a0f",borderRadius:10,border:"1px solid #1a2e1a",overflow:"hidden",marginBottom:gameMode==="ambos"?14:0}}>
                <div style={{padding:"8px 14px",borderBottom:"1px solid #1a2e1a",fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1}}>Laguñada · hoyo a hoyo</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
                    <thead><tr style={{background:"#0a1a0a"}}><th style={{padding:"6px 8px",textAlign:"left",color:"#6b7280",minWidth:65}}>Equipo</th>{Array.from({length:HOLES},(_,i)=>i+1).map(h=>(<th key={h} style={{padding:"4px 2px",textAlign:"center",color:"#6b7280",minWidth:26}}><div>H{h}</div><div style={{fontSize:8,color:"#374151"}}>P{PAR[h-1]}</div></th>))}<th style={{padding:"4px 6px",textAlign:"center",color:"#86efac",minWidth:44}}>TOT</th></tr></thead>
                    <tbody>{activeTeamDefs.map(t=>{const players=(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));let rt=0,rp=0,acc=0;return(<tr key={t.id} style={{borderBottom:"1px solid #0f1a0f"}}><td style={{padding:"6px 8px",fontWeight:"bold",color:t.color,whiteSpace:"nowrap",fontSize:11}}>{t.label}</td>{Array.from({length:HOLES},(_,i)=>i+1).map(h=>{const ap=activePlayers(rotation,t.id,h);const sitting=players.filter(p=>!ap.includes(p));const v=lagHoleScore(ap,h,scores,handicaps,lagunadaVariant,HCP_HOLE);const par=holePar(h,lagunadaVariant,PAR);if(v!==null){rt+=v;rp+=par;acc=rt-rp;}const hd=v!==null?v-par:null;const cc=hd===null?"#374151":hd<0?"#FFD700":hd===0?"#4ade80":hd===1?"#94a3b8":"#f87171";const ac=acc<0?"#FFD700":acc===0?"#4ade80":"#f87171";return(<td key={h} style={{padding:"2px 1px",textAlign:"center",position:"relative",borderLeft:"1px solid #0f1a0f"}}>{sitting.length>0&&<div style={{position:"absolute",top:1,right:1,width:4,height:4,borderRadius:"50%",background:"#f87171"}}/>}<div style={{fontWeight:"bold",color:cc,fontSize:11}}>{hd!==null?fvp(hd):"·"}</div>{v!==null&&rp>0&&<div style={{fontSize:8,color:ac,fontWeight:"bold"}}>{fvp(acc)}</div>}</td>);})}<td style={{textAlign:"center",fontWeight:"bold",color:rt-rp<0?"#FFD700":rt-rp===0?"#4ade80":"#f87171",fontSize:13,padding:"0 4px"}}>{rp>0?fvp(rt-rp):"—"}</td></tr>);})}</tbody>
                  </table>
                </div>
                <div style={{padding:"5px 12px",fontSize:10,color:"#4b5563",background:"#0a1a0a"}}>Celda: <span style={{color:"#FFD700"}}>hoyo</span> · <span style={{color:"#4ade80"}}>acumulado</span>{hasUnequalTeams&&<span style={{color:"#f87171"}}> · ● descansa</span>}</div>
              </div>
              {gameMode==="ambos"&&(
                <div style={{background:"#0f1a0f",borderRadius:10,border:"1px solid #1a2e1a",overflow:"hidden"}}>
                  <div style={{padding:"8px 14px",borderBottom:"1px solid #1a2e1a",fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:1}}>🎯 Stableford individual</div>
                  {[...PLAYERS].filter(p=>holesPlayed(p)>0).sort((a,b)=>playerSF(b)-playerSF(a)).map((p,i)=>{const tm=playerTeam(p);const sf=playerSF(p);const hcp=parseInt(handicaps[p])||0;return(<div key={p} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 14px",borderBottom:"1px solid #0f1a0f",background:i===0?"#0a1a0a":"transparent"}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:14,width:20,textAlign:"center"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":<span style={{color:"#4b5563",fontSize:12}}>#{i+1}</span>}</span><div><div style={{display:"flex",alignItems:"center",gap:5}}><span style={{fontWeight:"bold",fontSize:13}}>{p}</span>{tm&&<span style={{fontSize:8,background:tm.badgeBg,color:tm.badgeColor,borderRadius:3,padding:"1px 4px"}}>{tm.label}</span>}</div><div style={{fontSize:10,color:"#6b7280"}}>SF {hcp} · {holesPlayed(p)}/18</div></div></div><div style={{fontSize:20,fontWeight:"bold",color:sfc(sf)}}>{sf} pts</div></div>);})}
                  {PLAYERS.filter(p=>holesPlayed(p)>0).length===0&&<div style={{padding:16,textAlign:"center",color:"#4b5563",fontSize:12}}>Sin scores todavía</div>}
                </div>
              )}
            </>
          }
        </div>
      )}

      {/* ── RANKING ──────────────────────────────────────────────────── */}
      {view==="leaderboard"&&(
        <div style={{padding:16}}>
          {gameMode==="ambos"?(
            <>
              <div style={{fontSize:12,color:"#4ade80",marginBottom:10,textTransform:"uppercase",letterSpacing:1,fontWeight:"bold"}}>🎯 Ranking Stableford</div>
              {[...PLAYERS].filter(p=>holesPlayed(p)>0).sort((a,b)=>playerSF(b)-playerSF(a)).map((p,i)=>{
                const hcp=parseInt(handicaps[p])||0,sf=playerSF(p),tm=playerTeam(p);
                return(<div key={p} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:i===0?"#0a2010":"#0f1a0f",border:`1px solid ${i===0?"#16a34a":"#1a2e1a"}`,borderRadius:10,padding:"10px 14px",marginBottom:7}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{fontSize:20,width:26,textAlign:"center"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":<span style={{color:"#4b5563",fontSize:14}}>#{i+1}</span>}</div>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:"bold",fontSize:15}}>{p}</span>{tm&&<span style={{fontSize:9,background:tm.badgeBg,color:tm.badgeColor,borderRadius:3,padding:"1px 5px"}}>{tm.label}</span>}<span style={{color:"#6b7280",fontSize:11}}>SF {hcp}</span></div>
                      <div style={{fontSize:11,color:"#6b7280"}}>{holesPlayed(p)}/18 hoyos</div>
                    </div>
                  </div>
                  <div style={{fontSize:24,fontWeight:"bold",color:sfc(sf)}}>{sf} pts</div>
                </div>);
              })}
              {[...PLAYERS].filter(p=>holesPlayed(p)>0).length===0&&<div style={{color:"#4b5563",textAlign:"center",marginBottom:16}}>Sin scores todavía</div>}
              <div style={{fontSize:12,color:"#fbbf24",margin:"18px 0 10px",textTransform:"uppercase",letterSpacing:1,fontWeight:"bold"}}>🏅 Ranking Medal</div>
              {[...PLAYERS].filter(p=>holesPlayed(p)>0).sort((a,b)=>playerNet(a)-playerNet(b)).map((p,i)=>{
                const hcpM=parseInt(handicapsMedal[p])||0,net=playerNet(p),tm=playerTeam(p);
                return(<div key={p} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:i===0?"#0a1400":"#0f1a0f",border:`1px solid ${i===0?"#92400e":"#1a2e1a"}`,borderRadius:10,padding:"10px 14px",marginBottom:7}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{fontSize:20,width:26,textAlign:"center"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":<span style={{color:"#4b5563",fontSize:14}}>#{i+1}</span>}</div>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:"bold",fontSize:15}}>{p}</span>{tm&&<span style={{fontSize:9,background:tm.badgeBg,color:tm.badgeColor,borderRadius:3,padding:"1px 5px"}}>{tm.label}</span>}<span style={{color:"#6b7280",fontSize:11}}>M {hcpM}</span></div>
                      <div style={{fontSize:11,color:"#6b7280"}}>Bruto: {playerTotal(p)} · {holesPlayed(p)}/18</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:"bold",color:vpc(net)}}>{fvp(net)}</div><div style={{fontSize:10,color:"#6b7280"}}>neto medal</div></div>
                </div>);
              })}
              {[...PLAYERS].filter(p=>holesPlayed(p)>0).length===0&&<div style={{color:"#4b5563",textAlign:"center"}}>Sin scores todavía</div>}
            </>
          ):(
            <>
              <div style={{fontSize:12,color:"#6b7280",marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>🏆 Ranking — {gameMode==="medal"?"Medal":"Stableford"}</div>
              {leaderboard.length===0&&<div style={{color:"#4b5563",textAlign:"center",marginTop:40}}>Sin scores todavía</div>}
              {leaderboard.map((p,i)=>{const hcp=parseInt(handicaps[p])||0,hcpM=parseInt(handicapsMedal[p])||0,sf=playerSF(p),net=playerNet(p),tm=playerTeam(p);return(<div key={p} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:i===0?"#0a2010":"#0f1a0f",border:`1px solid ${i===0?"#16a34a":"#1a2e1a"}`,borderRadius:10,padding:"12px 16px",marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:12}}><div style={{fontSize:20,width:28,textAlign:"center"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":<span style={{color:"#4b5563",fontSize:14}}>#{i+1}</span>}</div><div><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:"bold",fontSize:15}}>{p}</span>{tm&&<span style={{fontSize:9,background:tm.badgeBg,color:tm.badgeColor,borderRadius:3,padding:"1px 5px"}}>{tm.label}</span>}{(hcp>0||hcpM>0)&&<span style={{color:"#6b7280",fontSize:12}}>{gameMode==="medal"?"M":"SF"} {gameMode==="medal"?hcpM:hcp}</span>}</div><div style={{fontSize:11,color:"#6b7280"}}>{holesPlayed(p)}/18 hoyos</div></div></div>{gameMode==="medal"?<div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:"bold",color:vpc(net)}}>{fvp(net)}</div><div style={{fontSize:10,color:"#6b7280"}}>neto</div></div>:<div style={{fontSize:24,fontWeight:"bold",color:sfc(sf)}}>{sf} pts</div>}</div>);})}
            </>
          )}
          {hasTeams&&(
            <div style={{marginTop:18}}>
              <div style={{fontSize:12,color:"#6b7280",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>🤝 Laguñada — {lagunadaVariant==="1ball"?"1 Pelota":"2 Pelotas"}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {rankedTeams.map((t,i)=>{const st=teamScores[t.id];const fd=teamFinalDiff(t.id);const bonus=parseInt(teamBonus[t.id])||0;const players=(teams[t.id]||[]).filter(p=>selectedPlayers.includes(p));const isLead=i===0&&st.played>0&&fd<teamFinalDiff(rankedTeams[1]?.id);return(<div key={t.id} style={{background:t.bg,border:`2px solid ${isLead?"#FFD700":t.border}`,borderRadius:12,padding:"12px 10px",textAlign:"center",position:"relative"}}>{isLead&&st.played>0&&<div style={{position:"absolute",top:-8,left:"50%",transform:"translateX(-50%)",fontSize:14}}>🏆</div>}<div style={{fontSize:10,color:t.color,fontWeight:"bold",marginBottom:2}}>{t.label}</div><div style={{fontSize:9,color:"#6b7280",marginBottom:4}}>{players.join(", ")}</div><div style={{fontSize:26,fontWeight:"bold",color:fd<0?"#FFD700":fd===0?"#4ade80":"#f87171"}}>{st.played>0?fvp(fd):"—"}</div>{bonus>0&&<div style={{fontSize:9,color:"#fbbf24"}}>+{bonus} bonus</div>}<div style={{fontSize:9,color:"#6b7280"}}>{st.played}/18</div></div>);})}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MI RONDA ─────────────────────────────────────────────────── */}
      {view==="myholes"&&myPlayer&&(
        <div style={{padding:16,paddingBottom:80}}>
          <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}><span style={{color:"#4ade80",fontWeight:"bold"}}>{myPlayer}</span>{(handicaps[myPlayer]||handicapsMedal[myPlayer])&&<span> · SF {handicaps[myPlayer]||0} / M {handicapsMedal[myPlayer]||0}</span>}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {Array.from({length:HOLES},(_,i)=>i+1).map(hole=>{
              const s=scores[myPlayer]?.[hole],par=PAR[hole-1],hHcp=HCP_HOLE[hole-1],
                    hcp=parseInt(handicaps[myPlayer])||0,extra=strokesOnHole(hcp,hHcp),
                    pts=s?sfPoints(s,par,hcp,hHcp):null,info=sfLabel(pts),
                    isActive=activeHole===hole&&activePlayer===myPlayer;
              const tm=playerTeam(myPlayer);
              const ap=tm?activePlayers(rotation,tm.id,hole):[myPlayer];
              const isResting=tm&&!ap.includes(myPlayer);
              const myTeamV=tm?lagHoleScore(ap,hole,scores,handicaps,lagunadaVariant,HCP_HOLE):null;
              const myTeamDiff=myTeamV!==null?myTeamV-holePar(hole,lagunadaVariant,PAR):null;
              return(
                <div key={hole} onClick={()=>handleCell(myPlayer,hole)} style={{background:"#0f1a0f",border:`2px solid ${isActive?"#4ade80":"#1a2e1a"}`,borderRadius:10,padding:"10px 6px",textAlign:"center",cursor:"pointer"}}>
                  <div style={{fontSize:10,color:"#6b7280",fontWeight:"bold"}}>H{hole} · P{par}{extra>0?`+${extra}`:""}</div>
                  <div style={{fontSize:9,color:"#374151",marginBottom:2}}>HCP{hHcp}</div>
                  {/* Score grande y en negrita */}
                  <div style={{fontSize:30,fontWeight:"900",color:s?scoreColor(s,par):"#4b5563",lineHeight:1.1}}>{s||"—"}</div>
                  {isSF&&<div style={{fontSize:13,fontWeight:"bold",color:info?info.color:"#374151",marginTop:2}}>{pts!==null?`${pts}pt${pts!==1?"s":""}`:s?"0pts":"—"}</div>}
                  {info&&isSF&&<div style={{fontSize:9,color:info.color}}>{info.label}</div>}
                  {tm&&isSF&&(
                    <div style={{marginTop:2,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:2}}>
                      {isResting
                        ?<div style={{fontSize:8,color:"#f87171",opacity:0.7}}>no Laguñada</div>
                        :myTeamDiff!==null?<div style={{fontSize:10,color:tm.color,fontWeight:"bold"}}>{tm.id}: {fvp(myTeamDiff)}</div>:null
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{marginTop:14,background:"#0f1a0f",borderRadius:10,padding:12,border:"1px solid #1a2e1a"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:"#6b7280"}}>Hoyos jugados</span><span style={{color:"#4ade80",fontWeight:"bold"}}>{holesPlayed(myPlayer)}/18</span></div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:"#6b7280"}}>Score bruto</span><span style={{fontWeight:"bold"}}>{playerTotal(myPlayer)||"—"}</span></div>
            {isSF&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:hasTeams&&playerTeam(myPlayer)?4:0}}><span style={{color:"#6b7280"}}>Puntos Stableford</span><span style={{fontWeight:"bold",color:sfc(playerSF(myPlayer)),fontSize:18}}>{playerSF(myPlayer)} pts</span></div>}
            {gameMode==="medal"&&<><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:"#6b7280"}}>vs Par (bruto)</span><span style={{fontWeight:"bold",color:vpc(playerVsPar(myPlayer))}}>{holesPlayed(myPlayer)>0?fvp(playerVsPar(myPlayer)):"—"}</span></div><div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#6b7280"}}>vs Par (neto)</span><span style={{fontWeight:"bold",color:vpc(playerNet(myPlayer))}}>{holesPlayed(myPlayer)>0?fvp(playerNet(myPlayer)):"—"}</span></div></>}
            {playerTeam(myPlayer)&&(()=>{const tm=playerTeam(myPlayer);const fd=teamFinalDiff(tm.id);return(<div style={{marginTop:8,borderTop:"1px solid #1a2e1a",paddingTop:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{color:tm.color,fontSize:12,fontWeight:"bold"}}>{tm.label} — Laguñada</span><span style={{fontWeight:"bold",fontSize:16,color:fd<0?"#FFD700":fd===0?"#4ade80":"#f87171"}}>{teamScores[tm.id].played>0?fvp(fd):"—"}</span></div><div style={{fontSize:10,color:"#6b7280"}}>{teamScores[tm.id].played}/18 · {lagunadaVariant==="1ball"?"mejor neto":"2 mejores netos"}</div></div>);})()}
          </div>
        </div>
      )}
      {view==="myholes"&&!myPlayer&&<div style={{color:"#4b5563",textAlign:"center",marginTop:60,fontSize:14}}>Seleccioná tu jugador arriba</div>}

      {/* ── GRID ─────────────────────────────────────────────────────── */}
      {view==="grid"&&(
        <div style={{overflowX:"auto",paddingBottom:80}}>
          <table style={{borderCollapse:"collapse",minWidth:"100%",fontSize:14}}>
            <thead>
              <tr style={{background:"#0a1a0a"}}>
                <th style={{padding:"8px 10px",textAlign:"left",color:"#6b7280",position:"sticky",left:0,background:"#0a1a0a",borderRight:"1px solid #1a2e1a",minWidth:100}}>Jugador</th>
                {Array.from({length:9},(_,i)=>i+1).map(h=>(<th key={h} style={{padding:"5px 3px",textAlign:"center",color:"#6b7280",minWidth:38}}><div style={{fontSize:13}}>H{h}</div><div style={{fontSize:10,color:"#374151"}}>P{PAR[h-1]}</div></th>))}
                <th style={{padding:"4px",textAlign:"center",color:"#86efac",minWidth:40,background:"#071a07",borderLeft:"2px solid #166534",borderRight:"2px solid #166534"}}><div style={{fontSize:12,fontWeight:"bold"}}>OUT</div><div style={{fontSize:10,color:"#374151"}}>{PAR.slice(0,9).reduce((a,b)=>a+b,0)}</div></th>
                {Array.from({length:9},(_,i)=>i+10).map(h=>(<th key={h} style={{padding:"5px 3px",textAlign:"center",color:"#6b7280",minWidth:38}}><div style={{fontSize:13}}>H{h}</div><div style={{fontSize:10,color:"#374151"}}>P{PAR[h-1]}</div></th>))}
                <th style={{padding:"4px",textAlign:"center",color:"#86efac",minWidth:40,background:"#071a07",borderLeft:"2px solid #166634",borderRight:"2px solid #166634"}}><div style={{fontSize:12,fontWeight:"bold"}}>IN</div><div style={{fontSize:10,color:"#374151"}}>{PAR.slice(9).reduce((a,b)=>a+b,0)}</div></th>
                {gameMode==="ambos"?<><th style={{padding:"6px 4px",textAlign:"center",color:"#4ade80",minWidth:44,fontSize:11}}>PTS<br/>SF</th><th style={{padding:"6px 4px",textAlign:"center",color:"#fbbf24",minWidth:44,fontSize:11}}>NETO<br/>M</th></>:<th style={{padding:"8px 6px",textAlign:"center",color:"#4ade80",minWidth:44}}>{gameMode==="medal"?"TOT":"PTS"}</th>}
                {gameMode==="medal"&&<th style={{padding:"8px 6px",textAlign:"center",color:"#FFD700",minWidth:44}}>NETO</th>}
              </tr>
            </thead>
            <tbody>
              {PLAYERS.map((player,pi)=>{
                const hcp=parseInt(handicaps[player])||0,tot=playerTotal(player),sf=playerSF(player),net=playerNet(player),tm=playerTeam(player);
                const rowBg=pi%2===0?"#0a0f0a":"#0d140d";
                const stickyBg=myPlayer===player?"#052e16":rowBg;
                // Celda nombre — compartida entre filas en ambos
                const nameTd=(<td rowSpan={gameMode==="ambos"?2:1} style={{padding:"8px 10px",fontWeight:"bold",position:"sticky",left:0,background:stickyBg,borderRight:"1px solid #1a2e1a",cursor:"pointer",color:myPlayer===player?"#4ade80":"#e2e8f0",verticalAlign:"middle"}} onClick={()=>s_myPlayer(player)}>
                  <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:16}}>{player}</span>{tm&&<span style={{fontSize:10,background:tm.badgeBg,color:tm.badgeColor,borderRadius:3,padding:"2px 5px"}}>{tm.id}</span>}</div>
                  {(hcp>0||(parseInt(handicapsMedal[player])||0)>0)&&<div style={{fontSize:11,color:"#6b7280",fontWeight:"normal"}}>SF {hcp} / M {parseInt(handicapsMedal[player])||0}</div>}
                </td>);
                // Celdas de hoyo — fila de scores
                const scoreCells=(holes)=>holes.map(hole=>{
                  const s=scores[player]?.[hole],par=PAR[hole-1],pts=s?sfPoints(s,par,hcp,HCP_HOLE[hole-1]):null,isActive=activePlayer===player&&activeHole===hole;
                  const ap=tm?activePlayers(rotation,tm.id,hole):[player];const isResting=tm&&!ap.includes(player);
                  return(<td key={hole} onClick={()=>{if(myPlayer!==player)s_myPlayer(player);handleCell(player,hole);}} style={{padding:"3px 1px",textAlign:"center",cursor:"pointer",background:isActive?"#052e16":"transparent",border:isActive?"1px solid #4ade80":"1px solid transparent"}}>
                    <div style={{color:s?scoreColor(s,par):"#374151",fontWeight:s?"bold":"normal",fontSize:18}}>{s||"·"}</div>
                    {gameMode!=="ambos"&&isSF&&s&&<div style={{fontSize:11,color:pts===0?"#4b5563":pts===1?"#94a3b8":pts===2?"#4ade80":pts===3?"#ff6b35":"#FFD700"}}>{pts}p</div>}
                    {isResting&&s&&<div style={{fontSize:8,color:"#4b5563",lineHeight:1}}>—lag</div>}
                  </td>);
                });
                // Celdas de hoyo — fila de puntos SF (solo en ambos)
                const sfCells=(holes)=>holes.map(hole=>{
                  const s=scores[player]?.[hole],par=PAR[hole-1],pts=s?sfPoints(s,par,hcp,HCP_HOLE[hole-1]):null;
                  return(<td key={"sf"+hole} style={{padding:"2px 1px",textAlign:"center",background:"#060f06",borderTop:"1px solid #0a1a0a"}}>
                    {pts!==null?<div style={{fontSize:11,fontWeight:"bold",color:pts===0?"#4b5563":pts===1?"#94a3b8":pts===2?"#4ade80":pts===3?"#ff6b35":"#FFD700"}}>{pts}p</div>:<div style={{fontSize:11,color:"#1a2e1a"}}>·</div>}
                  </td>);
                });
                const outScore=[1,2,3,4,5,6,7,8,9].reduce((a,h)=>a+(scores[player]?.[h]||0),0);
                const outSF=[1,2,3,4,5,6,7,8,9].reduce((a,h)=>{const s=scores[player]?.[h];return a+(s?sfPoints(s,PAR[h-1],hcp,HCP_HOLE[h-1])||0:0);},0);
                const outPlayed=[1,2,3,4,5,6,7,8,9].filter(h=>scores[player]?.[h]).length;
                const inScore=[10,11,12,13,14,15,16,17,18].reduce((a,h)=>a+(scores[player]?.[h]||0),0);
                const inSF=[10,11,12,13,14,15,16,17,18].reduce((a,h)=>{const s=scores[player]?.[h];return a+(s?sfPoints(s,PAR[h-1],hcp,HCP_HOLE[h-1])||0:0);},0);
                const inPlayed=[10,11,12,13,14,15,16,17,18].filter(h=>scores[player]?.[h]).length;
                if(gameMode==="ambos"){
                  return(<>
                    <tr key={player+"_score"} style={{background:rowBg}}>
                      {nameTd}
                      {scoreCells([1,2,3,4,5,6,7,8,9])}
                      <td style={{textAlign:"center",fontWeight:"bold",padding:"3px",background:"#071a07",borderLeft:"2px solid #166534",borderRight:"2px solid #166534",color:"#e2e8f0",fontSize:15}}>{outPlayed>0?outScore:"—"}</td>
                      {scoreCells([10,11,12,13,14,15,16,17,18])}
                      <td style={{textAlign:"center",fontWeight:"bold",padding:"3px",background:"#071a07",borderLeft:"2px solid #166534",borderRight:"2px solid #166534",color:"#e2e8f0",fontSize:15}}>{inPlayed>0?inScore:"—"}</td>
                      <td style={{textAlign:"center",fontWeight:"bold",padding:"3px",fontSize:14,color:sfc(sf)}}>{holesPlayed(player)>0?sf:"—"}</td>
                      <td style={{textAlign:"center",fontWeight:"bold",padding:"3px",fontSize:16,color:holesPlayed(player)>0?vpc(net):"#374151"}}>{holesPlayed(player)>0?fvp(net):"—"}</td>
                    </tr>
                    <tr key={player+"_sf"} style={{borderBottom:"2px solid #1a2e1a",background:"#060f06"}}>
                      {sfCells([1,2,3,4,5,6,7,8,9])}
                      <td style={{textAlign:"center",fontWeight:"bold",padding:"2px",background:"#071a07",borderLeft:"2px solid #166534",borderRight:"2px solid #166534",color:"#4ade80",fontSize:12}}>{outPlayed>0?`${outSF}p`:"—"}</td>
                      {sfCells([10,11,12,13,14,15,16,17,18])}
                      <td style={{textAlign:"center",fontWeight:"bold",padding:"2px",background:"#071a07",borderLeft:"2px solid #166534",borderRight:"2px solid #166534",color:"#4ade80",fontSize:12}}>{inPlayed>0?`${inSF}p`:"—"}</td>
                      <td colSpan={2} style={{textAlign:"center",fontSize:11,color:"#4ade80",padding:"2px",background:"#060f06"}}>🎯 {holesPlayed(player)>0?`${sf} pts SF`:"—"}</td>
                    </tr>
                  </>);
                }
                return(
                  <tr key={player} style={{borderBottom:"1px solid #0f1a0f",background:rowBg}}>
                    {nameTd}
                    {scoreCells([1,2,3,4,5,6,7,8,9])}
                    <td style={{textAlign:"center",fontWeight:"bold",padding:"4px",background:"#071a07",borderLeft:"2px solid #166534",borderRight:"2px solid #166534",color:"#86efac",fontSize:15}}>{outPlayed>0?(isSF?`${outSF}p`:outScore):"—"}</td>
                    {scoreCells([10,11,12,13,14,15,16,17,18])}
                    <td style={{textAlign:"center",fontWeight:"bold",padding:"4px",background:"#071a07",borderLeft:"2px solid #166534",borderRight:"2px solid #166534",color:"#86efac",fontSize:15}}>{inPlayed>0?(isSF?`${inSF}p`:inScore):"—"}</td>
                    <td style={{textAlign:"center",fontWeight:"bold",padding:"4px",fontSize:16,color:isSF?sfc(sf):"#e2e8f0"}}>{holesPlayed(player)>0?(isSF?sf:tot):"—"}</td>
                    {gameMode==="medal"&&<td style={{textAlign:"center",fontWeight:"bold",padding:"4px",fontSize:16,color:holesPlayed(player)>0?vpc(net):"#374151"}}>{holesPlayed(player)>0?fvp(net):"—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── INPUT BAR ────────────────────────────────────────────────── */}
      {activePlayer&&activeHole&&(
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#ffffff",borderTop:"3px solid #16a34a",padding:"16px 18px",display:"flex",alignItems:"center",gap:12,zIndex:100,boxShadow:"0 -4px 20px rgba(0,0,0,0.3)"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,color:"#374151",fontWeight:"bold"}}>{activePlayer} · Hoyo {activeHole} · Par {PAR[activeHole-1]}{isSF&&(()=>{const hcp=parseInt(handicaps[activePlayer])||0;const extra=strokesOnHole(hcp,HCP_HOLE[activeHole-1]);return extra>0?<span style={{color:"#16a34a"}}> (+{extra})</span>:null;})()}</div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginTop:6}}>
              <input
                type="number" min="1" max="12"
                value={inputVal}
                onChange={e=>s_iv(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&commitScore()}
                autoFocus
                style={{background:"#f9fafb",border:"2px solid #16a34a",borderRadius:10,color:"#111827",fontSize:42,fontWeight:"900",padding:"8px 10px",width:90,outline:"none",textAlign:"center",boxShadow:"inset 0 2px 4px rgba(0,0,0,0.06)"}}
                placeholder={PAR[activeHole-1].toString()}
              />
              {isSF&&inputVal&&(()=>{const hcp=parseInt(handicaps[activePlayer])||0;const pts=sfPoints(parseInt(inputVal),PAR[activeHole-1],hcp,HCP_HOLE[activeHole-1]);const info=sfLabel(pts);return info?(<div style={{textAlign:"center"}}><div style={{fontSize:26,fontWeight:"bold",color:info.color}}>{pts} pts</div><div style={{fontSize:12,color:info.color,fontWeight:"bold"}}>{info.label}</div></div>):null;})()}
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{s_ap(null);s_ah(null);s_iv("");}} style={{padding:"12px 16px",borderRadius:10,border:"2px solid #d1d5db",background:"#f3f4f6",color:"#6b7280",cursor:"pointer",fontSize:16,fontWeight:"bold"}}>✕</button>
            <button onClick={commitScore} style={{padding:"12px 20px",borderRadius:10,border:"none",background:"#16a34a",color:"#fff",cursor:"pointer",fontSize:15,fontWeight:"bold",boxShadow:"0 2px 8px rgba(22,163,74,0.4)"}}>
              {syncing?"...":"Guardar ⛳"}
            </button>
          </div>
        </div>
      )}
      {showRotation&&<RotationModal/>}

      {showResetConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#0f1a0f",border:"2px solid #dc2626",borderRadius:16,padding:24,maxWidth:320,width:"100%",textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:18,fontWeight:"bold",color:"#f87171",marginBottom:8}}>¿Nueva ronda?</div>
            <div style={{fontSize:14,color:"#6b7280",marginBottom:20}}>Se van a borrar todos los scores actuales. Esta acción no se puede deshacer.</div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>s_showResetConfirm(false)} style={{flex:1,padding:"12px",borderRadius:10,border:"1px solid #374151",background:"transparent",color:"#9ca3af",cursor:"pointer",fontSize:14,fontWeight:"bold"}}>Cancelar</button>
              <button onClick={nuevaRonda} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:"bold"}}>{syncing?"Borrando...":"Sí, borrar todo"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
