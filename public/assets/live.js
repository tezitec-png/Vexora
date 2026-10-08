(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [ ...r.querySelectorAll(s) ];
  const X = {
    HOST: 62,
    VCU: 22,
    MCU: 2,
    BLE: 4,
    BMS: 7
  };
  const REG = {
    SN: 16,
    VCU_VER: 23,
    BIT_A: 29,
    BIT_B: 30,
    BIT_C: 31,
    DASH: 46,
    RANGE_DISP: 47,
    START: 66,
    ECO_DRIVE: 71,
    SPORT: 72,
    POWER_OFF: 73,
    CUSTOM_BTN: 74,
    MODE: 90,
    TAIL: 93,
    KERS: 112,
    VOL: 118,
    CHARGE: 130
  };
  const FLAG = {
    tcs: [ 29, 0 ],
    unlockSports: [ 29, 1 ],
    imperial: [ 29, 3 ],
    walkMode: [ 29, 4 ],
    parkOnSlope: [ 29, 5 ],
    boostFunc: [ 29, 10 ],
    turnSounds: [ 29, 11 ],
    alarm: [ 29, 15 ],
    appSounds: [ 30, 0 ],
    driveModeEn: [ 30, 7 ],
    sportsModeEn: [ 30, 8 ],
    autoHeadlight: [ 31, 0 ],
    tailBreathing: [ 31, 1 ],
    underglow: [ 31, 2 ],
    chargeNow: [ 31, 7 ],
    powerOffOnFold: [ 31, 8 ],
    disableAlarmOnFold: [ 31, 9 ],
    frontPositionLamp: [ 31, 11 ]
  };
  const BTN = {
    emergencyFlasher: 6,
    energyRecovery: 4,
    boost: 7,
    customSound: 8
  };
  function cbLabel(k) {
    const el = document.querySelector('[data-cbtn="' + k + '"]');
    return el ? el.textContent.trim() : k;
  }
  const STEP = {
    1: "Brake R",
    2: "Brake L",
    4: "Power",
    5: "Mode",
    6: "Signal L",
    7: "Signal R",
    8: "Custom"
  };
  const MODE = {
    1: "Walk",
    2: "Eco",
    5: "Drive",
    3: "Sport"
  };
  const DEF = {
    stdSpeed: 25,
    tunSpeed: 100,
    stdUnderglow: false,
    tunUnderglow: true,
    stdFrontBar: false,
    tunFrontBar: true,
    stdCruise: false,
    tunCruise: true,
    panicButton: true,
    beepOnEnterTun: true
  };
  let session = null;
  let pattern = [ 1, 2, 1, 2 ];
  let busy = false;
  let cfwKind = null;
  function log(tag, msg) {
    const box = $("#log");
    if (!box) return;
    const line = document.createElement("div");
    line.className = /fail|error|Timeout|rechaz|reject|cortad/i.test(String(msg)) ? "err" : tag === "ok" ? "ok" : "";
    line.textContent = (new Date).toLocaleTimeString("es-ES", {
      hour12: false
    }) + "  [" + tag + "]  " + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }
  function ready(msg) {
    const el = $("#liveReady");
    if (el) el.textContent = msg;
  }
  function note(id, msg) {
    const el = $(id);
    if (el) el.textContent = msg || "";
  }
  function u16(d) {
    return d && d.length >= 2 ? d[0] | d[1] << 8 : 0;
  }
  function packU16(n) {
    n &= 65535;
    return Uint8Array.of(n & 255, n >> 8);
  }
  function clamp(n, a, b) {
    n = Number(n) || 0;
    return Math.max(a, Math.min(b, Math.round(n)));
  }
  function verNibbles(w) {
    const out = [];
    let n = w >>> 0;
    do {
      out.unshift(n & 15);
      n >>>= 4;
    } while (n > 0 || out.length < 3);
    return out.join(".");
  }
  function decodeProfile(buf) {
    if (!buf || buf.length !== 16) throw new Error("perfil ≠ 16 B");
    return {
      stdSpeed: buf[0],
      tunSpeed: buf[3],
      stdUnderglow: !!buf[8],
      tunUnderglow: !!buf[9],
      stdFrontBar: !!buf[10],
      tunFrontBar: !!buf[11],
      stdCruise: !!buf[12],
      tunCruise: !!buf[13],
      panicButton: !!buf[14],
      beepOnEnterTun: !!buf[15]
    };
  }
  function encodeProfile(p) {
    const std = clamp(p.stdSpeed, 0, 100);
    const tun = clamp(p.tunSpeed, 0, 100);
    const b = new Uint8Array(16);
    b[0] = std;
    b[1] = std;
    b[2] = 0;
    b[3] = tun;
    b[4] = std;
    b[5] = std;
    b[6] = 0;
    b[7] = tun;
    b[8] = +!!p.stdUnderglow;
    b[9] = +!!p.tunUnderglow;
    b[10] = +!!p.stdFrontBar;
    b[11] = +!!p.tunFrontBar;
    b[12] = +!!p.stdCruise;
    b[13] = +!!p.tunCruise;
    b[14] = +!!p.panicButton;
    b[15] = +!!p.beepOnEnterTun;
    return b;
  }
  function decodePattern(buf) {
    const out = [];
    if (!buf) return out;
    for (const n of buf) {
      if (n === 0) break;
      out.push(n);
    }
    return out.slice(0, 8);
  }
  function encodePattern(steps) {
    const b = new Uint8Array(20);
    b.set(steps.slice(0, 8), 0);
    return b;
  }
  function readUiProfile() {
    const chk = (id, key) => {
      const el = $(id);
      return el ? !!el.checked : !!DEF[key];
    };
    return {
      stdSpeed: clamp($("#p-std") && $("#p-std").value, 1, 30),
      tunSpeed: clamp($("#p-tun") && $("#p-tun").value, 1, 100),
      stdUnderglow: chk("#p-std-ug", "stdUnderglow"),
      tunUnderglow: chk("#p-tun-ug", "tunUnderglow"),
      stdFrontBar: chk("#p-std-bar", "stdFrontBar"),
      tunFrontBar: chk("#p-tun-bar", "tunFrontBar"),
      stdCruise: chk("#p-std-cr", "stdCruise"),
      tunCruise: chk("#p-tun-cr", "tunCruise"),
      panicButton: chk("#p-panic", "panicButton"),
      beepOnEnterTun: chk("#p-beep", "beepOnEnterTun")
    };
  }
  function writeUiProfile(p) {
    const set = (id, v, chk) => {
      const el = $(id);
      if (!el) return;
      if (chk) el.checked = !!v; else el.value = v;
    };
    set("#p-std", p.stdSpeed);
    set("#p-tun", p.tunSpeed);
    set("#p-std-ug", p.stdUnderglow, true);
    set("#p-tun-ug", p.tunUnderglow, true);
    set("#p-std-bar", p.stdFrontBar, true);
    set("#p-tun-bar", p.tunFrontBar, true);
    set("#p-std-cr", p.stdCruise, true);
    set("#p-tun-cr", p.tunCruise, true);
    set("#p-panic", p.panicButton, true);
    set("#p-beep", p.beepOnEnterTun, true);
    syncStdPreset();
    syncTunPreset();
  }
  function syncStdPreset() {
    const el = $("#p-std");
    const v = el ? String(el.value) : "";
    $$("[data-std]").forEach(b => b.classList.toggle("is-on", b.getAttribute("data-std") === v));
  }
  function syncTunPreset() {
    const el = $("#p-tun");
    const v = el ? String(el.value) : "";
    $$("[data-tun]").forEach(b => b.classList.toggle("is-on", b.getAttribute("data-tun") === v));
  }
  function paintPattern() {
    const box = $("#livePat");
    if (!box) return;
    box.innerHTML = "";
    if (!pattern.length) {
      const s = document.createElement("span");
      s.className = "note";
      s.textContent = "empty";
      box.appendChild(s);
      return;
    }
    pattern.forEach((code, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = i + 1 + ". " + (STEP[code] || "0x" + code.toString(16));
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.addEventListener("click", () => {
        pattern.splice(i, 1);
        paintPattern();
      });
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }
  function setFlagChecks(map) {
    $$("[data-flag]").forEach(el => {
      const k = el.getAttribute("data-flag");
      if (k in map) el.checked = !!map[k];
    });
  }
  function setEnabled(on) {
    $$("#view-live input, #view-live button").forEach(el => {
      if (el.getAttribute("data-view")) return;
      if (el.closest("[data-locked]")) {
        el.disabled = true;
        return;
      }
      el.disabled = !on;
    });
  }
  function lock(fn) {
    if (window.Vexora && Vexora.withBle) return Vexora.withBle(fn);
    return fn();
  }
  async function readReg(dst, reg, len, ms) {
    return session.readRegister(dst, reg, len, ms || 1200);
  }
  async function writeReg(dst, reg, data, ms) {
    return session.writeRegister(dst, reg, data, ms || (dst === X.MCU ? 4e3 : 1500));
  }
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  async function wakeMcu() {
    if (!session || session.demo || !session.readRegister) return false;
    for (let i = 0; i < 3; i++) {
      try {
        await readReg(X.MCU, 25, 2, 2e3);
        return true;
      } catch (e) {
        try {
          await readReg(X.VCU, 24, 2, 800);
        } catch (e2) {}
        await sleep(160);
      }
    }
    return false;
  }
  async function writeMcuU16(reg, val) {
    const data = packU16(val);
    let last = null;
    for (let i = 0; i < 3; i++) {
      try {
        await writeReg(X.MCU, reg, data, 4e3);
        return;
      } catch (e) {
        last = e;
        await sleep(140);
      }
    }
    if (session.writeRegisterFlash) {
      try {
        await session.writeRegisterFlash(X.MCU, reg, data);
        await sleep(120);
        const back = await readReg(X.MCU, reg, 2, 2e3);
        if (u16(back) === (val & 65535)) return;
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error("MCU write failed");
  }
  async function calibMcu(off, data) {
    if (!session.calibWrite) throw new Error("No calib");
    let last = null;
    for (let i = 0; i < 3; i++) {
      try {
        await session.calibWrite(X.MCU, off, data, 4e3);
        return;
      } catch (e) {
        last = e;
        await sleep(160);
      }
    }
    throw last || new Error("MCU calib failed");
  }
  async function readU16(reg) {
    return u16(await readReg(X.VCU, reg, 2));
  }
  async function writeU16(reg, v) {
    await writeReg(X.VCU, reg, packU16(v));
  }
  async function persistU16(reg, v) {
    const data = packU16(v);
    await writeReg(X.VCU, reg, data);
    if (session.writeRegisterFlash) {
      try {
        await session.writeRegisterFlash(X.VCU, reg, data);
      } catch (e) {}
    }
  }
  const FOC_STOCK = {
    d0: 1536,
    d1: 2560,
    d2: 5120,
    d3: 1280,
    d4: 537,
    d5: 197,
    d6: 235,
    d7: 225,
    d8: 1
  };
  const FOC_REGS = [ [ "d0", 208 ], [ "d1", 209 ], [ "d2", 210 ], [ "d3", 211 ], [ "d4", 212 ], [ "d5", 213 ], [ "d6", 214 ], [ "d7", 215 ], [ "d8", 216 ] ];
  const FOC_WRITE = [ "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d0" ];
  const ACCEL_MODE = 110;
  function setNote(id, msg, ok) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("ok", ok === true);
    el.classList.toggle("err", ok === false);
  }
  function motorNote(msg, ok) {
    setNote("#motorLiveNote", msg, ok);
    setNote("#motorTuneNote", msg, ok);
  }
  function focFromPull(pct) {
    pct = clamp(pct, 0, 100);
    const out = Object.assign({}, FOC_STOCK);
    const d3 = Math.round(FOC_STOCK.d3 * (1 + pct / 100));
    if (pct <= 20) out.d3 = Math.min(d3, FOC_STOCK.d0); else {
      out.d3 = Math.min(d3, FOC_STOCK.d1);
      out.d0 = Math.max(FOC_STOCK.d0, out.d3);
    }
    return out;
  }
  async function requireStopped() {
    if (session && session.demo) return;
    let kmh = null;
    try {
      const b = await readReg(X.VCU, 87, 2, 700);
      const v = u16(b) / 10;
      if (Number.isFinite(v)) kmh = v;
    } catch (e) {}
    if (kmh == null && window.Vexora && Number.isFinite(Vexora.lastKmh)) kmh = Vexora.lastKmh;
    if (kmh == null) return;
    if (kmh > .8) throw new Error("Stop first · " + kmh.toFixed(1) + " km/h");
  }
  function mcuFlashed() {
    return !!(window.Vexora && Vexora.isFlashed && Vexora.isFlashed("mcu"));
  }
  function needMcuCfw() {
    const el = $("#motorCfwState");
    if (el) {
      el.textContent = "Stock MCU";
      el.className = "note err";
    }
    return new Error("Needs motor CFW");
  }
  async function writeFocMap(t) {
    await wakeMcu();
    const map = Object.fromEntries(FOC_REGS);
    for (const k of FOC_WRITE) {
      await writeMcuU16(map[k], t[k]);
      await sleep(30);
    }
  }
  async function writePull(pct, force) {
    if (!force) await requireStopped();
    try {
      await writeFocMap(focFromPull(pct));
    } catch (e) {
      const m = e.message || String(e);
      if (/timeout|Timeout|reject|ACK/i.test(m)) throw needMcuCfw();
      throw e;
    }
  }
  const FOC_HILL = {
    d0: 1536,
    d1: 2560,
    d2: 5120,
    d3: 1536,
    d4: 537,
    d5: 197,
    d6: 235,
    d7: 225,
    d8: 1
  };
  function readFocUi() {
    const t = {};
    FOC_REGS.forEach(([k]) => {
      const el = $("#foc-" + k);
      t[k] = clamp(el && el.value, 0, 8191);
    });
    return t;
  }
  function writeFocUi(t) {
    FOC_REGS.forEach(([k]) => {
      const el = $("#foc-" + k);
      if (el && t[k] != null) el.value = String(t[k]);
    });
  }
  const ISENSE_STOCK = 4091, ISENSE_FLOOR = 1800;
  function topPctToVal(pct) {
    pct = clamp(pct, 0, 100);
    return Math.round(ISENSE_STOCK - (ISENSE_STOCK - ISENSE_FLOOR) * (pct / 100));
  }
  function topValToPct(val) {
    if (!Number.isFinite(val)) return 0;
    const span = ISENSE_STOCK - ISENSE_FLOOR;
    return clamp(Math.round((ISENSE_STOCK - val) / span * 100), 0, 100);
  }
  function packBe16(n) {
    n &= 65535;
    return Uint8Array.of(n >> 8 & 255, n & 255);
  }
  function be16(d) {
    return d && d.length >= 2 ? d[0] << 8 | d[1] : 0;
  }
  async function writeTopSpeed(pct) {
    await requireStopped();
    await wakeMcu();
    const val = topPctToVal(pct);
    await calibMcu(16, packBe16(val << 1 & 65535));
    if (session.calibRead) {
      let got = null;
      for (let i = 0; i < 3; i++) {
        try {
          const back = await session.calibRead(X.MCU, 16, 2, 2500);
          got = be16(back) >> 1;
          if (got === val) return;
        } catch (e) {}
        await sleep(140);
      }
      if (got != null && got !== val) throw new Error("Not confirmed · " + got);
    }
  }
  async function writePark(off) {
    await requireStopped();
    await wakeMcu();
    const gate = await allowMcuExt();
    if (!gate.ok) throw needMcuCfw();
    await calibMcu(15, Uint8Array.of(off ? 165 : 0));
    if (session.calibRead) {
      let back = null;
      for (let i = 0; i < 3; i++) {
        try {
          back = await session.calibRead(X.MCU, 15, 1, 2500);
        } catch (e) {
          back = null;
        }
        if (back && back[0] === 165 === !!off) return;
        await sleep(140);
      }
      throw new Error("Not confirmed");
    }
  }
  async function writeAccelBoost(v) {
    await requireStopped();
    await wakeMcu();
    v = clamp(v, 0, 150);
    await calibMcu(4, Uint8Array.of(v >> 8 & 255, v & 255));
    if (session.calibRead) {
      for (let i = 0; i < 2; i++) {
        try {
          const back = await session.calibRead(X.MCU, 4, 2, 2500);
          const got = back && back.length >= 2 ? back[0] << 8 | back[1] : null;
          if (got === v) return;
        } catch (e) {}
        await sleep(120);
      }
    }
  }
  async function writeThrottle(mode) {
    await persistU16(ACCEL_MODE, mode);
  }
  async function mcuCfwInfo() {
    try {
      const n = await readReg(X.MCU, 122, 4, 1200);
      const tag = u16(n);
      const ver = n[2] | n[3] << 8;
      return {
        ok: tag === 20051 && ver >= 256,
        ver: ver
      };
    } catch (e) {
      return {
        ok: false,
        ver: 0
      };
    }
  }
  async function allowMcuExt() {
    const info = await mcuCfwInfo();
    if (info.ok) return info;
    if (mcuFlashed()) return {
      ok: true,
      ver: info.ver || 256,
      via: "flash"
    };
    return info;
  }
  async function probeMotorCfw() {
    const el = $("#motorCfwState");
    if (!el) return;
    if (!session || !session.readRegister || session.dead) {
      el.textContent = "Connect";
      el.className = "note";
      return;
    }
    try {
      const info = await lock(() => mcuCfwInfo());
      if (info.ok) {
        el.textContent = "Motor CFW";
        el.className = "note ok";
      } else if (mcuFlashed()) {
        el.textContent = "MCU flashed";
        el.className = "note";
      } else {
        el.textContent = "Stock MCU";
        el.className = "note err";
      }
    } catch (e) {
      el.textContent = "Stock MCU";
      el.className = "note err";
    }
  }
  async function writeOverdrive(on) {
    await requireStopped();
    await wakeMcu();
    const info = await allowMcuExt();
    if (!info.ok) throw needMcuCfw();
    await calibMcu(14, Uint8Array.of(on ? 165 : 0));
    if (session.calibRead) {
      let back = null;
      for (let i = 0; i < 3; i++) {
        try {
          back = await session.calibRead(X.MCU, 14, 1, 2500);
        } catch (e) {
          back = null;
        }
        if (back && back[0] === 165 === !!on) return;
        await sleep(140);
      }
      throw new Error("Not confirmed");
    }
  }
  async function runDiag() {
    const lines = [];
    const add = (label, dst, reg, len) => readReg(dst, reg, len, 700).then(d => {
      const hex = Array.from(d).map(b => b.toString(16).padStart(2, "0")).join(" ");
      lines.push(label + "  " + hex);
    }).catch(e => {
      lines.push(label + "  fail " + e.message);
    });
    const jobs = [ [ "SN    V16", X.VCU, 16, 14 ], [ "VER   V23", X.VCU, 23, 2 ], [ "BITA  V29", X.VCU, 29, 2 ], [ "BITB  V30", X.VCU, 30, 2 ], [ "BITC  V31", X.VCU, 31, 2 ], [ "STRT  V66", X.VCU, 66, 2 ], [ "ECO   V71", X.VCU, 71, 2 ], [ "SPT   V72", X.VCU, 72, 2 ], [ "OFF   V73", X.VCU, 73, 2 ], [ "BTN   V74", X.VCU, 74, 2 ], [ "SOC   V85", X.VCU, 85, 2 ], [ "SPD   V87", X.VCU, 87, 2 ], [ "MODE  V90", X.VCU, 90, 1 ], [ "TAIL  V93", X.VCU, 93, 2 ], [ "TEMP  V107", X.VCU, 107, 2 ], [ "ACL   V110", X.VCU, 110, 2 ], [ "KERS  V112", X.VCU, 112, 2 ], [ "VOL   V118", X.VCU, 118, 2 ] ];
    for (const j of jobs) await add(j[0], j[1], j[2], j[3]);
    const out = $("#diagOut");
    if (out) out.textContent = lines.join("\n");
    return lines.join("\n");
  }
  async function restoreStock() {
    await requireStopped();
    await writePull(0);
    try {
      await writeAccelBoost(140);
    } catch (e) {}
    try {
      await writeThrottle(2);
    } catch (e) {}
    if ($("#mLivePull")) $("#mLivePull").value = "0";
    if ($("#pullNum")) $("#pullNum").textContent = "0";
    if ($("#mLiveAcc")) $("#mLiveAcc").value = "140";
    if ($("#accNum")) $("#accNum").textContent = "140";
    $$("[data-accel]").forEach(b => b.classList.toggle("is-on", b.getAttribute("data-accel") === "2"));
  }
  let hotLatch = false;
  async function onTemp(c) {
    if (!session || session.dead || session.demo) return;
    if (c >= 105) {
      if (hotLatch) return;
      hotLatch = true;
      try {
        await writePull(0, true);
      } catch (e) {}
      motorNote("Controller hot · motor restored to stock");
      log("err", "thermal foldback " + c.toFixed(1) + " °C");
      const el = $("#discBanner");
      if (el) {
        el.hidden = false;
        el.className = "banner show";
        el.textContent = "Controller hot · motor restored to stock";
      }
    } else if (c < 95) hotLatch = false;
  }
  async function setBit(name, on, persist) {
    if (!session || !session.readRegister) throw new Error("not connected");
    const spec = FLAG[name];
    if (!spec) throw new Error("flag " + name);
    const [reg, bit] = spec;
    const cur = await readU16(reg);
    const nxt = on ? (cur | 1 << bit) & 65535 : cur & ~(1 << bit) & 65535;
    if (nxt !== cur) {
      if (persist) await persistU16(reg, nxt); else await writeU16(reg, nxt);
    }
    return nxt;
  }
  async function setFlag(name, on) {
    return setBit(name, !!on, true);
  }
  async function readFlags() {
    const a = await readU16(REG.BIT_A);
    const b = await readU16(REG.BIT_B);
    const c = await readU16(REG.BIT_C);
    const map = {};
    for (const [k, [reg, bit]] of Object.entries(FLAG)) {
      const w = reg === 29 ? a : reg === 30 ? b : c;
      map[k] = !!(w & 1 << bit);
    }
    return {
      a: a,
      b: b,
      c: c,
      map: map
    };
  }
  async function probeCfwPort() {
    if (!session.request) return false;
    try {
      const r = await session.request({
        src: X.HOST,
        dst: X.VCU,
        cmd: 240,
        arg: 0,
        data: new Uint8Array(0)
      }, 700);
      if (r && r.data && r.data.length) {
        let s = "";
        for (const n of r.data) {
          if (n === 0) break;
          if (n >= 32 && n < 127) s += String.fromCharCode(n);
        }
        return !!s.trim();
      }
    } catch (e) {}
    return false;
  }
  async function probeCfw() {
    if (cfwKind) return cfwKind;
    if (!session.request) {
      cfwKind = "stock";
      return cfwKind;
    }
    cfwKind = await probeCfwPort() ? "ext" : "stock";
    return cfwKind;
  }
  async function cfwString() {
    if (cfwKind !== "ext" || !session.request) return null;
    try {
      const r = await session.request({
        src: X.HOST,
        dst: X.VCU,
        cmd: 240,
        arg: 0,
        data: new Uint8Array(0)
      }, 800);
      if (!r || !r.data || !r.data.length) return null;
      let s = "";
      for (const n of r.data) {
        if (n === 0) break;
        if (n >= 32 && n < 127) s += String.fromCharCode(n);
      }
      return s.trim() || null;
    } catch {
      return null;
    }
  }
  async function cfwState() {
    if (cfwKind !== "ext" || !session.request) return null;
    try {
      const r = await session.request({
        src: X.HOST,
        dst: X.VCU,
        cmd: 250,
        arg: 0,
        data: new Uint8Array(0)
      }, 800, {
        expectedCmd: 251
      });
      if (!r || r.cmd !== 251 || !r.data || !r.data.length) return null;
      return {
        active: r.data[0]
      };
    } catch {
      return null;
    }
  }
  let slotsLoaded = false;
  async function loadExtSlots() {
    if (slotsLoaded || cfwKind !== "ext") return;
    if (!session.request && !session.flashReadSlot) return;
    try {
      const pat = await slotRead(0, 20);
      const prof = await slotRead(1, 16);
      slotsLoaded = true;
      const steps = decodePattern(pat);
      if (steps.length) {
        pattern = steps;
        paintPattern();
        try {
          writeUiProfile(decodeProfile(prof));
        } catch (e) {}
        note("#liveProfNote", "Combo loaded.");
      } else {
        const card = $("#liveProfCard");
        if (card) {
          card.classList.add("is-open");
          if (card.scrollIntoView) {
            try {
              card.scrollIntoView({
                behavior: "smooth",
                block: "center"
              });
            } catch (e) {}
          }
        }
        let old = null;
        try {
          old = JSON.parse(localStorage.getItem("vexora.extprof") || "null");
        } catch (e) {}
        if (old && old.p && old.steps && old.steps.length) {
          writeUiProfile(Object.assign({}, DEF, old.p));
          pattern = old.steps.slice(0, 8);
          paintPattern();
          note("#liveProfNote", window.I18N && I18N.t ? I18N.t("wzRestore") : "Slots are empty — your last profile (STD " + old.p.stdSpeed + " / TUN " + old.p.tunSpeed + ") is on this device: press Save combo to restore it.");
        } else {
          note("#liveProfNote", window.I18N && I18N.t ? I18N.t("wzPick") : "Pick your combo and press Save.");
        }
      }
    } catch (e) {}
  }
  async function slotRead(slot, len) {
    if (session.flashReadSlot) return session.flashReadSlot(slot, len, 1200);
    const r = await session.request({
      src: X.HOST,
      dst: X.VCU,
      cmd: 241,
      arg: slot,
      data: new Uint8Array(0)
    }, 1200, {
      expectedCmd: 244
    });
    if (r.arg !== slot) throw new Error("f-read slot " + slot);
    if (r.data.length !== len) throw new Error("f-read len " + r.data.length);
    return r.data;
  }
  async function slotWrite(slot, data) {
    if (session.flashWriteSlot) return session.flashWriteSlot(slot, data, 2e3);
    let lastErr = null;
    for (let n = 0; n < 2; n++) {
      try {
        const r = await session.request({
          src: X.HOST,
          dst: X.VCU,
          cmd: 242,
          arg: slot,
          data: data
        }, 2e3, {
          expectedCmd: 245
        });
        if (r.arg !== slot) throw new Error("f-write slot " + slot);
        return;
      } catch (e) {
        lastErr = e;
        await new Promise(res => setTimeout(res, 350));
      }
    }
    throw lastErr;
  }
  async function applyMode(mode) {
    const p = readUiProfile();
    const kmh = clamp(mode === "tun" ? p.tunSpeed : p.stdSpeed, 1, 100);
    const eco = Math.min(16, kmh);
    const drive = Math.min(25, kmh);
    await setBit("unlockSports", mode === "tun");
    await setBit("underglow", mode === "tun" ? p.tunUnderglow : p.stdUnderglow, true);
    await setBit("frontPositionLamp", mode === "tun" ? p.tunFrontBar : p.stdFrontBar, true);
    if (cfwKind === "ext" && session.flashWriteSlot) {
      try {
        const q = mode === "tun" ? Object.assign({}, p, {
          tunSpeed: kmh
        }) : Object.assign({}, p, {
          stdSpeed: Math.min(kmh, 30)
        });
        await slotWrite(1, encodeProfile(q));
      } catch (e) {}
    }
    await writeReg(X.VCU, REG.ECO_DRIVE, Uint8Array.of(eco, drive));
    if (session.setCap) {
      try {
        await session.setCap(kmh);
      } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 150));
    await writeReg(X.VCU, REG.SPORT, Uint8Array.of(kmh & 255, kmh >> 8 & 255));
    let got = null;
    try {
      const rb = await readReg(X.VCU, REG.SPORT, 2);
      got = rb[0] | rb[1] << 8;
      if (got !== kmh) {
        await new Promise(r => setTimeout(r, 250));
        await writeReg(X.VCU, REG.SPORT, Uint8Array.of(kmh & 255, kmh >> 8 & 255));
        const rb2 = await readReg(X.VCU, REG.SPORT, 2);
        got = rb2[0] | rb2[1] << 8;
      }
    } catch (e) {}
    const m = $("#liveMode");
    if (m) m.textContent = mode === "tun" ? "TUN" : "STD";
    return {
      kmh: kmh,
      eco: eco,
      drive: drive,
      got: got
    };
  }
  async function refresh() {
    if (!session || busy) return;
    if (!session.readRegister) {
      ready(window.I18N && I18N.t ? I18N.t("noData") : "No data yet.");
      return;
    }
    if (session.dead) {
      ready(window.I18N && I18N.t ? I18N.t("disconnected") : "Disconnected.");
      return;
    }
    busy = true;
    ready(window.I18N && I18N.t ? I18N.t("reading") : "Reading…");
    try {
      await lock(async () => {
        let sn = "—", ver = "—", mcuVer = "—";
        try {
          const raw = await readReg(X.VCU, REG.SN, 14);
          sn = Array.from(raw).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : "").join("").replace(/\0/g, "").trim() || "—";
        } catch (e) {
          sn = "err";
        }
        try {
          ver = verNibbles(await readU16(REG.VCU_VER));
        } catch (e) {
          ver = "err";
        }
        try {
          let raw = null;
          try {
            raw = await readReg(X.VCU, 24, 2, 600);
          } catch (e) {}
          if (!raw || raw.length < 2) {
            try {
              raw = await readReg(X.MCU, 25, 2, 500);
            } catch (e) {}
          }
          mcuVer = raw && raw.length >= 2 ? verNibbles(u16(raw)) : "—";
        } catch (e) {
          mcuVer = "err";
        }
        let bleVer = "—", bmsVer = "—";
        try {
          const br = await readReg(X.BLE, 1, 2, 500);
          if (br && br.length >= 2) bleVer = verNibbles(u16(br));
        } catch (e) {}
        try {
          const br = await readReg(X.VCU, 25, 2, 500);
          if (br && br.length >= 2) bmsVer = verNibbles(u16(br));
        } catch (e) {}
        if (window.Vexora && Vexora.rememberSn) Vexora.rememberSn(sn);
        if ($("#liveSn")) $("#liveSn").textContent = sn;
        if ($("#liveBle")) $("#liveBle").textContent = bleVer;
        if ($("#liveBms")) $("#liveBms").textContent = bmsVer;
        try {
          if (window.Vexora) {
            Vexora.fwVcu = ver;
            Vexora.fwMcu = mcuVer;
          }
          if (window.VexoraCfw && VexoraCfw.refreshBaseNote) VexoraCfw.refreshBaseNote();
        } catch (e) {}
        let ride = "—";
        try {
          const mb = await readReg(X.VCU, REG.MODE, 1);
          ride = MODE[mb[0]] || "m" + mb[0];
        } catch (e) {}
        const flashedVcu = !!(window.Vexora && (Vexora.isFlashed ? Vexora.isFlashed("vcu") : Vexora.lastFlash === "vcu"));
        const flashedMcu = !!(window.Vexora && (Vexora.isFlashed ? Vexora.isFlashed("mcu") : Vexora.lastFlash === "mcu"));
        const vcuCfw = flashedVcu || window.VEXORA && VEXORA.isVcu(ver);
        const mcuCfw = flashedMcu || window.VEXORA && VEXORA.isMcu && VEXORA.isMcu(mcuVer);
        let kind = null;
        if (vcuCfw && !flashedVcu && window.VEXORA && VEXORA.isVcu(ver)) {
          kind = "vexora";
        } else {
          cfwKind = null;
          kind = await probeCfw();
        }
        let vcuLabel = ver;
        let mcuLabel = mcuVer;
        if (kind === "ext") {
          const name = await cfwString();
          vcuLabel = (vcuCfw ? "Vexora Ext " : (name || "CFW") + " ") + ver;
          const st = await cfwState();
          if (st) ride = (st.active === 1 ? "TUN" : "STD") + " · " + ride;
        } else if (vcuCfw) {
          cfwKind = "vexora";
          if (flashedVcu && !(window.VEXORA && VEXORA.isVcu(ver))) {
            ver = window.VEXORA && VEXORA.vcu || "1.1.7";
          }
          vcuLabel = "Vexora CFW " + ver;
        } else {
          vcuLabel = "stock " + ver;
        }
        if (mcuCfw) {
          if (flashedMcu && !(window.VEXORA && VEXORA.isMcu && VEXORA.isMcu(mcuVer))) {
            mcuVer = window.VEXORA && VEXORA.mcu || "1.1.7";
          }
          mcuLabel = "Vexora CFW " + mcuVer;
        } else {
          mcuLabel = mcuVer && mcuVer !== "—" && mcuVer !== "err" ? "stock " + mcuVer : mcuVer;
        }
        if ($("#liveVer")) {
          $("#liveVer").textContent = vcuLabel;
          $("#liveVer").classList.toggle("cfw", !!vcuCfw);
        }
        if ($("#liveMcu")) {
          $("#liveMcu").textContent = mcuLabel;
          $("#liveMcu").classList.toggle("cfw", !!mcuCfw);
        }
        if ($("#liveCfw")) $("#liveCfw").textContent = (vcuCfw ? "VCU" : "") + (vcuCfw && mcuCfw ? " · " : "") + (mcuCfw ? "MCU" : "") || "stock";
        if ($("#liveMode")) $("#liveMode").textContent = ride;
        log("ok", "id SN=" + sn + " VCU=" + vcuLabel + " MCU=" + mcuLabel);
        try {
          const fl = await readFlags();
          setFlagChecks(fl.map);
          if ($("#liveLock")) {
            $("#liveLock").textContent = fl.map.unlockSports ? "Unlocked" : "Locked";
            $("#liveLock").classList.toggle("cfw", !!fl.map.unlockSports);
          }
          note("#liveLightNote", "Underglow " + (fl.map.underglow ? "on" : "off"));
        } catch (e) {
          note("#liveLightNote", "Could not read the light settings.");
        }
        try {
          const vol = await readU16(REG.VOL) & 255;
          if ($("#liveVol")) $("#liveVol").value = clamp(vol, 5, 100);
          if ($("#volNum")) $("#volNum").textContent = String(clamp(vol, 5, 100));
          const kers = await readU16(REG.KERS) & 255;
          $$("[data-kers]").forEach(b => b.classList.toggle("is-on", Number(b.getAttribute("data-kers")) === kers));
          const tail = await readU16(REG.TAIL) & 255;
          $$("[data-tail]").forEach(b => b.classList.toggle("is-on", Number(b.getAttribute("data-tail")) === (tail ? 1 : 0)));
          note("#liveRideNote", "Settings loaded");
        } catch (e) {}
        try {
          const off = await readU16(REG.POWER_OFF) & 255;
          if ($("#liveOff")) $("#liveOff").value = clamp(off || 5, 1, 30);
          if ($("#offNum")) $("#offNum").textContent = String(clamp(off || 5, 1, 30));
        } catch (e) {}
        try {
          const st = await readU16(REG.START) & 255;
          if ($("#liveStart")) $("#liveStart").value = clamp(st, 0, 5);
          if ($("#startNum")) $("#startNum").textContent = String(clamp(st, 0, 5));
        } catch (e) {}
        try {
          const dash = await readU16(REG.DASH) & 255;
          $$("[data-dash]").forEach(b => b.classList.toggle("is-on", Number(b.getAttribute("data-dash")) === dash));
        } catch (e) {}
        try {
          const rr = await readU16(REG.RANGE_DISP);
          if ($("#liveRangeDisp")) $("#liveRangeDisp").checked = !!(rr & 16);
        } catch (e) {}
        try {
          const ch = await readReg(X.BMS, REG.CHARGE, 2, 500);
          if (ch && ch.length) {
            const pct = clamp(ch[0] || 100, 80, 100);
            if ($("#liveChg")) $("#liveChg").value = pct;
            if ($("#chgNum")) $("#chgNum").textContent = String(pct);
          }
        } catch (e) {}
        try {
          const btn = await readU16(REG.CUSTOM_BTN);
          const name = Object.keys(BTN).find(k => BTN[k] === (btn & 255)) || String(btn & 255);
          note("#liveBtnNote", "Custom button: " + cbLabel(name));
          $$("[data-cbtn]").forEach(b => b.classList.toggle("is-on", b.getAttribute("data-cbtn") === name));
        } catch (e) {}
        if (vcuCfw || mcuCfw) ready((vcuCfw ? vcuLabel : "VCU " + ver) + " · " + (mcuCfw ? mcuLabel : "MCU " + mcuVer)); else if (kind === "ext") ready(vcuLabel + " · MCU " + mcuVer); else ready("VCU " + ver + " · MCU " + mcuVer);
        if (kind === "ext") await loadExtSlots();
      });
      log("live", readyText());
    } catch (e) {
      ready(e.message);
      log("err", e.message);
    } finally {
      busy = false;
    }
  }
  function readyText() {
    const el = $("#liveReady");
    return el ? el.textContent : "";
  }
  async function guard(fn) {
    if (!session || !session.readRegister || session.dead) {
      ready(window.I18N && I18N.t ? I18N.t("connectFirst") : "Connect first.");
      setNote("#liveRideNote", "Connect first.", false);
      return;
    }
    if (busy) {
      setNote("#liveRideNote", "Busy — wait.", false);
      return;
    }
    busy = true;
    try {
      await lock(fn);
    } catch (e) {
      setNote("#liveRideNote", "Failed · " + e.message, false);
      setNote("#liveSysNote", "Failed · " + e.message, false);
      log("err", e.message);
    } finally {
      busy = false;
    }
  }
  async function motorGuard(fn) {
    if (!session || !session.readRegister || session.dead) {
      motorNote("Connect first.", false);
      return;
    }
    if (busy) {
      motorNote("Busy — wait.", false);
      return;
    }
    busy = true;
    motorNote("Writing…");
    try {
      await lock(fn);
    } catch (e) {
      motorNote("Failed · " + e.message, false);
      log("err", e.message);
    } finally {
      busy = false;
    }
  }
  function bind() {
    writeUiProfile(DEF);
    paintPattern();
    setEnabled(false);
    const LIGHT_FLAGS = {
      underglow: 1,
      frontPositionLamp: 1,
      autoHeadlight: 1,
      tailBreathing: 1
    };
    const RIDE_FLAGS = {
      walkMode: 1,
      tcs: 1,
      unlockSports: 1,
      boostFunc: 1,
      parkOnSlope: 1,
      driveModeEn: 1,
      sportsModeEn: 1
    };
    function flagNoteId(name) {
      if (LIGHT_FLAGS[name]) return "#liveLightNote";
      if (RIDE_FLAGS[name]) return "#liveRideNote";
      return "#liveSysNote";
    }
    function flagLabel(el, name) {
      const sp = el.closest("label") && el.closest("label").querySelector("span");
      return sp && sp.textContent.trim() || name;
    }
    let boostTimer = null;
    function setModal(on) {
      document.body.classList.toggle("is-modal", !!on);
    }
    function closeBoostWarn() {
      if (boostTimer) {
        clearInterval(boostTimer);
        boostTimer = null;
      }
      const ov = $("#boostOverlay");
      if (ov) ov.hidden = true;
      setModal(false);
    }
    function openBoostWarn() {
      const ov = $("#boostOverlay"), go = $("#boostGo"), count = $("#boostCount");
      if (!ov || !go) return;
      let left = 5;
      go.disabled = true;
      go.textContent = "Wait " + left;
      if (count) count.textContent = "Wait " + left + " seconds.";
      ov.hidden = false;
      setModal(true);
      if (boostTimer) clearInterval(boostTimer);
      boostTimer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          go.textContent = "Wait " + left;
          if (count) count.textContent = "Wait " + left + " seconds.";
          return;
        }
        clearInterval(boostTimer);
        boostTimer = null;
        go.disabled = false;
        go.textContent = "Enable";
        if (count) count.textContent = "Be careful.";
      }, 1e3);
    }
    $$("[data-flag]").forEach(el => {
      el.addEventListener("change", () => {
        const name = el.getAttribute("data-flag");
        if (name === "boostFunc" && el.checked) {
          el.checked = false;
          if (!session || !session.readRegister || session.dead) {
            setNote("#liveRideNote", "Connect first.", false);
            return;
          }
          openBoostWarn();
          return;
        }
        guard(async () => {
          await setBit(name, el.checked, true);
          const fl = await readFlags();
          setFlagChecks(fl.map);
          const lab = flagLabel(el, name);
          setNote(flagNoteId(name), "Applied · " + lab + (el.checked ? " on" : " off"), true);
          log("ok", name + " = " + el.checked);
        });
      });
    });
    const boostCancel = $("#boostCancel");
    if (boostCancel) boostCancel.addEventListener("click", closeBoostWarn);
    const boostGo = $("#boostGo");
    if (boostGo) boostGo.addEventListener("click", () => {
      if (boostGo.disabled) return;
      closeBoostWarn();
      guard(async () => {
        await setBit("boostFunc", true, true);
        const fl = await readFlags();
        setFlagChecks(fl.map);
        setNote("#liveRideNote", "Applied · Boost on", true);
        log("ok", "boostFunc = true");
      });
    });
    const boot = $("#btnUgBoot");
    if (boot) boot.addEventListener("click", () => guard(async () => {
      await setBit("underglow", true, true);
      if ($("#p-std-ug")) $("#p-std-ug").checked = true;
      if ($("#p-tun-ug")) $("#p-tun-ug").checked = true;
      if (cfwKind === "ext") {
        const p = readUiProfile();
        p.stdUnderglow = true;
        p.tunUnderglow = true;
        writeUiProfile(p);
        await slotWrite(1, encodeProfile(p));
        note("#liveLightNote", "Underglow saved. It will turn on by itself when the scooter starts.");
      } else {
        note("#liveLightNote", "Underglow saved. On stock firmware it only works with the headlight on.");
      }
      const fl = await readFlags();
      setFlagChecks(fl.map);
      log("ok", "UG al encender");
    }));
    $$("[data-tun]").forEach(b => b.addEventListener("click", () => {
      if ($("#p-tun")) $("#p-tun").value = b.getAttribute("data-tun");
    }));
    $$("[data-step]").forEach(b => b.addEventListener("click", () => {
      if (pattern.length >= 8) return;
      pattern.push(Number(b.getAttribute("data-step")));
      paintPattern();
    }));
    const clr = $("#btnPatClear");
    if (clr) clr.addEventListener("click", () => {
      pattern = [];
      paintPattern();
    });
    $$("[data-std]").forEach(b => b.addEventListener("click", () => {
      const el = $("#p-std");
      if (el) el.value = b.getAttribute("data-std");
      syncStdPreset();
    }));
    $$("[data-tun]").forEach(b => b.addEventListener("click", () => {
      const el = $("#p-tun");
      if (el) el.value = b.getAttribute("data-tun");
      syncTunPreset();
    }));
    const volEl = $("#liveVol");
    if (volEl) {
      volEl.addEventListener("input", () => {
        if ($("#volNum")) $("#volNum").textContent = volEl.value;
      });
      volEl.addEventListener("change", () => guard(async () => {
        const v = clamp(volEl.value, 5, 100);
        await persistU16(REG.VOL, v);
        setNote("#liveRideNote", "Applied · volume " + v, true);
        log("ok", "vol " + v);
      }));
    }
    let kersTimer = null, kersPending = 0;
    function closeKersWarn() {
      if (kersTimer) {
        clearInterval(kersTimer);
        kersTimer = null;
      }
      const ov = $("#kersOverlay");
      if (ov) ov.hidden = true;
      setModal(false);
      kersPending = 0;
    }
    function openKersWarn(level) {
      kersPending = level;
      const ov = $("#kersOverlay"), go = $("#kersGo"), count = $("#kersCount"), copy = $("#kersCopy");
      if (!ov || !go) return;
      const name = level === 1 ? "Weak" : "Std";
      if (copy) copy.textContent = "KERS " + name + " is engine braking. It loads the motor hard and can destroy it. Leave Off.";
      let left = 5;
      go.disabled = true;
      go.textContent = "Wait " + left;
      if (count) count.textContent = "Read this. Confirm unlocks in " + left + "s.";
      ov.hidden = false;
      setModal(true);
      if (kersTimer) clearInterval(kersTimer);
      kersTimer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          go.textContent = "Wait " + left;
          if (count) count.textContent = "Read this. Confirm unlocks in " + left + "s.";
          return;
        }
        clearInterval(kersTimer);
        kersTimer = null;
        go.disabled = false;
        go.textContent = "Enable " + name;
        if (count) count.textContent = "You accept a destroyed motor.";
      }, 1e3);
    }
    async function writeKers(v) {
      await persistU16(REG.KERS, v);
      $$("[data-kers]").forEach(x => x.classList.toggle("is-on", Number(x.getAttribute("data-kers")) === v));
      setNote("#liveRideNote", v === 0 ? "Applied · KERS Off" : "Applied · KERS ON · motor risk", true);
      log(v === 0 ? "ok" : "err", "kers " + v);
    }
    $$("[data-kers]").forEach(b => b.addEventListener("click", () => {
      const v = Number(b.getAttribute("data-kers"));
      if (v === 0) {
        guard(async () => {
          await writeKers(0);
        });
        return;
      }
      if (!session || !session.readRegister || session.dead) {
        ready(window.I18N && I18N.t ? I18N.t("connectFirst") : "Connect first.");
        return;
      }
      openKersWarn(v);
    }));
    const kersCancel = $("#kersCancel");
    if (kersCancel) kersCancel.addEventListener("click", closeKersWarn);
    const kersGo = $("#kersGo");
    if (kersGo) kersGo.addEventListener("click", () => {
      if (kersGo.disabled || !kersPending) return;
      const v = kersPending;
      closeKersWarn();
      guard(async () => {
        await writeKers(v);
      });
    });
    $$("[data-tail]").forEach(b => b.addEventListener("click", () => guard(async () => {
      const v = Number(b.getAttribute("data-tail"));
      await persistU16(REG.TAIL, v);
      $$("[data-tail]").forEach(x => x.classList.toggle("is-on", x === b));
      setNote("#liveRideNote", "Saved · tail " + (v ? "blinking" : "solid"), true);
      log("ok", "tail " + v);
    })));
    $$("[data-cbtn]").forEach(b => b.addEventListener("click", () => guard(async () => {
      const key = b.getAttribute("data-cbtn");
      await writeU16(REG.CUSTOM_BTN, BTN[key]);
      $$("[data-cbtn]").forEach(x => x.classList.toggle("is-on", x === b));
      note("#liveBtnNote", "Custom button: " + (b.textContent.trim() || key));
      log("ok", "custom button " + key);
    })));
    const rd = $("#btnLiveRead");
    if (rd) rd.addEventListener("click", () => {
      busy = false;
      refresh();
    });
    const sv = $("#btnLiveSave");
    if (sv) sv.addEventListener("click", () => guard(async () => {
      if (cfwKind !== "ext") throw new Error("No CFW slots");
      const p = readUiProfile();
      writeUiProfile(p);
      await slotWrite(1, encodeProfile(p));
      await slotWrite(0, encodePattern(pattern));
      let verified = false;
      try {
        const rbP = await slotRead(1, 16);
        const rbK = await slotRead(0, 20);
        const ep = encodeProfile(p), ek = encodePattern(pattern);
        verified = rbP.every((v, i) => v === ep[i]) && rbK.every((v, i) => v === ek[i]);
      } catch (e) {}
      try {
        localStorage.setItem("vexora.extprof", JSON.stringify({
          p: p,
          steps: pattern.slice(0, 8),
          ts: Date.now()
        }));
      } catch (e) {}
      note("#liveProfNote", "Saved · STD " + p.stdSpeed + " / TUN " + p.tunSpeed + " km/h · combo " + pattern.length + " steps" + (verified ? " · verified ✓" : " · ⚠ could not verify"));
      log("ok", "perfiles guardados" + (verified ? " (verificado)" : " (SIN verificar — pueden perderse al apagar)"));
    }));
    const aS = $("#btnLiveStd");
    if (aS) aS.addEventListener("click", () => guard(async () => {
      const r = await applyMode("std");
      note("#liveProfNote", "STD applied · Eco " + r.eco + " / Drive " + r.drive + " / Sport " + r.kmh + " km/h" + (r.got != null ? r.got === r.kmh ? " · verified ✓" : " · ⚠ scooter keeps " + r.got : ""));
      log("ok", "apply STD " + r.kmh);
    }));
    const aT = $("#btnLiveTun");
    if (aT) aT.addEventListener("click", () => guard(async () => {
      const r = await applyMode("tun");
      note("#liveProfNote", "TUN applied · Eco " + r.eco + " / Drive " + r.drive + " / Sport " + r.kmh + " km/h — top speed in SPORT mode" + (r.got != null ? r.got === r.kmh ? " · verified ✓" : " · ⚠ scooter keeps " + r.got + " — tell support" : ""));
      log("ok", "apply TUN " + r.kmh);
    }));
    $$("[data-accel]").forEach(b => b.addEventListener("click", () => motorGuard(async () => {
      const v = Number(b.getAttribute("data-accel"));
      await writeThrottle(v);
      $$("[data-accel]").forEach(x => x.classList.toggle("is-on", x === b));
      motorNote("Applied · throttle " + (v === 1 ? "Smooth" : v === 3 ? "Sharp" : "Std"), true);
      log("ok", "throttle " + v);
    })));
    const accEl = $("#mLiveAcc");
    if (accEl) accEl.addEventListener("input", () => {
      if ($("#accNum")) $("#accNum").textContent = accEl.value;
    });
    $$("[data-acc]").forEach(b => b.addEventListener("click", () => {
      const v = b.getAttribute("data-acc");
      if (accEl) accEl.value = v;
      if ($("#accNum")) $("#accNum").textContent = v;
    }));
    const btnAcc = $("#btnAccApply");
    if (btnAcc) btnAcc.addEventListener("click", () => motorGuard(async () => {
      const v = clamp(accEl && accEl.value, 0, 150);
      await writeAccelBoost(v);
      motorNote("Applied · acceleration " + v, true);
      log("ok", "accel " + v);
    }));
    const pullEl = $("#mLivePull");
    function paintPull() {
      const n = pullEl ? Number(pullEl.value) : 0;
      if ($("#pullNum")) $("#pullNum").textContent = String(n);
      if (pullEl) pullEl.classList.toggle("hot", n > 20);
    }
    if (pullEl) pullEl.addEventListener("input", paintPull);
    $$("[data-pull]").forEach(b => b.addEventListener("click", () => {
      if (pullEl) pullEl.value = b.getAttribute("data-pull");
      paintPull();
    }));
    let pullTimer = null, pullPending = 0;
    function closePullWarn() {
      if (pullTimer) {
        clearInterval(pullTimer);
        pullTimer = null;
      }
      const ov = $("#pullOverlay");
      if (ov) ov.hidden = true;
      setModal(false);
      pullPending = 0;
    }
    function openPullWarn(pct) {
      pullPending = pct;
      const ov = $("#pullOverlay"), go = $("#pullGo"), count = $("#pullCount"), copy = $("#pullCopy");
      if (!ov || !go) return;
      if (copy) copy.textContent = "Pulling power +" + pct + "% is outside the extra-safe 0–20% range. It can overheat or destroy the motor.";
      let left = 5;
      go.disabled = true;
      go.textContent = "Wait " + left;
      if (count) count.textContent = "Confirm unlocks in " + left + "s.";
      ov.hidden = false;
      setModal(true);
      if (pullTimer) clearInterval(pullTimer);
      pullTimer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          go.textContent = "Wait " + left;
          if (count) count.textContent = "Confirm unlocks in " + left + "s.";
          return;
        }
        clearInterval(pullTimer);
        pullTimer = null;
        go.disabled = false;
        go.textContent = "Apply +" + pct + "%";
        if (count) count.textContent = "You accept a destroyed motor.";
      }, 1e3);
    }
    async function applyPull(pct) {
      await writePull(pct);
      motorNote("Applied · pulling +" + pct + "%" + (pct > 20 ? " · unsafe" : pct === 0 ? "" : " · extra safe"), true);
      log(pct > 20 ? "err" : "ok", "pull +" + pct);
    }
    function requestPull(pct) {
      pct = clamp(pct, 0, 100);
      if (!session || !session.readRegister || session.dead) {
        motorNote("Connect first.", false);
        return;
      }
      if (pct > 20) {
        openPullWarn(pct);
        return;
      }
      motorGuard(async () => {
        await applyPull(pct);
      });
    }
    const btnPull = $("#btnPullApply");
    if (btnPull) btnPull.addEventListener("click", () => requestPull(pullEl && pullEl.value));
    const startEl = $("#liveStart");
    if (startEl) {
      startEl.addEventListener("input", () => {
        if ($("#startNum")) $("#startNum").textContent = startEl.value;
      });
      startEl.addEventListener("change", () => guard(async () => {
        const v = clamp(startEl.value, 0, 5);
        await persistU16(REG.START, v);
        setNote("#liveRideNote", "Applied · motor start " + v + " km/h", true);
        log("ok", "start " + v);
      }));
    }
    $$("[data-dash]").forEach(b => b.addEventListener("click", () => guard(async () => {
      const v = clamp(b.getAttribute("data-dash"), 1, 7);
      await persistU16(REG.DASH, v);
      $$("[data-dash]").forEach(x => x.classList.toggle("is-on", x === b));
      setNote("#liveSysNote", "Applied · display " + v, true);
      log("ok", "display " + v);
    })));
    const rangeDisp = $("#liveRangeDisp");
    if (rangeDisp) rangeDisp.addEventListener("change", () => guard(async () => {
      await persistU16(REG.RANGE_DISP, rangeDisp.checked ? 16 : 0);
      setNote("#liveSysNote", "Applied · " + (rangeDisp.checked ? "range on display" : "range off display"), true);
      log("ok", "range-disp " + rangeDisp.checked);
    }));
    const btnNow = $("#btnChargeNow");
    if (btnNow) btnNow.addEventListener("click", () => guard(async () => {
      await setBit("chargeNow", true, false);
      setNote("#liveRideNote", "Applied · Charge now", true);
      log("ok", "charge now");
    }));
    const chgEl = $("#liveChg");
    if (chgEl) {
      chgEl.addEventListener("input", () => {
        if ($("#chgNum")) $("#chgNum").textContent = chgEl.value;
      });
      chgEl.addEventListener("change", () => guard(async () => {
        const v = clamp(chgEl.value, 80, 100);
        await writeReg(X.BMS, REG.CHARGE, packU16(v));
        setNote("#liveRideNote", "Applied · charge limit " + v + "%", true);
        log("ok", "charge " + v);
      }));
    }
    const offEl = $("#liveOff");
    if (offEl) {
      offEl.addEventListener("input", () => {
        if ($("#offNum")) $("#offNum").textContent = offEl.value;
      });
      offEl.addEventListener("change", () => guard(async () => {
        const v = clamp(offEl.value, 1, 30);
        await persistU16(REG.POWER_OFF, v);
        setNote("#liveSysNote", "Applied · power-off " + v + " min", true);
        log("ok", "power-off " + v);
      }));
    }
    const btnOdOn = $("#btnOdOn");
    const btnOdOff = $("#btnOdOff");
    if (btnOdOn) btnOdOn.addEventListener("click", () => motorGuard(async () => {
      await writeOverdrive(true);
      btnOdOn.classList.add("is-on");
      if (btnOdOff) btnOdOff.classList.remove("is-on");
      motorNote("Applied · overdrive on", true);
      log("ok", "overdrive on");
    }));
    if (btnOdOff) btnOdOff.addEventListener("click", () => motorGuard(async () => {
      await writeOverdrive(false);
      btnOdOff.classList.add("is-on");
      if (btnOdOn) btnOdOn.classList.remove("is-on");
      motorNote("Applied · overdrive off", true);
      log("ok", "overdrive off");
    }));
    const btnParkOff = $("#btnParkOff");
    const btnParkOn = $("#btnParkOn");
    if (btnParkOff) btnParkOff.addEventListener("click", () => motorGuard(async () => {
      await writePark(true);
      btnParkOff.classList.add("is-on");
      if (btnParkOn) btnParkOn.classList.remove("is-on");
      motorNote("Applied · throttle from stop", true);
      log("ok", "auto-park off");
    }));
    if (btnParkOn) btnParkOn.addEventListener("click", () => motorGuard(async () => {
      await writePark(false);
      btnParkOn.classList.add("is-on");
      if (btnParkOff) btnParkOff.classList.remove("is-on");
      motorNote("Applied · auto-park stock", true);
      log("ok", "auto-park on");
    }));
    const topEl = $("#mLiveTop");
    function paintTop() {
      const n = topEl ? Number(topEl.value) : 0;
      if ($("#topNum")) $("#topNum").textContent = String(n);
      if ($("#topKmh")) $("#topKmh").textContent = String(Math.round(45 + 15 * n / 100));
    }
    if (topEl) topEl.addEventListener("input", paintTop);
    $$("[data-top]").forEach(b => b.addEventListener("click", () => {
      if (topEl) topEl.value = b.getAttribute("data-top");
      paintTop();
    }));
    const btnTop = $("#btnTopApply");
    if (btnTop) btnTop.addEventListener("click", () => motorGuard(async () => {
      const v = clamp(topEl && topEl.value, 0, 100);
      await writeTopSpeed(v);
      motorNote("Applied · top speed " + v + "%", true);
      log("ok", "top " + v);
    }));
    const btnFocRead = $("#btnFocRead");
    if (btnFocRead) btnFocRead.addEventListener("click", () => motorGuard(async () => {
      await wakeMcu();
      const t = {};
      for (const [k, reg] of FOC_REGS) {
        const d = await readReg(X.MCU, reg, 2, 2e3);
        t[k] = u16(d);
      }
      writeFocUi(t);
      motorNote("Applied · FOC read", true);
      log("ok", "foc read");
    }));
    const btnFocStock = $("#btnFocStock");
    if (btnFocStock) btnFocStock.addEventListener("click", () => {
      writeFocUi(FOC_STOCK);
    });
    const btnFocHill = $("#btnFocHill");
    if (btnFocHill) btnFocHill.addEventListener("click", () => {
      writeFocUi(FOC_HILL);
    });
    const btnFocApply = $("#btnFocApply");
    if (btnFocApply) btnFocApply.addEventListener("click", () => motorGuard(async () => {
      const t = readFocUi();
      if (!(t.d0 > 0 && t.d4 > 0 && t.d4 <= t.d3 && t.d3 <= t.d0 && t.d0 <= t.d1 && t.d1 <= t.d2)) {
        throw new Error("FOC ladder d4≤d3≤d0≤d1≤d2");
      }
      await requireStopped();
      await writeFocMap(t);
      motorNote("Applied · FOC", true);
      log("ok", "foc apply");
    }));
    const btnDiag = $("#btnDiag");
    if (btnDiag) btnDiag.addEventListener("click", () => guard(async () => {
      const t = await runDiag();
      setNote("#liveSysNote", "Applied · diagnostics", true);
      log("ok", "diag " + t.split("\n").length);
    }));
    const btnDiagCopy = $("#btnDiagCopy");
    if (btnDiagCopy) btnDiagCopy.addEventListener("click", async () => {
      const t = $("#diagOut") && $("#diagOut").textContent || "";
      try {
        await navigator.clipboard.writeText(t);
        setNote("#liveSysNote", "Applied · copied", true);
      } catch (e) {
        setNote("#liveSysNote", "Failed · copy", false);
      }
    });
    const btnRestore = $("#btnMotorRestore");
    if (btnRestore) btnRestore.addEventListener("click", () => motorGuard(async () => {
      await restoreStock();
      motorNote("Applied · motor stock", true);
      log("ok", "motor stock");
    }));
    const btnStock = $("#btnPullStock");
    if (btnStock) btnStock.addEventListener("click", () => {
      if (pullEl) pullEl.value = "0";
      paintPull();
      requestPull(0);
    });
    const pullCancel = $("#pullCancel");
    if (pullCancel) pullCancel.addEventListener("click", closePullWarn);
    const pullGo = $("#pullGo");
    if (pullGo) pullGo.addEventListener("click", () => {
      if (pullGo.disabled || !pullPending) return;
      const v = pullPending;
      closePullWarn();
      motorGuard(async () => {
        await applyPull(v);
      });
    });
    document.addEventListener("click", e => {
      const el = e.target.closest("[data-view]");
      if (!el) return;
      const view = el.getAttribute("data-view");
      if (view === "live") {
        if (!session && window.Vexora && Vexora.getSession) setSession(Vexora.getSession());
        if (session && !session.dead) refresh();
      }
      if (view === "vxfw") {
        if (!session && window.Vexora && Vexora.getSession) setSession(Vexora.getSession());
        if (session && !session.dead) probeMotorCfw();
      }
    });
    window.addEventListener("hashchange", () => {
      const n = (location.hash || "").replace("#", "");
      if (n === "live" && session && !session.dead) refresh();
      if (n === "vxfw" && session && !session.dead) probeMotorCfw();
    });
  }
  function createDemo() {
    const regs = new Map;
    const key = (dst, r) => dst == null ? r : dst + ":" + r;
    const put = (dst, r, bytes) => {
      const b = Uint8Array.from(bytes);
      if (dst == null) regs.set(r, b); else {
        regs.set(dst + ":" + r, b);
        regs.set(r, b);
      }
    };
    put(X.VCU, REG.SN, Array.from("1CGADEMO000001").map(c => c.charCodeAt(0)));
    put(X.VCU, REG.VCU_VER, [ 17, 5 ]);
    put(X.MCU, 25, [ 80, 1 ]);
    put(X.VCU, 24, [ 80, 1 ]);
    put(X.VCU, REG.BIT_A, [ 0, 0 ]);
    put(X.VCU, REG.BIT_B, [ 0, 0 ]);
    put(X.VCU, REG.BIT_C, [ 0, 0 ]);
    put(X.VCU, REG.ECO_DRIVE, [ 16, 22 ]);
    put(X.VCU, REG.SPORT, [ 0, 22 ]);
    put(X.VCU, REG.CUSTOM_BTN, [ 6, 0 ]);
    put(X.VCU, REG.MODE, [ 2 ]);
    put(X.VCU, REG.KERS, [ 2, 0 ]);
    put(X.VCU, REG.VOL, [ 50, 0 ]);
    put(X.VCU, REG.TAIL, [ 0, 0 ]);
    put(X.VCU, ACCEL_MODE, [ 2, 0 ]);
    put(X.MCU, 208, [ 0, 6 ]);
    put(X.MCU, 209, [ 0, 10 ]);
    put(X.MCU, 210, [ 0, 20 ]);
    put(X.MCU, 211, [ 0, 5 ]);
    put(X.VCU, 87, [ 123, 0 ]);
    put(X.VCU, 85, [ 78, 0 ]);
    put(X.VCU, 95, [ 164, 22 ]);
    put(X.VCU, 98, [ 79, 71, 1, 0 ]);
    const slots = {
      0: encodePattern([ 1, 2, 1, 2 ]),
      1: encodeProfile(DEF)
    };
    let mode = 0;
    return {
      demo: true,
      bleName: "DEMO",
      async readRegister(dst, reg, len) {
        const d = regs.get(key(dst, reg)) || regs.get(reg) || new Uint8Array(len);
        return d.slice(0, len);
      },
      async writeRegister(dst, reg, data) {
        const cur = regs.get(key(dst, reg)) || regs.get(reg) || new Uint8Array(data.length);
        const n = new Uint8Array(Math.max(cur.length, data.length));
        n.set(cur);
        n.set(data);
        regs.set(key(dst, reg), n);
        regs.set(reg, n);
      },
      async writeRegisterFlash(dst, reg, data) {
        return this.writeRegister(dst, reg, data);
      },
      async calibRead(dst, offset, len) {
        const d = regs.get("cal:" + dst + ":" + offset) || new Uint8Array(len);
        return d.slice(0, len);
      },
      async calibWrite(dst, offset, data) {
        regs.set("cal:" + dst + ":" + offset, Uint8Array.from(data));
      },
      async setCap() {
        return 0;
      },
      async request(frame) {
        if (frame.cmd === 240) {
          const t = (new TextEncoder).encode("Vexora Ext");
          return {
            src: X.VCU,
            dst: X.HOST,
            cmd: 240,
            arg: 0,
            data: t
          };
        }
        if (frame.cmd === 250) {
          return {
            src: X.VCU,
            dst: X.HOST,
            cmd: 251,
            arg: 0,
            data: Uint8Array.of(mode, 0, 0, 0, 0, 0, 0)
          };
        }
        if (frame.cmd === 241) {
          const d = slots[frame.arg] || new Uint8Array(0);
          return {
            src: X.VCU,
            dst: X.HOST,
            cmd: 244,
            arg: frame.arg,
            data: d
          };
        }
        if (frame.cmd === 242) {
          slots[frame.arg] = Uint8Array.from(frame.data);
          return {
            src: X.VCU,
            dst: X.HOST,
            cmd: 245,
            arg: frame.arg,
            data: new Uint8Array(0)
          };
        }
        if (frame.cmd === 248) {
          return {
            src: X.VCU,
            dst: X.HOST,
            cmd: 249,
            arg: frame.arg,
            data: new Uint8Array(0)
          };
        }
        throw new Error("demo cmd " + frame.cmd);
      },
      async flashReadSlot(slot, len) {
        const d = slots[slot];
        if (!d) throw new Error("empty slot");
        if (d.length !== len) throw new Error("len");
        return d.slice();
      },
      async flashWriteSlot(slot, data) {
        slots[slot] = Uint8Array.from(data);
      }
    };
  }
  function setSession(s) {
    session = s;
    cfwKind = null;
    slotsLoaded = false;
    setEnabled(!!s && !!s.readRegister && !s.dead);
    if (!s) {
      ready(window.I18N && I18N.t ? I18N.t("connectFirst") : "Connect first.");
      if ($("#liveSn")) $("#liveSn").textContent = "—";
      if ($("#liveVer")) {
        $("#liveVer").textContent = "—";
        $("#liveVer").classList.remove("cfw");
      }
      if ($("#liveMcu")) {
        $("#liveMcu").textContent = "—";
        $("#liveMcu").classList.remove("cfw");
      }
      if ($("#liveCfw")) $("#liveCfw").textContent = "—";
      if ($("#liveMode")) $("#liveMode").textContent = "—";
      if ($("#liveLock")) $("#liveLock").textContent = "—";
      if ($("#liveBle")) $("#liveBle").textContent = "—";
      if ($("#liveBms")) $("#liveBms").textContent = "—";
      return;
    }
  }
  try {
    bind();
  } catch (e) {
    console.error("VexoraLive bind", e);
  }
  window.VexoraLive = {
    setSession: setSession,
    refresh: refresh,
    createDemo: createDemo,
    setFlag: setFlag,
    restoreStock: restoreStock,
    onTemp: onTemp,
    probeMotorCfw: probeMotorCfw
  };
})();