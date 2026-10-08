/* Vexora CFW — client UI (v1.8.0).
   The firmware image is BUILT ON THE SERVER (POST /api/cfw/build):
   this file only collects the UI parameters (sliders, presets, model,
   detected versions), calls the API and hands the encrypted image to the
   flasher. No TEA key, no offsets, no firmware bases in the browser. */
(() => {
  try {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const on = (id, ev, fn) => { const el = typeof id === "string" ? $(id) : id; if (el) el.addEventListener(ev, fn); };

    let mcuFlavor = "fwk";

    /* Versiones stock conocidas — solo para los textos de la UI.
       (Las imágenes reales viven en el servidor.) */
    const STOCK_VERSIONS = {
      g3: { vcu: ["1.5.8", "1.5.5", "1.5.4"], mcu: ["1.4.8", "1.3.15"] },
      f3pro: { vcu: ["1.5.8", "1.5.5", "1.5.4"], mcu: ["1.4.8", "1.3.15"] }, /* F3 Pro = mismo hardware que el Max G3 */
      f3: { vcu: ["1.5.4"], mcu: ["1.4.1"] },
      zt3: { vcu: ["1.4.14"] },
    };
    function parseFw(s) {
      const m = String(s || "").match(/(\d+)\.(\d+)\.(\d+)/);
      return m ? m[1] + "." + m[2] + "." + m[3] : "";
    }
    function fwVer(part) {
      const v = window.Vexora || {};
      return parseFw(part === "mcu" ? v.fwMcu : v.fwVcu);
    }
    function stockList(model, part) { return (STOCK_VERSIONS[model] || {})[part] || []; }
    function pickStockVersion(model, part) {
      const list = stockList(model, part);
      if (!list.length) return "";
      const want = fwVer(part);
      return (want && list.find((v) => v === want)) || list[0];
    }
    function modelId() {
      return (window.Vexora && Vexora.model) || "g3";
    }

    /* ---------- feature flag (admin, en vivo) ---------------------------- */
    /* El panel de admin puede desactivar los builds custom en caliente.
       El servidor lo aplica igualmente — esto solo refleja el estado en la
       UI cada ~30 s. La restauración stock queda siempre disponible. */
    let features = { tire: true, cfw: true };
    const CFW_BUTTONS = ["#btnMcu", "#btnMcuUltra", "#btnVcu", "#btnVcuZt3"];
    function applyFeatures() {
      CFW_BUTTONS.forEach((id) => { const b = $(id); if (b) b.disabled = !features.cfw; });
    }
    async function loadFeatures() {
      try {
        const r = await fetch("/api/features", { cache: "no-store" });
        if (r.status === 403 || r.status === 503) {
          const jb = await r.json().catch(() => null);
          if (jb && jb.error === "banned" && window.Vexora && Vexora.showBan) Vexora.showBan(jb.reason);
          if (jb && jb.error === "maintenance" && window.Vexora && Vexora.showMaint) Vexora.showMaint();
          return;
        }
        const j = await r.json();
        if (window.Vexora && Vexora.hideMaint) Vexora.hideMaint();
        if (j && j.ok && j.features) features = { tire: !!j.features.tire, cfw: !!j.features.cfw };
      } catch (e) {}
      applyFeatures();
    }
    setInterval(loadFeatures, 5000);
    loadFeatures();

    function note(msg) {
      const log = $("#log");
      if (!log) return;
      const d = document.createElement("div");
      d.textContent = msg;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    function val(id) {
      const el = $(id);
      return el ? Number(el.value) : 0;
    }
    function syncLabels() {
      $$("#view-cfw input[type=range], #view-motor input[type=range]").forEach((r) => {
        const lab = document.querySelector('[data-for="' + r.id + '"]');
        if (lab) lab.textContent = r.value;
      });
    }
    function setSliders(engage, cap, scale) {
      const e = $("#mcu-engage"), c = $("#mcu-cap"), s = $("#mcu-scale");
      if (e) e.value = String(engage);
      if (c) c.value = String(cap);
      if (s) s.value = String(scale);
      [["mcu-engage", engage], ["mcu-cap", cap], ["mcu-scale", scale]].forEach(([id, n]) => {
        const lab = document.querySelector('[data-for="' + id + '"]');
        if (lab) lab.textContent = String(n);
      });
    }
    function markSeg(sel, id) {
      $$(sel).forEach((b) => b.classList.toggle("is-on", b.id === id));
    }
    function showMcuPanels() {
      const ns = $("#panelFwk"), ul = $("#panelUltra"), dp = $("#panelDpc4");
      const m = modelId();
      if (m !== "g3" && mcuFlavor === "dpc4") mcuFlavor = "fwk";
      if (ns) ns.hidden = mcuFlavor !== "fwk";
      if (ul) ul.hidden = mcuFlavor !== "ultra";
      if (dp) dp.hidden = mcuFlavor !== "dpc4" || m !== "g3";
    }
    window.addEventListener("vexora:model", showMcuPanels);
    function setVcu(ne, nd, ns, e, d, s) {
      const map = { "#n-eco": ne, "#n-drive": nd, "#n-sport": ns, "#eco": e, "#drive": d, "#sport": s };
      Object.keys(map).forEach((id) => {
        const el = $(id);
        if (el) el.value = String(map[id]);
        const lab = document.querySelector('[data-for="' + id.slice(1) + '"]');
        if (lab) lab.textContent = String(map[id]);
      });
      paintSum();
    }

    function refreshBaseNote() {
      const el = $("#cfwBaseNote");
      const rn = $("#restoreNote");
      const model = modelId();
      if (el) {
        if (model !== "g3" && model !== "f3pro") el.textContent = "";
        else el.textContent = "Vexora Ext · Standard + Tuning profiles · secret combo";
      }
      const showU = model === "g3" || model === "f3" || model === "f3pro" || model === "zt3";
      if (rn) {
        rn.textContent = showU ? "Compat images: VCU + MCU — the scooter stays flashable." : "";
      }
      const bu = $("#btnVcuUnlock");
      if (bu) bu.hidden = !showU;
      const bm = $("#btnMcuUnlock");
      if (bm) bm.hidden = !showU;
      const uh = $("#unlockHelp");
      if (uh) uh.hidden = !showU;
      const uc = $("#unlockCredit");
      if (uc) uc.hidden = !showU;
    }

    /* ---------- build (servidor) ---------------------------------------- */
    function b64ToU8(b64s) {
      const bin = atob(b64s);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    function collectParams(kind) {
      return {
        kind: kind,
        model: modelId(),
        fwVcu: fwVer("vcu"),
        fwMcu: fwVer("mcu"),
        mcu: {
          flavor: mcuFlavor,
          engage: val("#mcu-engage"),
          cap: val("#mcu-cap"),
          scale: val("#mcu-scale"),
          punta: val("#mcu-punta"),
        },
        vcu: {
          devKey: (($("#devKey") && $("#devKey").value) || "").trim(),
          spoofVcu: (($("#spoofVcu") && $("#spoofVcu").value) || "").trim(),
          police: false,
          panic: false,
          se: val("#n-eco"), sd: val("#n-drive"), ss: val("#n-sport"),
          ce: val("#eco"), cd: val("#drive"), cs: val("#sport"),
        },
      };
    }
    async function build(kind) {
      if ((kind === "mcu" || kind === "vcu") && !features.cfw) {
        throw new Error("Firmware builds are currently disabled — stock restore stays available");
      }
      let r, j = null;
      try {
        r = await fetch("/api/cfw/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(collectParams(kind)),
        });
        j = await r.json().catch(() => null);
      } catch (e) {
        throw new Error("Could not reach the build server — check your connection");
      }
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || "Build failed (" + r.status + ")");
      const enc = b64ToU8(j.enc);
      window.lastBuiltFirmwareEnc = enc;
      window.lastBuiltPartition = j.part;
      note(j.note || "Built");
      refreshBaseNote();
      return { enc, part: j.part };
    }

    /* ---------- UI (idéntica a v1.7.x) ---------------------------------- */
    $$("#view-cfw input[type=range], #view-motor input[type=range]").forEach((r) => on(r, "input", syncLabels));
    const capEl = $("#mcu-cap");
    if (capEl) capEl.addEventListener("input", () => {
      const v = Number(capEl.value) || 0;
      if (v > 115 && !mcuUnsafe) {
        const wanted = v;
        capEl.value = "115";
        syncLabels();
        wantUnsafe(() => { capEl.value = String(Math.min(150, wanted)); syncLabels(); });
      }
    });
    on("#btnMcu", "click", () => {
      mcuFlavor = "fwk";
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("mcu");
    });
    on("#btnMcuUltra", "click", () => wantUnsafe(() => {
      mcuFlavor = "ultra";
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("mcu");
    }));
    on("#btnMcuDpc4", "click", () => wantUnsafe(() => {
      mcuFlavor = "dpc4";
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("mcu");
    }));
    on("#btnVcu", "click", () => {
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("vcu");
    });
    on("#btnVcuUnlock", "click", () => {
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("vcu-unlock");
    });
    on("#btnMcuUnlock", "click", () => {
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("mcu-unlock");
    });
    on("#btnVcuDevKey", "click", async () => {
      /* v2.3.1 · el unlock se gana: 2 vídeos (>=1000 vistas) → /unlock → código */
      if (window.VexoraUnlock && VexoraUnlock.ensure && !(await VexoraUnlock.ensure())) return;
      const k = ($("#devKey") && $("#devKey").value.trim()) || "";
      if (!/^[0-9a-fA-F]{32}$/.test(k)) { note("The device key is 32 hex characters (16 bytes)."); return; }
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("vcu");
    });
    on("#btnHwScan", "click", () => {
      if (!window.Vexora) return;
      if (Vexora.isScanning && Vexora.isScanning()) { if (Vexora.abortHwScan) Vexora.abortHwScan(); return; }
      if (Vexora.runHwScan) Vexora.runHwScan();
    });
    /* v2.2.0 · Read UIDs: reg 218 (0xDA) len 12 en VCU/MCU = Device UID propio
       (words LE). Verificado con dump real de un Max G3 (VCU 0ADD0DB9… / MCU 5366005D…).
       El VCU además expone el UID del MCU en reg 192 (0xC0) — cruce de validación. */
    const trI18n = (k, f) => (window.I18N && I18N.t && I18N.t(k)) || f;
    async function readUids12() {
      const V = window.Vexora;
      const sess = V && V.getSession && V.getSession();
      if (!sess || sess.dead || !sess.request || sess.demo) return null;
      const blank = (h) => !h || /^00+$/.test(h) || /^ff+$/.test(h);
      const fmt = (b) => {
        const w = [];
        for (let i = 0; i + 1 < b.length; i += 2) w.push(((b[i + 1] << 8) | b[i]).toString(16).padStart(4, "0").toUpperCase());
        return w.join(" ");
      };
      let vcu = null, mcu = null;
      try { vcu = await V.withBle(() => sess.readRegister(22, 218, 12, 1500)); } catch (e) {}
      try { mcu = await V.withBle(() => sess.readRegister(2, 218, 12, 1500)); } catch (e) {}
      const parts = [];
      if (vcu && !blank(toHex(vcu))) parts.push("VCU UID: " + fmt(vcu));
      if (mcu && !blank(toHex(mcu))) parts.push("MCU UID: " + fmt(mcu));
      return parts;
    }
    on("#btnReadUids", "click", async () => {
      const out = $("#uidOut");
      const V = window.Vexora;
      if (!V || !out) return;
      const btn = $("#btnReadUids");
      if (btn) btn.disabled = true;
      out.textContent = trI18n("reading", "Reading…");
      try {
        const parts = await readUids12();
        if (btn) btn.disabled = false;
        if (!parts) { out.textContent = trI18n("uidsConn", "Connect the scooter first."); return; }
        if (!parts.length) { out.textContent = trI18n("uidsFail", "Could not read the UIDs — try again, or use the hardware scan below."); return; }
        const line = parts.join("   ·   ").replace(/VCU UID: /, "VCU ").replace(/MCU UID: /, "MCU ");
        out.textContent = line;
        try { await navigator.clipboard.writeText(parts.join("\n")); out.textContent = line + "  ✓"; } catch (e) {}
      } catch (e) {
        if (btn) btn.disabled = false;
        out.textContent = "Error: " + (e.message || e);
      }
    });
    /* Copy UID+key pair: el dataset para (algún día) derivar UID→key.
       El usuario que ya tiene la key del unlock + el patinete conectado
       genera el par exacto que el proyecto necesita, con un toque. */
    /* v2.2.0 · Cockpit (beta) — registros verificados en G3 real (segMod #13,
       socksprox, sep 2026): playSound VCU 0x77 (writeNR, u16), voz VCU 0x76
       (u16 %, 5-100), item del dash VCU 0x2E (u16 1-7), aceleración VCU 0x6E
       (u16 1-3), límite de carga BMS 0x82 (u16 %). */
    const cOut = (m) => { const o = $("#cockpitOut"); if (o) o.textContent = m; };
    const u16le = (v) => [v & 255, (v >> 8) & 255];
    const toHex = (u8) => Array.from(u8).map((x) => x.toString(16).padStart(2, "0")).join("");
    async function cSess() {
      const V = window.Vexora;
      const s = V && V.getSession && V.getSession();
      if (!s || s.dead || !s.request || s.demo) { cOut(trI18n("uidsConn", "Connect the scooter first.")); return null; }
      return s;
    }
    async function cWrite(dst, reg, data, what) {
      const V = window.Vexora;
      const s = await cSess(); if (!s) return false;
      try {
        await V.withBle(() => s.writeRegister(dst, reg, data, 1500));
      } catch (e) {
        /* en HW real el ACK 0x05 a veces no llega — writeNR + read-back */
        try {
          await V.withBle(() => s.writeRegisterFlash(dst, reg, data));
        } catch (e2) { cOut("Error: " + (e2.message || e2)); return false; }
      }
      try {
        const rb = await V.withBle(() => s.readRegister(dst, reg, data.length, 1200));
        const want = data.map((x) => x.toString(16).padStart(2, "0")).join("");
        if (rb && toHex(rb) !== want) cOut(what + " ⚠ read-back: " + toHex(rb));
        else cOut(what + " ✓");
      } catch (e) { cOut(what + " ✓ (sin lectura de confirmación)"); }
      return true;
    }
    on("#btnHorn", "click", async () => {
      const V = window.Vexora;
      const s = await cSess(); if (!s) return;
      try { await V.withBle(() => s.writeRegisterFlash(22, 0x77, u16le(Number($("#sndId").value) || 1))); cOut(trI18n("bHorn", "Horn") + " ✓"); }
      catch (e) { cOut("Error: " + (e.message || e)); }
    });
    on("#btnPlaySnd", "click", async () => {
      const V = window.Vexora;
      const s = await cSess(); if (!s) return;
      try { await V.withBle(() => s.writeRegisterFlash(22, 0x77, u16le(Number($("#sndId").value) || 1))); cOut("Sound " + $("#sndId").value + " ✓"); }
      catch (e) { cOut("Error: " + (e.message || e)); }
    });
    on("#sndId", "input", () => { const el = $("#sndIdVal"); if (el) el.textContent = $("#sndId").value; });
    on("#vvol", "input", () => { const el = $("#vvolVal"); if (el) el.textContent = $("#vvol").value + "%"; });
    on("#chg", "input", () => { const el = $("#chgVal"); if (el) el.textContent = $("#chg").value + "%"; });
    on("#btnVolApply", "click", async () => { await cWrite(22, 0x76, u16le(Number($("#vvol").value) || 60), "Volume"); });
    $$("#segDash button").forEach((b) => on(b, "click", async () => {
      $$("#segDash button").forEach((x) => x.classList.remove("is-on")); b.classList.add("is-on");
      await cWrite(22, 0x2E, u16le(Number(b.dataset.dash) || 1), "Dash");
    }));
    $$("#segAcc button").forEach((b) => on(b, "click", async () => {
      $$("#segAcc button").forEach((x) => x.classList.remove("is-on")); b.classList.add("is-on");
      await cWrite(22, 0x6E, u16le(Number(b.dataset.acc) || 2), "Accel");
    }));
    on("#btnChgApply", "click", async () => { await cWrite(7, 0x82, u16le(Number($("#chg").value) || 95), "Charge limit"); });
    /* v2.2.0 · Odometer (beta) — localizador: el registro del odo NO está en el
       mapa verificado; NO se adivina. El usuario mete su km real exacto y se
       barre VCU+BMS (cmd 1, len 4) buscando el valor en u16/u32 LE/BE ×1/×10/×100.
       Con el registro confirmado: escritura SOLO-SUBIR + revertir al original. */
    on("#btnOdoFind", "click", async () => {
      const V = window.Vexora;
      const s = await cSess(); if (!s) return;
      const km = Number($("#odoKm") && $("#odoKm").value);
      if (!(km >= 1 && km <= 999999)) { cOut("Enter your exact km first."); return; }
      const pats = new Set();
      const le = (v, n) => { const b = []; for (let i = 0; i < n; i++) { b.push(v & 255); v = Math.floor(v / 256); } return b; };
      [1, 10, 100].forEach((f) => {
        let v = Math.round(km * f);
        if (v < 65536) { const b = le(v, 2); pats.add(JSON.stringify(b)); pats.add(JSON.stringify(b.slice().reverse())); }
        if (v < 4294967296) { const b = le(v, 4); pats.add(JSON.stringify(b)); pats.add(JSON.stringify(b.slice().reverse())); }
      });
      const hx = (u8) => Array.from(u8).map((x) => x.toString(16).padStart(2, "0")).join("");
      const hits = [];
      const btn = $("#btnOdoFind");
      if (btn) btn.disabled = true;
      try {
        for (let d = 0; d < 2; d++) {
          const dst = d ? 7 : 22, name = d ? "BMS" : "VCU";
          for (let reg = 0; reg < 256; reg++) {
            if ((reg & 63) === 0) cOut(name + " " + reg + "/256…");
            let r = null;
            try { r = await V.withBle(() => s.request({ src: 62, dst: dst, cmd: 1, arg: reg, data: new Uint8Array([4, 0]) }, 180, { expectedCmd: [4] })); } catch (e) {}
            if (r && r.data && r.data.length === 4 && pats.has(JSON.stringify(Array.from(r.data)))) hits.push(name + " reg 0x" + reg.toString(16) + " (" + hx(r.data) + ")");
          }
        }
      } catch (e) { cOut("Error: " + (e.message || e)); }
      if (btn) btn.disabled = false;
      cOut(hits.length ? "CANDIDATES → " + hits.join(" · ") + "   (send me this)" : "No matches — ride 1 km and retry with the new exact value.");
    });
    /* v2.2.0 · Odómetro write — registro VERIFICADO por el owner (VCU 0x16, reg
       0x62, u32 LE, unidades 0.1 km; su lectura 53090 = 5309.0 km, candidato
       único y coherente). Reglas: SOLO SUBIR (nunca bajar) salvo revertir al
       original anotado en localStorage por SN (vexora.odo.<SN>). */
    const ODO_REG = 0x62, ODO_DST = 22;
    const odoKey = () => "vexora.odo." + ((window.Vexora && Vexora.lastSn) || "unknown");
    const odoKmStr = (u) => (u / 10).toFixed(1) + " km";
    async function odoReadUnits() {
      const V = window.Vexora, s = await cSess(); if (!s) return null;
      const r = await V.withBle(() => s.readRegister(ODO_DST, ODO_REG, 4, 1500));
      if (!r || r.length !== 4) throw new Error("odo read failed");
      return ((r[0] | (r[1] << 8) | (r[2] << 16) | (r[3] << 24)) >>> 0);
    }
    async function odoWriteUnits(v) {
      const V = window.Vexora, s = await cSess(); if (!s) return false;
      const b = [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
      try { await V.withBle(() => s.writeRegister(ODO_DST, ODO_REG, b, 1800)); }
      catch (e) {
        try { await V.withBle(() => s.writeRegisterFlash(ODO_DST, ODO_REG, b)); }
        catch (e2) { cOut("Error: " + (e2.message || e2)); return false; }
      }
      let rb = null;
      try { rb = await odoReadUnits(); } catch (e) {}
      if (rb === v) cOut("Odo = " + odoKmStr(v) + " ✓");
      else cOut("Write sent · read-back " + (rb == null ? "n/a" : odoKmStr(rb)) + (rb === v ? "" : " ⚠"));
      const el = $("#odoNow"); if (el) el.textContent = odoKmStr(rb == null ? v : rb);
      return true;
    }
    on("#btnOdoRead2", "click", async () => {
      try {
        const cur = await odoReadUnits();
        if (cur == null) return;
        const el = $("#odoNow"); if (el) el.textContent = odoKmStr(cur);
        cOut("Current: " + odoKmStr(cur));
      } catch (e) { cOut("Error: " + (e.message || e)); }
    });
    on("#btnOdoSet", "click", async () => {
      try {
        const cur = await odoReadUnits();
        if (cur == null) return;
        const el = $("#odoNow"); if (el) el.textContent = odoKmStr(cur);
        const km = Number($("#odoNew") && $("#odoNew").value);
        if (!(km > 0)) { cOut("Enter the new km first."); return; }
        const units = Math.round(km * 10);
        if (units < cur) { cOut(trI18n("odoOnlyUp", "The odometer only goes up. To go back use Revert (the saved original).")); return; }
        if (units === cur) { cOut("Already at " + odoKmStr(cur) + "."); return; }
        let orig = null;
        try { orig = Number(localStorage.getItem(odoKey())) || null; } catch (e) {}
        if (!orig) { orig = cur; try { localStorage.setItem(odoKey(), String(cur)); } catch (e) {} }
        await odoWriteUnits(units);
      } catch (e) { cOut("Error: " + (e.message || e)); }
    });
    on("#btnOdoRevert", "click", async () => {
      try {
        let orig = null;
        try { orig = Number(localStorage.getItem(odoKey())) || null; } catch (e) {}
        if (!orig) { cOut(trI18n("odoNoOrig", "No original saved yet — set a new value first.")); return; }
        await odoWriteUnits(orig);
      } catch (e) { cOut("Error: " + (e.message || e)); }
    });
    /* v2.2.0 · Odometer dump patcher — verificado en la placa del owner
       (9999.0 km OK vía ST-Link). Todo LOCAL en el navegador: el dump
       (keys/SN/UIDs) NUNCA sale del dispositivo. Localiza el odo (u32 LE,
       0.1 km) — debe aparecer EXACTAMENTE 2 veces (copias A/B) — y genera
       el dump parcheado listo para flashear (x3 utils / st-flash). */
    on("#btnOdoPick", "click", () => { const i = $("#odoFile"); if (i) i.click(); });
    on("#odoFile", "change", () => {
      const f = $("#odoFile") && $("#odoFile").files && $("#odoFile").files[0];
      const el = $("#odoPName");
      if (el) el.textContent = f ? f.name + " · " + (f.size / 1024).toFixed(0) + " KB" : "";
    });
    on("#btnOdoPatch", "click", async () => {
      const f = $("#odoFile") && $("#odoFile").files && $("#odoFile").files[0];
      if (!f) { cOut(trI18n("odoPNoFile", "Choose your VCU dump first.")); return; }
      const cur = Number($("#odoKm") && $("#odoKm").value);
      const tgt = Number($("#odoNew") && $("#odoNew").value);
      if (!(cur > 0)) { cOut("Enter your CURRENT km first (top field)."); return; }
      if (!(tgt >= cur)) { cOut(trI18n("odoOnlyUp", "The odometer only goes up. To go back use Revert (the saved original).")); return; }
      if (f.size < 0x20000) { cOut(trI18n("odoPSize", "Too small — a VCU dump is 128 KB (0x20000).")); return; }
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf[7] !== 0x08) { cOut(trI18n("odoPVec", "That file doesn't look like a VCU dump (no ARM vector table).")); return; }
      const units = Math.round(cur * 10);
      const tunits = Math.round(tgt * 10);
      const hits = [];
      for (let i = 0; i + 4 <= buf.length; i++) {
        if (buf[i] === (units & 255) && buf[i + 1] === ((units >> 8) & 255) && buf[i + 2] === ((units >> 16) & 255) && buf[i + 3] === ((units >>> 24) & 255)) hits.push(i);
      }
      if (hits.length !== 2) { cOut(trI18n("odoPBad", "Need exactly 2 copies of your current km in the dump (found ") + hits.length + "). Use the exact km from 'Read current'."); return; }
      const nb = [tunits & 255, (tunits >> 8) & 255, (tunits >> 16) & 255, (tunits >>> 24) & 255];
      for (const h of hits) { buf[h] = nb[0]; buf[h + 1] = nb[1]; buf[h + 2] = nb[2]; buf[h + 3] = nb[3]; }
      const blob = new Blob([buf], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "vexora-vcu-odo-" + (tunits / 10).toFixed(1).replace(".", "_") + ".bin";
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      cOut(trI18n("odoPOk", "Patched dump downloaded. Flash it (x3 utils full flash / st-flash write FILE 0x08000000), then verify on the scooter with 'Read current'."));
    });
    /* Diagnóstico odo BLE: escribe cur+0.1 km (up-only, inofensivo) y distingue
       permiso-denegado (rechazo) de valor/estado rechazado. */
    on("#btnOdoDiag", "click", async () => {
      const V = window.Vexora;
      const s = await cSess(); if (!s) return;
      try {
        const cur = await odoReadUnits();
        if (cur == null) return;
        cOut("Current " + odoKmStr(cur) + " · trying +0.1 km…");
        const v = cur + 1;
        const b = [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
        let ack = "cmd2: NO ACK";
        try {
          await V.withBle(() => s.writeRegister(ODO_DST, ODO_REG, b, 1800));
          ack = "cmd2: ACCEPTED ✓";
        } catch (e) { ack = "cmd2: rejected (" + ((e.message || e) + "").slice(0, 40) + ")"; }
        let rb = null;
        try { rb = await odoReadUnits(); } catch (e) {}
        cOut(ack + " · now reads " + (rb == null ? "?" : odoKmStr(rb)));
      } catch (e) { cOut("Error: " + (e.message || e)); }
    });
    on("#btnCopyPair", "click", async () => {
      const V = window.Vexora;
      if (!V) return;
      const k = ($("#devKey") && $("#devKey").value.trim()) || "";
      if (!/^[0-9a-fA-F]{32}$/.test(k)) { note(trI18n("pairNeedKey", "Paste the 32-hex device key above first — then copy the pair.")); return; }
      note(trI18n("reading", "Reading…"));
      try {
        const parts = await readUids12();
        if (!parts) { note(trI18n("uidsConn", "Connect the scooter first.")); return; }
        if (!parts.length) { note(trI18n("uidsFail", "Could not read the UIDs — try again, or use the hardware scan below.")); return; }
        const sn = (V.lastSn && String(V.lastSn)) || "unknown";
        const txt = "SN: " + sn + "\n" + parts.join("\n") + "\nKey: " + k.toLowerCase();
        try { await navigator.clipboard.writeText(txt); note(trI18n("pairCopied", "Pair copied. Paste it in the project Discord to help map the key algorithm.")); }
        catch (e) { window.__vexoraPair = txt; note(trI18n("pairCopied", "Pair copied. Paste it in the project Discord to help map the key algorithm.")); }
      } catch (e) { note("Error: " + (e.message || e)); }
    });
    on("#btnVcuZt3", "click", () => {
      if (window.Vexora && Vexora.flashCfw) Vexora.flashCfw("vcu");
    });
    /* v2.2.0 · guardrails: Safe por defecto; Unsafe (peak / iqFW>115) con confirmación temporizada */
    let mcuUnsafe = false;
    let unsafeTimer = null, unsafePending = null;
    function closeUnsafe() {
      if (unsafeTimer) { clearInterval(unsafeTimer); unsafeTimer = null; }
      const ov = $("#unsafeOverlay");
      if (ov) ov.hidden = true;
      unsafePending = null;
    }
    function openUnsafe(fn) {
      const ov = $("#unsafeOverlay"), go = $("#unsafeGo"), count = $("#unsafeCount");
      if (!ov || !go) { if (fn) fn(); return; }
      unsafePending = fn;
      let left = 5;
      go.disabled = true;
      go.textContent = "Wait " + left;
      if (count) count.textContent = "Read this. Confirm unlocks in " + left + "s.";
      ov.hidden = false;
      if (unsafeTimer) clearInterval(unsafeTimer);
      unsafeTimer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          go.textContent = "Wait " + left;
          if (count) count.textContent = "Read this. Confirm unlocks in " + left + "s.";
          return;
        }
        clearInterval(unsafeTimer);
        unsafeTimer = null;
        go.disabled = false;
        go.textContent = "I understand";
        if (count) count.textContent = "You accept the risk of a destroyed motor.";
      }, 1000);
    }
    const uc = $("#unsafeCancel");
    if (uc) uc.addEventListener("click", closeUnsafe);
    const ug = $("#unsafeGo");
    if (ug) ug.addEventListener("click", () => {
      if (ug.disabled || !unsafePending) return;
      mcuUnsafe = true;
      const fn = unsafePending;
      closeUnsafe();
      if (fn) fn();
    });
    function wantUnsafe(fn) {
      if (mcuUnsafe) { if (fn) fn(); return; }
      openUnsafe(fn);
    }
    on("#presetSafe", "click", () => {
      mcuFlavor = "fwk";
      setSliders(30, 70, 1638);
      showMcuPanels();
      markSeg("#view-motor .seg button", "presetSafe");
      note("Safe · stock field weakening · recommended");
    });
    on("#presetBest", "click", () => {
      mcuFlavor = "fwk";
      setSliders(28, 115, 2300);
      showMcuPanels();
      markSeg("#view-motor .seg button", "presetBest");
      note("Balanced · engage 28 · iqFW 115 A · scale 2300");
    });
    on("#presetChill", "click", () => {
      mcuFlavor = "fwk";
      setSliders(30, 35, 1200);
      showMcuPanels();
      markSeg("#view-motor .seg button", "presetChill");
      note("Chill · engage 30 · iqFW 35 A · scale 1200");
    });
    function applyUltra(peak, tag) {
      mcuFlavor = "ultra";
      const p = $("#mcu-punta"); if (p) p.value = String(peak);
      const lab = document.querySelector('[data-for="mcu-punta"]');
      if (lab) lab.textContent = String(peak);
      showMcuPanels();
      markSeg("#view-motor .seg button", tag);
      note("Unsafe · peak " + peak + " A · motor risk");
    }
    on("#presetUltra", "click", () => wantUnsafe(() => applyUltra(327, "presetUltra")));
    on("#presetUltraPlus", "click", () => wantUnsafe(() => applyUltra(900, "presetUltraPlus")));
    on("#presetStock", "click", () => {
      mcuFlavor = "fwk";
      setSliders(30, 70, 1638);
      showMcuPanels();
      markSeg("#view-motor .seg button", "presetStock");
      note("Stock FW · engage 30 · iqFW 70 A · scale 1638");
    });
    setSliders(30, 70, 1638);
    try {
      const wz = JSON.parse(localStorage.getItem("vexora.wz") || "null");
      if (wz && wz.engage != null) {
        setSliders(wz.engage, wz.cap, wz.scale);
        note("Wizard · engage " + wz.engage + " · iqFW " + wz.cap + " A · scale " + wz.scale);
        localStorage.removeItem("vexora.wz");
      }
    } catch (e) {}
    setVcu(16, 25, 25);
    syncCfwPreset();
    markSeg("#view-motor .seg button", "presetSafe");
    showMcuPanels();
    syncLabels();

    function summary(kind) {
      if (kind === "mcu") {
        if (mcuFlavor === "ultra") return "Ultra · peak " + (val("#mcu-punta") || 327);
        return "iqFW " + (val("#mcu-cap") || 0) + " A · engage " + (val("#mcu-engage") || 0) + " · scale " + (val("#mcu-scale") || 0);
      }
      if (modelId() === "zt3") return "ZT3 · Panic + unlock";
      return "Standard " + (val("#n-sport")|0) + " km/h · Tuning in-app";
    }
    function paintSum() {
      const el = $("#cfwSum");
      if (el) el.textContent = summary("vcu");
    }
    $$("#view-cfw input[type=range]").forEach((r) => on(r, "input", () => { syncCfwPreset(); paintSum(); }));
    $$("[data-pstd]").forEach((b) => b.addEventListener("click", () => {
      const top = Number(b.getAttribute("data-pstd")) || 25;
      setVcu(16, top, top);
      syncCfwPreset();
    }));
    function syncCfwPreset() {
      const cur = (val("#n-eco") | 0) + "," + (val("#n-drive") | 0) + "," + (val("#n-sport") | 0);
      $$("[data-pstd]").forEach((b) => {
        const top = Number(b.getAttribute("data-pstd")) | 0;
        b.classList.toggle("is-on", cur === "16," + top + "," + top);
      });
    }
    paintSum();
    refreshBaseNote();
    /* v2.3.2.46 · compartir tune: JSON sin devKey/spoofVcu → base64url → ?tune= */
    function shareTune() {
      const p = collectParams("mcu");
      const share = {
        v: 1,
        model: p.model,
        fwVcu: p.fwVcu,
        fwMcu: p.fwMcu,
        mcu: { flavor: p.mcu.flavor, engage: p.mcu.engage, cap: p.mcu.cap, scale: p.mcu.scale, punta: p.mcu.punta },
        vcu: { se: p.vcu.se, sd: p.vcu.sd, ss: p.vcu.ss, ce: p.vcu.ce, cd: p.vcu.cd, cs: p.vcu.cs }
      };
      try {
        const b = btoa(unescape(encodeURIComponent(JSON.stringify(share))));
        return location.origin + location.pathname + "?tune=" + b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      } catch (e) { return ""; }
    }
    function applyTune(code) {
      try {
        let t = String(code || "").replace(/-/g, "+").replace(/_/g, "/");
        while (t.length % 4) t += "=";
        const o = JSON.parse(decodeURIComponent(escape(atob(t))));
        if (!o || !o.mcu) return false;
        const fl = o.mcu.flavor;
        if (fl === "fwk" || fl === "ultra" || fl === "dpc4") {
          mcuFlavor = modelId() !== "g3" && fl === "dpc4" ? "fwk" : fl;
          const mapF = { fwk: "btnMcu", ultra: "btnMcuUltra", dpc4: "btnMcuDpc4" };
          Object.keys(mapF).forEach((k) => {
            const b = $("#" + mapF[k]);
            if (b) b.classList.toggle("is-on", k === mcuFlavor);
          });
        }
        setSliders(Number(o.mcu.engage) || 28, Number(o.mcu.cap) || 115, Number(o.mcu.scale) || 2300);
        const pp = $("#mcu-punta");
        if (pp) pp.value = String(Number(o.mcu.punta) || 327);
        if (o.vcu) setVcu(Number(o.vcu.se) || 16, Number(o.vcu.sd) || 25, Number(o.vcu.ss) || 55, Number(o.vcu.ce) || 25, Number(o.vcu.cd) || 55, Number(o.vcu.cs) || 100);
        syncLabels();
        showMcuPanels();
        paintSum();
        return true;
      } catch (e) { return false; }
    }
    on("#btnShareTune", "click", async () => {
      const url = shareTune();
      if (!url) return;
      const okMsg = (window.I18N && I18N.t && I18N.t("shareOk")) || "Share link copied";
      try { await navigator.clipboard.writeText(url); note(okMsg); } catch (e) { note(url); }
    });
    window.VexoraCfw = { build, summary, refreshBaseNote, shareTune, applyTune, _refreshFlags: loadFeatures };
  } catch (e) {
    console.error("cfw.js", e);
  }
})();

