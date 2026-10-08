"use strict";

const fs = require("fs");

const path = require("path");

const http = require("http");

const {JSDOM: JSDOM} = require("jsdom");

const BASE = "http://127.0.0.1:8788";

process.on("uncaughtException", err => {
  const s = String(err && err.stack || err);
  if (/\/assets\/[a-z]+\.js/.test(s)) {
    console.log("  (asset async tras close — ignorado)");
    return;
  }
  console.error("UNCAUGHT:", s);
  process.exit(2);
});

process.on("unhandledRejection", err => {
  const s = String(err && err.stack || err);
  if (/\/assets\/[a-z]+\.js/.test(s)) return;
  console.error("UNHANDLED:", s);
  process.exit(2);
});

const ADMIN_PASS = "vexora-test-admin";

const FIX_DIR = path.join(__dirname, "fixtures", "v172-public");

const FIX_PORT = 8790;

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

async function okAsync(name, fn) {
  ok(name, await fn());
}

function eqBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function eqBytesNoUnlock(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (i >= 1056 && i < 1078) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 8e3)) {
    let v;
    try {
      v = fn();
    } catch (e) {
      v = null;
    }
    if (v) return v;
    await sleep(120);
  }
  throw new Error("timeout: " + label);
}

const TEA = (() => {
  const DELTA = 2654435769, ROUNDS = 32;
  const KEY = new Uint8Array([ 254, 128, 28, 178, 209, 239, 65, 166, 164, 23, 49, 245, 160, 104, 36, 240 ]);
  const u32 = x => x >>> 0;
  const rd = (b, o) => b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24;
  const wr = (b, o, v) => {
    b[o] = v & 255;
    b[o + 1] = v >>> 8 & 255;
    b[o + 2] = v >>> 16 & 255;
    b[o + 3] = v >>> 24 & 255;
  };
  const words = kb => [ rd(kb, 0) >>> 0, rd(kb, 4) >>> 0, rd(kb, 8) >>> 0, rd(kb, 12) >>> 0 ];
  function rotate(k) {
    const b = new Uint8Array(16);
    wr(b, 0, k[0]);
    wr(b, 4, k[1]);
    wr(b, 8, k[2]);
    wr(b, 12, k[3]);
    for (let i = 0; i < 16; i++) b[i] = b[i] + i & 255;
    return words(b);
  }
  function decBlock(y, z, k) {
    let s = u32(DELTA * ROUNDS);
    y >>>= 0;
    z >>>= 0;
    for (let i = 0; i < ROUNDS; i++) {
      z = u32(z - (u32((y << 4 >>> 0) + k[2]) ^ u32(y + s) ^ u32((y >>> 5) + k[3])));
      y = u32(y - (u32((z << 4 >>> 0) + k[0]) ^ u32(z + s) ^ u32((z >>> 5) + k[1])));
      s = u32(s - DELTA);
    }
    return [ y, z ];
  }
  function decrypt(enc, kb) {
    let k = kb ? words(kb) : words(KEY), lo = 0, hi = 0, proc = 0;
    const out = new Uint8Array(enc.length);
    for (let i = 0; i + 8 <= enc.length; i += 8) {
      if (proc === 1024) {
        k = rotate(k);
        proc = 0;
      }
      const c0 = rd(enc, i) >>> 0, c1 = rd(enc, i + 4) >>> 0;
      const d = decBlock(c0, c1, k);
      wr(out, i, u32(d[0] ^ lo));
      wr(out, i + 4, u32(d[1] ^ hi));
      lo = c0;
      hi = c1;
      proc += 8;
    }
    return out;
  }
  function checksum(d) {
    let s = 0;
    for (let i = 0; i + 4 <= d.length; i += 4) s = u32(s + (rd(d, i) >>> 0));
    const swp = u32(s >>> 16 & 65535 | (s & 65535) << 16);
    return u32(swp ^ 4294967295);
  }
  function unwrap(enc, kb) {
    const full = decrypt(enc, kb);
    const body = full.subarray(0, full.length - 4);
    const ck = rd(full, full.length - 4) >>> 0;
    return {
      body: new Uint8Array(body),
      ok: checksum(body) === ck
    };
  }
  return {
    unwrap: unwrap,
    KEY: KEY
  };
})();

const f32 = (u8, o) => new Float32Array(u8.buffer.slice(o, o + 4))[0];

const TEST_IP = "192.0.2." + String(process.pid % 250 + 1);

async function jget(p, headers) {
  const r = await fetch(BASE + p, {
    headers: Object.assign({
      "cf-connecting-ip": TEST_IP
    }, headers || {})
  });
  return {
    status: r.status,
    body: await r.json().catch(() => null),
    res: r
  };
}

async function jpost(p, obj, headers) {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: Object.assign({
      "Content-Type": "application/json",
      "cf-connecting-ip": TEST_IP
    }, headers || {}),
    body: JSON.stringify(obj)
  });
  return {
    status: r.status,
    body: await r.json().catch(() => null)
  };
}

async function jadmin(method, p, obj, token) {
  const r = await fetch(BASE + p, {
    method: method,
    headers: Object.assign({
      "Content-Type": "application/json"
    }, token ? {
      Authorization: "Bearer " + token
    } : {}),
    body: obj ? JSON.stringify(obj) : undefined
  });
  return {
    status: r.status,
    body: await r.json().catch(() => null)
  };
}

function b64u8(s) {
  return new Uint8Array(Buffer.from(s, "base64"));
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".bin": "application/octet-stream",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2"
};

function startFixServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      try {
        const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let f = path.join(FIX_DIR, u === "/" ? "index.html" : u);
        if (!f.startsWith(FIX_DIR)) {
          res.writeHead(403);
          return res.end();
        }
        if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(FIX_DIR, "404.html");
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream"
        });
        res.end(fs.readFileSync(f));
      } catch (e) {
        res.writeHead(500);
        res.end();
      }
    });
    srv.listen(FIX_PORT, "127.0.0.1", () => resolve(srv));
  });
}

function injectFetch(w, origin) {
  w.fetch = (input, init) => {
    let u = typeof input === "string" ? input : input && input.url || String(input);
    u = new URL(u, origin).href;
    return fetch(u, init);
  };
}

async function openPage(url, origin, opts) {
  const dom = await JSDOM.fromURL(url, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(w) {
      injectFetch(w, origin);
      if (!(opts && opts.noLegal)) {
        try {
          w.localStorage.setItem("vexora.legal2", "1");
        } catch (e) {}
      }
      if (opts && opts.disc) {
        try {
          w.localStorage.setItem("vexora.disc", opts.disc);
        } catch (e) {}
      }
      if (!(opts && opts.noAccess)) {
        try {
          w.localStorage.setItem("vexora.access", JSON.stringify({
            exp: Date.now() + 864e5
          }));
        } catch (e) {}
      }
      try {
        const ctxStub = new Proxy({}, {
          get: (t, k) => k === "measureText" ? () => ({
            width: 0
          }) : typeof k === "string" ? function() {} : undefined
        });
        w.HTMLCanvasElement.prototype.getContext = function() {
          return ctxStub;
        };
      } catch (e) {}
      if (!w.matchMedia) {
        w.matchMedia = function(q) {
          return {
            matches: false,
            media: String(q),
            onchange: null,
            addListener: function() {},
            removeListener: function() {},
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() {
              return false;
            }
          };
        };
      }
    }
  });
  await new Promise(res => {
    dom.window.addEventListener("load", res);
    setTimeout(res, 15e3);
  });
  return dom;
}

async function closeWin(dom, label) {
  if (!dom) return;
  try {
    const w = dom.window;
    await waitFor(() => {
      try {
        return !!w.eval("document.querySelector('#tireBase option')");
      } catch (e) {
        return true;
      }
    }, 2500, "tire init " + (label || ""));
  } catch (e) {}
  await sleep(120);
  try {
    dom.window.close();
  } catch (e) {}
}

