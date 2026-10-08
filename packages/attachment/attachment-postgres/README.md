---
description: "PostgreSQL attachment backend: content-addressed image objects in one shared database, namespaced per fleet subject."
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-postgres

English | [中文](README.zh.md)

## Summary

`dsh-attachment-postgres` is an attachment backend that stores each admitted image as one immutable content-addressed row (`(namespace, sha256)` primary key) in a shared PostgreSQL database, registered as `ctx.attachments`. Several dsh nodes can point at the same database, and the fleet subject injected through `DSH_FLEET_USER_ID` derives the namespace column, so two nodes with different subjects never reach each other's objects. This is the minimal shared-medium implementation the seam allows: image validation and durable image references; verbatim files and request projection keep the seam's default refusals.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load the backend in a profile's `cordis.yml` (host-side only; nothing here is model-visible):

```yaml
plugins:
  '@deepseek-ai/dsh-attachment-postgres':
    connectionString: postgres://dsh:secret@db.internal:5432/dsh_attachments
```

| Field | Default | Meaning |
|---|---|---|
| `connectionString` | required | `postgres://` connection string of the shared attachments database |
| `max` | `4` | Connection pool size |
| `maxImageBytes` | `20971520` | Maximum encoded bytes for one image |
| `maxImagesPerMessage` | `20` | Maximum images admitted in one message |
| `maxMessageImageBytes` | `52428800` | Maximum aggregate encoded bytes for one message's image batch |
| `maxImagePixels` | `100000000` | Maximum decoded pixels for one image |
| `maxImageDimension` | `30000` | Maximum intrinsic width and height in pixels for one image |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-attachment-postgres) is the exhaustive source for every accepted field and its JSDoc.

### Observable behavior

A fresh database is stamped with the physical layout version inside one transaction; any other stamped version rejects — no migration, pre-release stance. Images are decoded fully at admission (Sharp): oversized, over-pixel, or malformed bytes refuse with the seam's stable `AttachmentError` codes and store nothing. Reads verify the sha256 of the stored bytes against the reference and fail `ATTACHMENT_NOT_FOUND` for an unknown or cross-namespace reference.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

- **Content-addressed immutable rows.** One row per `(namespace, sha256)`; re-saving the same bytes in another namespace writes a second row rather than linking, so namespaces never alias.
- **Admission decodes, reads verify.** `saveImage`/`validateImage` fully decode the raster (limits enforced on decoded facts); `readImage` re-derives the digest and compares, mirroring the local backend's verify-on-read.
- **Namespace from the injected fleet subject.** The same digest rule as the storage hub's domain namespaces (`u` + 16-hex sha256 of the subject); absent injection stores under the default empty namespace.
- **Connection lifecycle as one effect.** The pool opens lazily (failures surface at first use) and closes through a single context effect.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `AttachmentStore` service — admission, content-addressed save, verified read |
| [`src/schema.ts`](src/schema.ts) | Connect sequence, physical layout version, the object table |
| [`src/sharp.ts`](src/sharp.ts) | Lazy Sharp loading shared with the local backend's approach |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Attachment subsystem](../../../docs/subsystems/attachment.md) — the store contract, admission semantics, and request projection.
- [Attachment package map](../README.md) — the family's packages and their repository position.
- [Local attachment backend](../attachment-local/README.md) — the filesystem medium for single-node compositions.

-----

<a id="model-experience"></a>
## Model Experience

### Stored attachment objects

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it stores binary attachments behind `ctx.attachments` for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the backend never touches live request prefixes.

## Known Limitations and Deferred Work

These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Verbatim files and request projection keep the seam's default refusals** — `saveFile`/`saveFileStream`/`readFileStream`/`readImageRequest` reject `ATTACHMENT_FILES_UNSUPPORTED`/`ATTACHMENT_PROJECTION_UNSUPPORTED`; the shared-medium change covers image storage only.
- **No normalization** — images are stored byte-for-byte as admitted; the local backend's orientation and scaling normalization has no PostgreSQL counterpart yet.
- **No retention policy** — objects accumulate until removed externally; the seam has no deletion API.
- **The database and schema must pre-exist** — the backend creates tables, never databases; connection or permission failures surface at the first use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