/* ═══ v2.3.1 · VXFW gate: la pestaña VXFW comprueba si el firmware custom está
   instalado. Stock → CTA "Flash VXFW — best tune (MCU + VCU)" que encadena el
   preset Balanced + flash MCU y, al confirmarse, el flash VCU. Flasheado → todo
   el tuning desbloqueado. ═══ */
(function VxfwGate() {
  const $ = (s) => document.querySelector(s);
  const tr = (k, f) => (window.I18N && I18N.t && I18N.t(k)) || f;
  let chained = false;

  function lockState() {
    const st = $("#motorCfwState");
    const txt = (st && st.textContent) || "";
    const marks = window.Vexora && Vexora.marks;
    if (/CFW|flashed/i.test(txt)) return true;
    if (marks && (marks.vcu || marks.mcu)) return true;
    return false;
  }
  function setLock(locked) {
    document.querySelectorAll("#view-vxfw [data-vxfw-lock]").forEach(function (el) { el.hidden = locked; });
  }
  function probe() {
    const view = $("#view-vxfw");
    if (!view) return;
    /* switch admin: sin body.mode-vxfw la pestaña VXFW no existe → no lockear nada */
    if (!document.body.classList.contains("mode-vxfw")) return;
    const hint = $("#vxfwGateHint"), note = $("#vxfwGateNote"), act = $("#vxfwGateAct");
    if (!hint || !note || !act) return;
    const V = window.Vexora;
    const sess = V && V.getSession && V.getSession();
    const connected = !!(sess && !sess.dead && !sess.demo);
    if (!connected) {
      hint.textContent = "—";
      note.textContent = tr("vxfwConnect", "Connect your scooter to check.");
      note.className = "note";
      act.style.display = "none";
      setLock(true);
      return;
    }
    if (lockState()) {
      hint.textContent = tr("vxfwActive", "active");
      hint.style.color = "var(--ok)";
      note.textContent = tr("vxfwActiveMsg", "VXFW detected — tune everything below.");
      note.className = "note ok";
      act.style.display = "none";
      setLock(false);
    } else {
      hint.textContent = tr("vxfwStock", "stock");
      hint.style.color = "var(--danger)";
      note.className = "note err";
      /* el tune 1-clic encadena MCU+VCU de G3: solo tiene sentido en Max G3 */
      let model = "g3";
      try { model = localStorage.getItem("vexora.model") || "g3"; } catch (e) {}
      if (model !== "g3") {
        note.textContent = tr("vxfwOther", "VXFW one-click tune is for Max G3 right now.") + (model === "zt3" ? " " + tr("vxfwZt3", "ZT3 Pro: use the ZT3 controller firmware card below.") : "");
        act.style.display = "none";
      } else {
        note.textContent = tr("vxfwStockMsg", "Stock firmware detected — flash VXFW to unlock tuning.");
        act.style.display = "flex";
      }
      setLock(true);
    }
  }
  /* encadenado: Balanced → flash MCU → (espera confirmación) → flash VCU */
  async function bestTune() {
    if (chained) return;
    let model = "g3";
    try { model = localStorage.getItem("vexora.model") || "g3"; } catch (e) {}
    if (model !== "g3") return; /* el encadenado MCU+VCU es de G3 */
    chained = true;
    const btn = $("#btnVxfwBest");
    const btnTxt = btn ? btn.textContent : "";
    try {
      if (btn) { btn.disabled = true; btn.textContent = tr("bVxfwFlashing", "Flashing VXFW… keep this open"); }
      const note = $("#vxfwGateNote");
      if (note) note.textContent = tr("vxfwStepMcu", "Flashing best tune — MCU (motor)… keep the scooter on.");
      const pb = $("#presetBest"); if (pb) pb.click();
      const bm = $("#btnMcu"); if (bm) bm.click();
      const t0 = Date.now();
      while (Date.now() - t0 < 480000) {
        await new Promise((r) => setTimeout(r, 2500));
        if (window.VexoraLive && VexoraLive.probeMotorCfw) { try { await VexoraLive.probeMotorCfw(); } catch (e) {} }
        if (lockState()) break;
        if (note) note.textContent = tr("vxfwStepMcu", "Flashing best tune — MCU (motor)… keep the scooter on.") + " (" + Math.round((Date.now() - t0) / 1000) + "s)";
      }
      if (note) note.textContent = tr("vxfwStepVcu", "MCU done — now VCU (controller)…");
      const bv = $("#btnVcu"); if (bv) bv.click();
      if (note) note.textContent = tr("vxfwStepVcu", "MCU done — now VCU (controller)…") + " (" + Math.round((Date.now() - t0) / 1000) + "s)";
    } finally {
      chained = false;
      if (btn) { btn.disabled = false; btn.textContent = btnTxt; }
    }
  }
  const btn = $("#btnVxfwBest");
  if (btn) btn.addEventListener("click", bestTune);
  document.addEventListener("click", function (e) {
    const el = e.target.closest && e.target.closest('[data-view="vxfw"]');
    if (el) setTimeout(probe, 60);
  });
  window.addEventListener("hashchange", function () {
    if ((location.hash || "").replace("#", "") === "vxfw") setTimeout(probe, 60);
  });
  setInterval(function () {
    const v = $("#view-vxfw");
    if (v && v.classList.contains("active")) probe();
  }, 4000);
  probe();
})();
