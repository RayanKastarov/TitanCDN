const pages={overview:"Overview",edge:"Edge Network",analytics:"Analytics",jobs:"Scrape Jobs",logs:"Request Logs",api:"API & Webhooks",ai:"Titan AI Console",billing:"Billing & Usage"};
const nav=[...document.querySelectorAll(".nav button")];
const pageTitle=document.getElementById("pageTitle");
const toast=document.getElementById("toast");
let engine=false, timer=null, traffic=0;

function showToast(msg){
  toast.textContent=msg;toast.classList.add("show");
  clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove("show"),2600);
}
nav.forEach(btn=>btn.addEventListener("click",()=>{
  nav.forEach(x=>x.classList.remove("active"));btn.classList.add("active");
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById(btn.dataset.page).classList.add("active");
  pageTitle.textContent=pages[btn.dataset.page];
  document.getElementById("sidebar").classList.remove("open");
}));
document.getElementById("menuBtn").onclick=()=>document.getElementById("sidebar").classList.toggle("open");

const chart=document.getElementById("chart");
for(let i=0;i<30;i++){const b=document.createElement("div");b.className="bar";b.style.height=(18+Math.random()*42)+"%";chart.appendChild(b)}
const bars=[...document.querySelectorAll(".bar")];

function setEngine(on){
  engine=on;
  document.getElementById("engineBtn").classList.toggle("on",on);
  document.getElementById("engineText").textContent=on?"ENGINE ONLINE":"ENGINE OFFLINE";
  document.getElementById("telemetryState").textContent=on?"Live telemetry running":"Engine stopped";
  document.getElementById("scraperStatus").textContent=on?"READY":"STANDBY";
  document.getElementById("scraperStatus").className=on?"green":"";
  if(timer)clearInterval(timer);
  if(on){
    tick();
    timer=setInterval(tick,400);
    showToast("START ENGINE • telemetry online");
  }else{
    document.getElementById("rps").textContent="0";
    document.getElementById("latency").textContent="--";
    showToast("Engine stopped");
  }
}
function tick(){
  const r=Math.floor(3800+Math.random()*801);
  document.getElementById("rps").textContent=r.toLocaleString("en-US");
  document.getElementById("latency").textContent=Math.floor(34+Math.random()*28)+" ms";
  bars.forEach((b,i)=>{if(i<bars.length-1)b.style.height=(12+Math.random()*62)+"%";});
  bars.at(-1).style.height=Math.min(100,48+(r-3800)/800*52)+"%";
  bars.at(-1).classList.add("live");
  traffic+=(r/1000000);
  document.getElementById("traffic").textContent=traffic.toFixed(2)+" TB";
}
document.getElementById("engineBtn").onclick=()=>setEngine(!engine);

document.getElementById("pingBtn").onclick=()=>{
  const btn=document.getElementById("pingBtn");btn.disabled=true;btn.textContent="PINGING...";
  setTimeout(()=>{btn.disabled=false;btn.textContent="PING INFRASTRUCTURE";showToast("Infrastructure response: 28 ms • HEALTHY")},800);
};

document.getElementById("sendBtn").onclick=()=>{
  const url=document.getElementById("targetUrl").value.trim();
  const method=document.getElementById("method").value;
  const format=document.getElementById("format").value;
  const out=document.getElementById("preview");
  if(!url){showToast("Въведи Target URL");return}
  try{new URL(url)}catch{showToast("Невалиден URL");return}
  out.textContent="Connecting to safe demo gateway...";
  document.getElementById("scraperStatus").textContent="RUNNING";
  setTimeout(()=>{
    out.textContent=JSON.stringify({
      status:"DEMO_OK",method,target:url,format,
      timestamp:new Date().toISOString(),
      mode:"safe-local-demo",
      note:"Real target fetching requires a backend with authorization and CORS handling."
    },null,2);
    document.getElementById("scraperStatus").textContent="READY";
    showToast("Request Builder completed");
  },700);
};

