"""scripts/tests/test_fetch_qa.py — 單元測試。

執行：
    pip install -r scripts/requirements.txt
    python3 -m unittest scripts.tests.test_fetch_qa
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import fetch_qa  # noqa: E402


# 模擬入口頁：包含
#   1) 23 個正版問答集分類，故意混用 /ch/home.jsp、/home.jsp（缺 /ch/）、
#      與絕對 URL，驗證最終構出的 URL 一律帶 /ch/ 前綴
#   2) 100+ 個全站 sitemap 雜訊連結
#   3) id=865 同時出現在 sfb 與 fsc 兩個 domain 的 nav（驗證不再被 fsc 蓋掉）
#   4) 重複出現的 id（dedup + 較長名稱）
#   5) id=858 自身與非 home.jsp 連結
def _build_fake_index_html() -> str:
    qa_anchors = []
    titles = {
        862: "1.公司治理",
        863: "2.公開發行公司募集發行",
        864: "3.公開發行公司財務業務管理",
        865: "4.股權股務",
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
        1062: "22.證券商、期貨商及證券投資信託事業證券投資顧問事業作業委託他人處理應注意事項",
        1073: "23.金融業申請進駐地方資產管理專區試辦業務作業原則問答集",
    }
    # 故意三種 href 寫法輪替：/ch/home.jsp、/home.jsp（缺 /ch/）、絕對 URL
    for i, (cid, name) in enumerate(titles.items()):
        if i % 3 == 0:
            href = f"/ch/home.jsp?id={cid}&parentpath=0,6,858"
        elif i % 3 == 1:
            href = f"/home.jsp?id={cid}&parentpath=0,6,858"
        else:
            href = f"https://www.sfb.gov.tw/ch/home.jsp?id={cid}&parentpath=0,6,858"
        qa_anchors.append(f'<a href="{href}">{name}</a>')

    # 第二次出現某些 id（短名稱）— dedup + 取較長
    qa_anchors.append('<a href="/ch/home.jsp?id=862&parentpath=0,6,858">公司治理</a>')
    qa_anchors.append('<a href="/home.jsp?id=863&parentpath=0,6,858">募集發行</a>')

    # id=865 同時出現在 fsc 的 nav（驗證直接構造 URL 不會被 fsc 污染）
    qa_anchors.append(
        '<a href="https://www.fsc.gov.tw/ch/home.jsp?id=865&parentpath=0,7">FSC 研究報告</a>'
    )

    # 雜訊：sfb 與 fsc 全站 sitemap，全部應被過濾掉
    noise_ids = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 24, 25, 38, 39, 41, 43, 49, 52, 56,
        81, 88, 89, 95, 96, 100, 101, 102, 109, 125, 127, 133, 134, 138,
        161, 163, 210, 350, 365, 446, 583, 598, 613, 643, 731, 740, 769, 775,
        786, 809, 835, 836, 837, 838, 839, 840, 844,
        860, 861, 881, 882, 894, 901, 923, 929, 935, 942, 951, 953, 958, 988,
        993, 997, 1002, 1015, 1016, 1017, 1029, 1041, 1045, 1051, 1053, 1055,
        1078, 1079, 1081,
    ]
    noise_anchors = [
        f'<a href="/ch/home.jsp?id={n}&parentpath=0,X">noise-{n}</a>'
        for n in noise_ids
    ]

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
        self.by_id = {c.id: c for c in self.cats}

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
        for noisy in (1, 2, 38, 95, 161, 858, 860, 861, 1051, 1079):
            self.assertNotIn(noisy, self.ids, f"雜訊 id={noisy} 未被過濾")

    def test_prefers_longer_name_when_dedup(self):
        self.assertEqual(self.by_id[862].name, "1.公司治理")
        self.assertEqual(self.by_id[863].name, "2.公開發行公司募集發行")

    def test_output_sorted_by_id(self):
        self.assertEqual(self.ids, sorted(self.ids), "輸出應依 id 由小到大排序")

    def test_every_url_includes_ch_prefix(self):
        """所有 URL 必須包含 /ch/home.jsp 路徑（這次的根因 bug）。"""
        bad = [(c.id, c.url) for c in self.cats if "/ch/home.jsp" not in c.url]
        self.assertEqual(bad, [], f"以下 URL 缺 /ch/ 前綴：{bad}")

    def test_every_url_is_canonical_sfb_form(self):
        """URL 必須完全等於 https://www.sfb.gov.tw/ch/home.jsp?id={id}&parentpath=0,6,858"""
        for c in self.cats:
            expected = f"https://www.sfb.gov.tw/ch/home.jsp?id={c.id}&parentpath=0,6,858"
            self.assertEqual(c.url, expected, f"id={c.id} URL 不正確")

    def test_id_865_url_not_polluted_by_fsc(self):
        """id=865 即使 HTML 同時有 fsc.gov.tw 的 nav，URL 仍應指向 sfb.gov.tw。"""
        c = self.by_id[865]
        self.assertIn("sfb.gov.tw", c.url)
        self.assertNotIn("fsc.gov.tw", c.url)

    def test_url_unaffected_by_href_missing_ch(self):
        """即使 HTML href 寫成 /home.jsp（缺 /ch/），仍應構出含 /ch/ 的 URL。"""
        # 由 _build_fake_index_html 的 i%3==1 分支知，至少有 7~8 個 id 用了
        # /home.jsp（缺 /ch/）寫法。這些 id 的 URL 仍須帶 /ch/。
        for c in self.cats:
            self.assertTrue(
                c.url.startswith("https://www.sfb.gov.tw/ch/home.jsp?"),
                f"id={c.id} URL pattern 錯誤: {c.url}"
            )


