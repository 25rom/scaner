#!/usr/bin/env python3
"""Price Radar — сборщик цен.

Читает sources.json, обходит страницы магазинов, вытаскивает лоты
(название, цена, остаток, ссылка) и пишет data/lots.js + data/lots.json.

Запуск:  python scrape.py
Проверка без сети:  python scrape.py --selftest
"""
import json
import re
import sys
import time
import datetime as dt
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib import robotparser

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

NUM = r"\d{1,3}(?:[ , ]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?"
INT = r"\d{1,3}(?:[ , ]\d{3})+|\d+"
PRICE_RES = [
    (re.compile(r"\$\s*(" + NUM + ")"), "USD"),
    (re.compile(r"(" + NUM + r")\s*(?:\$|USD\b)", re.I), "USD"),
    (re.compile(r"(" + NUM + r")\s*(?:руб\.?|₽|RUB\b)", re.I), "RUB"),
]
STOCK_RES = [
    re.compile(r"(?:in\s*stock|stock|available|availability|в\s*наличии|наличие|кол-?во|qty)"
               r"[\s:|]*(" + INT + ")", re.I),
    re.compile(r"(" + INT + r")\s*(?:pcs\.?|шт\.?|left|items?|in\s*stock)(?![a-zа-я])", re.I),
]
SOLD_RE = re.compile(r"(?:sold|sales|продано|продаж)[\s:|]*(" + INT + r")(?:\s*(?:pcs\.?|pieces?|шт\.?))?", re.I)
NOISE_RE = re.compile(r"(?:cash\s?back|к[эе]шб[эе]к\w*|bonus|бонус\w*|discount|скидк\w*|save|выгода)[^|\d]{0,30}" + "(?:" + NUM + r")\s*(?:%|\$|USD|руб\.?|₽|RUB)?"
                      r"|(?:/|per|for|за)\s*1\s*(?:pcs?\.?|pieces?|шт\.?|account|акк\w*)", re.I)
OUT_RE = re.compile(r"out of stock|sold out|нет в наличии|закончил", re.I)


def to_float(s):
    s = s.strip().replace(" ", "").replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        # 1,85 -> 1.85 ; 2,578 -> 2578
        head, tail = s.rsplit(",", 1)
        s = head + tail if len(tail) == 3 else head + "." + tail
    return float(s)


def to_int(s):
    return int(re.sub(r"[ , ]", "", s))


def find_prices(text):
    out = []
    for rx, cur in PRICE_RES:
        for m in rx.finditer(text):
            try:
                out.append((m.start(), to_float(m.group(1)), cur))
            except ValueError:
                pass
    out.sort()
    uniq = []  # одно и то же число, пойманное двумя шаблонами
    for p in out:
        if not uniq or not (p[1] == uniq[-1][1] and abs(p[0] - uniq[-1][0]) <= 12):
            uniq.append(p)
    return uniq


def find_stock(text, table_row=False):
    """Возвращает остаток (int) или None, если на карточке его не видно."""
    clean = SOLD_RE.sub(" ", text)
    for rx in STOCK_RES:
        m = rx.search(clean)
        if m:
            return to_int(m.group(1))
    if OUT_RE.search(text):
        return 0
    if table_row:  # в таблицах остаток часто стоит отдельной ячейкой без подписи
        for seg in clean.split("|"):
            if re.fullmatch(r"\s*(" + INT + r")\s*", seg):
                return to_int(seg.strip())
    return None


