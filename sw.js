const V='simo-v6',A=['/','/manifest.json','/icon-192.png'];
const API=/^\/(merchant|shops|orders|catalog|config|auth|promo|admin|courier|items|wallet|push|me|upload|legal)(\/|$)/;
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(A)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=V).map(x=>caches.delete(x)))))});
self.addEventListener('fetch',e=>{if(e.request.method!='GET'||new URL(e.request.url).origin!==location.origin||API.test(new URL(e.request.url).pathname))return;
e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(x){}e.waitUntil(self.registration.showNotification(d.title||'SIMO',{body:d.body||'',icon:'/icon-192.png',badge:'/icon-192.png',data:{url:d.url||'/'},tag:d.tag||undefined}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if(c.url.indexOf(u)>-1&&'focus'in c)return c.focus()}return clients.openWindow(u)}))});