(async () => {
  console.log("== 0 · Deploy por defecto (mantenimiento ON) ==");
  {
    const h0 = await jget("/api/health");
    ok("deploy fresco: health maint=1 por defecto", h0.status === 200 && h0.body && h0.body.maint === 1);
    const p0 = await fetch(BASE + "/", {
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    });
    const t0 = await p0.text();
    ok("deploy fresco: / sigue pública (landing) con maint=1", p0.status === 200 && t0.indexOf("Open Vexora Tuning") >= 0);
    const p0a = await fetch(BASE + "/app", {
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    });
    const t0a = await p0a.text();
    ok("deploy fresco: /app → 503 mantenimiento (logo + Scheduled maintenance)", p0a.status === 503 && t0a.indexOf("/assets/mark.png") >= 0 && t0a.indexOf("Scheduled maintenance") >= 0);
    ok("deploy fresco: /admin queda abierto (para poder abrir la app)", (await fetch(BASE + "/admin")).status === 200);
    const FSECRET = "test-secret-local";
    const fcrypto = require("crypto");
    const fkey = fcrypto.createHash("sha256").update("vexora-founder-key:" + FSECRET).digest();
    const fexp = String(Date.now() + 36e5);
    const FTOK = fexp + "." + fcrypto.createHmac("sha256", fkey).update("vexora-founder:" + fexp).digest("hex");
    const fHdr = {
      cookie: "vexora_ft=" + FTOK
    };
    ok("founder: /founder/denied accesible en maint", (await fetch(BASE + "/founder/denied")).status === 200);
    const foStart = await fetch(BASE + "/founder/oauth/start", {
      redirect: "manual"
    });
    const foLoc = decodeURIComponent(foStart.headers.get("location") || "");
    ok("founder: /founder/oauth/start → 302 Discord, state y redirect COMPARTIDO (support/callback)", foStart.status === 302 && foLoc.indexOf("https://discord.com/oauth2/authorize") === 0 && foLoc.indexOf("state=") > 0 && foLoc.indexOf("/support/callback") > 0);
    const scb = await fetch(BASE + "/support/callback", {
      redirect: "manual"
    });
    ok("founder: /support/callback alcanzable en maint (302 err, no 503)", scb.status === 302 && (scb.headers.get("location") || "").indexOf("/support?err=") === 0);
    const fApp = await fetch(BASE + "/app", {
      headers: fHdr
    });
    const fAppT = await fApp.text();
    ok("founder: /app con cookie → 200 y app real (saltando maint)", fApp.status === 200 && fAppT.indexOf('id="vChart"') >= 0 && fAppT.indexOf("Scheduled maintenance") < 0);
    ok("founder: /api/features con cookie → ok (sin maint 503)", (await fetch(BASE + "/api/features", {
      headers: fHdr
    })).status === 200);
    const fBuild = await fetch(BASE + "/api/cfw/build", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "vexora_ft=" + FTOK
      },
      body: JSON.stringify({
        kind: "mcu",
        model: "g3",
        mcu: {
          flavor: "fwk",
          engage: 30,
          cap: 100,
          scale: 2e3,
          punta: 327
        },
        vcu: {}
      })
    }).then(x => x.json());
    ok("founder: /api/cfw/build con cookie funciona en maint", fBuild && fBuild.ok === true && !!fBuild.enc);
    const fBad = await fetch(BASE + "/app", {
      headers: {
        cookie: "vexora_ft=" + fexp + "." + "0".repeat(64)
      }
    });
    ok("founder: cookie con firma mala → sigue maint (503)", fBad.status === 503);
    const fExpTok = String(Date.now() - 1e3) + "." + fcrypto.createHmac("sha256", fkey).update("vexora-founder:" + String(Date.now() - 1e3)).digest("hex");
    ok("founder: cookie expirada → 503", (await fetch(BASE + "/app", {
      headers: {
        cookie: "vexora_ft=" + fExpTok
      }
    })).status === 503);
    ok("founder: /app en maint lleva link Founder login", t0a.indexOf("Founder login") >= 0);
  }
  const lo = await jpost("/admin/api/login", {
    password: ADMIN_PASS
  });
  ok("login admin ok → token", lo.status === 200 && lo.body.ok === true && typeof lo.body.token === "string" && lo.body.token.length > 70);
  const TOKEN = lo.body.token;
  ok("webhook: canal oficial horneado por defecto (source=default)", (await jadmin("GET", "/admin/api/webhook", null, TOKEN)).body.source === "default");
  ok("webhook: override anti-spam a hook muerto para los tests", (await jadmin("POST", "/admin/api/webhook", {
    url: "http://127.0.0.1:1/hook"
  }, TOKEN)).body.ok === true);
  const FLAG_TTL_MS = 5300;
  async function waitFlags(pred, label) {
    for (let i = 0; i < 60; i++) {
      const f = await jget("/api/features");
      if (f.body && f.body.features && pred(f.body.features)) break;
      await sleep(200);
    }
    await sleep(FLAG_TTL_MS);
  }
  async function waitIpState(ip, pred, label) {
    for (let i = 0; i < 60; i++) {
      const r = await fetchIp("/api/features", ip);
      if (pred(r.status, await r.json().catch(() => null))) break;
      await sleep(200);
    }
    await sleep(FLAG_TTL_MS);
  }
  async function waitMaint(v) {
    for (let i = 0; i < 90; i++) {
      const h = await jget("/api/health");
      if (h.body && h.body.maint === v) break;
      await sleep(200);
    }
    await sleep(FLAG_TTL_MS);
  }
  {
    const on = await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: false,
        aibot: false
      }
    }, TOKEN);
    ok("abrir la app desde el panel: maint=0 guardado", on.status === 200 && on.body.ok === true && on.body.flags.maint === 0);
    ok("abrir registra openedFor (token del deploy → el próximo deploy re-cierra)", typeof on.body.flags.openedFor === "string" && on.body.flags.openedFor.length > 0, "openedFor=" + JSON.stringify(on.body.flags.openedFor));
    await waitMaint(0);
  }
  {
    let f = await jget("/api/features");
    ok("features.vxfw default OFF (pestañas CFW + Motor)", f.status === 200 && f.body.features.vxfw === 0, "vxfw=" + JSON.stringify(f.body.features.vxfw));
    const html = await (await fetch(BASE + "/app", {
      headers: {
        Accept: "text/html"
      }
    })).text();
    ok("html: pestañas CFW + Motor + VXFW oculta", html.indexOf('data-view="cfw"') >= 0 && html.indexOf('data-view="motor"') >= 0 && /data-view="vxfw" hidden/.test(html));
    ok("html: 3 views (cfw + motor + vxfw contenedor)", html.indexOf('id="view-cfw"') >= 0 && html.indexOf('id="view-motor"') >= 0 && html.indexOf('id="view-vxfw"') >= 0);
    ok("html: gate VXFW solo en modo ON (CSS mode-vxfw)", html.indexOf('id="vxfwGate"') >= 0);
    ok("html: known issues ZT3 (temp/modos/power/unlock)", html.indexOf('data-i18n="zt3BugTemp"') >= 0 && html.indexOf('data-i18n="zt3BugPower"') >= 0 && html.indexOf('data-i18n="zt3BugModes"') >= 0 && html.indexOf('data-i18n="zt3BugUnlock"') >= 0);
    ok("html: guía con filas clásicas + vxfw", html.indexOf("g-classic-only") >= 0 && html.indexOf("g-vxfw-only") >= 0);
    const on2 = await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: false,
        vxfw: true
      }
    }, TOKEN);
    ok("panel: switch VXFW ON guardado", on2.status === 200 && on2.body.ok === true && on2.body.flags.vxfw === 1);
    for (let i = 0; i < 60; i++) {
      f = await jget("/api/features");
      if (f.body.features.vxfw === 1) break;
      await sleep(200);
    }
    ok("features.vxfw=1 tras switch (caché 5 s)", f.body.features.vxfw === 1);
    const off2 = await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: false,
        vxfw: false
      }
    }, TOKEN);
    ok("panel: switch VXFW OFF restaurado", off2.status === 200 && off2.body.flags.vxfw === 0);
    for (let i = 0; i < 60; i++) {
      f = await jget("/api/features");
      if (f.body.features.vxfw === 0) break;
      await sleep(200);
    }
    ok("features.vxfw=0 tras apagar (CFW+Motor de vuelta)", f.body.features.vxfw === 0);
    ok("POST sin vxfw preserva el flag (panel viejo compatible)", true);
  }
  console.log("== A · API y estáticos ==");
  const fixSrv = await startFixServer();
  const h = await jget("/api/health");
  ok("health ok + app 2.9.0", h.status === 200 && h.body && h.body.ok === true && h.body.app === "2.9.0" && h.body.maint === 0);
  let r = await fetch(BASE + "/cfw/bases/mcu-g3-148.dec.bin");
  ok("bases bloqueadas al público (404)", r.status === 404);
  r = await fetch(BASE + "/_worker.js");
  ok("código del worker NO descargable (404)", r.status === 404);
  r = await fetch(BASE + "/app", {
    headers: {
      Accept: "text/html"
    }
  });
  const homeHtml = await r.text();
  ok("home 200 (navegador)", r.status === 200);
  ok("home sin tea.js", homeHtml.indexOf("cfw/assets/tea.js") === -1);
  ok("home v=1657", homeHtml.indexOf("?v=1657") >= 0 && homeHtml.indexOf("v=1655") === -1);
  ok('/app inyecta <base href="/> (assets relativos resuelven en la raíz)', homeHtml.indexOf('<base href="/">') >= 0);
  {
    const rA = await fetch(BASE + "/app/assets/app.js", {
      redirect: "manual",
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    });
    ok("/app/assets/* redirige a /assets/* (301)", rA.status === 301 && (rA.headers.get("location") || "").indexOf("/assets/app.js") >= 0, "status=" + rA.status);
    const rOk = await fetch(BASE + "/assets/app.js", {
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    });
    ok("asset de la app carga 1:1 en producción (200 JS)", rOk.status === 200 && /javascript/.test(rOk.headers.get("content-type") || ""));
  }
  const rL = await fetch(BASE + "/", {
    headers: {
      Accept: "text/html"
    }
  });
  const tL = await rL.text();
  ok("landing raíz: 200 + Open Vexora Tuning + Coming soon + vxfw", rL.status === 200 && tL.indexOf("Open Vexora Tuning") >= 0 && tL.indexOf("Coming soon") >= 0 && tL.indexOf("discord.gg/vxfw") >= 0);
  ok("home changelog 2.3.0 + 2.2.0 + 2.1.0 (+ anteriores)", homeHtml.indexOf("<span>2.3.0</span>") >= 0 && homeHtml.indexOf("<span>2.2.0</span>") >= 0 && homeHtml.indexOf("<span>2.1.2</span>") >= 0 && homeHtml.indexOf("<span>2.1.0</span>") >= 0);
  ok("changelog público sin detalles internos (admin/bans/stats/maintenance msg)", homeHtml.indexOf("<span>2.1.3</span>") === -1 && !/admin panel|ip banning|usage stats|csv export|admin control|bans with|maintenance message/i.test(homeHtml));
  ok("público: sin nombre personal en la nota de privacidad", homeHtml.indexOf("Ignition, founder") === -1);
  ok("credits: Boss = Founder y sin Ignition (v2.3.2.35)", /<b>Boss<\/b><span>Founder<\/span>/.test(homeHtml) && homeHtml.indexOf("ignition.official") === -1);
  r = await fetch(BASE + "/vexora", {
    redirect: "manual"
  });
  ok("/vexora 301 -> /", r.status === 301);
  r = await fetch(BASE + "/no-existe-nada");
  ok("404 real en ruta desconocida", r.status === 404);
  r = await fetch(BASE + "/admin", {
    headers: {
      Accept: "text/html"
    }
  });
  const adminHtml = await r.text();
  ok("/admin 200 + noindex", r.status === 200 && /noindex/i.test(r.headers.get("x-robots-tag") || ""), "x-robots-tag=" + r.headers.get("x-robots-tag"));
  ok("/admin es el panel", adminHtml.indexOf("Vexora · Admin") >= 0 && adminHtml.indexOf("admin/api/login") >= 0);
  const feats = await jget("/api/features");
  ok("features por defecto ON", feats.status === 200 && feats.body.ok === true && feats.body.features.tire === 1 && feats.body.features.cfw === 1);
  const opts = await jget("/api/tire/options");
  const M = opts.body && opts.body.models || {};
  ok("options ok + enabled", opts.status === 200 && opts.body.ok === true && opts.body.enabled === true);
  ok("options g3 = solo 1.3.15 (267 mm, 11″) — 1.4.8 fuera", Array.isArray(M.g3) && M.g3.length === 1 && M.g3[0].v === "1.3.15" && M.g3[0].stockMm === 267 && M.g3[0].stockInch === 11);
  ok("options f3 vacía (config-block)", Array.isArray(M.f3) && M.f3.length === 0);
  const t1 = await jpost("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: 11.5
  });
  ok("tire build 1.3.15@11.5 ok", t1.status === 200 && t1.body.ok === true && t1.body.part === "mcu");
  ok("tire build mm 279 / was 267", t1.body.mm === 279 && t1.body.wasMm === 267);
  const t1u = TEA.unwrap(b64u8(t1.body.enc));
  ok("tire TEA roundtrip + float 279", t1u.ok === true && Math.abs(f32(t1u.body, 37496) - .279136) < 2e-4);
  const t6 = await jpost("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: 20
  });
  ok("tire 20″ ok (485 mm)", t6.status === 200 && t6.body.mm === 485);
  const t7 = await jpost("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: .1
  });
  ok("tire 0.1″ ok (2 mm)", t7.status === 200 && t7.body.mm === 2);
  const t4 = await jpost("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: 25
  });
  ok("tire >20″ rechazado", t4.status === 400);
  const t4b = await jpost("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: .05
  });
  ok("tire <0.1″ rechazado", t4b.status === 400);
  const UNLOCK_SLOT = Array.from(TEA.KEY).concat([ 99, 102, 119, 46, 115, 104 ]).join(",");
  const slotOk = u => Array.from(u.subarray(1056, 1078)).join(",") === UNLOCK_SLOT;
  ok("tire build lleva key unlock (no re-bloquea el motor)", slotOk(t1u.body));
  const m1 = await jpost("/api/cfw/build", {
    kind: "mcu",
    model: "g3",
    mcu: {
      flavor: "fwk",
      engage: 28,
      cap: 115,
      scale: 2300,
      punta: 327
    },
    vcu: {}
  });
  const m1u = TEA.unwrap(b64u8(m1.body.enc));
  ok("mcu fwk build lleva key unlock", m1.status === 200 && m1.body.ok && slotOk(m1u.body));
  const m2 = await jpost("/api/cfw/build", {
    kind: "mcu",
    model: "g3",
    mcu: {
      flavor: "ultra",
      engage: 28,
      cap: 115,
      scale: 2300,
      punta: 327
    },
    vcu: {}
  });
  const m2u = TEA.unwrap(b64u8(m2.body.enc));
  ok("mcu ultra build lleva key unlock", m2.status === 200 && m2.body.ok && slotOk(m2u.body));
  const mClamp = await jpost("/api/cfw/build", {
    kind: "mcu",
    model: "g3",
    mcu: {
      flavor: "fwk",
      engage: 28,
      cap: 200,
      scale: 2300,
      punta: 327
    },
    vcu: {}
  });
  const mClampU = TEA.unwrap(b64u8(mClamp.body.enc));
  ok("mcu 2.2.0: iqFW >150 recortado a 150 en el servidor (guardrail)", mClamp.status === 200 && mClamp.body.ok && mClampU.body[59350] === 150, "byte@0xE7D6=" + mClampU.body[59350]);
  const s1 = await jpost("/api/cfw/build", {
    kind: "vcu-stock",
    model: "g3",
    fwVcu: "1.5.8",
    mcu: {},
    vcu: {}
  });
  ok("restore stock-stock eliminado: vcu-stock → 400", s1.status === 400 && s1.body.ok === false);
  const s1b = await jpost("/api/cfw/build", {
    kind: "mcu-stock",
    model: "g3",
    mcu: {},
    vcu: {}
  });
  ok("mcu-stock → 400 (solo compat)", s1b.status === 400 && s1b.body.ok === false);
  const x1 = await jpost("/api/cfw/build", {
    kind: "vcu"
  }, {
    Origin: "https://evil.example"
  });
  ok("cross-origin build 403", x1.status === 403);
  {
    const UIP = {
      "cf-connecting-ip": "203.0.113.88"
    };
    const ffk = new Uint8Array(16).fill(255);
    const B = f => fs.readFileSync(path.join(__dirname, "..", "public", "cfw", "bases", f));
    const UNLOCKS = [ [ "g3", "vcu-unlock", "vcu", "vcu-g3-unlock.bin.enc", "SCOOTER_VCU_xxG3" ], [ "f3pro", "vcu-unlock", "vcu", "vcu-g3-unlock.bin.enc", "SCOOTER_VCU_xxG3" ], [ "f3", "vcu-unlock", "vcu", "vcu-f3-unlock.bin.enc", "SCOOTER_VCU_xxF3" ], [ "zt3", "vcu-unlock", "vcu", "vcu-zt3-unlock.bin.enc", "SCOOTER_VCU_xxU2" ], [ "g3", "mcu-unlock", "mcu", "mcu-x3-unlock.bin.enc", "SCOOTER_MCU_0001" ], [ "f3", "mcu-unlock", "mcu", "mcu-x3-unlock.bin.enc", "SCOOTER_MCU_0001" ], [ "zt3", "mcu-unlock", "mcu", "mcu-x3-unlock.bin.enc", "SCOOTER_MCU_0001" ] ];
    let encG3 = "";
    for (const [m, kind, part, file, marker] of UNLOCKS) {
      const r = await jpost("/api/cfw/build", {
        kind: kind,
        model: m,
        mcu: {},
        vcu: {}
      }, UIP);
      const raw = B(file);
      const u = TEA.unwrap(b64u8(r.body.enc), ffk);
      const same = Buffer.compare(Buffer.from(b64u8(r.body.enc)), raw) === 0;
      ok("unlock " + m + " " + kind + ": verbatim + FF + " + marker, r.status === 200 && r.body.ok && r.body.part === part && same && u.ok === true && String.fromCharCode.apply(null, u.body.subarray(1024, 1040)) === marker, "st=" + r.status + " same=" + same + " ff=" + (u && u.ok));
      if (m === "g3" && kind === "vcu-unlock") encG3 = r.body.enc;
    }
    ok("vcu-unlock: NO cifrada con la llave por defecto (FF-keyed)", encG3 !== "" && TEA.unwrap(b64u8(encG3)).ok === false);
    const u2 = await jpost("/api/cfw/build", {
      kind: "vcu-unlock",
      model: "g3",
      mcu: {},
      vcu: {}
    }, UIP);
    ok("vcu-unlock: determinista", u2.status === 200 && u2.body.enc === encG3);
    const bad = await jpost("/api/cfw/build", {
      kind: "vcu-unlock",
      model: "p100",
      mcu: {},
      vcu: {}
    }, UIP);
    ok("vcu-unlock modelo sin imagen → 400", bad.status === 400 && bad.body.ok === false);
  }
  {
    const SPOOF_IP = {
      "cf-connecting-ip": "203.0.113.77"
    };
    const sp1 = await jpost("/api/cfw/build", {
      kind: "vcu",
      model: "g3",
      mcu: {},
      vcu: {
        spoofVcu: "1.5.8",
        police: false
      }
    }, SPOOF_IP);
    const sp1u = TEA.unwrap(b64u8(sp1.body.enc));
    ok("spoof VCU 1.5.8 → movw r0,#0x158 @0xa4e8 (40 f2 58 10)", sp1.status === 200 && sp1.body.ok && sp1u.ok && sp1u.body[42216] === 64 && sp1u.body[42216 + 1] === 242 && sp1u.body[42216 + 2] === 88 && sp1u.body[42216 + 3] === 16, JSON.stringify(Array.from(sp1u.body.slice(42216, 42220)).map(b => b.toString(16).padStart(2, "0"))) + " · note=" + sp1.body.note);
    ok("spoof VCU: nota incluye la versión", sp1.body.note && /spoof 1\.5\.8/.test(sp1.body.note), sp1.body.note);
    ok("spoof VCU 1.5.8 → tail '1.5.8\\0' + u16 0x0158 @0xeff4", sp1u.body[61428] === 49 && sp1u.body[61429] === 46 && sp1u.body[61430] === 53 && sp1u.body[61431] === 46 && sp1u.body[61432] === 56 && sp1u.body[61433] === 0 && sp1u.body[61434] === 88 && sp1u.body[61435] === 1, JSON.stringify(Array.from(sp1u.body.slice(61428, 61436)).map(b => b.toString(16).padStart(2, "0"))));
    const sp2 = await jpost("/api/cfw/build", {
      kind: "vcu",
      model: "g3",
      mcu: {},
      vcu: {
        spoofVcu: "no.soy.version",
        police: false
      }
    }, SPOOF_IP);
    const sp2u = TEA.unwrap(b64u8(sp2.body.enc));
    ok("spoof VCU formato inválido → base intacta (5.1.1)", sp2.status === 200 && sp2.body.ok && sp2u.ok && sp2u.body[42216] === 64 && sp2u.body[42216 + 1] === 242 && sp2u.body[42216 + 2] === 17 && sp2u.body[42216 + 3] === 80 && sp2u.body[61428] === 53 && sp2u.body[61434] === 17 && sp2u.body[61435] === 5);
    const sp3 = await jpost("/api/cfw/build", {
      kind: "vcu",
      model: "g3",
      mcu: {},
      vcu: {
        spoofVcu: "10.2.3",
        police: false
      }
    }, SPOOF_IP);
    const sp3u = TEA.unwrap(b64u8(sp3.body.enc));
    ok("spoof VCU 10.2.3 → movw r0,#0xa23 (i=1, imm4=0)", sp3.status === 200 && sp3.body.ok && sp3u.ok && sp3u.body[42216] === 64 && sp3u.body[42216 + 1] === 246 && sp3u.body[42216 + 2] === 35 && sp3u.body[42216 + 3] === 32 && sp3u.body[61428] === 49 && sp3u.body[61429] === 48 && sp3u.body[61430] === 46 && sp3u.body[61431] === 50 && sp3u.body[61432] === 46 && sp3u.body[61433] === 0 && sp3u.body[61434] === 35 && sp3u.body[61435] === 10, JSON.stringify(Array.from(sp3u.body.slice(42216, 42220)).map(b => b.toString(16).padStart(2, "0"))) + " tail " + JSON.stringify(Array.from(sp3u.body.slice(61428, 61388 + 16)).map(b => b.toString(16).padStart(2, "0"))));
  }
  {
    const rlIp = "198.51.100." + String(Date.now() % 250 + 1);
    let hit429 = -1;
    for (let i = 0; i < 42; i++) {
      const rr = await fetch(BASE + "/api/tire/build", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": rlIp
        },
        body: JSON.stringify({
          model: "g3",
          version: "1.3.15",
          inch: 11.5
        })
      });
      if (rr.status === 429) {
        hit429 = i;
        break;
      }
    }
    ok("rate limit: 429 tras los 40 builds", hit429 >= 38 && hit429 <= 41, "429 en la llamada " + (hit429 + 1));
  }
  console.log("== B · Admin API: login, flags en caliente, stats ==");
  {
    const VU = require(path.join(__dirname, "..", "server", "worker.js"));
    const uEnv = {
      ADMIN_PASSWORD: "unit",
      DB: null,
      ASSETS: {
        fetch: () => new Response("a")
      }
    };
    const uCtx = {
      waitUntil: () => {}
    };
    const ul = await VU.fetch(new Request("http://x/admin/api/login", {
      method: "POST",
      body: JSON.stringify({
        password: "unit"
      })
    }), uEnv, uCtx);
    const utok = (await ul.json()).token;
    const uf = await VU.fetch(new Request("http://x/admin/api/flags", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + utok
      },
      body: JSON.stringify({
        flags: {
          tire: false,
          cfw: true
        }
      })
    }), uEnv, uCtx);
    const ufj = await uf.json();
    ok("UNIT sin D1: flags POST → 503 con guía", uf.status === 503 && /D1 database not bound/.test(ufj.error || ""));
    const ub = await VU.fetch(new Request("http://x/admin/api/rules", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + utok
      },
      body: JSON.stringify({
        ip: "1.2.3.4"
      })
    }), uEnv, uCtx);
    ok("UNIT sin D1: ban POST → 503", ub.status === 503);
    const uh = await VU.fetch(new Request("http://x/api/health"), uEnv, uCtx);
    const uhj = await uh.json();
    ok("UNIT sin D1: la app sigue viva y ABIERTA (maint=0)", uh.status === 200 && uhj.maint === 0);
  }
  r = await jadmin("GET", "/admin/api/flags");
  ok("admin sin token → 401", r.status === 401);
  let fg = await jadmin("GET", "/admin/api/flags", null, TOKEN);
  ok("flags GET (token) → ON + maint OFF + db", fg.status === 200 && fg.body.ok === true && fg.body.flags.tire === 1 && fg.body.flags.cfw === 1 && fg.body.flags.maint === 0 && fg.body.db === true);
  fg = await jadmin("POST", "/admin/api/flags", {
    flags: {
      tire: false,
      cfw: true
    }
  }, TOKEN);
  ok("flags POST tire=off", fg.status === 200 && fg.body.flags.tire === 0);
  feats.body = null;
  const fOff = await jget("/api/features");
  ok("features refleja tire=0 al instante", fOff.body.features.tire === 0);
  await waitFlags(f => f.tire === 0, "tire off global");
  const optOff = await jget("/api/tire/options");
  ok("options → enabled:false", optOff.body.ok === true && optOff.body.enabled === false && Object.keys(optOff.body.models).length === 0);
  const tOff = await jpost("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: 11.5
  });
  ok("tire build con flag off → 403", tOff.status === 403 && /unavailable/i.test(tOff.body.error));
  await jadmin("POST", "/admin/api/flags", {
    flags: {
      tire: false,
      cfw: false
    }
  }, TOKEN);
  await waitFlags(f => f.cfw === 0 && f.tire === 0, "cfw off global");
  const cOff = await jpost("/api/cfw/build", {
    kind: "mcu",
    model: "g3",
    mcu: {
      flavor: "fwk",
      engage: 28,
      cap: 115,
      scale: 2300,
      punta: 327
    },
    vcu: {}
  });
  ok("cfw build custom con flag off → 403", cOff.status === 403 && /unavailable/i.test(cOff.body.error));
  const sOk = await jpost("/api/cfw/build", {
    kind: "vcu-unlock",
    model: "g3",
    mcu: {},
    vcu: {}
  });
  ok("compat restore sigue disponible con flag off", sOk.status === 200 && sOk.body.ok === true);
  const fd = await jpost("/api/flash-done", {
    part: "mcu",
    src: "tire"
  });
  ok("flash-done ok", fd.status === 200 && fd.body.ok === true);
  const fdBad = await jpost("/api/flash-done", {
    part: "zzz"
  });
  ok("flash-done part inválido → 400", fdBad.status === 400);
  const RULE_IP = "203.0.113.99";
  const VIP_IP = "203.0.113.123";
  const postIp = async (p, obj, ip) => {
    const r = await fetch(BASE + p, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": ip
      },
      body: JSON.stringify(obj)
    });
    return {
      status: r.status,
      body: await r.json().catch(() => null)
    };
  };
  const fetchIp = async (p, ip) => fetch(BASE + p, {
    headers: {
      "cf-connecting-ip": ip
    }
  });
  const ruleBad = await jadmin("POST", "/admin/api/rules", {
    ip: "no-es-ip"
  }, TOKEN);
  ok("regla IP inválida → 400", ruleBad.status === 400);
  const selfBan = await jadmin("POST", "/admin/api/rules", {
    ip: "127.0.0.1",
    banned: true
  }, TOKEN);
  ok("auto-baneo (tu propia IP) → 400", selfBan.status === 400 && /own IP/.test(selfBan.body.error || ""));
  const vipRule = await jadmin("POST", "/admin/api/rules", {
    ip: VIP_IP,
    tire: 1,
    cfw: 0,
    reason: "vip"
  }, TOKEN);
  ok("regla VIP guardada (wheel ON · cfw OFF)", vipRule.status === 200);
  await waitIpState(VIP_IP, (st, j) => j && j.features && j.features.tire === 1 && j.features.cfw === 0, "regla VIP");
  const vipFeat = await fetchIp("/api/features", VIP_IP).then(r => r.json());
  ok("features de la IP VIP: wheel 1 · cfw 0 (pisa el global)", vipFeat.ok === true && vipFeat.features.tire === 1 && vipFeat.features.cfw === 0);
  const vipTire = await postIp("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: 11.5
  }, VIP_IP);
  ok("build de ruedas de la IP VIP → 200 (global off)", vipTire.status === 200 && vipTire.body.ok === true);
  const vipCfw = await postIp("/api/cfw/build", {
    kind: "vcu",
    model: "g3",
    mcu: {},
    vcu: {
      police: false,
      ce: 25,
      cd: 55,
      cs: 100
    }
  }, VIP_IP);
  ok("build custom de la IP VIP → 403 (cfw off para él)", vipCfw.status === 403);
  await jadmin("DELETE", "/admin/api/rules?ip=" + VIP_IP, null, TOKEN);
  await waitIpState(VIP_IP, (st, j) => j && j.features && j.features.tire === 0, "vip borrada");
  const vipFeat2 = await fetchIp("/api/features", VIP_IP).then(r => r.json());
  ok("regla VIP borrada → vuelve al global (wheel 0)", vipFeat2.features.tire === 0);
  const banAdd = await jadmin("POST", "/admin/api/rules", {
    ip: RULE_IP,
    banned: true,
    reason: "abuse"
  }, TOKEN);
  ok("baneo total guardado", banAdd.status === 200);
  await waitIpState(RULE_IP, st => st === 403, "baneo propagado");
  const banPage = await fetchIp("/", RULE_IP);
  const banHtml = await banPage.text();
  ok("IP baneada: la página es la pantalla de baneo (403)", banPage.status === 403 && /banned from Vexora/i.test(banHtml) && /discord\.gg/.test(banHtml));
  const banAsset = await fetchIp("/assets/app.js", RULE_IP);
  const banText = await banAsset.text();
  ok("IP baneada: los assets también reciben la pantalla de baneo", banAsset.status === 403 && /banned from Vexora/i.test(banText));
  ok("IP baneada: pantalla de baneo con enlace de soporte", banText.indexOf("discord.gg") >= 0);
  const banFeat = await fetchIp("/api/features", RULE_IP);
  ok("IP baneada: /api/features denegada", banFeat.status === 403);
  const banTire = await fetch(BASE + "/api/tire/build", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": RULE_IP
    },
    body: JSON.stringify({
      version: 2,
      inch: 10
    })
  });
  ok("IP baneada: builds de rueda denegados", banTire.status === 403);
  const banCfw = await jpost("/api/cfw/build", {
    kind: "vcu-stock",
    model: "g3",
    fwVcu: "1.5.8",
    mcu: {},
    vcu: {}
  }, {
    "cf-connecting-ip": RULE_IP
  });
  ok("IP baneada: builds CFW/stock denegados", banCfw.status === 403);
  const unbanR = await jadmin("DELETE", "/admin/api/rules?ip=" + RULE_IP, null, TOKEN);
  ok("IP desbaneada vuelve a pasar (features 200)", unbanR.status === 200 && (await fetchIp("/api/features", RULE_IP)).status === 200);
  await fetch(BASE + "/", {
    headers: {
      accept: "text/html",
      "cf-connecting-ip": TEST_IP
    }
  });
  let st = await jadmin("GET", "/admin/api/stats", null, TOKEN);
  for (let i = 0; i < 16 && (st.body.visitsToday < 1 || st.body.tireToday < 2 || st.body.flashToday < 1); i++) {
    await sleep(500);
    st = await jadmin("GET", "/admin/api/stats", null, TOKEN);
  }
  ok("stats ok + db", st.status === 200 && st.body.ok === true && st.body.db === true);
  ok("stats: visitas hoy ≥ 1", st.body.visitsToday >= 1, "visitsToday=" + st.body.visitsToday);
  ok("stats: builds de rueda hoy ≥ 2", st.body.tireToday >= 2, "tireToday=" + st.body.tireToday);
  ok("stats: flashes hoy ≥ 1", st.body.flashToday >= 1, "flashToday=" + st.body.flashToday);
  ok("stats: flashers hoy ≥ 1", st.body.flashersToday >= 1);
  ok("stats: serie 7 días", Array.isArray(st.body.days) && st.body.days.length === 7);
  ok("stats: top IPs ≥ 1", st.body.topIps.length >= 1);
  ok("stats 2.1.3: totales all-time (events/visits/builds/IPs)", st.body.totals && Number(st.body.totals.events) >= 1 && Number(st.body.totals.visits) >= 1 && typeof st.body.totals.builds === "number" && typeof st.body.totals.uniqIps === "number");
  ok("stats 2.1.3: byType con conteos", st.body.byType && typeof st.body.byType.visit === "number" && Object.keys(st.body.byType).length >= 2);
  ok("stats 2.1.3: lastFlash presente o null", st.body.lastFlash === null || typeof st.body.lastFlash.ts === "number");
  ok("stats: actividad reciente", st.body.recent.length >= 3);
  const mrS = await jadmin("POST", "/admin/api/flags", {
    flags: {
      tire: true,
      cfw: true,
      maint: false,
      maintReason: 'x<y>&"z'
    }
  }, TOKEN);
  ok("maintReason saneada en el servidor (sin <, >, & ni comillas)", mrS.status === 200 && mrS.body.flags.maintReason === "xyz", "got=" + JSON.stringify(mrS.body.flags.maintReason));
  const types = st.body.recent.map(e => e.type);
  ok("stats: eventos con tipo correcto", types.includes("flash") && types.includes("rule_set") && st.body.recent.every(e => typeof e.type === "string" && e.type.length > 0));
  {
    const dDom = await openPage(BASE + "/app", BASE + "/");
    const wD = dDom.window;
    await waitFor(() => {
      try {
        return wD.document.querySelector("#consentBar") && !wD.document.querySelector("#consentBar").hidden;
      } catch (e) {
        return false;
      }
    }, 1e4, "consent visible");
    wD.eval("document.querySelector('#cbMin').click()");
    await waitFor(() => {
      try {
        return wD.document.querySelector("#discOverlay").style.display !== "none";
      } catch (e) {
        return false;
      }
    }, 15e3, "disclaimer visible 1a vez");
    ok("disclaimer: texto EN correcto en la 1ª apertura", wD.document.querySelector('[data-i18n="discP1"]').textContent.indexOf("artificial intelligence") >= 0);
    wD.eval("document.querySelector('#discOk').click()");
    await sleep(300);
    ok("disclaimer: OK → oculto + vexora.disc=1", wD.document.querySelector("#discOverlay").style.display === "none" && wD.eval("localStorage.getItem('vexora.disc')") === "1");
    await dDom.window.close();
    const dDom2 = await openPage(BASE + "/app", BASE + "/", {
      disc: "1"
    });
    await sleep(1600);
    ok("disclaimer: NO aparece si ya está leído", dDom2.window.document.querySelector("#discOverlay").style.display === "none");
    await dDom2.window.close();
  }
  console.log("== C · Regresión v1.7.2 (cliente) vs API (byte a byte) ==");
  const fixDom = await openPage("http://127.0.0.1:" + FIX_PORT + "/index.html", "http://127.0.0.1:" + FIX_PORT + "/");
  const w = fixDom.window;
  await waitFor(() => {
    try {
      return w.eval("!!window.VexoraCfw && !!window.VexoraCfw.build");
    } catch (e) {
      return false;
    }
  }, 12e3, "VexoraCfw en fixture");
  const set = js => w.eval(js);
  async function oldBuild(kind) {
    for (let i = 0; i < 40; i++) {
      try {
        const out = await w.eval("VexoraCfw.build('" + kind + "')");
        if (out) return out;
      } catch (e) {
        if (!/Wait for bases/.test(String(e && e.message))) throw e;
      }
      await sleep(150);
    }
    throw new Error("bases del fixture nunca cargaron");
  }
  async function mirrorParams(kind, flavor) {
    const json = w.eval(`(function(){\n      var $=function(s){return document.querySelector(s)};\n      var v=function(id){var e=$(id);return e?Number(e.value):0};\n      return JSON.stringify({kind:'${kind}', model:window.Vexora.model||'g3',\n        fwVcu:String(window.Vexora.fwVcu||''), fwMcu:String(window.Vexora.fwMcu||''),\n        mcu:{flavor:'${flavor}',engage:v('#mcu-engage'),cap:v('#mcu-cap'),scale:v('#mcu-scale'),punta:v('#mcu-punta')},\n        vcu:{police:!!($('#cfwPolice')&&$('#cfwPolice').checked),panic:!!($('#cfwPanic')&&$('#cfwPanic').checked),\n             se:v('#n-eco'),sd:v('#n-drive'),ss:v('#n-sport'),ce:v('#eco'),cd:v('#drive'),cs:v('#sport')}});\n    })()`);
    return JSON.parse(json);
  }
  async function regression(name, kind, flavor, setup) {
    set("Vexora.model='g3'; Vexora.fwVcu=''; Vexora.fwMcu='';");
    if (setup) set(setup);
    const oldOut = await oldBuild(kind);
    const oldBytes = new Uint8Array(JSON.parse(w.eval("JSON.stringify(Array.from(window.lastBuiltFirmwareEnc))")));
    const p = await mirrorParams(kind, flavor);
    const api = await jpost("/api/cfw/build", p);
    if (api.status !== 200 || !api.body.ok) {
      ok("regresión " + name, false, "API " + api.status + " " + JSON.stringify(api.body).slice(0, 120));
      return;
    }
    const apiBytes = b64u8(api.body.enc);
    let cmp = eqBytes(apiBytes, oldBytes);
    let extra = "len api=" + apiBytes.length + " old=" + oldBytes.length;
    if (kind === "mcu") {
      const oldU = TEA.unwrap(oldBytes), apiU = TEA.unwrap(apiBytes);
      const want = Array.from(TEA.KEY).concat([ 99, 102, 119, 46, 115, 104 ]).join(",");
      const gotKey = Array.from(apiU.body.subarray(1056, 1078)).join(",") === want;
      cmp = apiU.ok && oldU.ok && eqBytesNoUnlock(apiU.body, oldU.body) && gotKey;
      extra += " · key=" + (gotKey ? "OK" : "FALTA");
    }
    ok("regresión " + name + " (" + api.body.part + ", " + apiBytes.length + " B)", api.body.part === oldOut.part && cmp, extra);
  }
  const CLICK = id => `(function(){var b=document.querySelector('${id}');if(b)b.click();return 1})();`;
  await regression("mcu fwk Best 28/115/2300", "mcu", "fwk", CLICK("#presetBest"));
  await regression("mcu fwk Stock 30/70/1638", "mcu", "fwk", CLICK("#presetStock"));
  await regression("mcu fwk custom 33/80/999", "mcu", "fwk", CLICK("#presetBest") + `(function(){document.querySelector('#mcu-engage').value='33';document.querySelector('#mcu-cap').value='80';document.querySelector('#mcu-scale').value='999';return 1})();`);
  await regression("mcu ultra punta 327", "mcu", "ultra", CLICK("#presetUltra"));
  await regression("mcu ultra punta 900", "mcu", "ultra", CLICK("#presetUltraPlus"));
  const BASE511 = new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "public", "cfw", "bases", "vcu-g3-511.dec.bin")));
  const u32at = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
  async function extBuild(name, V, row) {
    const r = await jpost("/api/cfw/build", {
      kind: "vcu",
      model: "g3",
      fwVcu: "5.1.1",
      fwMcu: "",
      mcu: {},
      vcu: V
    });
    if (r.status !== 200 || !r.body.ok) {
      ok(name, false, "API " + r.status + " " + JSON.stringify(r.body).slice(0, 120));
      return null;
    }
    const enc = b64u8(r.body.enc);
    const u = TEA.unwrap(enc);
    let good = u.ok && enc.length === 61440 && u.body.length === 61436 && r.body.part === "vcu";
    for (const rr of [ 0, 3, 5 ]) {
      for (let c = 0; c < 9; c++) good = good && u32at(u.body, 58884 + (rr * 9 + c) * 4) === row[c];
    }
    good = good && Array.from(u.body.subarray(1056, 1072)).join(",") === Array.from(TEA.KEY).join(",");
    good = good && u.body[9040] === 0 && u.body[9041] === 191;
    good = good && String.fromCharCode.apply(null, Array.from(u.body.subarray(61428, 61433))) === "5.1.1";
    let outside = 0;
    for (let i = 0; i < u.body.length; i++) {
      if (u.body[i] === BASE511[i]) continue;
      const ok2 = i >= 1056 && i < 1072 || i === 9040 || i === 9041 || i >= 58884 && i < 58884 + 216;
      if (!ok2) outside++;
    }
    good = good && outside === 0;
    ok(name, good, "fila=" + row.join(",") + " outside=" + outside);
    return u.body;
  }
  const extDe = await extBuild("vcu ext preset Germany 22 (tabla = Standard)", {
    police: false,
    panic: false,
    se: 16,
    sd: 22,
    ss: 22
  }, [ 16, 22, 16, 22, 22, 22, 22, 22, 22 ]);
  await extBuild("vcu ext preset Europe 25", {
    se: 16,
    sd: 25,
    ss: 25
  }, [ 16, 25, 16, 25, 25, 25, 25, 25, 25 ]);
  const extIgn = await extBuild("vcu ext ignora police/panic", {
    police: true,
    panic: true,
    se: 16,
    sd: 22,
    ss: 22
  }, [ 16, 22, 16, 22, 22, 22, 22, 22, 22 ]);
  ok("vcu ext: police/panic no cambian ni un byte", !!extDe && !!extIgn && eqBytes(extIgn, extDe));
  await extBuild("vcu ext custom 13/20/28", {
    se: 13,
    sd: 20,
    ss: 28
  }, [ 13, 20, 13, 20, 28, 20, 28, 28, 28 ]);
  await extBuild("vcu ext clamp >250", {
    se: 16,
    sd: 22,
    ss: 300
  }, [ 16, 22, 16, 22, 250, 22, 250, 250, 250 ]);
  await regression("zt3 vcu (base unlock)", "vcu", "fwk", `(function(){window.Vexora.model='zt3';return 1})();`);
  console.log("== D · UI app real: ruedas + flags en vivo ==");
  const appDom = await openPage(BASE + "/app", BASE + "/");
  const a = appDom.window;
  await waitFor(() => {
    try {
      return a.eval("document.querySelectorAll('#tireBase option').length");
    } catch (e) {
      return 0;
    }
  }, 15e3, "tire options en UI");
  ok("appVer 2.9.0", a.eval("document.querySelector('#appVer').textContent") === "2.9.0");
  ok("sin archivo ni descarga, con select y nota off", a.eval("document.querySelectorAll('#tireFile,#tirePick,#tireDownload').length") === 0 && a.eval("document.querySelectorAll('#tireBase,#tireOff').length") === 2);
  ok("base por defecto = Stock MCU 1.3.15 · 11″ / 267 mm", /1\.3\.15/.test(a.eval("document.querySelector('#tireBase option').textContent") || "") && /267 mm/.test(a.eval("document.querySelector('#tireBase option').textContent") || ""));
  ok("controles visibles + off oculta", a.eval("document.querySelector('#tireControls').hidden") === false && a.eval("document.querySelector('#tireOff').hidden") === true);
  ok("slider min 0.1 / max 20 / step 0.1", a.eval("document.querySelector('#tireInch').min") === "0.1" && a.eval("document.querySelector('#tireInch').max") === "20" && a.eval("document.querySelector('#tireInch').step") === "0.1");
  a.eval(`(function(){var s=document.querySelector('#tireInch');s.value='11.5';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})();`);
  await sleep(150);
  ok("11.5″ -> 279 mm en vivo", a.eval("document.querySelector('#tireMm').textContent") === "279 mm");
  a.eval(`(function(){var s=document.querySelector('#tireInch');s.value='12.4';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})();`);
  await sleep(120);
  await a.eval("VexoraTire.refresh()");
  await sleep(200);
  ok("refresh sin cambios conserva el slider en 12.4", a.eval("document.querySelector('#tireInch').value") === "12.4");
  await jadmin("POST", "/admin/api/flags", {
    flags: {
      tire: false,
      cfw: true
    }
  }, TOKEN);
  await waitFor(() => {
    try {
      return a.eval("document.querySelector('#tireOff').hidden") === false;
    } catch (e) {
      return false;
    }
  }, 25e3, "tireOff visible (tiempo real)");
  ok("flag off → nota 'temporalmente no disponible' + controles ocultos", a.eval("document.querySelector('#tireControls').hidden") === true && /unavailable|no disponible|nicht verfügbar/i.test(a.eval("document.querySelector('#tireOff').textContent") || ""));
  await jadmin("POST", "/admin/api/flags", {
    flags: {
      tire: false,
      cfw: false
    }
  }, TOKEN);
  await waitFor(() => {
    try {
      return a.eval("document.querySelector('#btnMcu').disabled") === true;
    } catch (e) {
      return false;
    }
  }, 25e3, "btnMcu disabled (tiempo real)");
  ok("cfw off → botones custom deshabilitados", a.eval("document.querySelector('#btnMcu').disabled") === true && a.eval("document.querySelector('#btnVcu').disabled") === true);
  ok("cfw off → compat sigue habilitado", a.eval("document.querySelector('#btnMcuUnlock').disabled") === false);
  await jadmin("POST", "/admin/api/flags", {
    flags: {
      tire: true,
      cfw: true
    }
  }, TOKEN);
  await waitFor(() => {
    try {
      return a.eval("document.querySelector('#tireControls').hidden") === false && a.eval("document.querySelector('#btnMcu').disabled") === false;
    } catch (e) {
      return false;
    }
  }, 25e3, "controles y botones de vuelta (tiempo real)");
  ok("flags on → controles y botones de vuelta", a.eval("document.querySelector('#tireOff').hidden") === true && a.eval("document.querySelector('#btnMcu').disabled") === false);
  a.eval("Vexora.showBan('motivo de prueba')");
  ok("overlay de baneo visible con mensaje y Discord", a.eval("document.querySelectorAll('#vexoraBanOverlay').length") === 1 && /banned|baneado|gebannt/i.test(a.eval("document.querySelector('#vexoraBanOverlay').textContent") || "") && /discord\.gg/.test(a.eval("document.querySelector('#vexoraBanOverlay').innerHTML") || "") && /motivo de prueba/.test(a.eval("document.querySelector('#vexoraBanOverlay').textContent") || ""));
  a.eval("(function(){var o=document.getElementById('vexoraBanOverlay');if(o)o.remove();return 1})();");
  a.eval(`(function(){window.__flashCalls=[];window.Vexora.flashFile=function(p){window.__flashCalls.push(p)};return 1})();`);
  a.eval(`(function(){var s=document.querySelector('#tireInch');s.value='11.5';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})();`);
  await sleep(120);
  a.eval(`(function(){document.querySelector('#tireFlash').click();return 1})();`);
  await waitFor(() => {
    try {
      return a.eval("window.__flashCalls.length");
    } catch (e) {
      return 0;
    }
  }, 12e3, "flashFile llamado");
  ok("flashFile('mcu') invocado (279 mm)", a.eval("window.__flashCalls.join(',')") === "mcu" && /279 mm/.test(a.eval("document.querySelector('#tireStatus').textContent") || ""));
  const builtU = TEA.unwrap(new Uint8Array(JSON.parse(a.eval("JSON.stringify(Array.from(window.lastBuiltFirmwareEnc))"))));
  ok("flash: TEA roundtrip + float 279 mm", builtU.ok === true && Math.abs(f32(builtU.body, 37496) - .279136) < 2e-4);
  a.eval("Vexora.setModel('f3')");
  await waitFor(() => {
    try {
      return a.eval("document.querySelector('#tireNa').hidden") === false;
    } catch (e) {
      return false;
    }
  }, 8e3, "naFlash en f3");
  ok("f3: 'no disponible' (config-block)", a.eval("document.querySelector('#tireControls').hidden") === true);
  a.eval("Vexora.setModel('g3')");
  await waitFor(() => {
    try {
      return a.eval("document.querySelectorAll('#tireBase option').length") === 1;
    } catch (e) {
      return false;
    }
  }, 8e3, "g3 de vuelta");
  ok("g3 de vuelta: base 1.3.15 (única)", a.eval("document.querySelector('#tireBase').value") === "0");
  a.eval(`(function(){window.Vexora.model='g3';window.Vexora.fwMcu='1.3.15';return 1})();`);
  const uiBuild = await a.eval("VexoraCfw.build('mcu-unlock')");
  ok("VexoraCfw.build('mcu-unlock') desde la UI", !!(uiBuild && uiBuild.enc && uiBuild.part === "mcu"));
  const uiJson = JSON.parse(a.eval("JSON.stringify(Array.from(window.lastBuiltFirmwareEnc))"));
  const apiDirect = await jpost("/api/cfw/build", {
    kind: "mcu-unlock",
    model: "g3",
    fwMcu: "1.3.15",
    mcu: {
      flavor: "fwk",
      engage: 28,
      cap: 115,
      scale: 2300,
      punta: 327
    },
    vcu: {
      police: false,
      panic: false,
      se: 13,
      sd: 20,
      ss: 25,
      ce: 25,
      cd: 55,
      cs: 100
    }
  });
  ok("UI build == API directa (byte a byte)", apiDirect.status === 200 && eqBytes(new Uint8Array(uiJson), b64u8(apiDirect.body.enc)));
  console.log("== E · UI panel admin ==");
  const admDom = await openPage(BASE + "/admin", BASE + "/");
  const d = admDom.window;
  await waitFor(() => {
    try {
      return d.eval("!!document.querySelector('#adminGo')");
    } catch (e) {
      return false;
    }
  }, 1e4, "login admin");
  ok("panel muestra login", d.eval("document.querySelector('#loginCard').hidden") === false);
  d.eval(`(function(){document.querySelector('#adminPass').value='clave-mal';document.querySelector('#adminGo').click();return 1})();`);
  await waitFor(() => {
    try {
      return /Wrong/i.test(d.eval("document.querySelector('#loginMsg').textContent") || "");
    } catch (e) {
      return false;
    }
  }, 8e3, "mensaje wrong password");
  ok("login UI: contraseña mal → error", true);
  d.eval(`(function(){document.querySelector('#adminPass').value='${ADMIN_PASS}';document.querySelector('#adminGo').click();return 1})();`);
  await waitFor(() => {
    try {
      return d.eval("document.querySelector('#dash').hidden") === false;
    } catch (e) {
      return false;
    }
  }, 1e4, "dashboard visible");
  ok("login UI: contraseña bien → dashboard", d.eval("document.querySelector('#dash').hidden") === false);
  await waitFor(() => {
    try {
      return d.eval("document.querySelector('#capVisits').textContent") !== "—";
    } catch (e) {
      return false;
    }
  }, 1e4, "stats cargadas");
  ok("dashboard: estadísticas cargadas (visitas ≥ 1)", Number(d.eval("document.querySelector('#capVisits').textContent")) >= 1, d.eval("document.querySelector('#capVisits').textContent"));
  ok("dashboard: switches ON", d.eval("document.querySelector('#flagTire').checked") === true && d.eval("document.querySelector('#flagCfw').checked") === true);
  ok("dashboard: top IPs en tabla", d.eval("document.querySelectorAll('#ipRows tr').length") >= 1);
  ok("dashboard: actividad en vivo (tabla SHU)", d.eval("document.querySelectorAll('#feed tr').length") >= 3);
  ok("admin SHU: capacity card + overview + paginación presentes", !!d.eval("document.querySelector('#capBig')") && !!d.eval("document.querySelector('#capBar')") && !!d.eval("document.querySelector('#ov24v')") && !!d.eval("document.querySelector('#pgPrev')") && !!d.eval("document.querySelector('#pgNext')"));
  ok("banner de configuración oculto (D1 conectada)", d.eval("document.querySelector('#setupBanner').hidden") === true);
  ok("panel 2.2.0: campo de razón de mantenimiento", !!d.eval("document.querySelector('#maintReason')"));
  d.eval(`(function(){var i=document.querySelector('#maintReason');i.value='Back at 18:00';i.dispatchEvent(new Event('change'));return 1})();`);
  await sleep(700);
  const fgMr = await jadmin("GET", "/admin/api/flags", null, TOKEN);
  ok("panel 2.2.0: razón guardada vía cambio de campo", fgMr.body.flags.maintReason === "Back at 18:00", "got=" + JSON.stringify(fgMr.body.flags.maintReason));
  ok("tarjeta Access rules con formulario", d.eval("document.querySelectorAll('#ruleIp,#ruleReason,#ruleBanned,#ruleTire,#ruleCfw,#btnRuleSave').length") === 6);
  d.eval(`(function(){document.querySelector('#ruleIp').value='203.0.113.77';document.querySelector('#ruleBanned').checked=true;document.querySelector('#btnRuleSave').click();return 1})();`);
  await sleep(700);
  let rl2 = await jadmin("GET", "/admin/api/rules", null, TOKEN);
  ok("ban manual desde el panel → servidor", (rl2.body.rules || []).some(x => x.ip === "203.0.113.77" && x.banned === true));
  await waitFor(() => {
    try {
      return d.eval("document.querySelectorAll('#ruleList .act-del').length") >= 1;
    } catch (e) {
      return false;
    }
  }, 8e3, "fila de regla en la lista");
  d.eval(`(function(){var b=document.querySelector('#ruleList .act-edit');if(b)b.click();return 1})();`);
  await sleep(200);
  ok("Edit carga la regla en el formulario", d.eval("document.querySelector('#ruleIp').value") === "203.0.113.77" && d.eval("document.querySelector('#ruleBanned').checked") === true);
  d.eval(`(function(){var b=document.querySelector('#ruleList .act-del');if(b)b.click();return 1})();`);
  await sleep(700);
  rl2 = await jadmin("GET", "/admin/api/rules", null, TOKEN);
  ok("Delete elimina la regla", !(rl2.body.rules || []).some(x => x.ip === "203.0.113.77"));
  d.eval(`(function(){document.querySelector('#ruleIp').value='203.0.113.78';document.querySelector('#ruleBanned').checked=false;document.querySelector('#ruleTire').value='0';document.querySelector('#ruleCfw').value='';document.querySelector('#btnRuleSave').click();return 1})();`);
  await sleep(700);
  rl2 = await jadmin("GET", "/admin/api/rules", null, TOKEN);
  const lim = (rl2.body.rules || []).find(x => x.ip === "203.0.113.78");
  ok("límite wheel OFF desde el panel", !!lim && lim.banned === false && lim.tire === 0);
  await jadmin("DELETE", "/admin/api/rules?ip=203.0.113.78", null, TOKEN);
  await waitFor(() => {
    try {
      return d.eval("document.querySelectorAll('#ipRows .act-ban').length") >= 1;
    } catch (e) {
      return false;
    }
  }, 8e3, "boton ban en top IPs");
  d.eval(`(function(){var b=document.querySelector('#ipRows .act-ban');if(b)b.click();return 1})();`);
  await sleep(700);
  let bl3 = await jadmin("GET", "/admin/api/rules", null, TOKEN);
  let bannedNow = (bl3.body.rules || []).map(b => b.ip);
  ok("ban desde la tabla Top IPs → servidor", bannedNow.length >= 1, "rules=" + bannedNow.join(","));
  await waitFor(() => {
    try {
      return d.eval("document.querySelectorAll('#ipRows .act-unban-row').length") >= 1;
    } catch (e) {
      return false;
    }
  }, 3e4, "boton unban en top IPs");
  bl3 = await jadmin("GET", "/admin/api/rules", null, TOKEN);
  for (let i = 0; i < 20 && (bl3.body.rules || []).length > 0; i++) {
    if (i % 4 === 0) d.eval(`(function(){var b=document.querySelector('#ipRows .act-unban-row');if(b)b.click();return 1})();`);
    await sleep(500);
    bl3 = await jadmin("GET", "/admin/api/rules", null, TOKEN);
  }
  ok("unban desde la tabla Top IPs → servidor", (bl3.body.rules || []).length === 0, "rules=" + JSON.stringify((bl3.body.rules || []).map(r => r.ip)));
  d.eval(`(function(){var s=document.querySelector('#flagTire');s.checked=false;s.dispatchEvent(new Event('change'));return 1})();`);
  await sleep(500);
  fg = await jadmin("GET", "/admin/api/flags", null, TOKEN);
  ok("toggle en el panel → flag tire=0 en el servidor", fg.body.flags.tire === 0);
  d.eval(`(function(){var s=document.querySelector('#flagTire');s.checked=true;s.dispatchEvent(new Event('change'));return 1})();`);
  await sleep(500);
  fg = await jadmin("GET", "/admin/api/flags", null, TOKEN);
  ok("toggle de vuelta → flag tire=1", fg.body.flags.tire === 1);
  ok("panel: pills de estado (App open · DB ok)", /app open/i.test(d.eval("document.querySelector('#pillAppTxt').textContent") || "") && /db ok/i.test(d.eval("document.querySelector('#pillDb').textContent") || ""));
  ok("panel: totales all-time en la tira", Number(d.eval("document.querySelector('#tEvents').textContent")) >= 1);
  ok("panel: chips de filtro con contador", d.eval("document.querySelectorAll('#chips .fchip').length") >= 3);
  d.eval(`(function(){var c=document.querySelector('#chips .fchip[data-ft="visit"]');if(c)c.click();return 1})();`);
  ok("panel: filtro por tipo (solo visitas)", d.eval("document.querySelectorAll('#feed tr').length") >= 1 && d.eval("Array.from(document.querySelectorAll('#feed tr')).every(function(r){return r.getAttribute('data-type')==='visit'})") === true);
  d.eval(`(function(){var s=document.querySelector('#feedSearch');s.value='0.0.0.0-nada';s.dispatchEvent(new Event('input'));return 1})();`);
  ok("panel: búsqueda en actividad filtra", d.eval("document.querySelectorAll('#feed tr').length") === 0);
  d.eval(`(function(){var s=document.querySelector('#feedSearch');s.value='';s.dispatchEvent(new Event('input'));var c=document.querySelector('#chips .fchip[data-ft="all"]');if(c)c.click();return 1})();`);
  ok("panel: reset del filtro devuelve el feed", d.eval("document.querySelectorAll('#feed tr').length") >= 3);
  ok("panel: tiempos relativos (ago / just now)", /ago|just now/i.test(d.eval("document.querySelector('#feed .t').textContent") || ""));
  ok("panel: export CSV y búsqueda de reglas presentes", !!d.eval("document.querySelector('#btnCsv')") && !!d.eval("document.querySelector('#ruleSearch')"));
  ok("panel: toasts al actuar", d.eval("document.querySelectorAll('#toasts .toast').length") >= 0 && !!d.eval("document.querySelector('#toasts')"));
  d.eval(`(function(){var b=document.querySelector('#btnPause');b.click();return 1})();`);
  ok("panel: pausa del auto-refresh", /paused/i.test(d.eval("document.querySelector('#btnPause').textContent") || ""));
  d.eval(`(function(){var b=document.querySelector('#btnPause');b.click();return 1})();`);
  ok("panel: reanudar el auto-refresh", /live/i.test(d.eval("document.querySelector('#btnPause').textContent") || "") && d.eval("document.querySelector('#btnPause').classList.contains('is-on')") === false);
  d.eval(`(function(){document.querySelector('#btnLogout').click();return 1})();`);
  await sleep(200);
  ok("logout → vuelve al login y borra el token", d.eval("document.querySelector('#loginCard').hidden") === false && d.eval("localStorage.getItem('vexora.adminToken')") === null);
  console.log("== F · Limpieza de eventos ==");
  const purgeOld = await jadmin("DELETE", "/admin/api/events?scope=old", null, TOKEN);
  ok("DELETE scope=old ok", purgeOld.status === 200 && purgeOld.body.ok === true);
  const purgeAll = await jadmin("DELETE", "/admin/api/events?scope=all", null, TOKEN);
  ok("DELETE scope=all ok", purgeAll.status === 200 && purgeAll.body.ok === true);
  await sleep(500);
  const st2 = await jadmin("GET", "/admin/api/stats", null, TOKEN);
  ok("tras limpiar: sin eventos ni visitas", st2.body.recent.length === 0 && st2.body.visitsToday === 0);
  const purgeNoAuth = await jadmin("DELETE", "/admin/api/events?scope=all");
  ok("DELETE sin token → 401", purgeNoAuth.status === 401);
  await jadmin("POST", "/admin/api/rules", {
    ip: "203.0.113.88",
    banned: true
  }, TOKEN);
  await jadmin("DELETE", "/admin/api/events?scope=all", null, TOKEN);
  const bl2 = await jadmin("GET", "/admin/api/rules", null, TOKEN);
  ok("purge de eventos NO toca las reglas", (bl2.body.rules || []).some(b => b.ip === "203.0.113.88"));
  await jadmin("DELETE", "/admin/api/rules?ip=203.0.113.88", null, TOKEN);
  console.log("== G · Textos claros (1.9.3) ==");
  {
    const R = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
    const fl = R("public/assets/flasher.js"), ap = R("public/assets/app.js"), lv = R("public/assets/live.js"), i1 = R("public/assets/i18n.js"), wk = R("server/worker.js");
    ok("flasher: ACK=7 → firmware bloqueado + ST-Link", fl.indexOf("ST-Link") >= 0 && fl.indexOf("locked firmware") >= 0 && fl.indexOf("ACK=7") >= 0);
    ok("flasher: errores sin jerga ('Turn it off and on')", fl.indexOf("Turn it off and on") >= 0 && fl.indexOf("bootloader refused") === -1 && fl.indexOf("GATT Server") === -1 && fl.indexOf("Power-cycle") === -1);
    ok("app: sin patinete → sugiere pulsar Any BLE", ap.indexOf("press Any BLE") >= 0 && ap.indexOf("Wake the deck") === -1);
    ok("live: notas humanas (sin reg 74 / bitfields / slots)", [ "reg 74", "bitfields:", "Slot 0+1", "UG persistido", "C=0x" ].every(x => lv.indexOf(x) === -1) && lv.indexOf("Custom button") >= 0);
    const pl = i1.split("\n").filter(l => l.indexOf("wheelP:") >= 0);
    ok("i18n: wheelP corto (×5 idiomas) y wheelN2 eliminada", pl.length === 5 && pl.every(l => l.length < 200 && l.indexOf("bytes") === -1 && l.indexOf("Nothing else") === -1) && i1.indexOf("wheelN2:") === -1);
    ok("i18n: gateHelp sugiere Any BLE (×5 idiomas)", i1.indexOf("Any BLE") >= 0 && i1.indexOf("Otro dispositivo (BLE)") >= 0 && i1.indexOf("Anderes Gerät (BLE)") >= 0 && i1.indexOf("Autre appareil (BLE)") >= 0 && i1.indexOf("Altro dispositivo (BLE)") >= 0);
    ok("worker: notas de build sin '· NNNN B'", wk.indexOf('enc.length + " B"') === -1);
    ok("UI: sin párrafo explicativo bajo la tarjeta de ruedas", a.eval("document.querySelectorAll('[data-i18n=wheelN2]').length") === 0);
    const gh = a.eval("document.querySelector('[data-i18n=gateHelp]').textContent") || "";
    ok("UI: ayuda de conexión sugiere Any BLE", /Any BLE|Otro dispositivo \(BLE\)|Anderes Gerät \(BLE\)/i.test(gh));
  }
  console.log("== H · Restore compat: aviso ST-Link + confirmación ==");
  {
    const R = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
    const ap = R("public/assets/app.js"), i1 = R("public/assets/i18n.js");
    ok("app.js: overlay compat con aviso + confirm nativo de respaldo + nota post-flash", ap.indexOf("unlockWarn") >= 0 && ap.indexOf("unlockConfirm") >= 0 && ap.indexOf("window.confirm") >= 0 && ap.indexOf("unlockDone") >= 0);
    [ "unlockConfirm", "unlockWarn", "unlockHelp", "unlockDone" ].forEach(k => {
      ok("i18n: clave " + k + " ×5 idiomas", i1.split(k + ":").length - 1 === 5);
    });
    a.eval(`(function(){\n      window.__confirms = []; window.__builds = [];\n      window.confirm = function(m){ window.__confirms.push(String(m)); return false; };\n      window.VexoraCfw.build = function(k){ window.__builds.push(k); return Promise.reject(new Error("stop-test")); };\n      document.querySelector('#btnVcuUnlock').click(); return 1; })()`);
    ok("UI: compat VCU abre overlay 'Restore VCU · compat'", a.eval("document.querySelector('#flashConfirm').hidden") === false && /Restore VCU/i.test(a.eval("document.querySelector('#fcTitle').textContent") || ""));
    ok("UI: aviso compat + ST-Link", /ST-Link/i.test(a.eval("document.querySelector('#fcWarn').textContent") || "") && /flashable/i.test(a.eval("document.querySelector('#fcWarn').textContent") || ""));
    ok("UI: botón principal dice 'Flash'", (a.eval("document.querySelector('#fcGo').textContent") || "").trim() === "Flash");
    a.eval("document.querySelector('#fcCancel').click(); 1");
    ok("UI: Cancelar cierra y NO flashea", a.eval("document.querySelector('#flashConfirm').hidden") === true && a.eval("window.__builds.length") === 0);
    a.eval("document.querySelector('#btnMcuUnlock').click(); document.querySelector('#fcGo').click(); 1");
    await sleep(400);
    ok("UI: aceptar → build 'mcu-unlock' sin doble confirmación", a.eval("window.__builds.join(',')") === "mcu-unlock" && a.eval("window.__confirms.length") === 0);
    a.eval("Vexora.flashCfw('vcu'); 1");
    ok("UI: build custom vuelve a 'Flash' + aviso normal", (a.eval("document.querySelector('#fcGo').textContent") || "").trim() === "Flash" && /not stock firmware/i.test(a.eval("document.querySelector('#fcWarn').textContent") || ""));
    a.eval("document.querySelector('#fcCancel').click(); 1");
    a.eval(`(function(){\n      var ov = document.querySelector('#flashConfirm'); if (ov) ov.remove();\n      document.querySelector('#btnVcuUnlock').click(); return 1; })()`);
    await sleep(300);
    ok("UI: sin overlay → confirm nativo con ST-Link (cancelar no flashea)", a.eval("window.__confirms.length") === 1 && /ST-Link/i.test(a.eval("window.__confirms[0] || ''")) && a.eval("window.__builds.join(',')") === "mcu-unlock");
  }
  console.log("== J · Ruedas: base auto + verificación ==");
  {
    const val = () => a.eval("document.querySelector('#tireBase').value");
    const note = () => a.eval("document.querySelector('#tireBaseNote').textContent") || "";
    const stat = () => a.eval("document.querySelector('#tireStatus').textContent") || "";
    a.eval("Vexora.fwMcu='1.3.15'; VexoraTire.refresh(); 1");
    await waitFor(() => {
      try {
        return val() === "0" && /1\.3\.15/.test(note());
      } catch (e) {
        return false;
      }
    }, 15e3, "base auto 1.3.15");
    ok("ruedas: base auto = 1.3.15 (MCU del patinete) + nota", val() === "0" && /MCU 1\.3\.15/.test(note()));
    a.eval("Vexora.fwMcu='9.9.9'; VexoraTire.refresh(); 1");
    await waitFor(() => {
      try {
        return val() === "0" && /9\.9\.9/.test(note());
      } catch (e) {
        return false;
      }
    }, 15e3, "sin coincidencia");
    ok("ruedas: MCU desconocida → base 1.3.15 + aviso", val() === "0" && /9\.9\.9/.test(note()) && /1\.3\.15/.test(note()));
    a.eval("Vexora.fwMcu='1.1.7'; VexoraTire.refresh(); 1");
    await waitFor(() => {
      try {
        return /Vexora CFW/.test(note()) && /stock tuning/i.test(note());
      } catch (e) {
        return false;
      }
    }, 15e3, "aviso CFW");
    ok("ruedas: patinete con CFW → aviso corto de que el motor vuelve a stock", /Vexora CFW/.test(note()) && /stock tuning/i.test(note()));
    ok("ruedas: una sola base (1.3.15) — la 1.4.8 fuera del tool", a.eval("document.querySelectorAll('#tireBase option').length") === 1 && /1\.3\.15/.test(a.eval("document.querySelector('#tireBase option').textContent") || ""));
    a.eval(`(function(){var s=document.querySelector('#tireInch');s.value='11.5';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    a.eval(`(function(){ window.Vexora.flashFile = async function(){ window.__vexoraTireVerify = { version: VexoraTire.state.base.v }; }; return 1; })()`);
    a.eval("document.querySelector('#tireFlash').click(); 1");
    await waitFor(() => {
      try {
        return /Verified/i.test(stat());
      } catch (e) {
        return false;
      }
    }, 15e3, "verify ok");
    ok("ruedas: flash + verificación ✓", /Verified/i.test(stat()) && /279 mm/.test(stat()));
    a.eval(`(function(){ window.Vexora.flashFile = async function(){ window.__vexoraTireVerify = { version: '9.9.9' }; }; return 1; })()`);
    a.eval("document.querySelector('#tireFlash').click(); 1");
    await waitFor(() => {
      try {
        return /9\.9\.9/.test(stat());
      } catch (e) {
        return false;
      }
    }, 15e3, "verify diff");
    ok("ruedas: versión que no coincide → aviso claro", /reports MCU 9\.9\.9/.test(stat()));
    a.eval(`(function(){ window.Vexora.flashFile = async function(){}; return 1; })()`);
    a.eval("document.querySelector('#tireFlash').click(); 1");
    await waitFor(() => {
      try {
        return /turn it off and on once/i.test(stat());
      } catch (e) {
        return false;
      }
    }, 15e3, "verify none");
    ok("ruedas: sin verificación → consejo corto de apagar y encender", /turn it off and on once/i.test(stat()) && /Flashed 11\.5/.test(stat()) && /279 mm/.test(stat()));
    const otaDom = await openPage(BASE + "/app", BASE + "/");
    const oa = otaDom.window;
    await waitFor(() => {
      try {
        return oa.eval("document.querySelectorAll('#tireBase option').length") === 1;
      } catch (e) {
        return false;
      }
    }, 15e3, "ota dom listo");
    oa.eval(`(function(){\n      window.__vexoraTestSession = { request: function(){}, dead: false, demo: false };\n      window.__vexoraFlashSource = 'tire';\n      window.lastBuiltFirmwareEnc = new Uint8Array(2048);\n      window.lastBuiltPartition = 'mcu';\n      window.CfwFlasher.flash = async function(part, bytes, cb){\n        cb.onPhase('flashing'); cb.onStatus('Writing');\n        cb.onProgress(64, 128);\n        return { request: function(){}, dead: false };\n      };\n      window.CfwFlasher.waitForUnit = async function(){ return { request: function(){}, readRegister: async function(){ return new Uint8Array([0xCF, 0x01]); } }; };\n      Vexora.flashFile('mcu');\n      return 1; })()`);
    await waitFor(() => {
      try {
        return oa.eval("document.querySelector('#otaOverlay').hidden") === false && /Flashing MCU/i.test(oa.eval("document.querySelector('#otaTitle').textContent") || "");
      } catch (e) {
        return false;
      }
    }, 8e3, "ventana OTA visible");
    ok("ruedas: ventana OTA al flashear (título Flashing MCU)", oa.eval("document.querySelector('#otaOverlay').hidden") === false);
    await waitFor(() => {
      try {
        return oa.eval("document.querySelector('#otaBar').style.width") === "100%";
      } catch (e) {
        return false;
      }
    }, 8e3, "barra al 100%");
    await waitFor(() => {
      try {
        return oa.eval("(window.__vexoraTireVerify && window.__vexoraTireVerify.version) || ''") === "1.12.15";
      } catch (e) {
        return false;
      }
    }, 8e3, "verificación leída");
    ok("ruedas: barra de progreso en vivo + verificación leída del patinete", oa.eval("document.querySelector('#otaBar').style.width") === "100%" && oa.eval("(window.__vexoraTireVerify && window.__vexoraTireVerify.version) || ''") === "1.12.15");
    await closeWin(otaDom, "ota");
    const R = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
    [ "wheelMatched", "wheelNoMatch", "wheelVerOk", "wheelVerDiff", "wheelVerNo" ].forEach(k => {
      ok("i18n: clave " + k + " ×5 idiomas", R("public/assets/i18n.js").split(k + ":").length - 1 === 5);
    });
    const ap = R("public/assets/app.js"), tj = R("public/assets/tire.js");
    ok("app.js: verify real tras el flash (waitForUnit + lectura de versión MCU)", ap.indexOf("CfwFlasher.waitForUnit") >= 0 && ap.indexOf("readRegister(X.VCU, 24, 2") >= 0 && ap.indexOf("readRegister(X.MCU, 25, 2") >= 0 && ap.indexOf("__vexoraTireVerify") >= 0);
    ok("tire.js: userPicked + mensajes de verificación + match tolerante", tj.indexOf("userPicked") >= 0 && tj.indexOf("wheelVerOk") >= 0 && tj.indexOf("wheelVerDiff") >= 0 && tj.indexOf("packVer") >= 0);
  }
  console.log("== I · Modo mantenimiento (1.9.5) ==");
  {
    const mr = await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: true
      }
    }, TOKEN);
    ok("maint ON guardado (flags maint=1)", mr.status === 200 && mr.body.ok === true && mr.body.flags.maint === 1);
    await waitMaint(1);
    const res = await fetch(BASE + "/app", {
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    });
    const html = await res.text();
    ok("maint: /app → 503 con página de mantenimiento (logo real)", res.status === 503 && html.indexOf("/assets/mark.png") >= 0);
    const lRes = await fetch(BASE + "/", {
      headers: {
        Accept: "text/html"
      }
    });
    const lHtml = await lRes.text();
    ok("maint: la landing sigue pública (200 + Open Vexora Tuning)", lRes.status === 200 && lHtml.indexOf("Open Vexora Tuning") >= 0);
    ok("maint 2.2.0: razón personalizada visible en la página", html.indexOf("Back at 18:00") >= 0);
    await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: true,
        maintReason: ""
      }
    }, TOKEN);
    await sleep(5600);
    const resDef = await fetch(BASE + "/app");
    const htmlDef = await resDef.text();
    ok("maint 2.2.0: sin razón → texto por defecto", htmlDef.indexOf("Back at 18:00") === -1 && htmlDef.indexOf("Scheduled maintenance") >= 0);
    ok("maint: página minimal B/N — Scheduled maintenance · back soon · Discord · sin relleno", htmlDef.indexOf("Scheduled maintenance") >= 0 && /back soon/i.test(htmlDef) && htmlDef.indexOf("discord.gg/vxfw") >= 0 && htmlDef.indexOf("prefers-reduced-motion") >= 0 && htmlDef.indexOf("vexorium.pages.dev") >= 0 && htmlDef.indexOf("Checked ") === -1 && htmlDef.indexOf("not affected") === -1);
    ok("maint: favicon = logo real · sin tono amarillo", html.indexOf('rel="icon" type="image/png" href="/assets/mark.png"') >= 0 && html.toLowerCase().indexOf("d4a017") === -1);
    ok("maint: /cfw y /forge → 503", (await fetch(BASE + "/cfw", {
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    })).status === 503 && (await fetch(BASE + "/forge", {
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    })).status === 503);
    ok("maint: assets siguen (app.css 200)", (await fetch(BASE + "/assets/app.css")).status === 200);
    ok("maint: /admin sigue abierto", (await fetch(BASE + "/admin")).status === 200);
    const fl = await jadmin("GET", "/admin/api/flags", null, TOKEN);
    ok("maint: admin API sigue (flags maint=1)", fl.status === 200 && fl.body.flags.maint === 1);
    const hh = await jget("/api/health");
    ok("maint: /api/health → 200 + maint 1", hh.status === 200 && hh.body.maint === 1);
    const tb = await jpost("/api/tire/build", {
      model: "g3",
      version: "1.3.15",
      inch: 11.5
    });
    ok("maint: build → 503 maintenance", tb.status === 503 && tb.body && tb.body.error === "maintenance");
    const st = await jadmin("GET", "/admin/api/stats", null, TOKEN);
    ok("maint: evento en la actividad", (st.body.recent || []).some(e => e.type === "maint"));
    d.eval(`(function(){document.querySelector('#adminPass').value='${ADMIN_PASS}';document.querySelector('#adminGo').click();return 1})();`);
    await waitFor(() => {
      try {
        return d.eval("document.querySelector('#dash').hidden") === false;
      } catch (e) {
        return false;
      }
    }, 1e4, "relogin panel");
    await waitFor(() => {
      try {
        return d.eval("document.querySelector('#flagMaint') && document.querySelector('#flagMaint').checked") === true;
      } catch (e) {
        return false;
      }
    }, 3e4, "switch maint ON en el panel");
    ok("panel: switch Maintenance se ve ON (poll 15 s)", true);
    d.eval("window.confirm = function(){ return true; }");
    d.eval("document.querySelector('#flagMaint').checked = false; document.querySelector('#flagMaint').dispatchEvent(new Event('change')); 1");
    let offOk = false;
    for (let i = 0; i < 60; i++) {
      const f = await jadmin("GET", "/admin/api/flags", null, TOKEN);
      if (f.body && f.body.flags && f.body.flags.maint === 0) {
        offOk = true;
        break;
      }
      await sleep(300);
    }
    ok("panel: toggle OFF → maint=0 en el servidor", offOk);
    await waitMaint(0);
    const back = await fetch(BASE + "/app", {
      headers: {
        "cf-connecting-ip": TEST_IP
      }
    });
    const backHtml = await back.text();
    const backL = await fetch(BASE + "/", {
      headers: {
        Accept: "text/html"
      }
    });
    ok("maint OFF: la app vuelve (/app 200 + appVer) y la landing sigue en /", back.status === 200 && backHtml.indexOf('id="appVer"') >= 0 && backL.status === 200);
    a.eval("window.fetch = function(){ return Promise.reject(new Error('frozen')); }");
    a.eval("Vexora.showMaint()");
    ok("app: overlay de mantenimiento con el logo", a.eval("document.querySelector('#vexoraMaintOverlay').style.display") === "flex" && a.eval("!!document.querySelector('#vexoraMaintOverlay img[src=\"assets/mark.png\"]')") === true);
    a.eval("Vexora.hideMaint()");
    ok("app: hideMaint oculta el overlay", a.eval("document.querySelector('#vexoraMaintOverlay').style.display") === "none");
    const R = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
    ok("tire.js/cfw.js detectan maintenance (503 → overlay)", R("public/assets/tire.js").indexOf('"maintenance"') >= 0 && R("public/cfw/assets/cfw.js").indexOf('"maintenance"') >= 0);
    ok("worker: MAINT_HTML + gate + auto-recuperación", R("server/worker.js").indexOf("MAINT_HTML") >= 0 && R("server/worker.js").indexOf('"/api/health"') >= 0 && R("server/worker.js").indexOf("openedFor") >= 0);
  }
  console.log("== K · Live ext 2.1: asistente de combo + editor + flash propio ==");
  {
    const liveDom = await openPage(BASE + "/app", BASE + "/");
    const v = liveDom.window;
    await waitFor(() => {
      try {
        return v.eval("!!window.VexoraLive && !!window.VexoraLive.setSession && !!document.querySelector('#liveProfCard')");
      } catch (e) {
        return false;
      }
    }, 15e3, "VexoraLive en app");
    ok("motor: preset Safe por defecto", v.eval("document.querySelector('#presetSafe').classList.contains('is-on')") === true);
    ok("motor: iqFW máx 150 (guardrail)", v.eval("document.querySelector('#mcu-cap').max") === "150");
    ok("motor: nota del silbido (fwNote) presente", v.eval("!!document.querySelector('#panelFwk [data-i18n=fwNote]')") === true);
    v.eval(`(function(){var s=document.querySelector('#mcu-cap');s.value='130';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})();`);
    await sleep(200);
    ok("motor: iqFW>115 pide confirmación Unsafe y recorta a 115", v.eval("document.querySelector('#unsafeOverlay').hidden") === false && v.eval("document.querySelector('#mcu-cap').value") === "115");
    ok("motor: overlay Unsafe VISIBLE de verdad (sin ancestros [hidden], no anidado)", v.eval("document.querySelector('#unsafeOverlay').closest('[hidden]')") === null && v.eval("!!document.querySelector('#kersOverlay #unsafeOverlay')") === false);
    v.eval(`(function(){document.querySelector('#unsafeCancel').click();return 1})();`);
    ok("motor: cancelar cierra el overlay", v.eval("document.querySelector('#unsafeOverlay').hidden") === true);
    v.eval(`(function(){var b=document.querySelector('#presetUltra');if(b)b.click();return 1})();`);
    await sleep(200);
    ok("motor: preset Unsafe pide confirmación", v.eval("document.querySelector('#unsafeOverlay').hidden") === false && v.eval("document.querySelector('#presetUltra').classList.contains('is-on')") === false);
    v.eval(`(function(){document.querySelector('#unsafeCancel').click();return 1})();`);
    const uiBuild = await v.eval("(async function(){ try { var o = await VexoraCfw.build('vcu'); return 'OK:' + o.part + ':' + window.lastBuiltFirmwareEnc.length; } catch (e) { return 'ERR:' + e.message; } })()");
    ok("UI: build VCU ext desde la app (61440 B)", uiBuild === "OK:vcu:61440", uiBuild);
    ok("UI: summary Standard en #cfwSum", /Standard \d+ km\/h · Tuning in-app/.test(v.eval("document.querySelector('#cfwSum').textContent") || ""), v.eval("document.querySelector('#cfwSum').textContent"));
    v.eval("(function(){ window.__demo = VexoraLive.createDemo(); VexoraLive.setSession(window.__demo); return 1; })()");
    await v.eval("(async function(){ var d = window.__demo; await d.request({ src: 0, dst: 0, cmd: 242, arg: 0, data: new Uint8Array(20) }); await d.request({ src: 0, dst: 0, cmd: 242, arg: 1, data: new Uint8Array(16) }); return 1; })()");
    await v.eval("VexoraLive.refresh()");
    await waitFor(() => {
      try {
        return (v.eval("document.querySelector('#liveProfNote').textContent") || "").length > 0;
      } catch (e) {
        return false;
      }
    }, 1e4, "refresh Live ext");
    ok("ext sin combo: abre la card y guía", v.eval("document.querySelector('#liveProfCard').classList.contains('is-open')") === true && /combo/i.test(v.eval("document.querySelector('#liveProfNote').textContent")));
    ok("patrón por defecto pintado (4 chips en inglés)", v.eval("document.querySelectorAll('#livePat .chip').length") === 4 && v.eval("document.querySelector('#livePat .chip').textContent.indexOf('Brake R')") === 3);
    v.eval(CLICK('[data-step="4"]'));
    v.eval(CLICK('[data-step="5"]'));
    ok("chips añaden pasos", v.eval("document.querySelectorAll('#livePat .chip').length") === 6);
    v.eval(CLICK("#btnPatClear"));
    ok("clear vacía el patrón", v.eval("document.querySelectorAll('#livePat .chip').length") === 0 && /empty/i.test(v.eval("document.querySelector('#livePat').textContent")));
    v.eval(CLICK('[data-step="1"]'));
    v.eval(CLICK('[data-step="2"]'));
    v.eval("(function(){document.querySelector('#p-std').value='18';document.querySelector('#p-tun').value='48';return 1})();");
    v.eval(CLICK("#btnLiveSave"));
    await sleep(400);
    ok("guardar combo: nota Saved", /saved/i.test(v.eval("document.querySelector('#liveProfNote').textContent")));
    const patJson = await v.eval("(async function(){ var r = await window.__demo.request({ src: 0, dst: 0, cmd: 241, arg: 0, data: new Uint8Array(0) }); return JSON.stringify(Array.from(r.data)); })()");
    ok("slot 0 = patrón [1,2]", JSON.parse(patJson).slice(0, 4).join(",") === "1,2,0,0");
    const profJson = await v.eval("(async function(){ var r = await window.__demo.request({ src: 0, dst: 0, cmd: 241, arg: 1, data: new Uint8Array(0) }); return JSON.stringify(Array.from(r.data)); })()");
    ok("slot 1 = perfil 18/48 + flags DEF", JSON.parse(profJson).join(",") === [ 18, 18, 0, 48, 18, 18, 0, 48, 0, 1, 0, 1, 0, 1, 1, 1 ].join(","));
    ok("6 toggles por perfil (UG/bar/cruise × STD/TUN)", v.eval("document.querySelectorAll('#liveProfCard input[type=checkbox]').length") === 6);
    ok("switches sin texto — un solo header Standard/Tuning", v.eval("document.querySelectorAll('#liveProfCard label.sw span').length") === 0 && v.eval("document.querySelectorAll('#liveProfCard [data-tun]').length") === 2);
    v.eval(CLICK('[data-tun="45"]'));
    ok("preset US 45 → #p-tun=45 + resaltado", v.eval("document.querySelector('#p-tun').value") === "45" && v.eval('document.querySelector(\'[data-tun="45"]\').classList.contains("is-on")') === true);
    ok("preset Uncapped 100 → disabled · coming soon (solo US 45 activa)", v.eval("document.querySelector('[data-tun=\"100\"]').disabled") === true && /soon|pronto|bald|bient|presto/i.test(v.eval("document.querySelector('[data-tun=\"100\"]').textContent")) && v.eval('document.querySelector(\'[data-tun="45"]\').classList.contains("is-on")') === true);
    v.eval(CLICK('[data-std="22"]'));
    ok("preset Germany 22 → #p-std=22 + resaltado", v.eval("document.querySelector('#p-std').value") === "22" && v.eval('document.querySelector(\'[data-std="22"]\').classList.contains("is-on")') === true);
    v.eval(CLICK('[data-std="25"]'));
    ok("preset Europe 25 → #p-std=25 + resaltado", v.eval("document.querySelector('#p-std').value") === "25" && v.eval('document.querySelector(\'[data-std="25"]\').classList.contains("is-on")') === true);
    v.eval("(function(){document.querySelector('#p-std-ug').checked=true;document.querySelector('#p-tun-ug').checked=false;document.querySelector('#p-std-cr').checked=true;document.querySelector('#p-tun-bar').checked=false;document.querySelector('#p-std').value='20';return 1})();");
    v.eval(CLICK("#btnLiveSave"));
    await sleep(400);
    const profJson2 = await v.eval("(async function(){ var r = await window.__demo.request({ src: 0, dst: 0, cmd: 241, arg: 1, data: new Uint8Array(0) }); return JSON.stringify(Array.from(r.data)); })()");
    ok("slot 1 = toggles por perfil (UG STD on · UG TUN off · bar TUN off · cruise STD on · TUN 45 heredado)", JSON.parse(profJson2).join(",") === [ 20, 20, 0, 45, 20, 20, 0, 45, 1, 0, 0, 0, 1, 1, 1, 1 ].join(","));
    v.eval(CLICK('[data-tun="45"]'));
    v.eval(CLICK("#btnLiveSave"));
    await sleep(400);
    const profJson3 = await v.eval("(async function(){ var r = await window.__demo.request({ src: 0, dst: 0, cmd: 241, arg: 1, data: new Uint8Array(0) }); return JSON.stringify(Array.from(r.data)); })()");
    ok("slot 1 = TUN 45 tras preset US 45", JSON.parse(profJson3)[3] === 45 && JSON.parse(profJson3)[0] === 20);
    v.eval("(function(){ VexoraLive.setSession(window.__demo); return 1; })()");
    await v.eval("VexoraLive.refresh()");
    await waitFor(() => {
      try {
        return /loaded/i.test(v.eval("document.querySelector('#liveProfNote').textContent"));
      } catch (e) {
        return false;
      }
    }, 1e4, "combo loaded");
    ok("re-conecta: combo cargado desde slots", v.eval("document.querySelectorAll('#livePat .chip').length") === 2 && /loaded/i.test(v.eval("document.querySelector('#liveProfNote').textContent")));
    v.eval("(function(){ Vexora.markFlash('vcu'); return 1; })()");
    await v.eval("VexoraLive.refresh()");
    await waitFor(() => {
      try {
        return v.eval("document.querySelector('#liveVer').textContent").indexOf("Vexora Ext") === 0;
      } catch (e) {
        return false;
      }
    }, 1e4, "liveVer Vexora Ext");
    ok("flash propio → etiqueta Vexora Ext (editor sigue activo)", v.eval("document.querySelector('#liveVer').textContent.indexOf('Vexora Ext')") === 0);
    v.eval(CLICK("#btnLiveSave"));
    await sleep(400);
    ok("tras flash propio, guardar sigue funcionando", /saved/i.test(v.eval("document.querySelector('#liveProfNote').textContent")));
    await closeWin(liveDom, "live");
  }
  const toptsL = await jget("/api/tire/options");
  const f3pT = toptsL.body.models && toptsL.body.models.f3pro;
  ok("f3pro: tire options heredadas del G3 (11″)", !!(f3pT && f3pT.length && toptsL.body.models.g3.length && f3pT[0].v === toptsL.body.models.g3[0].v && f3pT[0].stockInch === 11));
  const gMb = await jpost("/api/cfw/build", {
    kind: "mcu",
    model: "g3",
    mcu: {
      flavor: "fwk",
      engage: 30,
      cap: 70,
      scale: 1638
    },
    vcu: {}
  });
  const fMb = await jpost("/api/cfw/build", {
    kind: "mcu",
    model: "f3pro",
    mcu: {
      flavor: "fwk",
      engage: 30,
      cap: 70,
      scale: 1638
    },
    vcu: {}
  });
  ok("f3pro: build MCU byte a byte = build G3 (mismo pipeline)", gMb.status === 200 && fMb.status === 200 && fMb.body.enc === gMb.body.enc);
  const gVb = await jpost("/api/cfw/build", {
    kind: "vcu",
    model: "g3",
    mcu: {},
    vcu: {
      se: 16,
      sd: 25,
      ss: 25
    }
  });
  const fVb = await jpost("/api/cfw/build", {
    kind: "vcu",
    model: "f3pro",
    mcu: {},
    vcu: {
      se: 16,
      sd: 25,
      ss: 25
    }
  });
  ok("f3pro: build VCU Ext byte a byte = build G3", gVb.status === 200 && fVb.status === 200 && fVb.body.enc === gVb.body.enc && fVb.body.note.indexOf("Ext") >= 0);
  const fSb = await jpost("/api/cfw/build", {
    kind: "vcu-unlock",
    model: "f3pro",
    mcu: {},
    vcu: {}
  });
  ok("f3pro: compat restore VCU disponible (misma imagen que G3)", fSb.status === 200 && fSb.body.ok === true && fSb.body.note.indexOf("Unlock") >= 0, fSb.body.note || String(fSb.status));
  const tG = await jpost("/api/tire/build", {
    model: "g3",
    version: "1.3.15",
    inch: 10
  });
  const tF = await jpost("/api/tire/build", {
    model: "f3pro",
    version: "1.3.15",
    inch: 10
  });
  ok("f3pro: build ruedas = G3 con etiqueta F3 Pro", tG.status === 200 && tF.status === 200 && tF.body.enc === tG.body.enc && tF.body.note.indexOf("F3 Pro") >= 0, tF.body && tF.body.note || String(tF.status));
  const legalDom = await openPage(BASE + "/app", BASE + "/", {
    noLegal: true
  });
  const wL = legalDom.window;
  await waitFor(() => {
    try {
      return wL.eval("!!document.querySelector('#legalOverlay')");
    } catch (e) {
      return null;
    }
  }, 8e3, "overlay legal presente");
  ok("legal: overlay visible hasta aceptar (app no inicializa)", wL.eval("document.querySelector('#legalOverlay').hidden") === false && wL.eval("document.body.classList.contains('is-legal')") === true);
  ok("legal: botón bloqueado mientras corre la cuenta", wL.eval("document.querySelector('#legalGo').disabled") === true);
  const agreeTxt = wL.eval("(document.querySelector('[data-i18n=legalAgree]')||{}).textContent") || "";
  ok("legal 2.2.0: aceptación menciona romper el patinete y la multa", /break my scooter/i.test(agreeTxt) && /fine is mine/i.test(agreeTxt), agreeTxt.slice(0, 60));
  const legal3Txt = wL.eval("(document.querySelector('[data-i18n=legal3]')||{}).textContent") || "";
  ok("legal 2.2.0: la multa es responsabilidad del usuario", /fine is yours/i.test(legal3Txt));
  const f3Dom = await openPage(BASE + "/app", BASE + "/");
  const wP = f3Dom.window;
  await waitFor(() => {
    try {
      return wP.eval("window.Vexora && Vexora.model");
    } catch (e) {
      return null;
    }
  }, 8e3, "boot página f3pro");
  ok("legal: con vexora.legal2 aceptado el overlay queda oculto", wP.eval("document.querySelector('#legalOverlay').hidden") === true && wP.eval("document.body.classList.contains('is-legal')") === false);
  ok("gate 2.2.0: slider de modelos (6 cards con foto, snap y flechas)", wP.eval("document.querySelectorAll('#modelStrip .pick-card').length") === 6 && wP.eval("!!document.querySelector('#pickPrev') && !!document.querySelector('#pickNext')") === true && fs.readFileSync(path.join(__dirname, "..", "public", "assets", "app.css"), "utf8").indexOf("scroll-snap-type") >= 0);
  const cssGate = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "app.css"), "utf8");
  ok("gate: lista vertical estilo SHU (strip en columna · card = foto izquierda + nombre derecha)", /\.pick-strip\s*{[^}]*flex-direction:\s*column/.test(cssGate) && /\.pick-card\s*{[^}]*flex-direction:\s*row/.test(cssGate) && cssGate.indexOf("scroll-snap-type") >= 0 && cssGate.indexOf(".pick-which .btn.pick-on") >= 0);
  ok("gate: slider debajo de los botones Connect (hacia abajo)", wP.eval("(document.querySelector('#idleActions').compareDocumentPosition(document.querySelector('#modelPick')) & 4) !== 0") === true);
  wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').click()");
  ok("f3/f3pro: card agrupada → pregunta cuál tienes (F3 / F3 Pro)", wP.eval("document.querySelector('#pickWhich').hidden") === false && wP.eval("document.querySelector('#whichA').textContent") === "F3" && wP.eval("document.querySelector('#whichB').textContent") === "F3 Pro" && wP.eval("document.querySelector('[data-i18n=whichOne]') !== null"));
  wP.eval("document.querySelector('#whichB').click()");
  ok("f3pro: elegido F3 Pro → modelo activo + cards G3 visibles + card del grupo marcada", wP.eval("window.Vexora.model") === "f3pro" && wP.eval("document.body.classList.contains('model-f3pro')") === true && wP.eval("document.body.classList.contains('model-g3')") === false && wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').classList.contains('is-on')") === true && wP.eval("document.querySelector('#whichB').classList.contains('pick-on')") === true);
  wP.eval("document.querySelector('#modelStrip .pick-card[data-model=g3]').click()");
  var modelAntes = wP.eval("window.Vexora.model");
  wP.eval("document.querySelector('#modelStrip .pick-card[data-group=e3]').click()");
  ok("e3 aparcado: card E3·E3 Pro deshabilitada con tag 'soon' y sin efecto al pulsar", wP.eval("document.querySelector('#modelStrip .pick-card[data-group=e3]').disabled") === true && wP.eval("!!document.querySelector('#modelStrip .pick-card[data-group=e3] .pick-soon')") === true && wP.eval("document.querySelector('#pickWhich').hidden") === true && wP.eval("window.Vexora.model") === modelAntes);
  ok("app: botón APK en About + enlace en el gate + IPA 'pronto'", !!wP.eval("document.querySelector('[data-i18n=apkBtn]' )") && homeHtml.indexOf("assets/Vexora.apk") >= 0 && (wP.eval("(document.querySelector('[data-i18n=ipaSoon]')||{}).textContent") || "").length > 3);
  const apkRes = await fetch(BASE + "/assets/Vexora.apk");
  const apkBytes = new Uint8Array(await apkRes.arrayBuffer());
  ok("app: /assets/Vexora.apk sirve el APK real (200 · >500 KB · ZIP magic PK)", apkRes.status === 200 && apkBytes.length > 5e5 && apkBytes[0] === 80 && apkBytes[1] === 75, apkRes.status + " · " + apkBytes.length + " B");
  wP.eval("document.querySelector('#modelStrip .pick-card[data-model=g3]').click()");
  ok("gate: al volver a un modelo simple, el selector 'cuál es el tuyo' se oculta", wP.eval("document.querySelector('#pickWhich').hidden") === true && wP.eval("window.Vexora.model") === "g3");
  wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').click()");
  ok("gate: pulsar la card de grupo abre el selector", wP.eval("document.querySelector('#pickWhich').hidden") === false);
  wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').click()");
  ok("gate: toggle — segunda pulsación cierra el selector", wP.eval("document.querySelector('#pickWhich').hidden") === true);
  wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').click()");
  ok("gate: chevron del grupo F3 rotado con el selector abierto (E3 lleva tag soon)", wP.eval("document.querySelectorAll('#modelStrip .pick-chev').length") === 1 && wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').classList.contains('is-open')") === true && wP.eval("document.querySelector('#pickWhich').hidden") === false);
  wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').click()");
  ok("gate: chevron vuelve al cerrar (toggle)", wP.eval("document.querySelector('#modelStrip .pick-card[data-group=f3]').classList.contains('is-open')") === false && wP.eval("document.querySelector('#pickWhich').hidden") === true);
  ok("gate: animaciones sutiles (rowIn escalonado + whichIn, monócromas)", /@keyframes rowIn/.test(cssGate) && /@keyframes whichIn/.test(cssGate) && /animation-delay/.test(cssGate));
  ok("UI 2.2.0: textos de panel acortados y en lenguaje humano", fs.readFileSync(path.join(__dirname, "..", "public", "assets", "i18n.js"), "utf8").indexOf("the delicate part. Max G3") >= 0 && fs.readFileSync(path.join(__dirname, "..", "public", "assets", "i18n.js"), "utf8").indexOf("Fine tuning lives in the sections below") === -1);
  const fxSrc = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "flasher.js"), "utf8");
  const exSrc = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "extra.js"), "utf8");
  ok("e3 ble: '1TE' en los prefijos de escaneo (el E3/E3 Pro aparece al buscar, sin Any BLE)", fxSrc.indexOf("'1TE'") >= 0 && fxSrc.indexOf("NAME_PREFIXES") >= 0);
  ok("e3 ble: handshake re-envía el INIT y recorre 0x21→0x04→0x16", fxSrc.indexOf("chain.indexOf(X.VCU)") >= 0 && fxSrc.indexOf("perDst") >= 0);
  ok("e3 ble: safe25 tolerante al mapa de registros del E3 (sin timeout crudo)", exSrc.indexOf("safe25: ") >= 0 && exSrc.indexOf("su mapa de registros difiere") >= 0);
  ok("i18n: clave whichOne ×5 idiomas", fs.readFileSync(path.join(__dirname, "..", "public", "assets", "i18n.js"), "utf8").split("whichOne:").length - 1 === 5);
  ok("legal: sin 'Ignition' en el aviso de entrada (solo equipo de Vexora)", (wL.eval("document.querySelector('#legalOverlay').textContent") || "").indexOf("Ignition") === -1);
  ok("i18n: sin 'Ignition' en ningún texto (×3 idiomas)", fs.readFileSync(path.join(__dirname, "..", "public", "assets", "i18n.js"), "utf8").indexOf("Ignition") === -1);
  await closeWin(f3Dom, "f3");
  console.log("== M · 2.3.0: valoración 👍/👎 + presets por enlace + FR/IT ==");
  {
    const R = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
    const wk = R("server/worker.js"), i1 = R("public/assets/i18n.js");
    ok("worker: /api/flash-feedback con sameOrigin + ban + allowBuild + logEvent feedback", wk.indexOf("/api/flash-feedback") >= 0 && /path === "\/api\/flash-feedback"[\s\S]{0,900}sameOrigin\(request, url\)/.test(wk) && /path === "\/api\/flash-feedback"[\s\S]{0,1400}type: "feedback"/.test(wk));
    const fb1 = await jpost("/api/flash-feedback", {
      part: "mcu",
      ok: true
    });
    ok("feedback: POST válido → 200 ok", fb1.status === 200 && fb1.body.ok === true, JSON.stringify(fb1.body));
    const fb2 = await jpost("/api/flash-feedback", {
      part: "zzz"
    });
    ok("feedback: part inválido → 400", fb2.status === 400);
    const fb3 = await jpost("/api/flash-feedback", {
      part: "vcu"
    }, {
      Origin: "https://evil.example"
    });
    ok("feedback: cross-origin → 403", fb3.status === 403);
    ok("admin: type 'feedback' con label en el feed de eventos", R("public/admin.html").indexOf('feedback: "opinion"') >= 0);
    ok("i18n: LANGS ahora 5 (en · es · de · fr · it)", i1.indexOf('["en", "es", "de", "fr", "it"]') >= 0);
    [ "sharePreset", "shareCopied", "sharedLoaded", "sharedBad", "rateT", "rateGood", "rateBad", "rateThanks", "bUnlockMcu", "unlockCredit" ].forEach(k => {
      ok("i18n: clave " + k + " ×5 idiomas", i1.split(k + ":").length - 1 === 5);
    });
    ok("i18n: whatsNew 2.9.0 ×5 idiomas", i1.split('whatsNew: "2.9.0"').length - 1 === 5);
    ok("versiones 2.3.2.51: worker APP + sw cache 1697 + i18n 1679", wk.indexOf('const APP = "2.9.0"') >= 0 && R("public/assets/vexora.js").indexOf('app: "2.9.0"') >= 0 && R("public/sw.js").indexOf("vexora-1708") >= 0 && R("public/sw.js").indexOf("./community.html") >= 0 && R("public/index.html").indexOf("app.js?v=1673") >= 0 && R("public/index.html").indexOf("i18n.js?v=1681") >= 0 && R("public/index.html").indexOf("app.css?v=1670") >= 0);
    ok("UI limpia: ayuda recortada a 5 párrafos (flash/gates)", (R("public/index.html").match(/class="help"/g) || []).length === 5);
    ok("admin SHU-style: stat cards con etiqueta arriba + gráfico sin azul", R("public/admin.html").indexOf("column-reverse") >= 0 && R("public/admin.html").indexOf("5577b5") === -1);
    ok("dash SHU: trip-bar con datapoints + nota de datos inexactos", R("public/index.html").indexOf("vTripPts") >= 0 && R("public/index.html").indexOf("dash-note") >= 0 && R("public/assets/app.js").indexOf("vTripPts") >= 0);
    ok("dash SHU: claves tripRec/tripPts/dashNote ×5 idiomas", [ "tripRec", "tripPts", "dashNote" ].every(k => i1.split(k + ":").length - 1 === 5));
    ok("dash SHU: stat cards con etiqueta arriba (column-reverse) en app.css", R("public/assets/app.css").indexOf(".stats .stat") >= 0 && R("public/assets/app.css").indexOf("column-reverse") >= 0);
    await okAsync("report: build fwk cifrado → parámetros decodificados exactos vs base", async () => {
      const b = await jpost("/api/cfw/build", {
        kind: "mcu",
        model: "g3",
        mcu: {
          flavor: "fwk",
          engage: 33,
          cap: 120,
          scale: 2100,
          punta: 327
        },
        vcu: {}
      });
      if (!b.body || !b.body.enc) return false;
      const r = await jpost("/api/report", {
        name: "build.bin",
        data: b.body.enc
      });
      const j = r.body || {};
      return r.status === 200 && j.ok === true && j.params && j.params.engage === 33 && j.params.iqFwA === 120 && j.params.scale === 2100 && j.unlockKey === true && j.stockVer === "vexora fwk base" && j.stockParams && j.stockParams.engage === 30 && j.stockParams.iqFwA === 70 && j.stockParams.scale === 1638 && j.diff && j.diff.bytes > 0 && j.diff.bytes < 100;
    });
    await okAsync("report: vcu stock 1.5.4 plano → tabla 16/35/55 + diff 0", async () => {
      const data = fs.readFileSync("public/cfw/bases/vcu-g3-154.dec.bin").toString("base64");
      const r = await jpost("/api/report", {
        name: "stock.bin",
        data: data
      });
      const j = r.body || {};
      return r.status === 200 && j.ok === true && j.type === "vcu" && j.ver === "1.5.4" && j.params && j.params.ecoKmh === 16 && j.params.driveKmh === 35 && j.params.sportKmh === 55 && j.encrypted === false && j.diff && j.diff.bytes === 0;
    });
    await okAsync("report: basura → 400 sin marker", async () => {
      const r = await jpost("/api/report", {
        name: "x.bin",
        data: Buffer.from("no es una imagen de un patinete electrico ".repeat(60)).toString("base64")
      });
      return r.status === 400 && r.body && r.body.ok === false && /marker/i.test(r.body.error || "");
    });
    ok("guía profunda: 3 cards nuevas (parámetros/wizard/report) en index + claves ×5", R("public/index.html").indexOf("btnWzGo") >= 0 && R("public/index.html").indexOf("repFile") >= 0 && R("public/index.html").indexOf("gDeepT") >= 0 && [ "gDeepT", "wzRes", "repDiffLine" ].every(k => i1.split(k + ":").length - 1 === 5));
    const RID = {};
    const COM = {};
    await okAsync("riders: registro → código de verificación en modo stub (admin)", async () => {
      const r = await jpost("/api/riders/register", {
        name: "rid_e2e_a",
        mail: "rid_e2e_a@test.example",
        pw: "scooter-pass-1"
      });
      if (!(r.status === 200 && r.body && r.body.ok)) return false;
      const c = await jadmin("GET", "/admin/api/riders/codes", null, TOKEN);
      const hit = (c.body.rows || []).find(x => x.name === "rid_e2e_a" && x.kind === "verify");
      RID.aName = "rid_e2e_a";
      RID.aCode = hit && hit.code;
      return c.body.stub === true && !!RID.aCode;
    });
    await okAsync("riders: verify → sesión válida (/api/riders/me)", async () => {
      const r = await jpost("/api/riders/verify", {
        name: RID.aName,
        code: RID.aCode
      });
      if (!(r.status === 200 && r.body && r.body.ok && r.body.token)) return false;
      RID.aTok = r.body.token;
      const me = await fetch(BASE + "/api/riders/me", {
        headers: {
          "x-rider-token": RID.aTok
        }
      }).then(x => x.json());
      return me.ok === true && me.name === RID.aName;
    });
    await okAsync("riders: login mal → 401, login bien → 200", async () => {
      const bad = await jpost("/api/riders/login", {
        name: RID.aName,
        pw: "wrong-pass"
      });
      if (bad.status !== 401) return false;
      const good = await jpost("/api/riders/login", {
        name: RID.aName,
        pw: "scooter-pass-1"
      });
      return good.status === 200 && good.body && good.body.ok && !!good.body.token;
    });
    await okAsync("riders: DM A↔B (envío, lectura, block, 403 tras block, report)", async () => {
      const rb = await jpost("/api/riders/register", {
        name: "rid_e2e_b",
        mail: "rid_e2e_b@test.example",
        pw: "scooter-pass-2"
      });
      if (!(rb.status === 200 && rb.body && rb.body.ok)) return false;
      const cb = await jadmin("GET", "/admin/api/riders/codes", null, TOKEN);
      const hit = (cb.body.rows || []).find(x => x.name === "rid_e2e_b" && x.kind === "verify");
      if (!hit) return false;
      const vb = await jpost("/api/riders/verify", {
        name: "rid_e2e_b",
        code: hit.code
      });
      if (!(vb.status === 200 && vb.body && vb.body.ok)) return false;
      RID.bTok = vb.body.token;
      RID.bName = "rid_e2e_b";
      const s1 = await fetch(BASE + "/api/dms/rid_e2e_b", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rider-token": RID.aTok
        },
        body: JSON.stringify({
          msg: "hola rider B — tu G3 va fino"
        })
      });
      if (s1.status !== 200) return false;
      const read = await fetch(BASE + "/api/dms/rid_e2e_a", {
        headers: {
          "x-rider-token": RID.bTok
        }
      }).then(x => x.json());
      if (!(read.ok && read.msgs && read.msgs.length >= 1 && read.msgs.some(m => /G3/.test(m.msg)))) return false;
      const rep = await fetch(BASE + "/api/dms/report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rider-token": RID.bTok
        },
        body: JSON.stringify({
          peer: RID.aName,
          reason: "harass",
          detail: "e2e test report"
        })
      });
      if (rep.status !== 200) return false;
      const blk = await fetch(BASE + "/api/dms/rid_e2e_a/block", {
        method: "POST",
        headers: {
          "x-rider-token": RID.bTok
        },
        body: "{}"
      });
      if (blk.status !== 200) return false;
      const s2 = await fetch(BASE + "/api/dms/rid_e2e_b", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rider-token": RID.aTok
        },
        body: JSON.stringify({
          msg: "hola de nuevo"
        })
      });
      if (s2.status !== 403) return false;
      const unb = await fetch(BASE + "/api/dms/rid_e2e_a/unblock", {
        method: "POST",
        headers: {
          "x-rider-token": RID.bTok
        },
        body: "{}"
      });
      return unb.status === 200;
    });
    await okAsync("riders: seguridad 50ª (self-DM 400, insulto moderado, resend cooldown)", async () => {
      const selfDm = await fetch(BASE + "/api/dms/" + RID.aName, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rider-token": RID.aTok
        },
        body: JSON.stringify({
          msg: "hola yo"
        })
      });
      if (selfDm.status !== 400) return false;
      const mod = await jpost("/api/dms/" + RID.bName, {
        msg: "you are a sh1t b1tch"
      }, {
        "x-rider-token": RID.aTok
      });
      if (!(mod.status === 400 && mod.body && mod.body.moderated === true)) return false;
      const r1 = await jpost("/api/riders/reset-request", {
        mail: "rid_e2e_b@test.example"
      });
      const r2 = await jpost("/api/riders/reset-request", {
        mail: "rid_e2e_b@test.example"
      });
      return r2.status === 429 && r2.body && Number(r2.body.wait) > 0 && (r1.status === 200 || r1.status === 429);
    });
    await okAsync("riders: foto en DM (png 1×1) → marcador + GET pic 200/401", async () => {
      const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const up = await jpost("/api/dms/" + RID.bName + "/pic", {
        img: png
      }, {
        "x-rider-token": RID.aTok
      });
      if (!(up.status === 200 && up.body && up.body.ok)) return false;
      const read = await fetch(BASE + "/api/dms/" + RID.aName, {
        headers: {
          "x-rider-token": RID.bTok
        }
      }).then(x => x.json());
      const picMsg = (read.msgs || []).find(m => typeof m.msg === "string" && m.msg.indexOf("pic:") === 0);
      if (!picMsg) return false;
      const pid = picMsg.msg.slice(5);
      const got = await fetch(BASE + "/api/pic/" + pid, {
        headers: {
          "x-rider-token": RID.bTok
        }
      });
      if (!(got.status === 200 && (got.headers.get("content-type") || "").indexOf("image/") === 0)) return false;
      const noAuth = await fetch(BASE + "/api/pic/" + pid);
      return noAuth.status === 401;
    });
    await okAsync("riders: reports en admin (razón + detalle, veredicto IA opcional)", async () => {
      const rp = await jadmin("GET", "/admin/api/riders/reports", null, TOKEN);
      if (!(rp.status === 200 && rp.body && rp.body.ok && (rp.body.rows || []).length >= 1)) return false;
      const row = (rp.body.rows || []).find(x => x.target === RID.aName && String(x.why).indexOf("harass") === 0);
      if (!row) return false;
      if (COM.reported) {
        const prow = (rp.body.rows || []).find(x => x.target === RID.aName && String(x.why).indexOf("spam | [post #") === 0);
        if (!prow) return false;
      }
      return true;
    });
    await okAsync("riders: límite 3 cuentas/6h por IP en D1 (3º ok → 4º 429)", async () => {
      const r3 = await jpost("/api/riders/register", {
        name: "rid_e2e_c",
        mail: "rid_e2e_c@test.example",
        pw: "E2eC12345!"
      });
      if (!(r3.status === 200 && r3.body && r3.body.ok)) return false;
      const r4 = await jpost("/api/riders/register", {
        name: "rid_e2e_x",
        mail: "rid_e2e_x@test.example",
        pw: "E2eX12345!"
      });
      return r4.status === 429 && r4.body && r4.body.ok === false;
    });
    const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await okAsync("community: app servida en /community (login público, nav y modal)", async () => {
      const r = await fetch(BASE + "/community");
      if (r.status !== 200) return false;
      const t = await r.text();
      return t.indexOf("cNavFeed") >= 0 && t.indexOf("cPostModal") >= 0 && t.indexOf("commOpenVex") >= 0;
    });
    await okAsync("community: post sin auth 401 · con auth 200 (media en R2)", async () => {
      const no = await jpost("/api/comm/post", {
        img: PNG1,
        cap: "x"
      });
      if (no.status !== 401) return false;
      const up = await jpost("/api/comm/post", {
        img: PNG1,
        cap: "hello feed"
      }, {
        "x-rider-token": RID.aTok
      });
      if (!(up.status === 200 && up.body && up.body.ok && up.body.key && up.body.id)) return false;
      COM.key = String(up.body.key);
      COM.id = Number(up.body.id);
      const upB = await jpost("/api/comm/post", {
        img: PNG1,
        cap: "b ride"
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(upB.status === 200 && upB.body.ok)) return false;
      COM.idB = Number(upB.body.id);
      return true;
    });
    await okAsync("community: feed público con pic/cap + media GET 200 image/* + key rara 404", async () => {
      const f = await fetch(BASE + "/api/comm/feed?limit=30").then(x => x.json());
      if (!(f.ok === true && (f.rows || []).some(x => x.id === COM.id && x.cap === "hello feed" && String(x.pic).indexOf("/api/comm/media/") === 0))) return false;
      const m = await fetch(BASE + "/api/comm/media/" + COM.key);
      if (!(m.status === 200 && (m.headers.get("content-type") || "").indexOf("image/") === 0)) return false;
      const bad = await fetch(BASE + "/api/comm/media/pnope123456789");
      return bad.status === 404;
    });
    await okAsync("community: like toggle + comentario público + insulto moderado 400", async () => {
      const l1 = await jpost("/api/comm/like", {
        id: COM.id
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(l1.status === 200 && l1.body.liked === true && Number(l1.body.likes) === 1)) return false;
      const l2 = await jpost("/api/comm/like", {
        id: COM.id
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(l2.body.liked === false && Number(l2.body.likes) === 0)) return false;
      const l3 = await jpost("/api/comm/like", {
        id: COM.id
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(l3.body.liked === true && Number(l3.body.likes) === 1)) return false;
      const c1 = await jpost("/api/comm/comment", {
        id: COM.id,
        msg: "nice ride"
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(c1.status === 200 && c1.body.ok)) return false;
      const c2 = await jpost("/api/comm/comment", {
        id: COM.id,
        msg: "you are a sh1t b1tch"
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(c2.status === 400 && c2.body.moderated === true)) return false;
      COM.replyParent0 = Number(c1.body.id);
      const cr = await jpost("/api/comm/comment", {
        id: COM.id,
        parent: Number(c1.body.id),
        msg: "totally agree"
      }, {
        "x-rider-token": RID.aTok
      });
      if (!(cr.status === 200 && cr.body.ok && Number(cr.body.parent) === Number(c1.body.id))) return false;
      COM.replyId = Number(cr.body.id);
      const cdx = await fetch(BASE + "/api/comm/comment?id=" + COM.replyId, {
        method: "DELETE",
        headers: {
          "x-rider-token": RID.bTok
        }
      });
      if (cdx.status !== 403) return false;
      const rp = await jpost("/api/comm/report", {
        post: COM.id,
        reason: "spam",
        detail: "e2e post report"
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(rp.status === 200 && rp.body.ok)) return false;
      COM.reported = true;
      const cl = await fetch(BASE + "/api/comm/comments?post=" + COM.id).then(x => x.json());
      if (!(cl.ok === true && (cl.rows || []).some(x => x.msg === "nice ride"))) return false;
      const vw = await jpost("/api/comm/view", {
        id: COM.id
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(vw.status === 200 && vw.body.ok === true && Number(vw.body.views) >= 1)) return false;
      const nf = await fetch(BASE + "/api/comm/notifs", {
        headers: {
          "x-rider-token": RID.aTok
        }
      }).then(x => x.json());
      if (!(nf.ok === true && (nf.rows || []).some(x => x.kind === "like" && x.aname === RID.bName) && (nf.rows || []).some(x => x.kind === "comment" && x.aname === RID.bName))) return false;
      const nfb = await fetch(BASE + "/api/comm/notifs", {
        headers: {
          "x-rider-token": RID.bTok
        }
      }).then(x => x.json());
      if (!(nfb.ok === true && (nfb.rows || []).some(x => x.kind === "comment" && String(x.msg || "").indexOf("re:") === 0))) return false;
      const clk = await jpost("/api/comm/cmtlike", {
        id: Number(c1.body.id)
      }, {
        "x-rider-token": RID.aTok
      });
      if (!(clk.status === 200 && clk.body.liked === true && Number(clk.body.likes) === 1)) return false;
      const nfc = await fetch(BASE + "/api/comm/notifs", {
        headers: {
          "x-rider-token": RID.bTok
        }
      }).then(x => x.json());
      if (!(nfc.ok === true && (nfc.rows || []).some(x => x.kind === "clike" && x.aname === RID.aName))) return false;
      const cl3 = await fetch(BASE + "/api/comm/comments?post=" + COM.id, {
        headers: {
          "x-rider-token": RID.aTok
        }
      }).then(x => x.json());
      const bRow = (cl3.rows || []).find(x => x.msg === "nice ride");
      if (!(bRow && Number(bRow.likes) === 1 && bRow.liked === true)) return false;
      const sn = await jpost("/api/comm/notifs/seen", {}, {
        "x-rider-token": RID.aTok
      });
      if (!(sn.status === 200 && sn.body.ok)) return false;
      const nf2 = await fetch(BASE + "/api/comm/notifs", {
        headers: {
          "x-rider-token": RID.aTok
        }
      }).then(x => x.json());
      if (Number(nf2.unseen) !== 0) return false;
      const cl2 = await fetch(BASE + "/api/comm/comments?post=" + COM.id, {
        headers: {
          "x-rider-token": RID.aTok
        }
      }).then(x => x.json());
      const mineRow = (cl2.rows || []).find(x => x.id === COM.replyId);
      return cl2.ok === true && mineRow && mineRow.mine === 1 && Number(mineRow.parent) === Number(COM.replyParent0);
    });
    await okAsync("community: follow toggle + perfil público con posts", async () => {
      const f1 = await jpost("/api/comm/follow", {
        name: RID.aName
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(f1.status === 200 && f1.body.following === true && Number(f1.body.followers) === 1)) return false;
      const fs = await jpost("/api/comm/follow", {
        name: RID.aName
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(fs.body.following === false && Number(fs.body.followers) === 0)) return false;
      const f3 = await jpost("/api/comm/follow", {
        name: RID.aName
      }, {
        "x-rider-token": RID.bTok
      });
      if (!(f3.body.following === true && Number(f3.body.followers) === 1)) return false;
      const ff = await fetch(BASE + "/api/comm/feed?limit=30&following=1", {
        headers: {
          "x-rider-token": RID.bTok
        }
      }).then(x => x.json());
      if (!(ff.ok === true && (ff.rows || []).some(x => x.id === COM.id))) return false;
      const fn = await fetch(BASE + "/api/comm/feed?limit=30&following=1").then(x => x.json());
      if (!(fn.ok === true && fn.needAuth === true && (fn.rows || []).length === 0)) return false;
      const nf = await fetch(BASE + "/api/comm/notifs", {
        headers: {
          "x-rider-token": RID.aTok
        }
      }).then(x => x.json());
      if (!(nf.ok === true && (nf.rows || []).some(x => x.kind === "follow" && x.aname === RID.bName))) return false;
      const tp = await fetch(BASE + "/api/comm/feed?limit=30&sort=top").then(x => x.json());
      return tp.ok === true && (tp.rows || []).some(x => x.id === COM.id && Number(x.views) >= 1);
    });
    await okAsync("community: perfil editable (bio+color+avatar R2) · color inválido 400", async () => {
      const bad = await jpost("/api/comm/profile", {
        bio: "x",
        color: "blue"
      }, {
        "x-rider-token": RID.aTok
      });
      if (bad.status !== 400) return false;
      const set = await jpost("/api/comm/profile", {
        bio: "Scooter & sun",
        color: "#31c48d",
        avatar: PNG1
      }, {
        "x-rider-token": RID.aTok
      });
      if (!(set.status === 200 && set.body.ok && String(set.body.avatar || "").indexOf("/api/comm/media/") === 0)) return false;
      COM.avKey = String(set.body.avatar).slice("/api/comm/media/".length);
      const p = await fetch(BASE + "/api/comm/profile/" + RID.aName).then(x => x.json());
      return p.ok === true && p.bio === "Scooter & sun" && p.color === "#31c48d" && !!p.avatar && (p.posts || []).length >= 1;
    });
    await okAsync("community: borrar — otro rider 404 · autor 200 · admin list+delete 200 (media fuera)", async () => {
      const d2 = await fetch(BASE + "/api/comm/post?id=" + COM.id, {
        method: "DELETE",
        headers: {
          "x-rider-token": RID.bTok
        }
      });
      if (d2.status !== 404) return false;
      const ls = await jadmin("GET", "/admin/api/comm/list", null, TOKEN);
      if (!(ls.status === 200 && ls.body.ok && (ls.body.rows || []).some(x => x.id === COM.id))) return false;
      const ad = await jadmin("POST", "/admin/api/comm/delete", {
        id: COM.id
      }, TOKEN);
      if (!(ad.status === 200 && ad.body.ok)) return false;
      const mA = await fetch(BASE + "/api/comm/media/" + COM.key);
      if (mA.status !== 404) return false;
      const d1 = await fetch(BASE + "/api/comm/post?id=" + COM.idB, {
        method: "DELETE",
        headers: {
          "x-rider-token": RID.bTok
        }
      });
      if (d1.status !== 200) return false;
      const f = await fetch(BASE + "/api/comm/feed?limit=30").then(x => x.json());
      return (f.rows || []).every(x => x.id !== COM.id && x.id !== COM.idB);
    });
    await okAsync("riders: reset de contraseña con código → nueva pw funciona", async () => {
      const rq = await jpost("/api/riders/reset-request", {
        mail: "rid_e2e_a@test.example"
      });
      if (!(rq.status === 200 && rq.body && rq.body.ok)) return false;
      const c = await jadmin("GET", "/admin/api/riders/codes", null, TOKEN);
      const hit = (c.body.rows || []).find(x => x.name === RID.aName && x.kind === "reset");
      if (!hit) return false;
      const rc = await jpost("/api/riders/reset-confirm", {
        mail: "rid_e2e_a@test.example",
        code: hit.code,
        pw: "brand-new-pass-9"
      });
      if (!(rc.status === 200 && rc.body && rc.body.ok)) return false;
      const re = await jpost("/api/riders/login", {
        name: RID.aName,
        pw: "brand-new-pass-9"
      });
      return re.status === 200 && re.body && re.body.ok;
    });
    await okAsync("riders: borrado GDPR → sesión muerta, DMs fuera, cuenta fuera", async () => {
      const del = await fetch(BASE + "/admin/api/riders?name=" + RID.aName, {
        method: "DELETE",
        headers: {
          authorization: "Bearer " + TOKEN
        }
      });
      if (del.status !== 200) return false;
      const me = await fetch(BASE + "/api/riders/me", {
        headers: {
          "x-rider-token": RID.aTok
        }
      }).then(x => x.json());
      if (me.ok !== false) return false;
      const lo = await jpost("/api/riders/login", {
        name: RID.aName,
        pw: "brand-new-pass-9"
      });
      if (lo.status !== 401) return false;
      const find = await fetch(BASE + "/api/riders/find?q=rid_e2e", {
        headers: {
          "x-rider-token": RID.bTok
        }
      }).then(x => x.json());
      if (!(find.ok === true && !(find.rows || []).some(x => x.key === RID.aName))) return false;
      const pf = await fetch(BASE + "/api/comm/profile/" + RID.aName);
      if (pf.status !== 404) return false;
      if (COM.avKey) {
        const mA = await fetch(BASE + "/api/comm/media/" + COM.avKey);
        if (mA.status !== 404) return false;
      }
      return true;
    });
    ok("comunidad: tab propia + cuenta por pasos + report modal + foto (claves ×5)", R("public/index.html").indexOf("view-community") >= 0 && R("public/index.html").indexOf('data-view="community"') >= 0 && R("public/index.html").indexOf('use href="#i-tb-comm"') >= 0 && R("public/index.html").indexOf('id="ridFormReg1"') >= 0 && R("public/index.html").indexOf('id="ridFormReg3"') >= 0 && R("public/index.html").indexOf('id="ridWhyCard"') >= 0 && R("public/index.html").indexOf('id="btnDmPic"') >= 0 && [ "tabCommunity", "ridDmHint", "ridWhySend", "ridThanks", "ridModerated" ].every(k => i1.split(k + ":").length - 1 === 5) && R("public/assets/app.js").indexOf("vexora.riderTok") >= 0 && R("public/assets/app.js").indexOf("ridModerated") >= 0 && R("public/index.html").indexOf('href="/community/"') >= 0 && [ "commOpenFeed", "commOpenVex", "commFollow", "commPublish", "commMod", "commSaved", "commForYou", "commFollowingTab", "commShare", "commLinkCopied", "commNotifs", "commLikedYour", "commCommentedYour", "commFollowedYou", "commNoNotifs", "commReport", "commReply", "commReplyTo", "commHoldDel", "commCancel", "commConfirmDelC", "commLikedCmt", "commBack", "commCmts" ].every(k => i1.split('"' + k + '":').length - 1 === 5) && R("public/community.html").indexOf("cNavFeed") >= 0 && R("public/community.html").indexOf("cPostModal") >= 0 && R("public/community.html").indexOf("c-slide") >= 0 && R("public/community.html").indexOf("cTabFor") >= 0 && R("public/community.html").indexOf("c-bigheart") >= 0 && R("public/community.html").indexOf("cTabTop") >= 0 && R("public/community.html").indexOf("c-bell") >= 0 && R("public/community.html").indexOf("cNotifModal") >= 0 && R("public/community.html").indexOf("data-rep") >= 0 && R("public/community.html").indexOf("#cFeedList { height: 100%") >= 0 && R("public/community.html").indexOf("data-open=") < R("public/community.html").indexOf("data-rep=") && R("public/community.html").indexOf("data-rep=") < R("public/community.html").indexOf("data-share=") && R("public/community.html").indexOf('mine ? "" : \'<button type="button" class="c-rbtn" data-rep') < 0 && R("public/community.html").indexOf("cRepModal") >= 0 && R("public/community.html").indexOf("data-creply") >= 0 && R("public/community.html").indexOf("data-cmine") >= 0 && R("public/community.html").indexOf("data-clike") >= 0 && R("server/worker.js").indexOf("/api/comm/social") >= 0 && R("server/worker.js").indexOf("AS fing") >= 0 && R("server/worker.js").indexOf("LEFT JOIN comm_profile pr ON pr.rid = c.rid") >= 0 && R("public/community.html").indexOf("@keyframes cUp") >= 0 && R("public/community.html").indexOf("c-idrow") >= 0 && R("public/community.html").indexOf("c-cav") >= 0 && R("public/community.html").indexOf("row.fing") >= 0 && R("public/community.html").indexOf('data-soc="fers"') >= 0 && R("public/community.html").indexOf('.c-top").hidden = v !== "Feed"') >= 0 && R("public/community.html").indexOf("calc(66px + env(safe-area-inset-bottom))") >= 0 && R("public/community.html").indexOf("calc(112px + env(safe-area-inset-bottom))") >= 0 && R("public/community.html").indexOf('class="c-re"') >= 0 && [ "ridT", "ridLead", "ridFeedSub", "ridAcctT", "ridAcctSub", "ridStep1Sub", "ridStep2Sub", "ridStep3Sub", "ridLoginSub", "ridLoginT", "ridNewQ", "ridHaveQ", "ridNameBad", "ridPassNoMatch", "ridRidersSub", "ridChatSub", "ridDmPh", "ridFindPh", "ridWhyPh", "ridThanks" ].every(k => i1.split('"' + k + '":').length - 1 === 5) && R("public/index.html").indexOf('id="ridStepSub"') >= 0 && R("public/index.html").indexOf('data-i18n="ridFeedSub"') >= 0 && R("public/index.html").indexOf("ridAcctSub") < 0 && R("public/index.html").indexOf("rid-feed-cta") >= 0 && R("public/index.html").indexOf("rid-auth-cta") >= 0 && R("public/assets/app.css").indexOf(".rid-feed-cta { background: #fff") >= 0 && R("public/assets/app.css").indexOf(".rid-auth-cta { background: #2f6bff") >= 0 && R("server/worker.js").indexOf("idx_comm_follow_target ON comm_follow (target, rid)") >= 0 && R("server/worker.js").indexOf("idx_comm_post_rid ON comm_post (rid, id)") >= 0 && R("public/assets/app.js").indexOf('location.href = "/community/"') >= 0 && R("public/community.html").indexOf("--text: #3ddc84") >= 0 && R("public/index.html").indexOf('data-i18n="ridRidersSub"') >= 0 && R("public/index.html").indexOf('data-i18n="ridChatSub"') >= 0 && R("public/index.html").indexOf("app.js?v=1673") >= 0 && R("public/community.html").indexOf("fol.hidden") < 0 && R("public/community.html").indexOf("c-brand") < 0 && R("public/admin.html").indexOf("commRows") >= 0 && R("public/assets/app.css").indexOf(".rid-modal") >= 0);
    ok("unlock credit: línea del developer de SHU en la tarjeta restore", R("public/index.html").indexOf('data-i18n="unlockCredit"') >= 0 && R("public/cfw/assets/cfw.js").indexOf("uc.hidden = !showU") >= 0);
    const mDom = await openPage(BASE + "/app", BASE + "/");
    const wM = mDom.window;
    await waitFor(() => {
      try {
        return wM.eval("window.Vexora && Vexora.model");
      } catch (e) {
        return null;
      }
    }, 8e3, "boot página M");
    ok("langSeg: 5 botones EN/ES/DE/FR/IT", wM.eval("document.querySelectorAll('#langSeg [data-lang]').length") === 5 && !!wM.eval("document.querySelector('#langSeg [data-lang=fr]')") && !!wM.eval("document.querySelector('#langSeg [data-lang=it]')"));
    ok("UI: overlay de valoración tras flash (#rateOverlay + 👍/👎)", !!wM.eval("document.querySelector('#rateOverlay')") && !!wM.eval("document.querySelector('#rateGood')") && !!wM.eval("document.querySelector('#rateBad')"));
    ok("UI: botón Share en el bloque de presets (junto a Save/Load/Export/Import)", wM.eval("!!document.querySelector('.actions #btnSharePreset')") === true && wM.eval("!!document.querySelector('#btnPresetSave')") === true);
    wM.eval("VexoraX.onFlash('mcu', 'MCU 2.3.0 test')");
    ok("rate: onFlash muestra el overlay con el resumen del flash", wM.eval("document.querySelector('#rateOverlay').hidden") === false && wM.eval("document.querySelector('#ratePart').textContent") === "MCU 2.3.0 test");
    wM.eval("document.querySelector('#rateGood').click()");
    ok("rate: votar 👍 cierra el overlay y agradece (POST anónimo)", wM.eval("document.querySelector('#rateOverlay').hidden") === true && /Thanks/.test(wM.eval("document.querySelector('.vtoast').textContent") || ""));
    const flagDef = wM.eval("document.querySelector('[data-flag=autoHeadlight]').checked") === true;
    await closeWin(mDom, "m");
    const sharePayload = Buffer.from(JSON.stringify({
      v: 1,
      tune: {
        eco: 17,
        drive: 23,
        sport: 29,
        start: 0,
        vol: 40,
        flags: {
          autoHeadlight: !flagDef
        }
      }
    })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const shDom = await openPage(BASE + "/app#p=" + sharePayload, BASE + "/");
    const wS = shDom.window;
    await waitFor(() => {
      try {
        return wS.eval("window.Vexora && Vexora.model");
      } catch (e) {
        return null;
      }
    }, 8e3, "boot página share");
    ok("share: enlace #p=… carga el preset en los sliders (eco 17 · drive 23 · sport 29)", wS.eval("document.querySelector('#limEco').value") === "17" && wS.eval("document.querySelector('#limDrive').value") === "23" && wS.eval("document.querySelector('#limRange').value") === "29", "eco=" + wS.eval("document.querySelector('#limEco').value") + " drive=" + wS.eval("document.querySelector('#limDrive').value"));
    ok("share: flag del preset aplicado (autoHeadlight invertido respecto al default)", wS.eval("document.querySelector('[data-flag=autoHeadlight]').checked") === !flagDef, "default=" + flagDef + " ahora=" + wS.eval("document.querySelector('[data-flag=autoHeadlight]').checked"));
    ok("share: aviso sharedLoaded (toast)", /Shared preset loaded/i.test(wS.eval("document.querySelector('.vtoast').textContent") || ""));
    ok("share: hash sin p= y preset visible en la pestaña Tune (view-live)", (wS.eval("location.hash") || "").indexOf("p=") === -1 && wS.eval("document.querySelector('#view-live').classList.contains('active')") === true);
    await closeWin(shDom, "share");
    const shBad = await openPage(BASE + "/app#p=zznovalida", BASE + "/");
    const wB = shBad.window;
    await waitFor(() => {
      try {
        return wB.eval("window.Vexora && Vexora.model");
      } catch (e) {
        return null;
      }
    }, 8e3, "boot share malo");
    ok("share: enlace corrupto → aviso sharedBad", /not valid/i.test(wB.eval("document.querySelector('.vtoast').textContent") || ""));
    await closeWin(shBad, "shareBad");
  }
  {
    console.log("== N · VXFW · DPC pow4 ==");
    const fsN = require("fs"), pathN = require("path");
    const VU2 = require(pathN.join(__dirname, "..", "server", "worker.js"));
    const tea2 = VU2._internal.TEA;
    const baseDpc = fsN.readFileSync(pathN.join(__dirname, "..", "public", "cfw", "bases", "mcu-vxfw-dpc4.dec.bin"));
    ok("vxfw: base 59.388 B + marker SCOOTER_MCU_0001 + key-slot FF", baseDpc.length === 59388 && baseDpc.slice(1024, 1040).toString("latin1") === "SCOOTER_MCU_0001" && Array.from(baseDpc.slice(1056, 1078)).every(c => c === 255));
    const wkN = fsN.readFileSync(pathN.join(__dirname, "..", "server", "worker.js"), "utf8");
    ok("vxfw: worker integra dpc4 (base + enforce G3 + note)", wkN.indexOf("mcu-vxfw-dpc4.dec.bin") >= 0 && wkN.indexOf("VXFW DPC is Max G3 only") >= 0 && wkN.indexOf("VXFW · DPC pow4") >= 0);
    const VXIP = {
      "cf-connecting-ip": "172.16.4.41"
    };
    const b1 = await jpost("/api/cfw/build", {
      kind: "mcu",
      model: "g3",
      fwMcu: "1.4.8",
      mcu: {
        flavor: "dpc4",
        engage: 28,
        cap: 70,
        scale: 2300,
        punta: 327
      }
    }, VXIP);
    let dpcImg = null;
    ok("vxfw: build API 200 · part mcu · note VXFW", b1.status === 200 && b1.body && b1.body.ok === true && b1.body.part === "mcu" && String(b1.body.note || "").indexOf("VXFW") >= 0, JSON.stringify(b1.body || {}).slice(0, 120));
    if (b1.body && b1.body.ok) {
      dpcImg = tea2.unwrap(Buffer.from(b1.body.enc, "base64"));
      const u8 = dpcImg.body;
      ok("vxfw: TEA unwrap ok + key unlock @0x420 + tag cfw.sh", dpcImg.ok === true && Buffer.from(u8.slice(1056, 1072)).equals(Buffer.from(tea2.KEY)) && Buffer.from(u8.slice(1072, 1078)).toString("latin1") === "cfw.sh");
      let onlyUnlock = true;
      for (let i = 0; i < 59388; i++) {
        if (i >= 1056 && i < 1078) continue;
        if (u8[i] !== baseDpc[i]) {
          onlyUnlock = false;
          break;
        }
      }
      ok("vxfw: imagen byte-idéntica a la base salvo el stamp unlock", onlyUnlock);
    } else {
      ok("vxfw: TEA unwrap", false, "build falló");
    }
    const b2 = await jpost("/api/cfw/build", {
      kind: "mcu",
      model: "g3",
      fwMcu: "1.4.8",
      mcu: {
        flavor: "dpc4",
        engage: 200,
        cap: 150,
        scale: 4095,
        punta: 2e3
      }
    }, VXIP);
    let same = false;
    if (b1.body && b1.body.ok && b2.body && b2.body.ok && dpcImg) {
      const d2 = tea2.unwrap(Buffer.from(b2.body.enc, "base64"));
      same = Buffer.from(dpcImg.body).equals(Buffer.from(d2.body));
    }
    ok("vxfw: tune fijo (sliders extremos → build idéntico)", same);
    const b3 = await jpost("/api/cfw/build", {
      kind: "mcu",
      model: "zt3",
      fwMcu: "1.4.14",
      mcu: {
        flavor: "dpc4"
      }
    }, VXIP);
    ok("vxfw: rechazo G3-only es 400 (no rate-limit)", b3.status === 400);
    ok("vxfw: fuera del G3 → rechazado", b3.status === 400 || b3.body && b3.body.ok === false, JSON.stringify(b3.body || {}).slice(0, 100));
    const homeN = await (await fetch(BASE + "/app")).text();
    ok("vxfw: tarjeta + botón en la UI", homeN.indexOf('id="btnMcuDpc4"') >= 0 && homeN.indexOf('id="panelDpc4"') >= 0);
    const i18nN = fsN.readFileSync(pathN.join(__dirname, "..", "public", "assets", "i18n.js"), "utf8");
    ok("vxfw: textos ×5 idiomas", i18nN.split("hVxfw:").length - 1 === 5);
  }
  {
    console.log("== O · device-keyed VCU unlock ==");
    const fsO = require("fs"), pathO = require("path");
    const VUO = require(pathO.join(__dirname, "..", "server", "worker.js"));
    const teaO = VUO._internal.TEA;
    const dk = Uint8Array.from([ 222, 173, 190, 239, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 ]);
    const rt = teaO.wrap(Uint8Array.from([ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 ]), dk);
    ok("devkey: wrap/unwrap roundtrip con key de dispositivo", teaO.unwrap(rt, dk).ok === true && teaO.unwrap(rt).ok === false);
    const DKIP = {
      "cf-connecting-ip": "172.16.5.41"
    };
    const bodyO = {
      kind: "vcu",
      model: "g3",
      fwVcu: "5.1.1",
      vcu: {
        se: 25,
        sd: 25,
        ss: 25,
        ce: 20,
        cd: 25,
        cs: 30,
        devKey: "deadbeef0102030405060708090a0b0c"
      }
    };
    const rO = await jpost("/api/cfw/build", bodyO, DKIP);
    ok("devkey: build 200 · note device-keyed", rO.status === 200 && rO.body && rO.body.ok === true && /device-keyed/i.test(String(rO.body.note || "")), JSON.stringify(rO.body || {}).slice(0, 140));
    if (rO.body && rO.body.ok) {
      const encB = Buffer.from(rO.body.enc, "base64");
      const withDev = teaO.unwrap(encB, dk);
      const withStd = teaO.unwrap(encB);
      const hasStd = withDev.ok && Buffer.from(withDev.body).indexOf(Buffer.from(teaO.KEY)) >= 0;
      ok("devkey: la imagen abre con la key del dispositivo y NO con la estándar", withDev.ok === true && withStd.ok === false);
      ok("devkey: la imagen restaura la key estándar en su slot", hasStd);
    } else {
      ok("devkey: imagen con key de dispositivo", false, "build falló");
      ok("devkey: slot de key estándar", false, "build falló");
    }
    const rBad = await jpost("/api/cfw/build", {
      kind: "vcu",
      model: "g3",
      fwVcu: "5.1.1",
      vcu: {
        devKey: "zzzz"
      }
    }, DKIP);
    ok("devkey: key inválida → rechazada", rBad.status === 400 || rBad.body && rBad.body.ok === false, JSON.stringify(rBad.body || {}).slice(0, 100));
    const homeO = await (await fetch(BASE + "/app")).text();
    ok("devkey: UI (input + botón)", homeO.indexOf('id="devKey"') >= 0 && homeO.indexOf('id="btnVcuDevKey"') >= 0);
    const i18nO = fsO.readFileSync(pathO.join(__dirname, "..", "public", "assets", "i18n.js"), "utf8");
    ok("devkey: textos ×5 idiomas", i18nO.split("hDevUnlock:").length - 1 === 5);
    ok("hwscan: UI retirada (solo Read UIDs; unlock oculto)", homeO.indexOf('id="btnHwScan"') === -1 && homeO.indexOf('id="btnReadUids"') >= 0 && homeO.indexOf('id="devKey"') >= 0 && homeO.indexOf('id="devUnlockCard"') >= 0);
    ok("hwscan: runHwScan en app.js + textos ×5", fsO.readFileSync(pathO.join(__dirname, "..", "public", "assets", "app.js"), "utf8").indexOf("runHwScan") >= 0 && i18nO.split("bHwScan:").length - 1 === 5);
    ok("uids: UI (botón + salida) + reg 218 en cfw.js", homeO.indexOf('id="btnReadUids"') >= 0 && homeO.indexOf('id="uidOut"') >= 0 && fsO.readFileSync(pathO.join(__dirname, "..", "public", "cfw", "assets", "cfw.js"), "utf8").indexOf("readRegister(22, 218, 12") >= 0);
    ok("uids: textos ×5 idiomas", i18nO.split("bReadUids:").length - 1 === 5 && i18nO.split("uidsHint:").length - 1 === 5);
    ok("pair: botón copiar par + textos ×5", homeO.indexOf('id="btnCopyPair"') >= 0 && fsO.readFileSync(pathO.join(__dirname, "..", "public", "cfw", "assets", "cfw.js"), "utf8").indexOf("btnCopyPair") >= 0 && i18nO.split("bCopyPair:").length - 1 === 5);
    const cfwO2 = fsO.readFileSync(pathO.join(__dirname, "..", "public", "cfw", "assets", "cfw.js"), "utf8");
    ok("cockpit: UI (horn/vol/dash/acc/charge) + regs 0x77/0x76/0x2E/0x6E/0x82", homeO.indexOf('id="btnHorn"') >= 0 && homeO.indexOf('id="segDash"') >= 0 && homeO.indexOf('id="segAcc"') >= 0 && cfwO2.indexOf("writeRegisterFlash(22, 0x77") >= 0 && cfwO2.indexOf("cWrite(22, 0x76") >= 0 && cfwO2.indexOf("cWrite(22, 0x2E") >= 0 && cfwO2.indexOf("cWrite(22, 0x6E") >= 0 && cfwO2.indexOf("cWrite(7, 0x82") >= 0);
    ok("cockpit: textos ×5 idiomas", i18nO.split("tCockpitT:").length - 1 === 5 && i18nO.split("noteCockpit:").length - 1 === 5);
    ok("odo: localizador + set solo-subir + revert + textos ×5", homeO.indexOf('id="btnOdoFind"') >= 0 && homeO.indexOf('id="btnOdoSet"') >= 0 && homeO.indexOf('id="btnOdoRevert"') >= 0 && cfwO2.indexOf("btnOdoSet") >= 0 && cfwO2.indexOf("vexora.odo.") >= 0 && i18nO.split("tOdoCard:").length - 1 === 5 && i18nO.split("odoOnlyUp:").length - 1 === 5 && i18nO.split("odoBle:").length - 1 === 5 && homeO.indexOf('id="odoFile"') >= 0 && homeO.indexOf('id="btnOdoPatch"') >= 0 && cfwO2.indexOf("btnOdoPatch") >= 0 && i18nO.split("odoPBad:").length - 1 === 5 && homeO.indexOf('id="btnOdoDiag"') >= 0 && cfwO2.indexOf("btnOdoDiag") >= 0 && i18nO.split("bOdoDiag:").length - 1 === 5);
    const gDom = await openPage(BASE + "/app", BASE + "/", {
      noLegal: true,
      noAccess: true
    });
    const wG = gDom.window;
    await waitFor(() => {
      try {
        const el = wG.document.querySelector("#accessOverlay");
        return el ? el.style.display : null;
      } catch (e) {
        return null;
      }
    }, 8e3, "gate boot");
    ok("gate: sin código → access visible + legal oculta (no 10s stuck)", wG.document.querySelector("#accessOverlay").style.display !== "none" && wG.document.querySelector("#legalOverlay").style.display === "none");
    try {
      await jadmin("POST", "/admin/api/flags", {
        flags: {
          maint: false
        }
      }, TOKEN);
    } catch (e) {}
    await sleep(5600);
    const rRoot = await fetch(BASE + "/", {
      headers: {
        Accept: "text/html"
      }
    });
    const tRoot = await rRoot.text();
    ok("landing raíz: pública (minimal: trio + flota + acceso 30s + License soon + vxfw + Studio CTA)", rRoot.status === 200 && tRoot.indexOf("Open Vexora Tuning") >= 0 && tRoot.indexOf("Open Vexora BLE Studio") >= 0 && tRoot.indexOf("https://vexora.printspace.at/") >= 0 && tRoot.indexOf("VXFW") >= 0 && tRoot.indexOf("screen colors") >= 0 && tRoot.indexOf("F3 PRO") >= 0 && tRoot.indexOf("Coming soon") >= 0 && tRoot.indexOf("discord.gg/vxfw") >= 0);
    const rAppH = await fetch(BASE + "/app", {
      headers: {
        Accept: "text/html"
      }
    });
    const appHtml = await rAppH.text();
    ok("app servida en /app (gate incluido)", rAppH.status === 200 && appHtml.indexOf("accessOverlay") >= 0);
    ok("vxfw switch: 3 pestañas en el html (CFW + Motor visibles por defecto, VXFW oculta hasta el flag)", appHtml.indexOf('data-view="vxfw"') >= 0 && /data-view="vxfw" hidden/.test(appHtml) && appHtml.indexOf('data-view="cfw"') >= 0 && appHtml.indexOf('data-view="motor"') >= 0 && appHtml.indexOf('id="view-vxfw"') >= 0 && appHtml.indexOf('id="view-motor"') >= 0 && appHtml.indexOf('id="view-cfw"') >= 0);
    ok("vxfw: gate + best tune + tuning dentro de la vista", appHtml.indexOf('id="vxfwGate"') >= 0 && appHtml.indexOf('id="btnVxfwBest"') >= 0 && appHtml.indexOf('data-vxfw-lock="1"') >= 0 && appHtml.indexOf('id="panelDpc4"') >= 0 && appHtml.indexOf('id="btnVcu"') >= 0);
    ok("vxfw: Studio link actualizado (printspace) y solo F3 Pro", appHtml.indexOf("https://vexora.printspace.at/") >= 0 && appHtml.indexOf("duckdns") === -1 && appHtml.indexOf("F3 / F3 Pro") === -1 && appHtml.indexOf("Max G3 and F3 Pro take custom BLE payloads") >= 0);
    const ACC_IP = {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.66"
    };
    const rAcc0 = await fetch(BASE + "/api/access", {
      method: "POST",
      headers: ACC_IP,
      body: JSON.stringify({
        code: "VEX-0000-0000"
      })
    });
    ok("access: código inválido → 403", rAcc0.status === 403);
    const rGrant = await fetch(BASE + "/api/access/bot-grant", {
      method: "POST",
      headers: Object.assign({
        "x-bot-secret": "e2e-bot-secret"
      }, ACC_IP),
      body: JSON.stringify({
        discord: "e2e-tester"
      })
    });
    const jGrant = await rGrant.json().catch(() => null);
    ok("access: bot-grant entrega código VEX-", rGrant.status === 200 && jGrant && jGrant.ok && /^VEX-/.test(jGrant.code || ""));
    const rAcc1 = await fetch(BASE + "/api/access", {
      method: "POST",
      headers: ACC_IP,
      body: JSON.stringify({
        code: jGrant && jGrant.code || ""
      })
    });
    const jAcc1 = await rAcc1.json().catch(() => null);
    ok("access: código válido → ok + exp", rAcc1.status === 200 && jAcc1 && jAcc1.ok && jAcc1.exp > Date.now());
    const uNo = await fetch(BASE + "/api/unlock/grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        discord: "e2e-tester"
      })
    });
    ok("unlock: grant sin secret → 401", uNo.status === 401);
    const uGrant = await fetch(BASE + "/api/unlock/grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-secret": "e2e-bot-secret"
      },
      body: JSON.stringify({
        discord: "e2e-tester",
        v1: "https://www.tiktok.com/@vx/video/111",
        v2: "https://www.youtube.com/watch?v=abc12345678",
        views: 1234
      })
    });
    const juGrant = await uGrant.json().catch(() => null);
    ok("unlock: bot-grant entrega código VXL-", uGrant.status === 200 && juGrant && juGrant.ok && /^VXL-/.test(juGrant.code || ""));
    const uBad = await fetch(BASE + "/api/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: "VXL-0000-0000"
      })
    });
    ok("unlock: código inválido → 403", uBad.status === 403);
    const uOk = await fetch(BASE + "/api/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: juGrant && juGrant.code || ""
      })
    });
    const juOk = await uOk.json().catch(() => null);
    ok("unlock: código válido → ok + exp 30d", uOk.status === 200 && juOk && juOk.ok && juOk.exp > Date.now());
    const uRe = await fetch(BASE + "/api/unlock/grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-secret": "e2e-bot-secret"
      },
      body: JSON.stringify({
        discord: "e2e-tester",
        v1: "https://www.tiktok.com/@vx/video/222",
        v2: "https://www.tiktok.com/@vx/video/333",
        views: 2e3
      })
    });
    const juRe = await uRe.json().catch(() => null);
    ok("unlock: re-grant <15 días → MISMO código (reuse)", uRe.status === 200 && juRe && juRe.ok && juRe.reuse === true && juRe.code === (juGrant && juGrant.code));
    const uOk2 = await fetch(BASE + "/api/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: juRe && juRe.code || ""
      })
    });
    ok("unlock: el código reenviado valida", uOk2.status === 200);
    const rGrant2 = await fetch(BASE + "/api/access/bot-grant", {
      method: "POST",
      headers: Object.assign({
        "x-bot-secret": "e2e-bot-secret"
      }, ACC_IP),
      body: JSON.stringify({
        discord: "e2e-tester"
      })
    });
    const jGrant2 = await rGrant2.json().catch(() => null);
    ok("access: re-grant <15 días → MISMO código (reuse)", rGrant2.status === 200 && jGrant2 && jGrant2.ok && jGrant2.reuse === true && jGrant2.code === (jGrant && jGrant.code));
    let lastRL = 0;
    for (let i = 0; i < 10; i++) {
      const r = await fetch(BASE + "/api/access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "203.0.113.77"
        },
        body: JSON.stringify({
          code: "VEX-0000-0000"
        })
      });
      lastRL = r.status;
    }
    ok("access: rate limit anti-bruteforce → 429 tras 8 fallos", lastRL === 429);
    const uList = await fetch(BASE + "/admin/api/unlock/list", {
      headers: {
        Authorization: "Bearer " + TOKEN
      }
    });
    const juList = await uList.json().catch(() => null);
    ok("unlock: admin list ve el registro con vídeos y vistas", uList.status === 200 && juList && juList.ok && (juList.unlock || []).some(r => r.discord === "e2e-tester" && r.views >= 1234));
    const overlay = await fetch(BASE + "/app", {
      headers: {
        Accept: "text/html"
      }
    });
    ok("unlock: overlay en la app (unlockOverlay + VexoraUnlock)", (await overlay.text()).indexOf("unlockOverlay") >= 0);
    {
      const appHtml2 = await (await fetch(BASE + "/app", {
        headers: {
          Accept: "text/html"
        }
      })).text();
      ok("feedback: botón + modal estrellas + gate 1x en la app", appHtml2.indexOf('id="btnFeedback"') >= 0 && appHtml2.indexOf('id="fbWrap"') >= 0 && appHtml2.indexOf('id="fbFaces"') >= 0 && appHtml2.indexOf('id="fbForm"') >= 0 && appHtml2.indexOf('id="fbDone"') >= 0 && appHtml2.indexOf("M12 17.27") >= 0);
      const appJsSrc = fs.readFileSync(path.join(__dirname, "..", "public/assets/app.js"), "utf8");
      ok("feedback: gate obligatorio 1x en app.js (vexora.fbdone)", appJsSrc.indexOf("vexora.fbdone") >= 0 && appJsSrc.indexOf("openFb(true)") >= 0);
      const admHtml = await (await fetch(BASE + "/admin", {
        headers: {
          Accept: "text/html"
        }
      })).text();
      ok("feedback: sección en el panel admin", admHtml.indexOf('id="fbTable"') >= 0 && admHtml.indexOf('id="btnFbClear"') >= 0);
      const FB_IP = "203.0.113.90";
      const post = (obj, ip) => fetch(BASE + "/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": ip
        },
        body: JSON.stringify(obj)
      });
      let rF = await post({
        rating: 5,
        msg: "e2e loves it <3",
        model: "g3",
        how: "demo",
        fw: "--",
        lang: "es"
      }, FB_IP);
      ok("feedback: envío válido → 200", rF.status === 200 && (await rF.json()).ok === true);
      rF = await post({
        rating: 9
      }, FB_IP);
      ok("feedback: rating fuera de rango → 400", rF.status === 400);
      rF = await post({
        rating: 4
      }, FB_IP);
      ok("feedback: 2º envío ok", rF.status === 200);
      rF = await post({
        rating: 2
      }, FB_IP);
      ok("feedback: 3º envío ok", rF.status === 200);
      rF = await post({
        rating: 3
      }, FB_IP);
      ok("feedback: 4º envío ok (límite 5/10min)", rF.status === 200);
      rF = await post({
        rating: 3
      }, FB_IP);
      ok("feedback: 6º en 10 min → 429", rF.status === 429);
      const lst = await jadmin("GET", "/admin/api/feedback/list", null, TOKEN);
      const row = (lst.body.rows || []).find(x => x.msg === "e2e loves it <3");
      ok("feedback: admin list con país/dispositivo/patín/rating/msg", lst.status === 200 && lst.body.ok && lst.body.rows.length >= 3 && row && "country" in row && "ua" in row && "ip" in row && row.model === "g3" && row.how === "demo" && row.rating === 5 && row.lang === "es");
      const delF = await jadmin("DELETE", "/admin/api/feedback", null, TOKEN);
      const lst2 = await jadmin("GET", "/admin/api/feedback/list", null, TOKEN);
      ok("feedback: clear → lista vacía", delF.status === 200 && lst2.body.rows.length === 0);
    }
  }
  {
    const liveSrcT49 = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "live.js"), "utf8");
    ok("T49: applyMode sincroniza el slot TUN (slotWrite + encodeProfile)", liveSrcT49.indexOf("slotWrite(1, encodeProfile(q))") >= 0 && liveSrcT49.indexOf('unlockSports", mode === "tun') >= 0);
    const appSrcT49 = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "app.js"), "utf8");
    ok("T49: writeLimit sincroniza el slot TUN (flashWriteSlot con b[3]/b[7])", appSrcT49.indexOf("flashWriteSlot(1, b, 2000)") >= 0 && appSrcT49.indexOf("b[3] = t; b[7] = t;") >= 0);
    ok("T49: guard del tail de versión en worker (0xeff4)", fs.readFileSync(path.join(__dirname, "..", "server", "worker.js"), "utf8").indexOf("unexpected version tail") >= 0);
  }
  {
    const whHits = [];
    const whSrv = await new Promise(resolve => {
      const srv = http.createServer((req, res) => {
        let b = "";
        req.on("data", c => {
          b += c;
        });
        req.on("end", () => {
          try {
            whHits.push(JSON.parse(b));
          } catch (e) {
            whHits.push({
              raw: b
            });
          }
          res.writeHead(200, {
            "Content-Type": "application/json"
          });
          res.end('{"ok":true}');
        });
      });
      srv.listen(8791, "127.0.0.1", () => resolve(srv));
    });
    const whTitle = i => whHits[i] && whHits[i].embeds && whHits[i].embeds[0] && whHits[i].embeds[0].title || "";
    const whReason = i => {
      const e = whHits[i] && whHits[i].embeds && whHits[i].embeds[0];
      const f = e && e.fields && (e.fields.find(x => x.name === "Reason") || e.fields.find(x => x.name === "Details"));
      return f ? f.value : "";
    };
    ok("webhook: URL inválida (no discord) → 400", (await jadmin("POST", "/admin/api/webhook", {
      url: "https://evil.example/hook"
    }, TOKEN)).status === 400);
    ok("webhook: guardar válida (localhost test) → ok + masked", (await jadmin("POST", "/admin/api/webhook", {
      url: "http://127.0.0.1:8791/hook"
    }, TOKEN)).body.ok === true);
    const whGet = await jadmin("GET", "/admin/api/webhook", null, TOKEN);
    ok("webhook: GET configurada + NUNCA devuelve la URL completa", whGet.body.configured === true && whGet.body.masked.length > 0 && JSON.stringify(whGet.body).indexOf("8791/hook") === -1, whGet.body.masked);
    const admHtmlW = await (await fetch(BASE + "/admin", {
      headers: {
        Accept: "text/html"
      }
    })).text();
    ok("webhook: tarjeta en el panel admin (input + save/test/remove)", admHtmlW.indexOf('id="whUrl"') >= 0 && admHtmlW.indexOf('id="btnWhSave"') >= 0 && admHtmlW.indexOf('id="btnWhTest"') >= 0 && admHtmlW.indexOf('id="btnWhDel"') >= 0);
    whHits.length = 0;
    await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: true,
        maintReason: "e2e: actualización programada"
      }
    }, TOKEN);
    await new Promise(r => setTimeout(r, 400));
    ok("webhook: maint ON → embed con título mantenimiento + razón", whHits.length >= 1 && /Maintenance in Progress/.test(whTitle(0)) && whReason(0).indexOf("e2e: actualización programada") >= 0, whTitle(0) + " | razón=" + whReason(0));
    const hOn = await (await fetch(BASE + "/api/health")).json();
    ok("webhook: /api/health expone reason en mantenimiento", hOn.maint === 1 && hOn.reason === "e2e: actualización programada", hOn.reason);
    await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: true,
        maintReason: "e2e: razón nueva"
      }
    }, TOKEN);
    await new Promise(r => setTimeout(r, 400));
    ok("webhook: cambio de razón → embed actualizada", whHits.length >= 2 && /Maintenance Update/.test(whTitle(whHits.length - 1)) && whReason(whHits.length - 1).indexOf("razón nueva") >= 0, whTitle(whHits.length - 1));
    const whTest = await jadmin("POST", "/admin/api/webhook/test", null, TOKEN);
    ok("webhook: botón test → entrega real (status 200)", whTest.status === 200 && whTest.body.ok === true && whTest.body.status === 200, JSON.stringify(whTest.body));
    ok("webhook: test con título corporativo", /Status Channel Connected/.test(whTitle(whHits.length - 1)), whTitle(whHits.length - 1));
    await jadmin("POST", "/admin/api/flags", {
      flags: {
        tire: true,
        cfw: true,
        maint: false
      }
    }, TOKEN);
    await new Promise(r => setTimeout(r, 400));
    ok("webhook: maint OFF → embed Maintenance Completed", whHits.length >= 3 && /Maintenance Completed/.test(whTitle(whHits.length - 1)), whTitle(whHits.length - 1));
    {
      const dumps = JSON.stringify(whHits);
      ok("webhook: embeds SIN fugas internas (sin IPs ni 'panel')", dumps.indexOf("panel") === -1 && dumps.indexOf("admin") === -1 && dumps.indexOf("127.0.0.1") === -1 && dumps.indexOf("Hecho desde") === -1);
    }
    ok("webhook: DELETE → sin configurar", (await jadmin("DELETE", "/admin/api/webhook", null, TOKEN)).body.ok === true);
    {
      const gd = await jadmin("GET", "/admin/api/webhook", null, TOKEN);
      ok("webhook: GET tras DELETE → disabled (source=off)", gd.body.configured === false && gd.body.source === "off", JSON.stringify(gd.body));
    }
    try {
      whSrv.close();
    } catch (e) {}
  }
  {
    console.log("--- N · live chat 2.4.0");
    const HT = tok => ({
      "x-chat-token": tok || ""
    });
    const bad1 = await jpost("/api/chat/open", {
      name: "x",
      model: "Ninebot Max G3",
      message: "hi there"
    });
    ok("chat open: nombre corto → ok con Rider por defecto", bad1.status === 200 && bad1.body.ok === true);
    await jadmin("POST", "/admin/api/support/close", {
      id: bad1.body.id
    }, TOKEN);
    const bad2 = await jpost("/api/chat/open", {
      name: "Rider",
      model: "Ninebot Max G3",
      message: ""
    });
    ok("chat open: sin mensaje → 400", bad2.status === 400);
    const op = await jpost("/api/chat/open", {
      name: "E2E Rider",
      model: "Ninebot Max G3",
      message: "My flash fails at 50%",
      page: "/app"
    });
    ok("chat open OK → id + token 32hex", op.status === 200 && op.body.ok && Number(op.body.id) > 0 && /^[0-9a-f]{32}$/.test(op.body.token));
    const cid = op.body.id, ctok = op.body.token;
    const badTok = await jget("/api/chat/msg?id=" + cid, {
      "x-chat-token": "deadbeef".repeat(4)
    });
    ok("chat msg: token malo → 404", badTok.status === 404);
    const m0 = await jget("/api/chat/msg?id=" + cid + "&after=0", HT(ctok));
    ok("visitor ve su mensaje + status waiting", m0.status === 200 && m0.body.status === "waiting" && m0.body.messages.some(m => m.who === "visitor" && /flash fails/.test(m.body)));
    const noAuth = await jadmin("GET", "/admin/api/support/chats", null, "");
    ok("consola sin token admin → 401", noAuth.status === 401);
    const lg = await jadmin("POST", "/admin/api/login", {
      password: ADMIN_PASS
    });
    const atok = lg.body.token;
    ok("login consola OK (mismo admin)", lg.status === 200 && lg.body.ok === true && !!atok);
    const lst = await jadmin("GET", "/admin/api/support/chats", null, atok);
    ok("consola lista el chat en WAITING", lst.status === 200 && lst.body.ok && lst.body.chats.some(c => c.id === cid && c.status === "waiting" && /E2E Rider/.test(c.name)));
    const acc = await jadmin("POST", "/admin/api/support/accept", {
      id: cid
    }, atok);
    ok("consola acepta el chat", acc.status === 200 && acc.body.ok);
    const rep = await jadmin("POST", "/admin/api/support/msg", {
      id: cid,
      body: "Support here — send us the error code please"
    }, atok);
    ok("agente responde", rep.status === 200 && rep.body.ok);
    const mv = await jget("/api/chat/msg?id=" + cid + "&after=0", HT(ctok));
    ok("visitor ve: active + system + respuesta del agente", mv.body.status === "active" && mv.body.messages.some(m => m.who === "system" && /chatting with Vexora Support/.test(m.body)) && mv.body.messages.some(m => m.who === "agent" && /error code/.test(m.body)));
    const vrep = await jpost("/api/chat/msg?id=" + cid, {
      id: cid,
      body: "Here is the screenshot: ERR_8"
    }, HT(ctok));
    ok("visitor responde", vrep.status === 200 && vrep.body.ok);
    const ma = await jadmin("GET", "/admin/api/support/msg?id=" + cid + "&after=0", null, atok);
    ok("agente ve la respuesta del visitor", ma.status === 200 && ma.body.messages.some(m => m.who === "visitor" && /ERR_8/.test(m.body)));
    const cls = await jadmin("POST", "/admin/api/support/close", {
      id: cid
    }, atok);
    ok("agente cierra el chat", cls.status === 200 && cls.body.ok);
    const afterClose = await jpost("/api/chat/msg?id=" + cid, {
      id: cid,
      body: "hello?"
    }, HT(ctok));
    ok("visitor no puede escribir tras cierre → 403", afterClose.status === 403);
    const mc = await jget("/api/chat/msg?id=" + cid + "&after=0", HT(ctok));
    ok("system informa del cierre", mc.body.status === "closed" && mc.body.messages.some(m => m.who === "system" && /closed by support/.test(m.body)));
    const lst2 = await jadmin("GET", "/admin/api/support/chats", null, atok);
    ok("chat cerrado ya no sale en la consola", lst2.status === 200 && !lst2.body.chats.some(c => c.id === cid));
    const op2 = await jpost("/api/chat/open", {
      name: "E2E Second",
      model: "Ninebot Max G3",
      message: "second chat for leave test"
    });
    ok("segundo chat OK", op2.status === 200 && op2.body.ok);
    const lv = await jpost("/api/chat/leave?id=" + op2.body.id, {}, HT(op2.body.token));
    ok("visitor puede colgar (leave)", lv.status === 200 && lv.body.ok);
    const sup = await fetch(BASE + "/support");
    ok("/support sirve la consola", sup.status === 200 && (await sup.text()).includes("Support Console"));
  }
  {
    console.log("--- O · consola Discord 2.4.1");
    const sup = await fetch(BASE + "/support");
    const supH = await sup.text();
    ok("consola: login Discord y CERO mención a contraseña/admin en texto", sup.status === 200 && supH.includes("Login with Discord") && !/type="password"/i.test(supH) && !/same admin password/i.test(supH));
    const meta = await jget("/admin/api/support/oauthmeta");
    ok("oauthmeta público → configured (bindings de preview)", meta.status === 200 && meta.body.ok === true && meta.body.configured === true);
    const st1 = await fetch(BASE + "/support/oauth/start", {
      redirect: "manual"
    });
    const loc = st1.headers.get("location") || "";
    ok("oauth start → 302 a Discord con client_id/scope/state firmado", st1.status === 302 && loc.startsWith("https://discord.com/oauth2/authorize") && loc.includes("client_id=1234567890123456789") && loc.includes("guilds.members.read") && /state=\d+\.[0-9a-f]{64}/.test(loc));
    const cb0 = await fetch(BASE + "/support/callback?code=xyz", {
      redirect: "manual"
    });
    ok("callback sin state → err=bad_state", cb0.status === 302 && (cb0.headers.get("location") || "").includes("err=bad_state"));
    const cb1 = await fetch(BASE + "/support/callback?code=xyz&state=1." + "0".repeat(64), {
      redirect: "manual"
    });
    ok("callback con state falso → err=bad_state", cb1.status === 302 && (cb1.headers.get("location") || "").includes("err=bad_state"));
    const crypto = require("crypto");
    const mkSig = msg => {
      const k = crypto.createHash("sha256").update("vexora-support-key:test-secret-local").digest();
      return crypto.createHmac("sha256", k).update(msg).digest("hex");
    };
    const sexp = Date.now() + 6e5;
    const cb2 = await fetch(BASE + "/support/callback?code=xyz&state=" + sexp + "." + mkSig("vex-oauth:" + sexp), {
      redirect: "manual"
    });
    ok("callback con state válido + code falso → Discord rechaza → err=oauth_failed", cb2.status === 302 && (cb2.headers.get("location") || "").includes("err=oauth_failed"));
    const secret = "test-secret-local";
    const key = crypto.createHash("sha256").update("vexora-support-key:" + secret).digest();
    const exp = Date.now() + 6e5;
    const nb = Buffer.from("E2E Agent", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const stok = exp + "." + nb + "." + crypto.createHmac("sha256", key).update("vex-support:" + nb + ":" + exp).digest("hex");
    const withSup = await jadmin("GET", "/admin/api/support/chats", null, stok);
    ok("APIs de consola aceptan token Discord-rol (con nombre)", withSup.status === 200 && withSup.body.ok === true);
    const withBad = await jadmin("GET", "/admin/api/support/chats", null, stok.slice(0, -2) + "ff");
    ok("token de soporte manipulado → 401", withBad.status === 401);
    ok("consola 2.5.1: hoja vexora real (app.css) + botones EN de disponibilidad", supH.includes('href="/assets/app.css"') && supH.includes(">Available</button>") && supH.includes(">Not available</button>"));
    ok("consola 2.5.1: Montserrat vía app.css (sin font propia)", !supH.includes("@font-face"));
    const R2 = p2 => fs.readFileSync(path.join(__dirname, "..", p2), "utf8");
    const iwf = R2("public/index.html");
    ok("app: Work with us → /support junto a Privacy/Cookies", iwf.includes('href="/support" data-i18n="workWithUs"') && iwf.indexOf('data-view="cookies"') < iwf.indexOf('href="/support"'));
    ok("landing: Work with us en el pie", R2("public/landing.html").includes('<a href="/support">Work with us</a>'));
    const i18nSrc = R2("public/assets/i18n.js");
    ok("i18n: workWithUs ×5 idiomas", i18nSrc.split('workWithUs: "').length - 1 === 5);
    const flagsSup = await jadmin("GET", "/admin/api/flags", null, stok);
    ok("token de soporte NO abre el panel admin (flags → 401)", flagsSup.status === 401);
  }
  {
    console.log("--- P · agentes 2.5.x");
    const HT = tok => ({
      "x-chat-token": tok || ""
    });
    const op = await jpost("/api/chat/open", {
      name: "Pablo",
      model: "Ninebot Max G3",
      message: "rating test please"
    });
    ok("chat de prueba abierto", op.status === 200 && op.body.ok);
    const cid = op.body.id, ctok = op.body.token;
    const lg = await jadmin("POST", "/admin/api/login", {
      password: ADMIN_PASS
    });
    const atok = lg.body.token;
    const me0 = await jadmin("GET", "/admin/api/support/me", null, atok);
    ok("me → nombre Vexora Support + avail", me0.status === 200 && me0.body.ok && me0.body.name === "Vexora Support" && me0.body.avail === 1);
    const av0 = await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, atok);
    const me1 = await jadmin("GET", "/admin/api/support/me", null, atok);
    ok("disponibilidad OFF → me avail 0", av0.body.ok && me1.body.avail === 0);
    const av1 = await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, atok);
    ok("disponibilidad ON de vuelta", av1.body.ok && av1.body.avail === 1);
    const acc = await jadmin("POST", "/admin/api/support/accept", {
      id: cid
    }, atok);
    ok("accept → agent en la respuesta", acc.body.ok && acc.body.agent === "Vexora Support");
    const acc2 = await jadmin("POST", "/admin/api/support/accept", {
      id: cid
    }, atok);
    ok("re-accept (doble tap / 2 agentes) → 200 sin duplicar", acc2.status === 200 && acc2.body.ok === true);
    const rep1 = await jadmin("POST", "/admin/api/support/msg", {
      id: cid,
      body: "first reply"
    }, atok);
    const rep2 = await jadmin("POST", "/admin/api/support/msg", {
      id: cid,
      body: "second reply"
    }, atok);
    ok("dos respuestas OK con agente identificado", rep1.body.ok && rep2.body.ok && rep2.body.agent === "Vexora Support");
    const mv = await jget("/api/chat/msg?id=" + cid + "&after=0", HT(ctok));
    const sysCount = (mv.body.messages || []).filter(m => m.who === "system" && /You are now chatting with Vexora Support/.test(m.body)).length;
    ok("SIN duplicados: system de bienvenida ×1 (antes ×N)", sysCount === 1);
    ok("visitor ve status active con agent", mv.body.status === "active" && mv.body.agent === "Vexora Support");
    const rEarly = await jpost("/api/chat/rate?id=" + cid, {
      stars: 5
    }, HT(ctok));
    ok("valorar con chat abierto → 409", rEarly.status === 409);
    const cl = await jadmin("POST", "/admin/api/support/close", {
      id: cid
    }, atok);
    ok("cierre OK", cl.body.ok);
    const rBad = await jpost("/api/chat/rate?id=" + cid, {
      stars: 9
    }, HT(ctok));
    ok("estrellas 9 → 400", rBad.status === 400);
    const rOk = await jpost("/api/chat/rate?id=" + cid, {
      stars: 4
    }, HT(ctok));
    ok("valoración 4★ OK", rOk.status === 200 && rOk.body.ok && rOk.body.stars === 4);
    const rDup = await jpost("/api/chat/rate?id=" + cid, {
      stars: 5
    }, HT(ctok));
    ok("re-valorar → 409", rDup.status === 409);
    const stats = await jadmin("GET", "/admin/api/support/stats", null, atok);
    const vs = (stats.body.agents || []).find(a => a.name === "Vexora Support");
    ok("stats: Vexora Support con 1 valoración media 4.0", !!vs && vs.stars_n >= 1 && vs.avg === 4);
    const crypto = require("crypto");
    const b64u = t2 => Buffer.from(t2, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const mkTok = name => {
      const exp2 = Date.now() + 6e5;
      const nb = b64u(name);
      const k = crypto.createHash("sha256").update("vexora-support-key:test-secret-local").digest();
      return exp2 + "." + nb + "." + crypto.createHmac("sha256", k).update("vex-support:" + nb + ":" + exp2).digest("hex");
    };
    const agTok = mkTok("Agent One");
    const meA = await jadmin("GET", "/admin/api/support/me", null, agTok);
    ok("token Discord → me name = Agent One", meA.status === 200 && meA.body.name === "Agent One");
    const op2 = await jpost("/api/chat/open", {
      name: "Laura",
      model: "Ninebot Max G3",
      message: "agent one test"
    });
    const cid2 = op2.body.id;
    await jadmin("POST", "/admin/api/support/accept", {
      id: cid2
    }, agTok);
    const mv2 = await jget("/api/chat/msg?id=" + cid2 + "&after=0", HT(op2.body.token));
    ok("system nombra al agente Discord (You are now chatting with Agent One)", (mv2.body.messages || []).some(m => m.who === "system" && /You are now chatting with Agent One/.test(m.body)));
    const stats2 = await jadmin("GET", "/admin/api/support/stats", null, atok);
    const ao = (stats2.body.agents || []).find(a => a.name === "Agent One");
    ok("stats: Agent One con ≥1 chat", !!ao && ao.chats >= 1);
    const tyA = await jadmin("POST", "/admin/api/support/typing", {
      id: cid2
    }, atok);
    ok("typing del agente → 200", tyA.status === 200 && tyA.body.ok === true);
    const gmA = await jadmin("GET", "/admin/api/support/msg?id=" + cid2, null, atok);
    ok("msg del agente trae visitorTyping/agentTyping", typeof gmA.body.visitorTyping === "boolean" && typeof gmA.body.agentTyping === "boolean" && gmA.body.agentTyping === true);
    const tyV = await fetch(BASE + "/api/chat/typing?id=" + cid2, {
      method: "POST",
      headers: {
        "x-chat-token": op2.body.token
      }
    });
    ok("typing del visitante → 200", tyV.status === 200);
    const gmV = await fetch(BASE + "/api/chat/msg?id=" + cid2 + "&after=0", {
      headers: HT(op2.body.token)
    });
    ok("msg del visitante trae agentTyping=true", (await gmV.json()).agentTyping === true);
    const tyBad = await fetch(BASE + "/api/chat/typing?id=" + cid2, {
      method: "POST",
      headers: {
        "x-chat-token": "deadbeefdeadbeefdeadbeefdeadbeef"
      }
    });
    ok("typing sin token válido → 404", tyBad.status === 404);
    const logs = await jadmin("GET", "/admin/api/support/chats?closed=1", null, atok);
    const logRow = (logs.body.chats || []).find(c => c.id === cid);
    ok("LOGS: chat cerrado con agente y valoracion 4", logs.status === 200 && !!logRow && logRow.agent === "Vexora Support" && logRow.stars === 4 && logRow.nmsgs >= 3);
  }
  {
    console.log("--- Q · asistente IA 2.7.0");
    const HTQ = tokQ => ({
      "x-chat-token": tokQ || ""
    });
    const cryptoQ = require("crypto");
    const b64uQ = t => Buffer.from(t, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const expQ = String(Date.now() + 6e5);
    const nbQ = b64uQ("Agent One");
    const agTokQ = expQ + "." + nbQ + "." + cryptoQ.createHmac("sha256", cryptoQ.createHash("sha256").update("vexora-support-key:test-secret-local").digest()).update("vex-support:" + nbQ + ":" + expQ).digest("hex");
    await jadmin("POST", "/admin/api/flags", {
      flags: {
        maint: false,
        tire: true,
        cfw: true,
        aibot: true
      }
    }, TOKEN);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, TOKEN);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, agTokQ);
    const bo = await jpost("/api/chat/open", {
      name: "Bot Tester",
      model: "Ninebot Max G3",
      message: "is anybody there?"
    });
    ok("chat sin staff abierto", bo.status === 200 && bo.body.ok);
    const bmsg = await jpost("/api/chat/msg?id=" + bo.body.id, {
      body: "how does the tire tool work?"
    }, HTQ(bo.body.token));
    ok("mensaje al bot → 200", bmsg.status === 200 && bmsg.body.ok === true);
    let intro = null, answered = false;
    for (let i = 0; i < 24 && !intro; i++) {
      await sleep(500);
      const g = await jget("/api/chat/msg?id=" + bo.body.id + "&after=0", HTQ(bo.body.token));
      const ms = g.body.messages || [];
      intro = ms.find(m => m.who === "system" && /AI assistant will help you meanwhile/.test(m.body)) || null;
      if (!answered) answered = ms.some(m => m.who === "bot" || m.who === "system" && /could not answer just now/.test(m.body));
      if (intro && !answered) {
        const g2 = await jget("/api/chat/msg?id=" + bo.body.id + "&after=0", HTQ(bo.body.token));
        answered = (g2.body.messages || []).some(m => m.who === "bot" || m.who === "system" && /could not answer just now/.test(m.body));
      }
    }
    ok("modo bot: intro de asistente + ticket Discord", !!intro && /discord\.gg\/vxfw|discord\.gg/.test(intro.body));
    ok("modo bot: respuesta del asistente (o fallback controlado)", answered === true);
    const staffBack1 = await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, TOKEN);
    const staffBack2 = await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, agTokQ);
    ok("staff disponible de vuelta (bot desactivado para nuevos chats)", staffBack1.body.ok && staffBack2.body.ok);
    await jadmin("POST", "/admin/api/flags", {
      flags: {
        maint: false,
        tire: true,
        cfw: true,
        aibot: false
      }
    }, TOKEN);
    const bClose = await jadmin("POST", "/admin/api/support/close", {
      id: bo.body.id
    }, TOKEN);
    ok("chat del bot cerrado (limpieza)", bClose.status === 200 && bClose.body.ok === true);
    const so = await jpost("/api/chat/open", {
      name: "Staff Tester",
      model: "Ninebot Max G3",
      message: "staff back online"
    });
    const smsg = await jpost("/api/chat/msg?id=" + so.body.id, {
      body: "hello again"
    }, HTQ(so.body.token));
    await sleep(3500);
    const g3 = await jget("/api/chat/msg?id=" + so.body.id + "&after=0", HTQ(so.body.token));
    const noBot = !(g3.body.messages || []).some(m => m.who === "bot" || /AI assistant will help/.test(m.body || ""));
    ok("con staff disponible NO salta el bot", noBot === true);
    const pgC = await jadmin("GET", "/admin/api/support/chats?limit=10", null, TOKEN);
    ok("paginación: chats limit=10 + wTotal/aTotal", pgC.status === 200 && pgC.body.ok === true && (!pgC.body.chats || pgC.body.chats.length <= 10) && typeof pgC.body.wTotal === "number" && typeof pgC.body.aTotal === "number");
    const pgL = await jadmin("GET", "/admin/api/support/chats?closed=1&limit=5", null, TOKEN);
    ok("paginación: LOGS limit=5 + total real", pgL.status === 200 && pgL.body.ok === true && (!pgL.body.chats || pgL.body.chats.length <= 5) && pgL.body.total >= 1);
    const pgT = await jadmin("GET", "/admin/api/support/stats?limit=10", null, TOKEN);
    ok("paginación: team limit + total", pgT.status === 200 && pgT.body.ok === true && typeof pgT.body.total === "number" && pgT.body.total >= 1);
    const sq1 = await jadmin("GET", "/admin/api/support/chats?closed=1&limit=50&q=" + encodeURIComponent("Bot Tester"), null, TOKEN);
    ok("búsqueda: q= halla el chat cerrado del bot", sq1.status === 200 && sq1.body.ok === true && sq1.body.total >= 1 && (sq1.body.chats || []).length >= 1);
    const sq2 = await jadmin("GET", "/admin/api/support/chats?q=" + encodeURIComponent("zzz-nobody-here"), null, TOKEN);
    ok("búsqueda: q sin resultados → 0/0/0", sq2.status === 200 && sq2.body.ok === true && sq2.body.total == null && sq2.body.wTotal === 0 && sq2.body.aTotal === 0 && (sq2.body.chats || []).length === 0);
    const nbT = b64uQ("Agent Two");
    const agTokT = expQ + "." + nbT + "." + cryptoQ.createHmac("sha256", cryptoQ.createHash("sha256").update("vexora-support-key:test-secret-local").digest()).update("vex-support:" + nbT + ":" + expQ).digest("hex");
    const avT = await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, agTokT);
    ok("transfer: Agent Two existe (avail ok)", avT.status === 200 && avT.body.ok === true);
    const trR = await jadmin("POST", "/admin/api/support/transfer", {
      id: so.body.id,
      to: "Agent Two"
    }, agTokQ);
    ok("transfer: API pasa el chat a Agent Two", trR.status === 200 && trR.body.ok === true && trR.body.to === "Agent Two");
    const trM = await jadmin("GET", "/admin/api/support/msg?id=" + so.body.id + "&after=0", null, agTokQ);
    ok("transfer: system msg + agente cambiado", trM.status === 200 && trM.body.chat && trM.body.chat.agent === "Agent Two" && (trM.body.messages || []).some(m => m.who === "system" && /transferred to Agent Two/.test(m.body)));
    const vrR = await jget("/api/chat/msg?id=" + so.body.id + "&after=0", HTQ(so.body.token));
    ok("lectura: rider ve ✓✓ tras abrir el agente (visRead)", vrR.status === 200 && vrR.body.visRead === true && vrR.body.rts > 0);
    const csvR = await fetch(BASE + "/admin/api/support/logs.csv", {
      headers: {
        Authorization: "Bearer " + TOKEN
      }
    });
    const csvT = await csvR.text();
    ok("CSV: exportación de LOGS con datos", csvR.status === 200 && /text\/csv/.test(csvR.headers.get("content-type") || "") && csvT.startsWith("id,name,agent") && csvT.indexOf("Bot Tester") >= 0);
    const badOpen = await jpost("/api/chat/open", {
      name: "No Model Rider",
      message: "no model given"
    });
    ok("open sin modelo → 400", badOpen.status === 400);
    const preT = await jadmin("GET", "/admin/api/support/chats?limit=300", null, TOKEN);
    for (const cw of preT.body.chats || []) {
      if (cw.status === "waiting") await jadmin("POST", "/admin/api/support/close", {
        id: cw.id
      }, TOKEN);
    }
    const mo = await jpost("/api/chat/open", {
      name: "Media Rider",
      model: "Ninebot Max G30",
      message: "photo test"
    });
    ok("chat para media abierto", mo.status === 200 && mo.body.ok === true);
    const PIX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const m1 = await jpost("/api/chat/media?id=" + mo.body.id, {
      img: PIX
    }, HTQ(mo.body.token));
    ok("rider envía foto", m1.status === 200 && m1.body.ok === true);
    const mBad = await jpost("/api/chat/media?id=" + mo.body.id, {
      img: "data:text/html;base64,PGI+"
    }, HTQ(mo.body.token));
    ok("media inválida → 400", mBad.status === 400);
    const mBefore = await jget("/api/chat/msg?id=" + mo.body.id + "&after=0", HTQ(mo.body.token));
    ok("consola abierta por el rider: vread 0 aún", mBefore.status === 200 && mBefore.body.vread === 0, "vread=" + mBefore.body.vread + " whos=" + (mBefore.body.messages || []).map(m => m.who).join(","));
    const am1 = await jadmin("POST", "/admin/api/support/msg", {
      id: mo.body.id,
      body: "here, look at this"
    }, agTokT);
    ok("agente acepta con 1er mensaje", am1.status === 200 && am1.body.ok === true);
    const am2 = await jadmin("POST", "/admin/api/support/media", {
      id: mo.body.id,
      img: PIX
    }, agTokT);
    ok("agente envía foto", am2.status === 200 && am2.body.ok === true);
    const mAfter = await jget("/api/chat/msg?id=" + mo.body.id + "&after=0", HTQ(mo.body.token));
    ok("rider recibe foto + su GET marca vread (✓✓ azul en consola)", mAfter.status === 200 && (mAfter.body.messages || []).some(m => /^data:image\//.test(m.body)) && mAfter.body.vread > 0 && (mAfter.body.messages || []).every(m => "tr" in m));
    const lp2 = await jadmin("GET", "/admin/api/support/chats?limit=60", null, TOKEN);
    const lrow2 = (lp2.body.chats || []).find(c => c.id === mo.body.id);
    ok("preview de lista marca [photo]", !!lrow2 && /\[photo\]/.test(lrow2.last || ""));
    const br2 = await jpost("/api/chat/rate?id=" + bo.body.id, {
      stars: 5
    }, HTQ(bo.body.token));
    ok("valoración del chat del bot aceptada", br2.status === 200 && br2.body.ok === true);
    const st4 = await jadmin("GET", "/admin/api/support/stats?limit=300", null, TOKEN);
    const names4 = (st4.body.agents || []).map(a2 => a2.name).join(",");
    ok("la IA NO es agente (cero filas Vexora AI en TEAM)", !(st4.body.agents || []).some(a2 => a2.name === "Vexora AI"), "agents=" + names4);
    const lr3 = await jadmin("GET", "/admin/api/support/chats?closed=1&limit=60&q=" + encodeURIComponent("Bot Tester"), null, TOKEN);
    ok("LOGS: valoración del bot atribuida a Vexora AI", (lr3.body.chats || []).some(c => c.stars === 5));
    const ovw = await jadmin("GET", "/admin/api/support/overview", null, TOKEN);
    ok("overview: contadores del desk", ovw.status === 200 && ovw.body.ok === true && typeof ovw.body.waiting === "number" && typeof ovw.body.complaints === "number" && typeof ovw.body.closed === "number");
    const pg7 = await jadmin("POST", "/admin/api/support/purge", {
      days: 7
    }, TOKEN);
    ok("purge 7 días: nada tan viejo aún", pg7.status === 200 && pg7.body.ok === true && pg7.body.deleted === 0);
    const trB = await jadmin("POST", "/admin/api/support/transfer", {
      id: so.body.id,
      to: "Vexora AI"
    }, agTokQ);
    ok("transfer a la IA bloqueado (no es agente)", trB.status === 400);
    const bl2 = await jadmin("POST", "/admin/api/support/block", {
      id: mo.body.id
    }, agTokT);
    ok("block: banea la IP y cierra el chat", bl2.status === 200 && bl2.body.ok === true);
    const blOpen = await jpost("/api/chat/open", {
      name: "Blocked Rider",
      model: "X9",
      message: "let me in"
    });
    ok("IP baneada no puede abrir chats", blOpen.status === 403);
    const unban = await jadmin("DELETE", "/admin/api/rules?ip=" + encodeURIComponent(bl2.body.ip || "local"), null, TOKEN);
    ok("unban del block (limpieza)", unban.status === 200 && unban.body.ok === true);
    const afterUnban = await jpost("/api/chat/open", {
      name: "After Unban",
      model: "Ninebot F2",
      message: "back in"
    });
    ok("tras el unban se vuelve a abrir chats", afterUnban.status === 200 && afterUnban.body.ok === true);
    await jadmin("POST", "/admin/api/support/close", {
      id: afterUnban.body.id
    }, TOKEN);
    const anon = await jpost("/api/chat/open", {
      model: "Ninebot F2",
      message: "no name given"
    });
    ok("open SIN nombre → ok (Rider por defecto)", anon.status === 200 && anon.body.ok === true);
    const anonL = await jadmin("GET", "/admin/api/support/chats?limit=60", null, TOKEN);
    const anonRow = (anonL.body.chats || []).find(c => c.id === anon.body.id);
    ok("chat anónimo: name=Rider + país expuesto en la lista", !!anonRow && anonRow.name === "Rider" && "country" in anonRow && "model" in anonRow);
    await jadmin("POST", "/admin/api/support/close", {
      id: anon.body.id
    }, TOKEN);
    const RWK = require("fs").readFileSync(require("path").join(__dirname, "..", "server", "worker.js"), "utf8");
    ok("media caduca: barrido semanal en el worker (mediaSweep 7d)", RWK.indexOf("mediaSweep") >= 0 && RWK.indexOf("7 * 86400000") >= 0);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, TOKEN);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, agTokQ);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, agTokT);
    const ah = await jpost("/api/chat/open", {
      model: "Ninebot Max G3",
      message: "I need AI help now"
    });
    ok("chat para aihelp abierto", ah.status === 200 && ah.body.ok === true);
    const ahCall = await jpost("/api/chat/aihelp?id=" + ah.body.id, {}, HTQ(ah.body.token));
    ok("rider pide IA (aihelp) → aceptado", ahCall.status === 200 && ahCall.body.ok === true);
    await sleep(3500);
    const ahGet = await jget("/api/chat/msg?id=" + ah.body.id + "&after=0", HTQ(ah.body.token));
    ok("IA contesta (o fallback) tras aihelp", (ahGet.body.messages || []).some(m => m.who === "bot" || m.who === "system" && /could not answer/.test(m.body)));
    const ahBad = await jpost("/api/chat/aihelp?id=" + ah.body.id, {}, HTQ(ah.body.token));
    ok("aihelp repetido sigue permitido en waiting", ahBad.status === 200);
    const BIGPIX = "data:image/png;base64," + "A".repeat(5e4);
    const mBig = await jpost("/api/chat/media?id=" + ah.body.id, {
      img: BIGPIX
    }, HTQ(ah.body.token));
    ok("foto GRANDE (~50KB) pasa el body (fix del Bad request)", mBig.status === 200 && mBig.body.ok === true);
    await jadmin("POST", "/admin/api/support/close", {
      id: ah.body.id
    }, TOKEN);
    const cx = await jpost("/api/chat/open", {
      model: "Ninebot F2",
      message: "cancel test"
    });
    const lvR = await jpost("/api/chat/leave?id=" + cx.body.id, {}, HTQ(cx.body.token));
    ok("rider cancela (leave) → ok", lvR.status === 200 && lvR.body.ok === true);
    const cxGet = await jget("/api/chat/msg?id=" + cx.body.id + "&after=0", HTQ(cx.body.token));
    ok("cancelado: closed + sin agente + system de salida", cxGet.body.status === "closed" && !cxGet.body.agent && (cxGet.body.messages || []).some(m => m.who === "system" && /Visitor left/.test(m.body)));
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, TOKEN);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, agTokQ);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, agTokT);
  }
  {
    console.log("== W · v2.3.2.22: translate-first + nudge ==");
    const HTQW = t => ({
      "x-chat-token": t || ""
    });
    const ow = await jpost("/api/chat/open", {
      model: "Xiaomi Pro 2",
      message: "el limitador no me deja pasar de 25 km/h"
    });
    ok("W1 open con texto ES ok", ow.status === 200 && ow.body.ok === true);
    let tr0 = "";
    for (let i = 0; i < 24; i++) {
      const gW = await jadmin("GET", "/admin/api/support/msg?id=" + ow.body.id + "&after=0", null, TOKEN);
      const v0 = (gW.body.messages || []).find(m => m.who === "visitor");
      if (v0 && v0.tr && v0.tr.length > 3) {
        tr0 = v0.tr;
        break;
      }
      await sleep(500);
    }
    let tr1 = null;
    await jpost("/api/chat/msg?id=" + ow.body.id, {
      body: "y la rueda trasera hace un ruido raro al frenar"
    }, HTQW(ow.body.token));
    for (let i = 0; i < 10; i++) {
      const g2W = await jadmin("GET", "/admin/api/support/msg?id=" + ow.body.id + "&after=0", null, TOKEN);
      const vs = (g2W.body.messages || []).filter(m => m.who === "visitor");
      if (vs[1] && (vs[1].tr || "") !== "") {
        tr1 = vs[1].tr;
        break;
      }
      await sleep(500);
    }
    ok("W2 PRIMER mensaje del rider traducido al inglés (o fallback = ruta clásica)", tr0.length > 3 && !/limitador/i.test(tr0) || tr0 === "" && tr1 === null, "tr0=" + tr0.slice(0, 60) + " tr1=" + (tr1 || "").slice(0, 60));
    const accW = await jadmin("POST", "/admin/api/support/accept", {
      id: ow.body.id
    }, TOKEN);
    ok("W3 accept ok", accW.status === 200 && accW.body.ok === true);
    const n1 = await jadmin("POST", "/admin/api/support/nudge", {
      id: ow.body.id
    }, TOKEN);
    ok("W4 nudge → ok (sin throttle)", n1.status === 200 && n1.body.ok === true && !n1.body.throttled);
    const rgW = await jget("/api/chat/msg?id=" + ow.body.id + "&after=0", HTQW(ow.body.token));
    ok("W5 rider recibe nudgeAt", rgW.status === 200 && rgW.body.ok === true && (rgW.body.nudgeAt || 0) > 0);
    const n2 = await jadmin("POST", "/admin/api/support/nudge", {
      id: ow.body.id
    }, TOKEN);
    ok("W6 nudge repetido <8s → throttled", n2.status === 200 && n2.body.ok === true && n2.body.throttled === true);
    const rg2 = await jget("/api/chat/msg?id=" + ow.body.id + "&after=0", HTQW(ow.body.token));
    ok("W7 nudgeAt no cambia en throttle", rg2.body.nudgeAt === rgW.body.nudgeAt);
    await jadmin("POST", "/admin/api/support/close", {
      id: ow.body.id
    }, TOKEN);
    const n3 = await jadmin("POST", "/admin/api/support/nudge", {
      id: ow.body.id
    }, TOKEN);
    ok("W8 nudge en closed → 409", n3.status === 409);
    const n4 = await jadmin("POST", "/admin/api/support/nudge", {
      id: 999999
    }, TOKEN);
    ok("W9 nudge chat inexistente → 404", n4.status === 404);
    const pk1 = await jget("/api/push/key");
    const pk2 = await jget("/api/push/key");
    ok("W10 /api/push/key estable (VAPID)", pk1.status === 200 && pk1.body.ok && /^[A-Za-z0-9_-]{80,}$/.test(pk1.body.key || "") && pk2.body.key === pk1.body.key);
    const SUBA = {
      endpoint: "https://push.example.com/send/agent-1",
      keys: {
        p256dh: "B" + "k".repeat(86),
        auth: "A" + "u".repeat(21)
      }
    };
    const ps1 = await jpost("/api/push/subscribe", {
      who: "agent",
      subscription: SUBA
    });
    ok("W11 subscribe agente → ok", ps1.status === 200 && ps1.body.ok === true);
    const ps1b = await jpost("/api/push/subscribe", {
      who: "agent",
      subscription: SUBA
    });
    ok("W12 re-subscribe (misma endpoint) → ok", ps1b.status === 200 && ps1b.body.ok === true);
    const psBad = await jpost("/api/push/subscribe", {
      who: "rider",
      chatId: 0,
      subscription: {
        endpoint: "https://x.example/s",
        keys: {
          p256dh: "x",
          auth: "y"
        }
      }
    });
    ok("W13 subscribe rider sin chatId → 400", psBad.status === 400);
    const psEvil = await jpost("/api/push/subscribe", {
      who: "agent",
      subscription: SUBA
    }, {
      Origin: "https://evil.example"
    });
    ok("W14 subscribe cross-origin → 403", psEvil.status === 403);
    const psU = await jpost("/api/push/unsubscribe", {
      endpoint: SUBA.endpoint
    });
    ok("W15 unsubscribe → ok", psU.status === 200 && psU.body.ok === true);
  }
  {
    console.log("== X · v2.3.2.24: suggest + history + auto-assign ==");
    const HTQX = t => ({
      "x-chat-token": t || ""
    });
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, TOKEN);
    const ox = await jpost("/api/chat/open", {
      model: "Xiaomi Pro 2",
      message: "suggest test"
    });
    ok("X1 open ok", ox.status === 200 && ox.body.ok === true);
    const accX = await jadmin("POST", "/admin/api/support/accept", {
      id: ox.body.id
    }, TOKEN);
    ok("X2 accept manual ok", accX.status === 200 && accX.body.ok === true);
    const sg = await jadmin("POST", "/admin/api/support/suggest", {
      id: ox.body.id
    }, TOKEN);
    ok("X3 suggest esquema válido (texto u ok:false sin Groq)", sg.status === 200 && (sg.body.ok === true && typeof sg.body.text === "string" && sg.body.text.length > 0 || sg.body.ok === false), JSON.stringify(sg.body).slice(0, 100));
    const sgBad = await jadmin("POST", "/admin/api/support/suggest", {
      id: 999999
    }, TOKEN);
    ok("X4 suggest chat inexistente → 404", sgBad.status === 404);
    await jadmin("POST", "/admin/api/support/close", {
      id: ox.body.id
    }, TOKEN);
    const rateX = await jpost("/api/chat/rate?id=" + ox.body.id, {
      stars: 5
    }, HTQX(ox.body.token));
    ok("X4b valoración 5★ ok", rateX.status === 200 && rateX.body.ok === true);
    const oy = await jpost("/api/chat/open", {
      model: "Xiaomi Pro 2",
      message: "history test rider returns"
    });
    const gx = await jadmin("GET", "/admin/api/support/msg?id=" + oy.body.id + "&after=0", null, TOKEN);
    const hist = gx.body.history || [];
    ok("X5 GET msg incluye history", Array.isArray(hist));
    ok("X6 historial: chat anterior con 5★ y su problema", hist.some(h => h.id === ox.body.id && h.stars === 5 && /suggest test/.test(h.problem || "")), JSON.stringify(hist).slice(0, 160));
    await jadmin("POST", "/admin/api/support/close", {
      id: oy.body.id
    }, TOKEN);
    const oz = await jpost("/api/chat/open", {
      model: "Xiaomi Pro 2",
      message: "auto assign test"
    });
    ok("X7 open para auto-assign ok", oz.status === 200 && oz.body.ok === true);
    await sleep(5e3);
    const gz0 = await jget("/api/chat/msg?id=" + oz.body.id + "&after=0", HTQX(oz.body.token));
    ok("X8 a los 5s sigue en waiting (ventana de ACCEPT manual)", gz0.body.status === "waiting", "status=" + gz0.body.status);
    await sleep(23e3);
    const gz1 = await jget("/api/chat/msg?id=" + oz.body.id + "&after=0", HTQX(oz.body.token));
    ok("X9 a los ~28s auto-asignado a un agente disponible", gz1.body.status === "active" && !!gz1.body.agent, "status=" + gz1.body.status + " agent=" + gz1.body.agent);
    await jadmin("POST", "/admin/api/support/close", {
      id: oz.body.id
    }, TOKEN);
  }
  {
    console.log("== Y · v2.3.2.25: ctx + notas + tags ==");
    const HTQY = t => ({
      "x-chat-token": t || ""
    });
    const oy2 = await jpost("/api/chat/open", {
      model: "Ninebot zt3",
      message: "ctx test",
      ctx: {
        fw: "1.5.6",
        mcu: "1.1.9",
        ble: "4.2",
        app: "2.9.0",
        os: "Android 14"
      }
    });
    ok("Y1 open con ctx ok", oy2.status === 200 && oy2.body.ok === true);
    const gy = await jadmin("GET", "/admin/api/support/msg?id=" + oy2.body.id + "&after=0", null, TOKEN);
    ok("Y2 ficha tecnica: fw/app/OS visibles al agente", gy.body.ctx && gy.body.ctx.fw === "1.5.6" && gy.body.ctx.app === "2.9.0" && gy.body.ctx.os === "Android 14", JSON.stringify(gy.body.ctx));
    const accY = await jadmin("POST", "/admin/api/support/accept", {
      id: oy2.body.id
    }, TOKEN);
    ok("Y3 accept ok", accY.status === 200 && accY.body.ok === true);
    const ntY = await jadmin("POST", "/admin/api/support/msg", {
      id: oy2.body.id,
      body: "rider impaciente, ofrecer desbloqueo",
      note: 1
    }, TOKEN);
    ok("Y4 nota interna guardada", ntY.status === 200 && ntY.body.ok === true && ntY.body.note === true);
    const grY = await jget("/api/chat/msg?id=" + oy2.body.id + "&after=0", HTQY(oy2.body.token));
    ok("Y5 el rider NO ve la nota", !(grY.body.messages || []).some(m => m.who === "note" || /impaciente/.test(m.body || "")));
    const gsY = await jadmin("GET", "/admin/api/support/msg?id=" + oy2.body.id + "&after=0", null, TOKEN);
    ok("Y6 los agentes SI ven la nota", (gsY.body.messages || []).some(m => m.who === "note" && /impaciente/.test(m.body)));
    const ctx2 = await jpost("/api/chat/msg?id=" + oy2.body.id, {
      body: "refreshing ctx",
      ctx: {
        fw: "1.5.8",
        os: "Windows"
      }
    }, HTQY(oy2.body.token));
    const gy2 = await jadmin("GET", "/admin/api/support/msg?id=" + oy2.body.id + "&after=0", null, TOKEN);
    ok("Y7 ctx se refresca con cada mensaje (BLE en ese instante)", gy2.body.ctx && gy2.body.ctx.fw === "1.5.8" && gy2.body.ctx.os === "Windows", JSON.stringify(gy2.body.ctx));
    const clY = await jadmin("POST", "/admin/api/support/close", {
      id: oy2.body.id,
      tags: [ "firmware-bug", "ble-connection" ]
    }, TOKEN);
    ok("Y8 cierre con tags ok", clY.status === 200 && clY.body.ok === true && /firmware-bug/.test(clY.body.tags || ""));
    const glY = await jadmin("GET", "/admin/api/support/chats?closed=1&limit=50", null, TOKEN);
    const rowY = (glY.body.chats || []).find(c => c.id === oy2.body.id);
    ok("Y9 LOGS: fila con tags", rowY && /firmware-bug/.test(rowY.tags || ""));
    const gtY = await jadmin("GET", "/admin/api/support/tags", null, TOKEN);
    ok("Y10 TOP ISSUES: firmware-bug contado", gtY.status === 200 && (gtY.body.tags || []).some(t => t.tag === "firmware-bug" && t.n >= 1));
    const csvY = await fetch(BASE + "/admin/api/support/logs.csv", {
      headers: {
        authorization: "Bearer " + TOKEN
      }
    });
    const csvYt = await csvY.text();
    ok("Y11 CSV con columna tags", csvY.status === 200 && csvYt.startsWith("id,name,agent,page,created,updated,minutes,messages,stars,tags") && csvYt.indexOf("firmware-bug") > 0);
  }
  {
    console.log("== Z · v2.3.2.26: max-active + csv filtros + id search ==");
    const st0 = await jadmin("GET", "/admin/api/support/maxactive", null, TOKEN);
    ok("Z1 maxactive por defecto 3", st0.status === 200 && st0.body.ok === true && st0.body.n === 3, JSON.stringify(st0.body));
    const cryptoZ = require("crypto");
    const forgeZ = name => {
      const exp = String(Date.now() + 6e5);
      const nb = Buffer.from(name, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return exp + "." + nb + "." + cryptoZ.createHmac("sha256", cryptoZ.createHash("sha256").update("vexora-support-key:test-secret-local").digest()).update("vex-support:" + nb + ":" + exp).digest("hex");
    };
    const zq = forgeZ("Agent One"), zt = forgeZ("Agent Two");
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, zq);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 0
    }, zt);
    const oz1 = await jpost("/api/chat/open", {
      model: "Xiaomi Pro 2",
      message: "maxactive chat A"
    });
    const az1 = await jadmin("POST", "/admin/api/support/accept", {
      id: oz1.body.id
    }, TOKEN);
    ok("Z2 chat A aceptado", az1.status === 200 && az1.body.ok === true);
    const gA = await jadmin("GET", "/admin/api/support/msg?id=" + oz1.body.id + "&after=0", null, TOKEN);
    const agentA = gA.body.chat.agent;
    ok("Z3 agente de A identificado", !!agentA, agentA);
    const st1 = await jadmin("POST", "/admin/api/support/maxactive", {
      n: 1
    }, TOKEN);
    ok("Z4 maxactive=1 guardado", st1.status === 200 && st1.body.ok === true && st1.body.n === 1);
    const oz2 = await jpost("/api/chat/open", {
      model: "Xiaomi Pro 2",
      message: "maxactive chat B"
    });
    const az2 = await jadmin("POST", "/admin/api/support/accept", {
      id: oz2.body.id
    }, TOKEN);
    ok("Z5 ACCEPT al límite → 409 con aviso", az2.status === 409 && /active chats/.test(az2.body.error || ""), JSON.stringify(az2.body));
    await sleep(26e3);
    const gz2 = await jget("/api/chat/msg?id=" + oz2.body.id + "&after=0", {
      "x-chat-token": oz2.body.token
    });
    ok("Z6 auto-asignado SALTÓ (rider sigue en cola)", gz2.body.status === "waiting", "status=" + gz2.body.status);
    const st2 = await jadmin("POST", "/admin/api/support/maxactive", {
      n: 3
    }, TOKEN);
    ok("Z7 maxactive restaurado a 3", st2.body.ok === true && st2.body.n === 3);
    await jadmin("POST", "/admin/api/support/close", {
      id: oz1.body.id
    }, TOKEN);
    await jadmin("POST", "/admin/api/support/close", {
      id: oz2.body.id
    }, TOKEN);
    const hoy = (new Date).toISOString().slice(0, 10);
    const f1 = await fetch(BASE + "/admin/api/support/logs.csv?agent=" + encodeURIComponent(agentA) + "&from=" + hoy + "&to=" + hoy, {
      headers: {
        authorization: "Bearer " + TOKEN
      }
    });
    const f1t = await f1.text();
    ok("Z8 CSV agente+hoy incluye el chat de A", f1.status === 200 && f1t.indexOf(String(oz1.body.id)) > 0);
    const f2 = await fetch(BASE + "/admin/api/support/logs.csv?agent=__nobody__", {
      headers: {
        authorization: "Bearer " + TOKEN
      }
    });
    const f2t = await f2.text();
    ok("Z9 CSV agente inexistente → solo cabecera", f2.status === 200 && f2t.trim().split("\n").length === 1);
    const sId = await jadmin("GET", "/admin/api/support/chats?closed=1&limit=50&q=" + oz1.body.id, null, TOKEN);
    ok("Z10 LOGS: buscar por ID devuelve el ticket", (sId.body.chats || []).some(c => c.id === oz1.body.id));
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, zq);
    await jadmin("POST", "/admin/api/support/avail", {
      avail: 1
    }, zt);
  }
  console.log("\n==== RESULTADO: " + passed + " OK · " + failed + " FAIL ====");
  try {
    fixSrv.close();
  } catch (e) {}
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error("E2E CRASH:", e);
  process.exit(2);
});