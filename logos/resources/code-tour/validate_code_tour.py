#!/usr/bin/env python3
"""验证 Code Tour 数据、单文件生成物与 JavaScript 语法。"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from build_code_tour import render


VALID_VERIFICATION = {"verified", "partial", "unverified"}
REQUIRED_FILES = (
    "tour.config.json",
    "tour-data.json",
    "tour-app.js",
    "tour.css",
    "index.html",
)
REQUIRED_TOP_LEVEL = (
    "meta",
    "overviewNodes",
    "overviewEdges",
    "modules",
    "flows",
    "readingPath",
)
INTERACTION_MARKERS = (
    "data-view",
    "data-kind",
    "data-flow",
    "data-file",
    "data-zoom",
    "pushHistory",
    "setupSearch",
)


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.passes: list[str] = []

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def passed(self, message: str) -> None:
        self.passes.append(message)


def load_json(path: Path, report: Report) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        report.error(f"缺少文件：{path.name}")
    except json.JSONDecodeError as exc:
        report.error(f"{path.name}:{exc.lineno}:{exc.colno}: {exc.msg}")
    return None


def unique_ids(items: Any, label: str, report: Report) -> set[str]:
    if not isinstance(items, list):
        report.error(f"{label} 必须是数组")
        return set()
    ids: list[str] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            report.error(f"{label}[{index}] 缺少字符串 id")
            continue
        ids.append(item["id"])
    duplicates = sorted({item_id for item_id in ids if ids.count(item_id) > 1})
    if duplicates:
        report.error(f"{label} 存在重复 id：{', '.join(duplicates)}")
    return set(ids)


def edge_ends(edge: Any) -> tuple[str | None, str | None]:
    if isinstance(edge, list) and len(edge) == 2:
        return edge[0], edge[1]
    if isinstance(edge, dict):
        return edge.get("from"), edge.get("to")
    return None, None


def check_edges(edges: Any, node_ids: set[str], label: str, report: Report) -> None:
    if not isinstance(edges, list):
        report.error(f"{label} 必须是数组")
        return
    for index, edge in enumerate(edges):
        source, target = edge_ends(edge)
        if not isinstance(source, str) or not isinstance(target, str):
            report.error(f"{label}[{index}] 不是合法边")
            continue
        missing = [node_id for node_id in (source, target) if node_id not in node_ids]
        if missing:
            report.error(f"{label}[{index}] 引用未知节点：{', '.join(missing)}")


def check_data(root: Path, data: Any, report: Report) -> None:
    if not isinstance(data, dict):
        report.error("tour-data.json 顶层必须是对象")
        return
    for key in REQUIRED_TOP_LEVEL:
        if key not in data:
            report.error(f"tour-data.json 缺少顶层字段：{key}")

    overview = data.get("overviewNodes", [])
    overview_ids = unique_ids(overview, "overviewNodes", report)
    check_edges(data.get("overviewEdges", []), overview_ids, "overviewEdges", report)
    for node in overview if isinstance(overview, list) else []:
        if not isinstance(node, dict):
            continue
        for field in ("dependsOn", "usedBy"):
            for ref in node.get(field, []):
                if ref not in overview_ids:
                    report.error(f"overview node {node.get('id')} 的 {field} 引用未知节点：{ref}")
        if not node.get("evidence"):
            report.warn(f"overview node {node.get('id')} 缺少 evidence")

    modules = data.get("modules", [])
    module_ids = unique_ids(modules, "modules", report)
    module_by_id = {
        item["id"]: item
        for item in modules
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    for module_id, module in module_by_id.items():
        for dep in module.get("deps", []):
            if dep not in module_ids:
                report.error(f"module {module_id} 依赖未知模块：{dep}")
            elif module_id not in module_by_id[dep].get("dependents", []):
                report.warn(f"module 双向关系不一致：{module_id} depends on {dep}")
        for dependent in module.get("dependents", []):
            if dependent not in module_ids:
                report.error(f"module {module_id} 被未知模块引用：{dependent}")

    flows = data.get("flows", {})
    if not isinstance(flows, dict) or not flows:
        report.error("flows 必须是非空对象")
    else:
        for flow_id, flow in flows.items():
            if not isinstance(flow, dict):
                report.error(f"flow {flow_id} 必须是对象")
                continue
            nodes = flow.get("nodes", [])
            node_ids = unique_ids(nodes, f"flows.{flow_id}.nodes", report)
            check_edges(flow.get("edges", []), node_ids, f"flows.{flow_id}.edges", report)
            for node in nodes if isinstance(nodes, list) else []:
                if not isinstance(node, dict):
                    continue
                verification = node.get("verification")
                if verification not in VALID_VERIFICATION:
                    report.error(
                        f"flow {flow_id} node {node.get('id')} verification 非法：{verification}"
                    )
                if not node.get("evidence"):
                    report.warn(f"flow {flow_id} node {node.get('id')} 缺少 evidence")
                file_path = node.get("file")
                if isinstance(file_path, str) and file_path and not (root.parent.parent.parent / file_path).exists():
                    # 输出目录通常是 <repo>/docs/code-tour；只警告，不假定固定层级。
                    report.warn(f"flow {flow_id} node {node.get('id')} 的文件未在推定仓库根找到：{file_path}")

    reading_path = data.get("readingPath", [])
    if not isinstance(reading_path, list) or not reading_path:
        report.error("readingPath 必须是非空数组")
    elif len(reading_path) > 12:
        report.warn(f"readingPath 有 {len(reading_path)} 步，建议不超过 12 步")

    if len(module_ids) > 30:
        report.warn(f"核心依赖图包含 {len(module_ids)} 个模块，建议默认视图进一步收敛")


def check_output(root: Path, report: Report) -> None:
    output = root / "index.html"
    if not output.exists():
        return
    content = output.read_text(encoding="utf-8")

    external_patterns = {
        "外部脚本": r"<script[^>]+src\s*=",
        "外部样式": r"<link[^>]+rel=[\"']stylesheet[\"']",
        "远程图片": r"<img[^>]+src=[\"']https?://",
        "CSS 远程资源": r"url\(\s*[\"']?https?://",
    }
    for label, pattern in external_patterns.items():
        if re.search(pattern, content, re.IGNORECASE):
            report.error(f"index.html 包含{label}")

    for marker in INTERACTION_MARKERS:
        if marker not in content:
            report.error(f"index.html 缺少交互标记：{marker}")

    try:
        expected = render(root)
        if content != expected:
            report.error("index.html 与当前源文件不一致，请重新构建")
        else:
            report.passed("生成物与源文件一致")
    except (OSError, SystemExit) as exc:
        report.error(f"无法复算生成物：{exc}")

    script_match = re.search(r"<script>\s*(.*?)\s*</script>", content, re.DOTALL)
    if not script_match:
        report.error("index.html 缺少内嵌脚本")
        return
    node = shutil.which("node")
    if not node:
        report.warn("未找到 Node.js，跳过 JavaScript 语法检查")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as handle:
        handle.write(script_match.group(1))
        script_path = Path(handle.name)
    try:
        result = subprocess.run(
            [node, "--check", str(script_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            report.error(f"JavaScript 语法失败：{result.stderr.strip()}")
        else:
            report.passed("JavaScript 语法通过")
    finally:
        script_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Code Tour 源文件目录")
    parser.add_argument("--json", action="store_true", help="输出 JSON 报告")
    args = parser.parse_args()
    root = args.directory.resolve()
    report = Report()

    for name in REQUIRED_FILES:
        if not (root / name).exists():
            report.error(f"缺少文件：{name}")
    data = load_json(root / "tour-data.json", report)
    if data is not None:
        check_data(root, data, report)
    check_output(root, report)

    result = {
        "ok": not report.errors,
        "errors": report.errors,
        "warnings": report.warnings,
        "passes": report.passes,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for message in report.passes:
            print(f"PASS {message}")
        for message in report.warnings:
            print(f"WARN {message}")
        for message in report.errors:
            print(f"FAIL {message}")
        print(
            f"RESULT {'PASS' if result['ok'] else 'FAIL'} "
            f"errors={len(report.errors)} warnings={len(report.warnings)}"
        )
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
