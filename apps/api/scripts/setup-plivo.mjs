#!/usr/bin/env node
/**
 * One-time Plivo provisioning for the demo.
 *
 *   node apps/api/scripts/setup-plivo.mjs https://abc123.ngrok-free.app
 *
 * Creates (or updates, if it already exists) an Application pointed at this
 * backend's Answer and Hangup URLs, creates one Endpoint per rep, and links
 * your Plivo number to that Application.
 *
 * Safe to run repeatedly -- it skips anything that already exists.
 * Never prints your Auth Token.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

for (const f of [resolve(repoRoot, '.env'), resolve(repoRoot, 'apps/api/.env')]) {
  if (existsSync(f)) process.loadEnvFile(f);
}

const AUTH_ID = (process.env.PLIVO_AUTH_ID || '').trim();
const AUTH_TOKEN = (process.env.PLIVO_AUTH_TOKEN || '').trim();
const NUMBER = (process.env.PLIVO_PHONE_NUMBER || '').trim().replace(/^\+/, '');
// Plivo constraints, learned the hard way:
//   Application name  -> letters, numbers, "-", "_"   (no spaces)
//   Endpoint username -> alphanumeric ONLY            (no "-" or "_")
const APP_NAME = (process.env.PLIVO_APP_NAME || 'Hyring-Sales-CRM')
  .trim()
  .replace(/[^A-Za-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '');
/**
 * Plivo endpoint usernames are globally unique across its SIP domain, so Plivo
 * appends a random numeric suffix to whatever you ask for: "repravi" comes back
 * as "repravi948902173427578560963872". The real username is therefore only
 * knowable after creation, so we record the mapping and the API reads it.
 */
const REPS = [
  { repId: 'u_ravi', base: 'repravi' },
  { repId: 'u_meera', base: 'repmeera' },
  { repId: 'u_arjun', base: 'reparjun' },
];
const ENDPOINT_MAP_FILE = 'apps/api/plivo-endpoints.json';

const baseUrl = (process.argv[2] || process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');

const die = (msg) => {
  console.error(`\n  ERROR  ${msg}\n`);
  process.exit(1);
};

if (!AUTH_ID || !AUTH_TOKEN) die('PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN missing from .env');

const badReps = REPS.filter((r) => !/^[A-Za-z0-9]+$/.test(r.base));
if (badReps.length) {
  die(
    `Endpoint usernames must be alphanumeric only (no "_" or "-"): ${badReps
      .map((r) => r.base)
      .join(', ')}`,
  );
}
if (!baseUrl) {
  die(
    'No public URL given.\n' +
      '         Run:  ngrok http 4000\n' +
      '         Then: node apps/api/scripts/setup-plivo.mjs https://<your-id>.ngrok-free.app',
  );
}
if (/localhost|127\.0\.0\.1|^http:\/\/192\.168\.|^http:\/\/10\./i.test(baseUrl)) {
  die(`${baseUrl} is not reachable from the internet. Use the https URL from ngrok.`);
}

const API = `https://api.plivo.com/v1/Account/${AUTH_ID}`;
const authHeader = `Basic ${Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString('base64')}`;

async function plivo(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    // Plivo returns `error` as either a string or an object keyed by field.
    const detail =
      typeof data.error === 'string'
        ? data.error
        : JSON.stringify(data.error ?? data, null, 2).slice(0, 600);
    throw new Error(`${method} ${path} -> ${res.status}\n${detail}`);
  }
  return data;
}

const answerUrl = `${baseUrl}/plivo/answer`;
const hangupUrl = `${baseUrl}/plivo/hangup`;

console.log(`\n  Plivo setup`);
console.log(`  Account    : ${AUTH_ID.slice(0, 4)}...${AUTH_ID.slice(-2)}`);
console.log(`  Answer URL : ${answerUrl}`);
console.log(`  Hangup URL : ${hangupUrl}\n`);