class TestEnsureChPrefix(unittest.TestCase):
    """_ensure_ch_prefix 用在 parse_subcategory_documents 的 PDF 連結補 /ch/ 上。"""

    def test_root_relative_without_ch_gets_prefix(self):
        self.assertEqual(
            fetch_qa._ensure_ch_prefix("/uploaddowndoc?file=x"),
            "/ch/uploaddowndoc?file=x",
        )
        self.assertEqual(
            fetch_qa._ensure_ch_prefix("/home.jsp?id=862"),
            "/ch/home.jsp?id=862",
        )

    def test_already_has_ch_prefix_unchanged(self):
        self.assertEqual(
            fetch_qa._ensure_ch_prefix("/ch/uploaddowndoc?file=x"),
            "/ch/uploaddowndoc?file=x",
        )

    def test_absolute_url_unchanged(self):
        self.assertEqual(
            fetch_qa._ensure_ch_prefix("https://www.sfb.gov.tw/ch/home.jsp?id=1"),
            "https://www.sfb.gov.tw/ch/home.jsp?id=1",
        )
        self.assertEqual(
            fetch_qa._ensure_ch_prefix("https://example.com/foo"),
            "https://example.com/foo",
        )

    def test_protocol_relative_unchanged(self):
        self.assertEqual(
            fetch_qa._ensure_ch_prefix("//cdn.example.com/x"),
            "//cdn.example.com/x",
        )

    def test_relative_no_leading_slash_unchanged(self):
        self.assertEqual(
            fetch_qa._ensure_ch_prefix("uploaddowndoc?file=x"),
            "uploaddowndoc?file=x",
        )


class TestParseHomeJspId(unittest.TestCase):
    def test_extracts_id(self):
        self.assertEqual(fetch_qa.parse_home_jsp_id("/ch/home.jsp?id=862"), 862)
        self.assertEqual(
            fetch_qa.parse_home_jsp_id(
                "https://www.sfb.gov.tw/ch/home.jsp?id=1073&parentpath=0,6,858"
            ),
            1073,
        )

    def test_handles_missing_ch_prefix(self):
        # /home.jsp（缺 /ch/）也得能抽到 id，否則 find_subcategories 會漏
        self.assertEqual(fetch_qa.parse_home_jsp_id("/home.jsp?id=863"), 863)

    def test_ignores_non_home_jsp(self):
        self.assertIsNone(fetch_qa.parse_home_jsp_id("/ch/other.jsp?id=862"))
        self.assertIsNone(fetch_qa.parse_home_jsp_id("https://example.com/?id=862"))


if __name__ == "__main__":
    unittest.main()


# ============================================
# A+B+D 修正：SESSION + Referer + magic-byte
# ============================================

