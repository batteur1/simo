// SIMO API v2 (PostgreSQL) — DATABASE_URL, JWT_SECRET requis
const express=require('express'),cors=require('cors'),jwt=require('jsonwebtoken'),{Pool}=require('pg'),fs=require('fs'),crypto=require('crypto');
const DEV=process.env.DEV_OTP==='1',SECRET=process.env.JWT_SECRET;
if(!SECRET){console.error('JWT_SECRET manquant');process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='1'?{rejectUnauthorized:false}:undefined});
const Q=async(t,p=[])=>(await pool.query(t,p)).rows,one=async(t,p)=>(await Q(t,p))[0];
const app=express();app.set('trust proxy',1);app.disable('x-powered-by');const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com https://www.openstreetmap.org; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
app.use((q,s,n)=>{s.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'strict-origin-when-cross-origin','Strict-Transport-Security':'max-age=31536000; includeSubDomains','Permissions-Policy':'geolocation=(self), camera=(), microphone=(), payment=()','Content-Security-Policy':CSP,'Cross-Origin-Opener-Policy':'same-origin-allow-popups'});n()});
app.use(cors({origin:false}),express.json({limit:'100kb'}));
if(SECRET.length<32)console.warn('⚠ JWT_SECRET trop court (min 32 caractères recommandés)');
const A=f=>(q,s,n)=>f(q,s,n).catch(e=>{console.error(e);s.status(e.status||500).json({error:e.status?e.message:'Erreur serveur'})});
const bad=(m,st=400)=>{const e=new Error(m);e.status=st;return e};
// Limitation de débit (en mémoire): par IP pour /auth, par jeton pour l'API (évite de bloquer les IP mobiles partagées)
const rlm=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of rlm)if(v.r<n)rlm.delete(k)},60000).unref();
const rl=(name,max,win,byTok)=>(q,s,n)=>{const id=byTok&&q.headers.authorization?crypto.createHash('sha1').update(q.headers.authorization).digest('hex').slice(0,16):q.ip,k=name+':'+id,now=Date.now();let e=rlm.get(k);if(!e||e.r<now){e={c:0,r:now+win};rlm.set(k,e)}if(++e.c>max)return s.status(429).json({error:'طلبات كثيرة، حاول لاحقًا'});n()};
app.use('/auth',rl('auth',60,600000));
app.use(['/orders','/wallet','/courier','/admin','/merchant','/items','/upload','/me','/push'],rl('api',1500,300000,true));
app.post('/orders',rl('order',15,600000,true));app.post('/upload',rl('up',40,600000,true));
app.use((q,s,n)=>{if(/^\/(auth|upload)/.test(q.path)||q.method!=='GET')s.set('Cache-Control','no-store');n()});
const PAGES=['index.html','staff.html','legal.html','sw.js','manifest.json','icon-192.png','icon-512.png'];
app.get('/legal',(q,r)=>r.sendFile(__dirname+'/legal.html'));
for(const f of PAGES)app.get(f==='index.html'?['/','/index.html']:'/'+f,(q,r)=>r.sendFile(__dirname+'/'+f));
app.get('/health',(q,s)=>s.send('ok'));
const auth=(...roles)=>(q,s,n)=>{try{q.u=jwt.verify((q.headers.authorization||'').slice(7),SECRET);if(roles.length&&!roles.includes(q.u.role))return s.sendStatus(403);n()}catch{s.sendStatus(401)}};
async function init(){
 await Q(`
 CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,phone TEXT UNIQUE,name TEXT,role TEXT DEFAULT 'client',online INTEGER DEFAULT 0,shop_id INTEGER);
 CREATE TABLE IF NOT EXISTS cities(id SERIAL PRIMARY KEY,name TEXT UNIQUE,active INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS shops(id SERIAL PRIMARY KEY,city_id INTEGER,name TEXT,category TEXT,fee DOUBLE PRECISION,active INTEGER DEFAULT 1,img TEXT,address TEXT);
 CREATE TABLE IF NOT EXISTS items(id SERIAL PRIMARY KEY,shop_id INTEGER,name TEXT,price DOUBLE PRECISION,available INTEGER DEFAULT 1,img TEXT);
 CREATE TABLE IF NOT EXISTS promos(code TEXT PRIMARY KEY,percent DOUBLE PRECISION,active INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS orders(id SERIAL PRIMARY KEY,user_id INTEGER,shop_id INTEGER,courier_id INTEGER,status TEXT DEFAULT 'new',address TEXT,items TEXT,subtotal DOUBLE PRECISION,fee DOUBLE PRECISION,discount DOUBLE PRECISION DEFAULT 0,rating INTEGER,created TIMESTAMPTZ DEFAULT now(),pay_method TEXT DEFAULT 'cash',pay_status TEXT DEFAULT 'pending',phone TEXT,note TEXT,settled INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT);
 CREATE TABLE IF NOT EXISTS images(id SERIAL PRIMARY KEY,mime TEXT,data BYTEA,created TIMESTAMPTZ DEFAULT now());
 CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);CREATE INDEX IF NOT EXISTS orders_shop ON orders(shop_id);CREATE INDEX IF NOT EXISTS orders_courier ON orders(courier_id);
 INSERT INTO cities(name,active) VALUES('Salé',1),('Rabat',0),('Témara',0),('Kénitra',0) ON CONFLICT DO NOTHING;
 INSERT INTO promos VALUES('SIMO40',40,1) ON CONFLICT DO NOTHING;
 INSERT INTO settings VALUES('commission','15'),('pay_cash','1'),('pay_card','0'),('pay_wallet','0'),('pay_cashplus','0'),('bank_name',''),('bank_rib',''),('bank_holder','') ON CONFLICT DO NOTHING;
 INSERT INTO settings VALUES('courier_share','80'),('min_withdraw','100'),('min_order','0') ON CONFLICT DO NOTHING;
 ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_code TEXT;
 ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip DOUBLE PRECISION DEFAULT 0;
 ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
 ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating_courier INTEGER;
 ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating_comment TEXT;
 ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
 ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
 CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email);
 ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_method TEXT;
 ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_details TEXT;
 CREATE TABLE IF NOT EXISTS ledger(id SERIAL PRIMARY KEY,ts TIMESTAMPTZ DEFAULT now(),account TEXT NOT NULL,user_id INTEGER,shop_id INTEGER,order_id INTEGER,kind TEXT NOT NULL,amount DOUBLE PRECISION NOT NULL,note TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS ledger_once ON ledger(order_id,kind,account,(COALESCE(user_id,0)),(COALESCE(shop_id,0))) WHERE order_id IS NOT NULL;
 CREATE INDEX IF NOT EXISTS ledger_user ON ledger(account,user_id);CREATE INDEX IF NOT EXISTS ledger_shop ON ledger(account,shop_id);CREATE INDEX IF NOT EXISTS ledger_ts ON ledger(ts);
 CREATE TABLE IF NOT EXISTS audit(id SERIAL PRIMARY KEY,ts TIMESTAMPTZ DEFAULT now(),user_id INTEGER,action TEXT,detail TEXT,ip TEXT);
 CREATE TABLE IF NOT EXISTS courier_loc(user_id INTEGER PRIMARY KEY,lat DOUBLE PRECISION,lng DOUBLE PRECISION,ts TIMESTAMPTZ DEFAULT now());
 CREATE TABLE IF NOT EXISTS push_subs(id SERIAL PRIMARY KEY,user_id INTEGER,endpoint TEXT UNIQUE,p256dh TEXT,auth TEXT,lang TEXT DEFAULT 'fr');
 CREATE INDEX IF NOT EXISTS push_user ON push_subs(user_id);
 CREATE TABLE IF NOT EXISTS withdrawals(id SERIAL PRIMARY KEY,user_id INTEGER,shop_id INTEGER,role TEXT,amount DOUBLE PRECISION,method TEXT,details TEXT,status TEXT DEFAULT 'pending',ref TEXT,created TIMESTAMPTZ DEFAULT now(),processed TIMESTAMPTZ);`);
 if(!await one('SELECT 1 FROM shops LIMIT 1'))await Q(fs.readFileSync(__dirname+'/seed.sql','utf8'));
 if(DEV)await Q(fs.readFileSync(__dirname+'/seed_test.sql','utf8'));
 // Premier administrateur (production): defini par ADMIN_PHONE (ex: 0612345678)
 const ap=norm(process.env.ADMIN_PHONE);
 if(ap){await Q('INSERT INTO users(phone,name,role) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET role=$3',[ap,'Admin','admin']);console.log('Admin pret:',ap)}
 if(!DEV)await Q("UPDATE users SET role='client',shop_id=NULL WHERE phone IN ('0600000001','0600000002','0600000003','0600000004') AND ($1::text IS NULL OR phone<>$1)",[ap]);
}
// OTP (SMS via Twilio si TWILIO_SID/TWILIO_TOKEN/TWILIO_FROM définis)
const otps=new Map(),hits=new Map();
const sign=u=>jwt.sign({id:u.id,role:u.role,shop:u.shop_id},SECRET,{expiresIn:u.role==='admin'?'8h':'30d'});
const sha=v=>crypto.createHash('sha256').update(String(v||'')).digest();
const adminOk=(u,pw)=>u.role!=='admin'||!process.env.ADMIN_PASSWORD||crypto.timingSafeEqual(sha(pw),sha(process.env.ADMIN_PASSWORD));
const audit=(q,a,d)=>Q('INSERT INTO audit(user_id,action,detail,ip) VALUES($1,$2,$3,$4)',[q.u?q.u.id:null,a,String(d||'').slice(0,300),q.ip]).catch(()=>{});
const norm=p=>{p=String(p||'').replace(/[\s.-]/g,'').replace(/^(\+|00)212/,'0');return /^0[5-7]\d{8}$/.test(p)?p:null};
async function sendSms(phone,code){
 const{TWILIO_SID:sid,TWILIO_TOKEN:tok,TWILIO_FROM:from}=process.env;if(!sid)return false;
 const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid+':'+tok).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:'+212'+phone.slice(1),From:from,Body:`SIMO: votre code ${code}`})});
 if(!r.ok)throw bad('SMS indisponible',502);return true}
