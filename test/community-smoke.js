const {JSDOM: JSDOM, VirtualConsole: VirtualConsole} = require("jsdom");

const BASE = "http://127.0.0.1:8788";

const crypto = require("crypto");

const jsErrors = [];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wait(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (fn()) return true;
    } catch (e) {}
    await sleep(120);
  }
  throw new Error("timeout esperando " + what);
}

function adminTokenLocal(password, exp) {
  const key = crypto.createHash("sha256").update("vexora-admin-key:" + password).digest();
  return exp + "." + crypto.createHmac("sha256", key).update("vexora-admin:" + exp).digest("hex");
}

const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) {
      pass++;
      console.log("PASS", name);
    } else {
      fail++;
      console.log("FAIL", name, extra || "");
    }
  };
  const ATOK = adminTokenLocal("vexora-test-admin", Date.now() + 864e5);
  const ORIG = {
    "content-type": "application/json",
    origin: BASE,
    "cf-connecting-ip": process.env.COMM_SMOKE_IP || "10.2.2.7"
  };
  const api = async (p, o) => {
    const r = await fetch(BASE + p, Object.assign({
      headers: ORIG
    }, o || {}));
    let b = {};
    try {
      b = await r.json();
    } catch (e) {}
    return {
      status: r.status,
      body: b
    };
  };
  const NAME = process.env.COMM_SMOKE_NAME || "comm_smoke_e";
  const reg = await api("/api/riders/register", {
    method: "POST",
    body: JSON.stringify({
      name: NAME,
      mail: NAME + "@test.example",
      pw: "CommSmoke123!"
    })
  });
  ok("registro rider (" + NAME + ")", reg.status === 200 && reg.body.ok === true, reg.status);
  const codes = await fetch(BASE + "/admin/api/riders/codes", {
    headers: {
      authorization: "Bearer " + ATOK
    }
  }).then(x => x.json());
  const hit = (codes.rows || []).find(x => x.name === NAME && x.kind === "verify");
  ok("código verify visible (stub admin)", !!hit);
  const ver = await api("/api/riders/verify", {
    method: "POST",
    body: JSON.stringify({
      name: NAME,
      code: hit.code
    })
  });
  ok("verify ok", ver.status === 200 && ver.body.ok === true, JSON.stringify(ver.body).slice(0, 80));
  const log = await api("/api/riders/login", {
    method: "POST",
    body: JSON.stringify({
      name: NAME,
      pw: "CommSmoke123!"
    })
  });
  const TOK = log.body && log.body.token;
  ok("login → token rider", log.status === 200 && !!TOK);
  async function makeRider(name) {
    const r = await api("/api/riders/register", {
      method: "POST",
      body: JSON.stringify({
        name: name,
        mail: name + "@test.example",
        pw: "CommSmoke123!"
      })
    });
    const cs = await fetch(BASE + "/admin/api/riders/codes", {
      headers: {
        authorization: "Bearer " + ATOK
      }
    }).then(x => x.json());
    const hit2 = (cs.rows || []).find(x => x.name === name && x.kind === "verify");
    if (!hit2) return null;
    await api("/api/riders/verify", {
      method: "POST",
      body: JSON.stringify({
        name: name,
        code: hit2.code
      })
    });
    const lg = await api("/api/riders/login", {
      method: "POST",
      body: JSON.stringify({
        name: name,
        pw: "CommSmoke123!"
      })
    });
    return lg.body && lg.body.token;
  }
  const NAMEB = NAME + "_b";
  const TOKB = await makeRider(NAMEB);
  ok("rider B registrado y verificado (" + NAMEB + ")", !!TOKB);
  const up = await api("/api/comm/post", {
    method: "POST",
    headers: Object.assign({}, ORIG, {
      "x-rider-token": TOK
    }),
    body: JSON.stringify({
      img: PNG1,
      cap: "smoke ride day"
    })
  });
  ok("post publicado (media en R2)", up.status === 200 && up.body.ok === true && !!up.body.key, up.status);
  const KEY = up.body.key;
  const raw = await (await fetch(BASE + "/community")).text();
  const vc = new VirtualConsole;
  vc.on("jsdomError", e => {
    const m = String(e && e.message || e);
    if (!/Could not load|not implemented/i.test(m)) jsErrors.push(m);
  });
  vc.on("error", m => jsErrors.push(String(m)));
  const dom = new JSDOM(raw, {
    url: BASE + "/community",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
      try {
        w.localStorage.setItem("vexora.riderTok", TOK);
        w.localStorage.setItem("vexora.riderMe", NAME);
        w.localStorage.setItem("vexora.lang", "en");
      } catch (e) {}
      w.IntersectionObserver = class {
        constructor() {}
        observe() {}
        disconnect() {}
        unobserve() {}
      };
      if (!w.CSS) w.CSS = {};
      if (!w.CSS.escape) w.CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_]/g, c => "\\" + c);
      w.confirm = () => true;
      const ctxStub = () => new Proxy({}, {
        get: (t, k) => k === "canvas" ? {
          width: 300,
          height: 150
        } : typeof k === "string" ? function() {} : undefined,
        set: () => true
      });
      w.HTMLCanvasElement.prototype.getContext = ctxStub;
      w.HTMLCanvasElement.prototype.toDataURL = () => PNG1;
    }
  });
  const {window: window} = dom;
  const $ = q => window.document.querySelector(q);
  try {
    const dModal = window.getComputedStyle($("#cPostModal")).display;
    const dNote = window.getComputedStyle($("#cSigninNote")).display;
    ok("overlay: modal y nota con hidden → computed display none", dModal === "none" && dNote === "none", "modal=" + dModal + " note=" + dNote);
    await wait(() => $(".c-slide"), 9e3, "slide en feed");
    ok("feed: slide del post renderizado (TikTok)", !!$('.c-slide[data-id="' + up.body.id + '"]'));
    ok("feed: columna derecha con like/cmt/share", !!$('.c-slide[data-id="' + up.body.id + '"] [data-like]') && !!$('.c-slide[data-id="' + up.body.id + '"] [data-open]') && !!$('.c-slide[data-id="' + up.body.id + '"] [data-share]'));
    ok("feed 9:16: bloque altura lista (slide no depende de la foto)", raw.indexOf("#cFeedList { height: 100%") >= 0);
    const repOwn = $('.c-slide[data-id="' + up.body.id + '"] [data-rep]');
    const openBtn = $('.c-slide[data-id="' + up.body.id + '"] [data-open]');
    ok("report: visible tb en foto propia y DEBAJO del botón de comentarios", !!repOwn && !!openBtn && !!(openBtn.compareDocumentPosition(repOwn) & window.Node.DOCUMENT_POSITION_FOLLOWING));
    ok("feed: tabs For you / Following", !!$("#cTabFor") && !!$("#cTabFol") && $("#cTabFor").classList.contains("is-on"));
    ok("feed: imagen sirve media R2", ($(".c-slide .c-media") || {}).src === BASE + "/api/comm/media/" + KEY, ($(".c-slide .c-media") || {}).src);
    ok("feed: caption pintado (overlay)", (($('.c-slide[data-id="' + up.body.id + '"] .c-capov') || {}).textContent || "").indexOf("smoke ride day") >= 0);
    ok("sesión: nota sign-in oculta + sin badge follow en post propio", ($("#cSigninNote") || {}).hidden === true && !$('.c-slide[data-id="' + up.body.id + '"] [data-follow]'));
    $('.c-slide[data-id="' + up.body.id + '"] [data-like]').click();
    await wait(() => (($('.c-slide[data-id="' + up.body.id + '"] [data-like] b') || {}).textContent || "") === "1", 5e3, "like = 1");
    ok("like: contador 1 y activo (is-on)", ($('.c-slide[data-id="' + up.body.id + '"] [data-like] b') || {}).textContent === "1" && $('.c-slide[data-id="' + up.body.id + '"] [data-like]').classList.contains("is-on"));
    $('.c-slide[data-id="' + up.body.id + '"] [data-like]').click();
    await wait(() => (($('.c-slide[data-id="' + up.body.id + '"] [data-like] b') || {}).textContent || "") === "0", 5e3, "like = 0");
    const mediaEl = $('.c-slide[data-id="' + up.body.id + '"] .c-media');
    mediaEl.click();
    mediaEl.click();
    await wait(() => $('.c-slide[data-id="' + up.body.id + '"] [data-like]').classList.contains("is-on"), 5e3, "double-tap like ON");
    ok("doble tap: deja like ON", $('.c-slide[data-id="' + up.body.id + '"] [data-like]').classList.contains("is-on"));
    await sleep(400);
    ok("doble tap: no abre el modal", $("#cPostModal").hidden === true);
    const lb = await api("/api/comm/like", {
      method: "POST",
      headers: Object.assign({}, ORIG, {
        "x-rider-token": TOKB
      }),
      body: JSON.stringify({
        id: up.body.id
      })
    });
    ok("B: like registrado", lb.status === 200 && lb.body.ok === true, lb.status);
    const cb = await api("/api/comm/comment", {
      method: "POST",
      headers: Object.assign({}, ORIG, {
        "x-rider-token": TOKB
      }),
      body: JSON.stringify({
        id: up.body.id,
        msg: "from rider b"
      })
    });
    ok("B: comentario registrado", cb.status === 200 && cb.body.ok === true, cb.status);
    const upB = await api("/api/comm/post", {
      method: "POST",
      headers: Object.assign({}, ORIG, {
        "x-rider-token": TOKB
      }),
      body: JSON.stringify({
        img: PNG1,
        cap: "post de B"
      })
    });
    ok("B: post propio publicado", upB.status === 200 && upB.body.ok === true, upB.status);
    $("#cNavFeed").click();
    await sleep(300);
    $("#cNavFeed").click();
    await wait(() => $("#cNBadge").hidden === false && $("#cNBadge").textContent === "2", 6e3, "badge actividad = 2");
    ok("campana: badge 2 (like + comentario)", $("#cNBadge").hidden === false && $("#cNBadge").textContent === "2");
    $("#cBell").click();
    await wait(() => !$("#cNotifModal").hidden && $("#cNotifBox .c-nitem"), 6e3, "modal actividad");
    const nItems = $("#cNotifBox").querySelectorAll(".c-nitem");
    ok("actividad: 2 items (like + comentario de B)", nItems.length === 2 && ($("#cNotifBox").textContent || "").indexOf(NAMEB) >= 0, nItems.length);
    $("#cNotifModal").click();
    await wait(() => $("#cNBadge").hidden === true, 5e3, "badge seen");
    ok("actividad: badge a cero tras verla", $("#cNBadge").hidden === true);
    $("#cNavMe").click();
    await wait(() => $(".c-top").hidden === true, 4e3, "cabecera oculta en perfil");
    ok("perfil: cabecera del feed oculta (sin colisión arriba)", $(".c-top").hidden === true && $("#cMeView").hidden === false);
    $("#cNavFeed").click();
    await wait(() => $(".c-top").hidden === false, 4e3, "cabecera visible en feed");
    ok("feed: cabecera vuelve al volver al feed", $(".c-top").hidden === false);
    ok("layout: autor/acciones/caption por encima de la barra negra", raw.indexOf("calc(66px + env(safe-area-inset-bottom))") >= 0 && raw.indexOf("calc(112px + env(safe-area-inset-bottom))") >= 0);
    await wait(() => $('.c-slide[data-id="' + up.body.id + '"]'), 6e3, "feed re-renderizado tras volver del perfil");
    $('.c-slide[data-id="' + up.body.id + '"] [data-open]').click();
    await wait(() => $("#cCmtIn"), 6e3, "modal con input de comentario");
    ok("modal comentarios: sin imagen repetida + input", !$("#cPostBox .c-media") && !!$("#cCmtIn") && !!$("#cCmtGo"));
    ok("modal comentarios: hint de mantener pulsado", ($("#cPostBox").textContent || "").indexOf("Hold your comment") >= 0);
    await wait(() => $(".c-cmt [data-creply]"), 6e3, "comentarios con botón responder");
    $(".c-cmt [data-creply]").click();
    await wait(() => !$("#cReplyBar").hidden, 4e3, "replybar visible");
    $("#cCmtIn").value = "reply from a";
    $("#cCmtGo").click();
    await wait(() => ($("#cCmtList").textContent || "").indexOf("reply from a") >= 0 && !!$(".c-cmt.is-reply"), 6e3, "respuesta listada");
    ok("respuestas: respuesta listada con sangría", !!$(".c-cmt.is-reply") && $("#cReplyBar").hidden === true);
    const re = $(".c-cmt.is-reply .c-re");
    ok("respuestas: símbolo ↳ con @de quien responde", !!re && (re.textContent || "").indexOf("↳ @") >= 0, re && re.textContent);
    ok("comentarios: avatar de quien comenta (claro quién habla)", !!$(".c-cmt .c-cav"));
    ok("comentarios: hoja TikTok con cabecera y cerrar", ($("#cCmtHead") || {}).textContent.indexOf("Comments") === 0 && !!$("#cCmtClose"));
    const clb = $(".c-cmt [data-clike]");
    clb.click();
    await wait(() => clb.classList.contains("is-on") && clb.querySelector("b").textContent === "1", 5e3, "clike = 1");
    ok("like de comentario: contador 1 y activo", clb.classList.contains("is-on") && clb.querySelector("b").textContent === "1");
    await wait(() => ($('#cFeedList .c-slide[data-id="' + up.body.id + '"] [data-views] b') || {}).textContent === "1", 6e3, "views = 1 en feed");
    ok("views: apertura del modal contada en el feed", ($('#cFeedList .c-slide[data-id="' + up.body.id + '"] [data-views] b') || {}).textContent === "1");
    $("#cCmtIn").value = "smoke comment";
    $("#cCmtGo").click();
    await wait(() => (($("#cCmtList") || {}).textContent || "").indexOf("smoke comment") >= 0, 6e3, "comentario en lista");
    ok("comentario enviado y listado", (($("#cCmtList") || {}).textContent || "").indexOf("smoke comment") >= 0);
    const myCmt = $("#cPostBox .c-cmt.is-reply[data-cmine]");
    ok("mi respuesta marcada como mía (is-mine)", !!myCmt);
    const beforeDel = Number($('#cFeedList .c-slide[data-id="' + up.body.id + '"] [data-open] b').textContent);
    myCmt.dispatchEvent(new window.Event("contextmenu", {
      bubbles: true,
      cancelable: true
    }));
    await wait(() => Number($('#cFeedList .c-slide[data-id="' + up.body.id + '"] [data-open] b').textContent) === beforeDel - 1, 6e3, "contador -1 tras borrar");
    ok("long-press: comentario borrado y contador baja", Number($('#cFeedList .c-slide[data-id="' + up.body.id + '"] [data-open] b').textContent) === beforeDel - 1);
    $("#cNavMe").click();
    await wait(() => ($("#cMeView").textContent || "").indexOf("@" + NAME) >= 0 && !!$("#cMeView .c-grid button"), 6e3, "perfil render con grid");
    ok("perfil: @nombre + grid con el post", ($("#cMeView").textContent || "").indexOf("@" + NAME) >= 0 && !!$("#cMeView .c-grid button"));
    $("#cEditGo").click();
    await wait(() => $("#cEditBox") && !$("#cEditBox").hidden, 3e3, "form edición");
    ok("edición: bio/color/avatar presentes", !!$("#cBioIn") && !!$("#cColIn") && !!$("#cAvPick"));
    $("#cBioIn").value = "Rider de la smoke";
    $("#cColIn").value = "#31c48d";
    $("#cProfSave").click();
    await wait(() => (($("#cMeView") || {}).textContent || "").indexOf("Rider de la smoke") >= 0, 6e3, "bio guardada y re-render");
    ok("perfil: bio + color guardados (re-render)", ($("#cMeView").textContent || "").indexOf("Rider de la smoke") >= 0);
    $("#cNavNew").click();
    ok("publicar: vista con selector y caption", !$("#cNewView").hidden && !!$("#btnCPick") && !!$("#cCap"));
    $("#cNavFeed").click();
    await wait(() => $('.c-slide[data-id="' + up.body.id + '"]'), 5e3, "slide de nuevo");
    $('.c-slide[data-id="' + up.body.id + '"] [data-del]').click();
    await wait(() => !$('#cFeedList .c-slide[data-id="' + up.body.id + '"]'), 6e3, "slide fuera del feed");
    ok("borrar: slide fuera (papelera de la columna) + media 404", !$('#cFeedList .c-slide[data-id="' + up.body.id + '"]'));
    const m = await fetch(BASE + "/api/comm/media/" + KEY);
    ok("borrar: media eliminada de R2 (404)", m.status === 404, m.status);
    $("#cNavFeed").click();
    await wait(() => $('.c-slide[data-id="' + upB.body.id + '"]'), 6e3, "slide de B");
    ok("report: flag visible en post ajeno (y NO en el propio)", !!$('.c-slide[data-id="' + upB.body.id + '"] [data-rep]') && !$('.c-slide[data-id="' + up.body.id + '"] [data-rep]'));
    $('.c-slide[data-id="' + upB.body.id + '"] [data-rep]').click();
    await wait(() => !$("#cRepModal").hidden && !!$("#cRepGo"), 5e3, "modal report");
    ok("report: razones estilo Discord", ($("#cRepBox").textContent || "").indexOf("Harassment") >= 0 && $("#cRepBox").querySelectorAll("input[name=cWhy]").length === 5);
    $("#cRepDetail").value = "smoke report";
    $("#cRepGo").click();
    await wait(() => ($("#cRepBox").textContent || "").indexOf("Thanks for reporting") >= 0, 6e3, "gracias por reportar");
    ok("report: pantalla de gracias", ($("#cRepBox").textContent || "").indexOf("Thanks for reporting") >= 0);
    await sleep(2100);
    $("#cNavFeed").click();
    await wait(() => $('.c-slide[data-id="' + upB.body.id + '"]'), 6e3, "feed listo para top");
    $("#cTabTop").click();
    await wait(() => $("#cTabTop").classList.contains("is-on"), 4e3, "tab top activa");
    await wait(() => $('.c-slide[data-id="' + upB.body.id + '"]'), 6e3, "post de B en Top");
    ok("tab Top: post presente (orden por likes)", $("#cTabTop").classList.contains("is-on") && !!$('.c-slide[data-id="' + upB.body.id + '"]'));
    const pill = $('.c-slide[data-id="' + upB.body.id + '"] [data-follow]');
    ok("seguir: pill visible con estado en post ajeno", !!pill && pill.textContent === "Follow" && !pill.classList.contains("is-on"));
    pill.click();
    await wait(() => pill.classList.contains("is-on") && pill.textContent === "Following", 5e3, "pill Following");
    ok("seguir: tap → Following (el estado ya no se pierde)", pill.classList.contains("is-on") && pill.textContent === "Following");
    pill.click();
    await wait(() => !pill.classList.contains("is-on") && pill.textContent === "Follow", 5e3, "pill de vuelta");
    ok("seguir: unfollow vuelve a Follow", !pill.classList.contains("is-on") && pill.textContent === "Follow");
    $("#cNavFeed").click();
    await wait(() => $(".c-slide, #cFeedEmpty"), 5e3, "feed listo");
    $("#cTabFol").click();
    await sleep(700);
    ok("tab Following: cambia activa y no rompe", $("#cTabFol").classList.contains("is-on"));
    $("#cTabFor").click();
    await sleep(500);
    ok("tab For you: vuelve activa", $("#cTabFor").classList.contains("is-on"));
    ok("sin errores JS", jsErrors.length === 0, jsErrors.join("|").slice(0, 300));
  } catch (e) {
    ok("flujo completo community", false, e.message + " · JSERR: " + jsErrors.join("||").slice(0, 200));
  }
  console.log("==== COMMUNITY SMOKE: " + pass + " OK · " + fail + " FAIL ====");
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("CRASH", e.message, "· JSERR:", jsErrors.join(" || ").slice(0, 400));
  process.exit(2);
});