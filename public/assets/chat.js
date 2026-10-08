(function() {
  "use strict";
  try {
    if (window.__vexoraChat) return;
    window.__vexoraChat = 1;
    var LS = "vexora.livechat";
    function loadSess() {
      try {
        return JSON.parse(localStorage.getItem(LS) || "null");
      } catch (e) {
        return null;
      }
    }
    function saveSess(s) {
      try {
        if (s) localStorage.setItem(LS, JSON.stringify(s)); else localStorage.removeItem(LS);
      } catch (e) {}
    }
    function esc(s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function hhmm(ts) {
      try {
        return new Date(ts).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit"
        });
      } catch (e) {
        return "";
      }
    }
    var st = {
      sess: loadSess(),
      open: false,
      lastId: 0,
      status: "",
      agent: "",
      unread: 0,
      timer: null,
      sending: false,
      seen: {},
      rated: false,
      rts: 0,
      nudge: 0
    };
    if (st.sess && st.sess.nudge) st.nudge = st.sess.nudge;
    var css = [ "#vcw-root{--vcw-ink:#0b0c0e;--vcw-line:#26282d;--vcw-dim:#9aa0a8;font-family:Montserrat,system-ui,sans-serif;position:fixed;z-index:99990;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));}", "@media (max-width:620px){#vcw-root{bottom:calc(88px + env(safe-area-inset-bottom));}}", "#vcw-bub{position:relative;width:56px;height:56px;border-radius:50%;border:1px solid var(--vcw-line);background:#141518;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.45);transition:transform .15s ease;}", "#vcw-bub:hover{transform:translateY(-2px);}", "#vcw-bub svg{width:26px;height:26px;}", "#vcw-dot{position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #0a0b0d;display:none;}", "#vcw-panel{display:none;flex-direction:column;width:min(340px,calc(100vw - 28px));height:min(460px,72vh);background:#101114;border:1px solid var(--vcw-line);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden;}", "#vcw-root.open #vcw-panel{display:flex;}", "#vcw-root.open #vcw-bub{display:none;}", "#vcw-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#17181c;border-bottom:1px solid var(--vcw-line);}", "#vcw-head .t{font-weight:800;font-size:13px;letter-spacing:.08em;color:#fff;}", "#vcw-head .s{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--vcw-dim);}", "#vcw-head .st-dot{width:8px;height:8px;border-radius:50%;background:#5a5f68;}", "#vcw-head .st-dot.live{background:#fff;box-shadow:0 0 8px rgba(255,255,255,.8);}", "#vcw-x{margin-left:auto;background:none;border:0;color:var(--vcw-dim);cursor:pointer;font-size:18px;line-height:1;padding:4px 6px;border-radius:8px;}", "#vcw-x:hover{color:#fff;background:rgba(255,255,255,.06);}", "#vcw-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;}", "#vcw-msgs::-webkit-scrollbar{width:8px}#vcw-msgs::-webkit-scrollbar-thumb{background:#3a3d44;border-radius:99px}", ".vcw-m{max-width:78%;min-width:0;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;font-weight:600;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;}", ".vcw-m.agent{align-self:flex-start;background:#1b1d21;border:1px solid var(--vcw-line);border-bottom-left-radius:4px;}", ".vcw-m.visitor{align-self:flex-end;background:#fff;color:var(--vcw-ink);border-bottom-right-radius:4px;}", ".vcw-m.system{align-self:center;background:transparent;color:var(--vcw-dim);font-size:11.5px;font-weight:700;padding:2px 6px;}", ".vcw-m .t{display:block;font-size:10px;font-weight:700;color:var(--vcw-dim);margin-top:3px;opacity:.8;}", "#vcw-form{padding:10px;border-top:1px solid var(--vcw-line);display:flex;gap:8px;background:#121316;}", "#vcw-form input,#vcw-form textarea{flex:1;background:#1b1d21;border:1px solid var(--vcw-line);border-radius:10px;color:#f2f3f4;font:inherit;font-size:13.5px;padding:9px 11px;outline:none;resize:none;}", "#vcw-form input:focus,#vcw-form textarea:focus{border-color:#fff;}", ".vcw-btn{background:#fff;color:var(--vcw-ink);border:0;border-radius:10px;font:inherit;font-weight:800;font-size:13px;padding:9px 14px;cursor:pointer;}", ".vcw-btn:hover{filter:brightness(.92)}", ".vcw-btn[disabled]{opacity:.5;pointer-events:none}", "#vcw-start{display:flex;flex-direction:column;gap:8px;padding:10px;border-top:1px solid var(--vcw-line);background:#121316;}", "#vcw-start input,#vcw-start textarea{background:#1b1d21;border:1px solid var(--vcw-line);border-radius:10px;color:#f2f3f4;font:inherit;font-size:13.5px;padding:9px 11px;outline:none;resize:none;}", "#vcw-start input:focus,#vcw-start textarea:focus{border-color:#fff;}", "#vcw-start .hint{color:var(--vcw-dim);font-size:11px;font-weight:600;}", "#vcw-closed{padding:18px 14px;text-align:center;}", "#vcw-closed p{color:var(--vcw-dim);font-size:13px;font-weight:600;margin:0 0 12px;}", ".vcw-stars{display:flex;gap:6px;justify-content:center;margin-bottom:12px;}", ".vcw-star{background:none;border:0;font-size:26px;line-height:1;color:#3a3d44;cursor:pointer;padding:2px;transition:transform .1s ease,color .1s ease;}", ".vcw-star:hover{transform:scale(1.15);}", ".vcw-star.on{color:#fff;}", "#vcw-typing{display:none;align-items:center;gap:7px;color:var(--vcw-dim);font-size:11px;font-weight:700;padding:4px 12px 6px;}", "#vcw-closed .vcw-btn{margin:4px 3px 0;}", "#vcw-mute{background:none;border:0;color:#9aa0a8;cursor:pointer;padding:4px 6px;border-radius:8px;}", "#vcw-mute:hover{color:#fff;}", ".vcw-m.bot{align-self:flex-start;background:#fff;color:var(--vcw-ink);border-bottom-left-radius:4px;}", ".vcw-m .mimg{display:block;max-width:200px;max-height:170px;border-radius:10px;margin:2px 0 3px;cursor:pointer;}", ".vcw-m .mimg.big{max-width:100%;max-height:none;}", ".vcw-m audio{display:block;width:200px;margin:2px 0 3px;height:36px;}", ".vcw-tr{display:block;margin-top:5px;padding-top:4px;border-top:1px dashed rgba(0,0,0,.18);font-size:12px;font-weight:600;color:#374151;}", ".vcw-tr b{font-size:9px;font-weight:800;letter-spacing:.1em;color:#6b7280;display:block;margin-bottom:1px;}", ".vcw-m.agent .vcw-tr,.vcw-m.bot .vcw-tr{border-top-color:rgba(255,255,255,.22);color:#e5e7eb;}", ".vcw-m.agent .vcw-tr b,.vcw-m.bot .vcw-tr b{color:#9ca3af;}", "#vcw-msgs .tick{font-weight:800;letter-spacing:-.08em;margin-left:2px;}", "#vcw-msgs .tick.read{color:#4da3ff;}", "#vcw-model{background:#1b1d21;border:1px solid var(--vcw-line);border-radius:10px;color:#f2f3f4;font:inherit;font-size:13.5px;padding:9px 11px;outline:none;width:100%;box-sizing:border-box;}", "#vcw-model:focus{border-color:#fff;}", "#vcw-start .err{color:#ff6b70;font-size:11px;font-weight:700;min-height:14px;margin:0;}", "#vcw-form{align-items:flex-end;}", ".vcw-icon{background:#1b1d21;border:1px solid var(--vcw-line);border-radius:10px;color:#9aa0a8;width:38px;height:38px;flex:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}", ".vcw-icon:hover{color:#fff;border-color:#3a3d44;}", ".vcw-icon svg{width:17px;height:17px;}", ".vcw-icon.rec{border-color:#e5484d;color:#e5484d;animation:vcwPulse 1s infinite;}", "@keyframes vcwPulse{50%{opacity:.45}}", "#vcw-thanks{background:#16341f;border:1px solid #2c9b52;border-radius:12px;padding:12px 10px;margin-top:8px;}", "#vcw-thanks .big{color:#4ade80;font-weight:800;font-size:14px;margin:0 0 4px;}", "#vcw-thanks .sub{color:#a7f3c9;font-size:12px;font-weight:600;margin:0;}", , ".vcw-m.bot:before{content:'AI';display:block;font-size:9px;font-weight:800;letter-spacing:.14em;color:#6b7280;margin-bottom:2px;}", "body.vcw-lock{overflow:hidden;}", "#vcw-root.open #vcw-panel{animation:vcwUp .2s ease;}", "@keyframes vcwIn{from{opacity:0;transform:translateY(7px) scale(.98)}to{opacity:1;transform:none}}", ".vcw-m{animation:vcwIn .22s ease;}", ".vcw-m.system{background:rgba(255,255,255,.055);border-radius:999px;padding:4px 11px;}", ".vcw-btn:active{transform:scale(.95);}", ".vcw-icon:active{transform:scale(.9);}", "#vcw-photo:hover,#vcw-mic:hover{transform:translateY(-1px);}", ".tdots{display:inline-flex;gap:3px;align-items:center;}", ".tdots i{width:6px;height:6px;border-radius:50%;background:#9aa0a8;animation:tdot 1.1s infinite;}", ".tdots i:nth-child(2){animation-delay:.15s}.tdots i:nth-child(3){animation-delay:.3s}", "@keyframes tdot{0%,60%,100%{transform:none;opacity:.45}30%{transform:translateY(-4px);opacity:1}}", ".vcw-note{color:#ffb86b;font-size:11px;font-weight:700;padding:2px 12px 4px;}", "#vcw-nudge{display:none;margin:8px 10px 0;padding:10px 12px;border-radius:12px;background:#191a1f;border:1px solid #3a3d44;cursor:pointer;}", "#vcw-nudge.on{display:block;animation:vcwUp .22s ease;}", "#vcw-nudge b{display:block;font-size:13px;color:#fff;}", "#vcw-nudge span{display:block;font-size:11.5px;color:#9aa0a8;margin-top:2px;font-weight:600;}", "#vcw-waitbar{display:none;gap:8px;padding:7px 10px 0;}", "#vcw-waitbar.on{display:flex;}", "#vcw-waitbar .wbtn{flex:1;background:transparent;border:1px dashed var(--vcw-line);color:var(--vcw-dim);border-radius:10px;font:inherit;font-size:12px;font-weight:700;padding:8px 6px;cursor:pointer;transition:transform .12s ease,border-color .12s ease,color .12s ease;}", "#vcw-waitbar .wbtn:hover{color:#fff;border-color:#3a3d44;}", "#vcw-waitbar .wbtn:active{transform:scale(.96);}", "@keyframes vcwUp{from{transform:translateY(16px);opacity:.35}to{transform:none;opacity:1}}", "@media (max-width:620px){#vcw-root.open{left:0;top:0;right:0;bottom:0;}", "#vcw-root.open #vcw-panel{width:100%;height:100%;max-height:none;border-radius:0;border:0;animation:vcwUp .18s ease;}", "#vcw-msgs{padding:12px 10px;}.vcw-m{max-width:84%;font-size:14px;}", "#vcw-form{padding-bottom:calc(10px + env(safe-area-inset-bottom));}}" ].join("\n");
    var root = document.createElement("div");
    root.id = "vcw-root";
    root.innerHTML = "<style>" + css + "</style>" + '<div id="vcw-panel">' + '  <div id="vcw-head">' + '    <div><div class="t">VEXORA SUPPORT</div><div class="s"><span class="st-dot" id="vcw-stdot"></span><span id="vcw-sttxt">Live chat</span></div></div>' + '    <button id="vcw-mute" aria-label="Sound on/off"></button>' + '    <button id="vcw-x" aria-label="Close chat">×</button>' + "  </div>" + '  <div id="vcw-msgs"></div>' + '  <div id="vcw-typing"><span class="tdots"><i></i><i></i><i></i></span>Agent is typing…</div>' + '  <div class="vcw-note" id="vcw-note" style="display:none"></div>' + '  <div id="vcw-nudge"><b>💬 You still have an open chat with support</b><span>Tap here to jump back in — the team is waiting</span></div>' + '  <div id="vcw-waitbar">' + '    <button class="wbtn" id="vcw-wcancel">Cancel request</button>' + '    <button class="wbtn" id="vcw-wai">Get AI help</button>' + "  </div>" + '  <div id="vcw-start">' + '    <input id="vcw-model" maxlength="40" placeholder="Scooter model (required) — e.g. Ninebot Max G30" autocomplete="off">' + '    <textarea id="vcw-q" rows="2" maxlength="700" placeholder="Describe your problem (required)"></textarea>' + '    <p class="err" id="vcw-err"></p>' + '    <button class="vcw-btn" id="vcw-go">Start chat</button>' + '    <div class="hint">Free · a real agent joins the chat · usually replies in minutes</div>' + "  </div>" + '  <div id="vcw-form" style="display:none">' + '    <button class="vcw-icon" id="vcw-photo" aria-label="Send photo" title="Send a photo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2.5"/><circle cx="12" cy="13" r="3.4"/><path d="M8.5 6l1.2-2h4.6l1.2 2"/></svg></button>' + '    <button class="vcw-icon" id="vcw-mic" aria-label="Send voice note" title="Record a voice note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg></button>' + '    <textarea id="vcw-in" rows="1" maxlength="700" placeholder="Write a message…"></textarea>' + '    <button class="vcw-btn" id="vcw-send">Send</button>' + "  </div>" + "</div>" + '<button id="vcw-bub" aria-label="Open live chat">' + '  <svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5h16v10.5H9.5L5.5 20v-4H4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 9.3h8M8 12.3h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' + '  <span id="vcw-dot"></span>' + "</button>";
    document.body.appendChild(root);
    var $ = function(id) {
      return document.getElementById(id);
    };
    var msgsEl = $("vcw-msgs");
    var AC = null, armed = false, vcwMuted = false;
    try {
      vcwMuted = localStorage.getItem("vexora.chat.mute") === "1";
    } catch (e) {}
    document.addEventListener("pointerdown", function() {
      armed = true;
      try {
        AC = AC || new (window.AudioContext || window.webkitAudioContext);
        if (AC && AC.state === "suspended") AC.resume();
      } catch (e) {}
    }, {
      passive: true
    });
    function tone(fr, at, dur, vol, type) {
      var o = AC.createOscillator(), g = AC.createGain(), o2 = AC.createOscillator(), g2 = AC.createGain();
      o.type = type || "sine";
      o.frequency.value = fr;
      g.gain.setValueAtTime(1e-4, AC.currentTime + at);
      g.gain.exponentialRampToValueAtTime(vol, AC.currentTime + at + .02);
      g.gain.exponentialRampToValueAtTime(1e-4, AC.currentTime + at + dur);
      o.connect(g);
      g.connect(AC.destination);
      o.start(AC.currentTime + at);
      o.stop(AC.currentTime + at + dur + .05);
      o2.type = "sine";
      o2.frequency.value = fr * 2;
      g2.gain.setValueAtTime(1e-4, AC.currentTime + at);
      g2.gain.exponentialRampToValueAtTime(vol * .5, AC.currentTime + at + .02);
      g2.gain.exponentialRampToValueAtTime(1e-4, AC.currentTime + at + dur);
      o2.connect(g2);
      g2.connect(AC.destination);
      o2.start(AC.currentTime + at);
      o2.stop(AC.currentTime + at + dur + .05);
    }
    function sfx(kind) {
      if (vcwMuted || !armed) return;
      try {
        AC = AC || new (window.AudioContext || window.webkitAudioContext);
        if (AC.state === "suspended") AC.resume();
        if (kind === "accept") {
          tone(523, 0, .18, .3);
          tone(784, .16, .26, .3);
        } else if (kind === "msg") {
          tone(740, 0, .14, .26, "triangle");
        } else if (kind === "nudge") {
          tone(740, 0, .16, .3);
          tone(988, .15, .26, .3);
        }
      } catch (e) {}
    }
    function paintMute() {
      var b = $("vcw-mute");
      if (!b) return;
      b.innerHTML = vcwMuted ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>' : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
      b.title = vcwMuted ? "Sound off" : "Sound on";
    }
    paintMute();
    $("vcw-mute").addEventListener("click", function() {
      vcwMuted = !vcwMuted;
      try {
        localStorage.setItem("vexora.chat.mute", vcwMuted ? "1" : "0");
      } catch (e) {}
      paintMute();
      if (!vcwMuted) {
        armed = true;
        sfx("msg");
      }
    });
    function askNotif() {
      try {
        if (window.Notification && Notification.permission === "default") Notification.requestPermission();
      } catch (e) {}
    }
    function notify(body) {
      try {
        if (!window.Notification || Notification.permission !== "granted" || !document.hidden) return;
        var n = new Notification("Vexora Support", {
          body: body
        });
        n.addEventListener("click", function() {
          try {
            window.focus();
          } catch (e) {}
        });
      } catch (e) {}
    }
    function statusUI() {
      var live = st.status === "active";
      $("vcw-stdot").className = "st-dot" + (live ? " live" : "");
      var botOn = st.status === "waiting" && msgsEl.querySelector(".vcw-m.bot");
      $("vcw-sttxt").textContent = st.status === "active" ? "Chatting with " + (st.agent || "support") : st.status === "closed" ? "Chat closed" : botOn ? "AI assistant · agents offline" : st.sess ? "Searching for an agent…" : "Live chat";
      var hasSess = !!st.sess && st.status !== "closed";
      $("vcw-start").style.display = !st.sess ? "" : "none";
      $("vcw-form").style.display = st.sess && st.status !== "closed" ? "" : "none";
      $("vcw-msgs").style.display = st.sess || st.status ? "" : "none";
      var xBtn = $("vcw-x");
      if (xBtn) {
        var lockX = !!(st.sess && (st.status === "waiting" || st.status === "active"));
        var mustRate = !!(st.sess && st.status === "closed" && st.agent && !st.rated);
        xBtn.style.display = lockX || mustRate ? "none" : "";
      }
    }
    function addMsg(m, noScroll) {
      if (m.id != null) {
        if (st.seen[m.id]) return;
        if (msgsEl.querySelector('[data-mid="' + m.id + '"]')) {
          st.seen[m.id] = 1;
          return;
        }
        st.seen[m.id] = 1;
      }
      var d = document.createElement("div");
      if (m.id != null) d.setAttribute("data-mid", m.id);
      d.className = "vcw-m " + esc(m.who);
      var isImg = /^data:image\//.test(m.body || "");
      var isAud = /^data:audio\//.test(m.body || "");
      if (isImg) {
        var im = document.createElement("img");
        im.className = "mimg";
        im.src = m.body;
        im.alt = "photo";
        im.addEventListener("click", function() {
          im.classList.toggle("big");
        });
        d.appendChild(im);
      } else if (isAud) {
        var au = document.createElement("audio");
        au.controls = true;
        au.src = m.body;
        d.appendChild(au);
      } else {
        d.textContent = m.body;
      }
      if (m.tr && !isImg && !isAud) {
        var tr = document.createElement("span");
        tr.className = "vcw-tr";
        var lb = document.createElement("b");
        lb.textContent = st.sess && st.sess.lang && st.sess.lang !== "en" ? st.sess.lang.toUpperCase() + " · TRANSLATED" : "TRANSLATED";
        tr.appendChild(lb);
        tr.appendChild(document.createTextNode(m.tr));
        d.appendChild(tr);
      }
      if (m.who !== "system") {
        var t = document.createElement("span");
        t.className = "t";
        t.textContent = hhmm(m.ts);
        if (m.who === "visitor") {
          var tk = document.createElement("span");
          tk.className = "tick" + (m.ts <= (st.rts || 0) ? " read" : "");
          tk.textContent = m.ts <= (st.rts || 0) ? " ✓✓" : " ✓";
          t.appendChild(tk);
        }
        d.appendChild(t);
      }
      msgsEl.appendChild(d);
      if (!noScroll) scrollBottom();
    }
    function renderAll(messages) {
      msgsEl.innerHTML = "";
      st.seen = {};
      for (var i = 0; i < messages.length; i++) addMsg(messages[i], true);
      scrollBottom();
    }
    function riderPush(chatId) {
      try {
        if (!window.Notification || !navigator.serviceWorker || !window.PushManager) return;
        var p = Notification.permission === "granted" ? Promise.resolve("granted") : Notification.requestPermission();
        p.then(function(perm) {
          if (perm !== "granted") return;
          navigator.serviceWorker.getRegistration("/").then(function(reg) {
            var r2 = reg ? Promise.resolve(reg) : navigator.serviceWorker.register("/sw.js");
            r2.then(function(reg2) {
              if (!reg2 || !reg2.pushManager) return;
              fetch("/api/push/key").then(function(r) {
                return r.json();
              }).then(function(kk) {
                if (!kk || !kk.key) return;
                var raw = atob(String(kk.key).replace(/-/g, "+").replace(/_/g, "/"));
                var u8 = new Uint8Array(raw.length);
                for (var i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
                reg2.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: u8
                }).then(function(sub) {
                  fetch("/api/push/subscribe", {
                    method: "POST",
                    headers: {
                      "content-type": "application/json"
                    },
                    body: JSON.stringify({
                      who: "rider",
                      chatId: chatId,
                      subscription: sub.toJSON ? sub.toJSON() : sub
                    })
                  }).catch(function() {});
                }).catch(function() {});
              }).catch(function() {});
            }).catch(function() {});
          }).catch(function() {});
        }).catch(function() {});
      } catch (e) {}
    }
    function poll() {
      if (!st.sess || document.hidden) return;
      fetch("/api/chat/msg?id=" + encodeURIComponent(st.sess.id) + "&after=" + st.lastId, {
        cache: "no-store",
        headers: {
          "x-chat-token": st.sess.token
        }
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d || !d.ok) return;
        var prevStatus = st.status;
        var changed = st.status !== d.status || st.agent !== (d.agent || "");
        st.status = d.status;
        st.agent = d.agent || "";
        if (d.rts) st.rts = d.rts;
        var ms = d.messages || [];
        var newAgent = false;
        for (var i = 0; i < ms.length; i++) {
          addMsg(ms[i]);
          st.lastId = ms[i].id;
          if (ms[i].who === "agent" || ms[i].who === "bot") {
            newAgent = true;
            if (!st.open) {
              st.unread++;
            }
          }
        }
        if (st.unread > 0) {
          $("vcw-dot").style.display = "";
        }
        if (d.visRead) {
          var vts = msgsEl.querySelectorAll(".vcw-m.visitor .tick");
          for (var j = 0; j < vts.length; j++) {
            vts[j].textContent = " ✓✓";
            vts[j].classList.add("read");
          }
        }
        if (prevStatus !== "active" && d.status === "active") {
          sfx("accept");
          notify("An agent picked up your chat" + (d.agent ? " — " + d.agent : ""));
        } else if (newAgent) {
          sfx("msg");
          notify("New reply from support");
        }
        var ty = $("vcw-typing");
        if (ty) ty.style.display = d.agentTyping ? "block" : "none";
        var wb = $("vcw-waitbar");
        if (wb) wb.classList.toggle("on", d.status === "waiting" && !d.agent);
        if (d.nudgeAt && d.nudgeAt > (st.nudge || 0)) {
          st.nudge = d.nudgeAt;
          var sN = st.sess;
          if (sN) {
            sN.nudge = d.nudgeAt;
            saveSess(sN);
          }
          showNudge();
        }
        if (changed || ms.length) statusUI();
      }).catch(function() {});
    }
    function showNudge() {
      var nb = $("vcw-nudge");
      if (nb) {
        nb.classList.add("on");
        if (!nb._wired) {
          nb._wired = 1;
          nb.addEventListener("click", function() {
            nb.classList.remove("on");
            openChat();
          });
        }
      }
      sfx("nudge");
      try {
        if (navigator.vibrate) navigator.vibrate([ 120, 80, 120 ]);
      } catch (e) {}
      notify("You still have an open chat with Vexora Support");
      try {
        if (showNudge._t) clearTimeout(showNudge._t);
      } catch (e) {}
      showNudge._t = setTimeout(function() {
        var n2 = $("vcw-nudge");
        if (n2) n2.classList.remove("on");
      }, 14e3);
      try {
        if (!showNudge._blink) {
          var base = document.title;
          showNudge._blink = setInterval(function() {
            if (document.hidden) {
              document.title = document.title === base ? "💬 New message — Vexora Support" : base;
            } else {
              document.title = base;
              clearInterval(showNudge._blink);
              showNudge._blink = null;
            }
          }, 1100);
        }
      } catch (e) {}
    }
    document.addEventListener("visibilitychange", function() {
      if (!document.hidden && st.sess) poll();
    });
    function startPolling() {
      if (st.timer) clearInterval(st.timer);
      st.timer = setInterval(poll, 3e3);
    }
    function openChat() {
      st.open = true;
      st.unread = 0;
      $("vcw-dot").style.display = "none";
      root.classList.add("open");
      try {
        if (window.matchMedia("(max-width:620px)").matches) document.body.classList.add("vcw-lock");
      } catch (e) {}
      statusUI();
      if (st.sess) {
        st.lastId = 0;
        poll();
        riderPush(st.sess.id);
      }
      startPolling();
      if (!st.sess) {
        try {
          $("vcw-name").focus();
        } catch (e) {}
      }
    }
    function closeChat() {
      st.open = false;
      root.classList.remove("open");
      try {
        document.body.classList.remove("vcw-lock");
      } catch (e) {}
    }
    function api(path, body) {
      return fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-token": st.sess ? st.sess.token : ""
        },
        body: JSON.stringify(body || {})
      }).then(function(r) {
        return r.json();
      });
    }
    function gatherCtx() {
      var gv = function(id) {
        try {
          var el = document.getElementById(id);
          return el ? String(el.textContent || "").trim() : "";
        } catch (e) {
          return "";
        }
      };
      var app = "";
      try {
        app = window.VEXORA && window.VEXORA.app || gv("appVer") || "";
      } catch (e) {}
      var os = "";
      try {
        var ua = navigator.userAgent || "";
        if (/Android ([0-9.]+)/.test(ua)) os = "Android " + (ua.match(/Android ([0-9.]+)/) || [])[1]; else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS"; else if (/Windows NT ([0-9.]+)/.test(ua)) os = "Windows"; else if (/Mac OS X/.test(ua)) os = "macOS"; else if (/Linux/.test(ua)) os = "Linux";
      } catch (e) {}
      var fw = gv("liveVer"), mcu = gv("liveMcu"), ble = gv("liveBle");
      return {
        fw: fw,
        mcu: mcu,
        ble: ble,
        app: app,
        os: os
      };
    }
    var CONSENT_KEY = "vex.privacy.v1";
    function consentOK() {
      try {
        return localStorage.getItem(CONSENT_KEY) === "1";
      } catch (e) {
        return true;
      }
    }
    function showConsent(then) {
      var old = document.getElementById("vcw-consent");
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var ov = document.createElement("div");
      ov.id = "vcw-consent";
      ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center;padding:12px";
      var card = document.createElement("div");
      card.style.cssText = "background:#16161a;color:#e8e8ec;font:500 13.5px/1.55 Montserrat,system-ui,sans-serif;max-width:430px;width:100%;border:1px solid #2a2a31;border-radius:16px;padding:16px 16px 14px;max-height:82vh;overflow:auto";
      card.innerHTML = '<b style="font-size:14.5px">Privacy &amp; age</b>' + '<p style="margin:8px 0 0">To answer you we store your chat: messages, photos/voice notes (<b>deleted after 7 days</b>), scooter model, device info, the page you came from and your country (<b>derived from IP, visible only to staff</b>). Messages are auto-translated through an AI service (Groq). Chats with no activity are <b>deleted after 45 days</b>. No ads, no trackers, no data selling.</p>' + '<p style="margin:8px 0 0">Details: <a href="/privacy" target="_blank" rel="noopener" style="color:#fff">Privacy &amp; Terms</a> · Any request: <a href="mailto:login.vexora@gmail.com" style="color:#fff">login.vexora@gmail.com</a></p>' + '<label style="display:flex;gap:8px;margin:10px 0 0;cursor:pointer"><input type="checkbox" id="vcw-cok" style="margin-top:2px"> <span>I\'m <b>14 or older</b> and I agree to the Privacy &amp; Terms above.</span></label>' + '<button type="button" id="vcw-cgo" style="margin-top:10px;width:100%;padding:11px 14px;border:0;border-radius:10px;background:#e8e8ec;color:#111;font:700 14px Montserrat,system-ui,sans-serif;cursor:pointer">Continue</button>' + '<button type="button" id="vcw-cno" style="margin-top:8px;width:100%;padding:9px;border:1px solid #2a2a31;border-radius:10px;background:transparent;color:#9a9aa3;font:600 12.5px Montserrat,system-ui,sans-serif;cursor:pointer">Not now</button>';
      ov.appendChild(card);
      document.body.appendChild(ov);
      var chk = card.querySelector("#vcw-cok");
      card.querySelector("#vcw-cgo").addEventListener("click", function() {
        if (!chk.checked) {
          chk.focus();
          return;
        }
        try {
          localStorage.setItem(CONSENT_KEY, "1");
        } catch (e) {}
        ov.parentNode.removeChild(ov);
        if (then) then();
      });
      card.querySelector("#vcw-cno").addEventListener("click", function() {
        ov.parentNode.removeChild(ov);
      });
    }
    function start(e) {
      var b = e && e.currentTarget || $("vcw-go");
      var model = $("vcw-model").value.trim();
      var q = $("vcw-q").value.trim();
      var err = function(t) {
        $("vcw-err").textContent = t || "";
      };
      if (!consentOK()) {
        showConsent(function() {
          start(null);
        });
        return;
      }
      if (model.length < 2) {
        err("Please tell us your scooter model.");
        $("vcw-model").focus();
        return;
      }
      if (q.length < 2) {
        err("Please describe your problem.");
        $("vcw-q").focus();
        return;
      }
      err("");
      b.disabled = true;
      b.textContent = "Connecting…";
      askNotif();
      api("/api/chat/open", {
        model: model,
        message: q,
        page: location.pathname,
        ctx: gatherCtx(),
        consent: true
      }).then(function(d) {
        b.disabled = false;
        b.textContent = "Start chat";
        if (!d || !d.ok) {
          $("vcw-q").value = "";
          $("vcw-q").placeholder = d && d.error ? d.error : "Could not start — try again";
          return;
        }
        st.sess = {
          id: d.id,
          token: d.token,
          name: name,
          lang: ""
        };
        st.status = "waiting";
        st.lastId = 0;
        saveSess(st.sess);
        msgsEl.innerHTML = "";
        statusUI();
        poll();
      }).catch(function() {
        b.disabled = false;
        b.textContent = "Start chat";
      });
    }
    function scrollBottom() {
      try {
        msgsEl.scrollTo({
          top: msgsEl.scrollHeight,
          behavior: "smooth"
        });
      } catch (e) {
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    }
    function send(e) {
      var b = e && e.currentTarget || $("vcw-send");
      var input = $("vcw-in");
      var txt = input.value.trim();
      if (!txt || st.sending || !st.sess) return;
      st.sending = true;
      b.disabled = true;
      api("/api/chat/msg?id=" + encodeURIComponent(st.sess.id), {
        id: st.sess.id,
        body: txt,
        ctx: gatherCtx()
      }).then(function(d) {
        st.sending = false;
        b.disabled = false;
        if (d && d.ok) {
          input.value = "";
          poll();
        } else {
          input.placeholder = d && d.error || "Could not send";
        }
      }).catch(function() {
        st.sending = false;
        b.disabled = false;
      });
    }
    var fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.accept = "image/jpeg,image/png,image/webp";
    fileIn.style.display = "none";
    root.appendChild(fileIn);
    fileIn.addEventListener("change", function() {
      var f = fileIn.files && fileIn.files[0];
      fileIn.value = "";
      if (!f || !st.sess) return;
      var rd = new FileReader;
      rd.onload = function() {
        var im2 = new Image;
        im2.onload = function() {
          try {
            var mx = 720;
            var sc = Math.min(1, mx / Math.max(im2.width, im2.height));
            var cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(im2.width * sc));
            cv.height = Math.max(1, Math.round(im2.height * sc));
            cv.getContext("2d").drawImage(im2, 0, 0, cv.width, cv.height);
            var du = cv.toDataURL("image/jpeg", .65);
            sendMedia({
              img: du
            });
          } catch (e) {
            mediaNote("Could not process that image — try a JPG or PNG.");
          }
        };
        im2.onerror = function() {
          mediaNote("That format is not supported — send it as JPG or PNG.");
        };
        im2.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    $("vcw-photo").addEventListener("click", function() {
      if (st.sess) fileIn.click();
    });
    var rec = null, recBtn = $("vcw-mic");
    recBtn.addEventListener("click", function() {
      if (!st.sess) return;
      if (!window.MediaRecorder) {
        mediaNote("Voice notes are not supported in this browser.");
        return;
      }
      if (rec && rec.state === "recording") {
        rec.stop();
        return;
      }
      try {
        navigator.mediaDevices.getUserMedia({
          audio: true
        }).then(function(stream) {
          var mr = new MediaRecorder(stream);
          var chunks = [];
          mr.ondataavailable = function(ev) {
            if (ev.data && ev.data.size) chunks.push(ev.data);
          };
          mr.onstop = function() {
            recBtn.classList.remove("rec");
            stream.getTracks().forEach(function(t2) {
              t2.stop();
            });
            var bl = new Blob(chunks, {
              type: mr.mimeType || "audio/webm"
            });
            if (bl.size > 25e4) {
              mediaNote("Voice note too long — keep it under ~20 seconds.");
              return;
            }
            var fr = new FileReader;
            fr.onload = function() {
              sendMedia({
                audio: fr.result
              });
            };
            fr.readAsDataURL(bl);
          };
          rec = mr;
          mr.start();
          recBtn.classList.add("rec");
        }).catch(function() {
          mediaNote("Microphone permission denied.");
        });
      } catch (e) {}
    });
    function mediaNote(txt) {
      var n = $("vcw-note");
      if (!n) return;
      n.textContent = txt;
      n.style.display = "block";
      setTimeout(function() {
        n.style.display = "none";
      }, 6e3);
    }
    function sendMedia(payload) {
      if (!st.sess || st.sending) return;
      st.sending = true;
      fetch("/api/chat/media?id=" + encodeURIComponent(st.sess.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-token": st.sess.token
        },
        body: JSON.stringify(payload)
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        st.sending = false;
        if (d && d.ok) poll(); else mediaNote(d && d.error || "Could not send the file — try a smaller one.");
      }).catch(function() {
        st.sending = false;
        mediaNote("Could not send the file — check your connection.");
      });
    }
    $("vcw-bub").addEventListener("click", openChat);
    $("vcw-x").addEventListener("click", closeChat);
    $("vcw-go").addEventListener("click", start);
    $("vcw-send").addEventListener("click", send);
    $("vcw-wcancel").addEventListener("click", function() {
      if (!st.sess) return;
      fetch("/api/chat/leave?id=" + encodeURIComponent(st.sess.id), {
        method: "POST",
        headers: {
          "x-chat-token": st.sess.token
        }
      }).then(function() {
        poll();
      }).catch(function() {});
    });
    $("vcw-wai").addEventListener("click", function() {
      if (!st.sess) return;
      fetch("/api/chat/aihelp?id=" + encodeURIComponent(st.sess.id), {
        method: "POST",
        headers: {
          "x-chat-token": st.sess.token
        }
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (d && d.ok) {
          mediaNote("Vexora AI is joining the chat…");
          poll();
        } else mediaNote(d && d.error || "AI is not available right now.");
      }).catch(function() {
        mediaNote("AI is not available right now.");
      });
    });
    $("vcw-in").addEventListener("keydown", function(ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    });
    var lastTyping = 0;
    $("vcw-in").addEventListener("input", function() {
      var now = Date.now();
      if (st.sess && st.status === "active" && now - lastTyping > 3e3) {
        lastTyping = now;
        fetch("/api/chat/typing?id=" + encodeURIComponent(st.sess.id), {
          method: "POST",
          headers: {
            "x-chat-token": st.sess.token
          }
        }).catch(function() {});
      }
    });
    var rateBox = null;
    setInterval(function() {
      var xBtn = $("vcw-x");
      var lockX = !!(st.sess && (st.status === "waiting" || st.status === "active"));
      var mustRate = !!(st.sess && st.status === "closed" && st.agent && !st.rated);
      if (xBtn) xBtn.style.display = (lockX || mustRate) && st.open ? "none" : "";
      if (st.sess && st.status === "closed" && st.open && !rateBox) {
        rateBox = document.createElement("div");
        rateBox.id = "vcw-closed";
        rateBox.innerHTML = "<p>" + (st.agent ? "Rate your agent " + st.agent : "Chat closed.") + "</p>" + (st.agent ? '<p class="err" style="min-height:0">Rating is required to continue.</p>' : "");
        var row = document.createElement("div");
        row.className = "vcw-stars";
        var busy = false;
        var paint = function(n, done) {
          row.innerHTML = "";
          for (var i = 1; i <= 5; i++) {
            var b = document.createElement("button");
            b.className = "vcw-star" + (i <= n ? " on" : "");
            b.textContent = "★";
            b.setAttribute("aria-label", i + " stars");
            (function(k) {
              b.addEventListener("click", function() {
                if (busy || done) return;
                busy = true;
                fetch("/api/chat/rate?id=" + encodeURIComponent(st.sess.id), {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-chat-token": st.sess.token
                  },
                  body: JSON.stringify({
                    stars: k
                  })
                }).then(function(r) {
                  return r.json();
                }).then(function(d) {
                  busy = false;
                  if (d && d.ok) {
                    st.rated = true;
                    paint(k, true);
                    var xB = $("vcw-x");
                    if (xB) xB.style.display = "";
                    var thx = rateBox.querySelector("p");
                    if (thx) thx.textContent = "You rated " + k + "★" + (st.agent ? " for " + st.agent : "");
                    var tk2 = rateBox.querySelector(".err");
                    if (tk2) tk2.remove();
                    var gw = document.createElement("div");
                    gw.id = "vcw-thanks";
                    gw.innerHTML = '<p class="big">Thank you! ' + k + '★/5</p><p class="sub">Your rating helps the Vexora support team keep getting better. Ride safe!</p>';
                    rateBox.insertBefore(gw, rateBox.querySelector(".vcw-stars").nextSibling);
                    if (window.Notification && Notification.permission === "granted") {
                      try {
                        new Notification("Thanks for rating Vexora Support!");
                      } catch (e2) {}
                    }
                  } else {
                    paint(k, true);
                    var p2 = rateBox.querySelector("p");
                    if (p2 && d && d.error) p2.textContent = d.error;
                  }
                }).catch(function() {
                  busy = false;
                });
              });
            })(i);
            row.appendChild(b);
          }
        };
        paint(0, false);
        if (st.agent) rateBox.appendChild(row);
        var nb = document.createElement("button");
        nb.className = "vcw-btn";
        nb.textContent = "New chat";
        nb.addEventListener("click", function() {
          saveSess(null);
          st.sess = null;
          st.status = "";
          st.agent = "";
          st.lastId = 0;
          st.seen = {};
          st.rated = false;
          msgsEl.innerHTML = "";
          rateBox.remove();
          rateBox = null;
          statusUI();
        });
        var tb = document.createElement("button");
        tb.className = "vcw-btn";
        tb.textContent = "Save transcript";
        tb.addEventListener("click", function() {
          try {
            var lines = [];
            var nodes = msgsEl.querySelectorAll(".vcw-m");
            for (var i = 0; i < nodes.length; i++) {
              var who = /(^| )agent( |$)/.test(nodes[i].className) ? "Agent" : /(^| )visitor( |$)/.test(nodes[i].className) ? "You" : "·";
              var body2 = nodes[i].querySelector(".mimg") ? "[photo]" : nodes[i].querySelector("audio") ? "[voice note]" : nodes[i].textContent;
              lines.push(who + ": " + body2);
            }
            var blob = new Blob([ "Vexora support chat — " + (new Date).toISOString() + "\n\n" + lines.join("\n") + "\n" ], {
              type: "text/plain"
            });
            var a2 = document.createElement("a");
            a2.href = URL.createObjectURL(blob);
            a2.download = "vexora-chat-" + (st.sess ? st.sess.id : "log") + ".txt";
            document.body.appendChild(a2);
            a2.click();
            a2.remove();
          } catch (e) {}
        });
        rateBox.appendChild(tb);
        rateBox.appendChild(nb);
        msgsEl.appendChild(rateBox);
        scrollBottom();
      }
      if ((!st.sess || st.status !== "closed") && rateBox) {
        rateBox.remove();
        rateBox = null;
      }
    }, 2500);
    if (st.sess) {
      st.lastId = 0;
      poll();
    }
  } catch (e) {}
})();