(() => {
  let gated = false;
  const $ = s => document.querySelector(s);
  (function accessGate() {
    let tok = null;
    try {
      tok = JSON.parse(localStorage.getItem("vexora.access") || "null");
    } catch (e) {}
    if (tok && tok.exp && tok.exp > Date.now()) return;
    const ov = $("#accessOverlay");
    if (!ov) return;
    ov.style.display = "flex";
    try {
      localStorage.removeItem("vexora.access");
    } catch (e) {}
    const lo2 = $("#legalOverlay");
    if (lo2) lo2.style.display = "none";
    const err = $("#accErr"), btn = $("#accGo");
    if (btn) btn.addEventListener("click", async () => {
      const code = (($("#accCode") || {}).value || "").trim();
      if (!code) return;
      btn.disabled = true;
      if (err) err.textContent = "";
      try {
        const r = await fetch("/api/access", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            code: code
          })
        });
        const j = await r.json().catch(() => null);
        if (r.ok && j && j.ok) {
          try {
            localStorage.setItem("vexora.access", JSON.stringify({
              exp: j.exp
            }));
          } catch (e) {}
          location.reload();
          return;
        }
        if (err) err.textContent = j && j.error || "Invalid code";
      } catch (e) {
        if (err) err.textContent = "Network error";
      }
      btn.disabled = false;
    });
    gated = true;
  })();
  window.VexoraUnlock = function() {
    let pend = null;
    function ok() {
      let t = null;
      try {
        t = JSON.parse(localStorage.getItem("vexora.unlock") || "null");
      } catch (e) {}
      return !!(t && t.exp && t.exp > Date.now());
    }
    async function ensure() {
      if (ok()) return true;
      const ov = $("#unlockOverlay");
      if (!ov) return true;
      ov.style.display = "flex";
      if (!pend) pend = new Promise(res => {
        window.__unlockResolve = res;
      });
      return pend;
    }
    function _resolve(v) {
      const r = window.__unlockResolve;
      window.__unlockResolve = null;
      pend = null;
      if (r) r(v);
    }
    (function wire() {
      const ov = $("#unlockOverlay"), btn = $("#uGo"), err = $("#uErr");
      if (!ov || !btn) return;
      btn.addEventListener("click", async () => {
        const code = (($("#uCode") || {}).value || "").trim();
        if (!code) return;
        btn.disabled = true;
        if (err) err.textContent = "";
        try {
          const r = await fetch("/api/unlock", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              code: code
            })
          });
          const j = await r.json().catch(() => null);
          if (r.ok && j && j.ok) {
            try {
              localStorage.setItem("vexora.unlock", JSON.stringify({
                exp: j.exp
              }));
            } catch (e) {}
            ov.style.display = "none";
            _resolve(true);
            return;
          }
          if (err) err.textContent = j && j.error || "Invalid unlock code";
        } catch (e) {
          if (err) err.textContent = "Network error";
        }
        btn.disabled = false;
      });
    })();
    return {
      ok: ok,
      ensure: ensure,
      _resolve: _resolve
    };
  }();
  if (gated) return;
  const $$ = s => [ ...document.querySelectorAll(s) ];
  const on = (sel, ev, fn) => {
    const el = $(sel);
    if (el) el.addEventListener(ev, fn);
  };
  function log(tag, msg) {
    const box = $("#log");
    if (!box) return;
    const line = document.createElement("div");
    const bad = tag !== "ota" && tag !== "hs" && /fail|error|Timeout|reject|drop|dead|cut/i.test(String(msg));
    line.className = bad ? "err" : tag === "ok" ? "ok" : "";
    line.textContent = (new Date).toLocaleTimeString("en-GB", {
      hour12: false
    }) + "  [" + tag + "]  " + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }
  let session = null, pollFast = null, pollSlow = null, phase = "idle", connecting = false, fails = 0, flashing = false;
  let scanning = false, scanAbort = false;
  let connectGen = 0;
  let pair = {
    step: "pick",
    title: "Connecting",
    detail: "Select a scooter",
    power: false
  };
  const X = window.CfwFlasher && CfwFlasher.X || {
    HOST: 62,
    VCU: 22,
    MCU: 2,
    BLE: 4,
    BMS: 7
  };
  const G3 = {
    SPEED: 87,
    SOC: 85,
    RANGE: 95,
    TEMP: 107,
    MILEAGE: 98,
    MODE: 90,
    ECO_DRIVE: 71,
    SPORT: 72,
    VOLT: 140,
    AMP: 141,
    MOTOR_TEMP: 24
  };
  const MODE = {
    1: {
      name: "Walk",
      cap: 6
    },
    2: {
      name: "Eco",
      cap: 16
    },
    5: {
      name: "Drive",
      cap: 25
    },
    3: {
      name: "Sport",
      cap: 60
    }
  };
  let bleLock = Promise.resolve();
  function withBle(fn) {
    const run = bleLock.then(fn, fn);
    bleLock = run.then(() => {}, () => {});
    return run;
  }
  window.Vexora = window.Vexora || {};
  window.Vexora.withBle = withBle;
  window.Vexora.getSession = () => session;
  window.Vexora.marks = {
    vcu: false,
    mcu: false
  };
  function applyVxfwMode(on) {
    try {
      localStorage.setItem("vexora.vxfw", on ? "1" : "0");
    } catch (e) {}
    const body = document.body;
    if (!on) {
      body.classList.remove("mode-vxfw");
      return;
    }
    if (body.classList.contains("mode-vxfw")) return;
    body.classList.add("mode-vxfw");
    const vx = document.getElementById("view-vxfw");
    const cfw = document.getElementById("view-cfw");
    const motor = document.getElementById("view-motor");
    if (vx && cfw && motor) {
      Array.prototype.forEach.call(motor.querySelectorAll(".card"), c => vx.appendChild(c));
      Array.prototype.forEach.call(cfw.querySelectorAll(".card"), c => vx.appendChild(c));
      const gate = document.getElementById("vxfwGate");
      const head = vx.querySelector(".page-head");
      if (gate && head) vx.insertBefore(gate, head.nextSibling);
    }
    const active = document.querySelector(".view.active");
    let saved = "";
    try {
      saved = localStorage.getItem("vexora.tab") || "";
    } catch (e) {}
    const wantsVxfw = active && (active.id === "view-cfw" || active.id === "view-motor") || saved === "cfw" || saved === "motor" || !active;
    if (wantsVxfw) {
      const btn = document.querySelector('[data-view="vxfw"]');
      if (btn) btn.click();
    }
  }
  Vexora.applyVxfwMode = applyVxfwMode;
  try {
    fetch("/api/features").then(r => r.json()).then(j => {
      const on = !!(j && j.features && j.features.vxfw === 1);
      applyVxfwMode(on);
    }).catch(() => {});
  } catch (e) {}
  window.Vexora.sessionMarks = {
    vcu: false,
    mcu: false
  };
  window.Vexora.lastSn = "";
  function flashKey(sn) {
    return "vexora.cfw." + String(sn || "").replace(/[^\w.-]/g, "");
  }
  window.Vexora.markFlash = function(part) {
    const p = part === "vcu" ? "vcu" : "mcu";
    this.sessionMarks[p] = true;
    this.marks[p] = true;
    this.lastFlash = p;
    this.verifyPending = p;
    try {
      const data = JSON.stringify({
        vcu: !!this.marks.vcu,
        mcu: !!this.marks.mcu,
        t: Date.now()
      });
      localStorage.setItem("vexora.cfw.last", data);
      if (this.lastSn) localStorage.setItem(flashKey(this.lastSn), data);
    } catch (e) {}
    try {
      if (window.VexoraX && VexoraX.onFlash) {
        const sum = window.VexoraCfw && VexoraCfw.summary ? VexoraCfw.summary(p) : p;
        VexoraX.onFlash(p, sum);
      }
    } catch (e) {}
  };
  window.Vexora.isFlashed = function(part) {
    return !!(this.marks && this.marks[part]);
  };
  window.Vexora.rememberSn = function(sn) {
    sn = String(sn || "").trim();
    if (!sn || sn === "—" || sn === "err") return;
    this.lastSn = sn;
    this.marks = this.marks || {
      vcu: false,
      mcu: false
    };
    this.marks.vcu = !!(this.marks.vcu || this.sessionMarks.vcu);
    this.marks.mcu = !!(this.marks.mcu || this.sessionMarks.mcu);
    try {
      const raw = localStorage.getItem(flashKey(sn)) || localStorage.getItem("vexora.cfw.last");
      if (raw) {
        const j = JSON.parse(raw);
        if (j.vcu) this.marks.vcu = true;
        if (j.mcu) this.marks.mcu = true;
      }
      const data = JSON.stringify({
        vcu: !!this.marks.vcu,
        mcu: !!this.marks.mcu,
        t: Date.now()
      });
      localStorage.setItem(flashKey(sn), data);
      localStorage.setItem("vexora.cfw.last", data);
    } catch (e) {}
  };
  try {
    const boot = JSON.parse(localStorage.getItem("vexora.cfw.last") || "null");
    if (boot) {
      if (boot.vcu) {
        window.Vexora.marks.vcu = true;
        window.Vexora.sessionMarks.vcu = true;
      }
      if (boot.mcu) {
        window.Vexora.marks.mcu = true;
        window.Vexora.sessionMarks.mcu = true;
      }
    }
  } catch (e) {}
  let imperial = false;
  try {
    imperial = localStorage.getItem("vexora.unit") === "mi";
  } catch (e) {}
  let wake = null;
  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 12);
    } catch (e) {}
  }
  function toSpd(kmh) {
    return imperial ? Number(kmh) * .621371 : Number(kmh);
  }
  function toDst(km) {
    return imperial ? Number(km) * .621371 : Number(km);
  }
  function uSpd() {
    return imperial ? "mph" : "km/h";
  }
  function uDst() {
    return imperial ? "mi" : "km";
  }
  function fmtSpd(kmh, n) {
    if (!Number.isFinite(kmh)) return "—";
    return toSpd(kmh).toFixed(n == null ? 1 : n);
  }
  function fmtDst(km, n) {
    if (!Number.isFinite(km)) return "—";
    return toDst(km).toFixed(n == null ? 2 : n);
  }
  async function setWake(on) {
    try {
      if (on && navigator.wakeLock && navigator.wakeLock.request) wake = await navigator.wakeLock.request("screen"); else if (wake) {
        await wake.release();
        wake = null;
      }
    } catch (e) {
      wake = null;
    }
  }
  function paintUnits() {
    const u = uSpd(), d = uDst();
    if ($("#btnUnit")) $("#btnUnit").textContent = u;
    if ($("#vSpdUnit")) $("#vSpdUnit").textContent = u;
    if ($("#vTripKmU")) $("#vTripKmU").textContent = d;
    if ($("#vMaxSpdU")) $("#vMaxSpdU").textContent = "max " + u;
    if ($("#vAvgSpdU")) $("#vAvgSpdU").textContent = "avg " + u;
    if ($("#vRangeU")) $("#vRangeU").textContent = d;
    if ($("#vOdoU")) $("#vOdoU").textContent = d;
  }
  function banner(msg, ok) {
    const el = $("#discBanner");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.className = "banner";
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.className = "banner show" + (ok ? " ok" : "");
    el.textContent = msg;
  }
  function setStatus(text, kind) {
    const st = $("#status"), dot = $("#dot");
    if (st) st.textContent = text;
    if (dot) dot.className = "dot" + (kind === "on" ? " on" : kind === "wait" ? " wait" : "");
  }
  function dash(id, val, tick) {
    const el = $(id);
    if (!el) return;
    const next = String(val);
    if (el.textContent === next) return;
    el.textContent = next;
    if (tick) {
      el.classList.remove("tick");
      void el.offsetWidth;
      el.classList.add("tick");
    }
  }
  function setBattery(pct) {
    dash("#vBat", pct == null ? "—" : String(pct), true);
    const bar = $("#vBatBar"), wrap = $("#statBat");
    const n = Number(pct);
    const ok = Number.isFinite(n);
    if (bar) bar.style.width = ok ? Math.max(0, Math.min(100, n)) + "%" : "0%";
    if (wrap) wrap.classList.toggle("low", ok && n <= 20);
  }
  function clearDash() {
    dash("#vSpeed", "—");
    dash("#vLimit", "—");
    dash("#vMode", "—");
    setBattery(null);
    dash("#vRange", "—");
    dash("#vOdo", "—");
    dash("#vPow", "—");
    dash("#vEta", "—");
    if ($("#vSess")) $("#vSess").textContent = "—";
    lastWatts = null;
    sess = {
      t0: 0,
      maxKmh: 0,
      maxW: 0
    };
    setLimPip(0);
    const wEl = $("#vWatts");
    if (wEl) wEl.classList.remove("hot");
    dash("#vName", "—");
    dash("#vTemp", "—");
    dash("#vVolt", "—");
    dash("#vAmp", "—");
    dash("#vMtemp", "—");
    dash("#vLock", "—");
    const flow = $("#vFlow");
    if (flow) {
      flow.hidden = true;
      flow.textContent = "—";
      flow.className = "pill";
    }
    dash("#vPackState", "—");
    dash("#vCycles", "—");
    dash("#vSoh", "—");
    dash("#vCellSpan", "—");
    dash("#vBmsTemp", "—");
    const cells = $("#vCells");
    if (cells) cells.innerHTML = "";
    paintSn("");
    setGauge(0);
    freezeTrip();
  }
  function paintSn(sn) {
    sn = String(sn || "").replace(/\0/g, "").trim();
    const el = $("#hdrSn");
    if (!el) return;
    if (!sn || sn === "—" || sn === "err") {
      el.hidden = true;
      el.textContent = "—";
      return;
    }
    el.hidden = false;
    el.textContent = sn;
    if (window.Vexora && Vexora.rememberSn) Vexora.rememberSn(sn);
    const mk = window.VEXORA && VEXORA.detectModel && VEXORA.detectModel(sn);
    if (mk) setModel(mk);
  }
  function paintFlow(amps) {
    const el = $("#vFlow");
    if (!el) return;
    if (!Number.isFinite(amps)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (amps > .15) {
      el.textContent = "Charging";
      el.className = "pill charge";
    } else if (amps < -.15) {
      el.textContent = "Discharge";
      el.className = "pill";
    } else {
      el.textContent = "Idle";
      el.className = "pill";
    }
    dash("#vPackState", el.textContent);
  }
  function paintCells(buf) {
    const box = $("#vCells");
    if (!box) return;
    const mv = [];
    if (buf) {
      for (let i = 0; i + 1 < buf.length; i += 2) {
        const v = buf[i] | buf[i + 1] << 8;
        if (v > 0 && v < 65535) mv.push(v);
      }
    }
    if (!mv.length) {
      box.innerHTML = "";
      dash("#vCellSpan", "—");
      return;
    }
    const lo = Math.min.apply(null, mv), hi = Math.max.apply(null, mv);
    if (window.Vexora) Vexora.lastCellDelta = hi - lo;
    dash("#vCellSpan", lo + "–" + hi + " · Δ" + (hi - lo));
    box.innerHTML = mv.map(v => {
      const cls = v === lo ? " low" : v === hi ? " hi" : "";
      return '<div class="cell' + cls + '"><b>' + (v / 1e3).toFixed(3) + "</b><span>V</span></div>";
    }).join("");
  }
  let lastWatts = null;
  let sess = {
    t0: 0,
    maxKmh: 0,
    maxW: 0
  };
  function polar(t, rad) {
    const th = (150 + Math.max(0, Math.min(1, t)) * 240) * Math.PI / 180;
    return [ 150 + rad * Math.cos(th), 132 + rad * Math.sin(th) ];
  }
  function setLimPip(kmh) {
    const pip = $("#vLimPip");
    if (!pip) return;
    if (!Number.isFinite(kmh) || kmh <= 0) {
      pip.style.opacity = "0";
      return;
    }
    const p = polar(kmh / 130, 102);
    pip.setAttribute("cx", p[0].toFixed(2));
    pip.setAttribute("cy", p[1].toFixed(2));
    pip.style.opacity = "1";
  }
  function paintSess() {
    const el = $("#vSess");
    if (!el) return;
    if (!sess.t0) {
      el.textContent = "—";
      return;
    }
    const max = sess.maxKmh ? fmtSpd(sess.maxKmh, 1) + " " + uSpd() : "—";
    const w = sess.maxW ? Math.round(sess.maxW) + " W" : "—";
    el.textContent = fmtTime(Date.now() - sess.t0) + " · max " + max + " · " + w;
  }
  function paintEta() {
    if (Number.isFinite(lastRange) && Number.isFinite(lastKmh) && lastKmh > 5 && lastRange > .05) {
      const min = lastRange / lastKmh * 60;
      const h = Math.floor(min / 60), m = Math.round(min % 60);
      dash("#vEta", h ? h + "h " + m + "m" : m + "m");
    } else dash("#vEta", "—");
  }
  function setGauge(kmh, watts) {
    const n = Number.isFinite(kmh) ? kmh : 0;
    const t = Math.max(0, Math.min(1, n / 130));
    const fill = $("#vGaugeFill");
    if (fill) {
      let len = 427;
      try {
        const g = fill.getTotalLength();
        if (g > 1) len = g;
      } catch (e) {}
      fill.style.strokeDasharray = String(len);
      fill.style.strokeDashoffset = String(len * (1 - t));
      fill.style.stroke = t >= .85 ? "var(--danger)" : t >= .55 ? "var(--text)" : "var(--ok)";
    }
    if (Number.isFinite(watts)) lastWatts = watts;
    const w = Number.isFinite(watts) ? watts : lastWatts;
    const pfill = $("#vPowFill"), wEl = $("#vWatts");
    const pt = Number.isFinite(w) ? Math.max(0, Math.min(1, w / 2e3)) : 0;
    if (pfill) {
      let plen = 352;
      try {
        const g = pfill.getTotalLength();
        if (g > 1) plen = g;
      } catch (e) {}
      pfill.style.strokeDasharray = String(plen);
      pfill.style.strokeDashoffset = String(plen * (1 - pt));
      pfill.style.stroke = pt >= .75 ? "var(--danger)" : pt >= .4 ? "var(--text)" : "var(--ok)";
    }
    if (wEl) wEl.classList.toggle("hot", Number.isFinite(w) && w >= 1500);
    if (Number.isFinite(kmh) && kmh > sess.maxKmh) sess.maxKmh = kmh;
    if (Number.isFinite(w) && w > sess.maxW) sess.maxW = w;
  }
  let trip = {
    rec: false,
    t0: 0,
    prevT: 0,
    elapsed: 0,
    dist: 0,
    maxKmh: 0,
    maxW: 0,
    samples: []
  };
  let limitDirty = false;
  let lastKmh = null, lastRange = null, lastOdo = null;
  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1e3));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
    return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }
  function drawSpark() {
    const c = $("#vSpark");
    if (!c || !c.getContext) return;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const pts = trip.samples || [];
    if (pts.length < 2) return;
    const maxS = Math.max(1, ...pts.map(p => p.s || 0));
    const maxW = Math.max(1, ...pts.map(p => p.w || 0));
    function line(key, max, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      pts.forEach((p, i) => {
        const x = i / (pts.length - 1) * w;
        const y = h - 3 - (p[key] || 0) / max * (h - 6);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    line("w", maxW, "#5a5a62");
    line("s", maxS, "#3ecf8e");
  }
  function saveTrip() {
    try {
      const snap = {
        rec: false,
        t0: 0,
        prevT: 0,
        elapsed: trip.rec && trip.t0 ? Date.now() - trip.t0 : trip.elapsed,
        dist: trip.dist,
        maxKmh: trip.maxKmh,
        maxW: trip.maxW,
        samples: (trip.samples || []).slice(-80)
      };
      localStorage.setItem("vexora.lastTrip", JSON.stringify(snap));
    } catch (e) {}
  }
  function loadTrip() {
    try {
      const j = JSON.parse(localStorage.getItem("vexora.lastTrip") || "null");
      if (!j) return;
      trip = {
        rec: false,
        t0: 0,
        prevT: 0,
        elapsed: j.elapsed || 0,
        dist: j.dist || 0,
        maxKmh: j.maxKmh || 0,
        maxW: j.maxW || 0,
        samples: Array.isArray(j.samples) ? j.samples.slice(-80) : []
      };
    } catch (e) {}
  }
  function paintTrip() {
    const now = trip.rec && trip.t0 ? Date.now() - trip.t0 : trip.elapsed;
    dash("#vTripTime", fmtTime(now));
    if (window.Vexora) Vexora.tripKm = trip.dist || 0;
    dash("#vTripKm", trip.dist ? fmtDst(trip.dist, 2) : "0.00");
    dash("#vMaxSpd", trip.maxKmh ? fmtSpd(trip.maxKmh, 1) : "—");
    dash("#vMaxPow", trip.maxW ? String(Math.round(trip.maxW)) : "—");
    dash("#vMaxPowStat", trip.maxW ? String(Math.round(trip.maxW)) : "—");
    dash("#vTripPts", String((trip.samples || []).length));
    const hrs = now / 36e5;
    dash("#vAvgSpd", hrs > .002 && trip.dist > 0 ? fmtSpd(trip.dist / hrs, 1) : "—");
    const rec = $("#btnTripRec");
    if (rec) {
      rec.classList.toggle("is-on", !!trip.rec);
      rec.textContent = trip.rec ? "Stop" : "Start";
    }
    drawSpark();
    drawChart((trip.samples || []).slice(-900), trip.rec ? tr96("tripLive", {}) || "Live" : "");
    paintUnits();
  }
  function resetTrip() {
    trip = {
      rec: false,
      t0: 0,
      prevT: 0,
      elapsed: 0,
      dist: 0,
      maxKmh: 0,
      maxW: 0,
      samples: []
    };
    setWake(false);
    saveTrip();
    paintTrip();
  }
  const tr96 = (k, f) => window.I18N && I18N.t && I18N.t(k) || f;
  function tripsAll() {
    try {
      const j = JSON.parse(localStorage.getItem("vexora.trips") || "[]");
      return Array.isArray(j) ? j : [];
    } catch (e) {
      return [];
    }
  }
  function tripsSave(list) {
    try {
      localStorage.setItem("vexora.trips", JSON.stringify(list.slice(0, 20)));
    } catch (e) {}
  }
  function tripArchive() {
    if (!trip.t0 || !(trip.elapsed > 3e4 || trip.dist > .05)) return;
    const list = tripsAll();
    list.unshift({
      t0: trip.t0,
      elapsed: Math.round(trip.elapsed),
      dist: +Number(trip.dist).toFixed(3),
      maxKmh: +Number(trip.maxKmh).toFixed(1),
      maxW: Math.round(trip.maxW),
      samples: (trip.samples || []).slice(-900)
    });
    tripsSave(list);
    paintTrips();
  }
  function drawChart(pts, subtitle) {
    const c = $("#vChart");
    if (!c || !c.getContext) return;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#101013";
    ctx.fillRect(0, 0, w, h);
    if (!pts || pts.length < 2) {
      ctx.fillStyle = "#6f6f78";
      ctx.font = "12px Montserrat, sans-serif";
      ctx.fillText(subtitle || "", 28, h / 2);
      return;
    }
    const maxS = Math.max(1, ...pts.map(p => p.s || 0));
    const maxW = Math.max(1, ...pts.map(p => p.w || 0));
    ctx.strokeStyle = "#1d1d22";
    ctx.fillStyle = "#6f6f78";
    ctx.font = "10px Montserrat, sans-serif";
    for (let i = 1; i <= 3; i++) {
      const y = Math.round(h - 16 - i / 4 * (h - 30)) + .5;
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(w - 8, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(maxS * i / 4)), 4, y + 3);
    }
    function line(key, max, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      pts.forEach((p, i) => {
        const x = 30 + i / (pts.length - 1) * (w - 40);
        const y = h - 16 - (p[key] || 0) / max * (h - 30);
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    line("w", maxW, "#8a8a94");
    line("s", maxS, "#3ecf8e");
    ctx.font = "10px Montserrat, sans-serif";
    ctx.fillStyle = "#3ecf8e";
    ctx.fillText("km/h · max " + Math.round(maxS), 30, 10);
    ctx.fillStyle = "#8a8a94";
    ctx.fillText("W · max " + Math.round(maxW), 110, 10);
    if (subtitle) {
      ctx.fillStyle = "#6f6f78";
      ctx.fillText(subtitle, 30, h - 4);
    }
  }
  function paintTrips() {
    const box = $("#tripList");
    if (!box) return;
    const list = tripsAll();
    if (!list.length) {
      box.innerHTML = '<p class="note">' + esc(tr96("tripEmpty", {}) || "No saved trips yet — press Start on a ride.") + "</p>";
      return;
    }
    box.innerHTML = list.map(function(t, i) {
      const d = new Date(t.t0 || Date.now());
      const dd = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      }) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      return '<div class="trip-row"><b>' + esc(dd) + "</b><span>" + fmtTime(t.elapsed || 0) + "</span><span>" + Number(t.dist || 0).toFixed(2) + ' km</span><span class="hint">' + Math.round(t.maxKmh || 0) + " km/h · " + Math.round(t.maxW || 0) + ' W</span><span style="flex:1"></span><button type="button" class="btn ghost sm" data-tview="' + i + '" aria-label="view">▸</button><button type="button" class="btn ghost sm" data-tdel="' + i + '" aria-label="delete">✕</button></div>';
    }).join("");
  }
  function vexToast(msg) {
    let t = document.querySelector(".vextoast");
    if (!t) {
      t = document.createElement("div");
      t.className = "vextoast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("on"), 3500);
  }
  function dlFile(name, mime, content) {
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([ content ], {
        type: mime
      }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 400);
    } catch (e) {}
  }
  function freezeTrip() {
    if (trip.rec) {
      trip.elapsed = trip.t0 ? Date.now() - trip.t0 : trip.elapsed;
      trip.rec = false;
      trip.prevT = 0;
      if (window.VexoraX && VexoraX.onTripStop) VexoraX.onTripStop(trip);
    }
    setWake(false);
    saveTrip();
    tripArchive();
    paintTrip();
  }
  function tripSample(kmh, watts) {
    if (!trip.rec) {
      paintTrip();
      return;
    }
    const now = Date.now();
    if (!trip.t0) trip.t0 = now;
    if (Number.isFinite(kmh) && kmh >= 0) {
      if (trip.prevT) {
        const dt = Math.min(2, (now - trip.prevT) / 1e3);
        if (kmh > .3) trip.dist += kmh * dt / 3600;
      }
      trip.prevT = now;
      if (kmh > trip.maxKmh) trip.maxKmh = kmh;
    }
    if (Number.isFinite(watts) && watts > trip.maxW) trip.maxW = watts;
    const last = trip.samples[trip.samples.length - 1] || {};
    const s = Number.isFinite(kmh) ? kmh : last.s || 0;
    const w = Number.isFinite(watts) ? watts : last.w || 0;
    if (trip.samples.length > 900) trip.samples.shift();
    if (!trip.samples.length || now - (last.t || 0) > 280) trip.samples.push({
      t: now,
      s: s,
      w: w
    });
    paintTrip();
  }
  function idleHint(msg) {
    const el = $("#gateHint");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }
  function paint() {
    const idle = phase === "idle", pairing = phase === "pairing", live = phase === "live";
    const gate = $("#gate"), liveEl = $("#live"), overlay = $("#pairOverlay"), disc = $("#btnDisc");
    if (gate) gate.hidden = live;
    if (liveEl) {
      const wasHidden = liveEl.hidden;
      liveEl.hidden = !live;
      if (live && wasHidden) {
        liveEl.classList.remove("enter");
        void liveEl.offsetWidth;
        liveEl.classList.add("enter");
      }
    }
    if (overlay) overlay.hidden = !pairing;
    if (disc) disc.hidden = idle;
    document.body.classList.toggle("is-pairing", pairing);
    document.body.classList.toggle("is-live", live);
    const tt = k => window.I18N && I18N.t ? I18N.t(k) : k;
    if (idle) setStatus(tt("disconnected")); else if (pairing) setStatus(pair.power ? tt("waiting") : tt("connecting"), "wait"); else setStatus(tt("connected"), "on");
    if (pairing) {
      const title = $("#pairTitle"), detail = $("#pairDetail");
      const pwr = $("#powerHint"), ring = $("#pairRing");
      if (title) title.textContent = pair.title;
      if (detail) detail.textContent = pair.detail;
      if (pwr) pwr.hidden = !pair.power;
      if (ring) ring.hidden = !!pair.power;
      const order = [ "pick", "gatt", "nbc", "ready" ];
      let idx = order.indexOf(pair.step);
      if (pair.step === "power") idx = 2;
      if (idx < 0) idx = 0;
      $$("#pairSteps i").forEach(dot => {
        const n = order.indexOf(dot.getAttribute("data-k"));
        dot.classList.toggle("now", n === idx);
        dot.classList.toggle("done", n >= 0 && n < idx);
      });
    }
    const enc = window.lastBuiltFirmwareEnc, part = window.lastBuiltPartition, last = $("#flashLast");
    if (last && enc && part) last.textContent = "In RAM: " + part.toUpperCase() + " · " + enc.length + " B";
  }
  function u16(d) {
    return d && d.length >= 2 ? d[0] | d[1] << 8 : null;
  }
  function decodeSport(d) {
    if (!d || !d.length) return null;
    const w = u16(d);
    if (w == null) return d[0];
    if (w > 0 && w <= 250) return w;
    if (d[0] > 0 && d[0] <= 250) return d[0];
    if (d[1] > 0 && d[1] <= 250) return d[1];
    return w & 255;
  }
  function s16(d) {
    const v = u16(d);
    if (v == null) return null;
    return v >= 32768 ? v - 65536 : v;
  }
  function u32(d) {
    return d && d.length >= 4 ? (d[0] | d[1] << 8 | d[2] << 16 | d[3] << 24) >>> 0 : null;
  }
  async function readTry(dst, reg, len, ms) {
    if (!session || !session.readRegister || session.dead) return null;
    try {
      return await session.readRegister(dst, reg, len, ms || 1200);
    } catch {
      return null;
    }
  }
  let skipBms = 0, restTick = 0, snOnce = false;
  async function pollSpeed() {
    if (!session || !session.readRegister || session.dead) return false;
    const speedB = await readTry(X.VCU, G3.SPEED, 2, 700);
    if (!speedB) return false;
    const kmh = u16(speedB) / 10;
    if (Number.isFinite(kmh)) {
      lastKmh = kmh;
      if (window.Vexora) Vexora.lastKmh = kmh;
      dash("#vSpeed", fmtSpd(kmh, 1));
      setGauge(kmh);
      paintEta();
      if (trip.rec) tripSample(kmh, null);
      if (window.VexoraX && VexoraX.onTick) {
        VexoraX.onTick({
          kmh: kmh,
          watts: window.Vexora.lastWatts,
          vcuTemp: Vexora.lastVcuTemp,
          motorTemp: Vexora.lastMotorTemp,
          dt: .18
        });
      }
    }
    return true;
  }
  async function pollRest() {
    if (!session || !session.readRegister || session.dead) return false;
    restTick += 1;
    const slice = restTick % 3;
    const modeB = await readTry(X.VCU, G3.MODE, 1, 500);
    const socB = await readTry(X.VCU, G3.SOC, 2, 500);
    if (socB) {
      const soc = u16(socB);
      setBattery(soc);
      if (window.Vexora) Vexora.lastSoc = soc;
    }
    const md = modeB ? MODE[modeB[0]] : null;
    if (md) dash("#vMode", md.name); else if (modeB) dash("#vMode", "m" + modeB[0]);
    if (slice === 0) {
      const sportB = await readTry(X.VCU, G3.SPORT, 2, 500);
      const ecoB = await readTry(X.VCU, G3.ECO_DRIVE, 2, 500);
      let cap = sportB ? decodeSport(sportB) : md && md.cap;
      if (cap != null) {
        dash("#vLimit", fmtSpd(cap, 0) + " " + uSpd());
        setLimPip(cap);
        if (!limitDirty) {
          if ($("#limRange") && document.activeElement !== $("#limRange")) {
            $("#limRange").value = cap;
            dash("#limNum", String(cap));
          }
          if (ecoB && ecoB.length >= 2) {
            if ($("#limEco") && document.activeElement !== $("#limEco")) {
              $("#limEco").value = ecoB[0];
              dash("#limEcoNum", String(ecoB[0]));
            }
            if ($("#limDrive") && document.activeElement !== $("#limDrive")) {
              $("#limDrive").value = ecoB[1];
              dash("#limDriveNum", String(ecoB[1]));
            }
          }
        }
      }
    } else if (slice === 1) {
      const rangeB = await readTry(X.VCU, G3.RANGE, 2, 500);
      const odoB = await readTry(X.VCU, G3.MILEAGE, 4, 500);
      const tempB = await readTry(X.VCU, G3.TEMP, 2, 500);
      if (rangeB) {
        lastRange = u16(rangeB) / 100;
        dash("#vRange", Number.isFinite(lastRange) ? fmtDst(lastRange, 1) : "—", true);
      }
      if (odoB) {
        lastOdo = u32(odoB) / 10;
        dash("#vOdo", Number.isFinite(lastOdo) ? fmtDst(lastOdo, 1) : "—", true);
      }
      if (tempB) {
        const c = u16(tempB) / 10;
        dash("#vTemp", Number.isFinite(c) ? c.toFixed(1) : "—", true);
        if (window.Vexora) Vexora.lastVcuTemp = c;
        const st = $("#statVcu");
        if (st) st.classList.toggle("low", Number.isFinite(c) && c >= 95);
        if (Number.isFinite(c) && window.VexoraLive && VexoraLive.onTemp) {
          try {
            await VexoraLive.onTemp(c);
          } catch (e) {}
        }
      }
    } else {
      const motB = await readTry(X.VCU, G3.MOTOR_TEMP, 2, 500);
      const bits = await readTry(X.VCU, 29, 2, 500);
      if (motB) {
        const c = u16(motB) / 10;
        dash("#vMtemp", Number.isFinite(c) ? c.toFixed(1) : "—", true);
        if (window.Vexora) Vexora.lastMotorTemp = c;
      }
      const unlocked = bits ? !!(u16(bits) & 1 << 1) : null;
      if ($("#vLock")) {
        $("#vLock").textContent = unlocked == null ? "—" : unlocked ? "Unlocked" : "Locked";
        $("#vLock").className = "pill" + (unlocked ? " unlock" : unlocked === false ? " lock" : "");
      }
      if (skipBms <= 0) {
        const voltB = await readTry(X.BMS, G3.VOLT, 2, 400);
        const ampB = await readTry(X.BMS, G3.AMP, 2, 400);
        if (!voltB && !ampB) skipBms = 4;
        const v = voltB ? u16(voltB) / 100 : null;
        const a = ampB ? s16(ampB) / 100 : null;
        if (v != null) dash("#vVolt", v.toFixed(1), true);
        if (a != null) dash("#vAmp", a.toFixed(1), true);
        if (a != null) paintFlow(a);
        if (v != null && a != null) {
          const watts = Math.max(0, Math.round(v * a));
          dash("#vPow", String(watts), true);
          setGauge(lastKmh, watts);
          if (window.Vexora) {
            Vexora.lastWatts = watts;
            Vexora.lastAmp = a;
          }
          if (trip.rec) tripSample(null, watts);
          if (window.VexoraX && VexoraX.onTick) {
            VexoraX.onTick({
              kmh: lastKmh,
              watts: watts,
              amps: a,
              vcuTemp: Vexora.lastVcuTemp,
              motorTemp: Vexora.lastMotorTemp,
              dt: 2
            });
          }
        }
      } else skipBms -= 1;
    }
    if (restTick % 4 === 1 && skipBms <= 0) {
      const cellB = await readTry(X.BMS, 160, 26, 500);
      const cycB = await readTry(X.BMS, 89, 2, 400);
      const capB = await readTry(X.BMS, 19, 2, 400);
      const tmpB = await readTry(X.BMS, 150, 16, 400);
      if (!cellB && !cycB) skipBms = 4;
      if (cellB) paintCells(cellB);
      if (cycB) dash("#vCycles", String(u16(cycB)), true);
      if (capB) {
        const mah = u16(capB) * 10;
        const soh = mah > 0 ? Math.max(1, Math.min(100, Math.round(mah / 12750 * 100))) : null;
        dash("#vSoh", soh != null ? soh + "%" : "—", true);
      }
      if (tmpB && tmpB.length >= 2) {
        let maxC = null;
        for (let i = 0; i + 1 < tmpB.length; i += 2) {
          const c = tmpB[i] | tmpB[i + 1] << 8;
          if (c === 0 || c >= 255) continue;
          if (maxC == null || c > maxC) maxC = c;
        }
        if (maxC != null) dash("#vBmsTemp", String(maxC), true);
      }
    }
    if (!snOnce) {
      const snB = await readTry(X.VCU, 16, 14, 500);
      if (snB) {
        const sn = Array.from(snB).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : "").join("").replace(/\0/g, "").trim();
        if (sn) {
          paintSn(sn);
          snOnce = true;
        }
      }
    }
    dash("#vName", session.bleName || session.ble && session.ble.name || "—");
    return !!(modeB || socB);
  }
  function startPoll() {
    stopPoll();
    fails = 0;
    skipBms = 0;
    restTick = 0;
    snOnce = false;
    sess = {
      t0: Date.now(),
      maxKmh: 0,
      maxW: 0
    };
    setWake(true);
    const fast = async () => {
      if (phase !== "live" || !session || session.dead) return;
      try {
        const ok = await withBle(() => pollSpeed());
        if (ok) {
          fails = 0;
          if (phase === "live") setStatus("Connected", "on");
        } else {
          fails += 1;
          if (fails >= 20) {
            await hardClose("timeout · no reply");
            return;
          }
        }
      } catch (e) {
        fails += 1;
        if (fails >= 20 || session && session.dead) {
          await hardClose(e.message || "timeout");
          return;
        }
      }
      if (phase === "live") pollFast = setTimeout(fast, 180);
    };
    const slow = async () => {
      if (phase !== "live" || !session || session.dead) return;
      try {
        await withBle(() => pollRest());
      } catch (e) {}
      if (phase === "live") pollSlow = setTimeout(slow, 2e3);
    };
    fast();
    pollSlow = setTimeout(slow, 400);
  }
  function stopPoll() {
    if (pollFast) clearTimeout(pollFast);
    if (pollSlow) clearTimeout(pollSlow);
    pollFast = pollSlow = null;
  }
  function applyPairMeta(msg, meta) {
    if (!meta || !meta.phase) return;
    const copy = {
      pick: {
        title: "Connecting",
        detail: msg || "Select a scooter"
      },
      gatt: {
        title: "Connecting",
        detail: msg || "Linking"
      },
      nbc: {
        title: "Pairing",
        detail: msg || "Pairing"
      },
      power: {
        title: "Press power",
        detail: "Once on the scooter"
      },
      ready: {
        title: "Connected",
        detail: ""
      }
    };
    const t = copy[meta.phase] || {
      title: "Connecting",
      detail: msg || ""
    };
    pair = {
      step: meta.phase,
      title: t.title,
      detail: t.detail,
      power: !!meta.power
    };
    paint();
  }
  async function connect(any, presetDevice) {
    if (document.body.classList.contains("is-legal")) return;
    if (!window.CfwFlasher || !CfwFlasher.connect) {
      log("err", "flasher.js missing");
      idleHint("Flasher failed to load. Reload.");
      return;
    }
    connecting = false;
    try {
      if (CfwFlasher.abortConnect) CfwFlasher.abortConnect();
    } catch (e) {}
    try {
      if (session && session.close) session.close();
    } catch (e) {}
    session = null;
    stopPoll();
    if (window.VexoraLive) VexoraLive.setSession(null);
    const gen = ++connectGen;
    connecting = true;
    phase = "pairing";
    pair = {
      step: "pick",
      title: "Connecting",
      detail: any ? "Select a device" : "Select a scooter",
      power: false
    };
    banner("");
    idleHint("");
    if (typeof showView === "function") showView("dash");
    paint();
    log("hs", any === "last" ? "reconnect" : any ? "picker · any" : "picker");
    try {
      const fn = any === "last" ? CfwFlasher.reconnect : presetDevice && CfwFlasher.connectDevice ? cb => CfwFlasher.connectDevice(presetDevice, cb) : any && CfwFlasher.connectAny ? CfwFlasher.connectAny : CfwFlasher.connect;
      const next = await fn((msg, meta) => {
        if (gen !== connectGen) return;
        log("hs", msg);
        applyPairMeta(msg, meta);
      });
      if (gen !== connectGen) {
        try {
          if (next && next.close) next.close();
        } catch (e) {}
        return;
      }
      session = next;
      if (session && session.ble && session.ble.device) {
        session.ble.device.addEventListener("gattserverdisconnected", function() {
          if (flashing || window.Vexora.lastFlash) {
            log("ota", "link dropped");
            return;
          }
          if (phase === "idle") return;
          hardClose("BLE dropped");
        });
      }
      phase = "live";
      paint();
      log("ok", "Connected");
      banner("");
      startPoll();
      if (window.VexoraLive) VexoraLive.setSession(session); else log("err", "Tune module missing — reload");
      if (window.Vexora && Vexora.verifyPending) {
        banner(window.I18N && I18N.t("verifyWait") || "Reconnect to verify firmware.", true);
        setTimeout(async () => {
          try {
            const b = await withBle(() => session && session.readRegister(X.VCU, 23, 2, 1200));
            if (b) banner(window.I18N && I18N.t("verifyOk") || "Post-flash verify OK", true);
          } catch (e) {}
          Vexora.verifyPending = null;
        }, 1500);
      }
      dash("#vName", session.bleName || "—");
      try {
        if (session.ble && session.ble.id) localStorage.setItem("vexora.ble.id", session.ble.id);
      } catch (e) {}
    } catch (e) {
      if (gen !== connectGen) return;
      const m = e.message || String(e);
      const cancelled = e.name === "NotFoundError" || /cancel|chooser|User cancelled/i.test(m);
      const blocked = e.name === "SecurityError" || e.name === "NotAllowedError" || /user gesture/i.test(m);
      log(cancelled && !blocked ? "hs" : "err", m);
      if (cancelled || blocked) {
        await hardClose("");
        if (e.name === "NotFoundError") {
          idleHint(any ? "Nothing chosen. Wake your scooter and close the Segway app, then try again." : "No scooter found. Wake your scooter (press its power button), close the Segway app, or press Any BLE.");
        } else if (blocked) {
          idleHint("Chrome blocked the picker. Tap Connect again.");
        }
      } else {
        await hardClose(m);
      }
    } finally {
      if (gen === connectGen) connecting = false;
    }
  }
  async function hardClose(reason) {
    if (flashing) return;
    connectGen += 1;
    connecting = false;
    stopPoll();
    const wasLive = phase === "live" || phase === "pairing";
    try {
      if (window.CfwFlasher && CfwFlasher.abortConnect) CfwFlasher.abortConnect();
    } catch (e) {}
    try {
      if (session && session.close) session.close();
    } catch (e) {}
    try {
      if (session && session.demo && session.demo.disconnect) session.demo.disconnect();
    } catch (e) {}
    session = null;
    phase = "idle";
    pair.power = false;
    if (window.VexoraLive) VexoraLive.setSession(null);
    clearDash();
    paint();
    const quiet = !reason || /cancel|session closed|User cancelled|chooser|NotFound/i.test(reason);
    if (reason && wasLive && !quiet) {
      banner("Disconnected · " + reason);
      if ($("#gateTitle")) $("#gateTitle").textContent = "Connect";
      idleHint(reason);
      log("err", "drop: " + reason);
    } else {
      banner("");
      if ($("#gateTitle")) $("#gateTitle").textContent = "Connect";
      idleHint("");
    }
  }
  function otaUI(title, detail, pct, sent, total) {
    const ov = $("#otaOverlay");
    if (!ov) return;
    ov.hidden = false;
    if ($("#otaTitle") && title) $("#otaTitle").textContent = title;
    if (detail != null && $("#otaDetail")) $("#otaDetail").textContent = detail;
    if (pct != null) {
      if ($("#otaBar")) $("#otaBar").style.width = pct + "%";
      if ($("#otaPct")) $("#otaPct").textContent = pct + "%";
    }
    if (sent != null && total != null && $("#otaKb")) {
      $("#otaKb").textContent = (sent / 1024).toFixed(1) + " / " + (total / 1024).toFixed(1) + " KB";
    }
  }
  function otaHide() {
    const ov = $("#otaOverlay");
    if (ov) ov.hidden = true;
    const rec = $("#otaReconnect");
    if (rec) rec.hidden = true;
  }
  async function flashCfw(kind, skipWarn) {
    if (flashing) return;
    if (scanning) return;
    if ((kind === "vcu-unlock" || kind === "mcu-unlock") && !skipWarn) {
      const w = window.I18N && I18N.t && I18N.t("unlockConfirm") || "This flashes the recovery image (restores the erased key). Use it only if your scooter stopped accepting flashes after an old stock restore. Keep an ST-Link ready just in case. Continue?";
      let go = true;
      try {
        go = window.confirm(w);
      } catch (e) {}
      if (!go) return;
    }
    const unlockDone = window.I18N && I18N.t && I18N.t("unlockDone") || "Recovered — the scooter accepts flashes again (vexora or SHU).";
    if (!window.VexoraCfw || !VexoraCfw.build) {
      log("err", "builder missing");
      return;
    }
    if (!window.CfwFlasher) {
      log("err", "flasher missing");
      return;
    }
    if (session && session.demo) {
      log("err", "Demo cannot flash");
      return;
    }
    flashing = true;
    stopPoll();
    try {
      await withBle(async () => {});
    } catch (e) {}
    banner("");
    otaUI("Building", (kind || "vcu").toUpperCase(), 0, 0, 0);
    try {
      const built = await VexoraCfw.build(kind);
      const enc = built.enc, part = built.part, total = enc.length;
      otaUI("Flashing " + part.toUpperCase(), "Starting", 0, 0, total);
      if (!session || session.dead || !session.request) {
        flashing = false;
        otaHide();
        await connect(false);
        flashing = true;
        stopPoll();
        try {
          await withBle(async () => {});
        } catch (e) {}
        if (!session || session.dead || !session.request) throw new Error("Connect first");
        otaUI("Flashing " + part.toUpperCase(), "Starting", 0, 0, total);
      }
      if (session.flushPending) session.flushPending();
      const phaseCopy = {
        starting: "Starting",
        flashing: "Writing",
        finalizing: "Checksum",
        resetting: "Reboot",
        "post-wait": "Waiting",
        retry: "Retrying",
        preparing: "Preparing",
        waking: "Waking the scooter",
        reconnecting: "Reconnecting",
        rebooting: "Rebooting",
        live: "Reconnected",
        done: "Done"
      };
      const flashed = await CfwFlasher.flash(part, enc, {
        session: session,
        onSession: s => {
          session = s;
          if (window.VexoraLive) VexoraLive.setSession(s);
        },
        onStatus: m => {
          otaUI(null, m);
          log("ota", m);
        },
        onPhase: ph => {
          otaUI(null, phaseCopy[ph] || ph);
        },
        onProgress: (d, t) => {
          const sent = Math.min(d * 128, total);
          const pct = Math.round(sent / total * 100);
          otaUI("Flashing " + part.toUpperCase(), "Writing", pct, sent, total);
        }
      });
      if (window.Vexora.markFlash) Vexora.markFlash(part); else window.Vexora.lastFlash = part;
      try {
        fetch("/api/flash-done", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            part: part,
            src: window.__vexoraFlashSource || ""
          })
        }).catch(() => {});
        window.__vexoraFlashSource = "";
      } catch (e) {}
      let back = null;
      const live = flashed || session;
      otaUI("Post-flash", "Rebooting · waiting for the scooter to restart…", 100, total, total);
      if (window.CfwFlasher && CfwFlasher.waitForUnit) {
        try {
          back = await CfwFlasher.waitForUnit(live, {
            onPhase: ph => otaUI(null, phaseCopy[ph] || ph),
            onStatus: m => log("ota", m)
          });
        } catch (e) {
          back = null;
        }
      }
      if (back && back.request) {
        session = back;
        if (window.VexoraLive) VexoraLive.setSession(back);
        phase = "live";
        flashing = false;
        startPoll();
        otaUI("Post-flash", "Reconnected.", 100, total, total);
        paint();
        idleHint(kind === "vcu-unlock" || kind === "mcu-unlock" ? unlockDone : "Flash done. Reconnected.");
        log("ota", "post-flash · reconnected");
        setTimeout(otaHide, 4e3);
        return;
      }
      otaUI("Post-flash", "Reconnect when the scooter is back.", 100, total, total);
      const rec = $("#otaReconnect");
      if (rec) rec.hidden = false;
      stopPoll();
      try {
        if (session && session.close) await session.close();
      } catch (e) {}
      session = null;
      phase = "idle";
      flashing = false;
      if (window.VexoraLive) VexoraLive.setSession(null);
      paint();
      if ($("#gateTitle")) $("#gateTitle").textContent = "Reconnect";
      idleHint(kind === "vcu-unlock" || kind === "mcu-unlock" ? unlockDone : "Flash done. Reconnect.");
      log("ota", "post-flash · reconnect");
    } catch (e) {
      const m = e.message || String(e);
      if (/requestDevice|SecurityError|NotAllowedError/i.test(m)) {
        otaUI("Post-flash", "Reconnect when the scooter is back.");
        const rec = $("#otaReconnect");
        if (rec) rec.hidden = false;
        flashing = false;
        log("ota", "post-flash · reconnect");
        return;
      }
      flashing = false;
      const linkGone = /disconnect|GATT|not connected|NetworkError|Connection lost|No device selected/i.test(m);
      if (linkGone) {
        otaUI("Connection lost", "Bluetooth dropped during the update. Power-cycle the scooter, then press Reconnect and flash again.");
        const rec = $("#otaReconnect");
        if (rec) rec.hidden = false;
      } else {
        otaUI("Failed", m);
      }
      log("err", m);
      setTimeout(otaHide, /ACK=|did not answer start|timeout dst|Pairing not confirmed|disconnect|GATT|Connection lost/i.test(m) ? 2e4 : 8e3);
    }
  }
  function hexOf(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += (u8[i] >> 4 & 15).toString(16) + (u8[i] & 15).toString(16);
    return s;
  }
  async function runHwScan() {
    if (scanning || flashing) return;
    const out = $("#hwScanOut");
    const say = m => {
      if (out) out.textContent = m;
    };
    if (!window.CfwFlasher) {
      log("err", "flasher.js missing");
      return;
    }
    if (!session || session.dead || !session.request) {
      banner(window.I18N && I18N.t && I18N.t("connectFirst") || "Connect the scooter first.");
      return;
    }
    if (session.demo) {
      banner("Demo cannot scan.");
      log("err", "scan: demo");
      return;
    }
    scanning = true;
    scanAbort = false;
    stopPoll();
    const refRaw = ($("#hwRefVcu") && $("#hwRefVcu").value || "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    const found = [];
    const matches = [];
    const dsts = [ [ X.VCU, "VCU" ], [ X.MCU, "MCU" ] ];
    const t0 = Date.now();
    let aborted = false;
    const probe = (dst, reg) => withBle(() => session.request({
      src: X.HOST,
      dst: dst,
      cmd: 1,
      arg: reg,
      data: new Uint8Array([ 16, 0 ])
    }, 180, {
      expectedCmd: [ 4 ]
    }));
    try {
      for (let d = 0; d < dsts.length && !aborted; d++) {
        const dst = dsts[d][0], name = dsts[d][1];
        for (let reg = 0; reg < 256 && !aborted; reg++) {
          if (scanAbort) {
            aborted = true;
            break;
          }
          if ((reg & 15) === 0) say(name + " " + reg + "/256 · " + found.length + " vals · tap to cancel");
          let r = null;
          try {
            r = await probe(dst, reg);
          } catch (e) {
            r = null;
          }
          if (r && r.data && r.data.length && r.arg === reg) {
            const hex = hexOf(r.data);
            found.push({
              dst: name,
              reg: reg,
              len: r.data.length,
              hex: hex
            });
            if (refRaw && hex.indexOf(refRaw) >= 0) matches.push(name + " reg 0x" + reg.toString(16) + " (" + r.data.length + " B)");
          }
        }
        for (let off = 0; off <= 240 && !aborted; off += 16) {
          if (scanAbort) {
            aborted = true;
            break;
          }
          let r = null;
          try {
            r = await withBle(() => session.calibRead(dst, off, 16, 180));
          } catch (e) {
            r = null;
          }
          if (r && r.length) {
            const hex = hexOf(r);
            found.push({
              dst: name,
              calib: off,
              len: r.length,
              hex: hex
            });
            if (refRaw && hex.indexOf(refRaw) >= 0) matches.push(name + " calib 0x" + off.toString(16) + " (" + r.length + " B)");
          }
        }
      }
    } catch (e) {
      aborted = true;
      say("Scan error: " + (e.message || e));
      log("err", "scan: " + (e.message || e));
    }
    scanning = false;
    if (phase === "live") startPoll();
    if (aborted && !found.length) {
      say("Scan cancelled.");
      return;
    }
    if (aborted) {
      say("Scan cancelled · " + found.length + " vals so far");
      return;
    }
    const secs = Math.round((Date.now() - t0) / 1e3);
    try {
      const rep = {
        app: "2.3.0",
        t: (new Date).toISOString(),
        sn: window.Vexora && Vexora.lastSn || "",
        ref: refRaw || null,
        results: found,
        matches: matches
      };
      const blob = new Blob([ JSON.stringify(rep, null, 1) ], {
        type: "application/json"
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "vexora-hwscan.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 2e3);
    } catch (e) {}
    const per = {};
    found.forEach(f => {
      per[f.dst] = (per[f.dst] || 0) + 1;
    });
    let msg = "Done (" + secs + "s): " + dsts.map(d => d[1] + " " + (per[d[1]] || 0) + " vals").join(" · ");
    if (refRaw) msg += matches.length ? " · MATCH: " + matches.join(", ") : " · ref UID not found";
    say(msg);
    log("ota", "hwscan: " + found.length + " vals in " + secs + "s" + (matches.length ? " · match " + matches.join(",") : ""));
    banner("");
  }
  window.Vexora.runHwScan = runHwScan;
  window.Vexora.isScanning = () => scanning;
  window.Vexora.abortHwScan = () => {
    scanAbort = true;
  };
  let pendingFlash = null;
  function flashSummary(kind) {
    if (window.VexoraCfw && VexoraCfw.summary) return VexoraCfw.summary(kind);
    return (kind || "vcu").toUpperCase();
  }
  function askFlash(kind) {
    pendingFlash = kind || "vcu";
    if (window.Vexora && Vexora.askPin && !Vexora.askPin()) return;
    const soc = window.Vexora && Vexora.lastSoc;
    if (Number.isFinite(soc) && soc < 30) {
      banner(window.I18N && I18N.t("socLow") || "Battery below 30%. Charge before flash.");
      log("err", "SOC " + soc);
      return;
    }
    const ov = $("#flashConfirm");
    if (!ov) {
      flashCfw(pendingFlash);
      return;
    }
    const uK = pendingFlash === "vcu-unlock" || pendingFlash === "mcu-unlock";
    const tr = (k, f) => window.I18N && I18N.t && I18N.t(k) || f;
    if ($("#fcTitle")) $("#fcTitle").textContent = pendingFlash === "mcu" ? "Flash MCU · motor CFW" : pendingFlash === "vcu" ? "Flash VCU" : pendingFlash === "mcu-unlock" ? "Restore MCU · compat" : "Restore VCU · compat";
    if ($("#fcDetail")) $("#fcDetail").textContent = uK ? tr("unlockHelp", "Stock compat image — the scooter stays flashable.") : flashSummary(pendingFlash);
    if ($("#fcWarn")) $("#fcWarn").textContent = uK ? tr("unlockWarn", "Compat stock image: the scooter stays flashable. As always, keep an ST-Link ready just in case.") : tr("notStock", "This is not stock firmware. The scooter will reboot.");
    if ($("#fcGo")) $("#fcGo").textContent = "Flash";
    const sn = window.Vexora && Vexora.lastSn || "";
    if ($("#fcSn")) $("#fcSn").textContent = sn ? "SN " + sn : "SN unknown · connect first";
    if ($("#fcKb")) $("#fcKb").textContent = "OTA · scooter reboots";
    ov.hidden = false;
    haptic(10);
  }
  window.Vexora.flashCfw = askFlash;
  window.Vexora.flashFile = part => doFlash(part);
  window.Vexora.showBan = function(reason) {
    if (document.getElementById("vexoraBanOverlay")) return;
    var tt = function(k, f) {
      return window.I18N && I18N.t && I18N.t(k) || f;
    };
    var esc = function(x) {
      return String(x == null ? "" : x).replace(/[&<>"']/g, function(c) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c];
      });
    };
    var ov = document.createElement("div");
    ov.id = "vexoraBanOverlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#070708;display:flex;align-items:center;justify-content:center;padding:24px;";
    ov.innerHTML = '<div style="max-width:420px;text-align:center">' + '<div style="width:54px;height:54px;margin:0 auto 14px;border-radius:14px;background:#161618;border:1px solid #323238;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800">V</div>' + '<h2 style="margin:0 0 10px;font-size:20px">' + esc(tt("banT", "Access restricted")) + "</h2>" + '<p style="color:#9a9aa3;font-size:14px;line-height:1.65;margin:0 0 6px">' + esc(tt("banP", "You are banned from Vexora. To be unbanned, contact the Vexora staff.")) + "</p>" + (reason ? '<p style="color:#f4f4f5;font-size:13px;margin:0 0 4px">✦ ' + esc(reason) + "</p>" : "") + '<a href="https://discord.gg/pFyFksUyA7" rel="noopener" style="display:inline-block;margin-top:14px;padding:11px 22px;border-radius:12px;background:#f4f4f5;color:#070708;font-weight:700;text-decoration:none;font-size:14px">' + esc(tt("banContact", "Contact staff · Discord")) + "</a>" + "</div>";
    document.body.appendChild(ov);
  };
  window.Vexora.showMaint = function() {
    var tt = function(k, f) {
      return window.I18N && I18N.t && I18N.t(k) || f;
    };
    var esc = function(x) {
      return String(x == null ? "" : x).replace(/[&<>"']/g, function(c) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c];
      });
    };
    var ov = document.getElementById("vexoraMaintOverlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "vexoraMaintOverlay";
      ov.style.cssText = "position:fixed;inset:0;z-index:2147482900;background:#070708;display:flex;align-items:center;justify-content:center;padding:24px;";
      ov.innerHTML = '<div style="max-width:420px;text-align:center">' + '<img src="assets/mark.png" alt="Vexora" style="height:44px;margin:0 auto 16px;display:block">' + '<h2 style="margin:0 0 10px;font-size:20px;color:#f4f4f5">' + esc(tt("maintT", "Under maintenance")) + "</h2>" + '<p style="color:#9a9aa3;font-size:14px;line-height:1.65;margin:0 0 18px">' + esc(tt("maintP", "We’re updating a few things — we’ll be back in a few hours.")) + "</p>" + '<button type="button" id="vexoraMaintRetry" style="padding:11px 22px;border-radius:12px;background:#f4f4f5;color:#070708;font-weight:700;border:0;font-size:14px">' + esc(tt("maintRetry", "Retry")) + "</button>" + '<br><a href="/founder/oauth/start" style="display:inline-block;margin-top:16px;color:#9a9aa3;font-size:13px">' + esc(tt("maintFounder", "Founder login")) + "</a>" + "</div>";
      document.body.appendChild(ov);
      ov.addEventListener("click", function(e) {
        if (e.target && e.target.id === "vexoraMaintRetry") location.reload();
      });
    }
    ov.style.display = "flex";
  };
  window.Vexora.hideMaint = function() {
    var ov = document.getElementById("vexoraMaintOverlay");
    if (ov) ov.style.display = "none";
  };
  window.Vexora.model = "g3";
  try {
    const qTune = new URLSearchParams(location.search).get("tune");
    if (qTune) {
      history.replaceState(null, "", location.pathname);
      setTimeout(() => {
        try {
          if (window.VexoraCfw && VexoraCfw.applyTune && VexoraCfw.applyTune(qTune)) vexToast(tr96("tuneLoaded", {}) || "Shared tune loaded");
        } catch (e) {}
      }, 600);
    }
  } catch (e) {}
  window.Vexora.setModel = setModel;
  on("#fcCancel", "click", () => {
    pendingFlash = null;
    if ($("#flashConfirm")) $("#flashConfirm").hidden = true;
  });
  on("#fcGo", "click", () => {
    const k = pendingFlash;
    pendingFlash = null;
    if ($("#flashConfirm")) $("#flashConfirm").hidden = true;
    if (k) {
      haptic(20);
      flashCfw(k, true);
    }
  });
  function u8b64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return btoa(s);
  }
  async function preFlashCheck(bytes, part) {
    const el = $("#preFlash");
    if (!el) return;
    el.hidden = true;
    try {
      const r = await fetch("/api/report", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "build.bin",
          data: u8b64(bytes)
        })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) return;
      const kv = [];
      if (j.type) kv.push(String(j.type).toUpperCase() + (j.ver ? " " + j.ver : ""));
      const p = j.params || {};
      if (p.engage != null) kv.push("engage " + p.engage + " A");
      if (p.iqFwA != null) kv.push("iqFW " + p.iqFwA + " A");
      if (p.scale != null) kv.push("scale " + p.scale);
      if (p.ecoKmh != null) kv.push("ECO " + p.ecoKmh);
      if (p.driveKmh != null) kv.push("DRV " + p.driveKmh);
      if (p.sportKmh != null) kv.push("SPT " + p.sportKmh);
      if (j.diff && j.diff.bytes != null) kv.push((tr96("pfDiff", {}) || "diff") + " " + j.diff.bytes + " B");
      if (!kv.length) return;
      el.textContent = (tr96("preFlashT", {}) || "Pre-flash check") + " · " + kv.join(" · ");
      el.hidden = false;
    } catch (e) {}
  }
  async function doFlash(part) {
    const bytes = window.lastBuiltFirmwareEnc;
    const usePart = part || window.lastBuiltPartition || "mcu";
    if (!bytes) {
      if ($("#flashStatus")) $("#flashStatus").textContent = "Export CFW or load a ZIP first.";
      return;
    }
    if (!window.CfwFlasher) {
      log("err", "flasher missing");
      return;
    }
    if (window.__vexoraTestSession) session = window.__vexoraTestSession;
    if (!session || session.dead || !session.request || session.demo) {
      if ($("#flashStatus")) $("#flashStatus").textContent = "Connecting…";
      await connect(false);
    }
    if (!session || session.dead || !session.request || session.demo) {
      if ($("#flashStatus")) $("#flashStatus").textContent = "Connect first.";
      return;
    }
    const phaseCopy = {
      starting: "Starting",
      flashing: "Writing",
      finalizing: "Checksum",
      resetting: "Reboot",
      "post-wait": "Waiting",
      retry: "Retrying",
      preparing: "Preparing",
      waking: "Waking the scooter",
      reconnecting: "Reconnecting",
      rebooting: "Reboot",
      done: "Done"
    };
    preFlashCheck(bytes, usePart).catch(() => {});
    otaUI("Flashing " + usePart.toUpperCase(), "Starting", 0, 0, bytes.length);
    try {
      const flashedSession = await CfwFlasher.flash(usePart, bytes, {
        session: session,
        onStatus: m => {
          otaUI(null, m);
          if ($("#flashStatus")) $("#flashStatus").textContent = m;
          log("ota", m);
        },
        onPhase: ph => otaUI(null, phaseCopy[ph] || ph),
        onProgress: (d, t) => {
          const pct = Math.max(1, Math.min(100, Math.round(d / t * 100)));
          otaUI("Flashing " + usePart.toUpperCase(), "Writing", pct, Math.min(d * 128, bytes.length), bytes.length);
          if ($("#flashBar")) $("#flashBar").style.width = pct + "%";
        }
      });
      if (flashedSession && flashedSession.request) {
        session = flashedSession;
        if (window.VexoraLive) VexoraLive.setSession(session);
      }
      otaUI("Post-flash", "Done. Scooter reboots.", 100, bytes.length, bytes.length);
      if ($("#flashStatus")) $("#flashStatus").textContent = "Done. Scooter reboots.";
      window.__vexoraTireVerify = null;
      if (window.__vexoraFlashSource === "tire" && flashedSession && flashedSession.request && window.CfwFlasher && CfwFlasher.waitForUnit) {
        try {
          otaUI("Verifying", "Checking what’s on your scooter…");
          if ($("#flashStatus")) $("#flashStatus").textContent = "Verifying…";
          const back = await CfwFlasher.waitForUnit(flashedSession, {
            totalMs: 45e3
          });
          if (back && back.request) {
            session = back;
            if (window.VexoraLive) VexoraLive.setSession(back);
            let raw = null;
            try {
              raw = await back.readRegister(X.VCU, 24, 2, 900);
            } catch (e) {}
            if (!raw || raw.length < 2) {
              try {
                raw = await back.readRegister(X.MCU, 25, 2, 800);
              } catch (e) {}
            }
            if (raw && raw.length >= 2) {
              const o = [];
              let n = (raw[0] | raw[1] << 8) >>> 0;
              do {
                o.unshift(n & 15);
                n >>>= 4;
              } while (n > 0 || o.length < 3);
              window.__vexoraTireVerify = {
                version: o.join(".")
              };
            }
            otaUI("Post-flash", "Done. Scooter reboots.", 100, bytes.length, bytes.length);
            if ($("#flashStatus")) $("#flashStatus").textContent = "Done. Scooter reboots.";
          }
        } catch (e) {
          log("ota", "verify skipped: " + (e && e.message));
        }
      }
      setTimeout(otaHide, 3500);
      return flashedSession;
    } catch (e) {
      const m = e.message || String(e);
      const linkGone = /disconnect|not connected|NetworkError|Connection (closed|lost)|No device selected/i.test(m);
      otaUI(linkGone ? "Connection lost" : "Failed", linkGone ? "Bluetooth dropped during the update. Turn it off and on, reconnect and flash again." : m);
      if ($("#flashStatus")) $("#flashStatus").textContent = m;
      log("err", m);
      setTimeout(otaHide, /ACK=|did not answer start|timeout dst|Pairing not confirmed|disconnect|Connection lost/i.test(m) ? 2e4 : 8e3);
    }
  }
  async function loadFlashFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const encFile = zip.file("FIRM.bin.enc") || zip.file(/FIRM\.bin\.enc$/i)[0];
      if (!encFile) throw new Error("No FIRM.bin.enc");
      window.lastBuiltFirmwareEnc = new Uint8Array(await encFile.async("arraybuffer"));
      const info = zip.file("info.json");
      if (info) {
        try {
          const j = JSON.parse(await info.async("string"));
          const t = (j.firmware && j.firmware.type || "").toLowerCase();
          if ([ "vcu", "mcu", "ble", "bms" ].includes(t)) window.lastBuiltPartition = t;
        } catch (e) {}
      }
    } else {
      window.lastBuiltFirmwareEnc = new Uint8Array(await file.arrayBuffer());
    }
    paint();
    log("ok", "Firmware " + window.lastBuiltFirmwareEnc.length + " B");
  }
  async function inspectZip(file) {
    const out = $("#forgeOut");
    if (!out) return;
    try {
      const report = await ZIP3.parseZip(await file.arrayBuffer(), file.name);
      const fw = report.fw || {};
      out.textContent = (report.ok ? "OK\n" : "ERRORS\n") + "name: " + (fw.displayName || "—") + "\n" + "type: " + (fw.type || "—") + "  model: " + (fw.model || "—") + "\n" + "compatible: " + ((fw.compatible || []).join(", ") || "—") + "\n" + "md5 enc: " + (report.computed.enc || "—") + "\n" + "bytes: " + (report.enc && report.enc.length || 0) + "\n" + (report.issues || []).map(i => i.level + ": " + i.msg).join("\n");
    } catch (e) {
      out.textContent = "Unreadable: " + e.message;
    }
  }
  {
    const repFile = $("#repFile");
    if (repFile) {
      on("#btnRepPick", "click", () => repFile.click());
      repFile.addEventListener("change", async () => {
        const f = repFile.files && repFile.files[0];
        const repOut = $("#repOut"), repDl = $("#repDl");
        if (!f || !repOut) return;
        const tg = (k, v) => window.I18N && I18N.t ? I18N.t(k, v) : null;
        repOut.hidden = false;
        if (repDl) repDl.hidden = true;
        repOut.textContent = tg("repWork") || "Analyzing…";
        try {
          let bins = [];
          if (/\.zip$/i.test(f.name)) {
            if (!window.JSZip) throw new Error("no zip support");
            const zf = await JSZip.loadAsync(await f.arrayBuffer());
            const names = Object.keys(zf.files).filter(n => /\.bin$/i.test(n)).slice(0, 3);
            for (const n of names) bins.push({
              name: n,
              data: await zf.files[n].async("uint8array")
            });
          } else bins = [ {
            name: f.name,
            data: new Uint8Array(await f.arrayBuffer())
          } ];
          if (!bins.length) throw new Error(tg("repNoBin") || "No .bin found inside that zip");
          const lines = [];
          let last = null;
          for (const b of bins) {
            const r = await (await fetch("/api/report", {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                name: b.name,
                data: bytesToB64(b.data)
              })
            })).json();
            if (!r || r.ok === false) throw new Error(r && r.error || "report failed");
            last = r;
            lines.push(repText(r, tg));
          }
          repOut.textContent = lines.join("\n\n");
          if (last && repDl) {
            if (repDl.href && repDl.href.indexOf("blob:") === 0) URL.revokeObjectURL(repDl.href);
            repDl.href = URL.createObjectURL(new Blob([ JSON.stringify(last, null, 2) ], {
              type: "application/json"
            }));
            repDl.hidden = false;
          }
        } catch (e) {
          repOut.textContent = tg("repErr", {
            m: e && e.message || ""
          }) || "Could not analyze: " + (e && e.message || "");
        }
        repFile.value = "";
      });
    }
  }
  function bytesToB64(bytes) {
    let bin = "";
    const CH = 8192;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function repText(r, tg) {
    const head = (r.model || "?").toUpperCase() + " · " + (r.type || "?").toUpperCase() + " " + (r.ver || "");
    let p = "";
    if (r.params) {
      if (r.type === "mcu") p = "engage " + r.params.engage + " A · iqFW " + r.params.iqFwA + " A · scale " + r.params.scale + (r.params.peakA ? " · peak " + r.params.peakA + " A" : ""); else p = "eco " + r.params.ecoKmh + " · drive " + r.params.driveKmh + " · sport " + r.params.sportKmh + " km/h";
    } else p = "?";
    const diffLine = r.diff ? tg("repDiffLine", {
      v: r.stockVer || "?",
      b: r.diff.bytes,
      p: r.diff.pct
    }) || "vs stock " + (r.stockVer || "?") + ": " + r.diff.bytes + " bytes (" + r.diff.pct + "%)" : "";
    const regs = (r.diff && r.diff.regions || []).filter(x => x.name).map(x => x.name + " @" + x.off).slice(0, 8);
    const unlock = r.unlockKey ? tg("repKey") || "unlock key: present" : "";
    return [ head, p, diffLine, regs.length ? regs.join(" · ") : "", unlock, (r.notes || []).join(" ") ].filter(Boolean).join("\n");
  }
  {
    const btn = $("#btnWzGo");
    if (btn) {
      const tg = (k, v) => window.I18N && I18N.t ? I18N.t(k, v) : null;
      on("#btnWzGo", "click", () => {
        const feel = ($("#wzFeel") || {}).value || "balanced";
        const rng = ($("#wzRange") || {}).value || "no";
        const spd = ($("#wzSpeed") || {}).value || "no";
        let engage = 28, cap = 115, scale = 2300;
        if (feel === "chill") {
          engage = 30;
          cap = 45;
          scale = 1400;
        }
        if (feel === "punch") {
          engage = 26;
          cap = 135;
          scale = 2600;
        }
        if (rng === "yes") {
          if (feel === "chill") {
            cap = 35;
            scale = 1200;
          } else if (feel === "balanced") {
            cap = 90;
            scale = 1900;
          } else {
            cap = 120;
            scale = 2400;
          }
        }
        if (spd === "yes") cap = Math.min(150, cap + 25);
        const out = $("#wzOut"), acts = $("#wzActs");
        window.__wz = {
          engage: engage,
          cap: cap,
          scale: scale
        };
        if (out) {
          out.hidden = false;
          out.textContent = (tg("wzRes", {
            e: engage,
            c: cap,
            s: scale
          }) || "Suggested · engage " + engage + " A · iqFW " + cap + " A · scale " + scale) + (spd === "yes" ? tg("wzTopW") || "" : "") + (feel === "punch" ? tg("wzHeatW") || "" : "");
        }
        if (acts) acts.hidden = false;
      });
      on("#btnWzMotor", "click", () => {
        const w = window.__wz;
        if (!w) return;
        try {
          localStorage.setItem("vexora.wz", JSON.stringify(w));
        } catch (e) {}
        const nav = document.querySelector('[data-view="motor"]');
        if (nav) nav.click();
      });
      on("#btnWzAi", "click", () => {
        const w = window.__wz;
        if (!w) return;
        const feel = ($("#wzFeel") || {}).value || "balanced";
        const rng = ($("#wzRange") || {}).value || "no";
        const spd = ($("#wzSpeed") || {}).value || "no";
        const bub = $("#vcw-bub"), inp = $("#vcw-in");
        if (bub) bub.click();
        if (inp) {
          inp.value = "My rider profile: feel=" + feel + ", range priority=" + rng + ", top speed over legal=" + spd + ". Wizard suggested: engage " + w.engage + " A, iqFW " + w.cap + " A, scale " + w.scale + ". Explain the trade-offs and suggest fine-tuning for me.";
          inp.focus();
        }
      });
    }
  }
  {
    const tokKey = "vexora.riderTok", meKey = "vexora.riderMe";
    const ls = {
      get(k) {
        try {
          return localStorage.getItem(k);
        } catch (e) {
          return null;
        }
      },
      set(k, v) {
        try {
          localStorage.setItem(k, v);
        } catch (e) {}
      },
      del(k) {
        try {
          localStorage.removeItem(k);
        } catch (e) {}
      }
    };
    let dmTimer = null, dmPeer = "", dmBlocked = false;
    const tg = k => window.I18N && I18N.t ? I18N.t(k) : k;
    function note(msg, isErr) {
      const el = $("#ridMsg");
      if (!el) return;
      el.hidden = !msg;
      el.textContent = msg || "";
      el.className = "note" + (isErr ? " saved-err" : " saved-ok");
    }
    function rapi(path, opts) {
      opts = opts || {};
      opts.headers = Object.assign({
        "content-type": "application/json"
      }, ls.get(tokKey) ? {
        "x-rider-token": ls.get(tokKey)
      } : {}, opts.headers || {});
      return fetch(path, opts).then(r => r.json().then(j => ({
        status: r.status,
        body: j
      })).catch(() => ({
        status: r.status,
        body: null
      })));
    }
    const RID_PANES = [ "ridFormReg1", "ridFormReg2", "ridFormReg3", "ridFormLogin", "ridFormVerify", "ridFormReset" ];
    function showPane(which) {
      RID_PANES.forEach(id => {
        const el = $("#" + id);
        if (el) el.hidden = id !== which;
      });
      const t = $("#ridStepT");
      if (t) t.textContent = which === "ridFormLogin" || which === "ridFormReset" ? tg("ridLoginT") || "Sign in" : tg("ridCreateT") || "Create your account";
      const SUBS = {
        ridFormReg1: "ridStep1Sub",
        ridFormReg2: "ridStep2Sub",
        ridFormReg3: "ridStep3Sub",
        ridFormLogin: "ridLoginSub",
        ridFormVerify: "ridVerifyHint",
        ridFormReset: "ridResetHint"
      };
      const ss = $("#ridStepSub");
      if (ss) ss.textContent = tg(SUBS[which] || "") || "";
      const alt = $("#ridAltLink");
      if (alt) {
        const loginMode = which === "ridFormLogin" || which === "ridFormReset";
        alt.textContent = loginMode ? tg("ridNewQ") || "New to Vexora? Create account" : tg("ridHaveQ") || "Already have an account? Sign in";
      }
      note("");
    }
    function showForm(which) {
      showPane(which);
    }
    function setLogged(name) {
      const lo = $("#ridLogged"), fo = $("#ridForms");
      if (!lo || !fo) return;
      lo.hidden = !name;
      fo.hidden = !!name;
      if (name) {
        const w = $("#ridWho");
        if (w) w.textContent = "@" + name;
      }
      if (!name) {
        ls.del(tokKey);
        ls.del(meKey);
      }
    }
    function onVerifyNeeded(name) {
      ls.set("vexora.riderPending", name);
      showForm("ridFormVerify");
      note(tg("ridVerifyHint"));
    }
    function afterAuth(r) {
      if (r.status === 200 && r.body && r.body.ok && r.body.token) {
        ls.set(tokKey, r.body.token);
        ls.set(meKey, r.body.name || "");
        setLogged(r.body.name || "");
        ls.del("vexora.riderPending");
        note("");
        findRiders("");
      } else {
        note(r.body && r.body.error || "Error", true);
        if (r.body && r.body.needVerify) onVerifyNeeded($("#ridName") ? $("#ridName").value.trim() : ls.get("vexora.riderPending") || "");
      }
    }
    const on = (sel, ev, fn) => {
      const el = $(sel);
      if (el) el.addEventListener(ev, fn);
    };
    on("#btnRidLogin", "click", () => rapi("/api/riders/login", {
      method: "POST",
      body: JSON.stringify({
        name: ($("#ridName") || {}).value,
        pw: ($("#ridPass") || {}).value
      })
    }).then(afterAuth));
    on("#btnRidReg", "click", () => {
      rapi("/api/riders/register", {
        method: "POST",
        body: JSON.stringify({
          name: ($("#ridRegName") || {}).value,
          mail: ($("#ridRegMail") || {}).value,
          pw: ($("#ridRegPass") || {}).value
        })
      }).then(r => {
        if (r.status === 200 && r.body && r.body.ok) onVerifyNeeded(($("#ridRegName") || {}).value.trim()); else note(r.body && r.body.error || "Error", true);
      });
    });
    on("#btnRidVerify", "click", () => rapi("/api/riders/verify", {
      method: "POST",
      body: JSON.stringify({
        name: ls.get("vexora.riderPending") || ($("#ridName") || {}).value,
        code: ($("#ridVerCode") || {}).value
      })
    }).then(r => {
      afterAuth(r);
      if (r.status === 200 && r.body && r.body.ok && r.body.token) setTimeout(() => {
        location.href = "/community/";
      }, 500);
    }));
    let ridCdTimer = null;
    function ridCooldown(sec) {
      const btn = $("#btnRidResend");
      if (!btn) return;
      clearInterval(ridCdTimer);
      let left = sec;
      btn.disabled = true;
      const base = tg("ridResend") || "Resend code";
      btn.textContent = base + " · " + left + "s";
      ridCdTimer = setInterval(() => {
        left--;
        if (left <= 0) {
          clearInterval(ridCdTimer);
          btn.disabled = false;
          btn.textContent = base;
          return;
        }
        btn.textContent = base + " · " + left + "s";
      }, 1e3);
    }
    on("#btnRidResend", "click", () => rapi("/api/riders/resend", {
      method: "POST",
      body: JSON.stringify({
        name: ls.get("vexora.riderPending") || ($("#ridName") || {}).value
      })
    }).then(r => {
      if (r.status === 429 && r.body && r.body.wait) ridCooldown(r.body.wait); else if (r.body && r.body.ok) note(tg("ridVerifyHint")); else note(r.body && r.body.error || "Error", true);
    }));
    on("#btnRidResetReq", "click", () => {
      rapi("/api/riders/reset-request", {
        method: "POST",
        body: JSON.stringify({
          mail: ($("#ridResetMail") || {}).value
        })
      }).then(r => {
        if (r.status === 200 && r.body && r.body.ok) {
          $("#btnRidResetReq").hidden = true;
          const go = $("#btnRidResetGo");
          if (go) go.hidden = false;
          note(tg("ridVerifyHint"));
        } else note(r.body && r.body.error || "Error", true);
      });
    });
    on("#btnRidResetGo", "click", () => rapi("/api/riders/reset-confirm", {
      method: "POST",
      body: JSON.stringify({
        mail: ($("#ridResetMail") || {}).value,
        code: ($("#ridResetCode") || {}).value,
        pw: ($("#ridResetPass") || {}).value
      })
    }).then(afterAuth));
    on("#btnRidLogout", "click", () => {
      setLogged(null);
      stopDm();
      renderRiders(null);
    });
    on("#btnRidNext1", "click", () => {
      const nm = (($("#ridRegName") || {}).value || "").trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(nm)) {
        note(tg("ridNameBad") || "3-20 letters, numbers or _", true);
        return;
      }
      note("");
      showPane("ridFormReg2");
      const pw = $("#ridRegPass");
      if (pw) {
        pw.value = "";
        pw.focus();
      }
    });
    on("#btnRidBack1", "click", () => showPane("ridFormReg1"));
    on("#btnRidNext2", "click", () => {
      const p1 = ($("#ridRegPass") || {}).value || "", p2 = ($("#ridRegPass2") || {}).value || "";
      if (p1.length < 8) {
        note(tg("ridPassShort") || "Use at least 8 characters", true);
        return;
      }
      if (p1 !== p2) {
        note(tg("ridPassNoMatch") || "Passwords don't match", true);
        return;
      }
      note("");
      showPane("ridFormReg3");
      const em = $("#ridRegMail");
      if (em) em.focus();
    });
    on("#btnRidBack2", "click", () => showPane("ridFormReg2"));
    on("#ridAltLink", "click", () => {
      const inLogin = !$("#ridFormLogin").hidden || !$("#ridFormReset").hidden;
      showPane(inLogin ? "ridFormReg1" : "ridFormLogin");
    });
    on("#btnRidGoLogin2", "click", () => showPane("ridFormLogin"));
    on("#btnRidGoReset", "click", () => showPane("ridFormReset"));
    function renderRiders(rows) {
      const el = $("#ridList");
      if (!el) return;
      el.innerHTML = rows && rows.length ? rows.map(r => "<div class='rider-row'><b>@" + String(r.name).replace(/[<>&]/g, "") + "</b><span class='hint'>" + new Date(r.since || Date.now()).getFullYear() + "</span><span style='flex:1'></span><button type='button' class='btn ghost sm' data-peer='" + String(r.key).replace(/[^a-z0-9_]/g, "") + "'>" + tg("ridChatT") + "</button></div>").join("") : "<p class='hint'>" + tg("ridSignInFirst") + "</p>";
    }
    function findRiders(q) {
      if (!ls.get(tokKey)) {
        renderRiders(null);
        return;
      }
      rapi("/api/riders/find?q=" + encodeURIComponent(q || "")).then(r => {
        if (r.status === 200 && r.body && r.body.ok) renderRiders(r.body.rows); else if (r.status === 401) {
          setLogged(null);
          renderRiders(null);
        }
      }).catch(() => {});
    }
    on("#ridFind", "input", function() {
      findRiders(this.value);
    });
    $("#ridList") && $("#ridList").addEventListener("click", e => {
      const b = e.target.closest ? e.target.closest("[data-peer]") : null;
      if (b) openDm(b.getAttribute("data-peer"));
    });
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;"
      }[c]));
    }
    function paintDm(r) {
      const box = $("#dmMsgs"), head = $("#dmWith"), card = $("#dmCard");
      if (!box) return;
      if (card) card.hidden = false;
      if (head) head.textContent = r.peer ? "· @" + r.peer : "";
      dmPeer = r.key || dmPeer;
      dmBlocked = !!r.blocked;
      const inp = $("#dmInput"), send = $("#btnDmSend");
      if (inp) inp.disabled = dmBlocked;
      if (send) send.disabled = dmBlocked;
      box.innerHTML = (r.msgs || []).map(m => {
        const pic = typeof m.msg === "string" && m.msg.indexOf("pic:") === 0 ? Number(m.msg.slice(5).replace(/[^0-9]/g, "")) : 0;
        const body = pic ? "<img class='dm-pic' src='/api/pic/" + pic + "' alt='photo' loading='lazy' />" : esc(m.msg);
        return "<div class='dm" + (m.mine ? " mine" : "") + "'>" + body + "<span class='t'>" + new Date(m.ts).toISOString().slice(5, 16).replace("T", " ") + "</span></div>";
      }).join("") || "<p class='hint'>" + (dmBlocked ? tg("ridBlock") : tg("ridDmHint")) + "</p>";
      box.scrollTop = box.scrollHeight;
      const bb = $("#btnDmBlock");
      if (bb) bb.textContent = tg("ridBlock");
    }
    function loadDm() {
      if (!dmPeer) return;
      rapi("/api/dms/" + dmPeer).then(r => {
        if (r.status === 200 && r.body && r.body.ok) paintDm(r.body); else if (r.status === 401) setLogged(null);
      }).catch(() => {});
    }
    function stopDm() {
      if (dmTimer) {
        clearInterval(dmTimer);
        dmTimer = null;
      }
      dmPeer = "";
      const c = $("#dmCard");
      if (c) c.hidden = true;
    }
    function openDm(peer) {
      const me = ls.get(meKey) || "";
      if (peer === me) {
        const box = $("#dmMsgs");
        if (box) box.innerHTML = "<p class='hint'>" + (tg("ridSelfDm") || "You can't chat with yourself.") + "</p>";
        const c = $("#dmCard");
        if (c) {
          c.hidden = false;
          try {
            c.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          } catch (e) {}
        }
        const head = $("#dmWith");
        if (head) head.textContent = "";
        return;
      }
      if (dmTimer) {
        clearInterval(dmTimer);
        dmTimer = null;
      }
      dmPeer = peer;
      const c = $("#dmCard");
      if (c) c.hidden = false;
      loadDm();
      dmTimer = setInterval(loadDm, 5e3);
      const bb = $("#btnDmBlock");
      if (bb) bb.textContent = tg("ridBlock");
      try {
        $("#dmCard").scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      } catch (e) {}
    }
    function sendDm() {
      const inp = $("#dmInput");
      if (!inp || !inp.value.trim() || !dmPeer) return;
      const msg = inp.value.trim();
      inp.value = "";
      rapi("/api/dms/" + dmPeer, {
        method: "POST",
        body: JSON.stringify({
          msg: msg
        })
      }).then(r => {
        if (r.status === 200 && r.body && r.body.ok) loadDm(); else {
          note(r.body && r.body.moderated ? tg("ridModerated") || "Message not sent — keep it respectful" : r.body && r.body.error || "Error", true);
          inp.value = msg;
          loadDm();
        }
      });
    }
    on("#btnDmSend", "click", sendDm);
    on("#btnDmPic", "click", () => {
      const f = $("#dmPicFile");
      if (f) f.click();
    });
    on("#dmPicFile", "change", function() {
      const file = this.files && this.files[0];
      this.value = "";
      if (!file || !dmPeer) return;
      const img = new Image;
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const max = 1024;
          let w = img.width || max, h = img.height || max;
          const k = Math.min(1, max / Math.max(w, h));
          w = Math.max(1, Math.round(w * k));
          h = Math.max(1, Math.round(h * k));
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          const data = cv.toDataURL("image/jpeg", .82);
          if (data.length > 38e4) {
            note(tg("ridPhotoBig") || "Photo too big", true);
            return;
          }
          rapi("/api/dms/" + dmPeer + "/pic", {
            method: "POST",
            body: JSON.stringify({
              img: data
            })
          }).then(r => {
            if (r.status === 200 && r.body && r.body.ok) loadDm(); else note(r.body && r.body.error || (tg("ridPhotoBig") || "Photo too big"), true);
          });
        } catch (e) {
          note(tg("ridPhotoBig") || "Photo too big", true);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        note(tg("ridPhotoBig") || "Photo too big", true);
      };
      img.src = url;
    });
    on("#dmInput", "keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendDm();
      }
    });
    on("#btnDmBlock", "click", () => {
      if (!dmPeer) return;
      rapi("/api/dms/" + dmPeer + (dmBlocked ? "/unblock" : "/block"), {
        method: "POST",
        body: "{}"
      }).then(() => loadDm());
    });
    on("#btnDmReport", "click", () => {
      if (!dmPeer) return;
      const card = $("#ridWhyCard"), title = $("#ridWhyTitle");
      if (!card) return;
      if (title) title.textContent = tg("ridReport") + " @" + dmPeer;
      const f = $("#ridWhyForm"), d = $("#ridWhyDone");
      if (f) f.hidden = false;
      if (d) d.hidden = true;
      const det = $("#ridWhyDetail");
      if (det) det.value = "";
      card.hidden = false;
      try {
        card.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      } catch (e) {}
    });
    on("#btnRidWhyCancel", "click", () => {
      const c = $("#ridWhyCard");
      if (c) c.hidden = true;
    });
    on("#btnRidWhyClose", "click", () => {
      const c = $("#ridWhyCard");
      if (c) c.hidden = true;
    });
    on("#btnRidWhySend", "click", () => {
      if (!dmPeer) return;
      const reason = ($("#ridWhyCard input[name=ridWhy]:checked") || {}).value || "other";
      const detail = (($("#ridWhyDetail") || {}).value || "").trim();
      rapi("/api/dms/report", {
        method: "POST",
        body: JSON.stringify({
          peer: dmPeer,
          reason: reason,
          detail: detail
        })
      }).then(r => {
        if (r.status === 200 && r.body && r.body.ok) {
          const f = $("#ridWhyForm"), d = $("#ridWhyDone");
          if (f) f.hidden = true;
          if (d) d.hidden = false;
        } else {
          const c = $("#ridWhyCard");
          if (c) c.hidden = true;
          note(r.body && r.body.error || "Error", true);
        }
      });
    });
    (function boot() {
      const applyPh = () => {
        window.document.querySelectorAll("[data-i18n-ph]").forEach(el => {
          el.setAttribute("placeholder", tg(el.getAttribute("data-i18n-ph")));
        });
      };
      applyPh();
      window.addEventListener("vexora-lang", applyPh);
      if (!ls.get(tokKey)) {
        renderRiders(null);
        return;
      }
      rapi("/api/riders/me").then(r => {
        if (r.status === 200 && r.body && r.body.ok) {
          setLogged(r.body.name);
          findRiders("");
        } else {
          setLogged(null);
          renderRiders(null);
        }
      }).catch(() => {});
    })();
  }
  on("#btnConnect", "click", () => scanGate());
  on("#btnReconnect", "click", () => connect("last"));
  on("#btnAny", "click", () => connect(true));
  on("#btnDemo", "click", async () => {
    if (typeof Sim === "undefined") {
      log("err", "no demo");
      return;
    }
    const client = Sim.create(s => {
      if (s.speed != null) {
        const kmh = Number(s.speed);
        dash("#vSpeed", kmh.toFixed(1));
        setGauge(kmh);
        tripSample(kmh, s.power != null ? Math.max(0, Number(s.power)) : null);
      }
      if (s.battery != null) setBattery(s.battery);
      if (s.limit != null) dash("#vLimit", s.limit + " km/h");
      if (s.range != null) dash("#vRange", Number(s.range).toFixed(1));
      if (s.odo != null) dash("#vOdo", Number(s.odo).toFixed(1));
      if (s.power != null) {
        const w = Math.max(0, Number(s.power));
        dash("#vPow", String(w));
        setGauge(Number.isFinite(Number(s.speed)) ? Number(s.speed) : lastKmh, w);
      }
      dash("#vName", "DEMO");
      dash("#vMode", "Eco");
    }, log);
    await client.connect();
    const fake = window.VexoraLive && VexoraLive.createDemo ? VexoraLive.createDemo() : {};
    session = Object.assign({
      close: () => client.disconnect(),
      bleName: "DEMO",
      demo: client
    }, fake);
    phase = "live";
    banner("");
    paint();
    if (window.VexoraLive) VexoraLive.setSession(session);
  });
  on("#btnTripRec", "click", () => {
    haptic(12);
    if (trip.rec) {
      trip.rec = false;
      trip.elapsed = trip.t0 ? Date.now() - trip.t0 : trip.elapsed;
      trip.prevT = 0;
      setWake(false);
      saveTrip();
    } else {
      trip.rec = true;
      if (!trip.t0) {
        trip.t0 = Date.now();
        trip.elapsed = 0;
        trip.dist = 0;
        trip.maxKmh = 0;
        trip.maxW = 0;
        trip.samples = [];
      } else {
        trip.t0 = Date.now() - (trip.elapsed || 0);
      }
      setWake(true);
    }
    paintTrip();
  });
  on("#btnTripReset", "click", () => resetTrip());
  on("#tripList", "click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const list = tripsAll();
    const vi = b.getAttribute("data-tview");
    const di = b.getAttribute("data-tdel");
    if (vi != null) {
      const t = list[Number(vi)];
      if (t) drawChart((t.samples || []).slice(-900), fmtTime(t.elapsed || 0) + " · " + Number(t.dist || 0).toFixed(2) + " km · " + Math.round(t.maxKmh || 0) + " km/h");
    }
    if (di != null) {
      list.splice(Number(di), 1);
      tripsSave(list);
      paintTrips();
    }
  });
  on("#btnTripsLive", "click", () => drawChart((trip.samples || []).slice(-900), tr96("tripLive", {}) || "Live"));
  on("#btnTripsJson", "click", () => dlFile("vexora-trips.json", "application/json", JSON.stringify(tripsAll(), null, 1)));
  on("#btnTripsCsv", "click", () => {
    const rows = [ "date,elapsed_s,dist_km,max_kmh,max_w" ];
    tripsAll().forEach(t => rows.push([ new Date(t.t0 || Date.now()).toISOString(), Math.round((t.elapsed || 0) / 1e3), Number(t.dist || 0).toFixed(3), t.maxKmh || 0, t.maxW || 0 ].join(",")));
    dlFile("vexora-trips.csv", "text/csv", rows.join("\n"));
  });
  on("#btnTripsClear", "click", () => {
    if (confirm(tr96("tripClearQ", {}) || "Delete ALL saved trips?")) {
      tripsSave([]);
      paintTrips();
      drawChart([], "");
    }
  });
  paintTrips();
  on("#btnTripCsv", "click", () => {
    const rows = [ [ "t", "kmh", "w" ] ];
    (trip.samples || []).forEach(p => {
      rows.push([ p.t || 0, p.s != null ? p.s : "", p.w != null ? p.w : "" ]);
    });
    rows.push([]);
    rows.push([ "elapsed_ms", trip.rec && trip.t0 ? Date.now() - trip.t0 : trip.elapsed ]);
    rows.push([ "dist_km", trip.dist || 0 ]);
    rows.push([ "max_kmh", trip.maxKmh || 0 ]);
    rows.push([ "max_w", trip.maxW || 0 ]);
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([ csv ], {
      type: "text/csv"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vexora-trip.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });
  on("#btnDisc", "click", () => hardClose(""));
  on("#btnCancelWait", "click", () => hardClose("cancelled"));
  on("#pairOverlay", "click", e => {
    if (e.target && e.target.id === "pairOverlay") hardClose("cancelled");
  });
  on("#otaReconnect", "click", () => {
    otaHide();
    const rec = $("#otaReconnect");
    if (rec) rec.hidden = true;
    connect(false);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && phase === "pairing") hardClose("cancelled");
  });
  const MODES = {
    police22: {
      eco: 10,
      drive: 16,
      sport: 22,
      unlock: false,
      label: "Police 22"
    },
    police25: {
      eco: 13,
      drive: 20,
      sport: 25,
      unlock: false,
      label: "Police 25"
    },
    race: {
      eco: 40,
      drive: 80,
      sport: 130,
      unlock: true,
      label: "Race"
    }
  };
  function markMode(id) {
    $$("[data-mode]").forEach(b => b.classList.toggle("is-on", b.getAttribute("data-mode") === id));
  }
  function setLimitSliders(eco, drive, sport) {
    if ($("#limEco")) $("#limEco").value = eco;
    if ($("#limEcoNum")) $("#limEcoNum").textContent = String(eco);
    if ($("#limDrive")) $("#limDrive").value = drive;
    if ($("#limDriveNum")) $("#limDriveNum").textContent = String(drive);
    if ($("#limRange")) $("#limRange").value = sport;
    if ($("#limNum")) $("#limNum").textContent = String(sport);
  }
  async function writeLimit(kmh, unlock, ecoIn, driveIn) {
    if (!session || !session.writeRegister) {
      const el = $("#limNote");
      if (el) {
        el.textContent = "Connect first.";
        el.className = "note err";
      }
      return;
    }
    kmh = Math.max(6, Math.min(130, Number(kmh) || 25));
    const eco = ecoIn != null ? ecoIn : Math.min(16, kmh);
    const drive = driveIn != null ? driveIn : Math.min(25, kmh);
    await withBle(async () => {
      if (window.VexoraLive && VexoraLive.setFlag) {
        try {
          await VexoraLive.setFlag("unlockSports", !!unlock);
        } catch (e) {}
      }
      if (unlock && session.flashWriteSlot) {
        try {
          let prof = null;
          if (session.flashReadSlot) {
            try {
              prof = await session.flashReadSlot(1, 16, 1200);
            } catch (e) {
              prof = null;
            }
          }
          const t = Math.min(kmh, 100);
          const b = prof && prof.length >= 16 ? Uint8Array.from(prof) : Uint8Array.from([ 25, 25, 0, t, 25, 25, 0, t, 0, 0, 0, 0, 0, 0, 0, 0 ]);
          b[3] = t;
          b[7] = t;
          await session.flashWriteSlot(1, b, 2e3);
        } catch (e) {}
      }
      await session.writeRegister(X.VCU, G3.ECO_DRIVE, Uint8Array.of(eco, drive));
      if (session.setCap) {
        try {
          await session.setCap(kmh);
        } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 150));
      await session.writeRegister(X.VCU, G3.SPORT, Uint8Array.of(kmh & 255, kmh >> 8 & 255));
      let got = null;
      try {
        const rb = await session.readRegister(X.VCU, G3.SPORT, 2, 1200);
        got = rb[0] | rb[1] << 8;
        if (got !== kmh) {
          await new Promise(r => setTimeout(r, 250));
          await session.writeRegister(X.VCU, G3.SPORT, Uint8Array.of(kmh & 255, kmh >> 8 & 255));
          const rb2 = await session.readRegister(X.VCU, G3.SPORT, 2, 1200);
          got = rb2[0] | rb2[1] << 8;
        }
      } catch (e) {}
      window.__lastLimitReadback = got;
    });
    limitDirty = false;
    dash("#vLimit", kmh + " km/h");
    const el = $("#limNote");
    const rb = window.__lastLimitReadback;
    if (el) {
      el.textContent = "Applied · " + eco + " / " + drive + " / " + kmh + (rb != null ? rb === kmh ? " · verified ✓" : " · ⚠ scooter keeps " + rb : "");
      el.className = "note ok";
    }
    log("ok", "limit " + kmh);
  }
  function bindLim(id, num) {
    on(id, "input", () => {
      limitDirty = true;
      if ($(num)) $(num).textContent = $(id).value;
    });
  }
  bindLim("#limEco", "#limEcoNum");
  bindLim("#limDrive", "#limDriveNum");
  on("#limRange", "input", () => {
    limitDirty = true;
    if ($("#limNum")) $("#limNum").textContent = $("#limRange").value;
  });
  $$("[data-mode]").forEach(b => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-mode");
    const m = MODES[id];
    if (!m) return;
    markMode(id);
    setLimitSliders(m.eco, m.drive, m.sport);
    try {
      await writeLimit(m.sport, m.unlock, m.eco, m.drive);
      haptic(12);
    } catch (e) {
      const el = $("#limNote");
      if (el) {
        el.textContent = "Failed · " + e.message;
        el.className = "note err";
      }
    }
  }));
  on("#btnApplyLim", "click", async () => {
    try {
      await writeLimit($("#limRange") && $("#limRange").value, true);
    } catch (e) {
      const el = $("#limNote");
      if (el) {
        el.textContent = "Failed · " + e.message;
        el.className = "note err";
      }
    }
  });
  on("#btnPickFlash", "click", () => {
    const i = $("#flashFile");
    if (i) i.click();
  });
  on("#btnPickForge", "click", () => {
    const i = $("#forgeFile");
    if (i) i.click();
  });
  on("#btnFlashMcu", "click", () => doFlash("mcu"));
  on("#btnFlashVcu", "click", () => doFlash("vcu"));
  on("#flashFile", "change", async e => {
    const f = e.target.files && e.target.files[0];
    if (f) try {
      await loadFlashFile(f);
    } catch (err) {
      log("err", err.message);
    }
  });
  const drop = $("#forgeDrop");
  if (drop) {
    [ "dragenter", "dragover" ].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault();
    }));
    drop.addEventListener("drop", e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) inspectZip(f);
    });
  }
  on("#forgeFile", "change", e => {
    const f = e.target.files && e.target.files[0];
    if (f) inspectZip(f);
  });
  (function legalGate() {
    const ov = $("#legalOverlay"), go = $("#legalGo"), count = $("#legalCount");
    if (!ov || !go) {
      document.body.classList.remove("is-legal");
      return;
    }
    let seen = false;
    try {
      seen = localStorage.getItem("vexora.legal2") === "1";
    } catch (e) {}
    if (seen) {
      ov.hidden = true;
      document.body.classList.remove("is-legal");
      return;
    }
    if (count) count.textContent = "Read this.";
    const agree = document.getElementById("legalAgree");
    let left = 10;
    let timerDone = false;
    function syncGo() {
      const ready = timerDone && (!agree || agree.checked);
      go.disabled = !ready;
      if (!timerDone) go.textContent = window.I18N ? I18N.t("waitN", {
        n: left
      }) : "Wait " + left; else go.textContent = window.I18N ? I18N.t("understand") : "I understand";
    }
    go.disabled = true;
    syncGo();
    const t = setInterval(() => {
      left -= 1;
      if (left > 0) {
        syncGo();
        return;
      }
      clearInterval(t);
      timerDone = true;
      syncGo();
    }, 1e3);
    if (agree) agree.addEventListener("change", syncGo);
    window.addEventListener("vexora-lang", syncGo);
    go.addEventListener("click", () => {
      if (go.disabled) return;
      ov.hidden = true;
      document.body.classList.remove("is-legal");
      try {
        localStorage.setItem("vexora.legal2", "1");
        localStorage.setItem("vexora.legal2.ts", String(Date.now()));
      } catch (e) {}
      try {
        if (localStorage.getItem("vexora.seen.230") !== "1") {
          const wn = document.getElementById("whatsNew");
          if (wn) wn.hidden = false;
        }
      } catch (e) {}
    });
  })();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  if (!navigator.bluetooth && $("#noBle")) $("#noBle").hidden = false;
  if ($("#appVer") && window.VEXORA) $("#appVer").textContent = VEXORA.app || VEXORA.vcu;
  if ($("#dWb")) {
    const v = window.VEXORA ? "Vexora " + (VEXORA.app || VEXORA.vcu) : "Vexora";
    $("#dWb").textContent = navigator.bluetooth ? v : v + " · no Web Bluetooth";
  }
  paint();
  setGauge(0);
  try {
    paintUnits();
    paintTrip();
  } catch (e) {
    console.error(e);
  }
  setInterval(() => {
    if (phase === "live") try {
      if (trip.rec && trip.t0) paintTrip();
      paintSess();
    } catch (e) {}
  }, 1e3);
  on("#btnUnit", "click", () => {
    imperial = !imperial;
    try {
      localStorage.setItem("vexora.unit", imperial ? "mi" : "km");
    } catch (e) {}
    paintUnits();
    paintSess();
    if (session && window.VexoraLive && VexoraLive.setFlag) {
      VexoraLive.setFlag("imperial", imperial).catch(() => {});
    }
  });
  on("#btnFs", "click", () => {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen();
    } catch (e) {}
  });
  on("#btnCopySn", "click", async () => {
    const sn = window.Vexora && Vexora.lastSn || ($("#liveSn") && $("#liveSn").textContent || "");
    if (!sn || sn === "—") return;
    try {
      await navigator.clipboard.writeText(sn);
      log("ok", "SN copied");
    } catch (e) {
      log("err", "copy");
    }
  });
  var MODEL_SHOT = {
    g3: "assets/models/g3.png",
    zt3: "assets/models/zt3.png",
    f3: "assets/models/f3.png",
    f3pro: "assets/models/f3.png",
    gt3: "assets/models/gt3.png",
    gt3pro: "assets/models/gt3pro.png",
    e3: "assets/models/e3.png",
    e3pro: "assets/models/e3pro.png"
  };
  function setModel(id) {
    if (!MODEL_SHOT[id]) return;
    window.Vexora.model = id;
    try {
      localStorage.setItem("vexora.model", id);
    } catch (e) {}
    Object.keys(MODEL_SHOT).forEach(function(m) {
      document.body.classList.toggle("model-" + m, id === m);
    });
    $$("#modelStrip .pick-card").forEach(b => {
      const m = b.getAttribute("data-model"), g = b.getAttribute("data-group");
      b.classList.toggle("is-on", m === id || !!g && (id === g || id === g + "pro"));
    });
    paintWhich(id);
    const shot = $("#gateShot");
    const next = MODEL_SHOT[id];
    if (shot && shot.getAttribute("src") !== next) {
      shot.classList.add("shot-swap");
      setTimeout(() => {
        shot.src = next;
        shot.classList.remove("shot-swap");
        void shot.offsetWidth;
        shot.classList.add("shot-in");
        setTimeout(() => shot.classList.remove("shot-in"), 560);
      }, 130);
    }
    try {
      window.dispatchEvent(new Event("vexora:model"));
    } catch (e) {}
  }
  const PICK_GROUPS = {
    f3: [ [ "f3", "F3" ], [ "f3pro", "F3 Pro" ] ],
    e3: [ [ "e3", "E3" ], [ "e3pro", "E3 Pro" ] ]
  };
  function groupOf(id) {
    return id === "f3" || id === "f3pro" ? "f3" : id === "e3" || id === "e3pro" ? "e3" : null;
  }
  function paintWhich(id) {
    const box = $("#pickWhich"), a = $("#whichA"), b = $("#whichB");
    if (!box || !a || !b) return;
    const g = groupOf(id);
    if (!g) {
      box.hidden = true;
      $$("#modelStrip .pick-card").forEach(c => c.classList.remove("is-open"));
      return;
    }
    const opts = PICK_GROUPS[g];
    a.textContent = opts[0][1];
    a.setAttribute("data-model", opts[0][0]);
    b.textContent = opts[1][1];
    b.setAttribute("data-model", opts[1][0]);
    a.classList.toggle("pick-on", id === opts[0][0]);
    b.classList.toggle("pick-on", id === opts[1][0]);
    box.hidden = false;
  }
  function openWhich(g) {
    const opts = PICK_GROUPS[g];
    if (!opts) return;
    const box = $("#pickWhich"), a = $("#whichA"), b = $("#whichB");
    if (!box) return;
    const cur = window.Vexora && Vexora.model || "";
    if (a) {
      a.textContent = opts[0][1];
      a.setAttribute("data-model", opts[0][0]);
      a.classList.toggle("pick-on", cur === opts[0][0]);
    }
    if (b) {
      b.textContent = opts[1][1];
      b.setAttribute("data-model", opts[1][0]);
      b.classList.toggle("pick-on", cur === opts[1][0]);
    }
    box.setAttribute("data-g", g);
    box.hidden = false;
    $$("#modelStrip .pick-card").forEach(c => c.classList.toggle("is-open", c.getAttribute("data-group") === g));
  }
  $$("#modelStrip .pick-card").forEach(c => {
    if (c.disabled) return;
    c.addEventListener("click", () => {
      const g = c.getAttribute("data-group");
      if (g) {
        const box = $("#pickWhich");
        if (box && !box.hidden && box.getAttribute("data-g") === g) {
          box.hidden = true;
          $$("#modelStrip .pick-card").forEach(c => c.classList.remove("is-open"));
          return;
        }
        openWhich(g);
        return;
      }
      setModel(c.getAttribute("data-model"));
    });
  });
  [ "#whichA", "#whichB" ].forEach(q => {
    const b = $(q);
    if (b) b.addEventListener("click", () => {
      const m = b.getAttribute("data-model");
      if (m) setModel(m);
    });
  });
  const pickStrip = $("#modelStrip");
  if (pickStrip) {
    const nav = dir => {
      const card = pickStrip.querySelector(".pick-card");
      const step = (card && card.offsetHeight || 54) + 6;
      try {
        pickStrip.scrollBy({
          top: dir * step * 2,
          behavior: "smooth"
        });
      } catch (e) {
        pickStrip.scrollTop += dir * step * 2;
      }
    };
    const pv = $("#pickPrev"), nx = $("#pickNext");
    if (pv) pv.addEventListener("click", () => nav(-1));
    if (nx) nx.addEventListener("click", () => nav(1));
  }
  const SCAN_PREFIX_MODEL = [ [ "1CG", "g3" ], [ "NBMax", "g3" ], [ "ZT", "zt3" ] ];
  function modelFromName(n) {
    const str = String(n || "");
    for (const pair of SCAN_PREFIX_MODEL) if (str.indexOf(pair[0]) === 0) return pair[1];
    return "";
  }
  function scanEls() {
    return {
      st: $("#scanStatus"),
      card: $("#foundCard"),
      img: $("#foundImg"),
      nm: $("#foundName"),
      sn: $("#foundSn")
    };
  }
  function scanT(k) {
    try {
      return window.I18N && I18N.t ? I18N.t(k) : k;
    } catch (e) {
      return k;
    }
  }
  function modelLabelOf(id) {
    const b = document.querySelector('#modelStrip .pick-card[data-model="' + id + '"] b');
    return b ? b.textContent : "";
  }
  async function scanGate() {
    if (document.body.classList.contains("is-legal")) return;
    const E = scanEls();
    if (E.card) E.card.hidden = true;
    if (!navigator.bluetooth) {
      if (E.st) E.st.textContent = scanT("chromeBle");
      const nb = $("#noBle");
      if (nb) nb.hidden = false;
      return;
    }
    if (E.st) E.st.textContent = scanT("scanScanning");
    let device = null;
    try {
      device = await CfwFlasher.pick();
    } catch (e) {
      const msg = (e && e.name ? e.name : "") + " " + (e && e.message ? e.message : "");
      if (E.st) E.st.textContent = /cancel|NotFoundError|chooser/i.test(msg) ? scanT("scanNone") : scanT("chromeBle");
      return;
    }
    showFound(device);
  }
  function showFound(device) {
    if (!device) return;
    const E = scanEls();
    const name = device.name || "";
    const id = modelFromName(name);
    if (id) {
      try {
        setModel(id);
      } catch (e) {}
    }
    if (E.img) E.img.src = id && MODEL_SHOT[id] || MODEL_SHOT[window.Vexora && window.Vexora.model || "g3"] || "assets/models/g3.png";
    if (E.nm) E.nm.textContent = id ? modelLabelOf(id) || id : name || scanT("unknownModel");
    if (E.sn) E.sn.textContent = name || "—";
    if (E.st) E.st.textContent = scanT("foundT");
    if (E.card) {
      E.card.hidden = false;
      const btn = $("#foundConnect");
      if (btn) btn.onclick = () => {
        E.card.hidden = true;
        connect(false, device);
      };
    }
    log("hs", "scan → " + (name || "device"));
  }
  try {
    setModel(localStorage.getItem("vexora.model") || "g3");
  } catch (e) {
    setModel("g3");
  }
  (function recallPaired() {
    setTimeout(() => {
      try {
        if (!CfwFlasher || !CfwFlasher.listPaired) return;
        Promise.resolve(CfwFlasher.listPaired()).then(list => {
          if (Array.isArray(list) && list.length) showFound(list[0]);
        }).catch(() => {});
      } catch (e) {}
    }, 600);
  })();
  log("boot", "Vexora " + (window.VEXORA && (VEXORA.app || VEXORA.vcu) || "1.1.9"));
  (async () => {
    try {
      if (window.CfwFlasher && CfwFlasher.listPaired) {
        const ds = await CfwFlasher.listPaired();
        if (ds && ds.length && $("#btnReconnect")) $("#btnReconnect").hidden = false;
      }
    } catch (e) {}
  })();
})();

