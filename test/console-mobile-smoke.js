"use strict";

const BASE = "http://127.0.0.1:8788";

const {JSDOM: JSDOM, VirtualConsole: VirtualConsole} = require("jsdom");

const crypto = require("crypto");

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
  console.log("  (timeout " + label + ")");
  return false;
}

function forgeToken(name) {
  const k = crypto.createHash("sha256").update("vexora-support-key:test-secret-local").digest();
  const exp = String(Date.now() + 6e5);
  const nb = Buffer.from(name, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return exp + "." + nb + "." + crypto.createHmac("sha256", k).update("vex-support:" + nb + ":" + exp).digest("hex");
}

(async () => {
  console.log("VEXORA console MOBILE smoke · " + BASE);
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
  const raw = await (await fetch(BASE + "/support")).text();
  const dom = new JSDOM(raw, {
    url: BASE + "/support#ac=" + forgeToken("Mob Agent"),
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = function(u, o) {
        return fetch(new URL(u, BASE).href, o);
      };
      w.matchMedia = function(q) {
        return {
          matches: /max-width: 919/.test(String(q)),
          media: String(q),
          addEventListener() {},
          removeEventListener() {},
          addListener() {}
        };
      };
    }
  });
  const {window: window} = dom;
  const $ = q => window.document.querySelector(q);
  await wait(() => $("#console").classList.contains("on"), 8e3, "login");
  ok("consola logueada en móvil", $("#console").classList.contains("on"));
  ok("tabbar móvil visible", $("#mtabs").hidden === false);
  ok("5 pestañas (Chats/Team/Logs/Me/Settings)", window.document.querySelectorAll("#mtabs .mtab").length === 5);
  ok("por defecto: CHATS activa", $('[data-t="chats"]').classList.contains("on") && $("#tpChats").classList.contains("on"));
  ok("listas WAITING/ACTIVE en la pestaña Chats", !!$("#listWait").closest("#tpChats") && !!$("#listAct").closest("#tpChats"));
  ok("Team: ranking + TOP ISSUES juntos", !!$("#team").closest("#tpTeam") && !!$("#topTags").closest("#tpTeam"));
  ok("Logs: buscador + CSV + lista cerrados", !!$("#qLogs").closest("#mSearchLogs") && !!$("#btnCsv").closest("#mSearchLogs") && !!$("#logs").closest("#tpLogs"));
  ok("Me: avail + salir + quién soy", !!$("#avrow").closest("#meCard") && !!$("#btnOut").closest("#meCard") && !!$("#whoami").closest("#meCard"));
  window.document.querySelector('[data-t="settings"]').click();
  ok("Settings: sonido, volumen, test y max active (sin flotantes)", $("#tpSettings").classList.contains("on") && !!$("#btnBell").closest("#tpSettings") && !!$("#popVol") && !!$("#popTest") && !!$("#popMaxN"));
  ok("push en Settings", !!$("#btnPush").closest("#tpSettings"));
  ok("anti-rotura: chips con altura máxima y scroll", Array.from(window.document.querySelectorAll("style")).some(s => /#chips \{ max-height/.test(s.textContent)));
  ok("sheet: z 40 bajo la tabbar (50) + hueco para ella", Array.from(window.document.querySelectorAll("style")).some(s => /@media \(max-width: 919px\)[\s\S]*\.pane\s*\{[^}]*z-index:\s*40[\s\S]*?height:\s*calc\(100dvh - 64px - env\(safe-area-inset-bottom\)\)/.test(s.textContent)) && !/z-index:\s*60/.test(Array.from(window.document.querySelectorAll("style")).map(x => x.textContent).join("")));
  var pS12 = window.document.getElementById("pane");
  pS12.classList.add("on", "sheet");
  window.document.body.classList.add("svlock");
  window.document.querySelector('[data-t="team"]').click();
  ok("cambiar de pestaña cierra el chat en móvil también", !pS12.classList.contains("on") && !window.document.body.classList.contains("svlock"));
  ok("móvil: listas a lo ancho (chatListCol 100%)", Array.from(window.document.querySelectorAll("style")).some(s => /@media \(max-width: 919px\)[\s\S]*#chatListCol\s*\{[^}]*width:\s*100%/.test(s.textContent)));
  window.document.querySelector('[data-t="chats"]').click();
  ok("píldora Avail/N-A en la cabecera", $("#mAvail").hidden === false);
  const vis = await fetch(BASE + "/api/chat/open", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "10.8.8.8"
    },
    body: JSON.stringify({
      model: "Mob Probe G30",
      message: "mobile smoke hello"
    })
  }).then(r => r.json());
  ok("rider abre chat (API)", vis.ok === true);
  await wait(() => !!$("#listWait .it"), 8e3, "waiting en móvil");
  ok("WAITING visible en la pestaña Chats", !!$("#listWait .it"));
  await wait(() => $("#nbChats").hidden === false, 5e3, "badge");
  ok("badge de chats en la tabbar", $("#nbChats").hidden === false && Number($("#nbChats").textContent) >= 1, "nb=" + $("#nbChats").textContent);
  const pill = $("#listWait [data-accept]");
  ok("pill ACCEPT presente en móvil", !!pill);
  if (pill) pill.click();
  await wait(() => $("#pane").classList.contains("on"), 8e3, "pane");
  ok("ACCEPT → chat abierto", $("#pane").classList.contains("on"));
  window.document.querySelector('[data-t="team"]').click();
  ok("cambio a pestaña Team", $('[data-t="team"]').classList.contains("on") && $("#tpTeam").classList.contains("on") && !$("#tpChats").classList.contains("on"));
  window.document.querySelector('[data-t="me"]').click();
  ok("pestaña Me con Log out disponible", $("#tpMe").classList.contains("on") && !!$("#btnOut"));
  ok("cero errores JS al final", jsErrors.length === 0, jsErrors.join("|").slice(0, 200));
  console.log(`==== CONSOLE MOBILE SMOKE: ${passed} OK · ${failed} FAIL ====`);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error("MOBILE SMOKE CRASH:", e);
  process.exit(2);
});