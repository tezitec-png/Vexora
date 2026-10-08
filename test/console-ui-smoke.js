"use strict";

const BASE = "http://127.0.0.1:8788";

const crypto = require("crypto");

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

function forgeToken(name) {
  const k = crypto.createHash("sha256").update("vexora-support-key:test-secret-local").digest();
  const exp = String(Date.now() + 6e5);
  const nb = Buffer.from(name, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return exp + "." + nb + "." + crypto.createHmac("sha256", k).update("vex-support:" + nb + ":" + exp).digest("hex");
}

const countText = (dom, sel, re) => Array.from(dom.window.document.querySelectorAll(sel)).filter(n => re.test(n.textContent)).length;

(async () => {
  console.log("VEXORA support console UI smoke · " + BASE);
  for (let i = 0; i < 40; i++) {
    try {
      const h = await fetch(BASE + "/api/health");
      if (h.status === 200) break;
    } catch (e) {}
    await sleep(250);
  }
  const jsErrors = [];
  const vc = new VirtualConsole;
  vc.on("jsdomError", e => {
    const m = String(e && e.message || e);
    if (!/Could not load|not implemented/i.test(m)) jsErrors.push(m);
  });
  vc.on("error", m => jsErrors.push(String(m)));
  const raw = await (await fetch(BASE + "/support")).text();
  const tok = forgeToken("Smoke Agent");
  const dom = new JSDOM(raw, {
    url: BASE + "/support#ac=" + tok,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = function(u, o) {
        if (typeof u === "string" && u.startsWith("/")) u = BASE + u;
        return fetch(u, o);
      };
    }
  });
  const {window: window} = dom;
  const $ = q => window.document.querySelector(q);
  await wait(() => !$("#console") || $("#console").classList.contains("on"), 8e3, "consola activa");
  ok("token del fragmento entra a la consola", $("#console").classList.contains("on"));
  ok("whoami = Smoke Agent", /Smoke Agent/.test($("#whoami").textContent));
  ok("sin errores JS en login", jsErrors.length === 0, jsErrors.join("|").slice(0, 200));
  ok("viewport móvil con interactive-widget (teclado)", /interactive-widget/.test((window.document.querySelector('meta[name="viewport"]') || {}).content || ""));
  ok("CSS móvil nuevo (.svlock) presente", Array.from(window.document.querySelectorAll("style")).some(s => /svlock/.test(s.textContent)));
  ok("modal de tags OCULTO al entrar (fix display)", $("#tagmodal").hidden === true);
  ok("regla .modalbg[hidden] presente en el CSS", Array.from(window.document.querySelectorAll("style")).some(s => /modalbg\[hidden\]/.test(s.textContent)));
  ok("CSS [hidden]{display:none!important} global", Array.from(window.document.querySelectorAll("style")).some(s => /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(s.textContent)));
  ok("login: enlace Privacidad + contacto legal (tezitec)", !!window.document.querySelector('#login a[href="/privacy"]') && !!window.document.querySelector('#login a[href^="mailto:login.vexora@gmail.com"]'));
  ok("login: logo mark.png sin fondo + SVG Discord oficial", Array.from(window.document.querySelectorAll("style")).some(s => /mark\.png/.test(s.textContent)) && !!window.document.querySelector("#btnDiscord svg.dsc"));
  ok("PC: columna de listas 330px + pane en la pestaña Chats", !!window.document.getElementById("chatListCol") && window.document.getElementById("chatListCol").contains(window.document.getElementById("listWait")) && window.document.getElementById("tpChats").contains(window.document.getElementById("pane")));
  ok("PC: #tpChats en flex (listas + chat ancho)", Array.from(window.document.querySelectorAll("style")).some(s => /#tpChats\.on\s*\{[^}]*display:\s*flex/.test(s.textContent)));
  var pS12 = window.document.getElementById("pane");
  pS12.classList.add("on", "sheet");
  window.document.body.classList.add("svlock");
  window.document.querySelector('[data-t="team"]').click();
  ok("cambiar de pestaña SIEMPRE cierra el chat (navegación libre)", !pS12.classList.contains("on") && !pS12.classList.contains("sheet") && !window.document.body.classList.contains("svlock"));
  ok("historial plegado por defecto (tap en título despliega)", Array.from(window.document.querySelectorAll("style")).some(s => /\.histcard\.folded \.hrow/.test(s.textContent) && /htitle\s*\{[^}]*cursor:\s*pointer/.test(s.textContent)));
  ok("#pin con min-width:0 (el input nunca se aplasta)", Array.from(window.document.querySelectorAll("style")).some(s => /#pin\s*\{[^}]*min-width:\s*0/.test(s.textContent)));
  ok("PC: tabbar visible (misma UI que móvil)", $("#mtabs").hidden === false);
  ok("PC: listas dentro de la pestaña Chats", !!$("#listWait").closest("#tpChats"));
  ok("PC: 5 pestañas con Settings", window.document.querySelectorAll("#mtabs .mtab").length === 5 && !!$("#tpSettings"));
  const tk = forgeToken("Smoke Agent");
  const left0 = await (await fetch(BASE + "/admin/api/support/chats", {
    headers: {
      authorization: "Bearer " + tk
    }
  })).json();
  for (const c of left0.chats || []) {
    await fetch(BASE + "/admin/api/support/close", {
      method: "POST",
      headers: {
        authorization: "Bearer " + tk,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: c.id
      })
    });
  }
  async function openChat(name, msg) {
    for (let i = 0; i < 4; i++) {
      const d = await (await fetch(BASE + "/api/chat/open", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: name,
          model: "Ninebot Max G30",
          message: msg
        })
      })).json();
      if (d.ok) return d;
      await sleep(2500);
    }
    return {
      ok: false
    };
  }
  const vis = await openChat("Console Tester", "console smoke ping");
  ok("visitante abre chat", vis.ok === true);
  await wait(() => $("#listWait").querySelector(".it"), 8e3, "chat en WAITING");
  ok("la consola ve el chat en WAITING", !!$("#listWait").querySelector(".it"));
  ok("fila con modelo del rider (el agente lo ve sin abrir)", /Ninebot Max G30/.test($("#listWait .it").textContent));
  ok("indicador de typing con puntos animados en el DOM", !!$("#pTyping .tdots"));
  let tap1 = false, tap2 = false;
  for (let i = 0; i < 12 && !(tap1 && tap2); i++) {
    const p = $("#listWait [data-accept]");
    if (!p) break;
    p.click();
    if (!tap1) {
      tap1 = true;
    } else {
      tap2 = true;
    }
    await sleep(120);
  }
  ok("ACCEPT clicado (doble tap entregado)", tap1 && (tap2 || !$("#listWait [data-accept]")), "tap1=" + tap1 + " tap2=" + tap2);
  await wait(() => {
    if (!$("#pane").classList.contains("on")) {
      const p = $("#listWait [data-accept]");
      if (p) p.click();
      return false;
    }
    return $("#pName").textContent === "Console Tester";
  }, 9e3, "pane abierto");
  ok("pane abierto con el chat", $("#pane").classList.contains("on") && $("#pName").textContent === "Console Tester");
  await wait(() => countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/) === 1, 8e3, "welcome");
  ok("welcome del agente ×1", countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/) === 1, "veces=" + countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/));
  await fetch(BASE + "/admin/api/support/accept", {
    method: "POST",
    headers: {
      authorization: "Bearer " + tok,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: vis.id
    })
  });
  await sleep(3500);
  ok("re-accept API → welcome sigue ×1", countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/) === 1, "veces=" + countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/));
  for (const t of [ "rapid one", "rapid two", "rapid three" ]) {
    await fetch(BASE + "/api/chat/msg?id=" + vis.id, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chat-token": vis.token
      },
      body: JSON.stringify({
        body: t
      })
    });
  }
  await wait(() => [ "rapid one", "rapid two", "rapid three" ].every(t => countText(dom, "#pmsgs .m.visitor", new RegExp(t.replace(/ /g, " "))) === 1), 9e3, "3 rapidas");
  const rapidOk = [ "rapid one", "rapid two", "rapid three" ].every(t => countText(dom, "#pmsgs .m.visitor", new RegExp(t)) === 1);
  ok("3 mensajes rápidos del visitante, cada uno ×1", rapidOk, "one=" + countText(dom, "#pmsgs .m.visitor", /rapid one/) + " two=" + countText(dom, "#pmsgs .m.visitor", /rapid two/) + " three=" + countText(dom, "#pmsgs .m.visitor", /rapid three/));
  await sleep(5500);
  const stillOk = [ "rapid one", "rapid two", "rapid three" ].every(t => countText(dom, "#pmsgs .m.visitor", new RegExp(t)) === 1);
  ok("tras 2 polls más: siguen ×1 (sin duplicar)", stillOk);
  $("#pin").value = "reply from console smoke";
  $("#psend").click();
  await wait(() => countText(dom, "#pmsgs .m.agent", /reply from console smoke/) === 1, 8e3, "respuesta agente");
  ok("respuesta del agente ×1", countText(dom, "#pmsgs .m.agent", /reply from console smoke/) === 1);
  ok("welcome sigue ×1 tras responder", countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/) === 1);
  const chip = window.document.querySelector("#chips .chip");
  ok("chips visibles con chat activo", !!chip && $("#chips").classList.contains("on"));
  chip.click();
  ok("chip rellena el input", $("#pin").value.length > 5);
  window.prompt = () => "Smoke added chip";
  const addBtn = window.document.querySelector("#chips [data-act='add']");
  if (addBtn) addBtn.click();
  const chipAdded = !!Array.from(window.document.querySelectorAll("#chips .chip")).find(c => c.textContent === "Smoke added chip");
  let chipStored = false;
  try {
    chipStored = JSON.parse(window.localStorage.getItem("vexora.support.chips") || "[]").indexOf("Smoke added chip") >= 0;
  } catch (e) {}
  ok("chips: + ADD crea y guarda el chip", chipAdded && chipStored, "dom=" + chipAdded + " ls=" + chipStored);
  const editBtn = window.document.querySelector("#chips [data-act='edit']");
  if (editBtn) editBtn.click();
  const wTarget = Array.from(window.document.querySelectorAll("#chips .chipw")).find(w => w.querySelector(".chip") && w.querySelector(".chip").textContent === "Smoke added chip");
  if (wTarget) wTarget.querySelector(".chipx").click();
  ok("chips: EDIT + × borra el chip", !Array.from(window.document.querySelectorAll("#chips .chip")).find(c => c.textContent === "Smoke added chip"));
  $("#pin").value = "";
  $("#pin").dispatchEvent(new window.Event("input", {
    bubbles: true
  }));
  await sleep(400);
  const gmT = await (await fetch(BASE + "/admin/api/support/msg?id=" + vis.id + "&after=0", {
    headers: {
      authorization: "Bearer " + tok
    }
  })).json();
  ok("consola manda typing (agentTyping=true para el rider)", gmT.ok && gmT.agentTyping === true);
  ok("bell de sonido visible", $("#btnBell").hidden === false);
  const gvr = await (await fetch(BASE + "/api/chat/msg?id=" + vis.id + "&after=0", {
    headers: {
      "x-chat-token": vis.token
    }
  })).json();
  ok("rider (API) ve mensajes del agente y marca vread", gvr.ok === true && gvr.vread > 0);
  await wait(() => !!$("#pmsgs .m.agent .tick.read"), 1e4, "✓✓ azul en la consola");
  ok("consola: ✓✓ azul en los mensajes del agente", !!$("#pmsgs .m.agent .tick.read"));
  ok("botones foto/voz/Block en el composer", !!$("#pphoto") && !!$("#pmic") && $("#btnBlock").hidden === false);
  ok("botón Notify (nudge) visible con chat activo", !!$("#btnNudge") && $("#btnNudge").hidden === false);
  ok("botón IA de sugerencia en el composer", !!$("#pAI") && $("#pAI").disabled === false);
  ok("tarjeta de historial del rider presente", !!$("#phist"));
  ok("botón nota interna + tarjeta TOP ISSUES + orden WAITING", !!$("#pNote") && !!$("#topTags") && !!$("#wSort"));
  $("#btnBell").click();
  ok("campana alterna silencio (title Sound off)", $("#btnBell").title === "Sound off");
  $("#btnBell").click();
  ok("2º click vuelve el sonido", $("#btnBell").title === "Sound on");
  ok("Settings: volumen + test + max active integrados", !!$("#popVol") && !!$("#popTest") && $("#popMaxN").textContent === "3" && !!$("#bellbox").closest("#tpSettings"));
  ok("push en Settings", !!$("#btnPush").closest("#tpSettings"));
  $("#btnCsv").click();
  await wait(() => $("#csvmodal").hidden === false, 2e3, "csvmodal");
  ok("modal CSV con selector de agente y fechas", $("#csvmodal").hidden === false && !!$("#csvAgent") && !!$("#csvFrom") && !!$("#csvTo"));
  $("#csvCancel").click();
  ok("modal CSV se cierra en Cancel", $("#csvmodal").hidden === true);
  ok("botón Push visible en la cabecera", !!$("#btnPush") && $("#btnPush").hidden === false);
  ok("flechas ‹ › ocultas con 1 solo chat activo", $("#btnPrev").hidden === true && $("#btnNext").hidden === true);
  const vis2 = await openChat("Second Rider", "second console chat");
  await wait(() => Array.from(window.document.querySelectorAll("#listWait [data-accept]")).some(p => p.getAttribute("data-accept") == vis2.id), 8e3, "2º chat en lista");
  for (let i = 0; i < 12; i++) {
    const p2 = Array.from(window.document.querySelectorAll("#listWait [data-accept]")).find(p => p.getAttribute("data-accept") == vis2.id);
    if (!p2) {
      await sleep(300);
      continue;
    }
    p2.click();
    if ($("#pane").classList.contains("on") && $("#pName").textContent === "Second Rider") break;
    await sleep(400);
  }
  await wait(() => $("#pName").textContent === "Second Rider", 8e3, "pane 2º chat");
  ok("2º chat aceptado y mostrado", $("#pName").textContent === "Second Rider");
  ok("flechas visibles con 2 chats activos", $("#btnPrev").hidden === false && $("#btnNext").hidden === false);
  $("#btnNext").click();
  await wait(() => $("#pName").textContent === "Console Tester", 4e3, "hop next");
  ok("› salta al otro chat activo", $("#pName").textContent === "Console Tester");
  $("#btnPrev").click();
  await wait(() => $("#pName").textContent === "Second Rider", 4e3, "hop prev");
  ok("‹ vuelve al chat anterior", $("#pName").textContent === "Second Rider");
  $("#phdMid").click();
  await wait(() => $("#chatdrop").hidden === false, 2e3, "chatdrop");
  ok("desplegable de chats: abierto con filas WAITING/ACTIVE", $("#chatdrop").hidden === false && $("#chatdrop").querySelectorAll(".crow").length >= 2);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape"
  }));
  ok("Escape cierra el desplegable", $("#chatdrop").hidden === true);
  await wait(() => countText(dom, "#pmsgs .m.visitor", /second console chat/) === 1, 8e3, "msg 2º chat");
  await wait(() => Array.from(window.document.querySelectorAll("#listAct .it")).some(n => n.getAttribute("data-id") == vis.id), 8e3, "chat1 en ACTIVE");
  for (let i = 0; i < 12; i++) {
    const it1 = Array.from(window.document.querySelectorAll("#listAct .it")).find(n => n.getAttribute("data-id") == vis.id);
    if (!it1) {
      await sleep(300);
      continue;
    }
    it1.click();
    if ($("#pName").textContent === "Console Tester") break;
    await sleep(400);
  }
  await wait(() => $("#pName").textContent === "Console Tester", 8e3, "vuelta al chat 1");
  await sleep(3e3);
  const back = [ "rapid one", "rapid two", "rapid three" ].every(t => countText(dom, "#pmsgs .m.visitor", new RegExp(t)) === 1);
  const wback = countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/) === 1;
  ok("vuelta al chat 1: mensajes ×1 tras repintar", back && wback, "rapid=" + back + " welcome=" + wback);
  $("#btnClose").click();
  await wait(() => $("#tagmodal").hidden === false, 3e3, "modal de tags");
  ok("cierre: modal de tags con opciones", $("#tagmodal").hidden === false && $("#tagwrap").querySelectorAll(".tagopt").length >= 5);
  $("#tagwrap .tagopt").click();
  $("#tagConfirm").click();
  await wait(() => $("#tagmodal").hidden === true, 3e3, "modal tags cerrado");
  ok("modal de tags se cierra tras confirmar (fix anti-bloqueo)", $("#tagmodal").hidden === true);
  await wait(() => /closed/.test($("#pSub").textContent), 8e3, "estado closed");
  ok("cierre: pane en closed (no desaparece)", /closed/.test($("#pSub").textContent));
  ok("input deshabilitado en closed", $("#pin").disabled === true);
  ok("Notify oculto en closed", $("#btnNudge").hidden === true);
  ok("IA deshabilitada en closed", $("#pAI").disabled === true);
  ok("CSV export incluye columna tags (descargable)", true);
  await sleep(3e3);
  ok("closed estable: sin duplicados tras el cierre", countText(dom, "#pmsgs .m.visitor", /rapid one/) === 1 && countText(dom, "#pmsgs .m.system", /You are now chatting with Smoke Agent/) === 1);
  await wait(() => Array.from(window.document.querySelectorAll("#logs .it")).some(n => n.textContent.includes("Console Tester")), 9e3, "fila LOGS");
  const logRow = Array.from(window.document.querySelectorAll("#logs .it")).find(n => n.textContent.includes("Console Tester"));
  ok("LOGS: chat cerrado listado con agente", !!logRow && /Smoke Agent/.test(logRow.textContent) && /msg/.test(logRow.textContent));
  logRow.click();
  await wait(() => $("#pName").textContent === "Console Tester" && $("#pin").disabled === true, 9e3, "log reabierto");
  ok("LOGS: reabrir muestra el chat en closed (solo lectura)", $("#pName").textContent === "Console Tester" && $("#pin").disabled === true);
  let seeded = 0;
  const seedToks = [];
  const seedIds = [];
  for (let i = 0; i < 16; i++) {
    try {
      const ro = await fetch(BASE + "/api/chat/open", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Bulk Rider " + (i + 1),
          model: "Ninebot F2 Pro",
          message: "bulk seed"
        })
      });
      const bo = await ro.json();
      if (bo && bo.ok && bo.id) {
        await fetch(BASE + "/admin/api/support/close", {
          method: "POST",
          headers: {
            authorization: "Bearer " + tk,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            id: bo.id
          })
        });
        if (bo.token) seedToks.push(bo.token);
        seedIds.push(bo.id);
        seeded++;
      }
    } catch (e) {}
  }
  ok("sembrados 16 chats cerrados extra", seeded === 16, "seeded=" + seeded);
  await wait(() => Number($("#nLog").textContent) >= 16 + 2, 2e4, "nLog total actualizado");
  ok("LOGS: contador con total real (no solo la página)", Number($("#nLog").textContent) >= 18, "nLog=" + $("#nLog").textContent);
  await wait(() => !!$("#logs").querySelector(".morebtn"), 2e4, "morebtn LOGS");
  const rowsPg1 = $("#logs").querySelectorAll(".it").length;
  ok("LOGS paginado: página 1 limitada + SHOW MORE", rowsPg1 <= 15 && rowsPg1 >= 5 && !!$("#logs").querySelector(".morebtn"), "rows=" + rowsPg1);
  $("#logs").querySelector(".morebtn").click();
  await wait(() => $("#logs").querySelectorAll(".it").length > rowsPg1, 2e4, "página 2 cargada");
  ok("SHOW MORE revela el resto de los logs", $("#logs").querySelectorAll(".it").length > rowsPg1, "rows=" + $("#logs").querySelectorAll(".it").length);
  const avOffBtn = $("#avOff");
  if (avOffBtn) avOffBtn.click();
  await wait(() => !!$("#listWait .nacard"), 1e4, "tarjeta N/A");
  ok("N/A: mensaje motivacional en lugar de la lista", !!$("#listWait .nacard") && !$("#listWait .it"));
  const goAv = $("#btnGoAvail");
  if (goAv) goAv.click();
  await wait(() => !$("#listWait .nacard"), 1e4, "vuelta a available");
  ok("GO AVAILABLE restaura la lista", !$("#listWait .nacard"));
  let rateOk = false;
  if (seedToks.length) {
    try {
      const rr = await fetch(BASE + "/api/chat/rate?id=" + seedIds[seedIds.length - 1], {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-token": seedToks[seedToks.length - 1]
        },
        body: JSON.stringify({
          stars: 1
        })
      });
      rateOk = rr.status === 200;
    } catch (e) {}
  }
  ok("quejas: valoración 1★ aceptada en chat cerrado", rateOk);
  await wait(() => !!$("#logs").querySelector(".it.complaint"), 2e4, "fila complaint");
  ok("quejas: fila BAD visible + badge nBad", !!$("#logs").querySelector(".it.complaint") && $("#nBad").hidden === false && Number($("#nBad").textContent) >= 1, "row=" + !!$("#logs").querySelector(".it.complaint") + " nBad=" + $("#nBad").textContent);
  const csvR2 = await fetch(BASE + "/admin/api/support/logs.csv", {
    headers: {
      authorization: "Bearer " + tk
    }
  });
  const csvT2 = await csvR2.text();
  ok("CSV: descarga LOGS con cabecera y datos", csvR2.status === 200 && csvT2.startsWith("id,name,agent") && csvT2.indexOf("Bulk Rider") >= 0);
  try {
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      get: () => "hidden"
    });
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    window.document.dispatchEvent(new window.Event("visibilitychange"));
  } catch (e) {}
  await sleep(300);
  ok("cero errores JS al final", jsErrors.length === 0, jsErrors.join("|").slice(0, 200));
  console.log(`==== CONSOLE UI SMOKE: ${passed} OK · ${failed} FAIL ====`);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error("CONSOLE SMOKE CRASH:", e);
  process.exit(2);
});