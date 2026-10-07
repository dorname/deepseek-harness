# Code Tour — DeepSeek Harness 源码探索器

离线单文件交付物：`index.html`（CSS/JS/数据全内嵌，无外部依赖，直接用浏览器打开）。

## 再生成

```sh
cd logos/resources/code-tour
python3 build_code_tour.py .        # 从 tour-data.json + tour-app.js + tour.css 确定性构建 index.html
python3 validate_code_tour.py .     # 数据引用完整性 / 交互标记 / 单文件一致性 / JS 语法
```

## 源文件

| 文件 | 职责 |
|------|------|
| `tour.config.json` | 标题、品牌、搜索占位等页面外壳配置 |
| `tour-data.json` | 全部知识数据：overviewNodes/overviewEdges/modules/flows/readingPath，每条带 evidence 与 verified/partial/unverified |
| `tour-app.js` | 视图引擎（恰好一个 `__TOUR__` 占位符由构建器替换为数据） |
| `tour.css` | 样式 |
| `build_code_tour.py` / `validate_code_tour.py` | 复制自 code-tour-builder 技能；仅一处适配：flow 文件存在性检查的仓库根推定从 `root.parent.parent` 校正为 `root.parent.parent.parent`（本目录比技能默认的 `docs/code-tour/` 深一层） |

## 数据维护约定

- 边语义：overviewEdges 为「调用方 → 被调方」；modules 依赖图箭头为「dependency → dependent」（A→B 表示 B 直接依赖 A），`deps` 必须与 `dependents` 双向一致。
- `deps` 逐条来自各包 `package.json` 的 `dependencies`/`peerDependencies`；无法落到具体行号的条目标 `partial`，禁止把未核实内容标成 `verified`。
