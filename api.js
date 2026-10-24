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
  try{apply(await api("saveVehicle",{veh:{id:editId,type:$("vty").value,make:mk,model:md,plate:pl,cn:$("vcn").value}}));editId=null;boot()}catch(e){m.textContent=e.message}};

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
async function stop(){if(ss.done)return;clearInterval(ss.iv);ss.done=1;$("stopb").disabled=true;
  try{const r=await api("settle",{sid:ss.sid,kwh:+ss.d.toFixed(3)});apply(r.state);render();
    $("lt").textContent="Charging complete";$("stopb").textContent="Done";
    $("lmsg").textContent=`Charged ${r.kwh.toFixed(2)} kWh for ${inr(r.cost)}`+(r.unused>.005?`. ${inr(r.unused)} returned to your wallet.`:".")}
  catch(e){$("lmsg").className="msg no";$("lmsg").textContent=e.message}
  $("stopb").disabled=false}

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
  $("vty").value=v?(v.type||"Car"):"Car";$("vmk").value=v?v.make:"";$("vmd").value=v?v.model:"";$("vpl").value=v?v.plate:"";$("vcn").value=v?v.cn:"CCS2";
  $("m3").textContent="";$("vcc").hidden=!st.veh}
$("ev").onclick=()=>openVeh(null);
$("vcc").onclick=()=>{editId=null;boot()};
function drawVeh(){$("vl").innerHTML=(st.vl||[]).map(v=>{const on=st.veh&&st.veh.id===v.id;
  return `<div class="card" style="margin:8px 0 0"><div class="row"><b>${ICON[v.type]||"🚗"} ${esc(v.make)} ${esc(v.model)}</b>${on?'<span class="tag ok">In use</span>':`<button data-vi="use" data-id="${esc(v.id)}">Use</button>`}</div><div class="mu">${esc(v.type||"Car")} · ${esc(v.plate)} · ${esc(v.cn)}</div><div class="row" style="margin-top:6px;justify-content:flex-start"><button data-vi="edit" data-id="${esc(v.id)}">Edit</button><button data-vi="del" data-id="${esc(v.id)}">Remove</button></div></div>`}).join("")}
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

document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
setInterval(refresh,30000);
boot();refresh();
