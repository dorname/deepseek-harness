/**
 * PostgreSQL attachment backend. It stores each admitted image as one
 * immutable content-addressed row (`(namespace, sha256)` primary key) in a
 * shared database, so several dsh nodes point at the same medium and every
 * fleet subject's objects stay in their own namespace column. This is the
 * minimal shared-medium implementation the seam allows: image validation and
 * durable image references; verbatim files and request projection keep the
 * seam's default refusals.
 * @module @deepseek-ai/dsh-attachment-postgres
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type postgres from 'postgres'
import { createHash } from 'node:crypto'
import { AttachmentError, AttachmentStore, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { connectDatabase, OBJECTS_TABLE } from './schema.ts'
import { requireSharp } from './sharp.ts'

/** Media types this backend admits, mirroring the local backend's set. */
const MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const)

const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20
const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_IMAGE_PIXELS = 100 * 1000 * 1000
const DEFAULT_MAX_IMAGE_DIMENSION = 30_000

/** The environment variable carrying the fleet subject (see the fleet manager). */
const NAMESPACE_ENV = 'DSH_FLEET_USER_ID'

/** The namespace column value for a fleet subject's digest, or the default empty namespace. */
function namespaceColumn(env: NodeJS.ProcessEnv): string {
  const subject = env[NAMESPACE_ENV]?.trim()
  if (subject === undefined || subject.length === 0) return ''
  return `u${createHash('sha256').update(subject, 'utf8').digest('hex').slice(0, 16)}`
}

/** One decoded raster's verified facts. */
interface DetectedImage {
  readonly mediaType: ImageAttachmentRef['mediaType']
  readonly width: number
  readonly height: number
}

/**
 * Decode one image's header and raster fully, so admission proves these exact
 * bytes are a supported, complete image.
 * @param input - the encoded bytes and declared media type.
 * @param limits - the deployment-resolved admission limits.
 * @returns the verified media type and intrinsic dimensions.
 * @throws {AttachmentError} when the bytes are not a decodable supported image
 *   or the raster exceeds the configured limits.
 */
async function detectImage(input: SaveImageAttachment, limits: ImageAttachmentLimits): Promise<DetectedImage> {
  if (input.data.byteLength > limits.maxImageBytes) {
    throw new AttachmentError('Image exceeds the configured byte limit.', 'IMAGE_TOO_LARGE')
  }
  if (!limits.mediaTypes.includes(input.mediaType)) {
    throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
  }
  const sharp = requireSharp()
  try {
    const image = sharp(input.data, { failOn: 'error', limitInputPixels: false })
    const metadata = await image.metadata()
    // sharp's metadata types claim non-optional dimensions, but a truncated
    // or foreign container can decode without them; the optional annotations
    // below restore the honest runtime shape.
    const { width, height }: { width?: number; height?: number } = metadata
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- sharp's non-optional metadata types; see the annotation above.
    if (width === undefined || height === undefined) {
      throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
    }
    if (width * height > limits.maxImagePixels) {
      throw new AttachmentError('Image exceeds the configured decoded-pixel limit.', 'IMAGE_TOO_MANY_PIXELS')
    }
    if (Math.max(width, height) > limits.maxImageDimension) {
      throw new AttachmentError('Image exceeds the configured per-side pixel limit.', 'IMAGE_DIMENSION_TOO_LARGE')
    }
    // Decode the full raster: a truncated or corrupt container rejects here,
    // so the stored digest always names bytes this build fully decoded.
    await image.raw().toBuffer()
    return { mediaType: input.mediaType, width, height }
  } catch (error: unknown) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', { cause: error })
  }
}

