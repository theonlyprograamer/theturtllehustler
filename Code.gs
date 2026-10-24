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
    Stations: ["id", "n", "net", "cn", "kw", "p", "a", "pts"],
    Codes: ["code", "amount", "status", "used_by", "used_ts", "for", "limit", "per_user"],
    CodeUsers: ["code", "email", "uses", "max", "last_ts"]
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
  const cs = ss.getSheetByName("Codes");
  if (cs.getLastRow() == 1) cs.appendRow(["MATHEWS_2009+5", 500, "unlimited", "", "", "mathewsmelvinhere@gmail.com"]);
  if (!P.getProperty("SECRET")) P.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
}

/* Run ONCE if you already ran an older setup(): makes MATHEWS_2009+5 unlimited and owner-only. */
function upgradeCodes() {
  const s = tab("Codes"); s.getRange(1, 6).setValue("for");
  const v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]).toUpperCase() === "MATHEWS_2009+5") {
    s.getRange(i + 1, 3).setValue("unlimited"); s.getRange(i + 1, 6).setValue("mathewsmelvinhere@gmail.com"); s.getRange(i + 1, 4, 1, 2).clearContent(); return;
  }
  s.appendRow(["MATHEWS_2009+5", 500, "unlimited", "", "", "mathewsmelvinhere@gmail.com"]);
}

/* Run ONCE: adds the universal code (each account can use it once, up to "limit" accounts in total). */
function addUniversalCode() {
  const s = tab("Codes"); s.getRange(1, 7).setValue("limit"); s.getRange(1, 8).setValue("per_user");
  const v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]) === "#5PDBG") return;
  s.appendRow(["#5PDBG", 500, "universal", "", "", "", 100, 1]);
}

/* Run ONCE: adds the per-user limit system (CodeUsers tab + per_user column). */
function upgradeV6() {
  const ss = SpreadsheetApp.getActive();
  const cu = ss.getSheetByName("CodeUsers") || ss.insertSheet("CodeUsers");
  if (cu.getLastRow() == 0) cu.appendRow(["code", "email", "uses", "max", "last_ts"]);
  const s = tab("Codes"); s.getRange(1, 7).setValue("limit"); s.getRange(1, 8).setValue("per_user");
  const v = s.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (v[i][2] === "universal" && String(v[i][7]) === "") s.getRange(i + 1, 8).setValue(1);
}

/* Owner = the verified account whose id equals OWNER_ID (Script property; default below). Disabled while DEV_MODE=1. */
const OWNER = () => String(P.getProperty("OWNER_ID") || "mathewsmelvinhere@gmail.com").trim().toLowerCase();
const isOwner = id => P.getProperty("DEV_MODE") !== "1" && String(id).toLowerCase() === OWNER();

/* ---------- sheet helpers ---------- */
function all(n) { const v = tab(n).getDataRange().getValues(), h = v.shift(); return v.map((r, i) => { const o = { _r: i + 2 }; h.forEach((k, j) => o[k] = r[j]); return o; }); }
function put(n, o) { const s = tab(n), h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; s.appendRow(h.map(k => o[k] === undefined ? "" : o[k])); }
function setCell(n, r, col, val) { const s = tab(n), h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; s.getRange(r, h.indexOf(col) + 1).setValue(val); }


