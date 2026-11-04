---
description: "DeepSeek api-key authentication and model discovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek-api-key

English | [中文](README.zh.md)

## Summary

Register authentication and model discovery for `deepseek-official`. This plugin shares the [Messages transport](../llm-deepseek/README.md) and owns credential resolution and catalog availability.

Authentication resolution returns the validated API key in `x-api-key` for both Messages and Files requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

`apiKeyEnv` defaults to `DEEPSEEK_API_KEY` and resolves per request. When the credentials service exists, its precedence applies; only compositions without that service read the launch environment directly. Requests with missing credentials fail with `MISSING_CREDENTIAL`; malformed credentials fail with `INVALID_CREDENTIAL`. Catalog discovery resolves credentials through the same path, so discovery without usable credentials fails with the same errors.

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    reasoningEffort: high
    apiKeyEnv: DEEPSEEK_API_KEY
```

The endpoint and credential reference come from one configuration resolution. In-flight requests retain that snapshot; subsequent updates affect subsequent calls. Account login state cannot change this route’s credential.

Omitted `models` discovers the catalog from the resolved endpoint's Messages-compatible model listing over the same endpoint and credential resolution as inference; discovered ids pass through verbatim and carry no fabricated capability metadata. The listing URL follows a candidate chain: the primary `GET {messagesApiRoot}/models`, and — only when a candidate answers 404/405 on a gateway-suffixed path — stripped-suffix origin fallbacks, so the official `api.deepseek.com` route finds its listing at the origin root. An explicit `models` list is a manual override that serves the catalog without network access or credential resolution (`[]` is a deliberate empty catalog). Discovery attempts are bounded by `discoveryTimeoutMs` (default 10 seconds), and successful results — including an empty listing — are cached per endpoint, credential, and discovery settings for `discoveryCacheTtlMs` (default 30 seconds; 0 disables reuse while concurrent calls still merge). Failures are never cached: they propagate to catalog consumers with no static fallback. The settings namespace is the Cordis entry id, or the plugin name without an entry. Product profiles retain the official entry id `llm-deepseek` and use `llm-deepseek-account` for the account route.

<a id="understand-the-implementation"></a>
## Understand the implementation

Registrations and listeners dispose with the plugin. Shared Host wiring supplies attachments, request extensions, anonymous identity, and atomic retry-policy updates; this plugin registers only its own route.

<a id="further-exploration"></a>
## Further Exploration

[LLM streaming](../../../docs/subsystems/llm-streaming.md) · [Messages](../llm-deepseek/README.md)

<a id="model-experience"></a>
## Model Experience

### Authenticated model requests

#### What the model sees

Requests on `deepseek-official` add no model-visible text from this plugin; the shared Messages transport serializes requests.

#### Token effect

Authentication and discovery add no input tokens; the selected model and request content determine actual usage.

#### KV Cache effect

Credentials and catalog availability do not enter model input; the protocol transport owns request-prefix serialization.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The catalog is configuration metadata, not remote validation that a model is accepted; actual calls can still fail.
- Endpoint discovery requires the gateway to implement the Messages-compatible model listing; gateways without it need an explicit `models` override ([migration guide](../../../docs/upgrade-guide/v0.2.1-alpha.1/deepseek-dynamic-model-discovery/guide.md)).

<a id="dev-note"></a>
### Dev Note

Registration and authentication tests also cover the Loader composition in the shared transport package.
