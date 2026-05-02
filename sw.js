const CACHE_BASE = "ai-phone-cache-v20260505-";
let CACHE_NAME = CACHE_BASE + "50";

function parseCacheVersion(key) {
  if (!key || typeof key !== "string") {
    return null;
  }

  var match = /^(.+?-v\d{8}-)(\d+)$/.exec(key);
  if (!match) {
    return null;
  }

  var version = Number(match[2]);
  return Number.isFinite(version) ? { prefix: match[1], version: version } : null;
}

function getNextCacheName(keys) {
  var current = parseCacheVersion(CACHE_NAME);
  var highestVersion = current ? current.version - 1 : 0;
  var selectedPrefix = current ? current.prefix : CACHE_BASE;

  (keys || []).forEach(function (key) {
    var parsed = parseCacheVersion(key);
    if (parsed && parsed.version > highestVersion) {
      highestVersion = parsed.version;
      selectedPrefix = parsed.prefix;
    }
  });

  return selectedPrefix + String(highestVersion + 1);
}

const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/ai.js",
  "./js/api-jobs.js",
  "./js/character.js",
  "./js/group.js",
  "./js/offline.js",
  "./js/watch.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

function isApiRequest(url) {
  return url.includes("/v1/")
    || url.includes("chat/completions")
    || url.includes("models");
}

function isNetworkFirstAsset(request, url) {
  var path = url.pathname.toLowerCase();

  return request.destination === "script"
    || request.destination === "style"
    || request.destination === "document"
    || /\.(?:js|css|html?)$/.test(path);
}

function cacheFreshResponse(request, response) {
  if (!response || response.status !== 200 || response.type === "opaque") {
    return response;
  }

  var copy = response.clone();
  caches.open(CACHE_NAME).then(function (cache) {
    cache.put(request, copy);
  });
  return response;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      CACHE_NAME = getNextCacheName(keys);
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.addAll(APP_SHELL);
      });
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

  if (isNetworkFirstAsset(request, requestUrl)) {
    event.respondWith(
      fetch(request).then(function (response) {
        return cacheFreshResponse(request, response);
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          if (cached) {
            return cached;
          }

          return caches.match(request, { ignoreSearch: true }).then(function (fallbackCached) {
            if (fallbackCached) {
              return fallbackCached;
            }

            if (request.destination === "document" || /\.html?$/.test(requestUrl.pathname.toLowerCase())) {
              return caches.match("./index.html").then(function (indexHtml) {
                return indexHtml || Response.error();
              });
            }

            return Response.error();
          });
        });
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
        return cacheFreshResponse(request, response);
      });
    })
  );
});
