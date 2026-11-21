/***************************************************************
 *  نظام تصوير رول الجلسات — سكربت الربط مع Google Drive
 *  يُلصق في script.google.com ثم يُنشر كتطبيق ويب
 ***************************************************************/

var ADMIN_PASSWORD = __ADMIN__;   // كلمة سر المسؤول (للرفع والحذف)
var STAFF_PASSWORD = __STAFF__;   // (قديم) كلمة سر مشتركة للموظفين — يُفضّل تركها "" واستخدام حسابات الموظفين
var VIEW_PASSWORD  = __VIEW__;    // كلمة سر الاطلاع — اتركها "" ليكون الاطلاع لكل من لديه الرابط
var FOLDER_NAME    = 'رول الجلسات - النيابة';

/** شغّل هذه الدالة مرة واحدة من المحرر لمنح الصلاحيات وإنشاء المجلد */
function setup() {
  var f = getFolder_();
  Logger.log('تم التجهيز بنجاح ✓  المجلد: ' + f.getUrl());
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try { var old = DriveApp.getFolderById(id); if (!old.isTrashed()) return old; } catch (e) {}
  }
  var f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ===== حسابات الموظفين (اسم مستخدم + كلمة سر مشفّرة) ===== */
function normU_(u) { return String(u || '').trim().toLowerCase(); }
function hash_(salt, pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8));
}
function getUser_(u) { var v = PropertiesService.getScriptProperties().getProperty('U:' + u); return v ? JSON.parse(v) : null; }
function putUser_(u, o) { PropertiesService.getScriptProperties().setProperty('U:' + u, JSON.stringify(o)); }
function usersArr_() {
  var all = PropertiesService.getScriptProperties().getProperties(), arr = [];
  for (var k in all) if (k.indexOf('U:') === 0) {
    try { var o = JSON.parse(all[k]); arr.push({ user: k.slice(2), name: o.name, active: o.active !== false, created: o.created || '', last: o.last || '', count: o.count || 0 }); } catch (e) {}
  }
  arr.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return arr;
}

var AUTH_ = { role: 'none' };
function auth_(p) {
  var u = normU_(p.user);
  if (!u && ADMIN_PASSWORD && p.pass === ADMIN_PASSWORD) return { role: 'admin', user: 'admin', name: 'المسؤول' };
  if (u) {
    var c = CacheService.getScriptCache(), fk = 'F:' + u, fails = +(c.get(fk) || 0);
    if (fails >= 8) return { role: 'none', reason: 'locked' };
    var o = getUser_(u);
    if (o && o.hash === hash_(o.salt, String(p.pass || ''))) {
      if (o.active === false) return { role: 'none', reason: 'disabled' };
      c.remove(fk);
      return { role: 'staff', user: u, name: o.name };
    }
    c.put(fk, String(fails + 1), 900);
    return { role: 'none', reason: 'bad' };
  }
  if (STAFF_PASSWORD && p.pass === STAFF_PASSWORD) return { role: 'staff', user: 'shared', name: 'موظف (كلمة سر مشتركة)' };
  if (!VIEW_PASSWORD || p.pass === VIEW_PASSWORD) return { role: 'view' };
  return { role: 'none' };
}
function role_(p) { return AUTH_.role; }

function need_(p, r) {
  var a = AUTH_, x = a.role;
  if (r === 'admin' && x !== 'admin') throw new Error(x === 'staff' ? 'هذه العملية للمسؤول فقط' : 'كلمة سر المسؤول غير صحيحة');
  if (r === 'upload' && x !== 'admin' && x !== 'staff') throw new Error(
    a.reason === 'disabled' ? 'تم إيقاف حسابك — راجع المسؤول' :
    a.reason === 'locked' ? 'تم إيقاف الدخول مؤقتاً بعد محاولات خاطئة — حاول بعد 15 دقيقة' :
    'اسم المستخدم أو كلمة السر غير صحيحة');
  if (r === 'view' && x === 'none') throw new Error('كلمة سر الاطلاع غير صحيحة');
}

