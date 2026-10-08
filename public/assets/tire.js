(() => {
  try {
    const $ = s => document.querySelector(s);
    const $$ = s => [ ...document.querySelectorAll(s) ];
    const on = (id, ev, fn) => {
      const el = typeof id === "string" ? $(id) : id;
      if (el) el.addEventListener(ev, fn);
    };
    const t = (k, fallback) => window.I18N && I18N.t && I18N.t(k) || fallback || k;
    const S = {
      model: null,
      list: [],
      base: null,
      inch: 11,
      busy: false,
      enabled: true,
      sig: "",
      userPicked: false
    };
    let optionsPromise = null;
    function options() {
      if (!optionsPromise) {
        optionsPromise = fetch("/api/tire/options", {
          cache: "no-store"
        }).then(async r => {
          if (r.status === 403 || r.status === 503) {
            const jb = await r.json().catch(() => null);
            if (jb && jb.error === "banned" && window.Vexora && Vexora.showBan) Vexora.showBan(jb.reason);
            if (jb && jb.error === "maintenance" && window.Vexora && Vexora.showMaint) Vexora.showMaint();
            return null;
          }
          if (window.Vexora && Vexora.hideMaint) Vexora.hideMaint();
          return r.json();
        }).catch(() => null);
      }
      return optionsPromise;
    }
    function status(msg, cls) {
      const el = $("#tireStatus");
      if (el) {
        el.textContent = msg || "";
        el.className = "note" + (cls ? " " + cls : "");
      }
    }
    async function syncModel(preserve) {
      S.model = window.Vexora && Vexora.model || "g3";
      const opts = await options();
      const enabled = !(opts && opts.ok && opts.enabled === false);
      const list = opts && opts.ok && opts.models && opts.models[S.model] || [];
      const fw = String(window.Vexora && Vexora.fwMcu || "");
      const fwOk = fw && fw !== "—" && fw !== "err" && fw !== "undefined";
      const sig = enabled + "|" + list.map(b => b.v).join(",") + "|" + fw + "|" + (S.userPicked ? 1 : 0);
      if (preserve && sig === S.sig) return;
      S.sig = sig;
      S.enabled = enabled;
      S.list = list;
      const off = $("#tireOff"), na = $("#tireNa"), controls = $("#tireControls"), sel = $("#tireBase");
      if (!enabled) {
        S.base = null;
        if (off) off.hidden = false;
        if (na) na.hidden = true;
        if (controls) controls.hidden = true;
        if (sel) sel.innerHTML = "";
        status("");
        return;
      }
      if (off) off.hidden = true;
      if (!list.length) {
        S.base = null;
        if (sel) sel.innerHTML = "";
        if (controls) controls.hidden = true;
        if (na) na.hidden = false;
        status("");
        return;
      }
      if (na) na.hidden = true;
      if (sel) {
        sel.innerHTML = "";
        S.list.forEach((b, i) => {
          const o = document.createElement("option");
          o.value = String(i);
          o.textContent = "Stock MCU " + b.v + " · " + b.stockInch + "″ / " + b.stockMm + " mm";
          sel.appendChild(o);
        });
        sel.value = "0";
      }
      let idx = 0;
      if (S.userPicked && S.base) {
        const c = S.list.findIndex(b => String(b.v) === String(S.base.v));
        if (c >= 0) idx = c;
      } else if (fwOk) {
        const m = S.list.findIndex(b => String(b.v) === fw);
        if (m >= 0) idx = m;
      }
      if (sel) sel.value = String(idx);
      pickBase(idx);
      const bn = $("#tireBaseNote");
      if (bn) {
        let noteTxt = "";
        if (fwOk) {
          const cfw = !!(window.VEXORA && VEXORA.isMcu && VEXORA.isMcu(fw));
          const m = S.list.findIndex(b => String(b.v) === fw);
          noteTxt = cfw ? t("wheelCfwWarn", "Your scooter runs Vexora CFW — this flash returns the motor to stock tuning.") : m >= 0 ? t("wheelMatched", "Matched to your scooter — MCU {v}").replace("{v}", fw) : t("wheelNoMatch", "Your scooter runs MCU {v} — using base {base}.").replace("{v}", fw).replace("{base}", String((S.list[idx] || {}).v || ""));
        }
        bn.textContent = noteTxt;
      }
      if (controls) controls.hidden = false;
    }
    async function refresh() {
      optionsPromise = null;
      return syncModel(true);
    }
    function pickBase(i) {
      S.base = S.list[i] || null;
      if (!S.base) return;
      S.inch = S.base.stockInch;
      syncUI();
      paintResult();
    }
    function targetMm() {
      if (!S.base) return 0;
      const mm = S.inch * S.base.stockMm / S.base.stockInch;
      return Math.max(2, Math.min(550, mm));
    }
    function syncUI() {
      const inch = $("#tireInch");
      if (inch) inch.value = String(S.inch);
      const lab = document.querySelector('[data-for="tireInch"]');
      if (lab) lab.textContent = S.inch.toFixed(1);
      $$("#tireInches button").forEach(b => b.classList.toggle("is-on", Number(b.dataset.inch) === S.inch));
    }
    function paintResult() {
      if (!S.base) return;
      const el = $("#tireResult"), mmEl = $("#tireMm");
      const mm = targetMm();
      const cur = S.base.stockMm;
      const speedo = (cur / mm).toFixed(2);
      if (el) {
        el.textContent = "→ " + S.inch.toFixed(1) + "″ · " + Math.round(mm) + " mm (" + t("wheelWas", "was") + " " + cur + " mm) · " + t("wheelSpeedo", "speedo reads") + " ×" + speedo;
      }
      if (mmEl) mmEl.textContent = Math.round(mm) + " mm";
    }
    on($("#tireBase"), "change", e => {
      S.userPicked = true;
      pickBase(Number(e.target.value) || 0);
    });
    $$("#tireInches button").forEach(b => on(b, "click", () => {
      S.inch = Number(b.dataset.inch);
      syncUI();
      paintResult();
    }));
    on($("#tireInch"), "input", e => {
      S.inch = Math.round(Number(e.target.value) * 10) / 10;
      syncUI();
      paintResult();
    });
    try {
      window.addEventListener("vexora:model", () => {
        syncModel();
      });
    } catch (e) {}
    on("#tireFlash", "click", async () => {
      if (!S.base || S.busy) return;
      S.busy = true;
      status(t("wheelBuilding", "Building on the server…"), "");
      try {
        const r = await fetch("/api/tire/build", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: S.model,
            version: S.base.v,
            inch: S.inch
          })
        });
        const j = await r.json().catch(() => null);
        if (j && j.error === "banned" && window.Vexora && Vexora.showBan) {
          Vexora.showBan(j.reason);
          return;
        }
        if (j && j.error === "maintenance" && window.Vexora && Vexora.showMaint) {
          Vexora.showMaint();
          return;
        }
        if (!r.ok || !j || !j.ok) throw new Error(j && j.error || "Build failed (" + r.status + ")");
        const bin = atob(j.enc);
        const enc = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) enc[i] = bin.charCodeAt(i);
        window.lastBuiltFirmwareEnc = enc;
        window.lastBuiltPartition = "mcu";
        status(t("wheelBuilt", "Built") + " · " + j.mm + " mm — " + t("wheelFlashing", "flashing…"), "ok");
        try {
          window.__vexoraFlashSource = "tire";
        } catch (e) {}
        window.__vexoraTireVerify = null;
        if (window.Vexora && Vexora.flashFile) {
          await Vexora.flashFile("mcu");
          const vv = window.__vexoraTireVerify;
          const inch = S.inch.toFixed(1), mm = String(j.mm);
          const packVer = v => {
            let w = 0;
            String(v).split(".").forEach(p => {
              w = (w << 4 | Number(p) & 15) >>> 0;
            });
            const o = [];
            let n = w >>> 0;
            do {
              o.unshift(n & 15);
              n >>>= 4;
            } while (n > 0 || o.length < 3);
            return o.join(".");
          };
          if (vv && vv.version && (String(vv.version) === String(S.base.v) || String(vv.version) === packVer(S.base.v))) {
            status("✓ " + t("wheelVerOk", "Verified: {inch}″ · {mm} mm are on your scooter.").replace("{inch}", inch).replace("{mm}", mm), "ok");
          } else if (vv && vv.version) {
            status(t("wheelVerDiff", "Flashed, but the scooter reports MCU {v} — turn it off and on, then reconnect and check.").replace("{v}", String(vv.version)), "");
          } else {
            status(t("wheelVerNo", "Flashed {inch}″ · {mm} mm — turn it off and on once.").replace("{inch}", inch).replace("{mm}", mm), "ok");
          }
        } else status("flashFile missing");
      } catch (e) {
        const msg = String(e.message || e);
        status("✗ " + (/Failed to fetch|NetworkError/i.test(msg) ? t("wheelNet", "Could not reach the server — check your connection and try again") : msg));
      } finally {
        S.busy = false;
      }
    });
    syncModel(false);
    setInterval(refresh, 5e3);
    window.VexoraTire = {
      syncModel: syncModel,
      refresh: refresh,
      state: S,
      targetMm: targetMm
    };
  } catch (e) {
    console.error("tire.js", e);
  }
})();