app.post('/auth/otp',A(async(q,s)=>{const phone=norm(q.body.phone);if(!phone)throw bad('Numéro invalide');
 const now=Date.now(),h=(hits.get(phone)||[]).filter(t=>now-t<600000);if(h.length>=5)throw bad('Trop de tentatives, réessayez plus tard',429);hits.set(phone,[...h,now]);
 const c=String(Math.floor(1000+Math.random()*9000));otps.set(phone,{c,exp:now+300000,tries:0});
 const sent=await sendSms(phone,c);if(!sent&&!DEV)throw bad('SMS non configuré',503);
 s.json({ok:true,dev:DEV?c:undefined})}));
app.post('/auth/verify',A(async(q,s)=>{const phone=norm(q.body.phone),{code,name}=q.body,o=otps.get(phone);
 if(!o||o.exp<Date.now())throw bad('Code expiré');if(++o.tries>5){otps.delete(phone);throw bad('Trop d\'essais')}
 if(o.c!==String(code))throw bad('Code invalide');otps.delete(phone);
 await Q('INSERT INTO users(phone,name) VALUES($1,$2) ON CONFLICT(phone) DO NOTHING',[phone,String(name||'').slice(0,60)]);
 await Q("UPDATE users SET name=$2 WHERE phone=$1 AND (name IS NULL OR name='') AND $2<>''",[phone,String(name||'').slice(0,60)]);
 const u=await one('SELECT * FROM users WHERE phone=$1',[phone]);
 if(!adminOk(u,q.body.password)){audit({u,ip:q.ip},'admin_login_fail','phone');throw bad('كلمة سر الإدارة غير صحيحة',401)}
 if(u.role==='admin')audit({u,ip:q.ip},'admin_login','phone');
 s.json({token:sign(u),user:{id:u.id,name:u.name,role:u.role}})}));
