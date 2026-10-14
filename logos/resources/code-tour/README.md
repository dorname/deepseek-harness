# Code Tour — DeepSeek Harness source explorer

English | [中文](README.zh.md)

## Summary

Open `index.html` in a browser to explore the recorded module map. The file embeds its CSS, JavaScript, and data and requires no external assets. Verification labels describe the evidence recorded for each item; source line numbers need rechecking when code changes.

## Table of Contents

- [Regenerate](#regenerate)
- [Source files](#source-files)
- [Data maintenance](#data-maintenance)

<a id="regenerate"></a>
## Regenerate

Run these commands from the repository root:

```sh
python3 -E logos/resources/code-tour/build_code_tour.py logos/resources/code-tour
python3 -E logos/resources/code-tour/validate_code_tour.py logos/resources/code-tour
```

The builder combines the data, view engine, styles, and shell configuration into `index.html`; the validator checks references, interaction markers, generated-file consistency, and JavaScript syntax.

<a id="source-files"></a>
## Source files

| File | Purpose |
|---|---|
| `tour.config.json` | Page title, branding, and search text |
| `tour-data.json` | Module, flow, and reading-path evidence with verification labels |
| `tour-app.js` | View engine with one `__TOUR__` data placeholder |
| `tour.css` | Styles |
| `build_code_tour.py` / `validate_code_tour.py` | Deterministic rendering and validation |

<a id="data-maintenance"></a>
## Data maintenance

- Overview edges point from caller to callee. Module edges point from dependency to dependent; `deps` and `dependents` must agree.
- Derive dependencies from each package manifest. Use `partial` for claims without source evidence and recheck evidence before assigning `verified`.