const initialNodes=[
 ["Amazon","BLOCKED","US-EAST"],["Walmart","BLOCKED","US-CENTRAL"],["AliExpress","ACTIVE","EU-WEST"],
 ["eBay","ACTIVE","EU-CENTRAL"],["Emag","ACTIVE","EU-EAST"],["Nike","ACTIVE","EU-WEST"],
 ["Shopify","ACTIVE","US-EAST"],["Target","ACTIVE","US-CENTRAL"],["Adidas","ACTIVE","EU-CENTRAL"]
];
let nodes=initialNodes.map(x=>({domain:x[0],status:x[1],route:x[2]}));
function renderNodes(){
  const q=document.getElementById("nodeSearch").value.toLowerCase();
  const list=nodes.filter(n=>n.domain.toLowerCase().includes(q)).sort((a,b)=>{
    if(a.status!==b.status)return a.status==="BLOCKED"?-1:1;
    return a.domain.localeCompare(b.domain);
  });
  document.getElementById("nodes").innerHTML=list.map(n=>`
    <div class="node ${n.status.toLowerCase()}">
      <div><div class="domain">${n.domain}</div><small>node-${n.domain.toLowerCase().replace(/[^a-z]/g,"")}-01</small></div>
      <span class="badge ${n.status.toLowerCase()}">${n.status}</span>
      <span style="font-size:11px;color:#aaa">${n.route}</span>
      <div>${n.status==="BLOCKED"?`<button class="btn danger heal" data-domain="${n.domain}">HEAL NODE</button>`:`<span style="font-size:11px;color:#666">STABLE</span>`}</div>
    </div>`).join("");
  const blocked=nodes.filter(n=>n.status==="BLOCKED").length;
  document.getElementById("nodeCount").textContent=list.length+" visible nodes";
  document.getElementById("nodeHealthy").textContent=(nodes.length-blocked)+" healthy • "+blocked+" blocked";
  document.getElementById("globalStatus").innerHTML=blocked?'<span class="status-dot" style="background:var(--red);box-shadow:0 0 9px var(--red)"></span>'+blocked+" NODE ALERT":'<span class="status-dot"></span>ALL SYSTEMS NOMINAL';
  document.querySelectorAll(".heal").forEach(b=>b.onclick=()=>healNode(b.dataset.domain));
}
function healNode(domain){
  const n=nodes.find(x=>x.domain===domain);if(!n)return;
  n.status="ACTIVE";
  n.route=["EU-WEST","EU-CENTRAL","US-EAST","US-CENTRAL"].sort(()=>Math.random()-.5)[0];
  renderNodes();showToast(domain+" node restored in demo control plane");
}
document.getElementById("nodeSearch").oninput=renderNodes;
document.getElementById("resetNodes").onclick=()=>{nodes=initialNodes.map(x=>({domain:x[0],status:x[1],route:x[2]}));renderNodes();showToast("Demo nodes reset")};
renderNodes();

const modal=document.getElementById("modal");
document.querySelectorAll(".buy").forEach(btn=>btn.onclick=()=>{
  document.getElementById("modalTitle").textContent=btn.dataset.plan;
  document.getElementById("modalText").textContent="Demo checkout: този бутон е готов за свързване към Stripe Checkout през защитен backend. Не въвеждай реални данни в този локален demo.";
  modal.classList.add("show");
});
document.getElementById("modalClose").onclick=()=>modal.classList.remove("show");
document.getElementById("modalAction").onclick=()=>{modal.classList.remove("show");showToast("Demo checkout selected — Stripe backend required")};
modal.onclick=e=>{if(e.target===modal)modal.classList.remove("show")};