app.get('/config',A(async(q,s)=>s.json({...Object.fromEntries((await Q("SELECT k,v FROM settings WHERE k LIKE 'pay_%'")).map(r=>[r.k,r.v])),google:process.env.GOOGLE_CLIENT_ID||''})));
// Connexion Google (Gmail): vérification du jeton côté serveur
app.post('/auth/google',A(async(q,s)=>{const gid=process.env.GOOGLE_CLIENT_ID;if(!gid)throw bad('تسجيل الدخول بـ Google غير مفعّل',503);
 const cred=String(q.body.credential||'');if(cred.length<100||cred.length>4000)throw bad('رمز غير صالح');
 const r=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(cred));if(!r.ok)throw bad('رمز Google غير صالح',401);
 const g=await r.json();
 if(g.aud!==gid||!['accounts.google.com','https://accounts.google.com'].includes(g.iss)||String(g.email_verified)!=='true'||!g.email||+g.exp*1000<Date.now())throw bad('رمز Google غير صالح',401);
 const email=String(g.email).toLowerCase().slice(0,120);
 await Q('INSERT INTO users(email,name) VALUES($1,$2) ON CONFLICT(email) DO NOTHING',[email,String(g.name||'').slice(0,60)]);
 if(process.env.ADMIN_EMAIL&&email===process.env.ADMIN_EMAIL.trim().toLowerCase())await Q("UPDATE users SET role='admin' WHERE email=$1",[email]);
 const u=await one('SELECT * FROM users WHERE email=$1',[email]);
 if(!adminOk(u,q.body.password)){audit({u,ip:q.ip},'admin_login_fail','google');throw bad('كلمة سر الإدارة غير صحيحة',401)}
 if(u.role==='admin')audit({u,ip:q.ip},'admin_login','google');
 s.json({token:sign(u),user:{id:u.id,name:u.name,email:u.email,role:u.role}})}));
// CATALOG
app.get('/catalog',A(async(q,s)=>{const sh=await Q("SELECT s.id,c.name city,s.name,s.category,s.fee,s.img,s.address,(SELECT ROUND(AVG(o.rating)::numeric,1)::float FROM orders o WHERE o.shop_id=s.id AND o.rating IS NOT NULL) rate FROM shops s JOIN cities c ON c.id=s.city_id WHERE s.active=1 AND c.active=1 ORDER BY s.id"),it=await Q('SELECT id,shop_id,name,price,img FROM items WHERE available=1 ORDER BY id');s.json(sh.map(x=>({...x,items:it.filter(i=>i.shop_id==x.id)})))}));
app.get('/shops',A(async(q,s)=>s.json(await Q('SELECT s.* FROM shops s JOIN cities c ON c.id=s.city_id WHERE s.active=1 AND c.active=1 AND ($1::text IS NULL OR s.category=$1)',[q.query.category||null]))));
app.get('/shops/:id/items',A(async(q,s)=>s.json(await Q('SELECT * FROM items WHERE shop_id=$1 AND available=1',[q.params.id]))));
app.get('/promo/:code',A(async(q,s)=>{const p=await one('SELECT * FROM promos WHERE code=$1 AND active=1',[q.params.code.toUpperCase()]);p?s.json(p):s.sendStatus(404)}));
// COMPTE: suppression des données personnelles (clients uniquement)
app.delete('/me',auth('client'),A(async(q,s)=>{await Q("UPDATE orders SET user_id=NULL,phone=NULL,note=NULL,address='(supprimé)' WHERE user_id=$1",[q.u.id]);await Q('DELETE FROM push_subs WHERE user_id=$1',[q.u.id]);await Q('DELETE FROM users WHERE id=$1',[q.u.id]);s.json({ok:true})}));
// ORDERS
app.post('/orders',auth('client'),A(async(q,s)=>{const{shop_id,lines,address,promo,pay_method='cash',phone,note,tip,scheduled}=q.body;
 if(!address||!phone||!Array.isArray(lines)||!lines.length)throw bad('address/phone');
 if((await one('SELECT v FROM settings WHERE k=$1',['pay_'+pay_method]))?.v!=='1')throw bad('payment method unavailable');
 const sh=await one('SELECT * FROM shops WHERE id=$1 AND active=1',[shop_id]);if(!sh)throw bad('shop',404);
 let sub=0;const its=[];for(const l of lines){const qty=Math.floor(+l.qty);if(!(qty>0&&qty<=50))throw bad('qty');
  const i=await one('SELECT * FROM items WHERE id=$1 AND shop_id=$2 AND available=1',[l.item_id,shop_id]);if(!i)throw bad('item');sub+=i.price*qty;its.push({name:i.name,price:i.price,qty})}
 let sf=null;if(scheduled){const d=new Date(scheduled),ms=d-Date.now();if(isNaN(d)||ms<30*60000||ms>3*864e5)throw bad('وقت التوصيل المجدول غير صالح (بين 30 دقيقة و3 أيام)');sf=d.toISOString()}
 const mo=await sn('min_order',0);if(sub<mo)throw bad('الحد الأدنى للطلب '+mo+' MAD');
 const tp=Math.max(0,Math.min(100,Math.round((+tip||0)*100)/100)),code=String(crypto.randomInt(1000,10000));
 const p=promo&&await one('SELECT * FROM promos WHERE code=$1 AND active=1',[String(promo).toUpperCase()]);
 const disc=p?sh.fee*Math.min(p.percent,100)/100:0;
 const r=await one('INSERT INTO orders(user_id,shop_id,address,items,subtotal,fee,discount,pay_method,phone,note,tip,delivery_code,scheduled_for) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',[q.u.id,shop_id,String(address).slice(0,300),JSON.stringify(its),sub,sh.fee,disc,pay_method,String(phone).slice(0,20),String(note||'').slice(0,300),tp,code,sf]);
 notify('user_id IN (SELECT id FROM users WHERE role=$1 AND shop_id=$2)',['merchant',shop_id],'SIMO',()=>'🛎️ طلب جديد #'+r.id,'/staff.html');
 s.json({id:r.id,total:sub+sh.fee-disc+tp,delivery_code:code})}));
const pubs=(l,r)=>r==='client'||r==='admin'?l:l.map(o=>({...o,delivery_code:undefined}));
app.get('/orders',auth(),A(async(q,s)=>{const r=q.u.role;
 if(r==='admin')return s.json(await Q('SELECT * FROM orders ORDER BY id DESC'));
 const f={client:'user_id',courier:'courier_id',merchant:'shop_id'}[r];if(!f)return s.sendStatus(403);
 s.json(pubs(await Q(`SELECT * FROM orders WHERE ${f}=$1 ORDER BY id DESC`,[r==='merchant'?q.u.shop:q.u.id]),r))}));