def extract_lots(html, base_url, usd_rub=83.0, bare_stock=True):
    """Универсальный разбор: ищет «карточки» — блоки с одной ценой и названием."""
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript", "svg", "s", "del", "strike"]):
        t.decompose()
    lots, seen = [], set()
    for node in soup.find_all(string=True):
        txt = NOISE_RE.sub(" ", str(node))
        if not find_prices(txt):
            continue
        card, el = None, node.parent
        for _ in range(8):
            if el is None or el.name in ("body", "html", "[document]"):
                break
            full = NOISE_RE.sub(" ", el.get_text(" | ", strip=True))
            prices = find_prices(full)
            if not prices:
                el = el.parent
                continue
            if len({round(p[1], 4) for p in prices}) > 2 or len(full) > 1500:
                break
            links = [a for a in el.find_all("a", href=True)
                     if len(a.get_text(" ", strip=True)) >= 12]
            heads = [h for h in el.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
                     if len(h.get_text(" ", strip=True)) >= 12]
            if links or heads:
                card = (el, full, prices, links, heads)
                break
            el = el.parent
        if not card:
            continue
        el, full, prices, links, heads = card
        if id(el) in seen:
            continue
        seen.add(id(el))
        title_el = max(links, key=lambda x: len(x.get_text(" ", strip=True))) if links else heads[0]
        title = re.sub(r"\s+", " ", title_el.get_text(" ", strip=True))[:300]
        href = None
        if links:
            href = urljoin(base_url, max(links, key=lambda x: len(x.get_text(" ", strip=True)))["href"])
        rest = full.replace(title_el.get_text(" | ", strip=True), " ")
        _, price, cur = min(prices, key=lambda p: p[1])
        orig = None
        if cur == "RUB":
            orig = "%.2f RUB" % price
            price = round(price / usd_rub, 4)
        if price <= 0 or price > 100000:
            continue
        sold = SOLD_RE.search(rest)
        lots.append({
            "title": title,
            "price": price,
            "price_orig": orig,
            "stock": find_stock(rest, bare_stock and el.name == "tr"),
            "sold": to_int(sold.group(1)) if sold else None,
            "url": href or base_url,
        })
    # убрать повторы одной карточки
    out, keys = [], set()
    for l in lots:
        k = (l["title"].lower(), l["price"])
        if k not in keys:
            keys.add(k)
            out.append(l)
    return out


def allowed(url, cache={}):
    """Уважает robots.txt: запрещённые страницы не читаются."""
    p = urlparse(url)
    host = p.scheme + "://" + p.netloc
    if host not in cache:
        rp = robotparser.RobotFileParser()
        try:
            r = requests.get(host + "/robots.txt", headers={"User-Agent": UA}, timeout=15)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except requests.RequestException:
            rp.parse([])
        cache[host] = rp
    return cache[host].can_fetch("*", url)


def run():
    cfg = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    rate = float(cfg.get("usd_rub", 83))
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    DATA.mkdir(exist_ok=True)
    old = {"lots": [], "status": {}}
    f = DATA / "lots.json"
    if f.exists():
        old = json.loads(f.read_text(encoding="utf-8"))
    by_src = {}
    for l in old.get("lots", []):
        by_src.setdefault(l["source"], []).append(l)
    status = old.get("status", {})

    for src in cfg["sources"]:
        name = src["name"]
        if not src.get("enabled", True):
            continue
        got, err = [], None
        for page in src["pages"]:
            url, cat = page["url"], page.get("category", "")
            try:
                if not allowed(url):
                    err = "запрещено robots.txt"
                    continue
                r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en,ru;q=0.8"},
                                 timeout=30)
                if r.status_code != 200:
                    err = "HTTP %s" % r.status_code
                    continue
                no_stock = bool(src.get("ignore_stock"))
                for l in extract_lots(r.text, url, rate, src.get("bare_stock", True) and not no_stock):
                    if no_stock:   # площадка не показывает остаток: количество не учитывается
                        l["stock"], l["stock_na"] = None, True
                    l.update(source=name, category=cat, fetched=now)
                    got.append(l)
            except requests.RequestException as e:
                err = type(e).__name__
            time.sleep(float(cfg.get("delay_sec", 2)))
        if got:
            by_src[name] = got            # свежие данные заменяют старые
            status[name] = {"ok": True, "lots": len(got), "at": now, "error": err}
        else:                              # не вышло — старые лоты остаются и стареют
            status[name] = {"ok": False, "lots": len(by_src.get(name, [])), "at": now,
                            "error": err or "лоты не найдены (возможно, сайт рисует страницу скриптом)"}
        print("%-16s %s" % (name, status[name]))

    # ручные лоты из data/manual.json
    m = DATA / "manual.json"
    if m.exists():
        man = json.loads(m.read_text(encoding="utf-8")).get("lots", [])
        by_src["вручную"] = [dict(l, source=l.get("source", "вручную")) for l in man]

    lots = [l for ls in by_src.values() for l in ls]
    out = {"updated": now, "usd_rub": rate, "status": status, "lots": lots}
    js = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    f.write_text(js, encoding="utf-8")
    (DATA / "lots.js").write_text("window.LOTS_DATA = " + js + ";\n", encoding="utf-8")
    print("Всего лотов: %d" % len(lots))


