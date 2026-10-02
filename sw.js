// Offline cache so the installed app works without a connection.
const CACHE = 'turbokart-v4';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/main.js', './js/track.js', './js/scenery.js', './js/kart.js', './js/ai.js',
  './js/input.js', './js/hud.js', './js/audio.js', './js/effects.js', './js/utils.js',
  './lib/three.module.min.js',
  './lib/addons/postprocessing/EffectComposer.js', './lib/addons/postprocessing/RenderPass.js',
  './lib/addons/postprocessing/ShaderPass.js', './lib/addons/postprocessing/MaskPass.js',
  './lib/addons/postprocessing/Pass.js', './lib/addons/postprocessing/UnrealBloomPass.js',
  './lib/addons/postprocessing/OutputPass.js', './lib/addons/shaders/CopyShader.js',
  './lib/addons/shaders/LuminosityHighPassShader.js', './lib/addons/shaders/OutputShader.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first so updates ship immediately; fall back to cache offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
