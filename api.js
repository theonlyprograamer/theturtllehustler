/* Connects the ChargeOne UI to the Google Sheets backend. Loaded after index.html's own script. */
if(!st.token)st={phone:"",veh:null,bal:0,h:[]};
let tmpEm="";
async function api(a,d={}){
  const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({a,t:st.token,...d})});
  const j=await r.json();if(j.err)throw new Error(j.err);return j}
function apply(s){st.bal=s.bal;st.veh=s.veh;st.h=s.h;if(s.stations){S.length=0;S.push(...s.stations)}save()}
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
  try{apply(await api("saveVehicle",{veh:{make:mk,model:md,plate:pl,cn:$("vcn").value}}));boot()}catch(e){m.textContent=e.message}};

// Razorpay top-up
$("tgo").onclick=async()=>{const a=+$("tamt").value,m=$("tmsg"),b=$("tgo");
  if(!(a>=10&&a<=100000)){m.className="msg no";m.textContent="Enter an amount between ₹10 and ₹1,00,000.";return}
  b.disabled=true;m.className="msg";m.textContent="Opening Razorpay…";
  try{const o=await api("createOrder",{amount:a});
    const rz=new Razorpay({key:RAZORPAY_KEY_ID,amount:o.amount,currency:"INR",order_id:o.id,name:"ChargeOne",description:"Wallet top-up",prefill:{contact:st.phone},theme:{color:"#0f9d58"},
      handler:async r=>{m.textContent="Confirming payment…";
        try{apply(await api("verifyPayment",{order_id:r.razorpay_order_id,payment_id:r.razorpay_payment_id,signature:r.razorpay_signature}));render();m.className="msg ok";m.textContent=inr(a)+" added to your wallet."}
        catch(e){m.className="msg no";m.textContent=e.message}b.disabled=false},
      modal:{ondismiss:()=>{b.disabled=false;m.textContent=""}}});
    rz.on("payment.failed",r=>{m.className="msg no";m.textContent="Payment failed: "+r.error.description;b.disabled=false});rz.open()}
  catch(e){m.className="msg no";m.textContent=e.message;b.disabled=false}};

// Charging: server holds the money, then settles on stop
$("go").onclick=async()=>{const{k}=calc();$("go").disabled=true;$("msg").className="msg";$("msg").textContent="Starting…";
  try{const r=await api("pay",{station:cur.id,kwh:k});st.bal=r.bal;save();
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

document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
setInterval(refresh,30000);
boot();refresh();