app.get('/orders/available',auth('courier'),A(async(q,s)=>s.json(pubs(await Q("SELECT * FROM orders WHERE status='ready' AND courier_id IS NULL AND (scheduled_for IS NULL OR scheduled_for<=now()+interval '30 minutes')"),'courier'))));
const codeTries=new Map();
app.patch('/orders/:id/status',auth('merchant','courier','admin'),A(async(q,s)=>{const{status,code}=q.body;
 const ok={merchant:['accepted','ready'],courier:['picked','delivered'],admin:['cancelled']}[q.u.role];if(!ok.includes(status))return s.sendStatus(403);
 if(q.u.role==='courier'&&status==='delivered'){
  const o=await one('SELECT * FROM orders WHERE id=$1 AND courier_id=$2',[q.params.id,q.u.id]);if(!o)return s.sendStatus(404);
  if(o.status==='delivered')return s.json({ok:true});
  if(o.status!=='picked')throw bad('الطلب ليس في الطريق');
  const tr=codeTries.get(o.id)||{n:0,until:0};if(tr.until>Date.now())throw bad('محاولات كثيرة، انتظر 10 دقائق',429);
  if(o.delivery_code&&String(code||'').trim()!==o.delivery_code){tr.n++;if(tr.n>=5){tr.n=0;tr.until=Date.now()+600000}codeTries.set(o.id,tr);throw bad('كود التسليم غير صحيح')}
  codeTries.delete(o.id);await postDelivery(o.id);pushStatus(o.id,'delivered');return s.json({ok:true})}
 const own=q.u.role==='merchant'?' AND shop_id=$3':q.u.role==='courier'?' AND courier_id=$3':'';
 const r=await Q(`UPDATE orders SET status=$1 WHERE id=$2${own} AND status NOT IN ('delivered','cancelled') RETURNING id`,own?[status,q.params.id,q.u.role==='merchant'?q.u.shop:q.u.id]:[status,q.params.id]);
 if(r.length)pushStatus(+q.params.id,status);r.length?s.json({ok:true}):s.sendStatus(404)}));
app.post('/orders/:id/claim',auth('courier'),A(async(q,s)=>{const r=await Q("UPDATE orders SET courier_id=$1,status='picked' WHERE id=$2 AND courier_id IS NULL AND status='ready' RETURNING id",[q.u.id,q.params.id]);if(r.length)pushStatus(+q.params.id,'picked');r.length?s.json({ok:true}):s.sendStatus(409)}));
app.post('/orders/:id/rate',auth('client'),A(async(q,s)=>{const g=v=>{if(v==null||v==='')return null;const n=Math.round(+v);if(!(n>=1&&n<=5))throw bad('rating');return n};
 const sr=g(q.body.shop??q.body.rating),cr=g(q.body.courier);if(sr==null&&cr==null)throw bad('rating');
 const r=await Q("UPDATE orders SET rating=$1,rating_courier=$2,rating_comment=$3 WHERE id=$4 AND user_id=$5 AND status='delivered' AND rating IS NULL AND rating_courier IS NULL RETURNING id",[sr,cr,txt(q.body.comment,200)||null,q.params.id,q.u.id]);
 r.length?s.json({ok:true}):s.sendStatus(409)}));
// IMAGES (stockées en base: aucun disque nécessaire)
const mimeOf=b=>b.length<12?null:b[0]===0xFF&&b[1]===0xD8?'image/jpeg':b.slice(0,4).toString('hex')==='89504e47'?'image/png':b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP'?'image/webp':null;
app.post('/upload',auth('merchant','admin'),express.raw({type:'image/*',limit:'3mb'}),A(async(q,s)=>{const m=Buffer.isBuffer(q.body)&&mimeOf(q.body);if(!m)throw bad('صورة غير صالحة');
 const r=await one('INSERT INTO images(mime,data) VALUES($1,$2) RETURNING id',[m,q.body]);s.json({url:'/img/'+r.id})}));
app.get('/img/:id',A(async(q,s)=>{const r=/^\d+$/.test(q.params.id)&&await one('SELECT mime,data FROM images WHERE id=$1',[q.params.id]);if(!r)return s.sendStatus(404);
 s.set({'Content-Type':r.mime,'Cache-Control':'public,max-age=31536000,immutable'}).send(r.data)}));
