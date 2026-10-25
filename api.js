/* Connects the ChargeOne UI to the Google Sheets backend. Loaded after index.html's own script. */
if(!st.token)st={phone:"",veh:null,bal:0,h:[]};
let tmpEm="";
async function api(a,d={}){
  const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({a,t:st.token,...d})});
  const j=await r.json();if(j.err)throw new Error(j.err);return j}
function apply(s){st.bal=s.bal;st.veh=s.veh;st.vl=s.vl||[];st.owner=!!s.owner;st.ob=!!s.ob;st.h=s.h;if(s.stations){S.length=0;S.push(...s.stations)}save()}
async function refresh(){if(!st.token)return;
  try{apply(await api("state"));render()}catch(e){if(e.message==="auth"){st={phone:"",veh:null,bal:0,h:[]};save();boot()}}}
function approve(){} // refunds are now approved by the admin, not by a timer

// UI tweaks: wallet-only payments, email box for OTP, Razorpay handles UPI
document.querySelector("input[name=m]").closest(".row").hidden=true;
$("vpa").hidden=true;
if(OTP_CHANNEL==="email")$("ph").insertAdjacentHTML("afterend",'<input type="text" id="em" placeholder="Email (we send your OTP here)" autocapitalize="none">');

// Sign-in
$("b1").onclick=async()=>{const v=$("ph").value.trim(),em=$("em")?$("em").value.trim().toLowerCase():"",m=$("m1");
  m.className="msg no";
  if(!/^[6-9]\d{9}$/.test(v)){m.textContent="Enter a valid 10-digit Indian mobile number.";return}
  if(OTP_CHANNEL==="email"&&!/^\S+@\S+\.\S+$/.test(em)){m.textContent="Enter a valid email address.";return}
  $("b1").disabled=true;m.className="msg";m.textContent="Sending OTP…";
  try{const r=await api("sendOtp",{phone:v,email:em});tmpPh=v;tmpEm=em;step(2);
    $("m2").className="msg";$("m2").textContent=r.dev?"Dev OTP: "+r.dev:"OTP sent via "+r.via+"."}
  catch(e){m.className="msg no";m.textContent=e.message}
  $("b1").disabled=false};
$("b2").onclick=async()=>{const m=$("m2");
  try{const r=await api("verifyOtp",{phone:tmpPh,email:tmpEm,otp:$("otp").value.trim()});
    st.token=r.token;st.phone="+91 "+tmpPh;apply(r.state);boot()}
  catch(e){m.className="msg no";m.textContent=e.message}};
$("b3").onclick=async()=>{const m=$("m3"),pl=$("vpl").value.trim().toUpperCase().replace(/\s/g,""),mk=$("vmk").value.trim(),md=$("vmd").value.trim();
  m.className="msg no";
  if(!mk||!md){m.textContent="Enter your vehicle make and model.";return}
  if(!/^[A-Z]{2}-?\d{1,2}-?[A-Z]{1,3}-?\d{1,4}$/.test(pl)){m.textContent="Enter a valid plate, like KL07AB1234.";return}
  try{apply(await api("saveVehicle",{veh:{id:editId,type:$("vty").value,make:mk,model:md,plate:pl,cn:$("vcn").value,bat:$("vbt").value}}));editId=null;boot()}catch(e){m.textContent=e.message}};

// UPI top-up: pay to the owner's UPI ID, then submit the 12-digit UTR; admin approves
$("tgo").textContent="Pay with UPI app";
$("tgo").insertAdjacentHTML("afterend",'<div id="ub" hidden><img id="uqr" src="qr.png" alt="Scan to pay" style="display:block;width:220px;max-width:100%;margin:10px auto;border-radius:10px;background:#fff" onerror="this.hidden=true"><div class="mu" id="ut" style="margin:8px 0"></div><input type="text" id="utr" inputmode="numeric" maxlength="12" placeholder="12-digit UTR / reference no."><button class="p w" id="usub">I have paid. Submit</button></div>');
$("tgo").onclick=()=>{const a=Math.round(+$("tamt").value),m=$("tmsg");
  if(!(a>=10&&a<=100000)){m.className="msg no";m.textContent="Enter an amount between ₹10 and ₹1,00,000.";return}
  const link="upi://pay?pa="+encodeURIComponent(UPI_ID)+"&pn="+encodeURIComponent(UPI_NAME)+"&am="+a+"&cu=INR&tn="+encodeURIComponent("ChargeOne wallet");
  $("ut").innerHTML="Scan the QR (or pay to UPI ID <b>"+UPI_ID+"</b>) and pay exactly <b>"+inr(a)+"</b>. Then enter the 12-digit reference (UTR) from your payment app.";
  $("ub").hidden=false;m.className="msg";m.textContent="";location.href=link};
