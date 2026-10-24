# ChargeOne: universal EV charging wallet

Frontend (GitHub Pages) + Google Sheet backend (Apps Script) + Razorpay + OTP.

Files: `index.html` app · `admin.html` admin panel · `api.js` + `config.js` frontend wiring · `Code.gs` backend.

## 1. Backend (Google Sheet + Apps Script)
1. Create a new Google Sheet. Open **Extensions → Apps Script**, paste all of `Code.gs`, save.
2. Select the `setup` function and click **Run** (approve permissions). It creates the tabs: Users, Ledger, Orders, Stations.
3. **Project Settings → Script properties**, add:
   - `ADMIN_USER` = your admin username
   - `ADMIN_PASS` = a long password (this is your master key; never put it in GitHub)
   - `RZP_KEY_ID`, `RZP_KEY_SECRET` = from Razorpay dashboard (use **Test mode** first)
   - `DEV_MODE` = `1` while testing (shows the OTP on screen). **Delete it before going live.**
4. **Deploy → New deployment → Web app**. Execute as: *Me*. Who has access: *Anyone*. Copy the Web app URL.
   After any code change: Deploy → Manage deployments → edit → New version.

## 2. Frontend (GitHub Pages)
1. Edit `config.js`: paste the Web app URL and your Razorpay **key id**.
2. Create a GitHub repo, upload `index.html`, `admin.html`, `api.js`, `config.js` (not `Code.gs`, not README secrets).
3. Settings → Pages → deploy from `main` branch, root. Open `https://<you>.github.io/<repo>/`. Admin is `/admin.html`.

## 3. OTP
- **Free (default):** email OTP via your Gmail (Apps Script `MailApp`, daily quota applies). Accounts are keyed by the verified email; the phone number is stored but not verified.
- **WhatsApp:** Meta WhatsApp Cloud API. Create an *authentication* template, then add Script properties `WA_TOKEN`, `WA_PHONE_ID`, `WA_TEMPLATE`, and set `OTP_CHANNEL="whatsapp"` in `config.js`. Accounts are then keyed by the verified phone. Meta charges roughly ₹0.115 per delivered authentication message in India (plus any provider fees and GST), so it isn’t free in production.

## 4. Razorpay
Use `rzp_test_` keys until everything works. Payments are verified on the server with Razorpay’s signature before the wallet is credited. Recommended later: add a Razorpay webhook so a closed browser tab can’t lose a paid top-up.

## Admin (master key)
Open `/admin.html` and log in with `ADMIN_USER` / `ADMIN_PASS`: approve or reject refunds, add wallet credit, edit stations and prices, view the ledger. You can also edit the Google Sheet directly.

## Before real money
- Charger energy is reported by the app in this version. Real use needs the charger network’s API (OCPP/OCPI) to confirm kWh delivered.
- Holding customer money in a wallet needs an RBI PPI licence or a licensed partner.
- Sessions left open (tab closed mid-charge) stay as holds in the Ledger until settled.
