const CACHE_NAME = "ai-phone-cache-v20260427-4";

const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/ai.js",
  "./js/character.js",
  "./js/group.js",
  "./js/offline.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

function isApiRequest(url) {
  return url.includes("/v1/")
    || url.includes("chat/completions")
    || url.includes("models");
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return Promise.resolve();
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var requestUrl = new URL(request.url);

  if (request.method !== "GET" || isApiRequest(requestUrl.href)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put("./index.html", copy);
        });
        return response;
      }).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }

      return fetch(request).then(function (response) {
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }

        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy);
        });
        return response;
      });
    })
  );
});
