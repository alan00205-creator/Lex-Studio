#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_exam_archive.py — 證券商高級業務員歷屆考古題 PDF → JSON pipeline

只收錄「有對應 a.pdf 答案卡」的試卷。
109 Q3+ 之後格式：1 個 XXYY.pdf 含 3 科 (投資學/財務分析/法規)；1 個 XXYYa.pdf 含 3 科答案。
若答案為 multi-letter（送分），letter 設為 "*"。

Usage:
    python3 scripts/extract_exam_archive.py \
        --archive /tmp/exam-archive/高業考古題 \
        --out data/exam_archive
"""
import argparse, json, re, subprocess
from pathlib import Path
import pdfplumber

SUBJECTS = [
    {"key": "investment", "label": "投資學",
     "header_re": re.compile(r"專業科目：證券投資與財務分析.{0,4}試卷「投資學」"),
     "answer_section_re": re.compile(r"試卷「投資學」試題解答")},
    {"key": "finance", "label": "財務分析",
     "header_re": re.compile(r"專業科目：證券投資與財務分析.{0,4}試卷「財務分析」"),
     "answer_section_re": re.compile(r"試卷「財務分析」試題解答")},
    {"key": "law", "label": "法規",
     "header_re": re.compile(r"專業科目：證券交易相關法規與實務"),
     "answer_section_re": re.compile(r"證券交易相關法規與實務試題解答")},
]
SUBJECT_BY_KEY = {s["key"]: s for s in SUBJECTS}

NEW_FORMAT_RE = re.compile(r"^(\d{3})(0[1-4])\.pdf$")
QUARTER_LABEL = {"01": "Q1", "02": "Q2", "03": "Q3", "04": "Q4"}


def discover_papers(archive_dir):
    pairs = []
    for year_dir in sorted(archive_dir.iterdir()):
        if not year_dir.is_dir():
            continue
        for f in sorted(year_dir.iterdir()):
            m = NEW_FORMAT_RE.match(f.name)
            if not m:
                continue
            ans = year_dir / f"{m.group(1)}{m.group(2)}a.pdf"
            if not ans.exists():
                continue
            pairs.append({
                "year": int(m.group(1)),
                "quarter": QUARTER_LABEL[m.group(2)],
                "questions_pdf": f,
                "answers_pdf": ans,
            })
    return pairs


def extract_pages(pdf_path):
    pages = []
    with pdfplumber.open(pdf_path) as p:
        for page in p.pages:
            pages.append(page.extract_text() or "")
    return pages


def split_subjects_by_page(pages):
    starts = {}
    for i, txt in enumerate(pages):
        for s in SUBJECTS:
            if s["header_re"].search(txt) and s["key"] not in starts:
                starts[s["key"]] = i
    if not starts:
        return {}
    ordered = sorted(starts.items(), key=lambda x: x[1])
    sections = {}
    for idx, (key, start) in enumerate(ordered):
        end = ordered[idx + 1][1] if idx + 1 < len(ordered) else len(pages)
        sections[key] = "\n".join(pages[start:end])
    return sections


QUESTION_START_RE = re.compile(r"(?m)^\s*(\d{1,2})\.(?:\s|(?=\D))")
OPTION_SPLIT_RE = re.compile(r"\(([ABCD])\$?\)\s*")
BOILERPLATE_PATTERNS = [
    re.compile(r"^\s*\d{3}\s*年第\s*\d+\s*次證券商高級業務員資格測驗試題.*$", re.M),
    re.compile(r"^\s*專業科目：.*$", re.M),
    re.compile(r"^\s*請填.{1,5}號碼[:：].*$", re.M),
    re.compile(r"^\s*※\s*注意：.*$", re.M),
    re.compile(r"^\s*為單一選擇題.*$", re.M),
    re.compile(r"^\s*單一選擇題.*$", re.M),
]


def clean_section_text(text):
    for pat in BOILERPLATE_PATTERNS:
        text = pat.sub("", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text


def parse_questions(section_text):
    text = clean_section_text(section_text)
    matches = list(QUESTION_START_RE.finditer(text))
    if not matches:
        return []
    questions = []
    for i, m in enumerate(matches):
        num = int(m.group(1))
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end].strip()
        opt_matches = list(OPTION_SPLIT_RE.finditer(body))
        if len(opt_matches) < 4:
            continue
        stem_text = body[:opt_matches[0].start()].strip()
        options = {}
        for j, om in enumerate(opt_matches[:4]):
            letter = om.group(1)
            seg_start = om.end()
            seg_end = opt_matches[j + 1].start() if j + 1 < len(opt_matches) else len(body)
            seg = body[seg_start:seg_end].strip()
            seg = re.sub(r"\s+", " ", seg)
            options[letter] = seg
        stem = re.sub(r"\s+", " ", stem_text).strip()
        if not (1 <= num <= 60):
            continue
        questions.append({"number": num, "stem": stem, "options": options})

    seen = set()
    unique = []
    for q in questions:
        if q["number"] in seen:
            continue
        seen.add(q["number"])
        unique.append(q)
    return unique


# 答案卡 -layout 模式 parser
# 表格每行：<num> <letter> ... 5 對；letter 可為 [ABCD] 或 A.B.C.D（送分）
ANSWER_PAIR_RE = re.compile(r"(\d{1,2})\s+(A\.B\.C\.D|[ABCD])")


def parse_answer_key(answer_pdf):
    result = subprocess.run(
        ["pdftotext", "-layout", str(answer_pdf), "-"],
        capture_output=True, text=True, check=True
    )
    text = result.stdout

    starts = {}
    for s in SUBJECTS:
        m = s["answer_section_re"].search(text)
        if m:
            starts[s["key"]] = m.start()
    if len(starts) < 3:
        return {}
    ordered = sorted(starts.items(), key=lambda x: x[1])
    answers = {}
    for idx, (key, start) in enumerate(ordered):
        end = ordered[idx + 1][1] if idx + 1 < len(ordered) else len(text)
        section = text[start:end]
        seen = {}
        for m in ANSWER_PAIR_RE.finditer(section):
            num = int(m.group(1))
            if 1 <= num <= 50 and num not in seen:
                v = m.group(2)
                seen[num] = "*" if "." in v else v
        if len(seen) != 50:
            return {}
        letters = [seen[n] for n in range(1, 51)]
        answers[key] = letters
    return answers


def build_paper_json(pair, sections, answers, subject_key):
    subj = SUBJECT_BY_KEY[subject_key]
    qs = parse_questions(sections.get(subject_key, ""))
    ans_letters = answers.get(subject_key, [])

    if len(qs) != 50 or len(ans_letters) != 50:
        return None, f"sanity-fail: {len(qs)}q / {len(ans_letters)}a"

    out_questions = []
    for q in qs:
        idx = q["number"] - 1
        letter = ans_letters[idx]
        if letter != "*" and letter not in q["options"]:
            return None, f"answer-letter-missing Q{q['number']} ans={letter}"
        out_questions.append({
            "id": f"E{pair['year']}{pair['quarter']}-{subject_key[:3]}-{q['number']:02d}",
            "number": q["number"],
            "stem": q["stem"],
            "options": q["options"],
            "answer": letter,
        })

    paper = {
        "schema_version": "1.0",
        "year_roc": pair["year"],
        "year_label": f"{pair['year']} 年",
        "quarter": pair["quarter"],
        "subject_key": subject_key,
        "subject_label": subj["label"],
        "exam_name": "證券商高級業務員",
        "source_pdf": f"data/exam_archive/pdfs/{pair['year']}/{pair['questions_pdf'].name}",
        "answer_pdf": f"data/exam_archive/pdfs/{pair['year']}/{pair['answers_pdf'].name}",
        "question_count": len(out_questions),
        "questions": out_questions,
    }
    return paper, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    archive_dir = Path(args.archive)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    pairs = discover_papers(archive_dir)
    print(f"[discover] {len(pairs)} quarter-pair(s)")

    summary = []
    fail_log = []
    for p in pairs:
        try:
            pages = extract_pages(p["questions_pdf"])
            sections = split_subjects_by_page(pages)
            answers = parse_answer_key(p["answers_pdf"])
        except Exception as e:
            fail_log.append({"pair": f"{p['year']}{p['quarter']}", "stage": "extract", "err": str(e)})
            continue

        for s in SUBJECTS:
            paper, err = build_paper_json(p, sections, answers, s["key"])
            if paper is None:
                fail_log.append({"pair": f"{p['year']}{p['quarter']}", "subject": s["key"], "err": err})
                continue
            fname = f"{p['year']}_{p['quarter']}_{s['key']}.json"
            (out_dir / fname).write_text(
                json.dumps(paper, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            summary.append({
                "file": fname, "year": p["year"], "quarter": p["quarter"],
                "subject": s["label"], "subject_key": s["key"],
                "questions": paper["question_count"],
            })

    index = {
        "schema_version": "1.0",
        "exam_name": "證券商高級業務員",
        "papers": [
            {
                "year_roc": s["year"],
                "year_label": f"{s['year']} 年",
                "quarter": s["quarter"],
                "subject_key": s["subject_key"],
                "subject_label": s["subject"],
                "question_count": s["questions"],
                "json_path": f"data/exam_archive/{s['file']}",
            } for s in summary
        ],
    }
    (out_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n[done] {len(summary)} JSON file(s) generated")
    for s in summary:
        print(f"  {s['file']}  {s['questions']} 題")
    if fail_log:
        print(f"\n[failures] {len(fail_log)}:")
        for f in fail_log:
            print(f"  {f}")
    else:
        print("\n[no failures]")


if __name__ == "__main__":
    main()
