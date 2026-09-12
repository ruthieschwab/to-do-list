// Service worker: makes the app load with no network connection and rolls out
// updates atomically.
//
// The app shell is versioned by CACHE. On install, every shell file is fetched
// fresh (bypassing the browser's HTTP cache) into a new cache; only once all of
// them are in does the new worker take over, and the page reloads once so the
// page and its scripts always come from the same deployment. Files are then
// served cache-first: no background refresh, so two deployments never mix.
//
// ==> Bump CACHE whenever any file in SHELL changes, or the change won't ship. <==
//
// Google Fonts are cached on first use (they never change for a given URL).
var CACHE = 'docket-v7';
var SHELL = [
  './',
  './index.html',
  './app.js',
  './sync.js',
  './tags.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(SHELL.map(function(url){
        return fetch(url, { cache: 'reload' }).then(function(res){
          if(!res.ok) throw new Error('precache failed: ' + url);
          return c.put(url, res);
        });
      }));
    }).then(function(){ return self.skipWaiting(); })
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
        if(cached) return cached;
        return fetch(req).then(function(res){ return putInCache(req, res); }).catch(function(){
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