// ---------------------------------------------------------------- application
let appId;
const apps = await plivo('GET', '/Application/');
const existingApp = (apps.objects || []).find((a) => a.app_name === APP_NAME);

if (existingApp) {
  appId = existingApp.app_id;
  await plivo('POST', `/Application/${appId}/`, {
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST',
  });
  console.log(`  [=] Application "${APP_NAME}" updated (${appId})`);
} else {
  const created = await plivo('POST', '/Application/', {
    app_name: APP_NAME,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST',
  });
  appId = created.app_id;
  console.log(`  [+] Application "${APP_NAME}" created (${appId})`);
}

// ------------------------------------------------------------------ endpoints
let endpoints = (await plivo('GET', '/Endpoint/')).objects || [];
const endpointMap = {};

for (const { repId, base } of REPS) {
  // Match on prefix, because Plivo appended a suffix when it was created.
  let found = endpoints.find((e) => e.username === base || e.username.startsWith(base));

  if (!found) {
    // Password is required by the API but unused here -- the browser logs in with a JWT.
    await plivo('POST', '/Endpoint/', {
      username: base,
      password: randomBytes(9).toString('hex'),
      alias: `${base}-hyring-demo`,
      app_id: appId,
    });
    // Re-read: the response does not reliably carry the final username.
    endpoints = (await plivo('GET', '/Endpoint/')).objects || [];
    found = endpoints.find((e) => e.username === base || e.username.startsWith(base));
    if (!found) die(`Created endpoint "${base}" but could not read it back.`);
    console.log(`  [+] Endpoint created: ${found.username}`);
  } else {
    console.log(`  [=] Endpoint exists:  ${found.username}`);
  }

  endpointMap[repId] = found.username;

  // Make sure it points at our Application, not whatever it had before.
  const linkedAppId = String(found.application || '').match(/Application\/(\d+)/)?.[1];
  if (linkedAppId !== String(appId)) {
    await plivo('POST', `/Endpoint/${found.endpoint_id}/`, { app_id: appId });
    console.log(`      relinked to ${APP_NAME}`);
  }
}

writeFileSync(
  resolve(repoRoot, ENDPOINT_MAP_FILE),
  JSON.stringify(endpointMap, null, 2) + '\n',
);
console.log(`  [+] Endpoint map written to ${ENDPOINT_MAP_FILE}`);

// --------------------------------------------------------------------- number
if (NUMBER) {
  try {
    await plivo('POST', `/Number/${NUMBER}/`, { app_id: appId });
    console.log(`  [+] Number +${NUMBER} linked to the application`);
  } catch (err) {
    console.log(`  [!] Could not link +${NUMBER}: ${err.message}`);
  }
} else {
  console.log('  [!] PLIVO_PHONE_NUMBER not set - skipped number linking');
}

// ------------------------------------------------- write PUBLIC_BASE_URL back
const envFile = [resolve(repoRoot, 'apps/api/.env'), resolve(repoRoot, '.env')].find((f) =>
  existsSync(f),
);

if (envFile) {
  const original = readFileSync(envFile, 'utf8');
  const line = `PUBLIC_BASE_URL=${baseUrl}`;
  const updated = /^PUBLIC_BASE_URL=.*$/m.test(original)
    ? original.replace(/^PUBLIC_BASE_URL=.*$/m, line)
    : `${original.replace(/\s*$/, '')}\n${line}\n`;

  if (updated === original) {
    console.log(`  [=] PUBLIC_BASE_URL already ${baseUrl}`);
  } else {
    writeFileSync(envFile, updated);
    console.log(`  [+] PUBLIC_BASE_URL set to ${baseUrl} in ${envFile}`);
  }
} else {
  console.log(`  [!] No .env found - set PUBLIC_BASE_URL=${baseUrl} yourself`);
}

console.log(`
  Done. Next:
    1. Restart the API  (Ctrl+C the dev server, then: npm run dev)
    2. Open http://localhost:3000 - the amber banner should be gone
    3. Click "Register phone", then Call the "Vasanth (test line)" lead
`);
