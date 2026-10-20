// SIMO API v2 (PostgreSQL) — DATABASE_URL, JWT_SECRET requis
const express=require('express'),cors=require('cors'),jwt=require('jsonwebtoken'),{Pool}=require('pg'),fs=require('fs');
const DEV=process.env.DEV_OTP==='1',SECRET=process.env.JWT_SECRET;
if(!SECRET){console.error('JWT_SECRET manquant');process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='1'?{rejectUnauthorized:false}:undefined});
const Q=async(t,p=[])=>(await pool.query(t,p)).rows,one=async(t,p)=>(await Q(t,p))[0];
const app=express();app.set('trust proxy',1);app.disable('x-powered-by');app.use((q,s,n)=>{s.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'strict-origin-when-cross-origin'});n()});app.use(cors(),express.json({limit:'100kb'}));
const A=f=>(q,s,n)=>f(q,s,n).catch(e=>{console.error(e);s.status(e.status||500).json({error:e.status?e.message:'Erreur serveur'})});
const bad=(m,st=400)=>{const e=new Error(m);e.status=st;return e};
const PAGES=['index.html','staff.html','sw.js','manifest.json','icon-192.png','icon-512.png'];
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
 INSERT INTO settings VALUES('commission','15'),('pay_cash','1'),('pay_card','0'),('pay_wallet','0'),('pay_cashplus','0'),('bank_name',''),('bank_rib',''),('bank_holder','') ON CONFLICT DO NOTHING;`);
 if(!await one('SELECT 1 FROM shops LIMIT 1'))await Q(fs.readFileSync(__dirname+'/seed.sql','utf8'));
 if(DEV)await Q(fs.readFileSync(__dirname+'/seed_test.sql','utf8'));
 // Premier administrateur (production): defini par ADMIN_PHONE (ex: 0612345678)
 const ap=norm(process.env.ADMIN_PHONE);
 if(ap){await Q('INSERT INTO users(phone,name,role) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET role=$3',[ap,'Admin','admin']);console.log('Admin pret:',ap)}
}
// OTP (SMS via Twilio si TWILIO_SID/TWILIO_TOKEN/TWILIO_FROM définis)
const otps=new Map(),hits=new Map();
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
 s.json({token:jwt.sign({id:u.id,role:u.role,shop:u.shop_id},SECRET,{expiresIn:'30d'}),user:u})}));
app.get('/config',A(async(q,s)=>s.json(Object.fromEntries((await Q("SELECT k,v FROM settings WHERE k LIKE 'pay_%'")).map(r=>[r.k,r.v])))));
// CATALOG
app.get('/catalog',A(async(q,s)=>{const sh=await Q("SELECT s.id,c.name city,s.name,s.category,s.fee,s.img,s.address FROM shops s JOIN cities c ON c.id=s.city_id WHERE s.active=1 AND c.active=1 ORDER BY s.id"),it=await Q('SELECT id,shop_id,name,price,img FROM items WHERE available=1 ORDER BY id');s.json(sh.map(x=>({...x,items:it.filter(i=>i.shop_id==x.id)})))}));
app.get('/shops',A(async(q,s)=>s.json(await Q('SELECT s.* FROM shops s JOIN cities c ON c.id=s.city_id WHERE s.active=1 AND c.active=1 AND ($1::text IS NULL OR s.category=$1)',[q.query.category||null]))));
app.get('/shops/:id/items',A(async(q,s)=>s.json(await Q('SELECT * FROM items WHERE shop_id=$1 AND available=1',[q.params.id]))));
app.get('/promo/:code',A(async(q,s)=>{const p=await one('SELECT * FROM promos WHERE code=$1 AND active=1',[q.params.code.toUpperCase()]);p?s.json(p):s.sendStatus(404)}));
// COMPTE: suppression des données personnelles (clients uniquement)
app.delete('/me',auth('client'),A(async(q,s)=>{await Q("UPDATE orders SET user_id=NULL,phone=NULL,note=NULL,address='(supprimé)' WHERE user_id=$1",[q.u.id]);await Q('DELETE FROM users WHERE id=$1',[q.u.id]);s.json({ok:true})}));
// ORDERS
app.post('/orders',auth('client'),A(async(q,s)=>{const{shop_id,lines,address,promo,pay_method='cash',phone,note}=q.body;
 if(!address||!phone||!Array.isArray(lines)||!lines.length)throw bad('address/phone');
 if((await one('SELECT v FROM settings WHERE k=$1',['pay_'+pay_method]))?.v!=='1')throw bad('payment method unavailable');
 const sh=await one('SELECT * FROM shops WHERE id=$1 AND active=1',[shop_id]);if(!sh)throw bad('shop',404);
 let sub=0;const its=[];for(const l of lines){const qty=Math.floor(+l.qty);if(!(qty>0&&qty<=50))throw bad('qty');
  const i=await one('SELECT * FROM items WHERE id=$1 AND shop_id=$2 AND available=1',[l.item_id,shop_id]);if(!i)throw bad('item');sub+=i.price*qty;its.push({name:i.name,price:i.price,qty})}
 const p=promo&&await one('SELECT * FROM promos WHERE code=$1 AND active=1',[String(promo).toUpperCase()]);
 const disc=p?sh.fee*Math.min(p.percent,100)/100:0;
 const r=await one('INSERT INTO orders(user_id,shop_id,address,items,subtotal,fee,discount,pay_method,phone,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[q.u.id,shop_id,String(address).slice(0,300),JSON.stringify(its),sub,sh.fee,disc,pay_method,String(phone).slice(0,20),String(note||'').slice(0,300)]);
 s.json({id:r.id,total:sub+sh.fee-disc})}));
app.get('/orders',auth(),A(async(q,s)=>{const r=q.u.role;
 if(r==='admin')return s.json(await Q('SELECT * FROM orders ORDER BY id DESC'));
 const f={client:'user_id',courier:'courier_id',merchant:'shop_id'}[r];if(!f)return s.sendStatus(403);
 s.json(await Q(`SELECT * FROM orders WHERE ${f}=$1 ORDER BY id DESC`,[r==='merchant'?q.u.shop:q.u.id]))}));
app.get('/orders/available',auth('courier'),A(async(q,s)=>s.json(await Q("SELECT * FROM orders WHERE status='ready' AND courier_id IS NULL"))));
app.patch('/orders/:id/status',auth('merchant','courier','admin'),A(async(q,s)=>{const{status}=q.body;
 const ok={merchant:['accepted','ready'],courier:['picked','delivered'],admin:['cancelled']}[q.u.role];if(!ok.includes(status))return s.sendStatus(403);
 const own=q.u.role==='merchant'?' AND shop_id=$3':q.u.role==='courier'?' AND courier_id=$3':'';
 const r=await Q(`UPDATE orders SET status=$1 WHERE id=$2${own} RETURNING id`,own?[status,q.params.id,q.u.role==='merchant'?q.u.shop:q.u.id]:[status,q.params.id]);
 r.length?s.json({ok:true}):s.sendStatus(404)}));
app.post('/orders/:id/claim',auth('courier'),A(async(q,s)=>{const r=await Q("UPDATE orders SET courier_id=$1,status='picked' WHERE id=$2 AND courier_id IS NULL AND status='ready' RETURNING id",[q.u.id,q.params.id]);r.length?s.json({ok:true}):s.sendStatus(409)}));
app.post('/orders/:id/rate',auth('client'),A(async(q,s)=>{const n=Math.round(+q.body.rating);if(!(n>=1&&n<=5))throw bad('rating');await Q("UPDATE orders SET rating=$1 WHERE id=$2 AND user_id=$3 AND status='delivered'",[n,q.params.id,q.u.id]);s.json({ok:true})}));
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
 s.json({delivered:t.n,gmv:t.gmv,revenue:t.gmv*c/100,commission:c})}));
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
app.get('/admin/settings',auth('admin'),A(async(q,s)=>s.json(Object.fromEntries((await Q('SELECT k,v FROM settings')).map(r=>[r.k,r.v])))));
app.get('/admin/users',auth('admin'),A(async(q,s)=>s.json(await Q("SELECT id,phone,name,role,shop_id FROM users WHERE role<>'client' ORDER BY id"))));
app.get('/admin/shops',auth('admin'),A(async(q,s)=>s.json(await Q('SELECT s.id,s.name,s.address,s.active,s.category,s.fee,s.img,s.city_id,c.name city FROM shops s JOIN cities c ON c.id=s.city_id ORDER BY s.id'))));
app.get('/admin/cities',auth('admin'),A(async(q,s)=>s.json(await Q('SELECT * FROM cities ORDER BY id'))));
app.get('/courier/cash',auth('courier'),A(async(q,s)=>s.json(await one("SELECT COALESCE(SUM(subtotal+fee-discount),0) due,COALESCE(SUM(fee)*0.8,0) earned FROM orders WHERE courier_id=$1 AND status='delivered' AND pay_method='cash' AND settled=0",[q.u.id]))));
app.get('/admin/payouts',auth('admin'),A(async(q,s)=>s.json(await Q("SELECT courier_id,COUNT(*)::int n,SUM(subtotal+fee-discount) cash_collected,SUM(fee)*0.8 courier_share FROM orders WHERE status='delivered' AND settled=0 GROUP BY courier_id"))));
app.post('/admin/payouts/:courier/settle',auth('admin'),A(async(q,s)=>{await Q("UPDATE orders SET settled=1 WHERE courier_id=$1 AND status='delivered'",[q.params.courier]);s.json({ok:true})}));
app.put('/admin/settings',auth('admin'),A(async(q,s)=>{for(const[k,v]of Object.entries(q.body))if(/^(pay_|bank_)/.test(k))await Q('INSERT INTO settings VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v',[k,String(v)]);s.json({ok:true})}));
app.put('/admin/users',auth('admin'),A(async(q,s)=>{const{phone,role,shop_id}=q.body,p=norm(phone);if(!p||!['client','merchant','courier','admin'].includes(role))throw bad('invalid');
 await Q('INSERT INTO users(phone) VALUES($1) ON CONFLICT(phone) DO NOTHING',[p]);await Q('UPDATE users SET role=$1,shop_id=$2 WHERE phone=$3',[role,shop_id||null,p]);s.json({ok:true})}));
init().then(()=>app.listen(process.env.PORT||3000,()=>console.log('SIMO API up'))).catch(e=>{console.error(e);process.exit(1)});