$("usub").onclick=async()=>{const m=$("tmsg"),a=Math.round(+$("tamt").value);
  try{apply(await api("topupSubmit",{amount:a,utr:$("utr").value.trim()}));render();$("utr").value="";$("ub").hidden=true;
    m.className="msg ok";m.textContent="Submitted. "+inr(a)+" is added to your wallet once the payment is verified."}
  catch(e){m.className="msg no";m.textContent=e.message}};

// Gift / promo code redeem
$("tmsg").insertAdjacentHTML("afterend",'<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bd,#2a332d)"><div class="mu">Have a gift code?</div><input type="text" id="gc" placeholder="Enter gift code" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"><button class="p w" id="gcb">Redeem</button><div class="msg" id="gcm"></div></div>');
$("gcb").onclick=async()=>{const m=$("gcm"),b=$("gcb"),before=st.bal;b.disabled=true;m.className="msg";m.textContent="Checking…";
  try{apply(await api("redeem",{code:$("gc").value.trim()}));render();$("gc").value="";m.className="msg ok";m.textContent=inr(st.bal-before)+" added to your wallet."}
  catch(e){m.className="msg no";m.textContent=e.message}b.disabled=false};

// Charging: server holds the money, then settles on stop
$("go").onclick=async()=>{const{k}=calc();$("go").disabled=true;$("msg").className="msg";$("msg").textContent="Starting…";
  try{const r=await api("pay",{station:cur.id,kwh:k,vid:st.veh&&st.veh.id});st.bal=r.bal;save();
    ss={s:cur,k,t:r.pre,m:"w",d:0,done:0,sid:r.sid};$("pre").style.display="none";live();ss.iv=setInterval(tick,1000);render()}
  catch(e){$("msg").className="msg no";$("msg").textContent=e.message;$("go").disabled=false}};
async function stop(x=ss){if(!x||x.done)return;clearInterval(x.iv);x.done=1;const me=()=>x===ss;if(me())$("stopb").disabled=true;
  try{const r=await api("settle",{sid:x.sid,kwh:+x.d.toFixed(3)});apply(r.state);render();
    const msg=`Charged ${r.kwh.toFixed(2)} kWh for ${inr(r.cost)}`+(r.unused>.005?`. ${inr(r.unused)} returned to your wallet.`:".");
    if(me()){$("lt").textContent="Charging complete";$("stopb").textContent="Done";$("lmin").hidden=true;$("lmore").hidden=true;$("lmsg").textContent=msg}
    else toast(x.s.n+": "+msg);
    drawSw();setMini();note("Charging complete","Charged "+r.kwh.toFixed(2)+" kWh for "+inr(r.cost),1,x.sid)}
  catch(e){if(me()){$("lmsg").className="msg no";$("lmsg").textContent=e.message}else toast(e.message)}
  if(me())$("stopb").disabled=false}

// Refund requests wait for admin approval
$("hist").onclick=async e=>{const i=e.target.dataset.i;if(i===undefined)return;const h=st.h[i];if(!h||h.r)return;
  try{apply(await api("refundRequest",{id:h.id}));render();toast("Refund requested. It’s credited to your wallet once approved.")}catch(x){toast(x.message)}};

// Multiple vehicles (cars, bikes, scooters...)
const ICON={Car:"🚗",Bike:"🏍️",Scooter:"🛵","Auto-rickshaw":"🛺",Other:"🚙"};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let editId=null;
$("vmk").insertAdjacentHTML("beforebegin",'<select id="vty"><option>Car</option><option>Bike</option><option>Scooter</option><option>Auto-rickshaw</option><option>Other</option></select>');
$("b3").insertAdjacentHTML("afterend",'<button class="w" id="vcc" hidden>Cancel</button>');
$("mveh").previousElementSibling.hidden=true;$("mveh").hidden=true;$("mcn").hidden=true;
$("ev").insertAdjacentHTML("beforebegin",'<div class="mu" style="margin-top:10px">My vehicles</div><div id="vl"></div>');
$("ev").textContent="+ Add another vehicle";
function openVeh(v){editId=v?v.id:null;$("app").hidden=true;$("onb").hidden=false;step(3);
  $("vty").value=v?(v.type||"Car"):"Car";$("vmk").value=v?v.make:"";$("vmd").value=v?v.model:"";$("vpl").value=v?v.plate:"";$("vcn").value=v?v.cn:"CCS2";$("vbt").value=v&&v.bat?v.bat:"";
  $("m3").textContent="";$("vcc").hidden=!st.veh}
