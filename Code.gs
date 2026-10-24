/* ChargeOne backend: Google Apps Script bound to a Google Sheet.
   Secrets live in Script Properties (Project Settings), never in this file. */
const FEE = 0.03;
const P = PropertiesService.getScriptProperties();
const tab = n => SpreadsheetApp.getActive().getSheetByName(n);
const r2 = n => Math.round(n * 100) / 100;
const lid = () => Utilities.getUuid().replace(/-/g, "").slice(0, 12);

/* Run this ONCE from the editor: creates the sheets and a signing secret. */
function setup() {
  const defs = {
    Users: ["id", "phone", "email", "veh", "created"],
    Ledger: ["id", "ts", "uid", "type", "amount", "note", "ref", "status", "r", "meta"],
    Orders: ["order_id", "uid", "amount", "status", "ts"],
    Stations: ["id", "n", "net", "cn", "kw", "p", "a"]
  };
  const ss = SpreadsheetApp.getActive();
  for (const k in defs) { const s = ss.getSheetByName(k) || ss.insertSheet(k); if (s.getLastRow() == 0) s.appendRow(defs[k]); }
  const st = ss.getSheetByName("Stations");
  if (st.getLastRow() == 1) [
    [1, "Lulu Mall Fast Hub, Kochi", "VoltGrid", "CCS2", 60, 18, 1],
    [2, "Edappally Highway Stop", "KeralaCharge", "CCS2", 30, 15, 1],
    [3, "Thrissur Round South", "GreenPulse", "Type 2", 22, 12, 0],
    [4, "Kozhikode Beach Road", "VoltGrid", "CCS2", 120, 21, 1],
    [5, "Technopark Campus, Trivandrum", "GreenPulse", "CCS2", 50, 16, 1],
    [6, "Aluva Metro Parking", "KeralaCharge", "CHAdeMO", 25, 14, 1]
  ].forEach(r => st.appendRow(r));
  if (!P.getProperty("SECRET")) P.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
}

/* ---------- sheet helpers ---------- */
function all(n) { const v = tab(n).getDataRange().getValues(), h = v.shift(); return v.map((r, i) => { const o = { _r: i + 2 }; h.forEach((k, j) => o[k] = r[j]); return o; }); }
function put(n, o) { const s = tab(n), h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; s.appendRow(h.map(k => o[k] === undefined ? "" : o[k])); }
function setCell(n, r, col, val) { const s = tab(n), h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; s.getRange(r, h.indexOf(col) + 1).setValue(val); }

/* ---------- tokens ---------- */
const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, "");
const mac = p => b64(Utilities.computeHmacSha256Signature(p, P.getProperty("SECRET")));
function sign(d) { const p = b64(JSON.stringify(d)); return p + "." + mac(p); }
function check(t) {
  if (!t || t.indexOf(".") < 0) throw "auth";
  const [p, s] = t.split("."); if (mac(p) !== s) throw "auth";
  const d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p + "=".repeat((4 - p.length % 4) % 4))).getDataAsString());
  if (d.e < Date.now()) throw "auth"; return d;
}

