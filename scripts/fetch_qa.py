#!/usr/bin/env python3
"""
fetch_qa.py — 抓取證期局問答集並產生 output/qa.json（PRD §4.2 / §11 T3.1–T3.3）

流程：
  1. 抓入口頁 https://www.sfb.gov.tw/ch/home.jsp?id=858&parentpath=0,6
     找出所有子分類（類似 home.jsp?id=863 的連結）
  2. 對每個子分類：
     a. 抓子分類頁
     b. 找出所有 PDF 連結（uploaddowndoc?file=…&filedisplay=…）
     c. 下載每份 PDF 至 output/qa_pdfs/<id>/<basename>.pdf
     d. 用 pdfplumber 抽完整原文（不做任何 AI 改寫，PRD §6.3）
  3. 加抓交易所創新板 FAQ（PRD §4.3）
     URL: https://www.twse.com.tw/downloads/zh/products/tib_qa.pdf
  4. 產生 output/qa.json，schema 同 PRD §4.4.2
     - source_url 直接指向證期局原始下載 URL（不從 GitHub Pages 提供 PDF）
     - raw_text 為 PDF 抽出的完整原文

使用方式：
    pip install -r scripts/requirements.txt
    python3 scripts/fetch_qa.py                    # 全部
    python3 scripts/fetch_qa.py --only 863         # 只抓特定分類
    python3 scripts/fetch_qa.py --skip-pdf-extract # 只更新索引，不重新抽 PDF 文字
    python3 scripts/fetch_qa.py --dry-run          # 不下載，只列要做的事
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, unquote, urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.stderr.write("缺少相依套件。請執行：pip install -r scripts/requirements.txt\n")
    sys.exit(1)

try:
    import pdfplumber
    HAS_PDF = True
except ImportError:
    HAS_PDF = False  # 仍可只更新索引（用 --skip-pdf-extract）


# ============================================
# 設定
# ============================================

BASE = "https://www.sfb.gov.tw"
INDEX_URL = f"{BASE}/ch/home.jsp?id=858&parentpath=0,6"
TIB_FAQ_URL = "https://www.twse.com.tw/downloads/zh/products/tib_qa.pdf"

# 證期局問答集（id=858）底下的 23 個真正問答集子分類 ID 白名單。
# 入口頁的 <a href> 會把整個 sfb.gov.tw 與 fsc.gov.tw 全站 sitemap 一起吸進來
# （聯絡我們、新聞稿、政府資訊公開、性別主流化專區、政策宣導廣告……），
# 必須以白名單收斂回實際問答集（公司治理、公開收購、內線交易……等）。
# 編號對應入口頁的 1.~23.（4. 與 14. 為 865 / 875）。
QA_CATEGORY_IDS = {
    862, 863, 864, 865, 866, 867, 868, 869, 870, 871,
    872, 873, 874, 875, 876, 877, 878, 879, 880,
    1033, 1061, 1062, 1073,
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

OUT_DIR = Path("output")
PDF_DIR = OUT_DIR / "qa_pdfs"
QA_JSON = OUT_DIR / "qa.json"


@dataclass
class Document:
    title: str
    publish_date: Optional[str]
    source_url: str
    local_pdf: Optional[str] = None
    raw_text: str = ""
    page_count: int = 0


@dataclass
class Category:
    id: int
    name: str
    url: str
    documents: list[Document] = field(default_factory=list)


# ============================================
# HTTP
# ============================================

def fetch_html(url: str, retries: int, delay: float, timeout: int) -> str:
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
            if resp.status_code == 200:
                resp.encoding = resp.apparent_encoding or "utf-8"
                return resp.text
            print(f"  ⚠ HTTP {resp.status_code} on {url}", file=sys.stderr)
        except Exception as e:
            last_err = e
            print(f"  ⚠ {e} (attempt {attempt}/{retries})", file=sys.stderr)
        if attempt < retries:
            time.sleep(delay * attempt)
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def download_pdf(url: str, dest: Path, retries: int, delay: float, timeout: int) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout, stream=True, allow_redirects=True)
            if resp.status_code == 200:
                with open(dest, "wb") as f:
                    for chunk in resp.iter_content(8192):
                        f.write(chunk)
                return dest.stat().st_size > 0
            print(f"  ⚠ HTTP {resp.status_code} on {url}", file=sys.stderr)
        except Exception as e:
            last_err = e
        if attempt < retries:
            time.sleep(delay * attempt)
    print(f"  ✗ failed to download {url}: {last_err}", file=sys.stderr)
    return False


# ============================================
# 解析
# ============================================

def parse_home_jsp_id(href: str) -> Optional[int]:
    if "home.jsp" not in href:
        return None
    qs = parse_qs(urlparse(href).query)
    raw = (qs.get("id") or [None])[0]
    try:
        return int(raw) if raw is not None else None
    except ValueError:
        return None


def find_subcategories(html: str) -> list[Category]:
    """從入口頁抽出 23 大問答集子分類（以 QA_CATEGORY_IDS 白名單收斂）。

    入口頁包含整個 sfb.gov.tw / fsc.gov.tw 全站導覽列，連結內含上百個
    home.jsp?id=X — 包括聯絡我們、組織、新聞稿、政府資訊公開等與問答集
    完全無關的 sitemap 項目。直接全收會把不相關 PDF（例如施政計畫、
    預決算書、契約等）抽進 qa.json 並淹沒真正的問答集。

    URL 採直接構造（不靠 HTML href + urljoin），因為：
    1. 23 個分類 id 與 URL pattern 都是已知固定的：
       https://www.sfb.gov.tw/ch/home.jsp?id={id}&parentpath=0,6,858
    2. HTML 上同 id 可能出現在 sfb 與 fsc 兩個 domain 的導覽中，依
       href 組 URL 會誤抓到 fsc.gov.tw（例如 id=865 抓到 FSC 研究報告
       而非 SFB 問答集）。
    3. 部分 href 寫成 /home.jsp?... 省略 /ch/，urljoin 用 href 蓋掉 base
       path 後產生 https://www.sfb.gov.tw/home.jsp?... 必 404。

    Name 仍從 HTML 取（取較長者），輸出依 id 排序穩定。
    """
    soup = BeautifulSoup(html, "lxml")
    seen: dict[int, Category] = {}
    for a in soup.find_all("a", href=True):
        sid = parse_home_jsp_id(a["href"])
        if sid is None or sid not in QA_CATEGORY_IDS:
            continue
        name = a.get_text(strip=True)
        if not name or len(name) > 80:  # 太長可能是把整段文字抓進來
            continue
        url = f"{BASE}/ch/home.jsp?id={sid}&parentpath=0,6,858"
        existing = seen.get(sid)
        if existing is None:
            seen[sid] = Category(id=sid, name=name, url=url)
        else:
            # 已存在：若新名稱較長（含編號前綴等），用新名稱覆蓋
            if len(name) > len(existing.name):
                existing.name = name
            # URL 因 sid 相同必相同，無需更新
    return [seen[i] for i in sorted(seen)]


def _ensure_ch_prefix(href: str) -> str:
    """確保 sfb.gov.tw 的 root-relative href 帶 /ch/ 前綴。

    sfb.gov.tw 站台所有實際內容頁與下載連結都掛在 /ch/ 之下，但 HTML
    內 <a href> 偶爾會寫成 /home.jsp?... 或 /uploaddowndoc?...（從
    domain root 起算，省略 /ch/）。urlib.parse.urljoin 會用 href 完全
    覆蓋 base 的 path，導致 /ch/ 被吃掉，組出 404 連結
    （例如 https://www.sfb.gov.tw/home.jsp?id=863&parentpath=0,6,858）。
    對 root-relative 但又不是 /ch/ 開頭的 href，補上 /ch 前綴。
    """
    if href.startswith("/") and not href.startswith("//") and not href.startswith("/ch/"):
        return "/ch" + href
    return href


def parse_uploaddowndoc(href: str) -> tuple[Optional[str], Optional[str]]:
    if "uploaddowndoc" not in href and "fckdowndoc" not in href:
        return None, None
    qs = parse_qs(urlparse(href).query)
    file_path = (qs.get("file") or [None])[0]
    filename = (qs.get("filedisplay") or [None])[0]
    return file_path, filename


def infer_date(file_path: Optional[str]) -> Optional[str]:
    if not file_path:
        return None
    m = re.search(r"(\d{8})\d{6,}", file_path)
    if not m:
        return None
    yyyymmdd = m.group(1)
    try:
        y, mo, d = yyyymmdd[:4], yyyymmdd[4:6], yyyymmdd[6:8]
        if 1990 <= int(y) <= 2099 and 1 <= int(mo) <= 12 and 1 <= int(d) <= 31:
            return f"{y}-{mo}-{d}"
    except ValueError:
        pass
    return None


def parse_subcategory_documents(html: str, category_url: str) -> list[Document]:
    soup = BeautifulSoup(html, "lxml")
    docs: list[Document] = []
    seen_urls = set()
    for a in soup.find_all("a", href=True):
        href = _ensure_ch_prefix(a["href"])  # 補 /ch/ 前綴避免 urljoin 把它吃掉
        file_path, filename = parse_uploaddowndoc(href)
        if not file_path and not href.lower().endswith(".pdf"):
            continue
        full_url = urljoin(category_url, href)
        if full_url in seen_urls:
            continue
        seen_urls.add(full_url)

        title = a.get_text(strip=True)
        if not title and filename:
            title = unquote(filename)
        if not title:
            title = "(無標題)"

        docs.append(Document(
            title=title,
            publish_date=infer_date(file_path),
            source_url=full_url,
        ))
    return docs


# ============================================
# PDF 文字抽取（嚴格保留原文）
# ============================================

def extract_pdf_text(pdf_path: Path) -> tuple[str, int]:
    """回傳 (raw_text, page_count)。失敗回傳 ("", 0)。"""
    if not HAS_PDF:
        return "", 0
    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages = pdf.pages
            chunks = []
            for p in pages:
                text = p.extract_text() or ""
                chunks.append(text)
            return "\n".join(chunks), len(pages)
    except Exception as e:
        print(f"  ✗ PDF 抽取失敗 {pdf_path.name}: {e}", file=sys.stderr)
        return "", 0


def safe_basename(file_path: str) -> str:
    """從 chdownload/202306271657170.pdf 抽出 202306271657170.pdf。"""
    return Path(file_path).name


# ============================================
# 主流程
# ============================================

def fetch_subcategory(cat: Category, args) -> None:
    print(f"\n[{cat.id}] {cat.name}")
    try:
        html = fetch_html(cat.url, args.retries, args.delay, args.timeout)
    except Exception as e:
        print(f"  ✗ 抓子分類失敗：{e}", file=sys.stderr)
        return

    docs = parse_subcategory_documents(html, cat.url)
    print(f"  發現 {len(docs)} 份 PDF")

    for doc in docs:
        if args.dry_run:
            print(f"    · [dry-run] {doc.title} → {doc.source_url}")
            continue

        file_path, _ = parse_uploaddowndoc(doc.source_url)
        if file_path:
            local = PDF_DIR / str(cat.id) / safe_basename(file_path)
        else:
            # 直接 .pdf 連結
            local = PDF_DIR / str(cat.id) / Path(urlparse(doc.source_url).path).name

        if download_pdf(doc.source_url, local, args.retries, args.delay, args.timeout):
            doc.local_pdf = str(local.relative_to(OUT_DIR))
            if not args.skip_pdf_extract:
                doc.raw_text, doc.page_count = extract_pdf_text(local)
                print(f"    · {doc.title[:30]} ({doc.page_count} 頁)")
            else:
                print(f"    · {doc.title[:30]} (PDF only)")
        time.sleep(args.delay)

    cat.documents = docs


def fetch_tib_faq(args) -> Optional[Category]:
    """交易所創新板 FAQ（單一 PDF）。"""
    cat = Category(id=9999, name="創新板 FAQ（交易所）", url=TIB_FAQ_URL)
    print(f"\n[{cat.id}] {cat.name}")
    if args.dry_run:
        print(f"    · [dry-run] {TIB_FAQ_URL}")
        return cat

    local = PDF_DIR / "tib" / "tib_qa.pdf"
    if download_pdf(TIB_FAQ_URL, local, args.retries, args.delay, args.timeout):
        doc = Document(
            title="創新板常見問答",
            publish_date=datetime.utcnow().strftime("%Y-%m-%d"),  # 該 PDF 通常無日期，記抓取日
            source_url=TIB_FAQ_URL,
            local_pdf=str(local.relative_to(OUT_DIR)),
        )
        if not args.skip_pdf_extract:
            doc.raw_text, doc.page_count = extract_pdf_text(local)
            print(f"    · {doc.page_count} 頁")
        cat.documents = [doc]
    return cat


def to_json_payload(categories: list[Category]) -> dict:
    return {
        "fetched_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "source": INDEX_URL,
        "categories": [asdict(c) for c in categories],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", type=int, default=None, help="只抓特定分類 id")
    parser.add_argument("--skip-pdf-extract", action="store_true", help="只更新索引與下載 PDF，不抽文字")
    parser.add_argument("--skip-tib", action="store_true", help="不抓創新板 FAQ")
    parser.add_argument("--dry-run", action="store_true", help="不下載，只列要做的事")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()

    if not HAS_PDF and not args.skip_pdf_extract:
        print("⚠ pdfplumber 未安裝。請執行 pip install pdfplumber 或加 --skip-pdf-extract", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"抓入口頁：{INDEX_URL}")
    try:
        index_html = fetch_html(INDEX_URL, args.retries, args.delay, args.timeout)
    except Exception as e:
        print(f"✗ 入口頁失敗：{e}", file=sys.stderr)
        return 1

    cats = find_subcategories(index_html)
    print(f"發現 {len(cats)} 個子分類")
    if args.only:
        cats = [c for c in cats if c.id == args.only]
        if not cats:
            print(f"找不到 id={args.only} 的分類", file=sys.stderr)
            return 1

    for cat in cats:
        fetch_subcategory(cat, args)

    if not args.skip_tib and not args.only:
        tib = fetch_tib_faq(args)
        if tib:
            cats.append(tib)

    if not args.dry_run:
        QA_JSON.write_text(
            json.dumps(to_json_payload(cats), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        total_docs = sum(len(c.documents) for c in cats)
        print(f"\n✓ 寫出 {QA_JSON} ({len(cats)} 大類 / {total_docs} 份文件)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