(function Feedback() {
  const $ = s => document.querySelector(s);
  let rating = 0;
  let forced = false;
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  function paint(hover) {
    const cur = hover || rating;
    document.querySelectorAll("#fbFaces button").forEach(b => {
      const r = Number(b.dataset.r) || 0;
      b.classList.toggle("is-on", !!cur && r <= cur);
      b.classList.toggle("is-sel", !hover && !!rating && r === rating);
    });
  }
  function openFb(isForced) {
    const w = $("#fbWrap");
    if (!w) return;
    forced = !!isForced;
    rating = 0;
    paint();
    const m = $("#fbMsg");
    if (m) {
      m.value = "";
      m.placeholder = window.I18N && I18N.t && I18N.t("fbPh") || "Anything to add? (optional)";
    }
    const o = $("#fbOut");
    if (o) o.hidden = true;
    const form = $("#fbForm"), done = $("#fbDone"), cl = $("#fbClose");
    if (form) form.hidden = false;
    if (done) done.hidden = true;
    if (cl) cl.hidden = forced;
    w.classList.remove("fb-closing");
    w.hidden = false;
  }
  function closeFb() {
    const w = $("#fbWrap");
    if (!w || w.hidden) return;
    w.classList.add("fb-closing");
    setTimeout(() => {
      w.hidden = true;
      w.classList.remove("fb-closing");
    }, 240);
  }
  async function send() {
    const out = $("#fbOut");
    const t = (k, f) => window.I18N && I18N.t && I18N.t(k) || f;
    if (!rating) {
      if (out) {
        out.hidden = false;
        out.className = "note err";
        out.textContent = t("fbRate", "Tap the stars first.");
      }
      return;
    }
    const btn = $("#fbSend");
    if (btn) btn.disabled = true;
    try {
      let model = "";
      try {
        model = localStorage.getItem("vexora.model") || "";
      } catch (e) {}
      let how = "none";
      const V = window.Vexora;
      const sess = V && V.getSession && V.getSession();
      if (sess) how = sess.demo ? "demo" : "ble";
      const marks = V && V.marks || {};
      const fw = (marks.vcu ? "V" : "-") + (marks.mcu ? "M" : "-");
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          rating: rating,
          msg: (($("#fbMsg") || {}).value || "").slice(0, 600),
          model: model,
          how: how,
          fw: fw,
          lang: (navigator.language || "").slice(0, 8)
        })
      });
      const j = await r.json().catch(() => null);
      if (!(r.ok && j && j.ok)) throw new Error(j && j.error || r.status);
      lsSet("vexora.fbdone", "1");
      const form = $("#fbForm"), done = $("#fbDone");
      if (form) form.hidden = true;
      if (done) done.hidden = false;
      setTimeout(closeFb, 2400);
    } catch (err) {
      if (out) {
        out.hidden = false;
        out.className = "note err";
        out.textContent = t("fbErr", "Couldn't send — try again later.");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  document.addEventListener("mouseover", e => {
    if (!e.target || !e.target.closest) return;
    const f = e.target.closest("#fbFaces button");
    if (f) paint(Number(f.dataset.r) || 0);
  });
  document.addEventListener("mouseout", e => {
    if (e.target && e.target.closest && e.target.closest("#fbFaces")) paint();
  });
  document.addEventListener("click", e => {
    if (!e.target || !e.target.closest) return;
    if (e.target.id === "fbWrap" && !forced) {
      closeFb();
      return;
    }
    if (e.target.closest("#fbSend")) {
      send();
      return;
    }
    if (e.target.closest("#fbClose")) {
      closeFb();
      return;
    }
    const f = e.target.closest("#fbFaces button");
    if (f) {
      rating = Number(f.dataset.r) || 0;
      paint();
      return;
    }
    if (e.target.closest("#btnFeedback")) openFb(false);
  });
  {
    const d = $("#discOverlay");
    if (d && lsGet("vexora.disc") !== "1") {
      const okB = $("#discOk");
      if (okB) okB.addEventListener("click", () => {
        try {
          lsSet("vexora.disc", "1");
        } catch (e) {}
        d.style.display = "none";
      });
      const t = setInterval(() => {
        const l = $("#legalOverlay");
        const c = $("#consentBar");
        const legalGone = !l || l.hidden || l.style.display === "none";
        const consentGone = !c || c.hidden || c.style.display === "none";
        if (legalGone && consentGone) {
          clearInterval(t);
          d.style.display = "";
        }
      }, 400);
      setTimeout(() => clearInterval(t), 6e4);
    }
  }
  if (lsGet("vexora.fbdone") !== "1") setTimeout(() => {
    openFb(true);
  }, 600);
})();