/* Charger points per station: Stations.pts (default 1). Column is added automatically if missing. */
const STALE_MS = 4 * 36e5; // an unsettled session older than this no longer blocks a charger point
function ensurePts() { const s = tab("Stations"), h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; if (h.indexOf("pts") < 0) s.getRange(1, h.length + 1).setValue("pts"); }
function ptsOf(s) { return Math.max(1, Math.min(50, Math.round(+s.pts || 1))); }
function openAt(name) { const now = Date.now(); return all("Ledger").filter(x => x.type === "hold" && x.status === "open" && (now - new Date(x.ts).getTime()) < STALE_MS && JSON.parse(x.meta || "{}").n === name); }

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
function doGet() { return ContentService.createTextOutput("ChargeOne API is running - version 8 (owner console)"); }
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
  if (a.indexOf("admin") === 0) { const t = check(d.t); if (!(t.a || (t.p && isOwner(t.p)))) throw "auth"; return admin(a, d); }
  const id = check(d.t).p; if (!id) throw "auth";
  const u = all("Users").find(x => String(x.id) === id); if (!u) throw "auth";
  if (a === "state") return state(id);
  if (a === "saveVehicle") {
    const v = d.veh || {}, vv = vget(u), plate = String(v.plate || "").toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z]{2}-?\d{1,2}-?[A-Z]{1,3}-?\d{1,4}$/.test(plate) || CONS.indexOf(v.cn) < 0 || !String(v.make || "").trim() || !String(v.model || "").trim()) throw "Invalid vehicle details";
    const type = VTYPES.indexOf(v.type) < 0 ? "Car" : v.type, rec = { type: type, make: String(v.make).trim().slice(0, 30), model: String(v.model).trim().slice(0, 30), plate: plate, cn: v.cn };
    const cur = v.id ? vv.list.find(x => x.id === v.id) : null;
    if (vv.list.find(x => x.plate === plate && x !== cur)) throw "That number plate is already added";
    if (cur) Object.assign(cur, rec);
    else { if (vv.list.length >= 10) throw "You can add up to 10 vehicles"; rec.id = "v" + lid().slice(0, 6); vv.list.push(rec); vv.act = rec.id; }
    vsave(u, vv); return state(id);
  }
  if (a === "setActive") {
    const vv = vget(u); if (!vv.list.find(x => x.id === d.id)) throw "Vehicle not found";
    vv.act = d.id; vsave(u, vv); return state(id);
  }
  if (a === "deleteVehicle") {
    const vv = vget(u); vv.list = vv.list.filter(x => x.id !== d.id);
    if (!vv.list.find(x => x.id === vv.act)) vv.act = vv.list[0] ? vv.list[0].id : "";
    vsave(u, vv); return state(id);
  }
  if (a === "topupSubmit") {
    const amt = Math.round(+d.amount); if (!(amt >= 10 && amt <= 100000)) throw "Invalid amount";
    const utr = String(d.utr || "").replace(/\s/g, ""); if (!/^\d{12}$/.test(utr)) throw "Enter the 12-digit UPI reference (UTR) from your payment app";
    if (all("Orders").find(x => String(x.order_id) === utr)) throw "This reference was already submitted";
    if (all("Orders").filter(x => String(x.uid) === id && x.status === "pending").length >= 5) throw "Too many pending top-ups. Wait for approval.";
    put("Orders", { order_id: "'" + utr, uid: id, amount: amt, status: "pending", ts: new Date() });
    return state(id);
  }
  if (a === "redeem") {
    const C = CacheService.getScriptCache(), k = "g" + id, n = +(C.get(k) || 0), gn = +(C.get("gall") || 0);
    if (n >= 5) throw "Too many attempts. Try again in an hour.";
    if (gn >= 40) throw "Gift codes are busy right now. Try again in an hour.";
    const raw = String(d.code || "").trim(), code = raw.toUpperCase(), G = all("Codes");
    const bad = () => { C.put(k, n + 1, 3600); C.put("gall", gn + 1, 3600); throw "Invalid or already used code"; };
    // universal codes are case-sensitive; other codes are not
    const g = G.find(x => String(x.code) === raw) || G.find(x => x.status !== "universal" && String(x.code).toUpperCase() === code);
    if (!g) bad();
    if (g.status === "universal") {
      const em = id.toLowerCase(), r = all("CodeUsers").find(x => String(x.code) === String(g.code) && String(x.email).trim().toLowerCase() === em);
      const def = +g.per_user > 0 ? +g.per_user : 1, mx = r && String(r.max) !== "" ? +r.max : def, uses = r ? (+r.uses || 0) : 0;
      if (uses >= mx) throw "You have used this code the maximum number of times";
      if (+g.limit > 0 && all("Ledger").filter(x => x.type === "gift" && String(x.ref) === String(g.code)).length >= +g.limit) bad();
      put("Ledger", { id: lid(), ts: new Date(), uid: id, type: "gift", amount: +g.amount, note: "Gift code", ref: String(g.code), status: "ok" });
      if (r) { setCell("CodeUsers", r._r, "uses", uses + 1); setCell("CodeUsers", r._r, "last_ts", new Date()); if (String(r.max) === "") setCell("CodeUsers", r._r, "max", mx); }
      else put("CodeUsers", { code: String(g.code), email: em, uses: 1, max: mx, last_ts: new Date() });
      setCell("Codes", g._r, "used_by", id); setCell("Codes", g._r, "used_ts", new Date());
      return state(id);
    }
    const unl = g.status === "unlimited", own = String(g["for"] || "").trim().toLowerCase();
    if ((g.status !== "active" && !unl) || (own && own !== id.toLowerCase())) bad();
    if (unl) { setCell("Codes", g._r, "used_by", id); setCell("Codes", g._r, "used_ts", new Date()); }
    else { setCell("Codes", g._r, "status", "used"); setCell("Codes", g._r, "used_by", id); setCell("Codes", g._r, "used_ts", new Date()); }
    put("Ledger", { id: lid(), ts: new Date(), uid: id, type: "gift", amount: +g.amount, note: "Gift code " + code, ref: code, status: "ok" });
    return state(id);
  }
  if (a === "pay") {
    const k = +d.kwh; if (!(k >= 1 && k <= 100)) throw "Invalid energy amount";
    const s = all("Stations").find(x => +x.id === +d.station); if (!s || !+s.a) throw "Charger unavailable";
    const v = vact(vget(u), d.vid) || {}; if (v.cn !== s.cn) throw "Connector mismatch";
    const pre = r2(k * s.p * (1 + FEE)); if (bal(id) < pre) throw "Not enough wallet balance";
    ensurePts(); const s2 = all("Stations").find(x => +x.id === +d.station), np = ptsOf(s2), busy = openAt(s.n), taken = {}; let loose = 0;
    busy.forEach(x => { const q = +JSON.parse(x.meta || "{}").pt; if (q) taken[q] = 1; else loose++; });
    let pt = 0; for (let q = 1; q <= np; q++) if (!taken[q]) { if (loose > 0) { loose--; continue; } pt = q; break; }
    if (!pt) throw "All chargers at this station are in use";
    const sid = "S" + lid();
    put("Ledger", { id: sid, ts: new Date(), uid: id, type: "hold", amount: -pre, note: s.n, ref: sid, status: "open", r: 0, meta: JSON.stringify({ n: s.n, net: s.net, k: k, p: +s.p, kwh: 0, pt: pt }) });
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

/* vehicles: Users.veh holds {list:[{id,type,make,model,plate,cn}], act:"<id>"}; an old single-vehicle value is upgraded on read */
const VTYPES = ["Car", "Bike", "Scooter", "Auto-rickshaw", "Other"], CONS = ["CCS2", "Type 2", "CHAdeMO"];
function vget(u) {
  let o = null; try { o = u && u.veh ? JSON.parse(u.veh) : null; } catch (_) {}
  if (!o) return { list: [], act: "" };
  if (o.list) return { list: o.list, act: o.act || (o.list[0] ? o.list[0].id : "") };
  return { list: [{ id: "v1", type: "Car", make: o.make, model: o.model, plate: o.plate, cn: o.cn }], act: "v1" };
}
function vact(vv, id) { return vv.list.find(x => x.id === (id || vv.act)) || vv.list.find(x => x.id === vv.act) || null; }
function vsave(u, vv) { setCell("Users", u._r, "veh", vv.list.length ? JSON.stringify(vv) : ""); }

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
  const vv = vget(u);
  return { bal: bal(id), veh: vact(vv), vl: vv.list, act: vv.act, owner: isOwner(id), ob: P.getProperty("DEV_MODE") === "1" && String(id).toLowerCase() === OWNER(), h: h, stations: stations };
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
  ensurePts();
  if (a === "adminData") {
    const L = all("Ledger");
    const users = all("Users").map(u => ({ id: u.id, phone: String(u.phone), email: u.email, vl: vget(u).list, bal: bal(String(u.id)) }));
    const pending = L.filter(x => x.type === "hold" && +x.r === 1).map(x => ({ id: x.id, uid: x.uid, n: JSON.parse(x.meta).n, amt: JSON.parse(x.meta).cost }));
    const ledger = L.slice(-100).reverse().map(x => ({ ts: x.ts, uid: x.uid, type: x.type, amount: x.amount, note: x.note, status: x.status }));
    const topups = all("Orders").filter(x => x.status === "pending").map(x => ({ id: String(x.order_id), uid: x.uid, amt: +x.amount, ts: x.ts }));
    const U = {}; all("Users").forEach(u => U[String(u.id)] = u);
    const live = L.filter(x => x.type === "hold" && x.status === "open").map(x => { const m = JSON.parse(x.meta || "{}"), u = U[String(x.uid)] || {}, v = u.id ? (vact(vget(u)) || {}) : {};
      return { id: x.id, ts: x.ts, uid: x.uid, phone: String(u.phone || ""), veh: v.make ? (v.make + " " + v.model + " · " + v.plate) : "", st: m.n, net: m.net, k: m.k, held: -x.amount, pt: +m.pt || 0, stale: (Date.now() - new Date(x.ts).getTime()) >= STALE_MS }; }).reverse();
    const usage = L.filter(x => x.type === "hold").slice(-300).reverse().map(x => { const m = JSON.parse(x.meta || "{}"), u = U[String(x.uid)] || {}, v = u.id ? (vact(vget(u)) || {}) : {};
      return { ts: x.ts, uid: x.uid, phone: String(u.phone || ""), veh: v.make ? (v.make + " " + v.model + " · " + v.plate) : "", st: m.n, net: m.net, kwh: +m.kwh || 0, cost: m.cost != null ? m.cost : -x.amount, open: x.status === "open", pt: +m.pt || 0, stale: x.status === "open" && (Date.now() - new Date(x.ts).getTime()) >= STALE_MS }; });
    return { usage: usage, live: live, users: users, pending: pending, topups: topups, codes: all("Codes").map(x => ({ code: x.code, amount: +x.amount, status: x.status, by: x.used_by, f: x["for"] })), ledger: ledger, stations: all("Stations").map(s => ({ id: +s.id, n: s.n, net: s.net, cn: s.cn, kw: +s.kw, p: +s.p, a: +s.a, pts: ptsOf(s) })) };
  }
  if (a === "adminRefund") {
    const h = all("Ledger").find(x => x.id === d.id && +x.r === 1); if (!h) throw "Not pending";
    if (d.ok) {
      put("Ledger", { id: lid(), ts: new Date(), uid: h.uid, type: "refund", amount: JSON.parse(h.meta).cost, note: JSON.parse(h.meta).n, ref: h.id, status: "ok" });
      setCell("Ledger", h._r, "r", 2);
    } else setCell("Ledger", h._r, "r", 3);
    return { ok: 1 };
  }
  if (a === "adminTopup") {
    const o = all("Orders").find(x => String(x.order_id) === String(d.id) && x.status === "pending"); if (!o) throw "Not pending";
    if (d.ok) {
      put("Ledger", { id: lid(), ts: new Date(), uid: String(o.uid), type: "topup", amount: +o.amount, note: "UPI " + o.order_id, ref: String(o.order_id), status: "ok" });
      setCell("Orders", o._r, "status", "paid");
    } else setCell("Orders", o._r, "status", "rejected");
    return { ok: 1 };
  }
  if (a === "adminCode") {
    const code = String(d.code || "").trim().toUpperCase(), amt = Math.round(+d.amount);
    if (!/^[A-Z0-9_+\-]{4,40}$/.test(code) || !(amt > 0 && amt <= 100000)) throw "Code: 4-40 letters/numbers/_+-, amount 1-100000";
    if (all("Codes").find(x => String(x.code).toUpperCase() === code)) throw "Code already exists";
    put("Codes", { code: code, amount: amt, status: d.unl ? "unlimited" : "active", "for": String(d.for || "").trim().toLowerCase() });
    return { ok: 1 };
  }
  if (a === "adminStation") {
    const x = d.s, row = all("Stations").find(r => +r.id === +x.id);
    x.pts = Math.max(1, Math.min(50, Math.round(+x.pts || 1)));
    if (row) ["n", "net", "cn", "kw", "p", "a", "pts"].forEach(c => setCell("Stations", row._r, c, x[c]));
    else put("Stations", { id: Math.max(0, ...all("Stations").map(r => +r.id)) + 1, n: x.n, net: x.net, cn: x.cn, kw: x.kw, p: x.p, a: x.a, pts: x.pts });
    return { ok: 1 };
  }
  if (a === "adminStationDel") {
    const row = all("Stations").find(r => +r.id === +d.id); if (!row) throw "Charger not found";
    tab("Stations").deleteRow(row._r); return { ok: 1 };
  }
  if (a === "adminAdjust") {
    const amt = +d.amount; if (!(amt > 0)) throw "Enter a positive amount";
    put("Ledger", { id: lid(), ts: new Date(), uid: String(d.uid), type: "adjust", amount: amt, note: String(d.note || "Admin credit").slice(0, 80), status: "ok" });
    return { ok: 1 };
  }
  throw "Unknown action";
}