def selftest():
    html = """
    <div class="list">
      <div class="item"><a href="/p/1">1-3 month old Instagram with 2fa key</a>
        <span>206 pcs.</span><span>Sold 106 pieces</span><b>price/pc from $0.60</b></div>
      <div class="item"><h3><a href="/p/2">Fresh Instagram accounts with 2fa authentication</a></h3>
        <p>Stock 2,578 pcs.</p><p>Price $0.15 / piece</p></div>
      <table><tr><td><a href="/p/3">TikTok Ads (ПРЕДОПЛАТА) Германия, без НДС, USD, PREPAY</a></td>
        <td>14</td><td>195.75 Руб / шт</td></tr></table>
      <div class="item"><h5>Fresh Facebook account with 2fa key</h5><i>$0.50</i><i>4 left</i></div>
      <div class="item"><a href="/p/5">Instagram Accounts USA IP gmail included 2FA</a>
        <span>Price per pc</span><span>from $1,85</span></div>
      <div class="item"><a href="/p/6">Old Facebook accounts 2015 with friends</a>
        <s>$34.99</s> <b>$16.99</b> <em>Out of stock</em></div>
    </div>"""
    lots = extract_lots(html, "https://shop.test/cat")
    for l in lots:
        print(l)
    html2 = """<table>
      <tr><td><a href="/x">TikTok ADS Account Italy · Currency: USD · No VAT · Manual Payment</a><br>51<br>(1)<br>
        Cashback amount: 0.02 USD<br>In stock: <b>25 pcs</b><br>Sold: <b>76 pcs</b></td><td>2.23 USD</td></tr>
      <tr><td><a href="/y">Facebook (Asia), 2+ months from registration 2FA key and Profile UID included</a></td>
        <td>213</td><td>0.83 $ / 1 pcs</td></tr>
      <tr><td><a href="/z">Аккаунт TikTok ADS · Подтвержденный · Франция · Automatic Pay</a><br>Сумма кэшбека: 14 Руб.<br>
        В наличии: <b>6 шт</b><br>Продаж: <b>233 шт</b></td><td>1 397 Руб.</td></tr></table>"""
    l2 = extract_lots(html2, "https://shop.test/")
    for l in l2:
        print(l)
    assert [(l["price"], l["stock"], l["sold"]) for l in l2] == [(2.23, 25, 76), (0.83, 213, None), (round(1397 / 83, 4), 6, 233)], l2
    exp = [(0.60, 206), (0.15, 2578), (round(195.75 / 83, 4), 14), (0.50, 4), (1.85, None), (16.99, 0)]
    got = [(l["price"], l["stock"]) for l in lots]
    assert got == exp, got
    assert lots[0]["sold"] == 106 and lots[0]["url"] == "https://shop.test/p/1"
    print("selftest OK")


if __name__ == "__main__":
    selftest() if "--selftest" in sys.argv else run()
