// Service worker: makes the app load with no network connection.
// Strategy:
//   - App shell (same-origin files): stale-while-revalidate. Serve from cache
//     immediately, refresh the cache in the background so the next launch gets
//     any update. Bump CACHE when the shell changes in a way that must not mix
//     old and new files.
//   - Google Fonts: cache-first (they never change for a given URL).
//   - Everything else: network only.
var CACHE = 'docket-v2';
var SHELL = [
  './',
  './index.html',
  './app.js',
  './sync.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

function putInCache(req, res){
  if(!res || (res.status !== 200 && res.type !== 'opaque')) return res;
  var copy = res.clone();
  caches.open(CACHE).then(function(c){ c.put(req, copy); });
  return res;
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);

  if(url.origin === self.location.origin){
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function(cached){
        var network = fetch(req).then(function(res){ return putInCache(req, res); }).catch(function(){ return null; });
        if(cached){ return cached; }
        return network.then(function(res){
          if(res) return res;
          // Offline and not cached: for page navigations fall back to the shell.
          if(req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
    );
    return;
  }

  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(
      caches.match(req).then(function(cached){
        return cached || fetch(req).then(function(res){ return putInCache(req, res); });
      })
    );
  }
});