$("ev").onclick=()=>openVeh(null);
$("vcc").onclick=()=>{editId=null;boot()};
function drawVeh(){$("vl").innerHTML=(st.vl||[]).map(v=>{const on=st.veh&&st.veh.id===v.id;
  return `<div class="card" style="margin:8px 0 0"><div class="row"><b>${ICON[v.type]||"🚗"} ${esc(v.make)} ${esc(v.model)}</b>${on?'<span class="tag ok">In use</span>':`<button data-vi="use" data-id="${esc(v.id)}">Use</button>`}</div><div class="mu">${esc(v.type||"Car")} · ${esc(v.plate)} · ${esc(v.cn)}${v.bat?" · "+esc(v.bat)+" kWh":""}</div><div class="row" style="margin-top:6px;justify-content:flex-start"><button data-vi="edit" data-id="${esc(v.id)}">Edit</button><button data-vi="del" data-id="${esc(v.id)}">Remove</button></div></div>`}).join("")}
const _render=render;render=function(){_render();drawVeh()};
$("vl").onclick=async ev=>{const b=ev.target.closest("[data-vi]");if(!b)return;const id=b.dataset.id,k=b.dataset.vi;
  try{if(k==="use"){apply(await api("setActive",{id}));render()}
    else if(k==="edit")openVeh(st.vl.find(x=>x.id===id));
    else if(k==="del"&&confirm("Remove this vehicle?")){apply(await api("deleteVehicle",{id}));st.veh?render():boot()}}
  catch(x){toast(x.message)}};
// switch vehicle right on the charging screen
$("pv").insertAdjacentHTML("afterend",'<select id="pvs" hidden></select>');
const pvText=()=>$("pv").textContent=`${st.veh.make} ${st.veh.model} · ${st.veh.plate} · ${st.veh.cn}`;
const _pre=pre;pre=function(s){_pre(s);const L=st.vl||[];if(!$("pre").style.display||$("pre").style.display==="none")return;
  $("pvs").hidden=L.length<2;$("pvs").innerHTML=L.map(v=>`<option value="${esc(v.id)}"${st.veh&&st.veh.id===v.id?" selected":""}>${ICON[v.type]||"🚗"} ${esc(v.make)} ${esc(v.model)} · ${esc(v.plate)}</option>`).join("")};
$("pvs").onchange=async()=>{try{apply(await api("setActive",{id:$("pvs").value}));pvText();calc()}catch(x){toast(x.message)}};

// Owner tools: shown only when the server says this verified account is the owner
$("lo").insertAdjacentHTML("beforebegin",'<div id="own" hidden><div class="mu" style="margin-top:14px">Owner panel</div><div id="ownl"></div><button class="p w" id="ocon">Open owner console</button><div class="mu" style="margin-top:6px">Top-ups, refunds, users and credit, chargers (add/edit/delete), gift codes, ledger.</div></div><div id="obn" class="mu" hidden style="margin-top:10px">Owner tools are off while DEV_MODE is on. Delete DEV_MODE in Apps Script and redeploy to use them.</div>');
async function drawOwn(){$("obn").hidden=!st.ob;if(!st.owner){$("own").hidden=true;return}$("own").hidden=false;
  try{const D=await api("adminData");
    const t=D.topups.map(p=>`<div class="card" style="margin:8px 0 0"><b>₹${esc(p.amt)}</b> top-up · UTR ${esc(p.id)}<div class="mu">${esc(p.uid)}. Match the UTR and amount in your bank app first.</div><div class="row" style="margin-top:6px;justify-content:flex-start"><button class="p" data-oa="top" data-ok="1" data-id="${esc(p.id)}">Approve</button><button data-oa="top" data-ok="0" data-id="${esc(p.id)}">Reject</button></div></div>`).join("");
    const r=D.pending.map(p=>`<div class="card" style="margin:8px 0 0"><b>₹${esc(p.amt)}</b> refund · ${esc(p.n)}<div class="mu">${esc(p.uid)}</div><div class="row" style="margin-top:6px;justify-content:flex-start"><button class="p" data-oa="ref" data-ok="1" data-id="${esc(p.id)}">Approve</button><button data-oa="ref" data-ok="0" data-id="${esc(p.id)}">Reject</button></div></div>`).join("");
    $("ownl").innerHTML=(t||r)?t+r:'<div class="mu">Nothing waiting for approval.</div>'}
  catch(x){$("ownl").textContent=x.message}}
