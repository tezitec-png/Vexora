(() => {
  "use strict";
  const KEY = "vexora.consent";
  const OPTIONAL = [ "nexo.sessions", "nbc_", "vexora.cfw.", "vexora.lastTrip" ];
  function current() {
    try {
      return localStorage.getItem(KEY) === "all" ? "all" : "min";
    } catch (e) {
      return "min";
    }
  }
  let mode = current();
  const realSet = Storage.prototype.setItem.bind(localStorage);
  const realDel = Storage.prototype.removeItem.bind(localStorage);
  function isOptional(k) {
    return OPTIONAL.some(p => k.indexOf(p) === 0);
  }
  Storage.prototype.setItem = function(k, v) {
    if (this === localStorage && mode !== "all" && isOptional(String(k))) return;
    return realSet(k, v);
  };
  function set(next) {
    mode = next === "all" ? "all" : "min";
    try {
      realSet(KEY, mode);
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("vexora-consent", {
        detail: mode
      }));
    } catch (e) {}
  }
  function clearAll() {
    const doomed = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^(vexora\.|nexo\.|nbc_)/.test(k)) doomed.push(k);
      }
      doomed.forEach(k => realDel(k));
    } catch (e) {}
    return doomed.length;
  }
  function bannerVisible() {
    const b = document.getElementById("consentBar");
    return !!b && !b.hidden;
  }
  function show() {
    const b = document.getElementById("consentBar");
    if (b) b.hidden = false;
  }
  function hide() {
    const b = document.getElementById("consentBar");
    if (b) b.hidden = true;
  }
  function bind() {
    const b = document.getElementById("consentBar");
    if (!b) return;
    const t = k => window.I18N ? I18N.t(k) : k;
    const paint = () => {
      const el = id => b.querySelector(id);
      if (el("#cbTitle")) el("#cbTitle").textContent = t("consentTitle");
      if (el("#cbBody")) el("#cbBody").textContent = t("consentBody");
      if (el("#cbMin")) el("#cbMin").textContent = t("consentMin");
      if (el("#cbAll")) el("#cbAll").textContent = t("consentAll");
      if (el("#cbLink")) el("#cbLink").textContent = t("consentLink");
    };
    paint();
    window.addEventListener("vexora-lang", paint);
    b.querySelector("#cbMin").addEventListener("click", () => {
      set("min");
      hide();
    });
    b.querySelector("#cbAll").addEventListener("click", () => {
      set("all");
      hide();
    });
    b.querySelector("#cbLink").addEventListener("click", () => {
      try {
        window.showView && window.showView("privacy");
      } catch (e) {}
    });
    try {
      if (!localStorage.getItem(KEY)) b.hidden = false;
    } catch (e) {
      b.hidden = false;
    }
    const rc = document.getElementById("btnConsentReopen");
    if (rc) rc.addEventListener("click", show);
    const cd = document.getElementById("btnClearData");
    if (cd) cd.addEventListener("click", () => {
      const n = clearAll();
      const out = document.getElementById("privacyNote");
      if (out && window.I18N) out.textContent = I18N.t("dataCleared") + " (" + n + ")";
      mode = "min";
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
  window.Consent = {
    get mode() {
      return mode;
    },
    set: set,
    clearAll: clearAll,
    show: show,
    hide: hide,
    bannerVisible: bannerVisible
  };
})();