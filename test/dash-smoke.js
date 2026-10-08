const {JSDOM: JSDOM, VirtualConsole: VirtualConsole} = require("jsdom");

const BASE = "http://127.0.0.1:8788";

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

const jsErrors = [];

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
      if (w.SVGPathElement) {
        w.SVGPathElement.prototype.getTotalLength = function() {
          return 427;
        };
      }
    }
  });
  const {window: window} = dom;
  const $ = q => window.document.querySelector(q);
  await wait(() => $("#btnDemo"), 8e3, "btnDemo");
  $("#btnDemo").click();
  await wait(() => $("#live") && !$("#live").hasAttribute("hidden") && $("#live").style.display !== "none", 8e3, "live visible");
  ok("demo: #live visible", true);
  ok("trip-meta muestra 'Trip recording'", ($(".trip-meta b") || {}).textContent === "Trip recording", $(".trip-meta b") && $(".trip-meta b").textContent);
  ok("vTripPts pintado con número", /^\d+$/.test(($("#vTripPts") || {}).textContent || ""), $("#vTripPts") && $("#vTripPts").textContent);
  ok("botón Rec dice 'Start'", ($("#btnTripRec") || {}).textContent === "Start", $("#btnTripRec") && $("#btnTripRec").textContent);
  ok("dash-note 'inaccurate' visible", /inaccurate/i.test(($(".dash-note") || {}).textContent || ""), $(".dash-note") && $(".dash-note").textContent);
  const labels = [ ...window.document.querySelectorAll(".stats .stat .l") ].map(e => e.textContent.trim());
  ok("orden SHU: Current 1ª y Voltage 2ª", labels[0] === "Current" && labels[1] === "Voltage", labels.join("|"));
  ok("9 tarjetas en .stats", labels.length === 9, String(labels.length));
  $("#btnTripRec").click();
  let pts = "0";
  try {
    await wait(() => {
      pts = $("#vTripPts").textContent;
      return parseInt(pts, 10) > 0;
    }, 6e3, "datapoints > 0");
  } catch (e) {}
  ok("grabando: datapoints crecen (>0)", parseInt(pts, 10) > 0, pts);
  ok("grabando: botón dice 'Stop'", $("#btnTripRec").textContent === "Stop", $("#btnTripRec").textContent);
  ok("boot sin errores JS", jsErrors.length === 0, jsErrors.join("|").slice(0, 300));
  console.log("==== DASH SMOKE: " + pass + " OK · " + fail + " FAIL ====");
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("CRASH", e.message, "· JSERR:", jsErrors.join(" || ").slice(0, 400));
  process.exit(2);
});