/* ===== سجل الرفع (ملف JSON داخل Drive) ===== */
function logFile_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('LOG_ID');
  if (id) { try { var f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var nf = getFolder_().createFile('سجل_رفع_الرولات.json', '[]', 'application/json');
  props.setProperty('LOG_ID', nf.getId());
  return nf;
}
function readLog_() { try { return JSON.parse(logFile_().getBlob().getDataAsString('UTF-8') || '[]'); } catch (e) { return []; } }
function addLog_(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var f = logFile_(), arr = [];
    try { arr = JSON.parse(f.getBlob().getDataAsString('UTF-8') || '[]'); } catch (x) {}
    arr.unshift(e);
    if (arr.length > 5000) arr.length = 5000;
    f.setContent(JSON.stringify(arr));
  } catch (x) { /* السجل لا يوقف الرفع */ } finally { try { lock.releaseLock(); } catch (x) {} }
}

function inFolder_(file, folder) {
  var ps = file.getParents();
  while (ps.hasNext()) if (ps.next().getId() === folder.getId()) return true;
  return false;
}

function info_(f) {
  var m = {};
  try { m = JSON.parse(f.getDescription() || '{}'); } catch (e) {}
  return { id: f.getId(), name: f.getName(), size: f.getSize(),
           created: f.getDateCreated().toISOString(), url: f.getUrl(), meta: m };
}

function cleanName_(n) {
  n = String(n || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!n) throw new Error('اكتب اسم المجلد');
  return n;
}

function getNews_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('NEWS') || '[]'); } catch (e) { return []; }
}
function setNews_(a) {
  PropertiesService.getScriptProperties().setProperty('NEWS', JSON.stringify(a.slice(0, 30)));
}

function doGet(e)  { return handle_((e && e.parameter) || {}); }
function doPost(e) { var p = {}; try { p = JSON.parse(e.postData.contents); } catch (x) {} return handle_(p); }

