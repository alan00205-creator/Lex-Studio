#!/usr/bin/env python3
"""
validate_law_index.py — 驗證 data/law_index.json 中每筆法規的 URL。

對每部法規：
  1. fetch primary_url，確認 HTTP 200
  2. 從頁面抽出實際的法規名稱，與 JSON 中的 name 比對
  3. 若有 article_url_template，用第一個 common_articles[].no 套入測試深層連結

並非每個來源都有穩定的「法規名稱」HTML 結構，這支腳本針對：
  - law.moj.gov.tw（全國法規資料庫）：解析 <title> 與 #hlLawName / #pt0
  - twse-regulation.twse.com.tw（證交所）：解析 <title>
  - selaw.com.tw：解析 <title>
  - 其他來源：僅檢查 HTTP 狀態

Usage:
    python3 scripts/validate_law_index.py
    python3 scripts/validate_law_index.py --json data/law_index.json --timeout 15
    python3 scripts/validate_law_index.py --only A01,A04   # 只驗證指定 id
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.stderr.write(
        "缺少相依套件。請先執行：pip install -r scripts/requirements.txt\n"
    )
    sys.exit(1)


# 偽裝為一般瀏覽器，避免被法規網站的 bot 防護擋掉
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}


@dataclass
class CheckResult:
    law_id: str
    url: str
    status: str             # "ok" | "name_mismatch" | "http_error" | "fetch_error" | "skipped"
    http_code: Optional[int] = None
    extracted_name: Optional[str] = None
    expected_name: str = ""
    notes: list[str] = field(default_factory=list)


def fetch(url: str, timeout: int) -> tuple[int, str]:
    """回傳 (HTTP status, HTML body)。網路層失敗則 raise。"""
    resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
    return resp.status_code, resp.text


def extract_law_name(html: str, url: str) -> Optional[str]:
    """依 host 用不同策略抽出法規名稱。"""
    soup = BeautifulSoup(html, "lxml")
    host = urlparse(url).netloc.lower()

    if "law.moj.gov.tw" in host:
        # 全國法規資料庫：頁面標題格式類似 "證券交易法-全國法規資料庫"
        title = soup.title.string if soup.title and soup.title.string else ""
        if "-" in title:
            return title.split("-")[0].strip()
        # 備援：嘗試 #hlLawName（舊版頁面）或顯眼的 h2
        elem = soup.select_one("#hlLawName, h2, .law-name")
        if elem:
            return elem.get_text(strip=True)

    elif "twse-regulation.twse.com.tw" in host:
        # 證交所：<title> 包含法規名稱
        title = soup.title.string if soup.title and soup.title.string else ""
        return title.strip() or None

    elif "selaw.com.tw" in host:
        title = soup.title.string if soup.title and soup.title.string else ""
        return title.strip() or None

    # 其他：用 <title> 盡力而為
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    return None


def names_match(expected: str, extracted: Optional[str]) -> bool:
    if not extracted:
        return False
    a = expected.replace(" ", "")
    b = extracted.replace(" ", "")
    return a in b or b in a


def check_law(law: dict, timeout: int) -> list[CheckResult]:
    """對一部法規回傳 1~2 個檢查結果（primary + 第一條深層連結）。"""
    results: list[CheckResult] = []
    law_id = law.get("id", "?")
    name = law.get("name", "")

    # --- primary_url ---
    primary = law.get("primary_url")
    if primary:
        try:
            code, body = fetch(primary, timeout)
            extracted = extract_law_name(body, primary) if code == 200 else None
            if code != 200:
                results.append(CheckResult(
                    law_id, primary, "http_error",
                    http_code=code, expected_name=name,
                ))
            elif names_match(name, extracted):
                results.append(CheckResult(
                    law_id, primary, "ok",
                    http_code=code, extracted_name=extracted, expected_name=name,
                ))
            else:
                results.append(CheckResult(
                    law_id, primary, "name_mismatch",
                    http_code=code, extracted_name=extracted, expected_name=name,
                ))
        except Exception as e:
            results.append(CheckResult(
                law_id, primary, "fetch_error",
                expected_name=name, notes=[str(e)],
            ))
    else:
        results.append(CheckResult(
            law_id, "", "skipped", expected_name=name,
            notes=["缺少 primary_url"],
        ))

    # --- article_url_template（用第一個常用條文測試）---
    template = law.get("article_url_template")
    common = law.get("common_articles") or []
    if template and common:
        first_no = common[0].get("no")
        if first_no:
            article_url = template.replace("{article_no}", str(first_no))
            try:
                code, _body = fetch(article_url, timeout)
                results.append(CheckResult(
                    law_id, article_url,
                    "ok" if code == 200 else "http_error",
                    http_code=code, expected_name=name,
                    notes=[f"deep-link 測試（第 {first_no} 條）"],
                ))
            except Exception as e:
                results.append(CheckResult(
                    law_id, article_url, "fetch_error",
                    expected_name=name,
                    notes=[f"deep-link 測試（第 {first_no} 條）", str(e)],
                ))

    return results


def format_result(r: CheckResult) -> str:
    icon = {
        "ok": "✓",
        "name_mismatch": "⚠",
        "http_error": "✗",
        "fetch_error": "✗",
        "skipped": "·",
    }.get(r.status, "?")

    line = f"  {icon} [{r.law_id}] {r.status}"
    if r.http_code is not None:
        line += f" (HTTP {r.http_code})"
    if r.notes:
        line += "  // " + " | ".join(r.notes)
    if r.status == "name_mismatch":
        line += f"\n      預期：{r.expected_name}"
        line += f"\n      實際：{r.extracted_name}"
    if r.url:
        line += f"\n      {r.url}"
    return line


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", default="data/law_index.json", type=Path)
    parser.add_argument("--timeout", default=15, type=int, help="單筆 HTTP 逾時秒數")
    parser.add_argument("--delay", default=0.5, type=float, help="兩筆之間休息秒數，避免被擋")
    parser.add_argument("--only", default="", help="僅驗證指定 id（逗號分隔，例：A01,A04）")
    args = parser.parse_args()

    if not args.json.exists():
        print(f"找不到 {args.json}", file=sys.stderr)
        return 2

    data = json.loads(args.json.read_text(encoding="utf-8"))
    laws = data.get("laws", [])
    if args.only:
        wanted = {x.strip() for x in args.only.split(",") if x.strip()}
        laws = [l for l in laws if l.get("id") in wanted]

    print(f"驗證 {len(laws)} 部法規（timeout={args.timeout}s, delay={args.delay}s）")
    print("=" * 60)

    all_results: list[CheckResult] = []
    for i, law in enumerate(laws, 1):
        print(f"\n[{i}/{len(laws)}] {law.get('id')} {law.get('name')}")
        results = check_law(law, args.timeout)
        for r in results:
            print(format_result(r))
            all_results.append(r)
        if i < len(laws):
            time.sleep(args.delay)

    # --- 摘要 ---
    print("\n" + "=" * 60)
    counts = {"ok": 0, "name_mismatch": 0, "http_error": 0, "fetch_error": 0, "skipped": 0}
    for r in all_results:
        counts[r.status] = counts.get(r.status, 0) + 1
    print(
        f"摘要：{counts['ok']} OK / "
        f"{counts['name_mismatch']} 名稱不符 / "
        f"{counts['http_error']} HTTP 錯誤 / "
        f"{counts['fetch_error']} 連線失敗 / "
        f"{counts['skipped']} 略過"
    )

    return 0 if (counts["http_error"] + counts["fetch_error"]) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