/** Plugin configuration for the PostgreSQL attachment backend. */
export interface Config {
  /**
   * `postgres://` connection string of the shared database. The database (and
   * schema) must already exist; the backend creates its tables on connect.
   * Connect failures surface at the first use of the backend.
   */
  connectionString: string
  /** Connection pool size for object writes and reads. */
  max?: number
  /** Maximum encoded bytes for one image. */
  maxImageBytes?: number
  /** Maximum images admitted in one message. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded bytes for one message's image batch. */
  maxMessageImageBytes?: number
  /** Maximum decoded pixels for one image. */
  maxImagePixels?: number
  /** Maximum intrinsic width and height in pixels for one image. */
  maxImageDimension?: number
}

/**
 * The PostgreSQL attachment backend. Load as a plugin; it registers as
 * `ctx.attachments`. Objects are content-addressed and immutable; the fleet
 * subject injected through `DSH_FLEET_USER_ID` derives the namespace column,
 * so two nodes with different subjects never see each other's objects.
 */
export class PostgresAttachmentStore extends AttachmentStore {
  static Config: z<Config> = z.object({
    connectionString: z.string().required(),
    max: z.number().step(1).min(1).max(64).default(4),
    maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
    maxImagesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_MESSAGE),
    maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
    maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
    maxImageDimension: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_DIMENSION),
  })

  override readonly name = 'attachment-postgres'

  readonly imageLimits: ImageAttachmentLimits

  private readonly ready: Promise<postgres.Sql>
  private closing: Promise<void> | undefined
  private readonly namespace: string

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.ready = connectDatabase(config.connectionString, config.max ?? 4)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    ctx.effect(() => async () => {
      this.closing ??= (async () => {
        try {
          const sql = await this.ready
          await sql.end({ timeout: 5 })
        } catch {
          // The pool never connected; that failure already rejected the first
          // caller, and there is nothing left to release here.
        }
      })()
      await this.closing
    }, 'attachment-postgres connection pool')
    this.imageLimits = Object.freeze({
      maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: config.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: config.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: config.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
      maxImageDimension: config.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION,
      mediaTypes: MEDIA_TYPES,
    })
    this.namespace = namespaceColumn(process.env)
  }

  override async validateImage(input: SaveImageAttachment): Promise<void> {
    await this.ready
    await detectImage(input, this.imageLimits)
  }

  override async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const sql = await this.ready
    const detected = await detectImage(input, this.imageLimits)
    const data = Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength)
    const digest = createHash('sha256').update(data).digest('hex')
    await sql.unsafe(`
      INSERT INTO "${OBJECTS_TABLE}"
        (namespace, sha256, media_type, bytes, size, width, height, name, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (namespace, sha256) DO NOTHING
    `, [this.namespace, digest, detected.mediaType, data, data.byteLength,
      detected.width, detected.height, input.name ?? null, Date.now()])
    return {
      attachmentId: AttachmentId(digest),
      mediaType: detected.mediaType,
      bytes: data.byteLength,
      width: detected.width,
      height: detected.height,
      ...(input.name === undefined ? {} : { name: input.name }),
    }
  }

  override async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    signal?.throwIfAborted()
    const sql = await this.ready
    signal?.throwIfAborted()
    const rows = await sql.unsafe(
      `SELECT media_type, bytes, size, width, height, name FROM "${OBJECTS_TABLE}" WHERE namespace = $1 AND sha256 = $2`,
      [this.namespace, String(ref.attachmentId)],
    ) as Array<{ media_type: string; bytes: Buffer; size: string; width: number; height: number; name: string | null }>
    signal?.throwIfAborted()
    const row = rows[0]
    if (row === undefined) {
      throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    }
    const data = new Uint8Array(row.bytes.buffer, row.bytes.byteOffset, row.bytes.byteLength)
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== String(ref.attachmentId)) {
      throw new AttachmentError('Attachment object failed digest verification.', 'ATTACHMENT_CORRUPT')
    }
    return {
      ref: {
        attachmentId: ref.attachmentId,
        mediaType: row.media_type as ImageAttachmentRef['mediaType'],
        bytes: Number(row.size),
        width: row.width,
        height: row.height,
        ...(row.name === null ? {} : { name: row.name }),
      },
      data,
    }
  }
}

export default PostgresAttachmentStore
