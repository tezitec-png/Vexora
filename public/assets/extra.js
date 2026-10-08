(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [ ...r.querySelectorAll(s) ];
  const t = (k, v) => window.I18N && I18N.t ? I18N.t(k, v) : k;
  const haptic = ms => {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 12);
    } catch (e) {}
  };
  const X = {
    VCU: 22,
    MCU: 2
  };
  const EUR_KWH = .28;
  const FOC_RAIN = {
    d0: 1400,
    d1: 2200,
    d2: 4096,
    d3: 1100,
    d4: 500,
    d5: 180,
    d6: 210,
    d7: 200,
    d8: 1
  };
  const FOC_RACE = {
    d0: 1800,
    d1: 2800,
    d2: 5600,
    d3: 1600,
    d4: 560,
    d5: 210,
    d6: 250,
    d7: 240,
    d8: 1
  };
  const FAULT = {
    0: "none",
    9: "throttle",
    10: "brake",
    12: "motor hall",
    14: "MOSFET",
    15: "battery",
    16: "overtemp",
    18: "overcurrent",
    21: "BMS comm",
    24: "IMU",
    27: "controller",
    39: "speed sensor"
  };
  let energyWh = 0, energyT = 0, motorMs = 0, motorLast = 0;
  let accel = {
    armed: false,
    t0: 0,
    t25: null,
    t50: null
  };
  let samples = [];
  let foldC = 105;
  try {
    foldC = Number(localStorage.getItem("vexora.foldback") || 105) || 105;
  } catch (e) {}
  let deferredInstall = null;
  function snKey(prefix) {
    const sn = window.Vexora && Vexora.lastSn || "anon";
    return prefix + String(sn).replace(/[^\w.-]/g, "");
  }
  function loadJson(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k) || "null") || d;
    } catch (e) {
      return d;
    }
  }
  function saveJson(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  }
  function dash(id, v) {
    const el = $(id);
    if (el) el.textContent = v;
  }
  function pinHash(p) {
    let h = 2166136261;
    p = String(p || "");
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
  function hasPin() {
    return !!localStorage.getItem("vexora.pin");
  }
  function askPin() {
    if (!hasPin()) return true;
    const g = prompt(t("pinAsk"), "");
    if (g == null) return false;
    if (pinHash(g) !== localStorage.getItem("vexora.pin")) {
      alert(t("pinWrong"));
      return false;
    }
    return true;
  }
  window.Vexora = window.Vexora || {};
  window.Vexora.askPin = askPin;
  function tickEnergy(watts, kmh, dt) {
    if (!Number.isFinite(watts) || watts < 0) return;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 3) return;
    energyWh += watts * dt / 3600;
    energyT += dt;
    if (Number.isFinite(kmh) && kmh > .8) {
      if (motorLast) motorMs += Math.min(2e3, Date.now() - motorLast);
      motorLast = Date.now();
    } else motorLast = 0;
    const dist = window.Vexora && Number(Vexora.tripKm) || 0;
    const whkm = dist > .05 ? energyWh / dist : 0;
    dash("#vWh", energyWh ? energyWh.toFixed(1) : "—");
    dash("#vWhKm", whkm ? whkm.toFixed(1) : "—");
    dash("#vCost", whkm ? (whkm * EUR_KWH / 1e3 * 100).toFixed(2) : "—");
    dash("#vHours", motorMs ? (motorMs / 36e5).toFixed(2) : "—");
  }
  function tickAccel(kmh) {
    if (!Number.isFinite(kmh)) return;
    if (kmh < 1.2) {
      accel = {
        armed: true,
        t0: 0,
        t25: accel.t25,
        t50: accel.t50
      };
      return;
    }
    if (!accel.armed) return;
    if (!accel.t0) accel.t0 = Date.now();
    const s = (Date.now() - accel.t0) / 1e3;
    if (kmh >= 25 && accel.t25 == null) accel.t25 = s;
    if (kmh >= 50 && accel.t50 == null) accel.t50 = s;
    if (accel.t25 != null) dash("#vT25", accel.t25.toFixed(2) + " s");
    if (accel.t50 != null) dash("#vT50", accel.t50.toFixed(2) + " s");
  }
  function pushSample(kmh, w, a, tv, tm) {
    const now = Date.now();
    const last = samples[samples.length - 1];
    if (last && now - last.t < 220) return;
    samples.push({
      t: now,
      s: kmh || 0,
      w: w || 0,
      a: a || 0,
      tv: tv || 0,
      tm: tm || 0
    });
    if (samples.length > 120) samples.shift();
    drawMotor();
  }
  function drawMotor() {
    const c = $("#mChart");
    if (!c || !c.getContext) return;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    if (samples.length < 2) return;
    const maxW = Math.max(1, ...samples.map(p => p.w || 0));
    const maxS = Math.max(1, ...samples.map(p => p.s || 0));
    function line(key, max, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      samples.forEach((p, i) => {
        const x = i / (samples.length - 1) * w;
        const y = h - 3 - (p[key] || 0) / max * (h - 6);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    line("w", maxW, "#5a5a62");
    line("s", maxS, "#3ecf8e");
  }
  function paintAlerts() {
    const box = $("#alertList");
    if (!box) return;
    const items = [];
    const soc = window.Vexora && Vexora.lastSoc;
    const tv = window.Vexora && Vexora.lastVcuTemp;
    const tm = window.Vexora && Vexora.lastMotorTemp;
    const dlt = window.Vexora && Vexora.lastCellDelta;
    if (Number.isFinite(soc) && soc <= 20) items.push(t("lowSoc"));
    if (Number.isFinite(tv) && tv >= 90) items.push(t("hotVcu"));
    if (Number.isFinite(tm) && tm >= 90) items.push(t("hotMotor"));
    if (Number.isFinite(dlt) && dlt >= 80) items.push(t("imbalance"));
    box.textContent = items.length ? items.join(" · ") : t("ok");
    box.className = "note" + (items.length ? " err" : " ok");
  }
  function paintHistory() {
    const box = $("#tripHist");
    if (!box) return;
    const rows = loadJson(snKey("vexora.trips."), []);
    if (!rows.length) {
      box.textContent = "—";
      return;
    }
    box.innerHTML = rows.slice(-8).reverse().map(r => {
      const d = new Date(r.t).toLocaleString();
      return "<div><span>" + d + "</span><b>" + (r.km || 0).toFixed(2) + " km · " + Math.round(r.maxW || 0) + " W</b></div>";
    }).join("");
  }
  function archiveTrip(trip) {
    if (!trip || !(trip.dist > .02)) return;
    const k = snKey("vexora.trips.");
    const rows = loadJson(k, []);
    rows.push({
      t: Date.now(),
      km: trip.dist,
      maxKmh: trip.maxKmh,
      maxW: trip.maxW,
      ms: trip.elapsed
    });
    saveJson(k, rows.slice(-40));
    paintHistory();
  }
  function paintFlashLog() {
    const box = $("#flashHist");
    if (!box) return;
    const rows = loadJson(snKey("vexora.flashlog."), []);
    if (!rows.length) {
      box.textContent = "—";
      return;
    }
    box.innerHTML = rows.slice(-10).reverse().map(r => "<div><span>" + new Date(r.t).toLocaleString() + "</span><b>" + String(r.part || "").toUpperCase() + " · " + (r.sum || "") + "</b></div>").join("");
  }
  function logFlash(part, sum) {
    const k = snKey("vexora.flashlog.");
    const rows = loadJson(k, []);
    rows.push({
      t: Date.now(),
      part: part,
      sum: sum,
      sn: window.Vexora && Vexora.lastSn || ""
    });
    saveJson(k, rows.slice(-40));
    paintFlashLog();
  }
  function paintPresets() {
    const sel = $("#presetList");
    if (!sel) return;
    const all = loadJson(snKey("vexora.presets."), {});
    const cur = sel.value;
    sel.innerHTML = Object.keys(all).map(n => "<option>" + n.replace(/[<>]/g, "") + "</option>").join("");
    if (cur && all[cur]) sel.value = cur;
  }
  function readTuneSnap() {
    return {
      eco: Number($("#limEco") && $("#limEco").value),
      drive: Number($("#limDrive") && $("#limDrive").value),
      sport: Number($("#limRange") && $("#limRange").value),
      start: Number($("#liveStart") && $("#liveStart").value),
      vol: Number($("#liveVol") && $("#liveVol").value),
      flags: Object.fromEntries($$("[data-flag]").map(el => [ el.getAttribute("data-flag"), !!el.checked ]))
    };
  }
  async function applyTuneSnap(s) {
    if (!s) return;
    if ($("#limEco")) $("#limEco").value = s.eco;
    if ($("#limDrive")) $("#limDrive").value = s.drive;
    if ($("#limRange")) $("#limRange").value = s.sport;
    const btn = $("#btnApplyLim");
    if (btn) btn.click();
  }
  function setHud(on) {
    document.body.classList.toggle("is-hud", !!on);
    if (typeof showView === "function" && on) showView("dash");
  }
  function setKiosk(on) {
    document.body.classList.toggle("is-kiosk", !!on);
    try {
      localStorage.setItem("vexora.kiosk", on ? "1" : "0");
    } catch (e) {}
    if (on && typeof showView === "function") showView("dash");
  }
  async function safe25() {
    const sess = window.Vexora && Vexora.getSession && Vexora.getSession();
    if (!sess || !sess.writeRegister) return;
    haptic(12);
    try {
      await sess.writeRegister(X.VCU, 71, Uint8Array.of(13, 20));
      await sess.writeRegister(X.VCU, 72, Uint8Array.of(25, 0));
    } catch (err) {
      try {
        console.log("safe25: " + (err && err.message));
      } catch (e2) {}
    }
    if (window.VexoraLive && VexoraLive.setFlag) {
      try {
        await VexoraLive.setFlag("unlockSports", false);
      } catch (e) {}
    }
  }
  async function toggleLight() {
    if (!window.VexoraLive || !VexoraLive.setFlag) return;
    const el = $('[data-flag="autoHeadlight"]');
    const on = !(el && el.checked);
    await VexoraLive.setFlag("autoHeadlight", on);
  }
  async function cycleMode() {
    const sess = window.Vexora && Vexora.getSession && Vexora.getSession();
    if (!sess || !sess.writeRegister) return;
    let cur = 2;
    try {
      const b = await sess.readRegister(X.VCU, 90, 1);
      cur = b[0];
    } catch (e) {}
    const order = [ 2, 5, 3, 1 ];
    const i = order.indexOf(cur);
    const next = order[(i + 1) % order.length];
    await sess.writeRegister(X.VCU, 90, Uint8Array.of(next));
  }
  function decodeFaults(w) {
    if (!w) return t("none");
    const out = [];
    for (let i = 0; i < 16; i++) if (w & 1 << i) out.push(FAULT[i] || "e" + i);
    return out.length ? out.join(" · ") : t("none");
  }
  let toastTimer = 0;
  function toast(msg) {
    let el = $(".vtoast");
    if (!el) {
      el = document.createElement("div");
      el.className = "vtoast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), 2800);
  }
  function b64uEnc(str) {
    const b = (new TextEncoder).encode(str);
    let s = "";
    for (const c of b) s += String.fromCharCode(c);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64uDec(str) {
    let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return (new TextDecoder).decode(b);
  }
  function saneTune(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    const out = {
      flags: {}
    };
    let good = 0;
    [ "eco", "drive", "sport", "start", "vol" ].forEach(k => {
      const n = Number(s[k]);
      if (Number.isFinite(n)) {
        out[k] = Math.min(100, Math.max(0, Math.round(n)));
        good++;
      }
    });
    if (s.flags && typeof s.flags === "object" && !Array.isArray(s.flags)) {
      Object.keys(s.flags).slice(0, 40).forEach(k => {
        if (typeof s.flags[k] === "boolean") out.flags[k] = s.flags[k];
      });
    }
    return good ? out : null;
  }
  function fallbackCopy(txt, done) {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    ta.remove();
    done();
  }
  function sharePreset() {
    const snap = saneTune(readTuneSnap());
    if (!snap) return;
    const url = location.origin + location.pathname + "#p=" + b64uEnc(JSON.stringify({
      v: 1,
      tune: snap
    }));
    const done = () => toast(t("shareCopied"));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
    } else fallbackCopy(url, done);
  }
  function loadSharedPreset() {
    const src = String(window.__vexoraShared || "") + " " + String(location.hash || "");
    const m = /(?:^|[#&])p=([A-Za-z0-9_-]+)/.exec(src);
    if (!m) return;
    let snap = null;
    try {
      const j = JSON.parse(b64uDec(m[1]));
      if (j && j.v === 1) snap = saneTune(j.tune);
    } catch (e) {
      snap = null;
    }
    if (!snap) {
      toast(t("sharedBad"));
      return;
    }
    const ids = {
      eco: "#limEco",
      drive: "#limDrive",
      sport: "#limRange",
      start: "#liveStart",
      vol: "#liveVol"
    };
    Object.keys(ids).forEach(k => {
      const el = $(ids[k]);
      if (el && snap[k] != null) {
        el.value = String(snap[k]);
        el.dispatchEvent(new Event("input", {
          bubbles: true
        }));
      }
    });
    Object.keys(snap.flags || {}).forEach(k => {
      const el = document.querySelector('[data-flag="' + k.replace(/[^\w-]/g, "") + '"]');
      if (el) el.checked = !!snap.flags[k];
    });
    if (typeof showView === "function") showView("live");
    toast(t("sharedLoaded"));
  }
  let rateBusy = false;
  function askRate(part, sum) {
    const ov = $("#rateOverlay");
    if (!ov || rateBusy) return;
    rateBusy = true;
    const pt = $("#ratePart");
    if (pt) pt.textContent = String(sum || part || "").replace(/[<>]/g, "").slice(0, 80);
    ov.hidden = false;
    const close = () => {
      ov.hidden = true;
      rateBusy = false;
    };
    const vote = ok => {
      try {
        fetch("/api/flash-feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            part: part === "vcu" ? "vcu" : "mcu",
            ok: !!ok
          })
        }).catch(() => {});
      } catch (e) {}
      toast(t("rateThanks"));
      close();
    };
    const g = $("#rateGood"), b = $("#rateBad");
    if (g) g.onclick = () => vote(true);
    if (b) b.onclick = () => vote(false);
    ov.onclick = e => {
      if (e.target === ov) close();
    };
    setTimeout(() => {
      if (!ov.hidden) close();
    }, 2e4);
  }
  window.VexoraX = {
    onTick(st) {
      if (!st) return;
      tickEnergy(st.watts, st.kmh, st.dt || .2);
      tickAccel(st.kmh);
      pushSample(st.kmh, st.watts, st.amps, st.vcuTemp, st.motorTemp);
      paintAlerts();
      if (Number.isFinite(st.vcuTemp) && st.vcuTemp >= foldC && window.VexoraLive && VexoraLive.restoreStock) {
        VexoraLive.restoreStock().catch(() => {});
      }
    },
    onTripStop(trip) {
      archiveTrip(trip);
    },
    onFlash(part, sum) {
      logFlash(part, sum);
      askRate(part, sum);
    },
    askPin: askPin,
    paintAll() {
      paintHistory();
      paintFlashLog();
      paintPresets();
      paintAlerts();
    }
  };
  function bind() {
    $$("[data-lang]").forEach(b => b.addEventListener("click", () => {
      if (window.I18N) I18N.setLang(b.getAttribute("data-lang"));
    }));
    if (window.I18N) I18N.apply();
    document.addEventListener("click", e => {
      const h = e.target.closest(".card.fold > h3");
      if (!h) return;
      const card = h.parentElement;
      if (!card) return;
      card.classList.toggle("is-open");
    });
    const hud = $("#btnHud");
    if (hud) hud.addEventListener("click", () => setHud(!document.body.classList.contains("is-hud")));
    const s25 = $("#btnSafe25");
    if (s25) s25.addEventListener("click", () => {
      if (window.Vexora && Vexora.withBle) Vexora.withBle(safe25); else safe25();
    });
    const lg = $("#btnLinkLight");
    if (lg) lg.addEventListener("click", () => {
      if (window.Vexora && Vexora.withBle) Vexora.withBle(toggleLight);
    });
    const md = $("#btnLinkMode");
    if (md) md.addEventListener("click", () => {
      if (window.Vexora && Vexora.withBle) Vexora.withBle(cycleMode);
    });
    const kiosk = $("#btnKiosk");
    if (kiosk) kiosk.addEventListener("click", () => setKiosk(!document.body.classList.contains("is-kiosk")));
    try {
      if (localStorage.getItem("vexora.kiosk") === "1") setKiosk(true);
    } catch (e) {}
    const hide = $("#btnHideSn");
    if (hide) {
      hide.addEventListener("click", () => {
        const on = !document.body.classList.contains("hide-sn");
        document.body.classList.toggle("hide-sn", on);
        try {
          localStorage.setItem("vexora.hideSn", on ? "1" : "0");
        } catch (e) {}
      });
      try {
        if (localStorage.getItem("vexora.hideSn") === "1") document.body.classList.add("hide-sn");
      } catch (e) {}
    }
    const inst = $("#btnInstall");
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredInstall = e;
      if (inst) inst.hidden = false;
    });
    if (inst) inst.addEventListener("click", async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      try {
        await deferredInstall.userChoice;
      } catch (e) {}
      deferredInstall = null;
      inst.hidden = true;
    });
    const pset = $("#btnPinSet");
    if (pset) pset.addEventListener("click", () => {
      const a = prompt(t("pinSet"), "");
      if (!a) return;
      localStorage.setItem("vexora.pin", pinHash(a));
    });
    const pclr = $("#btnPinClear");
    if (pclr) pclr.addEventListener("click", () => localStorage.removeItem("vexora.pin"));
    const psave = $("#btnPresetSave");
    if (psave) psave.addEventListener("click", () => {
      const name = $("#presetName") && $("#presetName").value.trim() || "p" + Date.now();
      const all = loadJson(snKey("vexora.presets."), {});
      all[name] = readTuneSnap();
      saveJson(snKey("vexora.presets."), all);
      paintPresets();
    });
    const pload = $("#btnPresetLoad");
    if (pload) pload.addEventListener("click", () => {
      const name = $("#presetList") && $("#presetList").value;
      const all = loadJson(snKey("vexora.presets."), {});
      if (name && all[name]) applyTuneSnap(all[name]);
    });
    const pexp = $("#btnPresetExp");
    if (pexp) pexp.addEventListener("click", () => {
      const blob = new Blob([ JSON.stringify(loadJson(snKey("vexora.presets."), {}), null, 2) ], {
        type: "application/json"
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "vexora-tune.json";
      a.click();
    });
    const pimp = $("#presetFile");
    const pimpB = $("#btnPresetImp");
    if (pimpB && pimp) {
      pimpB.addEventListener("click", () => pimp.click());
      pimp.addEventListener("change", async e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          const j = JSON.parse(await f.text());
          saveJson(snKey("vexora.presets."), j);
          paintPresets();
        } catch (err) {}
      });
    }
    const pall = $("#btnApplyAll");
    if (pall) pall.addEventListener("click", () => {
      const btn = $("#btnApplyLim");
      if (btn) btn.click();
    });
    const lex = $("#btnLogExport");
    if (lex) lex.addEventListener("click", () => {
      const txt = $("#log") && $("#log").innerText || "";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([ txt ], {
        type: "text/plain"
      }));
      a.download = "vexora-log.txt";
      a.click();
    });
    const rain = $("#btnFocRain");
    if (rain) rain.addEventListener("click", () => {
      Object.keys(FOC_RAIN).forEach(k => {
        const el = $("#foc-" + k);
        if (el) el.value = String(FOC_RAIN[k]);
      });
    });
    const race = $("#btnFocRace");
    if (race) race.addEventListener("click", () => {
      Object.keys(FOC_RACE).forEach(k => {
        const el = $("#foc-" + k);
        if (el) el.value = String(FOC_RACE[k]);
      });
    });
    const fb = $("#foldback");
    if (fb) {
      fb.value = String(foldC);
      const lab = document.querySelector('[data-for="foldback"]');
      if (lab) lab.textContent = String(foldC);
      fb.addEventListener("input", () => {
        foldC = Number(fb.value) || 105;
        if (lab) lab.textContent = String(foldC);
        try {
          localStorage.setItem("vexora.foldback", String(foldC));
        } catch (e) {}
      });
    }
    const wn = $("#whatsNew");
    const wg = $("#whatsGo");
    try {
      if (wn && localStorage.getItem("vexora.seen.230") !== "1") {}
    } catch (e) {}
    if (wg) wg.addEventListener("click", () => {
      if (wn) wn.hidden = true;
      try {
        localStorage.setItem("vexora.seen.230", "1");
      } catch (e) {}
    });
    window.addEventListener("vexora-lang", () => {
      const rec = $("#btnTripRec");
      if (rec && !rec.classList.contains("is-on")) rec.textContent = t("rec");
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    const shr = $("#btnSharePreset");
    if (shr) shr.addEventListener("click", sharePreset);
    loadSharedPreset();
    paintHistory();
    paintFlashLog();
    paintPresets();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();