/* ---------- web app entry ---------- */
function doGet() { return ContentService.createTextOutput("ChargeOne API is running"); }
function doPost(e) {
  let out;
  const L = LockService.getScriptLock();
  try { L.waitLock(20000); out = route(JSON.parse(e.postData.contents)); }
  catch (x) { out = { err: String((x && x.message) || x) }; }
  finally { try { L.releaseLock(); } catch (_) {} }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route(d) {
  const a = String(d.a);
  if (a === "sendOtp") return sendOtp(d);
  if (a === "verifyOtp") return verifyOtp(d);
  if (a === "adminLogin") return adminLogin(d);
  if (a.indexOf("admin") === 0) { if (!check(d.t).a) throw "auth"; return admin(a, d); }
  const id = check(d.t).p; if (!id) throw "auth";
  const u = all("Users").find(x => String(x.id) === id); if (!u) throw "auth";
  if (a === "state") return state(id);
  if (a === "saveVehicle") {
    const v = d.veh || {};
    if (!/^[A-Z]{2}-?\d{1,2}-?[A-Z]{1,3}-?\d{1,4}$/.test(String(v.plate)) || ["CCS2", "Type 2", "CHAdeMO"].indexOf(v.cn) < 0) throw "Invalid vehicle details";
    setCell("Users", u._r, "veh", JSON.stringify({ make: String(v.make).slice(0, 30), model: String(v.model).slice(0, 30), plate: v.plate, cn: v.cn }));
    return state(id);
  }
  if (a === "createOrder") {
    const amt = Math.round(+d.amount); if (!(amt >= 10 && amt <= 100000)) throw "Invalid amount";
    const o = rz("orders", { amount: amt * 100, currency: "INR", receipt: "w" + lid() });
    put("Orders", { order_id: o.id, uid: id, amount: amt, status: "created", ts: new Date() });
    return { id: o.id, amount: o.amount };
  }
  if (a === "verifyPayment") {
    const o = all("Orders").find(x => x.order_id === d.order_id && String(x.uid) === id); if (!o) throw "Unknown order";
    if (o.status === "paid") return state(id);
    const hex = Utilities.computeHmacSha256Signature(d.order_id + "|" + d.payment_id, P.getProperty("RZP_KEY_SECRET")).map(b => ("0" + (b & 255).toString(16)).slice(-2)).join("");
    if (hex !== d.signature) throw "Payment verification failed";
    setCell("Orders", o._r, "status", "paid");
    put("Ledger", { id: lid(), ts: new Date(), uid: id, type: "topup", amount: +o.amount, note: "Razorpay " + d.payment_id, ref: d.order_id, status: "ok" });
    return state(id);
  }
  if (a === "pay") {
    const k = +d.kwh; if (!(k >= 1 && k <= 100)) throw "Invalid energy amount";
    const s = all("Stations").find(x => +x.id === +d.station); if (!s || !+s.a) throw "Charger unavailable";
    const v = u.veh ? JSON.parse(u.veh) : {}; if (v.cn !== s.cn) throw "Connector mismatch";
    const pre = r2(k * s.p * (1 + FEE)); if (bal(id) < pre) throw "Not enough wallet balance";
    const sid = "S" + lid();
    put("Ledger", { id: sid, ts: new Date(), uid: id, type: "hold", amount: -pre, note: s.n, ref: sid, status: "open", r: 0, meta: JSON.stringify({ n: s.n, net: s.net, k: k, p: +s.p, kwh: 0 }) });
    return { sid: sid, pre: pre, bal: bal(id) };
  }
  if (a === "settle") {
    const h = holdOf(id, d.sid), m = JSON.parse(h.meta), pre = -h.amount;
    if (h.status === "settled") return { kwh: m.kwh, cost: m.cost, unused: r2(pre - m.cost), state: state(id) };
    const kwh = Math.max(0, Math.min(+d.kwh || 0, m.k)), cost = r2(kwh * m.p * (1 + FEE)), un = r2(pre - cost);
    m.kwh = kwh; m.cost = cost;
    setCell("Ledger", h._r, "meta", JSON.stringify(m)); setCell("Ledger", h._r, "status", "settled");
    if (un > 0) put("Ledger", { id: lid(), ts: new Date(), uid: id, type: "release", amount: un, note: m.n, ref: h.id, status: "ok" });
    return { kwh: kwh, cost: cost, unused: un, state: state(id) };
  }
  if (a === "refundRequest") {
    const h = holdOf(id, d.id), m = JSON.parse(h.meta);
    if (h.status !== "settled" || +h.r || !(m.cost > 0)) throw "A refund can’t be requested for this payment";
    setCell("Ledger", h._r, "r", 1); return state(id);
  }
  throw "Unknown action";
}

function holdOf(id, ref) { const h = all("Ledger").find(x => x.id === ref && String(x.uid) === id && x.type === "hold"); if (!h) throw "Session not found"; return h; }
function bal(id) { return r2(all("Ledger").filter(x => String(x.uid) === id).reduce((s, x) => s + (+x.amount), 0)); }
function state(id) {
  const u = all("Users").find(x => String(x.id) === id);
  const h = all("Ledger").filter(x => String(x.uid) === id).reverse().map(x => {
    const m = x.meta ? JSON.parse(x.meta) : {};
    if (x.type === "topup") return { ty: "topup", t: +x.amount };
    if (x.type === "hold") return { ty: "pay", id: x.id, n: m.n, net: m.net, kwh: +(+m.kwh || 0).toFixed(2), t: m.cost != null ? m.cost : -x.amount, m: "w", r: +x.r || 0 };
    if (x.type === "release") return { ty: "refund", n: "Unused balance · " + x.note, t: +x.amount };
    if (x.type === "refund") return { ty: "refund", n: "Refund approved · " + x.note, t: +x.amount };
    return { ty: "refund", n: "Credit · " + x.note, t: +x.amount };
  });
  const stations = all("Stations").map(s => ({ id: +s.id, n: s.n, net: s.net, cn: s.cn, kw: +s.kw, p: +s.p, a: +s.a }));
  return { bal: bal(id), veh: u && u.veh ? JSON.parse(u.veh) : null, h: h, stations: stations };
}

/* ---------- OTP ---------- */
function uid(d) { return P.getProperty("WA_TOKEN") ? String(d.phone) : String(d.email || "").toLowerCase(); }
function sendOtp(d) {
  if (!/^[6-9]\d{9}$/.test(String(d.phone))) throw "Invalid phone number";
  const id = uid(d), wa = !!P.getProperty("WA_TOKEN");
  if (!wa && !/^\S+@\S+\.\S+$/.test(id)) throw "Enter a valid email address";
  const C = CacheService.getScriptCache(), k = "n" + id, n = +(C.get(k) || 0);
  if (n >= 5) throw "Too many OTP requests. Try again in an hour.";
  C.put(k, n + 1, 3600);
  const otp = String(parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 8), 16) % 900000 + 100000);
  C.put("o" + id, otp, 300);
  if (wa) sendWA(String(d.phone), otp);
  else MailApp.sendEmail(id, "Your ChargeOne OTP", "Your OTP is " + otp + ". It expires in 5 minutes.");
  const r = { via: wa ? "WhatsApp" : "email" };
  if (P.getProperty("DEV_MODE") === "1") r.dev = otp; // testing only: turn DEV_MODE off before going live
  return r;
}
function sendWA(ph, otp) {
  const r = UrlFetchApp.fetch("https://graph.facebook.com/v21.0/" + P.getProperty("WA_PHONE_ID") + "/messages", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + P.getProperty("WA_TOKEN") },
    payload: JSON.stringify({ messaging_product: "whatsapp", to: "91" + ph, type: "template", template: {
      name: P.getProperty("WA_TEMPLATE") || "chargeone_otp", language: { code: "en_US" },
      components: [{ type: "body", parameters: [{ type: "text", text: otp }] },
                   { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] }] } })
  });
  if (r.getResponseCode() >= 300) { Logger.log(r.getContentText()); throw "Couldn’t send the WhatsApp message"; }
}
function verifyOtp(d) {
  const id = uid(d), C = CacheService.getScriptCache(), k = "x" + id, n = +(C.get(k) || 0);
  if (n >= 5) throw "Too many wrong attempts. Request a new OTP.";
  const o = C.get("o" + id);
  if (!o || o !== String(d.otp)) { C.put(k, n + 1, 600); throw "Wrong or expired OTP"; }
  C.remove("o" + id); C.remove(k);
  if (!all("Users").find(x => String(x.id) === id)) put("Users", { id: id, phone: String(d.phone), email: String(d.email || ""), veh: "", created: new Date() });
  return { token: sign({ p: id, e: Date.now() + 30 * 864e5 }), state: state(id) };
}