// Real authentication through the TitanCDN backend.
const authModal=document.getElementById("authModal"), profileModal=document.getElementById("profileModal");
let authMode="signup", currentUser=null;
const getToken=()=>sessionStorage.getItem("titanJwt");
const authHeaders=()=>({"Content-Type":"application/json",...(getToken()?{"Authorization":"Bearer "+getToken()}:{})});
async function api(path,options={}){const r=await fetch(path,{...options,headers:{...authHeaders(),...(options.headers||{})}});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data}
function openAuth(mode="signup"){authMode=mode;authModal.classList.add("show");syncAuthTabs()}
function syncAuthTabs(){const up=authMode==="signup";document.getElementById("signupTab").classList.toggle("primary",up);document.getElementById("signinTab").classList.toggle("primary",!up);document.getElementById("authTitle").textContent=up?"Create TitanCDN account":"Sign in to TitanCDN";document.getElementById("authSubmit").textContent=up?"CREATE ACCOUNT":"SIGN IN";document.getElementById("authName").style.display=up?"block":"none";document.getElementById("authCompany").style.display=up?"block":"none"}
function renderUser(user){currentUser={name:user.username||user.name||"Titan User",company:"",email:user.email};document.getElementById("authBtn").hidden=true;document.getElementById("profileBtn").hidden=false;document.getElementById("profileName").textContent=currentUser.name;document.getElementById("avatar").textContent=currentUser.name[0].toUpperCase()}
function renderSignedOut(){currentUser=null;document.getElementById("profileBtn").hidden=true;document.getElementById("authBtn").hidden=false}
document.getElementById("authBtn").onclick=()=>openAuth("signup");
document.getElementById("signupTab").onclick=()=>{authMode="signup";syncAuthTabs()};
document.getElementById("signinTab").onclick=()=>{authMode="signin";syncAuthTabs()};
authModal.onclick=e=>{if(e.target===authModal)authModal.classList.remove("show")};profileModal.onclick=e=>{if(e.target===profileModal)profileModal.classList.remove("show")};
document.getElementById("authSubmit").onclick=async()=>{const username=document.getElementById("authName").value.trim(),email=document.getElementById("authEmail").value.trim(),password=document.getElementById("authPassword").value;try{if(!email||!password)throw new Error("Email and password are required");if(authMode==="signup"){if(!document.getElementById("terms").checked)throw new Error("Accept Terms and Privacy Policy");await api("/api/auth/register",{method:"POST",body:JSON.stringify({username:username||email.split("@")[0],email,password})});authMode="signin";syncAuthTabs();showToast("Account created — now sign in");return}const data=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})});sessionStorage.setItem("titanJwt",data.token);renderUser(data.user);authModal.classList.remove("show");showToast("Signed in securely");await loadKeys()}catch(e){showToast(e.message)}};
document.getElementById("profileBtn").onclick=()=>{if(!currentUser)return;document.getElementById("pName").value=currentUser.name;document.getElementById("pCompany").value=currentUser.company||"";document.getElementById("pEmail").value=currentUser.email;profileModal.classList.add("show")};
document.getElementById("saveProfile").onclick=()=>{showToast("Profile editing endpoint is not enabled yet")};
document.getElementById("logoutBtn").onclick=()=>{sessionStorage.removeItem("titanJwt");sessionStorage.removeItem("titanApiKey");profileModal.classList.remove("show");renderSignedOut();document.getElementById("apiKey").value="titan_live_••••••••••••••••••••••••";showToast("Signed out")};
async function restoreSession(){if(!getToken())return;try{const data=await api("/api/profile");renderUser(data.user);await loadKeys()}catch{sessionStorage.removeItem("titanJwt");renderSignedOut()}}

