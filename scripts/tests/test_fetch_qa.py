"""scripts/tests/test_fetch_qa.py — 單元測試。

執行：
    pip install -r scripts/requirements.txt
    python3 -m unittest scripts.tests.test_fetch_qa

主要驗證 find_subcategories 的白名單過濾邏輯：入口頁包含整個全站導覽
時，輸出應只剩 23 個真正的問答集子分類。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# 讓 scripts/ 在 sys.path 上，方便 import fetch_qa
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import fetch_qa  # noqa: E402


# 模擬入口頁：包含
#   1) 23 個正版問答集分類（id ∈ QA_CATEGORY_IDS）
#   2) 100+ 個全站 sitemap 雜訊連結（聯絡我們、新聞稿、組織、預決算書……）
#   3) 重複出現的 id（測試 dedup + 取較長名稱）
#   4) id=858 自身（不應出現在輸出）
#   5) 不是 home.jsp 的連結（應被忽略）
def _build_fake_index_html() -> str:
    qa_anchors = []
    titles = {
        862: "1.公司治理",
        863: "2.公開發行公司募集發行",
        864: "3.公開發行公司財務業務管理",
        865: "4.公開發行公司資訊揭露",
        866: "5.公開收購",
        867: "6.庫藏股",
        868: "7.內線交易",
        869: "8.公開發行公司財務報告及財務預測",
        870: "9.公開發行公司內部控制制度",
        871: "10.公開發行公司會計主管",
        872: "11.華僑及外國人投資登記問答集",
        873: "12.外資投資問答集",
        874: "13.證券商特定業務",
        875: "14.證券商業務問答集",
        876: "15.證券投資信託事業申請(報)證券投資信託基金問答集",
        877: "16.鼓勵投信躍進計畫問答集",
        878: "17.證券投資信託基金、證券投資顧問及全權委託業務",
        879: "18.證券期貨事業投資抵減",
        880: "20.期貨信託及顧問業務",
        1033: "21.有關證券期貨業辦理金融機構間資料共享業務問答集",
        1061: "19.證券投資信託及顧問法第70條之1問答集",
        1062: "22.證券商、期貨商及證券投資信託事業證券投資顧問事業作業委託他人處理應注意事項問答集",
        1073: "23.金融業申請進駐地方資產管理專區試辦業務作業原則問答集",
    }
    for cid, name in titles.items():
        qa_anchors.append(
            f'<a href="/ch/home.jsp?id={cid}&parentpath=0,6,858">{name}</a>'
        )
    # 第二次出現某些 id（短名稱），驗證 dedup + 取較長
    qa_anchors.append('<a href="/ch/home.jsp?id=862&parentpath=0,6,858">公司治理</a>')
    qa_anchors.append('<a href="/ch/home.jsp?id=863&parentpath=0,6,858">募集發行</a>')

    # 雜訊：sfb 與 fsc 全站 sitemap，應全部被過濾掉
    noise_ids = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 24, 25, 38, 39, 41, 43, 49, 52, 56,
        81, 88, 89, 95, 96, 100, 101, 102, 109, 125, 127, 133, 134, 138,
        161, 163, 210, 350, 365, 446, 583, 598, 613, 643, 731, 740, 769, 775,
        786, 809, 835, 836, 837, 838, 839, 840, 844,
        # 故意：860 與 861 — 緊鄰白名單但不在白名單內，應被擋掉
        860, 861, 881, 882, 894, 901, 923, 929, 935, 942, 951, 953, 958, 988,
        993, 997, 1002, 1015, 1016, 1017, 1029, 1041, 1045, 1051, 1053, 1055,
        1078, 1079, 1081,
    ]
    noise_anchors = [
        f'<a href="/ch/home.jsp?id={n}&parentpath=0,X">noise-{n}</a>'
        for n in noise_ids
    ]

    # 再加 id=858（入口頁自己）；以及非 home.jsp 連結
    other_anchors = [
        '<a href="/ch/home.jsp?id=858&parentpath=0,6">問答集首頁</a>',
        '<a href="https://www.fsc.gov.tw">FSC 首頁</a>',
        '<a href="/ch/somewhere/else.jsp?foo=bar">其他頁面</a>',
        '<a href="/ch/uploaddowndoc?file=chdownload/x.pdf&filedisplay=x.pdf">下載 PDF</a>',
    ]

    body = "\n".join(qa_anchors + noise_anchors + other_anchors)
    return f"<html><body>{body}</body></html>"


class TestFindSubcategoriesWhitelist(unittest.TestCase):
    def setUp(self):
        self.html = _build_fake_index_html()
        self.cats = fetch_qa.find_subcategories(self.html)
        self.ids = [c.id for c in self.cats]

    def test_returns_exactly_23_categories(self):
        self.assertEqual(
            len(self.cats), 23,
            f"預期 23 個分類，實際 {len(self.cats)}：{self.ids}"
        )

    def test_only_whitelisted_ids(self):
        unexpected = [i for i in self.ids if i not in fetch_qa.QA_CATEGORY_IDS]
        self.assertEqual(unexpected, [], f"出現非白名單 id: {unexpected}")

    def test_all_whitelisted_ids_present(self):
        missing = sorted(fetch_qa.QA_CATEGORY_IDS - set(self.ids))
        self.assertEqual(missing, [], f"白名單漏抓: {missing}")

    def test_sitemap_noise_filtered(self):
        # 抽幾個典型雜訊 id 確認沒漏網
        for noisy in (1, 2, 38, 95, 161, 858, 860, 861, 1051, 1079):
            self.assertNotIn(noisy, self.ids, f"雜訊 id={noisy} 未被過濾")

    def test_prefers_longer_name_when_dedup(self):
        # 862 出現兩次：「1.公司治理」(7 字) vs「公司治理」(4 字)
        cat_862 = next(c for c in self.cats if c.id == 862)
        self.assertEqual(cat_862.name, "1.公司治理")
        cat_863 = next(c for c in self.cats if c.id == 863)
        self.assertEqual(cat_863.name, "2.公開發行公司募集發行")

    def test_output_sorted_by_id(self):
        self.assertEqual(self.ids, sorted(self.ids), "輸出應依 id 由小到大排序")

    def test_url_resolved_to_absolute(self):
        for c in self.cats:
            self.assertTrue(
                c.url.startswith("https://www.sfb.gov.tw/"),
                f"id={c.id} url 未轉成絕對：{c.url}"
            )


class TestParseHomeJspId(unittest.TestCase):
    def test_extracts_id(self):
        self.assertEqual(fetch_qa.parse_home_jsp_id("/ch/home.jsp?id=862"), 862)
        self.assertEqual(
            fetch_qa.parse_home_jsp_id("https://www.sfb.gov.tw/ch/home.jsp?id=1073&parentpath=0,6,858"),
            1073,
        )

    def test_ignores_non_home_jsp(self):
        self.assertIsNone(fetch_qa.parse_home_jsp_id("/ch/other.jsp?id=862"))
        self.assertIsNone(fetch_qa.parse_home_jsp_id("https://example.com/?id=862"))


if __name__ == "__main__":
    unittest.main()
