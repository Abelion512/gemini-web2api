// Behavioral test for the fail-closed API key gate in cloudflare/worker.js.
// Run: node --test tests/worker-auth.test.mjs   (Node 20+)
//
// The worker module is loaded with `export default` rewritten to a global
// assignment, then its fetch handler is dispatched synthetic /v1 requests
// under three API_KEYS configurations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../cloudflare/worker.js', import.meta.url), 'utf8')
  .replace('export default', 'globalThis.__worker =');
vm.runInThisContext(src, { filename: 'worker.js' });
const worker = globalThis.__worker;

const ctx = { waitUntil() {}, passThroughOnException() {} };
const envWithCookies = {
  // Upstream calls are never reached for 401 paths; for open/whitelist paths
  // /v1/models is answered from the static model list without upstream fetch.
  COOKIES: 'SAPISID=fake; __Secure-1PSID=fake',
};

async function statusFor(path, env, headers = {}) {
  const res = await worker.fetch(new Request(`https://w.example${path}`, { headers }), env, ctx);
  return res.status;
}

test('API_KEYS unset: /v1 fails closed with 401 and setup hint', async () => {
  const res = await worker.fetch(new Request('https://w.example/v1/models'), { ...envWithCookies }, ctx);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(body.error.message, /not configured/);
});

test('API_KEYS=[] (explicit): open mode, /v1 is not 401', async () => {
  const status = await statusFor('/v1/models', { ...envWithCookies, API_KEYS: '[]' });
  assert.notEqual(status, 401);
});

test('API_KEYS with keys: wrong key 401, right key passes, default sk-gemini is NOT valid', async () => {
  const env = { ...envWithCookies, API_KEYS: '["my-real-key"]' };
  assert.equal(await statusFor('/v1/models', env), 401);
  assert.equal(await statusFor('/v1/models', env, { 'x-api-key': 'sk-gemini' }), 401);
  assert.notEqual(await statusFor('/v1/models', env, { 'x-api-key': 'my-real-key' }), 401);
  assert.notEqual(await statusFor('/v1/models', env, { Authorization: 'Bearer my-real-key' }), 401);
});

test('malformed API_KEYS stays fail closed', async () => {
  const env = { ...envWithCookies, API_KEYS: 'not-json' };
  assert.equal(await statusFor('/v1/models', env), 401);
});