$("ownl").onclick=async ev=>{const b=ev.target.closest("[data-oa]");if(!b)return;b.disabled=true;
  try{await api(b.dataset.oa==="top"?"adminTopup":"adminRefund",{id:b.dataset.id,ok:b.dataset.ok==="1"});toast(b.dataset.ok==="1"?"Approved":"Rejected");await drawOwn()}
  catch(x){toast(x.message);b.disabled=false}};
document.body.insertAdjacentHTML("beforeend",'<div id="oc" hidden style="position:fixed;inset:0;z-index:50;background:var(--bg);display:flex;flex-direction:column"><div class="row" style="padding:10px 14px;padding-top:calc(10px + env(safe-area-inset-top,0px))"><b>Owner console</b><button id="occ">Close</button></div><iframe id="ocf" style="flex:1;border:0;width:100%" title="Owner console"></iframe></div>');
$("ocon").onclick=()=>{$("ocf").src="admin.html?"+Date.now();$("oc").hidden=false};
$("occ").onclick=()=>{$("oc").hidden=true;$("ocf").src="about:blank";refresh();drawOwn()};
const _render2=render;render=function(){_render2();if(!$("v-me").hidden)drawOwn()};
const _go=go;go=function(v){_go(v);if(v==="me")drawOwn()};


// ===== Live activity: progress by clock time, battery %, mini bar, notifications, resume =====
$("vcn").insertAdjacentHTML("afterend",'<input type="number" id="vbt" min="1" max="300" step="0.1" placeholder="Battery size in kWh (optional, shows battery %)">');
$("pvs").insertAdjacentHTML("afterend",'<div id="spw" hidden style="margin-top:10px"><div>Battery level now: <b id="spv">20</b>%</div><input type="range" id="sp" min="0" max="95" value="20"></div>');
$("sp").oninput=()=>$("spv").textContent=$("sp").value;
const _pre2=pre;pre=function(s){_pre2(s);$("spw").hidden=!(st.veh&&+st.veh.bat>0)};
$("ld").insertAdjacentHTML("afterend",'<div id="lbat" style="margin-top:6px;font-weight:600"></div>');
$("stopb").insertAdjacentHTML("beforebegin",'<button class="w" id="lmin">Minimise</button>');
document.body.insertAdjacentHTML("beforeend",'<div id="mini" hidden style="position:fixed;left:12px;right:12px;bottom:calc(70px + env(safe-area-inset-bottom,0px));max-width:456px;margin:0 auto;background:var(--ac);color:var(--acx);border-radius:14px;padding:10px 14px;z-index:25;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)"><div class="row"><b id="mt">⚡ Charging</b><span id="mp"></span></div><div class="bar" style="margin:6px 0 0;background:rgba(255,255,255,.35)"><i id="mb" style="background:#fff"></i></div></div>');
let swr=null;if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").then(r=>swr=r).catch(()=>{});
function askNotify(){try{if("Notification" in window&&Notification.permission==="default")Notification.requestPermission()}catch(e){}}
function note(t,b,done,tag){try{if(swr&&"Notification" in window&&Notification.permission==="granted")swr.showNotification(t,{body:b,tag:tag||"chargeone-live",renotify:!!done,silent:!done})}catch(e){}}
// several vehicles can charge at once: ALL holds every session by id, ss is the one shown on the live screen
const ALL={};const running=()=>Object.values(ALL).filter(x=>!x.done);
function setMini(){$("mini").hidden=!(running().length&&$("live").style.display!=="flex")}
function paint(x=ss){const c=x.d*x.s.p*(1+FEE),pc=x.bat>0?Math.min(100,x.sp+x.d/x.bat*100):null,tx=x.d.toFixed(1)+" kWh · "+inr(c)+(pc==null?"":" · 🔋"+Math.round(pc)+"%");
  if(x===ss){$("ld").textContent=x.d.toFixed(2)+" kWh";$("lb").style.width=(x.d/x.k*100)+"%";$("lc").textContent=inr(c);
    $("lbat").textContent=pc==null?"":"🔋 Battery "+Math.round(x.sp)+"% → "+Math.round(pc)+"%"}
  const r=running();
  if(r.length>1){$("mt").textContent="⚡ "+r.length+" vehicles charging";$("mp").textContent=inr(r.reduce((t,y)=>t+y.d*y.s.p*(1+FEE),0));$("mb").style.width=(r.reduce((t,y)=>t+y.d/y.k,0)/r.length*100)+"%"}
  else{$("mt").textContent="⚡ "+x.s.n;$("mp").textContent=tx;$("mb").style.width=(x.d/x.k*100)+"%"}
  if(document.hidden&&Date.now()-(x.ln||0)>15000){x.ln=Date.now();note("Charging at "+x.s.n,tx,0,x.sid)}}
