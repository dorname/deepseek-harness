# Code Tour — DeepSeek Harness 源码探索器

[English](README.md) | 中文

## 概述

在浏览器打开 `index.html`，探索已记录的模块地图。该文件内嵌 CSS、JavaScript 和数据，无需外部资产。验证标签说明各条目记录的证据；源码变化后需复核行号。

## 目录

- [再生成](#regenerate)
- [源文件](#source-files)
- [数据维护](#data-maintenance)

<a id="regenerate"></a>
## 再生成

在仓库根目录运行以下命令：

```sh
python3 -E logos/resources/code-tour/build_code_tour.py logos/resources/code-tour
python3 -E logos/resources/code-tour/validate_code_tour.py logos/resources/code-tour
```

构建器将数据、视图引擎、样式和页面配置合并为 `index.html`；校验器检查引用、交互标记、生成文件一致性及 JavaScript 语法。

<a id="source-files"></a>
## 源文件

| 文件 | 用途 |
|---|---|
| `tour.config.json` | 页面标题、品牌和搜索文本 |
| `tour-data.json` | 带验证标签的模块、流程和阅读路径证据 |
| `tour-app.js` | 含一个 `__TOUR__` 数据占位符的视图引擎 |
| `tour.css` | 样式 |
| `build_code_tour.py` / `validate_code_tour.py` | 确定性生成和校验 |

<a id="data-maintenance"></a>
## 数据维护

- 概览边从调用方指向被调方。模块边从依赖指向使用方；`deps` 和 `dependents` 必须一致。
- 依据各包 manifest 提取依赖。缺少源码证据的声明标为 `partial`，标为 `verified` 前需复核证据。
