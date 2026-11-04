---
kind: upgrade-guide
description: "DeepSeek API-key route discovers its model catalog from the endpoint; ACP stops reinserting removed models into options."
---

# DeepSeek model catalogs come from the endpoint; ACP stops reinserting removed models

English | [中文](guide.zh.md)

## Change

On the `deepseek-official` API-key route (`@deepseek-ai/dsh-llm-deepseek-api-key`), an omitted `models` config previously advertised the static catalog `deepseek-flash` + `deepseek-v4-pro`. The next release discovers the catalog from the resolved endpoint's Messages-compatible model listing (`GET {messagesApiRoot}/models`) over the same endpoint and credential resolution as inference. Deployments whose gateway does not implement that listing — and compositions without reachable endpoints — now fail catalog reads (`ctx.llm.listModels`, settings and ACP model options) with a discovery error instead of seeing static ids that may not exist upstream. Discovery attempts are bounded by the new `discoveryTimeoutMs` (default 10 seconds); successful results — including an empty listing — cache per endpoint, credential, and discovery settings for `discoveryCacheTtlMs` (default 30 seconds; 0 disables reuse). Failures are never cached. An explicit `models` list remains a manual override with no network access; `models: []` is a deliberate empty catalog.

ACP previously reinserted a session's current model into the advertised options after the provider stopped listing it and swallowed per-provider catalog errors. The next release validates choices against the live catalog: a removed current model stays only as `currentValue`, never among choices; `session/set_config_option` rejects unlisted values; catalog discovery errors propagate to the client. ACP clients that re-submit a stored selection must handle the rejection.

## Migration

1. If your gateway does not implement the model listing, or you must keep the previous catalog offline, set an explicit `models` list on the `llm-deepseek` entry; the previous default listed ids `deepseek-flash` and `deepseek-v4-pro`.
2. If the endpoint implements the listing, keep `models` omitted and confirm credential reachability; catalog reads then follow the endpoint.
3. ACP clients: treat a `currentValue` outside `options` as read-only state and stop re-submitting unlisted ids.
4. Confirm: `ctx.llm.listModels('deepseek-official')` shows the endpoint's real ids; an unreachable endpoint fails catalog reads with a discovery error; an explicit `models` config serves the configured list without network access.
