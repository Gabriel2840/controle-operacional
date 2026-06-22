// Service worker — guarda o app shell para abrir mesmo sem internet.
// Os DADOS ficam por conta do app (cache local em localStorage) e do Supabase.
const CACHE = "controle-op-v3";
const LOCAL = [
  "./", "./index.html", "./app.js", "./supabase-config.js",
  "./manifest.webmanifest", "./icon.svg",
];
const LIBS = [
  "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
  "https://esm.sh/@supabase/supabase-js@2",
  "https://esm.sh/xlsx@0.18.5",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(LOCAL);
    // Bibliotecas externas: tenta cachear, mas não falha a instalação se cair.
    await Promise.all(LIBS.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
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
  // NUNCA intercepta o Supabase (API REST, Auth e Realtime precisam ir à rede).
  if (url.hostname.endsWith("supabase.co")) return;
  // App shell + libs (esm.sh, jsdelivr): cache-first com atualização em 2º plano.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
