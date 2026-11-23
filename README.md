# Pivlo CRM — Plivo phone integration demo

A working demo of the design in *Plivo phone integration for a sales CRM*: sales reps
make and receive real phone calls from inside the CRM, through the browser, and every
call lands on the lead's timeline automatically.

- **Frontend** — Next.js 15 (App Router, TypeScript, Tailwind v4)
- **Backend** — NestJS 11 (Answer URL, Hangup URL, JWT minting, call logging)

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. The API runs on **http://localhost:4000**.

No Plivo account, phone number or ngrok is needed to run the demo.

## The two modes

| | Simulator mode (default) | Live mode |
|---|---|---|
| Triggered by | no credentials set | `PLIVO_AUTH_ID` + `PLIVO_AUTH_TOKEN` set |
| Call audio | none — the call is acted out | real WebRTC ↔ phone network |
| Answer URL / Hangup URL | **the real handlers**, called with real Plivo payloads | the real handlers, called by Plivo |
| Needs ngrok | no | yes |

The important part: the simulator does **not** reimplement the integration. It stands in
for Plivo's cloud and posts the exact form-encoded payloads Plivo sends into the same
`/plivo/answer` and `/plivo/hangup` routes that production uses. The XML your manager sees
in the Inspector is the XML Plivo would receive.

## Demo script (about 3 minutes)

1. **Register the phone.** Right rail → *Register phone*. The Inspector shows the browser
   asking the backend for a token and the backend minting a short-lived JWT. Point out that
   the Auth Token never leaves the server.
2. **Call a lead.** Hit *Call* on Priya Sharma. Watch the Inspector:
   `plivo.client.call()` → `POST /plivo/answer` → your backend replies with
   `<Dial><Number>` → the carrier rings. Click any row to see the payload.
3. **Talk, then hang up.** The timer runs. On hangup, `POST /plivo/hangup` arrives, the call
   is written to the CRM, and the **disposition popup** appears — pick *Interested*.
4. **Show the result.** Click the lead's name. The drawer has the call in the activity
   timeline with duration, recording URL and your note, and the stage moved to *Qualified*.
5. **Inbound.** Demo controls → *Simulate inbound call*. The backend looks the caller up,
   finds the lead's owner, and replies `<Dial><User>sip:repravi@…` — the rep's browser
   rings with the lead's name and deal value already on screen.
6. **No rep online.** Switch the dropdown to Imran Qureshi (owned by Arjun, who is offline)
   and simulate inbound again. The backend falls back to `<Speak>` + `<Record>` — the lead
   gets voicemail instead of a dead line.

## Testing the calling

Three levels, cheapest first.

### 1. Backend only — no browser, no Plivo

Prove the Answer URL logic with curl. This is exactly what Plivo posts.

In **live** mode these are rejected with `403` because they carry no
`X-Plivo-Signature-V3` — which is the point of that check. To hand-test, set
`PLIVO_VERIFY_WEBHOOKS=false` in `.env` and restart (or use simulator mode).

Use `--data-urlencode`, not `-d`, or the `+` is sent as a space.

```bash
# Rep dials a lead (From starts with sip:) -> expect <Dial><Number>
curl -X POST http://localhost:4000/plivo/answer \
  --data-urlencode "From=sip:repravi@phone.plivo.com" \
  --data-urlencode "To=+919361778524" \
  --data-urlencode "CallUUID=test-1" \
  --data-urlencode "X-PH-LeadId=L-1040"

# Customer dials in -> expect <Dial><User>sip:repravi@phone.plivo.com
curl -X POST http://localhost:4000/plivo/answer \
  --data-urlencode "From=+919876543210" \
  --data-urlencode "To=+918031770725" \
  --data-urlencode "CallUUID=test-2"

# Lead owned by an offline rep -> expect <Speak> + <Record> voicemail
curl -X POST http://localhost:4000/plivo/answer \
  --data-urlencode "From=+919665778899" \
  --data-urlencode "To=+918031770725" \
  --data-urlencode "CallUUID=test-3"

# Call ends -> logged against the lead
curl -X POST http://localhost:4000/plivo/hangup \
  --data-urlencode "CallUUID=test-1" \
  --data-urlencode "Duration=45" \
  --data-urlencode "CallStatus=completed"
```

### 2. Full UI — simulator mode (recommended for the demo)

Set `PLIVO_FORCE_SIMULATOR=true` in `.env` and restart. Every screen, the ring,
the timer, the disposition popup, the timeline and the Inspector all work, with no
network dependency. Nothing can fail in front of your manager.

### 3. Real audio to a real handset

Needs ngrok. See **Going live** below.

## Architecture

```
Browser (Next.js)            NestJS backend              Plivo cloud        Customer
─────────────────            ──────────────              ───────────        ────────
Browser SDK / softphone
  │ GET /api/plivo/token ──▶ mints JWT via Plivo API ──▶ signed JWT
  │ plivo.client.call() ────────────────────────────▶  POST Answer URL
  │                          decides what to do  ◀────────┘
  │                          replies <Dial>…  ─────────▶ dials ──────────▶ rings
  │                                                      POST Hangup URL
  │                          logs call to lead ◀───────────┘
  ▼ disposition popup
```

