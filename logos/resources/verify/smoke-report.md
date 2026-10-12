# Smoke Report

> Generated for change `cluster-web-fe-split` on 2026-10-12

## Summary

| Metric | Value |
|--------|-------|
| Focus | SMOKE-core-20..23 (cluster-web) |
| SMOKE-core-20 | pass |
| SMOKE-core-21 | pass |
| SMOKE-core-22 | pass |
| SMOKE-core-23 | pass (shell+API-only+edge token/cookie/API) |
| **Gate (this change)** | **PASS** |

## Notes

- Full `openlogos smoke` (all SMOKE-core-01..) was not re-run end-to-end in this session because fleet runners are long-running; change deploy task only requires SMOKE-core-23.
- Evidence: `logos/resources/verify/smoke-results.jsonl` (latest SMOKE-core-23 pass).
