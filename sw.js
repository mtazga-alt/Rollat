/* نظام تصوير رول الجلسات — عامل الخدمة للعمل بدون اتصال
   يُرفع على GitHub بجوار admin.html و employee.html و user.html */
const CACHE='rol-v1';
const CORE=['./employee.html','./admin.html','./user.html','./config.js'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(CORE.map(u=>c.add(new Request(u,{cache:'reload'})).catch(()=>{})))));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
// الشبكة أولاً (لتصل التحديثات)، والنسخة المحفوظة عند انقطاع الاتصال
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin!==location.origin)return; // طلبات Google لا تُخزَّن
  e.respondWith((async()=>{
    try{
      const res=await Promise.race([fetch(r),new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),6000))]);
      if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp))}
      return res;
    }catch(err){
      const m=await caches.match(r,{ignoreSearch:true});
      if(m)return m;
      if(r.mode==='navigate')return (await caches.match('./employee.html'))||Response.error();
      return Response.error();
    }
  })());
});
