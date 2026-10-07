#!/usr/bin/env python3
"""从结构化源文件确定性构建离线单文件 Code Tour。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
from typing import Any


DEFAULT_CONFIG: dict[str, str] = {
    "title": "Code Tour — 源码探索器",
    "lang": "zh-CN",
    "brand": "CODE",
    "accent": "Tour",
    "subtitle": "offline",
    "searchPlaceholder": "搜索 module / file / symbol…",
    "detailHeading": "详情",
    "detailEmpty": "点击图中的节点，查看职责、文件、符号与证据。",
}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"缺少文件：{path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"JSON 解析失败：{path}:{exc.lineno}:{exc.colno}: {exc.msg}") from exc


def load_config(root: Path) -> dict[str, str]:
    path = root / "tour.config.json"
    raw = load_json(path) if path.exists() else {}
    if not isinstance(raw, dict):
        raise SystemExit("tour.config.json 顶层必须是对象")
    config = DEFAULT_CONFIG | {key: str(value) for key, value in raw.items()}
    return config


def safe_script_json(data: Any) -> str:
    # HTML parser 会在 JavaScript 字符串上下文之外识别 </script>。
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def render(root: Path) -> str:
    config = load_config(root)
    data = load_json(root / "tour-data.json")
    app_template = (root / "tour-app.js").read_text(encoding="utf-8")
    css = (root / "tour.css").read_text(encoding="utf-8")

    placeholder_count = app_template.count("__TOUR__")
    if placeholder_count != 1:
        raise SystemExit(
            f"tour-app.js 必须且只能包含一个 __TOUR__ 占位符，当前为 {placeholder_count}"
        )
    if "</script" in app_template.lower():
        raise SystemExit("tour-app.js 不能包含字面量 </script>")
    if "</style" in css.lower():
        raise SystemExit("tour.css 不能包含字面量 </style>")

    app = app_template.replace("__TOUR__", safe_script_json(data), 1)
    esc = lambda value: html.escape(config[value], quote=True)

    return f"""<!DOCTYPE html>
<html lang="{esc("lang")}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{esc("title")}</title>
<style>
{css.rstrip()}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><h1>{esc("brand")} <em>{esc("accent")}</em><small>{esc("subtitle")}</small></h1></div>
  <nav class="tabs" id="tabs"></nav>
  <div class="search-wrap">
    <input id="search" type="search" placeholder="{esc("searchPlaceholder")}" autocomplete="off"/>
    <div class="search-results" id="searchResults"></div>
  </div>
</header>
<div class="shell">
  <main class="main" id="main"></main>
  <aside class="side">
    <div class="side-head"><h2>{esc("detailHeading")}</h2><button class="btn ghost" id="btnBack" type="button">返回上一级</button></div>
    <div class="side-body" id="detail"><div class="detail-empty">{esc("detailEmpty")}</div></div>
  </aside>
</div>
<script>
{app.rstrip()}
</script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="包含 tour-data.json 等源文件的目录")
    parser.add_argument(
        "--check",
        action="store_true",
        help="不写文件；检查 index.html 是否与当前源文件一致",
    )
    args = parser.parse_args()
    root = args.directory.resolve()
    output = root / "index.html"
    rendered = render(root)

    if args.check:
        if not output.exists():
            print(f"FAIL 缺少生成物：{output}")
            return 1
        if output.read_text(encoding="utf-8") != rendered:
            print(f"FAIL 生成物已过期：{output}")
            return 1
        print(f"PASS 生成物与源文件一致：{output}")
        return 0

    root.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(".html.tmp")
    temp.write_text(rendered, encoding="utf-8")
    os.replace(temp, output)
    digest = hashlib.sha256(rendered.encode("utf-8")).hexdigest()[:12]
    print(f"built {output} sha256={digest} bytes={len(rendered.encode('utf-8'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
