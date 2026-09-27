/* Service Worker 鈥?缃戠粶浼樺厛 + 缂撳瓨鍏滃簳锛圥WA 绂荤嚎鍙敤锛屾洿鏂板嵆鏃剁敓鏁堬級 */
const CACHE = "wenwan-v96";

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
  // 浜戠 API 涓?Supabase 璇锋眰鐩存帴璧扮綉缁滐紝涓嶇紦瀛?
  if (url.includes("supabase.co") || url.includes("tesseract")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 鍙紦瀛樺悓婧愰潤鎬佽祫婧?
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