import io
import tempfile
from unittest.mock import MagicMock, patch


def _fake_response(status: int = 200, body: bytes = b"%PDF-1.4\nfoo\n", content_type: str = "application/pdf"):
    """模擬 requests Response 物件，支援 stream=True 的 iter_content。"""
    r = MagicMock()
    r.status_code = status
    r.headers = {"Content-Type": content_type}
    r.iter_content = lambda chunk_size=8192: iter([body[i:i + chunk_size] for i in range(0, len(body), chunk_size)])
    return r


class TestDownloadPdfReferer(unittest.TestCase):
    """A+B 主測試：每次 PDF 下載都該帶 Referer 並走共用 SESSION。"""

    def test_passes_referer_header_via_session(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.pdf"
            with patch.object(fetch_qa.SESSION, "get") as mock_get:
                mock_get.return_value = _fake_response()
                ok, err = fetch_qa.download_pdf(
                    "https://www.sfb.gov.tw/ch/uploaddowndoc?file=chdownload/x.pdf",
                    dest,
                    referer="https://www.sfb.gov.tw/ch/home.jsp?id=863&parentpath=0,6,858",
                    retries=2, delay=0, timeout=10,
                )
            self.assertTrue(ok, f"應下載成功；err={err}")
            self.assertIsNone(err)
            self.assertTrue(dest.exists() and dest.stat().st_size > 0)
            # 驗證 SESSION.get 被呼叫且 headers 帶 Referer
            mock_get.assert_called_once()
            kwargs = mock_get.call_args.kwargs
            self.assertEqual(
                kwargs.get("headers", {}).get("Referer"),
                "https://www.sfb.gov.tw/ch/home.jsp?id=863&parentpath=0,6,858",
            )


class TestDownloadPdfMagicByteValidation(unittest.TestCase):
    """D 主測試：magic-byte 驗證；非 PDF 內容須刪檔 + 回 error。"""

    def test_non_pdf_response_is_rejected_and_file_deleted(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.pdf"
            html_body = b"<html><body>Forbidden</body></html>"
            with patch.object(fetch_qa.SESSION, "get") as mock_get:
                mock_get.return_value = _fake_response(body=html_body, content_type="text/html")
                ok, err = fetch_qa.download_pdf(
                    "https://www.sfb.gov.tw/ch/uploaddowndoc?file=x",
                    dest,
                    referer="https://www.sfb.gov.tw/ch/home.jsp?id=863",
                    retries=1, delay=0, timeout=10,
                )
            self.assertFalse(ok, "非 PDF 內容應回 ok=False")
            self.assertEqual(err, "non-PDF response")
            self.assertFalse(dest.exists(), "破檔應該被刪掉")

    def test_valid_pdf_saved_and_returns_true(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.pdf"
            pdf_body = b"%PDF-1.7\n%%EOF\n"
            with patch.object(fetch_qa.SESSION, "get") as mock_get:
                mock_get.return_value = _fake_response(body=pdf_body)
                ok, err = fetch_qa.download_pdf(
                    "https://www.sfb.gov.tw/ch/uploaddowndoc?file=x",
                    dest,
                    referer="https://www.sfb.gov.tw/ch/home.jsp?id=863",
                    retries=1, delay=0, timeout=10,
                )
            self.assertTrue(ok)
            self.assertIsNone(err)
            self.assertEqual(dest.read_bytes(), pdf_body)

    def test_http_error_status_returns_error_message(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.pdf"
            with patch.object(fetch_qa.SESSION, "get") as mock_get:
                mock_get.return_value = _fake_response(status=404, body=b"Not Found")
                ok, err = fetch_qa.download_pdf(
                    "https://www.sfb.gov.tw/ch/uploaddowndoc?file=x",
                    dest,
                    referer="https://www.sfb.gov.tw/ch/home.jsp?id=863",
                    retries=1, delay=0, timeout=10,
                )
            self.assertFalse(ok)
            self.assertEqual(err, "HTTP 404")
            self.assertFalse(dest.exists())


class TestDownloadPdfCacheBehaviour(unittest.TestCase):
    """cache：合法 PDF 跳過下載；破檔自動清除重抓。"""

    def test_existing_valid_pdf_is_cache_hit_no_network(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.pdf"
            dest.write_bytes(b"%PDF-1.4\n cached \n")
            with patch.object(fetch_qa.SESSION, "get") as mock_get:
                ok, err = fetch_qa.download_pdf(
                    "https://www.sfb.gov.tw/ch/uploaddowndoc?file=x",
                    dest,
                    referer="https://www.sfb.gov.tw/ch/home.jsp?id=863",
                    retries=1, delay=0, timeout=10,
                )
            self.assertTrue(ok)
            self.assertIsNone(err)
            mock_get.assert_not_called()  # cache hit，網路不該被打

    def test_existing_non_pdf_is_purged_and_refetched(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.pdf"
            # 上一輪寫進去的 HTML 錯誤頁，extension 偽裝成 .pdf
            dest.write_bytes(b"<html>oops</html>")
            with patch.object(fetch_qa.SESSION, "get") as mock_get:
                mock_get.return_value = _fake_response(body=b"%PDF-1.4\n new \n")
                ok, err = fetch_qa.download_pdf(
                    "https://www.sfb.gov.tw/ch/uploaddowndoc?file=x",
                    dest,
                    referer="https://www.sfb.gov.tw/ch/home.jsp?id=863",
                    retries=1, delay=0, timeout=10,
                )
            self.assertTrue(ok, f"破 cache 應該被清掉並重抓；err={err}")
            self.assertEqual(dest.read_bytes(), b"%PDF-1.4\n new \n")
            mock_get.assert_called_once()

    def test_retries_until_success(self):
        """第一次 200 但內容是 HTML，第二次 200 + PDF — 應重試成功。"""
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.pdf"
            with patch.object(fetch_qa.SESSION, "get") as mock_get:
                mock_get.side_effect = [
                    _fake_response(body=b"<html>err</html>", content_type="text/html"),
                    _fake_response(body=b"%PDF-1.4\n ok \n"),
                ]
                ok, err = fetch_qa.download_pdf(
                    "https://www.sfb.gov.tw/ch/uploaddowndoc?file=x",
                    dest,
                    referer="https://www.sfb.gov.tw/ch/home.jsp?id=863",
                    retries=2, delay=0, timeout=10,
                )
            self.assertTrue(ok)
            self.assertIsNone(err)
            self.assertEqual(mock_get.call_count, 2)


class TestWarmUpSession(unittest.TestCase):
    def test_calls_index_url(self):
        with patch.object(fetch_qa.SESSION, "get") as mock_get:
            fetch_qa.warm_up_session(timeout=5)
        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        self.assertEqual(args[0], fetch_qa.INDEX_URL)

    def test_swallows_exception(self):
        # 入口頁掛掉時 warm_up 仍應 silent return（不 raise）
        with patch.object(fetch_qa.SESSION, "get", side_effect=Exception("boom")):
            try:
                fetch_qa.warm_up_session(timeout=5)
            except Exception as e:
                self.fail(f"warm_up_session 應該吞掉例外，但 raise: {e}")


class TestIsPdfFile(unittest.TestCase):
    def test_pdf_magic_recognized(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.pdf"
            p.write_bytes(b"%PDF-1.4\nrest")
            self.assertTrue(fetch_qa._is_pdf_file(p))

    def test_html_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.pdf"
            p.write_bytes(b"<html><body>err</body></html>")
            self.assertFalse(fetch_qa._is_pdf_file(p))

    def test_empty_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.pdf"
            p.write_bytes(b"")
            self.assertFalse(fetch_qa._is_pdf_file(p))

    def test_missing_file_rejected(self):
        self.assertFalse(fetch_qa._is_pdf_file(Path("/nonexistent/x.pdf")))


class TestDocumentSchema(unittest.TestCase):
    def test_error_field_default_none(self):
        d = fetch_qa.Document(title="t", publish_date=None, source_url="u")
        self.assertIsNone(d.error)

    def test_error_field_serializable(self):
        from dataclasses import asdict
        d = fetch_qa.Document(title="t", publish_date=None, source_url="u", error="non-PDF response")
        self.assertEqual(asdict(d)["error"], "non-PDF response")
