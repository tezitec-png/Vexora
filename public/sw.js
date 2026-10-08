const CACHE = "vexora-1708";

const ASSETS = [ "./index.html", "./community.html", "./manifest.webmanifest", "./assets/app.css?v=1667", "./assets/app.js?v=1671", "./assets/live.js?v=1661", "./assets/vexora.js?v=1661", "./assets/i18n.js?v=1679", "./assets/consent.js?v=1661", "./assets/chat.js?v=1674", "./assets/extra.js?v=1661", "./assets/polish.js?v=1661", "./assets/tire.js?v=1661", "./assets/flasher.js?v=1661", "./assets/sim.js?v=1661", "./assets/logo.png", "./assets/mark.png", "./assets/favicon.png", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable.png", "./assets/apple-touch-icon.png", "./cfw/assets/cfw.js?v=1666" ];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("push", e => {
  let d = {};
  try {
    d = e.data.json();
  } catch (err) {
    try {
      d = {
        title: "Vexora",
        body: e.data.text()
      };
    } catch (err2) {}
  }
  e.waitUntil(self.registration.showNotification(d.title || "Vexora Support", {
    body: d.body || "",
    icon: "/assets/icon-192.png",
    badge: "/assets/icon-192.png",
    tag: d.tag || "vexora",
    renotify: true,
    data: d
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const u = e.notification.data && e.notification.data.url || "/";
  e.waitUntil(self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  }).then(ws => {
    for (const w of ws) {
      try {
        if (w.url.indexOf(self.location.origin) === 0) {
          w.focus();
          return w.navigate && w.navigate(u);
        }
      } catch (err) {}
    }
    return self.clients.openWindow(u);
  }));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname === "/" || url.pathname === "/landing.html" || url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("/admin") === 0) return;
  if (req.mode === "navigate" || url.pathname === "/app" || url.pathname === "/app/" || url.pathname.endsWith(".html")) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html"))));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match(req)));
});