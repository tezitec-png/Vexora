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
  const crypto = require("crypto");
  function adminTokenLocal(password, exp) {
    const key = crypto.createHash("sha256").update("vexora-admin-key:" + password).digest();
    const sig = crypto.createHmac("sha256", key).update("vexora-admin:" + exp).digest("hex");
    return exp + "." + sig;
  }
  const lj = {
    token: adminTokenLocal("vexora-test-admin", Date.now() + 864e5)
  };
  const raw = await (await fetch(BASE + "/admin")).text();
  const tags = [ ...raw.matchAll(/<script>([\s\S]*?)<\/script>/g) ].map(m => [ m[0], m[1] ]);
  let html = raw;
  for (const [tag, code] of tags) html = html.replace(tag, () => "<script>" + code.replace(/<\/script>/gi, "<\\/script>") + "<\/script>");
  const vc = new VirtualConsole;
  vc.on("jsdomError", e => {
    const m = String(e && e.message || e);
    if (!/Could not load|not implemented/i.test(m)) jsErrors.push(m);
  });
  vc.on("error", m => jsErrors.push(String(m)));
  const dom = new JSDOM(html, {
    url: BASE + "/admin",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
      try {
        w.localStorage.setItem("vexora.adminToken", lj.token);
      } catch (e) {}
    }
  });
  const {window: window} = dom;
  const $ = q => window.document.querySelector(q);
  await wait(() => $("#dash") && $("#dash").hidden === false, 8e3, "dash visible (token válido)");
  ok("token válido → dash directo (login oculto)", $("#loginCard").hidden === true);
  ok("page-head con título/sub", raw.indexOf("page-head") >= 0 && raw.indexOf("ph-sub") >= 0);
  await wait(() => $("#capBig").textContent !== "—", 8e3, "capacity pintada");
  ok("capacity card pintada (uniques/visits)", /^\d+$/.test($("#capBig").textContent), $("#capBig").textContent);
  ok("capBar con ancho %", /width:\s*\d+%/.test($("#capBar").style.cssText || ""), $("#capBar").style.cssText);
  ok("overview 24h/7d/all pintadas", $("#ov24v").textContent !== "—" && $("#ov7v").textContent !== "—" && $("#ovTv").textContent !== "—");
  ok("métricas día presentes (flashers/flashes)", $("#sFlashers").textContent !== "—" && $("#sFlash").textContent !== "—");
  ok("chart 7 días renderizado", ($("#chart").innerHTML || "").indexOf("col") >= 0);
  ok("feed como tabla con thead", ($("#feed").innerHTML || "").indexOf("<tr") >= 0 || $("#pgInfo").textContent.indexOf("0 events") >= 0);
  ok("paginación presente", $("#pgInfo").textContent.length > 0 && !!$("#pgPrev") && !!$("#pgNext"));
  ok("chips de filtro presentes", ($("#chips").innerHTML || "").indexOf("fchip") >= 0);
  ok("paginación coherente", $("#pgPrev").disabled === parseInt(($("#pgInfo").textContent.match(/page (\d+) \/ (\d+)/) || [ 0, 1, 1 ])[1] || "1", 10) <= 1);
  $("#ruleIp").value = "84.12.5.99";
  $("#ruleBanned").checked = true;
  $("#btnRuleSave").click();
  await wait(() => ($("#ruleList").innerHTML || "").indexOf("badge ban") >= 0, 8e3, "regla guardada");
  ok("regla ban → tabla con badge Banned", true);
  ok("sin errores JS", jsErrors.length === 0, jsErrors.join("|").slice(0, 300));
  console.log("==== ADMIN SMOKE: " + pass + " OK · " + fail + " FAIL ====");
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("CRASH", e.message, "· JSERR:", jsErrors.join(" || ").slice(0, 400));
  process.exit(2);
});