/**
 * Greenhouse: Mutations — push notification scheduler.
 *
 * Deploy this as a Cloudflare Worker (paste into the dashboard's editor, no
 * build step or npm dependencies needed — it only uses the standard
 * Web Crypto API, which Workers implements natively).
 *
 * Bindings required (set these up in the Worker's Settings tab):
 *   - KV namespace binding named SCHED
 *   - Secret text variable VAPID_PRIVATE_JWK  (the private key JWK JSON, as a string)
 *   - Secret text variable VAPID_PUBLIC_KEY   (the base64url raw public key)
 *   - Secret text variable VAPID_SUBJECT      (e.g. "mailto:you@example.com")
 *
 * Cron Trigger required: every 1 minute ( * * * * * )
 *
 * Routes:
 *   POST /schedule  { subscription, fireAt }  -> stores a one-shot job in KV
 *
 * This sends push messages with NO payload (an empty push). The service
 * worker shows a fixed, generic notification when it receives one. That
 * keeps this file free of the RFC 8291 payload-encryption code (ECDH +
 * HKDF + AES-128-GCM), which is real complexity that isn't needed for a
 * single "something finished" ping. If per-message custom text is wanted
 * later, that's a self-contained follow-up to this file.
 */

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const str = atob(b64 + pad);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textToB64url(text) {
  return bytesToB64url(new TextEncoder().encode(text));
}

async function buildVapidAuthHeader(endpoint, env) {
  const origin = new URL(endpoint).origin;
  const privateJwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT
  };
  const unsigned = textToB64url(JSON.stringify(header)) + '.' + textToB64url(JSON.stringify(payload));
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + bytesToB64url(new Uint8Array(sigBuf));
  return 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC_KEY;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

async function handleSchedule(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('Bad JSON', { status: 400, headers: corsHeaders() });
  }
  const { subscription, fireAt } = body || {};
  if (!subscription || !subscription.endpoint || typeof fireAt !== 'number') {
    return new Response('Missing subscription or fireAt', { status: 400, headers: corsHeaders() });
  }
  const key = 'job:' + subscription.endpoint;
  const ttlSeconds = Math.max(60, Math.round((fireAt - Date.now()) / 1000) + 3600);
  await env.SCHED.put(key, JSON.stringify({ subscription, fireAt }), { expirationTtl: ttlSeconds });
  return new Response('ok', { status: 200, headers: corsHeaders() });
}

async function sendEmptyPush(subscription, env) {
  const auth = await buildVapidAuthHeader(subscription.endpoint, env);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: '2419200',
      Authorization: auth
    }
  });
}

async function runScheduledSweep(env) {
  const now = Date.now();
  let cursor;
  do {
    const listed = await env.SCHED.list({ prefix: 'job:', cursor });
    for (const entry of listed.keys) {
      const raw = await env.SCHED.get(entry.name);
      if (!raw) continue;
      const job = JSON.parse(raw);
      if (job.fireAt <= now) {
        try {
          await sendEmptyPush(job.subscription, env);
        } catch (e) {
          // subscription likely gone (410) or malformed; drop it either way
        }
        await env.SCHED.delete(entry.name);
      }
    }
    cursor = listed.cursor;
  } while (cursor);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method === 'POST' && url.pathname === '/schedule') {
      return handleSchedule(request, env);
    }
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledSweep(env));
  }
};