The rule the whole thing follows: the browser handles audio, the backend makes the
decisions, Plivo connects them to the phone network.

### Answer URL logic

A browser call reaches Plivo as `Direction=inbound`, so direction alone can't tell you who
started the call. The handler checks `From` instead:

- `From` starts with `sip:` → a rep is dialling out → `<Dial><Number>` the customer
- `From` is a phone number → a customer is dialling in → find the lead's owner →
  `<Dial><User>sip:rep_x@phone.plivo.com`
- no owner online → `<Speak>` + `<Record>` (voicemail)

## Going live

The API loads `.env` from the repo root automatically (then `apps/api/.env` if present).
`.env` is gitignored.

1. Put your credentials in `.env` — `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`,
   `PLIVO_PHONE_NUMBER`. See `.env.example`.
2. Expose the backend, because Plivo has to POST to it from the internet.

   Install ngrok once (`winget install --id Ngrok.Ngrok -e --source winget`), then
   **open a new terminal** so it lands on your PATH. ngrok v3 needs a free authtoken:

   ```bash
   # one time: sign up at https://dashboard.ngrok.com/signup, copy your token from
   # https://dashboard.ngrok.com/get-started/your-authtoken
   ngrok config add-authtoken <your-token>

   # every session:
   ngrok http 4000
   ```

   Copy the `https://....ngrok-free.app` line it prints as **Forwarding**. Leave this
   terminal running — closing it kills the tunnel.

3. Provision the Plivo side in one command — creates the Application pointed at your
   Answer/Hangup URLs, creates an Endpoint per rep, links your number, **and writes
   `PUBLIC_BASE_URL` into `.env` for you**:

   ```bash
   npm run plivo:setup -- https://<your-id>.ngrok-free.app
   ```

   It is safe to re-run; it skips what already exists.
   **Why this step is not optional:** Plivo endpoint usernames are globally unique
   across its SIP domain, so Plivo appends a random suffix to whatever you ask for —
   `repravi` is created as `repravi948902173427578560963872`. The real name is only
   knowable after creation, so the script records the mapping in
   `apps/api/plivo-endpoints.json` and the API reads it when minting JWTs. Without
   that file the JWT names an endpoint that does not exist and the browser fails with
   `INVALID_ACCESS_TOKEN`. The file is per-account, so it is gitignored.

4. Restart the API so it reads the new `PUBLIC_BASE_URL` and the endpoint map.
5. The header badge flips to **LIVE PLIVO** and the amber banner disappears. Click
   *Register phone*, then *Call* on the **Vasanth (test line)** lead — your handset rings.
   Use headphones; laptop speaker plus mic will echo.

> A free ngrok URL changes every time you restart ngrok. When it changes, re-run step 3
> with the new URL and restart the API. This is the main reason to demo in simulator mode.

**No-signup alternative:** Cloudflare Tunnel needs no account —
`winget install --id Cloudflare.cloudflared -e` then
`cloudflared tunnel --url http://localhost:4000`. It prints a `https://....trycloudflare.com`
URL you can pass to `npm run plivo:setup` exactly the same way.

If live mode is on but something is still missing (for example `PUBLIC_BASE_URL` is
still `localhost`), the app prints it at startup **and** shows it as a banner at the top
of the page, instead of failing silently.

On a **trial** account you can only call numbers verified under *Sandbox Numbers*. Standard
accounts can dial anything.

## Security notes (already implemented)

- Auth ID and Auth Token stay on the server; the browser only ever gets a ~5 minute JWT.
- Webhooks are authenticated against `X-Plivo-Signature-V3`
  (`base64(HMAC-SHA256(authToken, url + nonce))`, constant-time compared) in live mode.
- Outbound destinations come from CRM lead records, not from free text, which blocks
  premium-number abuse.
- The Answer URL replies immediately with valid XML — Plivo falls back after 3 retries or
  a 60-second timeout.

## Where things are

| Path | What it is |
|---|---|
| `apps/api/src/plivo/plivo.service.ts` | Answer URL logic, Hangup URL logic, JWT minting, signature check |
| `apps/api/src/plivo/plivo.controller.ts` | The two webhook routes and the token route |
| `apps/api/src/crm/crm.service.ts` | Leads, reps, call logs, activity timeline (in-memory — swap for your DB) |
| `apps/api/src/sim/sim.controller.ts` | The simulator that stands in for Plivo's cloud |
| `apps/api/src/events/` | SSE stream powering the live UI and the Inspector |
| `apps/web/src/lib/useSoftphone.ts` | Softphone state machine; branches between SDK and simulator |
| `apps/web/src/components/Inspector.tsx` | The live request/response panel |

## What's demo-only

- Data is in memory and resets when the API restarts — replace `CrmService` with your real
  data layer.
- There is no authentication; `repId` is chosen from a dropdown.
- The simulator is for demos. It is inert in live mode, and `apps/api/src/sim/` can be
  deleted entirely when you integrate this into the real CRM.
