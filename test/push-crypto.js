"use strict";

const fs = require("fs");

let passed = 0, failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  PASS " + name);
  } else {
    failed++;
    console.log("  FAIL " + name + (extra ? "  » " + extra : ""));
  }
}

(async () => {
  console.log("VEXORA push-crypto unit");
  const src = fs.readFileSync(__dirname + "/../server/worker.js", "utf8");
  const a = src.indexOf("const PUSH_GONE");
  const b = src.indexOf("/* ================= fin Web Push =================");
  ok("bloque push presente en worker.js", a > 0 && b > a);
  const block = src.slice(a, b);
  const kp = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, true, [ "deriveBits" ]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pubRaw = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey));
  const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const rec = {
    d: jwk.d,
    x: jwk.x,
    y: jwk.y,
    pub: b64u(pubRaw)
  };
  const envStub = {
    DB: {
      prepare: () => ({
        first: async () => ({
          v: JSON.stringify(rec)
        }),
        bind: () => ({
          run: async () => {},
          first: async () => ({
            v: JSON.stringify(rec)
          })
        })
      })
    }
  };
  const sandbox = new Function("crypto", "encTd", "btoa", "atob", block + "\nreturn { pushEncrypt, vapidJwt, b64u2ab, ab2b64u };");
  const lib = sandbox(crypto, new TextEncoder, s => Buffer.from(s, "binary").toString("base64"), s => Buffer.from(s, "base64").toString("binary"));
  const subKp = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, true, [ "deriveBits" ]);
  const subPubB64u = b64u(Buffer.from(await crypto.subtle.exportKey("raw", subKp.publicKey)));
  const authB64u = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const MSG = JSON.stringify({
    title: "Vexora Support",
    body: "You still have an open chat with support",
    url: "/",
    tag: "vexora-chat-7"
  });
  const payload = await lib.pushEncrypt(subPubB64u, authB64u, MSG);
  ok("payload aes128gcm: cabecera 86 bytes (salt16+rs4+idlen1+pub65)", payload.length > 86 + 16 && payload[20] === 65 && payload[18] === 16 && payload[19] === 0);
  async function pushDecrypt(privKp, authU8, p) {
    const salt = p.slice(0, 16);
    const idlen = p[20];
    const asPub = p.slice(21, 21 + idlen);
    const ct = p.slice(21 + idlen);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({
      name: "ECDH",
      public: await crypto.subtle.importKey("raw", asPub, {
        name: "ECDH",
        namedCurve: "P-256"
      }, false, [])
    }, privKp.privateKey, 256));
    const enc = new TextEncoder;
    const cat = (...arrs) => {
      const o = new Uint8Array(arrs.reduce((n, x) => n + x.length, 0));
      let off = 0;
      for (const x of arrs) {
        o.set(x, off);
        off += x.length;
      }
      return o;
    };
    const hkdf = async (salt2, ikm, info, bytes) => {
      const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [ "deriveBits" ]);
      return new Uint8Array(await crypto.subtle.deriveBits({
        name: "HKDF",
        hash: "SHA-256",
        salt: salt2,
        info: info
      }, k, bytes * 8));
    };
    const info = cat(enc.encode("WebPush: info"), new Uint8Array(1), new Uint8Array(await crypto.subtle.exportKey("raw", privKp.publicKey)), asPub);
    const prk = await hkdf(authU8, cat(ecdh, authU8), info, 32);
    const cek = await hkdf(salt, prk, cat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([ 1 ])), 16);
    const nonce = await hkdf(salt, prk, cat(enc.encode("Content-Encoding: nonce"), new Uint8Array([ 1 ])), 12);
    const pt = new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: nonce
    }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [ "decrypt" ]), ct));
    let end = pt.length - 1;
    while (end >= 0 && pt[end] === 0) end--;
    ok("padding del payload con marcador 0x02", pt[end] === 2);
    return (new TextDecoder).decode(pt.slice(0, end));
  }
  const round = await pushDecrypt(subKp, new Uint8Array(Buffer.from(authB64u, "base64")), payload);
  ok("ROUNDTRIP: descifrado == texto original", round === MSG, JSON.stringify(round).slice(0, 80));
  const jwt = await lib.vapidJwt(envStub, "https://push.example.com");
  const parts = jwt.split(".");
  ok("JWT con 3 partes", parts.length === 3);
  const head = JSON.parse(Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  const claims = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  ok("header ES256 + claims aud/exp/sub", head.alg === "ES256" && claims.aud === "https://push.example.com" && claims.exp > Date.now() / 1e3 && /^mailto:/.test(claims.sub));
  const sigRaw = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  ok("firma raw de 64 bytes (r||s)", sigRaw.length === 64);
  const pubJwk = {
    kty: "EC",
    crv: "P-256",
    x: rec.x,
    y: rec.y,
    ext: true
  };
  const verifyKey = await crypto.subtle.importKey("jwk", pubJwk, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, [ "verify" ]);
  const sigOk = await crypto.subtle.verify({
    name: "ECDSA",
    hash: "SHA-256"
  }, verifyKey, sigRaw, (new TextEncoder).encode(parts[0] + "." + parts[1]));
  ok("VAPID: la firma verifica con la pública", sigOk === true);
  const partsBad = parts.slice();
  const claimsObj = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  claimsObj.aud = "https://evil.example";
  const pBad = b64u(Buffer.from(JSON.stringify(claimsObj)));
  const badOk = await crypto.subtle.verify({
    name: "ECDSA",
    hash: "SHA-256"
  }, verifyKey, sigRaw, (new TextEncoder).encode(parts[0] + "." + pBad));
  ok("VAPID: payload alterado NO verifica", badOk === false);
  ok("trigger: chat nuevo → push a agentes", src.indexOf('pushSend(env, "agent", 0, "New rider waiting"') > 0);
  ok("trigger: msg del agente → push al rider", src.indexOf('pushSend(env, "rider", sid, agentName, "New message"') > 0);
  ok("trigger: nudge → push al rider", src.indexOf('"You still have an open chat with support", "/"') > 0);
  ok("endpoints: key/subscribe/unsubscribe", src.indexOf('"/api/push/key"') > 0 && src.indexOf('"/api/push/subscribe"') > 0 && src.indexOf('"/api/push/unsubscribe"') > 0);
  console.log("\n==== PUSH CRYPTO: " + passed + " OK · " + failed + " FAIL ====");
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error("PUSH-CRYPTO CRASH:", e);
  process.exit(2);
});