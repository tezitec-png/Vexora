"use strict";

const BASE = "http://127.0.0.1:8788";

const {JSDOM: JSDOM, VirtualConsole: VirtualConsole} = require("jsdom");

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wait(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (fn()) return true;
    } catch {}
    await sleep(150);
  }
  console.log("  (timeout esperando " + label + ")");
  return false;
}

(async () => {
  console.log("VEXORA live chat UI smoke · " + BASE);
  for (let i = 0; i < 40; i++) {
    try {
      const h = await fetch(BASE + "/api/health");
      if (h.status === 200) break;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  const jsErrors = [];
  const vc = new VirtualConsole;
  vc.on("jsdomError", e => {
    const m = String(e && e.message || e);
    if (!/Could not load|not implemented/i.test(m)) jsErrors.push(m);
  });
  vc.on("error", m => jsErrors.push(String(m)));
  const raw = await (await fetch(BASE + "/app")).text();
  const cver = (raw.match(/chat\.js\?v=(\d+)/) || [])[1] || "1675";
  const chatjs = await (await fetch(BASE + "/assets/chat.js?v=" + cver)).text();
  const html = raw.replace(new RegExp('<script src="/assets/chat\\.js\\?v=' + cver + '" defer><\/script>'), () => "<script>" + chatjs + "<\/script>");
  const dom = new JSDOM(html, {
    url: BASE + "/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
      try {
        w.localStorage.setItem("vex.privacy.v1", "1");
      } catch (e) {}
    }
  });
  const {window: window} = dom;
  const $ = q => window.document.querySelector(q);
  const $$ = q => Array.from(window.document.querySelectorAll(q));
  await wait(() => !!$("#vcw-bub"), 5e3, "widget");
  ok("widget inyecta la burbuja", !!$("#vcw-bub"));
  ok("boot sin errores JS", jsErrors.length === 0, jsErrors.join("|").slice(0, 200));
  ok("chat: gate 14+ + privacidad presente (vex.privacy.v1 + consent)", /vex\.privacy\.v1/.test(chatjs) && /consent: true/.test(chatjs) && chatjs.includes("vcw-consent"));
  $("#vcw-bub").click();
  ok("burbuja abre el panel", $("#vcw-root").classList.contains("open"));
  ok("panel muestra el formulario de inicio", $("#vcw-start").style.display !== "none");
  ok("el nombre ya NO se pide en el formulario", !$("#vcw-name"));
  $("#vcw-q").value = "Hello, my speed cap is not working";
  $("#vcw-go").click();
  await wait(() => /scooter model/.test($("#vcw-err").textContent), 3e3, "error de modelo obligatorio");
  ok("sin modelo NO abre el chat (error visible)", /scooter model/.test($("#vcw-err").textContent));
  $("#vcw-model").value = "Ninebot Max G30";
  $("#vcw-go").click();
  await wait(() => window.eval("!!window.__vcwSessForTest") === true, 100, "skip");
  await wait(() => /Hello, my speed cap/.test($("#vcw-msgs").textContent), 6e3, "mensaje visitante");
  ok("Start chat pinta el mensaje del visitante", /Hello, my speed cap/.test($("#vcw-msgs").textContent));
  ok("estado: searching for an agent", /Searching for an agent/.test($("#vcw-sttxt").textContent));
  ok("espera: botones Cancelar y Ayuda IA visibles", $("#vcw-waitbar").classList.contains("on") && !!$("#vcw-wcancel") && !!$("#vcw-wai"));
  ok("candado: la ✕ está oculta mientras espera", $("#vcw-x").style.display === "none");
  ok("botones de foto y voz en el widget", !!$("#vcw-photo") && !!$("#vcw-mic"));
  const crypto = require("crypto");
  const ksup = crypto.createHash("sha256").update("vexora-support-key:test-secret-local").digest();
  const sexp = String(Date.now() + 6e5);
  const snb = Buffer.from("Smoke Agent", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const atok = sexp + "." + snb + "." + crypto.createHmac("sha256", ksup).update("vex-support:" + snb + ":" + sexp).digest("hex");
  const lst = await (await fetch(BASE + "/admin/api/support/chats", {
    headers: {
      authorization: "Bearer " + atok
    }
  })).json();
  const chat = (lst.chats || []).filter(c => c.model === "Ninebot Max G30" && c.status === "waiting").pop();
  ok("la consola ve el chat del smoke", !!chat && chat.status === "waiting");
  await fetch(BASE + "/admin/api/support/accept", {
    method: "POST",
    headers: {
      authorization: "Bearer " + atok,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: chat.id
    })
  });
  await fetch(BASE + "/admin/api/support/msg", {
    method: "POST",
    headers: {
      authorization: "Bearer " + atok,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: chat.id,
      body: "Hi! Send me your scooter model please"
    })
  });
  await wait(() => /Hi! Send me your scooter model/.test($("#vcw-msgs").textContent), 8e3, "respuesta del agente (poll 3s)");
  ok("el visitante recibe la respuesta del agente (poll)", /Hi! Send me your scooter model/.test($("#vcw-msgs").textContent));
  ok("estado pasa a chatting", /Chatting with Smoke Agent/.test($("#vcw-sttxt").textContent));
  const crypto6 = require("crypto");
  const ksup6 = crypto6.createHash("sha256").update("vexora-support-key:test-secret-local").digest();
  const sexp6 = String(Date.now() + 6e5);
  const snb6 = Buffer.from("Smoke Agent", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tok6 = sexp6 + "." + snb6 + "." + crypto6.createHmac("sha256", ksup6).update("vex-support:" + snb6 + ":" + sexp6).digest("hex");
  await fetch(BASE + "/admin/api/support/typing", {
    method: "POST",
    headers: {
      authorization: "Bearer " + tok6,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: chat.id
    })
  });
  await wait(() => $("#vcw-typing").style.display === "block", 9e3, "typing indicator");
  ok("widget: 'Agent is typing…' visible", $("#vcw-typing").style.display === "block");
  $("#vcw-in").value = "It is a G3 Max, fw 1.5.8";
  $("#vcw-send").click();
  await wait(() => /G3 Max, fw 1.5.8/.test($("#vcw-msgs").textContent), 6e3, "respuesta del visitante");
  ok("visitor envía desde el widget", /G3 Max, fw 1.5.8/.test($("#vcw-msgs").textContent));
  const after = await (await fetch(BASE + "/admin/api/support/msg?id=" + chat.id + "&after=0", {
    headers: {
      authorization: "Bearer " + atok
    }
  })).json();
  ok("el agente recibe la respuesta", (after.messages || []).some(m => m.who === "visitor" && /G3 Max/.test(m.body)));
  await wait(() => $("#vcw-msgs .tick.read"), 1e4, "ticks ✓✓ en el widget");
  ok("widget: ✓✓ azul de leído en el mensaje del visitante", !!$("#vcw-msgs .tick.read"));
  ok("en activo la ✕ sigue bloqueada (no salir hasta finalizar)", $("#vcw-x").style.display === "none");
  const nudR = await fetch(BASE + "/admin/api/support/nudge", {
    method: "POST",
    headers: {
      authorization: "Bearer " + atok,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: chat.id
    })
  });
  const nudB = await nudR.json();
  ok("agente envía nudge → ok", nudR.status === 200 && nudB.ok === true, JSON.stringify(nudB));
  await wait(() => $("#vcw-nudge") && $("#vcw-nudge").classList.contains("on"), 9e3, "banner de nudge en el widget");
  ok("widget: banner 'open chat' visible con sonido", !!$("#vcw-nudge") && $("#vcw-nudge").classList.contains("on") && /open chat/.test($("#vcw-nudge").textContent));
  await fetch(BASE + "/admin/api/support/close", {
    method: "POST",
    headers: {
      authorization: "Bearer " + atok,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: chat.id
    })
  });
  await wait(() => /This chat was closed/.test($("#vcw-msgs").textContent), 9e3, "aviso de cierre");
  ok("cierre llega al widget con valoración", /Rate your agent/.test($("#vcw-msgs").textContent) && !!$("#vcw-closed"));
  ok("valoración obligatoria: la ✕ está oculta hasta valorar", $("#vcw-x").style.display === "none");
  const sysWelcome = ($("#vcw-msgs").textContent.match(/You are now chatting with Smoke Agent/g) || []).length;
  ok("welcome system ×1 (sin duplicados en pantalla)", sysWelcome === 1, "veces=" + sysWelcome);
  ok("widget: boton Save transcript", /Save transcript/.test($("#vcw-closed").textContent));
  ok("widget: boton de sonido presente", !!$("#vcw-mute"));
  const starBtns = $$("#vcw-closed .vcw-star");
  ok("5 estrellas visibles", starBtns.length === 5);
  starBtns[3].click();
  await wait(() => !!$("#vcw-thanks"), 6e3, "pantalla de gracias");
  ok("valoración 4★ aceptada: thank-you verde visible", !!$("#vcw-thanks") && /Thank you!/.test($("#vcw-thanks").textContent));
  ok("tras valorar, la ✕ vuelve", $("#vcw-x").style.display !== "none");
  const stStats = await (await fetch(BASE + "/admin/api/support/stats", {
    headers: {
      authorization: "Bearer " + atok
    }
  })).json();
  const vsRow = (stStats.agents || []).find(a => a.name === "Smoke Agent");
  ok("stats del agente reflejan la valoración", !!vsRow && vsRow.stars_n >= 1 && vsRow.avg === 4);
  try {
    window.localStorage.removeItem("vex.privacy.v1");
  } catch (e) {}
  $("#vcw-go").click();
  ok("sin consentimiento → aviso 14+ + privacidad (no envía)", !!$("#vcw-consent") && /Privacy/.test($("#vcw-consent").textContent) && !!$("#vcw-cok"));
  $("#vcw-cno").click();
  ok("'Not now' cierra el aviso sin enviar", !$("#vcw-consent"));
  ok("cero errores JS al final", jsErrors.length === 0, jsErrors.join("|").slice(0, 200));
  console.log(`==== CHAT UI SMOKE: ${passed} OK · ${failed} FAIL ====`);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error("SMOKE CRASH:", e);
  process.exit(2);
});