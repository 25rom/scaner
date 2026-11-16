/* Price Radar — движок анализа. Работает в браузере и в Node (для тестов). */
(function (root) {
  'use strict';

  var GEO = {
    usa: /\busa\b|u\.s\.a?\.?|united states|\bсша\b|\bамерик/i,
    uk: /\buk\b|great britain|united kingdom|england|\bgbr?\b|великобритан|англи/i,
    germany: /germany|\bde\b|герман/i,
    belgium: /belgi|бельги/i,
    france: /france|франци/i,
    italy: /italy|итали/i,
    spain: /spain|испани/i,
    poland: /poland|польш/i,
    ukraine: /ukrain|\bua\b|украин/i,
    kazakhstan: /kazakh|\bkz\b|казахстан/i,
    japan: /japan|япони/i,
    taiwan: /taiwan|тайван/i,
    hongkong: /hong\s?kong|гонконг/i,
    korea: /korea|коре[яйи]/i,
    india: /india|инди[яи]/i,
    pakistan: /pakistan|пакистан/i,
    vietnam: /vietnam|вьетнам/i,
    brazil: /bra[sz]il|бразили/i,
    australia: /australia|австрали/i,
    singapore: /singapore|сингапур/i,
    denmark: /denmark|дани[яи]/i, netherlands: /netherlands|holland|нидерланд/i, sweden: /sweden|швеци/i,
    norway: /norway|норвеги/i, finland: /finland|финлянд/i, austria: /austria|австри[яи]/i,
    switzerland: /switzerland|швейцар/i, portugal: /portugal|португал/i, romania: /romania|румын/i,
    greece: /greece|греци/i, hungary: /hungary|венгри/i, czech: /czech|чехи/i, ireland: /ireland|ирланд/i,
    turkey: /turkey|t[uü]rkiye|турци/i, uae: /\buae\b|emirates|оаэ|эмират/i, saudi: /saudi|саудов/i,
    egypt: /egypt|егип/i, israel: /israel|израил/i, canada: /canada|канад/i, mexico: /mexico|мексик/i,
    colombia: /colombia|колумби/i, argentina: /argentin|аргентин/i, indonesia: /indonesia|индонез/i,
    thailand: /thailand|таиланд/i, philippines: /philippin|филиппин/i, malaysia: /malaysia|малайзи/i,
    bangladesh: /bangladesh|бангладеш/i, china: /\bchina|кита[йя]/i, russia: /russia|росси/i,
    newzealand: /new zealand|новая зеланд/i, nigeria: /nigeria|нигери/i,
    asia: /\basia|\bази[яи]/i,
    europe: /\beurope|\beu\b|европ/i
  };
  var MIX = /\bmix|random (country|ip)|different countries|worldwide|any geo|микс/i;
  var UNIT = '(days?|дн[яей]*|weeks?|недел[ьяи]|months?|mothe?s?|moths?|мес[яцаев]*|years?|yrs?|лет|года?)';

  function num(s) { return parseFloat(String(s).replace(/[,\s]/g, '')); }

  function toMonths(v, unit) {
    unit = unit.toLowerCase();
    if (/^d|^дн/.test(unit)) return v / 30;
    if (/^w|^нед/.test(unit)) return v / 4.3;
    if (/^y|^лет|^год/.test(unit)) return v * 12;
    return v;
  }

  function parseTitle(title, now) {
    now = now instanceof Date ? now : new Date();
    var nowYear = now.getFullYear(), nowMonth = now.getMonth() + 1;
    var t = ' ' + String(title || '').replace(/[_|·•]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    var a = { platform: null, threads: false, tiktokAds: false, bm: false, friends: 0,
      geo: null, age: null, twofa: false, pay: null, verified: false, fbAds: false };

    if (/instagram|инстаграм|\big\b/i.test(t)) a.platform = 'instagram';
    if (/threads?\b|тредс/i.test(t)) { a.threads = true; if (!a.platform) a.platform = 'instagram'; }
    if (!a.platform && /facebook|фейсбук|\bfb\b/i.test(t)) a.platform = 'facebook';
    if (!a.platform && /tik\s?tok|тик\s?ток/i.test(t)) a.platform = 'tiktok';
    if (!a.platform && /gmail/i.test(t)) a.platform = 'gmail';
    if (!a.platform && /google\s?ads|гугл\s?адс/i.test(t)) a.platform = 'googleads';
    if (!a.platform && /google|гугл/i.test(t)) a.platform = 'google';
    if (!a.platform && /twitter|\bx\.com\b|твиттер/i.test(t)) a.platform = 'twitter';
    if (!a.platform && /telegram|телеграм/i.test(t)) a.platform = 'telegram';
    if (!a.platform && /discord/i.test(t)) a.platform = 'discord';
    if (!a.platform && /reddit/i.test(t)) a.platform = 'reddit';
    if (!a.platform && /linkedin/i.test(t)) a.platform = 'linkedin';
    if (!a.platform && /outlook|hotmail|\baol\b|yahoo|\bgmx\b|rambler|proton|mail\.ru|firstmail/i.test(t)) a.platform = 'mail';
    a.service = /\b1 (like|follower|subscriber|view|video view|comment|repost)|накрутк|\bboost\b|smm panel/i.test(t);

    var ads = /\bads?\b|advertis|реклам/i.test(t);
    if (a.platform === 'tiktok') a.tiktokAds = ads;
    if (a.platform === 'facebook') a.fbAds = ads && !/ads (is|are) restricted/i.test(t);
    a.bm = /\bbc\s?\d*\b|business cent|\bбц\b|\bbm\s?\d*\b|business manager|\bбм\b/i.test(t);
    a.twofa = /2\s?fa|two[- ]factor|двухфактор/i.test(t);
    a.verified = /verif|подтвержд|вериф/i.test(t) && !/(mail|email|e-mail|sms|почт\S*)\s*verif|verified by (e-?mail|sms)|2fa key verif/i.test(t);
    if (/post\s?pa|automatic pa|auto\s?pay|постопл|постпей/i.test(t)) a.pay = 'postpay';
    else if (/pre\s?pa|manual pa|предопл/i.test(t)) a.pay = 'prepay';

    // друзья / подписчики
    var FR = '(?:real\\s+)?(?:friends?|друз\\S*|followers?|подписчик\\S*|subscribers?)';
    var m, friends = 0;
    var reA = new RegExp('(\\d[\\d,.]*)\\s*(k)?\\s*[-–~>]+\\s*(\\d[\\d,.]*)\\s*(k)?\\s*\\+?\\s*' + FR, 'i');
    var reB = new RegExp(FR + '\\s*(\\d[\\d,.]*)\\s*(k)?(?:\\s*[-–~]\\s*(\\d[\\d,.]*)\\s*(k)?)?', 'i');
    var reC = new RegExp('(\\d[\\d,.]*)\\s*(k)?\\s*\\+?\\s*(?:plus\\s*)?' + FR, 'i');
    if ((m = t.match(reA))) { friends = num(m[1]) * (m[2] ? 1000 : 1); t = t.replace(m[0], ' '); }
    else if ((m = t.match(reB))) { friends = num(m[1]) * (m[2] ? 1000 : 1); t = t.replace(m[0], ' '); }
    else if ((m = t.match(reC))) { friends = num(m[1]) * (m[2] ? 1000 : 1); t = t.replace(m[0], ' '); }
    a.friends = friends >= 1000 ? 2 : friends >= 100 ? 1 : 0;

    // гео
    var gpos = 1e9;   // берём гео, названное в тексте первым
    for (var g in GEO) { var gm = GEO[g].exec(t); if (gm && gm.index < gpos) { gpos = gm.index; a.geo = g; } }
    if (!a.geo && MIX.test(t)) a.geo = 'mix';

    // возраст в месяцах
    var r1 = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:-|–|to|до|\\+|/|\\s)\\s*(\\d+(?:\\.\\d+)?)\\s*' + UNIT, 'i');
    var r2 = new RegExp('(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*' + UNIT, 'i');
    var ry = /\b(20[0-2]\d)(?:\s*[-–]\s*(20[0-2]\d))?\b/;
    var rmy = /\b(?:\d{1,2}\.)?(0?[1-9]|1[0-2])\.(20[0-2]\d)\b/;
    if ((m = t.match(r1))) a.age = toMonths((parseFloat(m[1]) + parseFloat(m[2])) / 2, m[3]);
    else if ((m = t.match(r2))) a.age = toMonths(parseFloat(m[1]), m[2]);
    else if ((m = t.match(rmy)) && +m[2] <= nowYear) a.age = Math.max(0.25, (nowYear - +m[2]) * 12 + (nowMonth - +m[1]));
    else if ((m = t.match(ry)) && +m[1] >= 2004 && +m[1] <= nowYear) {
      var y = m[2] ? (+m[1] + +m[2]) / 2 : +m[1];
      a.age = Math.max(0.25, (nowYear - y) * 12 + (y === nowYear ? nowMonth / 2 : 0));
    } else if (/fresh|brand new|\bnew\b|свеж|авторег|autoreg/i.test(t)) a.age = 0.25;
    return a;
  }

  /* Сравнение лота с запросом. Возвращает {ok, score, why}. */
  function matchLot(q, l, opt) {
    if (!q.platform) return { ok: false, why: 'платформа в запросе не распознана' };
    if (l.platform !== q.platform) return { ok: false, why: 'другая платформа' };
    if (l.service) return { ok: false, why: 'услуга, не аккаунт' };
    if (q.threads !== l.threads) return { ok: false, why: q.threads ? 'без Threads' : 'с Threads' };
    if (q.platform === 'tiktok' && q.tiktokAds !== l.tiktokAds) return { ok: false, why: 'другой тип (Ads / обычный)' };
    if (q.bm !== l.bm) return { ok: false, why: q.bm ? 'без BM/БЦ' : 'с BM/БЦ' };
    if (q.friends !== l.friends) return { ok: false, why: 'другое число друзей' };
    var score = 40, notes = [];

    var lg = l.geo, qg = q.geo;
    var lFree = !lg || lg === 'mix', qFree = !qg || qg === 'mix';
    if (!lFree && (qFree || lg !== qg)) return { ok: false, why: 'другое гео (' + lg + ')' };
    if (!qFree && lFree) {
      if (opt.strictGeo) return { ok: false, why: 'гео не указано' };
      score += 8; notes.push('гео не указано');
    } else score += 25;

    if (q.age != null && l.age != null) {
      var x = q.age + 0.5, y = l.age + 0.5, ratio = Math.min(x, y) / Math.max(x, y);
      if (ratio < 0.5) return { ok: false, why: 'другой возраст' };
      score += 25 * ratio;
    } else if (q.age == null && l.age == null) score += 20;
    else if (q.age == null && l.age > 12) return { ok: false, why: 'другой возраст' };
    else if (q.age != null && l.age == null) return { ok: false, why: 'возраст не указан' };
    else { score += 8; notes.push('возраст не указан'); }

    if (q.twofa && !l.twofa) return { ok: false, why: 'без 2FA' };
    if (q.twofa === l.twofa) score += 10; else notes.push('с 2FA');
    if (q.pay && l.pay && q.pay !== l.pay) return { ok: false, why: 'другой тип оплаты' };
    if (q.verified !== l.verified) return { ok: false, why: 'верификация отличается' };
    if (q.fbAds !== l.fbAds) { score -= 10; }
    if (score < opt.minScore) return { ok: false, why: 'слабое совпадение' };
    return { ok: true, score: Math.round(score), notes: notes };
  }

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  }

  /* Главная функция. data = {lots:[...]}, cost — закупка или null. */
  function analyze(title, cost, data, opt) {
    opt = Object.assign({ minStock: 10, minScore: 55, strictGeo: false, includeUnknown: false,
      maxAgeDays: 14, cheapMargin: 60, dearMargin: 25, now: new Date() }, opt || {});
    var q = parseTitle(title, opt.now);
    var used = [], skipped = [];
    (data.lots || []).forEach(function (lot) {
      var l = parseTitle(lot.title, opt.now);
      if (!l.platform && lot.category) {   // платформы нет в названии — берём из раздела каталога
        var c = parseTitle(lot.category, opt.now);
        l.platform = c.platform; l.threads = l.threads || c.threads;
        if (c.platform === 'tiktok') l.tiktokAds = c.tiktokAds;
      }
      var m = matchLot(q, l, opt);
      if (!m.ok) return;
      var row = Object.assign({}, lot, { score: m.score, notes: m.notes });
      var days = lot.fetched ? (opt.now - new Date(lot.fetched)) / 864e5 : 0;
      if (days > opt.maxAgeDays) { row.reason = 'данные устарели (' + Math.round(days) + ' дн.)'; skipped.push(row); }
      else if (lot.stock === 0) { row.reason = 'нет в наличии'; skipped.push(row); }
      else if (lot.stock == null && !lot.stock_na && !opt.includeUnknown) { row.reason = 'остаток не виден'; skipped.push(row); }
      else if (lot.stock != null && lot.stock < opt.minStock) { row.reason = 'малый остаток (' + lot.stock + ' шт.)'; skipped.push(row); }
      else used.push(row);
    });
    // один и тот же лот на сайтах-зеркалах и одна цена у одной площадки считаются один раз
    used.sort(function (a, b) { return b.score - a.score || (b.stock || 0) - (a.stock || 0); });
    var seenKey = {};
    used = used.filter(function (r) {
      var k = r.title.toLowerCase().replace(/[^a-zа-я0-9]+/g, '') + '@' + r.price, k2 = r.source + '@' + r.price;
      if (seenKey[k]) { r.reason = 'дубль лота с ' + seenKey[k]; skipped.push(r); return false; }
      if (seenKey[k2]) { r.reason = 'та же цена у этой площадки уже учтена'; skipped.push(r); return false; }
      seenKey[k] = r.source; seenKey[k2] = r.source; return true;
    });
    if (used.length >= 4) {
      var med0 = median(used.map(function (r) { return r.price; }));
      used = used.filter(function (r) {
        if (r.price > med0 * 3) { r.reason = 'цена оторвана от рынка (выше медианы в 3+ раза)'; skipped.push(r); return false; }
        return true;
      });
    }
    used.sort(function (a, b) { return a.price - b.price; });
    skipped.sort(function (a, b) { return a.price - b.price; });
    var prices = used.map(function (r) { return r.price; });
    var res = { query: q, used: used, skipped: skipped, count: used.length,
      sources: Object.keys(used.reduce(function (o, r) { o[r.source] = 1; return o; }, {})).length };
    if (!prices.length) return res;
    res.low = prices[0]; res.high = prices[prices.length - 1];
    res.mean = prices.reduce(function (s, p) { return s + p; }, 0) / prices.length;
    res.median = median(prices);
    res.confidence = (res.count >= 5 && res.sources >= 3) ? 'высокая' : res.count >= 3 ? 'средняя' : 'низкая';
    if (cost != null && !isNaN(cost) && cost > 0) {
      res.cost = cost;
      res.margin = (res.mean - cost) / res.mean * 100;
      res.markup = (res.mean - cost) / cost * 100;
      res.verdict = res.margin < opt.dearMargin ? 'дорого' : res.margin > opt.cheapMargin ? 'дёшево' : 'ок';
    }
    return res;
  }

  var api = { parseTitle: parseTitle, analyze: analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PriceRadar = api;
})(typeof window !== 'undefined' ? window : globalThis);
