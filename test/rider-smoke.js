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
  const raw = await (await fetch(BASE + "/app")).text();
  const tags = [ ...raw.matchAll(/<script src="([^"]+)"[^>]*><\/script>/g) ].map(m => [ m[0], m[1] ]);
  let html = raw;
  for (const [tag, src] of tags) {
    if (/^https?:/.test(src)) continue;
    const code = await (await fetch(BASE + "/" + src.replace(/^\//, ""))).text();
    html = html.replace(tag, () => "<script>" + code.replace(/<\/script>/gi, "<\\/script>") + "<\/script>");
  }
  const vc = new VirtualConsole;
  let navTries = 0;
  vc.on("jsdomError", e => {
    const m = String(e && e.message || e);
    if (/not implemented: navigation/i.test(m)) navTries++; else if (!/Could not load|not implemented/i.test(m)) jsErrors.push(m);
  });
  vc.on("error", m => jsErrors.push(String(m)));
  const dom = new JSDOM(html, {
    url: BASE + "/app",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
      try {
        w.localStorage.setItem("vex.privacy.v1", "1");
        w.localStorage.setItem("vexora.legal2", "1");
        w.localStorage.setItem("vexora.disc", "1");
        w.localStorage.setItem("vexora.fbdone", "1");
        w.localStorage.setItem("vexora.access", JSON.stringify({
          exp: Date.now() + 864e5
        }));
        w.localStorage.setItem("vexora.lang", "en");
      } catch (e) {}
      const ctxStub = () => new Proxy({}, {
        get: (t, k) => k === "canvas" ? {
          width: 300,
          height: 150
        } : typeof k === "string" ? function() {} : undefined,
        set: () => true
      });
      w.HTMLCanvasElement.prototype.getContext = ctxStub;
      w.matchMedia = q => ({
        matches: false,
        media: q || "",
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        }
      });
      w.SVGElement.prototype.getTotalLength = function() {
        return 427;
      };
      w.SVGElement.prototype.getPointAtLength = function() {
        return {
          x: 0,
          y: 0
        };
      };
      w.SVGElement.prototype.getBBox = function() {
        return {
          x: 0,
          y: 0,
          width: 100,
          height: 100
        };
      };
    }
  });
  const {window: window} = dom;
  const $ = q => window.document.querySelector(q);
  await wait(() => $("#btnDemo"), 8e3, "boot app");
  const nav = $('[data-view="community"]');
  ok("tab Community presente en nav", !!nav);
  nav.click();
  await wait(() => $("#view-community") && $("#view-community").classList.contains("active"), 5e3, "view activa");
  ok("cuenta: PASO 1 crear por defecto (login oculto) — como una app normal", $("#ridFormReg1").hidden === false && $("#ridFormLogin").hidden === true && ($("#ridAltLink") || {}).textContent?.indexOf("Already") >= 0, ($("#ridAltLink") || {}).textContent);
  ok("community: subtítulos presentes (lead + feed/riders/chat)", ($("#view-community .lead") || {}).textContent?.length > 10 && !!$('[data-i18n="ridFeedSub"]') && !!$('[data-i18n="ridRidersSub"]') && !!$('[data-i18n="ridChatSub"]'));
  ok("community: 'Free — to post…' ELIMINADO (nadie lo lee)", raw.indexOf("ridAcctSub") < 0 && raw.indexOf("Free — to post") < 0);
  ok("community: 'Your account' solo con sesión (dentro de ridLogged)", raw.indexOf('data-i18n="ridAcctT"') > raw.indexOf('id="ridLogged"') && raw.indexOf('data-i18n="ridAcctT"') < raw.indexOf('id="ridForms"'));
  ok("community: feed blanco (rid-feed-cta) y auth azul ×7 (rid-auth-cta)", raw.indexOf("rid-feed-cta") >= 0 && raw.split("rid-auth-cta").length - 1 === 7 && raw.indexOf("rid-cta ") < 0);
  ok("community: subtítulo del paso 1", ($("#ridStepSub") || {}).textContent === "Step 1 of 3 — choose your rider name.", ($("#ridStepSub") || {}).textContent);
  const cssServed = await (await fetch(BASE + "/assets/app.css?v=1670")).text();
  ok("CSS guard + modal report presentes", cssServed.indexOf(".rid-forms[hidden]") >= 0 && cssServed.indexOf(".rid-modal") >= 0);
  ok("CSS: feed BLANCO + auth AZUL (elección owner) + foco por zona", cssServed.indexOf(".rid-feed-cta { background: #fff") >= 0 && cssServed.indexOf(".rid-auth-cta { background: #2f6bff") >= 0 && cssServed.indexOf("#ridFind:focus") >= 0);
  $("#ridAltLink").click();
  await sleep(80);
  ok("alt link → Sign in", $("#ridFormLogin").hidden === false && $("#ridFormReg1").hidden === true);
  ok("login: subtítulo de bienvenida", ($("#ridStepSub") || {}).textContent === "Welcome back.", ($("#ridStepSub") || {}).textContent);
  $("#ridAltLink").click();
  await sleep(80);
  ok("vuelta a crear", $("#ridFormReg1").hidden === false);
  ok("vuelta a crear: subtítulo paso 1 restaurado", ($("#ridStepSub") || {}).textContent === "Step 1 of 3 — choose your rider name.");
  $("#ridRegName").value = "rid_smoke_c";
  $("#btnRidNext1").click();
  await wait(() => $("#ridFormReg2").hidden === false, 5e3, "paso 2 contraseña");
  ok("paso 2: subtítulo con el paso", ($("#ridStepSub") || {}).textContent === "Step 2 of 3 — set a password.", ($("#ridStepSub") || {}).textContent);
  $("#ridRegPass").value = "smoke-pass-33";
  $("#ridRegPass2").value = "distinta-99";
  $("#btnRidNext2").click();
  await sleep(80);
  ok("confirmación distinta → aviso y NO avanza", $("#ridFormReg2").hidden === false && ($("#ridMsg") || {}).hidden === false);
  $("#ridRegPass2").value = "smoke-pass-33";
  $("#btnRidNext2").click();
  await wait(() => $("#ridFormReg3").hidden === false, 5e3, "paso 3 email opcional");
  ok("paso 3: email opcional visible", ($("#ridRegMail") || {}).hidden !== true);
  ok("paso 3: subtítulo con el paso", ($("#ridStepSub") || {}).textContent === "Step 3 of 3 — email (optional).", ($("#ridStepSub") || {}).textContent);
  $("#ridRegName").value = "rid_smoke_c";
  $("#ridRegMail").value = "rid_smoke_c@test.example";
  $("#ridRegPass").value = "smoke-pass-33";
  $("#btnRidReg").click();
  await wait(() => $("#ridFormVerify").hidden === false, 8e3, "form verify");
  ok("registro UI → form de verificación", $("#ridFormVerify").hidden === false);
  let code = "";
  for (let i = 0; i < 20 && !code; i++) {
    const c = await (await fetch(BASE + "/admin/api/riders/codes", {
      headers: {
        authorization: "Bearer " + ATOK
      }
    })).json();
    const hit = (c.rows || []).find(x => x.name === "rid_smoke_c" && x.kind === "verify");
    if (hit) code = hit.code; else await sleep(300);
  }
  ok("código stub disponible vía admin", !!code);
  $("#ridVerCode").value = code;
  $("#btnRidVerify").click();
  await wait(() => $("#ridLogged").hidden === false, 8e3, "sesión iniciada");
  ok("verify UI → logged (@rid_smoke_c) y auth oculta", ($("#ridWho") || {}).textContent === "@rid_smoke_c" && $("#ridForms").hidden === true, $("#ridWho") && $("#ridWho").textContent);
  ok("token guardado en localStorage", !!window.localStorage.getItem("vexora.riderTok"));
  await wait(() => navTries >= 1, 4e3, "redirect al feed disparado");
  ok("redirect: cuenta verificada → navegación a /community/ disparada", navTries >= 1);
  await wait(() => ($("#ridList").innerHTML || "").indexOf("rider-row") >= 0 || ($("#ridList").innerHTML || "").indexOf("hint") >= 0, 6e3, "directory");
  ok("directory cargado (algún rider o vacío-informativo)", true);
  $("#ridFind").value = "rid_e2e";
  $("#ridFind").dispatchEvent(new window.Event("input", {
    bubbles: true
  }));
  await wait(() => ($("#ridList").innerHTML || "").indexOf("data-peer=") >= 0, 6e3, "rider encontrado");
  const peerBtn = $('[data-peer="rid_e2e_b"]');
  ok("rider rid_e2e_b listado con botón chat", !!peerBtn);
  if (peerBtn) peerBtn.click();
  await wait(() => $("#dmCard") && $("#dmCard").hidden === false, 6e3, "chat abierto");
  $("#dmInput").value = "hola desde el smoke 95";
  $("#btnDmSend").click();
  await wait(() => ($("#dmMsgs").innerHTML || "").indexOf("hola desde el smoke 95") >= 0, 8e3, "mensaje pintado");
  ok("DM enviado y pintado como mío", ($("#dmMsgs").innerHTML || "").indexOf("dm mine") >= 0);
  $("#btnDmReport").click();
  await sleep(80);
  ok("report: modal con razones abierto", $("#ridWhyCard").hidden === false && $("#ridWhyCard input[name=ridWhy]:checked"), "");
  $("#ridWhyDetail").value = "smoke test report";
  $("#btnRidWhySend").click();
  await wait(() => $("#ridWhyDone").hidden === false, 6e3, "gracias por reportar");
  ok("report: pantalla de gracias", $("#ridWhyDone").hidden === false);
  $("#btnRidWhyClose").click();
  await sleep(60);
  ok("report: modal cerrado", $("#ridWhyCard").hidden === true);
  $("#btnDmPic") && ok("foto: botón y file input presentes", !!$("#btnDmPic") && !!$("#dmPicFile"));
  ok("sin errores JS", jsErrors.length === 0, jsErrors.join("|").slice(0, 300));
  console.log("==== RIDER SMOKE: " + pass + " OK · " + fail + " FAIL ====");
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("CRASH", e.message, "· JSERR:", jsErrors.join(" || ").slice(0, 400));
  process.exit(2);
});