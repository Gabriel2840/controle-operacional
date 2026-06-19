// Service worker — guarda o app shell para abrir mesmo sem internet.
// Os DADOS ficam por conta do Firestore (cache offline próprio).
const CACHE = "controle-op-v1";
const SHELL = [
  "./", "./index.html", "./app.js", "./firebase-config.js",
  "./manifest.webmanifest", "./icon.svg",
  "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Nunca intercepta o tráfego do Firebase/Google (usa rede + cache próprio).
  if (/firestore\.googleapis\.com|firebaseio\.com|googleapis\.com|identitytoolkit|gstatic\.com/.test(url.hostname)) return;
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(req, c)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