function tick(x=ss){x.d=Math.min(x.k,x.s.kw/3600*30*(Date.now()-x.t0)/1000); // demo runs 30x real time; clock-based so it catches up after the phone sleeps
  paint(x);if(Date.now()-(x.lp||0)>5000){x.lp=Date.now();api("progress",{sid:x.sid,kwh:+x.d.toFixed(3)}).catch(()=>{})}
  if(x.d>=x.k)stop(x)}
// switcher on the live screen: one button per running vehicle
$("ls").insertAdjacentHTML("beforebegin",'<div id="lsw" class="row" style="justify-content:flex-start;gap:6px;margin-bottom:8px" hidden></div>');
$("lmin").insertAdjacentHTML("afterend",'<button class="w" id="lmore">+ Charge another vehicle</button>');
function drawSw(){const r=running();$("lsw").hidden=!(r.length>1||(r.length===1&&r[0]!==ss));
  $("lsw").innerHTML=r.map(x=>`<button data-sw="${esc(x.sid)}"${x===ss?' class="p"':""}>${esc(x.vp||x.s.n)}</button>`).join("")}
$("lsw").onclick=ev=>{const b=ev.target.closest("[data-sw]");if(!b||!ALL[b.dataset.sw])return;ss=ALL[b.dataset.sw];live()};
const _live=live;live=function(){_live();$("lmin").hidden=false;$("lmore").hidden=false;drawSw();setMini()};
$("lmin").onclick=()=>{$("live").style.display="none";setMini()};
$("lmore").onclick=()=>{$("live").style.display="none";go("home");setMini()};
$("stopb").addEventListener("click",()=>setMini());
$("mini").onclick=()=>{if(!ss||ss.done)ss=running()[0]||ss;live();setMini()};
$("go").onclick=async()=>{const{k}=calc();askNotify();$("go").disabled=true;$("msg").className="msg";$("msg").textContent="Starting…";
  try{const sp=st.veh&&+st.veh.bat>0?+$("sp").value:0,r=await api("pay",{station:cur.id,kwh:k,vid:st.veh&&st.veh.id,sp});st.bal=r.bal;save();
    if(ALL[r.sid])clearInterval(ALL[r.sid].iv);
    const x=ss={s:cur,k,t:r.pre,m:"w",d:0,done:0,sid:r.sid,t0:r.t0||Date.now(),sp,bat:(st.veh&&+st.veh.bat)||0,vp:(st.veh&&st.veh.plate)||""};ALL[x.sid]=x;
    $("pre").style.display="none";live();x.iv=setInterval(()=>tick(x),1000);render()}
  catch(e){$("msg").className="msg no";$("msg").textContent=e.message;$("go").disabled=false}};
// reopen the live screen if a session is still running (page reloaded, another device, phone slept)
const _apply=apply;apply=function(s){_apply(s);(s.sesl||[s.ses]).forEach(q=>resume(q));deep()};
function resume(q){if(!q||ALL[q.sid])return;
  const x={s:{id:q.id,n:q.n,net:q.net,kw:q.kw,p:q.p},k:q.k,t:q.pre,m:"w",d:0,done:0,sid:q.sid,t0:q.t0,sp:q.sp,bat:q.bat,vp:q.vp||""};ALL[x.sid]=x;
  if(!ss||ss.done){ss=x;live()}else{drawSw();setMini()}
  x.iv=setInterval(()=>tick(x),1000);tick(x)}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)running().forEach(x=>tick(x))});

