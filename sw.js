// 곰곰이 서비스 워커: 홈 화면 설치와 빠른 재방문을 위한 캐시, 복용 알림 클릭 처리.
// 로그인·복약 기록(Supabase)과 의약품 정보(medikr) 요청은 개인 정보라 절대 캐시하지 않습니다.
const VERSION = 'gomgomi-v12';
const SHELL = `${VERSION}-shell`, MODELS = `${VERSION}-models`, CDN = `${VERSION}-cdn`;
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './src/styles.css', './src/app.js', './src/mood.js', './src/bear.js', './src/drug-name.js', './src/game.js', './src/ocr-paddle.js', './assets/icons/icon-192.png', './assets/icons/icon-512.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => !key.startsWith(VERSION)).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/models/ocr/')) return event.respondWith(cacheFirst(request, MODELS));
    if (url.pathname.endsWith('/supabase-config.js')) return;  // 배포마다 새로 만들어지는 설정
    return event.respondWith(networkFirst(request, SHELL));
  }
  if (CDN_HOSTS.includes(url.hostname)) return event.respondWith(staleWhileRevalidate(request, CDN));
  // 그 밖의 요청(Supabase, medikr 등)은 브라우저 기본 동작 그대로
});

async function cacheFirst(request, name) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(name)).put(request, response.clone());
  return response;
}

async function networkFirst(request, name) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(name)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, {ignoreSearch: request.mode === 'navigate'});
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name), cached = await cache.match(request);
  const fresh = fetch(request).then(response => { if (response.ok || response.type === 'opaque') cache.put(request, response.clone()); return response; }).catch(() => cached);
  return cached || fresh;
}

// 복용 알림을 누르면 열려 있는 곰곰이 창으로, 없으면 새로 엽니다.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(windows => {
    const open = windows.find(w => w.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(self.registration.scope);
  }));
});
