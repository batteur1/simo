const V='simo-v6',A=['/','/manifest.json','/icon-192.png'];
const API=/^\/(merchant|shops|orders|catalog|config|auth|promo|admin|courier|items)(\/|$)/;
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(A)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=V).map(x=>caches.delete(x)))))});
self.addEventListener('fetch',e=>{if(e.request.method!='GET'||API.test(new URL(e.request.url).pathname))return;
e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});