function handle_(p) {
  try {
    AUTH_ = auth_(p);
    var folder = getFolder_();
    switch (p.action) {
      case 'ping':
        var r = role_(p);
        var res = { ok: true, role: r, v: 8, folder: folder.getName(), folderUrl: '', reason: AUTH_.reason || '' };
        if (r === 'staff') { res.user = AUTH_.user; res.name = AUTH_.name; }
        if (r === 'admin') {
          res.folderUrl = folder.getUrl(); res.folderId = folder.getId();
          try { res.account = DriveApp.getRootFolder().getOwner().getEmail(); } catch (e) { res.account = ''; }
        }
        return json_(res);

      case 'upload':
        need_(p, 'upload');
        // منع التكرار: لو أُعيد إرسال نفس الملف من صندوق الانتظار بعد انقطاع الاتصال
        var qid = p.meta && p.meta.qid, props = PropertiesService.getScriptProperties(), seenQ = {};
        if (qid) {
          try { seenQ = JSON.parse(props.getProperty('QIDS') || '{}'); } catch (e) {}
          if (seenQ[qid]) { try { var ex = DriveApp.getFileById(seenQ[qid]); if (!ex.isTrashed()) return json_({ ok: true, dup: true, file: info_(ex) }); } catch (e) {} }
        }
        var blob = Utilities.newBlob(Utilities.base64Decode(p.data), 'application/pdf', p.name || ('رول_' + Date.now() + '.pdf'));
        var nf = folder.createFile(blob), mt = p.meta || {};
        mt.by = { user: AUTH_.user, name: AUTH_.name };
        nf.setDescription(JSON.stringify(mt));
        if (qid) {
          seenQ[qid] = nf.getId();
          var ks = Object.keys(seenQ); while (ks.length > 150) delete seenQ[ks.shift()];
          props.setProperty('QIDS', JSON.stringify(seenQ));
        }
        addLog_({ t: new Date().toISOString(), act: 'upload', user: AUTH_.user, name: AUTH_.name,
                  file: nf.getName(), fileId: nf.getId(), size: nf.getSize(), pages: mt.pages || '', session: mt.sessionDate || '',
                  captured: mt.captured || '', capturedBy: mt.capturedBy || '',
                  device: String(p.device || '').slice(0, 160), devId: String(p.devId || '').slice(0, 12) });
        if (AUTH_.role === 'staff' && AUTH_.user !== 'shared') {
          var uo = getUser_(AUTH_.user); if (uo) { uo.last = new Date().toISOString(); uo.count = (uo.count || 0) + 1; putUser_(AUTH_.user, uo); }
        }
        return json_({ ok: true, file: info_(nf) });

      case 'list':
        need_(p, 'view');
        var it = folder.getFilesByType(MimeType.PDF), arr = [];
        while (it.hasNext()) arr.push(info_(it.next()));
        arr.sort(function (a, b) { return a.created < b.created ? 1 : -1; });
        return json_({ ok: true, files: arr, news: getNews_(), folder: folder.getName() });

      case 'get':
        need_(p, 'view');
        var g = DriveApp.getFileById(p.id);
        if (!inFolder_(g, folder) || g.isTrashed()) throw new Error('الملف غير موجود');
        return json_({ ok: true, name: g.getName(), data: Utilities.base64Encode(g.getBlob().getBytes()) });

      case 'delete':
        need_(p, 'admin');
        var d = DriveApp.getFileById(p.id);
        if (!inFolder_(d, folder)) throw new Error('الملف غير موجود');
        d.setTrashed(true);
        addLog_({ t: new Date().toISOString(), act: 'delete', user: 'admin', name: 'المسؤول', file: d.getName(), fileId: d.getId(),
                  device: String(p.device || '').slice(0, 160), devId: String(p.devId || '').slice(0, 12) });
        return json_({ ok: true });

      case 'users':
        need_(p, 'admin');
        return json_({ ok: true, users: usersArr_() });

      case 'user_save':
        need_(p, 'admin');
        var un = normU_(p.username);
        if (!/^[a-z0-9\u0600-\u06FF._-]{3,30}$/.test(un)) throw new Error('اسم المستخدم: من 3 إلى 30 حرفاً أو رقماً بدون مسافات');
        if (un === 'admin' || un === 'shared') throw new Error('هذا الاسم محجوز');
        var uo2 = getUser_(un);
        if (p.isNew && uo2) throw new Error('اسم المستخدم موجود بالفعل');
        if (!p.isNew && !uo2) throw new Error('الموظف غير موجود');
        uo2 = uo2 || { created: new Date().toISOString(), active: true };
        if (p.name != null) uo2.name = String(p.name).trim().slice(0, 60);
        if (!uo2.name) throw new Error('اكتب اسم الموظف');
        if (p.password) {
          if (String(p.password).length < 4) throw new Error('كلمة السر 4 أحرف على الأقل');
          uo2.salt = Utilities.getUuid(); uo2.hash = hash_(uo2.salt, String(p.password));
        }
        if (!uo2.hash) throw new Error('اكتب كلمة السر');
        if (typeof p.active === 'boolean') uo2.active = p.active;
        putUser_(un, uo2);
        CacheService.getScriptCache().remove('F:' + un);
        return json_({ ok: true, users: usersArr_() });

      case 'user_del':
        need_(p, 'admin');
        PropertiesService.getScriptProperties().deleteProperty('U:' + normU_(p.username));
        return json_({ ok: true, users: usersArr_() });

      case 'log':
        need_(p, 'admin');
        return json_({ ok: true, log: readLog_() });

      case 'lawyer':     // تسجيل المحامي من نسخة المستخدم (أول مرة + كل زيارة)
        need_(p, 'view');
        var lph = String(p.phone || '').replace(/[^\d+]/g, ''), lnm = String(p.name || '').trim().slice(0, 80);
        if (lph.replace(/\D/g, '').length < 8 || lnm.length < 3) throw new Error('بيانات المحامي غير مكتملة');
        var lkey = 'L:' + lph.replace(/\D/g, '').slice(-10), lprops = PropertiesService.getScriptProperties(), lo = {};
        try { lo = JSON.parse(lprops.getProperty(lkey) || '{}'); } catch (e) {}
        var lnow = new Date().toISOString();
        lo.name = lnm; lo.phone = lph; lo.first = lo.first || lnow; lo.last = lnow;
        lo.visits = (lo.visits || 0) + 1; lo.device = String(p.device || '').slice(0, 160);
        lprops.setProperty(lkey, JSON.stringify(lo));
        return json_({ ok: true });

      case 'lawyers':
        need_(p, 'admin');
        var lall = PropertiesService.getScriptProperties().getProperties(), larr = [];
        for (var lk in lall) if (lk.indexOf('L:') === 0) { try { larr.push(JSON.parse(lall[lk])); } catch (e) {} }
        larr.sort(function (a, b) { return (a.last || '') < (b.last || '') ? 1 : -1; });
        return json_({ ok: true, lawyers: larr });

      case 'folder_rename':
        need_(p, 'admin');
        var nm = cleanName_(p.name);
        folder.setName(nm);
        return json_({ ok: true, folder: nm, folderUrl: folder.getUrl(), folderId: folder.getId() });

      case 'folder_create':
        need_(p, 'admin');
        var nm2 = cleanName_(p.name), oldId = folder.getId();
        var nf2 = DriveApp.createFolder(nm2);
        PropertiesService.getScriptProperties().setProperty('FOLDER_ID', nf2.getId());
        return json_({ ok: true, folder: nm2, folderId: nf2.getId(), folderUrl: nf2.getUrl(), oldId: oldId });

      case 'share':
        need_(p, 'admin');
        var em = String(p.email || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error('البريد غير صحيح');
        folder.addViewer(em);
        return json_({ ok: true, folderId: folder.getId() });

      case 'transfer':   // نقل (نفس الحساب) أو نسخ (من حساب آخر) على دفعات
        need_(p, 'admin');
        var src;
        try { src = DriveApp.getFolderById(p.src); } catch (e) { throw new Error('لا يمكن الوصول للمجلد المصدر — تأكد من مشاركته مع هذا الحساب'); }
        if (src.getId() === folder.getId()) throw new Error('المجلد المصدر هو نفسه المجلد الحالي');
        var t0 = Date.now(), moved = 0, left = 0, total = 0;
        if (p.mode === 'move') {
          var itm = src.getFilesByType(MimeType.PDF);
          while (itm.hasNext()) { var fm = itm.next(); if (Date.now() - t0 > 240000) { left++; continue; } fm.moveTo(folder); moved++; }
          return json_({ ok: true, done: moved, left: left, complete: left === 0 });
        }
        var have = {}, ih = folder.getFiles();
        while (ih.hasNext()) { var mh = {}; try { mh = JSON.parse(ih.next().getDescription() || '{}'); } catch (e) {} if (mh.srcId) have[mh.srcId] = 1; }
        var itc = src.getFilesByType(MimeType.PDF);
        while (itc.hasNext()) {
          var fc = itc.next(); total++;
          if (have[fc.getId()]) continue;
          if (Date.now() - t0 > 240000) { left++; continue; }
          var mc = {}; try { mc = JSON.parse(fc.getDescription() || '{}'); } catch (e) {}
          mc.srcId = fc.getId();
          fc.makeCopy(fc.getName(), folder).setDescription(JSON.stringify(mc));
          moved++;
        }
        return json_({ ok: true, done: moved, left: left, total: total, complete: left === 0 });

      case 'news':
        need_(p, 'view');
        return json_({ ok: true, news: getNews_() });

      case 'news_add':
        need_(p, 'admin');
        var t = String(p.text || '').trim().slice(0, 300);
        if (!t) throw new Error('نص الخبر فارغ');
        var n = getNews_();
        n.unshift({ id: Utilities.getUuid().slice(0, 8), text: t, urgent: !!p.urgent, date: new Date().toISOString() });
        setNews_(n);
        return json_({ ok: true, news: getNews_() });

      case 'news_del':
        need_(p, 'admin');
        setNews_(getNews_().filter(function (x) { return x.id !== p.id; }));
        return json_({ ok: true, news: getNews_() });
    }
    throw new Error('طلب غير معروف');
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}