/* ---------- Razorpay ---------- */
function rz(path, body) {
  const r = UrlFetchApp.fetch("https://api.razorpay.com/v1/" + path, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Basic " + Utilities.base64Encode(P.getProperty("RZP_KEY_ID") + ":" + P.getProperty("RZP_KEY_SECRET")) },
    payload: JSON.stringify(body)
  });
  if (r.getResponseCode() >= 300) { Logger.log(r.getContentText()); throw "Payment gateway error"; }
  return JSON.parse(r.getContentText());
}

/* ---------- admin ("master key") ---------- */
function adminLogin(d) {
  const C = CacheService.getScriptCache(), n = +(C.get("al") || 0), pw = P.getProperty("ADMIN_PASS");
  if (n >= 10) throw "Too many attempts. Try again in 15 minutes.";
  if (!pw || String(d.user) !== P.getProperty("ADMIN_USER") || String(d.pass) !== pw) { C.put("al", n + 1, 900); throw "Wrong username or password"; }
  return { token: sign({ a: 1, e: Date.now() + 12 * 36e5 }) };
}
function admin(a, d) {
  if (a === "adminData") {
    const L = all("Ledger");
    const users = all("Users").map(u => ({ id: u.id, phone: String(u.phone), email: u.email, veh: u.veh ? JSON.parse(u.veh) : null, bal: bal(String(u.id)) }));
    const pending = L.filter(x => x.type === "hold" && +x.r === 1).map(x => ({ id: x.id, uid: x.uid, n: JSON.parse(x.meta).n, amt: JSON.parse(x.meta).cost }));
    const ledger = L.slice(-100).reverse().map(x => ({ ts: x.ts, uid: x.uid, type: x.type, amount: x.amount, note: x.note, status: x.status }));
    return { users: users, pending: pending, ledger: ledger, stations: all("Stations").map(s => ({ id: +s.id, n: s.n, net: s.net, cn: s.cn, kw: +s.kw, p: +s.p, a: +s.a })) };
  }
  if (a === "adminRefund") {
    const h = all("Ledger").find(x => x.id === d.id && +x.r === 1); if (!h) throw "Not pending";
    if (d.ok) {
      put("Ledger", { id: lid(), ts: new Date(), uid: h.uid, type: "refund", amount: JSON.parse(h.meta).cost, note: JSON.parse(h.meta).n, ref: h.id, status: "ok" });
      setCell("Ledger", h._r, "r", 2);
    } else setCell("Ledger", h._r, "r", 3);
    return { ok: 1 };
  }
  if (a === "adminStation") {
    const x = d.s, row = all("Stations").find(r => +r.id === +x.id);
    if (row) ["n", "net", "cn", "kw", "p", "a"].forEach(c => setCell("Stations", row._r, c, x[c]));
    else put("Stations", { id: Math.max(0, ...all("Stations").map(r => +r.id)) + 1, n: x.n, net: x.net, cn: x.cn, kw: x.kw, p: x.p, a: x.a });
    return { ok: 1 };
  }
  if (a === "adminAdjust") {
    const amt = +d.amount; if (!(amt > 0)) throw "Enter a positive amount";
    put("Ledger", { id: lid(), ts: new Date(), uid: String(d.uid), type: "adjust", amount: amt, note: String(d.note || "Admin credit").slice(0, 80), status: "ok" });
    return { ok: 1 };
  }
  throw "Unknown action";
}