let secretVisible=false;
async function loadKeys(){if(!getToken())return;try{const data=await api("/api/keys");const active=(data.keys||[]).find(k=>!k.revokedAt);if(active&&!sessionStorage.getItem("titanApiKey"))document.getElementById("apiKey").value=active.prefix+"••••••••••••"}catch(e){showToast(e.message)}}
document.getElementById("revealKey").onclick=()=>{const raw=sessionStorage.getItem("titanApiKey");if(!raw){showToast("Full keys are shown only once when created");return}secretVisible=!secretVisible;document.getElementById("apiKey").value=secretVisible?raw:raw.slice(0,22)+"••••••••••••";document.getElementById("revealKey").textContent=secretVisible?"HIDE":"REVEAL"};
document.getElementById("rotateKey").onclick=async()=>{try{if(!getToken())throw new Error("Sign in first");const data=await api("/api/keys",{method:"POST",body:JSON.stringify({name:"Dashboard Key"})});sessionStorage.setItem("titanApiKey",data.key.value);secretVisible=true;document.getElementById("apiKey").value=data.key.value;document.getElementById("revealKey").textContent="HIDE";showToast("New API key created — copy it now") }catch(e){showToast(e.message)}};
document.getElementById("createJob").onclick=()=>showToast("Job UI ready — connect POST /api/v1/jobs");
document.getElementById("askAi").onclick=()=>{const q=document.getElementById("aiInput").value.trim();if(!q)return;document.getElementById("aiOut").textContent="Demo analysis: connect this console to your backend observability/LLM endpoint. Query: "+q};
const stream=document.getElementById("liveStream");function addEvent(){const codes=[200,200,200,201,429],domains=["example.com","docs.example","store.example","catalog.example"];const c=codes[Math.floor(Math.random()*codes.length)],d=domains[Math.floor(Math.random()*domains.length)];const el=document.createElement("div");el.className="event";el.innerHTML=`<span>${new Date().toLocaleTimeString()}</span><b class="${c<300?'green':'red'}">${c}</b><span>${d}</span><span>${Math.floor(60+Math.random()*500)}ms</span>`;stream.prepend(el);while(stream.children.length>18)stream.lastChild.remove()};setInterval(addEvent,1100);for(let i=0;i<8;i++)addEvent();
// TAB toggles panoramic sidebar mode, except while typing.
document.addEventListener("keydown",e=>{if(e.key==="Tab"&&!/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)){e.preventDefault();document.getElementById("sidebar").classList.toggle("open");document.body.classList.toggle("panoramic")}});

const domainChannels=["amazon.com","emag.bg","aliexpress.com","ebay.com","shopify.com","nike.com","adidas.com","walmart.com","target.com","github.com","wikipedia.org","example.com"].map((domain,i)=>({domain,id:"chn_"+(Math.random().toString(36).slice(2,10)),region:["EU-WEST","EU-CENTRAL","US-EAST","AP-SOUTHEAST"][i%4],mode:i%3===1?"API":"WEB",status:"READY"}));
function cleanDomain(v){try{let x=v.trim();if(!/^https?:\/\//i.test(x))x="https://"+x;return new URL(x).hostname.toLowerCase().replace(/^www\./,"")}catch{return null}}
function renderRegistry(){const root=document.getElementById("registryList");if(!root)return;const q=(document.getElementById("registrySearch")?.value||"").toLowerCase();const arr=domainChannels.filter(x=>(x.domain+x.id+x.region).toLowerCase().includes(q));document.getElementById("registryCount").textContent=domainChannels.length.toLocaleString();root.innerHTML=arr.map(x=>`<div class="registry-item"><div><b>${x.domain}</b><div class="channel-id">${x.id}</div></div><span class="badge active">${x.status}</span><span>${x.region}</span><span>${x.mode}</span><button class="btn inspect-channel" data-domain="${x.domain}">INSPECT</button></div>`).join("")||'<div class="sub">No matching channels.</div>'}
document.getElementById("registrySearch")?.addEventListener("input",renderRegistry);document.getElementById("addDomain")?.addEventListener("click",()=>{const input=document.getElementById("newDomain"),d=cleanDomain(input.value);if(!d){showToast("Enter a valid public hostname");return}if(domainChannels.some(x=>x.domain===d)){showToast("Domain channel already exists");return}domainChannels.unshift({domain:d,id:"chn_"+crypto.getRandomValues(new Uint32Array(1))[0].toString(36),region:"AUTO",mode:"WEB",status:"READY"});input.value="";renderRegistry();showToast("Domain channel created locally • connect backend to persist")});document.getElementById("exportRegistry")?.addEventListener("click",()=>{const blob=new Blob([JSON.stringify(domainChannels,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="titancdn-domain-registry.json";a.click();URL.revokeObjectURL(a.href)});renderRegistry();
restoreSession();
document.getElementById("registryList")?.addEventListener("click",e=>{const b=e.target.closest(".inspect-channel");if(b)showToast("Channel inspector: "+b.dataset.domain)});
