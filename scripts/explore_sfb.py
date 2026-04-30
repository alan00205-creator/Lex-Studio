#!/usr/bin/env python3
"""
explore_sfb.py — 證期局問答集站台的探勘工具（PRD §4.2 Phase 3 前置）

目的：
  在實作 fetch_qa.py 之前，先實際抓 sfb.gov.tw 兩種頁面的 HTML，
  把結構印出來，方便人類確認解析策略：
    1. 入口頁（id=858）：列出 23 大類的 id 與名稱
    2. 子分類頁（預設 id=863 公開發行公司募集發行）：列出 PDF 連結、發布日期

執行後會：
  - 印出可讀的 markdown 報告到 stdout
  - 將原始 HTML 與解析結果存到 output/_explore/

Usage:
    python3 scripts/explore_sfb.py                    # 抓 858 + 863
    python3 scripts/explore_sfb.py --id 863           # 只抓 863
    python3 scripts/explore_sfb.py --all-categories   # 抓 858 加上所有發現的子分類
    python3 scripts/explore_sfb.py --raw              # 只 dump 原始 HTML，不做解析

Note:
  本腳本對 sfb.gov.tw 發出 GET，網路較不穩定時可加 --delay 與 --retries。
  如本機 IP 段被擋（HTTP 403），請改用個人網路或 VPN 重跑。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.stderr.write(
        "缺少相依套件。請先執行：pip install -r scripts/requirements.txt\n"
    )
    sys.exit(1)


BASE = "https://www.sfb.gov.tw"
INDEX_ID = 858  # 問答集首頁
SAMPLE_SUBCATEGORY_ID = 863  # 公開發行公司募集發行（PRD 建議的探勘樣本）

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

OUT_DIR = Path("output/_explore")


@dataclass
class Subcategory:
    id: int
    name: str
    url: str
    parentpath: Optional[str] = None


@dataclass
class PdfDoc:
    title: str
    href: str
    file_path: Optional[str] = None     # uploaddowndoc 的 file 參數
    filename: Optional[str] = None      # filedisplay 參數（人類可讀檔名）
    inferred_date: Optional[str] = None  # 從 file_path 內檔名前綴推斷
    sibling_date: Optional[str] = None   # 從同一列表格抽到的日期欄位（若有）
    raw_anchor_html: str = ""


@dataclass
class PageReport:
    page_id: int
    url: str
    http_code: int
    html_path: str
    subcategories: list[Subcategory] = field(default_factory=list)
    pdf_docs: list[PdfDoc] = field(default_factory=list)
    other_links_sample: list[str] = field(default_factory=list)


def fetch(url: str, retries: int, delay: float, timeout: int) -> tuple[int, str]:
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
            return resp.status_code, resp.text
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(delay * attempt)
    raise last_err if last_err else RuntimeError("fetch failed")


# ============================================
# 解析輔助
# ============================================

def normalize_url(href: str, base: str = BASE) -> str:
    return urljoin(base + "/", href)


def parse_home_jsp_id(href: str) -> Optional[int]:
    """從 home.jsp?id=XXX 抽出 id 參數。"""
    if "home.jsp" not in href:
        return None
    qs = parse_qs(urlparse(href).query)
    raw = (qs.get("id") or [None])[0]
    try:
        return int(raw) if raw is not None else None
    except ValueError:
        return None


def parse_uploaddowndoc(href: str) -> tuple[Optional[str], Optional[str]]:
    """從 /uploaddowndoc?file=...&filedisplay=... 抽出 (file_path, filename)。"""
    if "uploaddowndoc" not in href and "fckdowndoc" not in href:
        return None, None
    qs = parse_qs(urlparse(href).query)
    file_path = (qs.get("file") or [None])[0]
    filename = (qs.get("filedisplay") or [None])[0]
    return file_path, filename


def infer_date_from_path(file_path: Optional[str]) -> Optional[str]:
    """從 chdownload/YYYYMMDDHHMMSSN.pdf 推斷發布日期（YYYY-MM-DD）。"""
    if not file_path:
        return None
    m = re.search(r"(\d{8})\d{6,}", file_path)  # 至少 14 位數
    if not m:
        return None
    yyyymmdd = m.group(1)
    try:
        y, mo, d = yyyymmdd[:4], yyyymmdd[4:6], yyyymmdd[6:8]
        if not (1990 <= int(y) <= 2099 and 1 <= int(mo) <= 12 and 1 <= int(d) <= 31):
            return None
        return f"{y}-{mo}-{d}"
    except ValueError:
        return None


def find_sibling_date(anchor) -> Optional[str]:
    """嘗試在同一個 row / 父元素內找到日期文字，如「112.04.15」「2024-06-27」。"""
    parent = anchor.find_parent(["tr", "li", "div"])
    if not parent:
        return None
    text = parent.get_text(" ", strip=True)
    # 民國年式 e.g. 112.04.15 / 113-06-27
    m = re.search(r"(1\d{2})[\.\-/](\d{1,2})[\.\-/](\d{1,2})", text)
    if m:
        roc, mo, d = m.groups()
        return f"{int(roc) + 1911}-{int(mo):02d}-{int(d):02d}"
    # 西元年式
    m = re.search(r"(20\d{2})[\.\-/](\d{1,2})[\.\-/](\d{1,2})", text)
    if m:
        return f"{int(m.group(1))}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


# ============================================
# 主要解析
# ============================================

def parse_index_page(html: str, page_id: int, url: str, html_path: str) -> PageReport:
    soup = BeautifulSoup(html, "lxml")
    report = PageReport(page_id=page_id, url=url, http_code=200, html_path=html_path)

    seen_subcat_ids = set()
    for a in soup.find_all("a", href=True):
        sid = parse_home_jsp_id(a["href"])
        if sid is None or sid == page_id:
            continue
        if sid in seen_subcat_ids:
            continue
        seen_subcat_ids.add(sid)
        qs = parse_qs(urlparse(a["href"]).query)
        report.subcategories.append(Subcategory(
            id=sid,
            name=a.get_text(strip=True),
            url=normalize_url(a["href"]),
            parentpath=(qs.get("parentpath") or [None])[0],
        ))

    # 補充：sample 一些其他連結（看是否有 sitemap / 其他結構線索）
    for a in soup.find_all("a", href=True)[:30]:
        href = a["href"]
        if "home.jsp" not in href and ("uploaddowndoc" not in href):
            report.other_links_sample.append(href)

    return report


def parse_subcategory_page(html: str, page_id: int, url: str, html_path: str) -> PageReport:
    soup = BeautifulSoup(html, "lxml")
    report = PageReport(page_id=page_id, url=url, http_code=200, html_path=html_path)

    for a in soup.find_all("a", href=True):
        href = a["href"]
        file_path, filename = parse_uploaddowndoc(href)
        if not file_path:
            # 也可能是 .pdf 直連
            if not href.lower().endswith(".pdf"):
                continue

        title = a.get_text(strip=True) or filename or "(無標題)"
        report.pdf_docs.append(PdfDoc(
            title=title,
            href=normalize_url(href),
            file_path=file_path,
            filename=filename,
            inferred_date=infer_date_from_path(file_path),
            sibling_date=find_sibling_date(a),
            raw_anchor_html=str(a)[:200],
        ))

    return report


# ============================================
# 報告輸出
# ============================================

def print_index_report(rep: PageReport):
    print(f"\n## 入口頁（id={rep.page_id}）\n")
    print(f"- URL：{rep.url}")
    print(f"- HTTP：{rep.http_code}")
    print(f"- 原始 HTML 已存：{rep.html_path}")
    print(f"- 偵測到 {len(rep.subcategories)} 個子分類：\n")
    if rep.subcategories:
        print("| id | 名稱 | parentpath | URL |")
        print("|---|---|---|---|")
        for sc in sorted(rep.subcategories, key=lambda s: s.id):
            print(f"| {sc.id} | {sc.name} | `{sc.parentpath or ''}` | {sc.url} |")
    else:
        print("（找不到任何子分類連結 — 解析策略可能要調整，請檢視 raw HTML）")


def print_subcategory_report(rep: PageReport):
    print(f"\n## 子分類頁（id={rep.page_id}）\n")
    print(f"- URL：{rep.url}")
    print(f"- HTTP：{rep.http_code}")
    print(f"- 原始 HTML 已存：{rep.html_path}")
    print(f"- 偵測到 {len(rep.pdf_docs)} 份 PDF：\n")
    if rep.pdf_docs:
        print("| 標題 | 推斷發布日期 | 同列日期 | 檔案路徑 |")
        print("|---|---|---|---|")
        for d in rep.pdf_docs:
            print(f"| {d.title[:40]} | {d.inferred_date or '—'} | {d.sibling_date or '—'} | `{d.file_path or d.href}` |")
        print("\n### 第一筆原始 anchor HTML（供結構參考）\n")
        print("```html")
        print(rep.pdf_docs[0].raw_anchor_html)
        print("```")
    else:
        print("（找不到任何 PDF 連結 — 解析策略可能要調整，請檢視 raw HTML）")


def save_report_json(reports: list[PageReport]):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / "explore_report.json"
    payload = [asdict(r) for r in reports]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✓ 結構化報告已存：{path}")


# ============================================
# Main
# ============================================

def explore_one(page_id: int, retries: int, delay: float, timeout: int, raw_only: bool) -> Optional[PageReport]:
    url = f"{BASE}/ch/home.jsp?id={page_id}&parentpath=0,6" if page_id == INDEX_ID \
          else f"{BASE}/ch/home.jsp?id={page_id}&parentpath=0,6,{INDEX_ID}"

    print(f"\n--- 抓 id={page_id} ---")
    print(f"GET {url}")
    try:
        code, html = fetch(url, retries=retries, delay=delay, timeout=timeout)
    except Exception as e:
        print(f"  ✗ 連線失敗：{e}", file=sys.stderr)
        return None

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    html_path = OUT_DIR / f"sfb_{page_id}.html"
    html_path.write_text(html, encoding="utf-8")
    print(f"  HTTP {code}, {len(html)} bytes → {html_path}")

    if code != 200:
        print(f"  ⚠ 非 200，可能被擋。HTML 開頭：{html[:200]!r}")
        return PageReport(page_id=page_id, url=url, http_code=code, html_path=str(html_path))

    if raw_only:
        return PageReport(page_id=page_id, url=url, http_code=code, html_path=str(html_path))

    if page_id == INDEX_ID:
        return parse_index_page(html, page_id, url, str(html_path))
    return parse_subcategory_page(html, page_id, url, str(html_path))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", type=int, default=None,
                        help=f"只抓特定 id；不指定則抓 {INDEX_ID} + {SAMPLE_SUBCATEGORY_ID}")
    parser.add_argument("--all-categories", action="store_true",
                        help="抓入口頁後，依序抓所有發現的子分類")
    parser.add_argument("--raw", action="store_true",
                        help="只下載原始 HTML，不解析（除錯用）")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--delay", type=float, default=1.0,
                        help="連續請求間的秒數（避免被擋）")
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()

    reports: list[PageReport] = []

    if args.id is not None:
        rep = explore_one(args.id, args.retries, args.delay, args.timeout, args.raw)
        if rep:
            reports.append(rep)
    else:
        # 預設：先抓入口頁，再抓 PRD 建議的樣本子分類
        idx = explore_one(INDEX_ID, args.retries, args.delay, args.timeout, args.raw)
        if idx:
            reports.append(idx)
        time.sleep(args.delay)
        sub = explore_one(SAMPLE_SUBCATEGORY_ID, args.retries, args.delay, args.timeout, args.raw)
        if sub:
            reports.append(sub)

        if args.all_categories and idx and idx.subcategories:
            print(f"\n--- 額外抓所有 {len(idx.subcategories)} 個子分類 ---")
            for sc in idx.subcategories:
                if sc.id == SAMPLE_SUBCATEGORY_ID:
                    continue  # 已抓過
                time.sleep(args.delay)
                rep = explore_one(sc.id, args.retries, args.delay, args.timeout, args.raw)
                if rep:
                    reports.append(rep)

    # 報告
    print("\n" + "=" * 60)
    print("# 證期局站台探勘報告")
    print("=" * 60)
    for rep in reports:
        if rep.page_id == INDEX_ID:
            print_index_report(rep)
        else:
            print_subcategory_report(rep)

    save_report_json(reports)

    # 給未來 fetch_qa.py 的提示
    print("\n## 給 fetch_qa.py 設計的觀察重點\n")
    print("1. 子分類是用 `<a href=\"home.jsp?id=...\">` 還是 `<frame>` 呈現？")
    print("2. PDF 連結是否一律走 `/uploaddowndoc?file=...&filedisplay=...&flag=doc`？")
    print("3. 發布日期能否從 file 路徑開頭的 timestamp 可靠推斷？或要從 sibling 文字另外抽？")
    print("4. 有沒有分頁機制（pagination）？單頁是否包含整類所有 PDF？")
    print("5. 是否有 CSRF token / Cookie 要求？")

    return 0


if __name__ == "__main__":
    sys.exit(main())