// ===== QR / NFC: a link like https://site/?c=CO-1001 (QR code or NFC tag) opens that charger =====
let pendC="";try{const q=(new URLSearchParams(location.search).get("c")||"").toUpperCase();if(/^CO-\d{4}$/.test(q)){pendC=q;sessionStorage.setItem("co_c",q)}else pendC=sessionStorage.getItem("co_c")||""}catch(e){}
function deep(){if(!pendC||!st.token||!st.veh||!S.length)return;const c=pendC;pendC="";
  try{sessionStorage.removeItem("co_c");history.replaceState(null,"",location.pathname)}catch(e){}
  setTimeout(()=>{go("home");hit(c)},300)}
// read an NFC tag inside the app (Chrome on Android). iPhone opens the app by itself when a tag is tapped.
let nfcAb=null;
if("NDEFReader" in window){$("qb").insertAdjacentHTML("afterend",'<button class="w" id="nfcb">📲 Tap an NFC tag</button>');
  $("nfcb").onclick=async()=>{const m=$("cmsg");
    try{const r=new NDEFReader();if(nfcAb)nfcAb.abort();nfcAb=new AbortController();await r.scan({signal:nfcAb.signal});m.textContent="Hold your phone near the charger’s NFC tag…";
      r.onreading=ev=>{for(const rec of ev.message.records){let t="";try{t=new TextDecoder(rec.encoding||"utf-8").decode(rec.data)}catch(e){}if(hit(t)){nfcAb.abort();nfcAb=null;return}}};
      r.onreadingerror=()=>toast("Couldn’t read that tag. Try again.")}
    catch(e){m.textContent="NFC isn’t available or was blocked. Turn NFC on and allow it."}}}
else $("qb").insertAdjacentHTML("afterend",'<div class="mu" style="margin-top:8px">On iPhone, just tap the phone on the charger’s NFC tag. ChargeOne opens by itself.</div>');
const _go3=go;go=function(v){_go3(v);if(v!=="scan"&&nfcAb){nfcAb.abort();nfcAb=null}};
// ===== iPhone: "Add to Home Screen" popup (iOS has no install prompt, so we show the steps) =====
(function(){const ua=navigator.userAgent||"",ios=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1),
  phone=/iPhone|iPod/i.test(ua),safari=!/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua),
  stand=navigator.standalone===true||(window.matchMedia&&matchMedia("(display-mode: standalone)").matches);
  if(!ios||stand)return;
  try{if(Date.now()<(+localStorage.getItem("co_a2hs")||0))return}catch(e){}
  const sh='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  document.body.insertAdjacentHTML("beforeend",`<div id="a2h" hidden style="position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom,0px));max-width:456px;margin:0 auto;background:var(--card);color:var(--tx);border:1px solid var(--bd);border-radius:16px;padding:14px 16px;z-index:35;box-shadow:0 6px 24px rgba(0,0,0,.28)"><div class="row"><b>⚡ Add ChargeOne to your Home Screen</b><button id="a2hx" aria-label="Close" style="border:0;background:none;font-size:18px;color:var(--mu)">✕</button></div><div class="mu" style="margin:6px 0 8px">Opens like an app, and live charging alerts work.</div><div style="font-size:14px;line-height:1.55">${safari?"":"<b>First open this page in Safari.</b><br>"}1. Tap the Share button ${sh}<br>2. Scroll and tap <b>Add to Home Screen</b><br>3. Tap <b>Add</b>, then open ChargeOne from your Home Screen and sign in once.</div><button class="p w" id="a2hok" style="margin-top:10px">Got it</button><button class="w" id="a2hn" style="border:0;background:none;color:var(--mu);margin-top:2px">Not now</button>${phone&&safari?'<div style="position:absolute;left:50%;bottom:-8px;width:14px;height:14px;margin-left:-7px;background:var(--card);border-right:1px solid var(--bd);border-bottom:1px solid var(--bd);transform:rotate(45deg)"></div>':""}</div>`);
  const close=d=>{$("a2h").hidden=true;try{localStorage.setItem("co_a2hs",String(Date.now()+d*864e5))}catch(e){}};
  $("a2hx").onclick=$("a2hn").onclick=()=>close(7);$("a2hok").onclick=()=>close(30);
  // show once the person is signed in and no sheet is open
  const t=setInterval(()=>{if(!st.token||!st.veh)return;if(["live","pre","tsheet"].some(i=>$(i)&&$(i).style.display==="flex"))return;clearInterval(t);$("a2h").hidden=false},4000)})();
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
setInterval(refresh,30000);
boot();refresh();
