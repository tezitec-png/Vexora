(() => {
  const doc = document;
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => Array.from(r.querySelectorAll(s));
  const REDUCE = (() => {
    try {
      return matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  })();
  function bootDone() {
    const b = $("#vexBoot");
    if (!b || b.classList.contains("is-done")) return;
    b.classList.add("is-done");
    doc.documentElement.classList.add("vex-ready");
    setTimeout(() => {
      try {
        b.remove();
      } catch (e) {
        b.setAttribute("hidden", "");
      }
    }, 900);
  }
  if (doc.readyState === "complete") setTimeout(bootDone, 340); else window.addEventListener("load", () => setTimeout(bootDone, 420));
  setTimeout(bootDone, 2800);
  const bar = doc.createElement("div");
  bar.className = "vex-bar";
  bar.setAttribute("aria-hidden", "true");
  doc.body.appendChild(bar);
  let barT = [];
  function navPulse() {
    if (REDUCE) return;
    barT.forEach(clearTimeout);
    bar.style.transition = "none";
    bar.style.width = "0%";
    bar.classList.remove("go");
    void bar.offsetWidth;
    bar.style.transition = "";
    bar.classList.add("go");
    barT = [ setTimeout(() => {
      bar.style.width = "62%";
    }, 40), setTimeout(() => {
      bar.style.width = "100%";
    }, 300), setTimeout(() => {
      bar.classList.remove("go");
    }, 520), setTimeout(() => {
      bar.style.transition = "none";
      bar.style.width = "0%";
      setTimeout(() => {
        bar.style.transition = "";
      }, 40);
    }, 900) ];
  }
  const tabs = $(".tabs");
  let ink = null;
  if (tabs) {
    ink = doc.createElement("span");
    ink.className = "tab-ink";
    ink.setAttribute("aria-hidden", "true");
    tabs.appendChild(ink);
  }
  function moveInk() {
    if (!tabs || !ink) return;
    const b = tabs.querySelector("button.active");
    if (!b) {
      ink.classList.remove("ready");
      return;
    }
    ink.style.width = b.offsetWidth + "px";
    ink.style.transform = "translateX(" + b.offsetLeft + "px)";
    ink.classList.add("ready");
  }
  function stagger() {
    const view = $(".view.active");
    if (!view) return;
    const items = view.querySelectorAll(".card, .stat, .model, .people > div, .steps-list li, .chk, .glist > div, .gloss > div, .faq details, .bullets li");
    items.forEach((el, i) => {
      el.style.setProperty("--i", String(Math.min(i, 14)));
      el.classList.remove("vex-in");
      void el.offsetWidth;
      el.classList.add("vex-in");
    });
  }
  function decorate() {
    navPulse();
    stagger();
    moveInk();
    if (!REDUCE && window.scrollY > 4) {
      try {
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    }
  }
  const origShow = window.showView;
  if (typeof origShow === "function") {
    window.showView = function(name) {
      const r = origShow.apply(this, arguments);
      requestAnimationFrame(decorate);
      return r;
    };
  } else {
    doc.addEventListener("click", e => {
      if (e.target.closest("[data-view],[data-go]")) requestAnimationFrame(decorate);
    });
  }
  let rz = null;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      moveInk();
    }, 120);
  });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => moveInk()).catch(() => {});
  window.addEventListener("vexora:model", () => moveInk());
  requestAnimationFrame(() => {
    moveInk();
    stagger();
  });
  const guideList = $("#guideCheck");
  if (guideList) {
    const KEY = "vexora.guide";
    let state = {};
    try {
      state = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch (e) {
      state = {};
    }
    guideList.querySelectorAll("input[data-gchk]").forEach(inp => {
      const k = inp.getAttribute("data-gchk");
      inp.checked = !!state[k];
      inp.addEventListener("change", () => {
        state[k] = inp.checked;
        try {
          localStorage.setItem(KEY, JSON.stringify(state));
        } catch (e) {}
      });
    });
  }
  if (!REDUCE) {
    const pulse = el => {
      el.classList.remove("vex-pop");
      void el.offsetWidth;
      el.classList.add("vex-pop");
      setTimeout(() => el.classList.remove("vex-pop"), 420);
    };
    const watch = [ "#vSpeed", "#vBat", "#vRange", "#vPow", "#vWatts" ];
    watch.forEach(sel => {
      const el = $(sel);
      if (!el) return;
      let last = el.textContent;
      new MutationObserver(() => {
        const t = el.textContent;
        if (t === last) return;
        last = t;
        if (/^[\d.,]+$/.test(String(t))) pulse(el);
      }).observe(el, {
        childList: true,
        characterData: true,
        subtree: true
      });
    });
  }
  const gate = $("#gate");
  const shot = $("#gateShot");
  if (gate && shot && !REDUCE && matchMedia("(hover: hover)").matches) {
    gate.addEventListener("pointermove", e => {
      const r = gate.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5;
      const y = (e.clientY - r.top) / r.height - .5;
      shot.style.transform = "translate3d(" + (x * 14).toFixed(2) + "px," + (y * 10).toFixed(2) + "px,0) rotateY(" + (x * 5).toFixed(2) + "deg)";
    });
    gate.addEventListener("pointerleave", () => {
      shot.style.transform = "";
    });
  }
})();