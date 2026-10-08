const {JSDOM: JSDOM, VirtualConsole: VirtualConsole} = require("jsdom");

const BASE = "http://127.0.0.1:8788";

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
  const raw = await (await fetch(BASE + "/app")).text();
  const tags = [ ...raw.matchAll(/<script src="([^"]+)"[^>]*><\/script>/g) ].map(m => [ m[0], m[1] ]);
  let html = raw;
  for (const [tag, src] of tags) {
    if (/^https?:/.test(src)) continue;
    const code = await (await fetch(BASE + "/" + src.replace(/^\//, ""))).text();
    html = html.replace(tag, () => "<script>" + code.replace(/<\/script>/gi, "<\\/script>") + "<\/script>");
  }
  const vc = new VirtualConsole;
  vc.on("jsdomError", e => {
    const m = String(e && e.message || e);
    if (!/Could not load|not implemented/i.test(m)) jsErrors.push(m);
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
  const $$ = q => Array.from(window.document.querySelectorAll(q));
  await wait(() => $("#btnDemo"), 8e3, "boot app");
  const navGuide = $('[data-view="guide"]');
  ok("nav: botón Guide presente", !!navGuide);
  if (navGuide) navGuide.click();
  await wait(() => $("#view-guide") && $("#view-guide").classList.contains("active"), 5e3, "view-guide activa");
  const deepEl = $('[data-i18n="gDeepT"]');
  ok("guía profunda: card Parameters in depth con EN", !!deepEl && (deepEl.textContent || "").length > 3, deepEl && deepEl.textContent);
  const deepDivs = $$('#view-guide .glist div span[data-i18n^="gDeep"]').length;
  ok("guía profunda: 10 entradas de parámetros", deepDivs === 10, String(deepDivs));
  ok("wizard: 3 preguntas presentes", !!$("#wzFeel") && !!$("#wzRange") && !!$("#wzSpeed"));
  ok("report: input + botón presentes", !!$("#repFile") && !!$("#btnRepPick"));
  $("#wzFeel").value = "chill";
  $("#wzRange").value = "yes";
  $("#wzSpeed").value = "no";
  $("#btnWzGo").click();
  await sleep(150);
  const wzTxt = ($("#wzOut") || {}).textContent || "";
  ok("wizard: recomendación visible con engage 30", ($("#wzOut") || {}).hidden === false && wzTxt.indexOf("30") >= 0, wzTxt.slice(0, 80));
  $("#btnWzMotor").click();
  await sleep(150);
  let wz = null;
  try {
    wz = JSON.parse(window.localStorage.getItem("vexora.wz") || "null");
  } catch (e) {}
  ok("wizard: aplicar guarda vexora.wz (chill 30/35/1200)", !!wz && wz.engage === 30 && wz.cap === 35 && wz.scale === 1200, JSON.stringify(wz));
  $("#btnWzAi").click();
  await sleep(150);
  const inp = ($("#vcw-in") || {}).value || "";
  ok("wizard: botón IA prellena el chat", inp.indexOf("rider profile") >= 0 && inp.indexOf("engage 30") >= 0, inp.slice(0, 60));
  ok("boot sin errores JS", jsErrors.length === 0, jsErrors.join("|").slice(0, 300));
  console.log("==== GUIDE SMOKE: " + pass + " OK · " + fail + " FAIL ====");
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("CRASH", e.message, "· JSERR:", jsErrors.join(" || ").slice(0, 400));
  process.exit(2);
});