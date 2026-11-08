---
kind: upgrade-guide
description: "llm-pi-ai compositions can declare provider routes as a providerList array — a composition-only deployment artifact beside the settings-editable providers dict, with a load-time conflict vocabulary that fails loud."
---

# Multi-provider route supply for llm-pi-ai

English | [中文](guide.zh.md)

## Change

`llm-pi-ai` gains a second route-supply key beside the existing `providers` dictionary:

- `providerList` is an array whose entries each name their route in `provider` beside the identical profile fields (`apiKeyEnv`, `baseURL`, `api`, `models`, `modelOverrides`, `compat`, `headers`, `retryPolicy`, …). Declaration order is the resolved route order, and the array normalizes into the same pipeline as an equivalent dict — registration, the configurable directory, model discovery, and credential resolution behave identically.
- `providers` is unchanged: a volatile dict whose keys are the route names, editable live through the settings document (the web Models page), supplied either by settings or by the composition.
- `providerList` is a composition-only deployment artifact. It is not part of the volatile form, so the settings write gate refuses it: only `cordis.yml` or a profile patch can declare or change it, and a change remounts the entry like any ordinary composition change.
- Conflicts fail loud. Supplying both keys names routes → plugin loading fails. A duplicate or empty `provider` key in the list → loading fails naming the array entry. A dict value carrying a `provider` field keeps being refused. A settings write of `providers` beside a composition-supplied `providerList` is refused with the conflict named, and the previous route set keeps serving.
- acp-network needs no change: the `provider` / `model` pair stays the session-start default route selection, and `configOptions` advertises every registered route grouped by provider (existing behavior) — more registered routes simply widen the advertisement.

## Migration

1. Generated fleet manifests (one artifact must express every route): declare the routes as a `providerList` under the `llm-pi-ai` composition entry:

   ```yaml
   - id: llm-pi-ai
     name: '@deepseek-ai/dsh-llm-pi-ai'
     config:
       providerList:
         - provider: openai
           apiKeyEnv: OPENAI_API_KEY
         - provider: acme-gateway
           apiKeyEnv: ACME_GATEWAY_API_KEY
           api: openai-completions
           baseURL: https://gateway.acme.example/v1
           models:
             - id: acme-large
   ```

2. Routes a user edits live keep the `providers` dict; the web Models page and the settings document are unchanged. As a rule: settings uses the dict, the composition layer may use either key, and one deployment picks one of the two.
3. Never supply both keys in one composition — loading fails naming both. A hand-edited profile patch replaces an entry's `config` wholesale, so a patch row for an entry that declares `providerList` in `cordis.yml` must carry the complete configuration.
4. Rollback: previous dsh builds' schema refuses `providerList`, so rolling back the release also means restoring the composition patch's `providerList` section (or replacing it with a `providers` dict) before restarting the old build.
5. Confirm: boot the composition and check the registered routes (`llm.listProviders()` or the session `configOptions` advertisement); a settings write targeting `providerList` is refused with `Config field "providerList" is not volatile`.