const okImg=v=>v==null||v===''||/^(\/img\/\d+|https:\/\/[^\s"'<>]{1,500})$/.test(v)?(v||null):(()=>{throw bad('رابط صورة غير صالح')})();
const txt=(v,n)=>String(v??'').trim().slice(0,n);
// ITEMS (تاجر: متجره فقط • إدارة: كل المتاجر)
const shopOf=q=>q.u.role==='merchant'?q.u.shop:+q.body.shop_id;
app.post('/items',auth('merchant','admin'),A(async(q,s)=>{const sh=shopOf(q),n=txt(q.body.name,80),p=+q.body.price;if(!sh||!n||!(p>=0))throw bad('الاسم والسعر مطلوبان');
 const r=await one('INSERT INTO items(shop_id,name,price,img) VALUES($1,$2,$3,$4) RETURNING id',[sh,n,p,okImg(q.body.img)]);s.json({ok:true,id:r.id})}));
app.put('/items/:id',auth('merchant','admin'),A(async(q,s)=>{const b=q.body,own=q.u.role==='merchant';
 const r=await Q(`UPDATE items SET price=COALESCE($1,price),available=COALESCE($2,available),name=COALESCE($3,name),img=CASE WHEN $4::boolean THEN $5 ELSE img END WHERE id=$6${own?' AND shop_id=$7':''} RETURNING id`,
  [b.price==null?null:+b.price,b.available==null?null:(b.available?1:0),b.name?txt(b.name,80):null,'img' in b,'img' in b?okImg(b.img):null,q.params.id,...(own?[q.u.shop]:[])]);r.length?s.json({ok:true}):s.sendStatus(404)}));
app.delete('/items/:id',auth('merchant','admin'),A(async(q,s)=>{const own=q.u.role==='merchant';await Q(`DELETE FROM items WHERE id=$1${own?' AND shop_id=$2':''}`,[q.params.id,...(own?[q.u.shop]:[])]);s.json({ok:true})}));
app.get('/merchant/items',auth('merchant'),A(async(q,s)=>s.json(await Q('SELECT * FROM items WHERE shop_id=$1 ORDER BY id',[q.u.shop]))));
app.get('/merchant/shop',auth('merchant'),A(async(q,s)=>s.json(await one('SELECT id,name,address,img,category FROM shops WHERE id=$1',[q.u.shop])||{})));
app.put('/merchant/shop',auth('merchant'),A(async(q,s)=>{const b=q.body;await Q("UPDATE shops SET name=COALESCE($1,name),address=COALESCE($2,address),img=CASE WHEN $3::boolean THEN $4 ELSE img END WHERE id=$5",[b.name?txt(b.name,80):null,b.address?txt(b.address,200):null,'img' in b,'img' in b?okImg(b.img):null,q.u.shop]);s.json({ok:true})}));
// ADMIN
app.get('/admin/stats',auth('admin'),A(async(q,s)=>{const c=+(await one("SELECT v FROM settings WHERE k='commission'")).v;
 const t=await one("SELECT COUNT(*)::int n,COALESCE(SUM(subtotal+fee-discount),0) gmv FROM orders WHERE status='delivered'");
 s.json({delivered:t.n,gmv:t.gmv,revenue:+(await one("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE account='platform'")).v,commission:c})}));
app.put('/admin/commission',auth('admin'),A(async(q,s)=>{const v=+q.body.value;if(!(v>=0&&v<=100))throw bad('value');await Q("UPDATE settings SET v=$1 WHERE k='commission'",[String(v)]);s.json({ok:true})}));
app.put('/admin/cities/:id',auth('admin'),A(async(q,s)=>{await Q('UPDATE cities SET active=$1 WHERE id=$2',[q.body.active?1:0,q.params.id]);s.json({ok:true})}));
app.put('/admin/shops/:id',auth('admin'),A(async(q,s)=>{await Q('UPDATE shops SET active=$1 WHERE id=$2',[q.body.active?1:0,q.params.id]);s.json({ok:true})}));
app.get('/admin/items',auth('admin'),A(async(q,s)=>s.json(await Q('SELECT * FROM items WHERE shop_id=$1 ORDER BY id',[q.query.shop_id]))));
app.post('/admin/shops',auth('admin'),A(async(q,s)=>{const b=q.body,n=txt(b.name,80);if(!n)throw bad('الاسم مطلوب');
 const r=await one('INSERT INTO shops(city_id,name,category,fee,address,img) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[+b.city_id||1,n,txt(b.category,30)||'Restaurants',+b.fee>=0?+b.fee:15,txt(b.address,200),okImg(b.img)]);s.json({ok:true,id:r.id})}));
app.put('/admin/shops/:id/info',auth('admin'),A(async(q,s)=>{const b=q.body;await Q("UPDATE shops SET name=COALESCE($1,name),category=COALESCE($2,category),fee=COALESCE($3,fee),address=COALESCE($4,address),city_id=COALESCE($5,city_id),img=CASE WHEN $6::boolean THEN $7 ELSE img END WHERE id=$8",
 [b.name?txt(b.name,80):null,b.category?txt(b.category,30):null,b.fee==null||b.fee===''?null:+b.fee,b.address==null?null:txt(b.address,200),+b.city_id||null,'img' in b,'img' in b?okImg(b.img):null,q.params.id]);s.json({ok:true})}));
app.post('/admin/cities',auth('admin'),A(async(q,s)=>{const n=txt(q.body.name,60);if(!n)throw bad('الاسم مطلوب');await Q('INSERT INTO cities(name,active) VALUES($1,1) ON CONFLICT DO NOTHING',[n]);s.json({ok:true})}));
app.get('/admin/promos',auth('admin'),A(async(q,s)=>s.json(await Q('SELECT * FROM promos ORDER BY code'))));
app.post('/admin/promos',auth('admin'),A(async(q,s)=>{const c=txt(q.body.code,20).toUpperCase(),p=+q.body.percent;if(!/^[A-Z0-9]{3,20}$/.test(c)||!(p>0&&p<=100))throw bad('كود أو نسبة غير صالحة');
 await Q('INSERT INTO promos VALUES($1,$2,1) ON CONFLICT(code) DO UPDATE SET percent=EXCLUDED.percent,active=1',[c,p]);s.json({ok:true})}));
app.put('/admin/promos/:code',auth('admin'),A(async(q,s)=>{await Q('UPDATE promos SET active=$1 WHERE code=$2',[q.body.active?1:0,q.params.code]);s.json({ok:true})}));
app.get('/admin/settings',auth('admin'),A(async(q,s)=>s.json(Object.fromEntries((await Q("SELECT k,v FROM settings WHERE k NOT LIKE 'vapid_%'")).map(r=>[r.k,r.v])))));
app.get('/admin/users',auth('admin'),A(async(q,s)=>s.json(await Q("SELECT id,phone,email,name,role,shop_id FROM users WHERE role<>'client' ORDER BY id"))));
app.get('/admin/shops',auth('admin'),A(async(q,s)=>s.json(await Q('SELECT s.id,s.name,s.address,s.active,s.category,s.fee,s.img,s.city_id,c.name city FROM shops s JOIN cities c ON c.id=s.city_id ORDER BY s.id'))));
app.get('/admin/cities',auth('admin'),A(async(q,s)=>s.json(await Q('SELECT * FROM cities ORDER BY id'))));
app.put('/admin/settings',auth('admin'),A(async(q,s)=>{for(const[k,v]of Object.entries(q.body)){const nm=['courier_share','min_withdraw','min_order'].includes(k);if(nm&&!(+v>=0&&(k!=='courier_share'||+v<=100)))throw bad('قيمة غير صالحة');
 if(nm||/^(pay_|bank_)/.test(k))await Q('INSERT INTO settings VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v',[k,String(v)])}audit(q,'settings',Object.keys(q.body).join(','));s.json({ok:true})}));
app.put('/admin/users',auth('admin'),A(async(q,s)=>{const{phone,role,shop_id}=q.body,p=norm(phone),em=String(q.body.email||'').trim().toLowerCase();
 if((!p&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))||!['client','merchant','courier','admin'].includes(role))throw bad('invalid');
 if(p){await Q('INSERT INTO users(phone) VALUES($1) ON CONFLICT(phone) DO NOTHING',[p]);await Q('UPDATE users SET role=$1,shop_id=$2 WHERE phone=$3',[role,shop_id||null,p])}
 else{await Q('INSERT INTO users(email) VALUES($1) ON CONFLICT(email) DO NOTHING',[em]);await Q('UPDATE users SET role=$1,shop_id=$2 WHERE email=$3',[role,shop_id||null,em])}
 audit(q,'set_role',(p||em)+' → '+role);s.json({ok:true})}));

// ===== ACCOUNTING (دفتر الأستاذ) =====
const r2=n=>Math.round(n*100)/100;
const sn=async(k,d)=>{const r=await one('SELECT v FROM settings WHERE k=$1',[k]);return r&&r.v!=null&&r.v!==''?+r.v:d};
async function postDelivery(id){const cl=await pool.connect();
 try{await cl.query('BEGIN');
  const u=await cl.query("UPDATE orders SET status='delivered',delivered_at=now() WHERE id=$1 AND status='picked' RETURNING *",[id]);
  if(!u.rows.length){await cl.query('ROLLBACK');return}
  const o=u.rows[0],cfg=Object.fromEntries((await cl.query("SELECT k,v FROM settings WHERE k IN ('commission','courier_share')")).rows.map(x=>[x.k,+x.v]));
  const sub=o.subtotal,fee=o.fee,disc=o.discount||0,tip=o.tip||0,total=r2(sub+fee-disc+tip);
  const comm=r2(sub*(cfg.commission??15)/100),cf=r2(fee*(cfg.courier_share??80)/100);
  const E=[['shop',null,o.shop_id,'sale',r2(sub-comm),'مبيعات طلب #'+id],['platform',null,null,'commission',comm,'عمولة المتجر #'+id],['courier',o.courier_id,null,'delivery_fee',cf,'أجرة توصيل #'+id],['platform',null,null,'delivery_margin',r2(fee-cf-disc),'هامش التوصيل #'+id]];
  if(tip>0)E.push(['courier',o.courier_id,null,'tip',r2(tip),'بقشيش #'+id]);
  if(o.pay_method==='cash')E.push(['courier',o.courier_id,null,'cash_collected',-total,'نقد محصَّل #'+id]);
  for(const[a,uid,sid,k,amt,n]of E)await cl.query('INSERT INTO ledger(account,user_id,shop_id,order_id,kind,amount,note) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[a,uid,sid,id,k,amt,n]);
  await cl.query('COMMIT')}catch(e){await cl.query('ROLLBACK').catch(()=>{});throw e}finally{cl.release()}}
const ownr=q=>q.u.role==='merchant'?{a:'shop',c:'shop_id',id:q.u.shop}:{a:'courier',c:'user_id',id:q.u.id};
const bal=async(c,o)=>+(await c.query(`SELECT COALESCE(SUM(amount),0) b FROM ledger WHERE account=$1 AND ${o.c}=$2`,[o.a,o.id])).rows[0].b;
// WALLET (تاجر + موزع)
app.get('/wallet',auth('courier','merchant'),A(async(q,s)=>{const o=ownr(q);if(!o.id)throw bad('لا يوجد متجر مرتبط بحسابك');
 const[b,tx,wd,u,min]=await Promise.all([bal(pool,o),Q(`SELECT ts,kind,amount,note,order_id FROM ledger WHERE account=$1 AND ${o.c}=$2 ORDER BY id DESC LIMIT 60`,[o.a,o.id]),
  Q(`SELECT id,amount,status,ref,method,created FROM withdrawals WHERE ${o.c}=$1 AND role=$2 ORDER BY id DESC LIMIT 20`,[o.id,q.u.role]),
  one('SELECT payout_method,payout_details FROM users WHERE id=$1',[q.u.id]),sn('min_withdraw',100)]);
 const rc=q.u.role==='merchant'?['rating','shop_id']:['rating_courier','courier_id'],rt=await one(`SELECT ROUND(AVG(${rc[0]})::numeric,1)::float avg,COUNT(${rc[0]})::int n FROM orders WHERE ${rc[1]}=$1`,[o.id]);
 s.json({balance:r2(b),tx,wd,payout:u,min,rating:rt})}));
app.put('/wallet/payout',auth('courier','merchant'),A(async(q,s)=>{const m=q.body.method;let d=txt(q.body.details,60);
 if(m==='bank'){d=d.replace(/\s/g,'');const h=txt(q.body.holder,40);if(!/^\d{24}$/.test(d))throw bad('الـ RIB يجب أن يكون 24 رقمًا');if(h.length<3)throw bad('أدخل اسم صاحب الحساب');d=d+' • '+h}
 else if(m==='cashplus'){if(d.length<5)throw bad('أدخل الاسم الكامل ورقم البطاقة الوطنية')}else throw bad('طريقة غير صالحة');
 await Q('UPDATE users SET payout_method=$1,payout_details=$2 WHERE id=$3',[m,d,q.u.id]);s.json({ok:true})}));
app.post('/wallet/withdraw',auth('courier','merchant'),A(async(q,s)=>{const o=ownr(q),amt=r2(+q.body.amount);if(!o.id)throw bad('لا يوجد متجر مرتبط بحسابك');
 const min=await sn('min_withdraw',100);if(!(amt>=min))throw bad('الحد الأدنى للسحب '+min+' MAD');
 const u=await one('SELECT payout_method,payout_details FROM users WHERE id=$1',[q.u.id]);if(!u||!u.payout_method)throw bad('أضف بيانات استلام أموالك أولًا');
 const cl=await pool.connect();
 try{await cl.query('BEGIN');await cl.query('SELECT pg_advisory_xact_lock(hashtext($1))',[o.a+o.id]);
  if(amt>await bal(cl,o))throw bad('الرصيد غير كافٍ');
  const w=(await cl.query('INSERT INTO withdrawals(user_id,shop_id,role,amount,method,details) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[q.u.id,q.u.role==='merchant'?q.u.shop:null,q.u.role,amt,u.payout_method,u.payout_details])).rows[0];
  await cl.query('INSERT INTO ledger(account,user_id,shop_id,kind,amount,note) VALUES($1,$2,$3,$4,$5,$6)',[o.a,o.a==='courier'?o.id:null,o.a==='shop'?o.id:null,'withdraw',-amt,'طلب سحب #'+w.id]);
  await cl.query('COMMIT');s.json({ok:true,id:w.id})}catch(e){await cl.query('ROLLBACK').catch(()=>{});throw e}finally{cl.release()}}));
// ADMIN: wallets / withdrawals / ledger / reports
app.get('/admin/wallets',auth('admin'),A(async(q,s)=>s.json({
 couriers:await Q("SELECT u.id,u.phone,u.name,COALESCE(SUM(l.amount),0) balance,(COUNT(l.id) FILTER(WHERE l.kind='delivery_fee'))::int deliveries FROM users u LEFT JOIN ledger l ON l.account='courier' AND l.user_id=u.id WHERE u.role='courier' GROUP BY u.id ORDER BY u.id"),
 shops:await Q("SELECT s.id,s.name,COALESCE(SUM(l.amount),0) balance FROM shops s LEFT JOIN ledger l ON l.account='shop' AND l.shop_id=s.id GROUP BY s.id ORDER BY s.id")})));
app.get('/admin/withdrawals',auth('admin'),A(async(q,s)=>s.json(await Q("SELECT w.*,u.phone,u.name,sh.name shop FROM withdrawals w LEFT JOIN users u ON u.id=w.user_id LEFT JOIN shops sh ON sh.id=w.shop_id ORDER BY (w.status='pending') DESC,w.id DESC LIMIT 100"))));
app.post('/admin/withdrawals/:id/pay',auth('admin'),A(async(q,s)=>{const r=await Q("UPDATE withdrawals SET status='paid',ref=$2,processed=now() WHERE id=$1 AND status='pending' RETURNING id",[q.params.id,txt(q.body.ref,60)]);if(r.length)audit(q,'withdraw_paid','#'+q.params.id);r.length?s.json({ok:true}):s.sendStatus(404)}));
app.post('/admin/withdrawals/:id/reject',auth('admin'),A(async(q,s)=>{const cl=await pool.connect();
 try{await cl.query('BEGIN');const w=(await cl.query("UPDATE withdrawals SET status='rejected',processed=now(),ref=$2 WHERE id=$1 AND status='pending' RETURNING *",[q.params.id,txt(q.body.reason,100)])).rows[0];
  if(!w){await cl.query('ROLLBACK');return s.sendStatus(404)}
  await cl.query('INSERT INTO ledger(account,user_id,shop_id,kind,amount,note) VALUES($1,$2,$3,$4,$5,$6)',[w.role==='merchant'?'shop':'courier',w.role==='courier'?w.user_id:null,w.role==='merchant'?w.shop_id:null,'withdraw_refund',w.amount,'إرجاع طلب سحب #'+w.id]);
  await cl.query('COMMIT');audit(q,'withdraw_rejected','#'+q.params.id);s.json({ok:true})}catch(e){await cl.query('ROLLBACK').catch(()=>{});throw e}finally{cl.release()}}));
app.post('/admin/ledger',auth('admin'),A(async(q,s)=>{const{type}=q.body,id=Math.floor(+q.body.id),amt=r2(+q.body.amount),acct=q.body.account==='shop'?'shop':'courier';
 if(!['deposit','adjust'].includes(type)||!(Math.abs(amt)>0)||!(id>0))throw bad('بيانات غير صالحة');
 if(type==='deposit'&&(acct!=='courier'||amt<=0))throw bad('الإيداع النقدي للموزع فقط وبمبلغ موجب');
 const ex=acct==='shop'?await one('SELECT 1 FROM shops WHERE id=$1',[id]):await one("SELECT 1 FROM users WHERE id=$1 AND role='courier'",[id]);if(!ex)throw bad('غير موجود',404);
 await Q('INSERT INTO ledger(account,user_id,shop_id,kind,amount,note) VALUES($1,$2,$3,$4,$5,$6)',[acct,acct==='courier'?id:null,acct==='shop'?id:null,type==='deposit'?'cash_deposit':'adjustment',amt,txt(q.body.note,100)||(type==='deposit'?'إيداع نقدي':'تعديل يدوي')]);audit(q,'ledger_'+type,acct+' #'+id+' '+amt);s.json({ok:true})}));
const dt=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:null;
const rng=q=>[dt(q.query.from)||new Date(Date.now()-29*864e5).toISOString().slice(0,10),dt(q.query.to)||new Date().toISOString().slice(0,10)];
app.get('/admin/accounting',auth('admin'),A(async(q,s)=>{const R=rng(q);
 const[ord,pl,days,sh,cr,pw]=await Promise.all([
  one("SELECT COUNT(*)::int n,COALESCE(SUM(subtotal),0) sub,COALESCE(SUM(fee),0) fee,COALESCE(SUM(discount),0) disc,COALESCE(SUM(tip),0) tip FROM orders WHERE status='delivered' AND delivered_at::date BETWEEN $1 AND $2",R),
  Q("SELECT kind,COALESCE(SUM(amount),0) amount FROM ledger WHERE account='platform' AND ts::date BETWEEN $1 AND $2 GROUP BY kind",R),
  Q("SELECT delivered_at::date::text d,COUNT(*)::int n,SUM(subtotal+fee-discount+tip) gmv FROM orders WHERE status='delivered' AND delivered_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1 DESC",R),
  one("SELECT COALESCE(SUM(amount),0) v FROM ledger WHERE account='shop'"),
  one("SELECT COALESCE(SUM(b) FILTER(WHERE b>0),0) owed,COALESCE(-SUM(b) FILTER(WHERE b<0),0) debt FROM (SELECT SUM(amount) b FROM ledger WHERE account='courier' GROUP BY user_id) x"),
  one("SELECT COALESCE(SUM(amount),0) v,COUNT(*)::int n FROM withdrawals WHERE status='pending'")]);
 const P=Object.fromEntries(pl.map(x=>[x.kind,r2(+x.amount)]));
 s.json({from:R[0],to:R[1],orders:ord,platform:P,net:r2(Object.values(P).reduce((a,b)=>a+b,0)),days,
  liabilities:{shops:r2(+sh.v),courier_owed:r2(+cr.owed),courier_debt:r2(+cr.debt),pending_withdrawals:r2(+pw.v),pending_count:pw.n}})}));
app.get('/admin/ledger.csv',auth('admin'),A(async(q,s)=>{const R=rng(q);
 const rows=await Q("SELECT id,ts,account,user_id,shop_id,order_id,kind,amount,note FROM ledger WHERE ts::date BETWEEN $1 AND $2 ORDER BY id",R);
 const e=(v,t)=>{v=v==null?'':String(v instanceof Date?v.toISOString():v);if(t&&/^[=+@-]/.test(v))v="'"+v;return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
 s.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="simo-ledger-'+R[0]+'_'+R[1]+'.csv"'})
  .send('\ufeff'+['id,date,account,user_id,shop_id,order_id,kind,amount,note',...rows.map(r=>[r.id,e(r.ts),r.account,e(r.user_id),e(r.shop_id),e(r.order_id),r.kind,r.amount,e(r.note,1)].join(','))].join('\n'))}));
app.get('/admin/ratings',auth('admin'),A(async(q,s)=>s.json({
 shops:await Q("SELECT s.id,s.name,ROUND(AVG(o.rating)::numeric,1)::float avg,COUNT(o.rating)::int n FROM shops s JOIN orders o ON o.shop_id=s.id AND o.rating IS NOT NULL GROUP BY s.id ORDER BY avg DESC"),
 couriers:await Q("SELECT u.id,COALESCE(u.name,u.phone) name,ROUND(AVG(o.rating_courier)::numeric,1)::float avg,COUNT(o.rating_courier)::int n FROM users u JOIN orders o ON o.courier_id=u.id AND o.rating_courier IS NOT NULL GROUP BY u.id ORDER BY avg DESC")})));

// ===== TRACKING (تتبع المندوب) =====
app.post('/courier/location',auth('courier'),A(async(q,s)=>{const la=+q.body.lat,ln=+q.body.lng;
 if(!(la>=-90&&la<=90&&ln>=-180&&ln<=180)||(la===0&&ln===0))throw bad('إحداثيات غير صالحة');
 if(!await one("SELECT 1 FROM orders WHERE courier_id=$1 AND status='picked' LIMIT 1",[q.u.id]))return s.json({ok:true,active:false});
 await Q('INSERT INTO courier_loc(user_id,lat,lng,ts) VALUES($1,$2,$3,now()) ON CONFLICT(user_id) DO UPDATE SET lat=$2,lng=$3,ts=now()',[q.u.id,la,ln]);s.json({ok:true,active:true})}));
app.get('/orders/:id/track',auth('client'),A(async(q,s)=>{const o=await one('SELECT status,courier_id FROM orders WHERE id=$1 AND user_id=$2',[q.params.id,q.u.id]);if(!o)return s.sendStatus(404);
 if(o.status!=='picked'||!o.courier_id)return s.json({active:false,status:o.status});
 const l=await one("SELECT lat,lng,ts FROM courier_loc WHERE user_id=$1 AND ts>now()-interval '3 minutes'",[o.courier_id]);
 s.json({active:true,status:o.status,loc:l||null})}));
// ===== PUSH (إشعارات فورية — اختياري: يعمل عند تثبيت web-push) =====
let wp=null,VAPID=null;
async function pushInit(){try{wp=require('web-push')}catch{console.warn('web-push non installé: notifications push désactivées');return}
 try{let pub=process.env.VAPID_PUBLIC,pri=process.env.VAPID_PRIVATE;
  if(!pub||!pri){const a=await one("SELECT v FROM settings WHERE k='vapid_public'"),b=await one("SELECT v FROM settings WHERE k='vapid_private'");
   if(a&&b){pub=a.v;pri=b.v}else{const k=wp.generateVAPIDKeys();pub=k.publicKey;pri=k.privateKey;await Q("INSERT INTO settings VALUES('vapid_public',$1),('vapid_private',$2) ON CONFLICT(k) DO NOTHING",[pub,pri])}}
  wp.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:'+(process.env.ADMIN_EMAIL||'admin@simo.app'),pub,pri);VAPID=pub;console.log('Push prêt')}catch(e){console.error('push init',e.message);wp=null}}
const PUSH_HOST=/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)$/;
app.get('/push/key',(q,s)=>s.json({key:VAPID}));
app.post('/push/subscribe',auth(),A(async(q,s)=>{const e=q.body.endpoint,k=q.body.keys||{};let h='';try{h=new URL(e).hostname}catch{}
 if(!VAPID||typeof e!=='string'||e.length>700||!PUSH_HOST.test(h)||!k.p256dh||!k.auth)throw bad('اشتراك غير صالح');
 await Q('INSERT INTO push_subs(user_id,endpoint,p256dh,auth,lang) VALUES($1,$2,$3,$4,$5) ON CONFLICT(endpoint) DO UPDATE SET user_id=$1,p256dh=$3,auth=$4,lang=$5',[q.u.id,e,String(k.p256dh).slice(0,200),String(k.auth).slice(0,100),['fr','ar','en'].includes(q.body.lang)?q.body.lang:'fr']);s.json({ok:true})}));
app.post('/push/unsubscribe',auth(),A(async(q,s)=>{await Q('DELETE FROM push_subs WHERE endpoint=$1 AND user_id=$2',[String(q.body.endpoint||''),q.u.id]);s.json({ok:true})}));
const PM={accepted:{fr:'Commande acceptée ✅',ar:'تم قبول طلبك ✅',en:'Order accepted ✅'},ready:{fr:'Commande prête 🛍️',ar:'طلبك جاهز 🛍️',en:'Order ready 🛍️'},picked:{fr:'Votre livreur est en route 🛵',ar:'المندوب في الطريق إليك 🛵',en:'Your courier is on the way 🛵'},delivered:{fr:'Commande livrée 🎉',ar:'تم تسليم طلبك 🎉',en:'Order delivered 🎉'},cancelled:{fr:'Commande annulée',ar:'تم إلغاء طلبك',en:'Order cancelled'}};
async function notify(where,params,title,bodyFn,url){if(!wp)return;
 try{const subs=await Q(`SELECT * FROM push_subs WHERE ${where}`,params);
  await Promise.all(subs.map(x=>wp.sendNotification({endpoint:x.endpoint,keys:{p256dh:x.p256dh,auth:x.auth}},JSON.stringify({title,body:bodyFn(x.lang||'fr'),url}),{TTL:3600}).catch(async e=>{if(e.statusCode===404||e.statusCode===410)await Q('DELETE FROM push_subs WHERE id=$1',[x.id])})))}catch(e){console.error('push',e.message)}}
async function pushStatus(id,status){try{const o=await one('SELECT user_id FROM orders WHERE id=$1',[id]);
 if(o&&o.user_id&&PM[status])notify('user_id=$1',[o.user_id],'SIMO',l=>PM[status][l]+' #'+id,'/');
 if(status==='ready')notify("user_id IN (SELECT id FROM users WHERE role='courier')",[],'SIMO',()=>'📦 طلب جاهز للاستلام #'+id,'/staff.html')}catch(e){console.error('pushStatus',e.message)}}
app.get('/admin/audit',auth('admin'),A(async(q,s)=>s.json(await Q("SELECT a.ts,a.action,a.detail,a.ip,COALESCE(u.name,u.phone,u.email) who FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 40"))));
init().then(pushInit).then(()=>app.listen(process.env.PORT||3000,()=>console.log('SIMO API up'))).catch(e=>{console.error(e);process.exit(1)});
