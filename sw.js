/* Service Worker — 网络优先 + 缓存兜底（PWA 离线可用，更新即时生效） */
const CACHE = "wenwan-v24";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  // 云端 API 与 Supabase 请求直接走网络，不缓存
  if (url.includes("supabase.co") || url.includes("tesseract")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 只缓存同源静态资源
        if (url.includes("github.io")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match("./index.html"))
      )
  );
});