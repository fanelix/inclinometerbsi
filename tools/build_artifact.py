#!/usr/bin/env python3
"""Produce the body-only page the Artifact publisher expects.

claude.ai wraps a published page in its own <!doctype>/<head>/<body> skeleton, so
the file it receives must carry no document wrapper of its own. index.html marks
the two regions worth keeping with sentinel comments; this copies them across
verbatim, leaving every asset path untouched so the same relative references work
from the repository, from a static host, and from the published artifact.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "index.html"
TARGET = ROOT / "dist" / "artifact.html"


def region(html: str, name: str) -> str:
    match = re.search(rf"<!--#{name}-->(.*?)<!--#/{name}-->", html, re.S)
    if not match:
        sys.exit(f"index.html is missing the <!--#{name}--> sentinel pair")
    return match.group(1).strip("\n")


def main() -> None:
    html = SOURCE.read_text(encoding="utf-8")
    page = region(html, "head") + "\n\n" + region(html, "body") + "\n"
    if "<html" in page or "<body" in page:
        sys.exit("the extracted regions still contain a document wrapper")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(page, encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(page):,} bytes)")


if __name__ == "__main__":
    main()
