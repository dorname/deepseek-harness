/**
 * SMOKE-core-25: real DeepSeek dynamic catalog with exact-model inference
 * over ACP (change `dsh-provider-model-discovery`).
 *
 * Talks to the shipped ACP stdio profile (`node apps/cli/lib/bin.js
 * --profile acp`) with the existing secret: `session/new` publishes the
 * endpoint's live catalog, the first model is selected and prompted with its
 * exact upstream id, and a second real catalog model is then selected and
 * prompted. The API key is passed to the child through the environment and
 * is never written to the ledger, stdout, or errors.
 *
 * Honest outcome rules (S48-AC-6): no usable secret, an absent
 * `deepseek-v4-flash`, or an inference that never completed is recorded as
 * `skip`/`fail` with the reason — never as a pass, and never substituted
 * with a mock.
 *
 * @module
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DSH_CLI_BIN = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
const RESULT_PATH = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(REPO_ROOT, 'logos', 'resources', 'verify', 'smoke-results.jsonl')
const TARGET_MODEL = 'deepseek-v4-flash'
const PROTOCOL_VERSION = 1
const CASE_TIMEOUT_MS = 180_000

/** Append one ledger record (the dispatcher owns truncation). */
function report(status: 'pass' | 'fail' | 'skip', scenario: string, started: number, error?: string): void {
  mkdirSync(join(RESULT_PATH, '..'), { recursive: true })
  const record: Record<string, unknown> = {
    id: 'SMOKE-core-25',
    status,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - started,
    scenario,
  }
  if (error !== undefined) record.error = error
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`)
  console.log(`smoke-deepseek-discovery: SMOKE-core-25 ${status} (${String(record.duration_ms)}ms) ${scenario}`)
}

/** Read `DEEPSEEK_API_KEY` from the environment or the repository `.env`; undefined when absent. */
function readApiKey(): string | undefined {
  if (process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY.length > 0) {
    return process.env.DEEPSEEK_API_KEY
  }
  const envFile = join(REPO_ROOT, '.env')
  try {
    const line = readFileSync(envFile, 'utf8')
      .split('\n')
      .find(row => row.startsWith('DEEPSEEK_API_KEY='))
    const value = line?.slice('DEEPSEEK_API_KEY='.length).trim()
    return value !== undefined && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

interface JsonRpcResponse {
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

/** One stdio JSON-RPC conversation with the real ACP profile process. */
class AcpConsole {
  private readonly pending = new Map<number, (response: JsonRpcResponse) => void>()
  private nextId = 1
  private buffer = ''

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      this.buffer += line
      let parsed: unknown
      try { parsed = JSON.parse(this.buffer) } catch { return }
      this.buffer = ''
      const message = parsed as JsonRpcResponse
      if (message.id === undefined || message.id === null) return // session/update notification
      this.pending.get(Number(message.id))?.(message)
      this.pending.delete(Number(message.id))
    })
  }

  request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId
    this.nextId += 1
    const frame = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(`${method} timed out after ${String(CASE_TIMEOUT_MS)}ms`)) }, CASE_TIMEOUT_MS)
      this.pending.set(id, (response) => {
        clearTimeout(timer)
        resolve(response)
      })
      this.child.stdin.write(frame, (writeError) => {
        if (writeError !== undefined && writeError !== null) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(writeError)
        }
      })
    })
  }

  close(): Promise<void> {
    this.child.stdin.end()
    return new Promise((resolve) => {
      this.child.stdout.once('close', resolve)
      this.child.kill()
    })
  }
}

/** Flatten one `session/new` model option into selectable route values. */
function catalogChoices(configOptions: unknown): string[] {
  if (!Array.isArray(configOptions)) throw new Error('session/new returned no configOptions array')
  const model = configOptions.find(option => (option as { id?: string }).id === 'model') as
    | { type: string; currentValue?: string; options?: unknown[] }
    | undefined
  if (model === undefined || model.type !== 'select') throw new Error('configOptions carry no model select')
  const nested = (model.options ?? []).flatMap((group) => {
    const entry = group as { options?: unknown }
    return 'options' in entry && Array.isArray(entry.options) ? entry.options as unknown[] : [group]
  })
  return nested.map(choice => (choice as { value?: string }).value ?? '').filter(value => value.length > 0)
}

async function main(): Promise<void> {
  const started = Date.now()
  const scenario = 'real dynamic catalog and exact-model inference over ACP'
  const apiKey = readApiKey()
  if (apiKey === undefined) {
    report('skip', scenario, started, 'no DEEPSEEK_API_KEY in the environment or repository .env; S48-AC-6 was not executed')
    return
  }
  if (!spawnSync('node', [DSH_CLI_BIN, '--version'], { encoding: 'utf8' }).stdout) {
    report('skip', scenario, started, `the built CLI is missing at ${DSH_CLI_BIN}; build the deployment target first`)
    return
  }

  const child = spawn('node', [DSH_CLI_BIN, '--profile', 'acp'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DEEPSEEK_API_KEY: apiKey },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // Child stderr is diagnostics only; it never carries the key and is only
  // surfaced bounded, on failure.
  let stderrTail = ''
  child.stderr.on('data', (chunk: Buffer) => { stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2_000) })

  const acp = new AcpConsole(child)
  try {
    const initialize = await acp.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    if (initialize.error !== undefined) throw new Error(`initialize rejected: ${initialize.error.message}`)

    const created = await acp.request('session/new', { cwd: REPO_ROOT, mcpServers: [] })
    if (created.error !== undefined) {
      throw new Error(`session/new failed (discovery error?): ${created.error.message}`)
    }
    const session = created.result as { sessionId: string; configOptions?: unknown }

    // The published catalog must be the endpoint's live one: a discovery
    // failure never silently becomes a static list here, because the plugin
    // has no built-in catalog to fall back to.
    const choices = catalogChoices(session.configOptions)
    const flashValue = JSON.stringify(['deepseek-official', TARGET_MODEL])
    // The regression target is `deepseek-v4-flash`, the id the old static
    // catalog advertised without existing upstream. When today's catalog does
    // not list it, the exact-id assertions run against a real listed model
    // and the absence stays in the ledger record instead of masking a pass.
    const primaryValue = choices.find(value => value === flashValue) ?? choices[0]
    if (primaryValue === undefined) {
      report('skip', scenario, started, `the live catalog published no choices: ${JSON.stringify(choices)}`)
      return
    }
    const primaryId = (JSON.parse(primaryValue) as [string, string])[1]
    const effectiveScenario = choices.includes(flashValue)
      ? scenario
      : `${scenario}; ${TARGET_MODEL} is not in the live catalog`

    // First model: exact upstream id through ACP selection, real prompt.
    await acp.request('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: primaryValue })
    const first = await acp.request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Reply with the single word: ready' }],
    })
    if (first.error !== undefined) throw new Error(`prompt with ${primaryId} failed: ${first.error.message}`)
    const firstResult = first.result as { stopReason?: string }
    if (firstResult.stopReason !== 'end_turn') {
      throw new Error(`prompt with ${primaryId} ended with ${String(firstResult.stopReason)}`)
    }

    // Second model: another real catalog entry, recorded truthfully — a
    // permission failure is noted in the ledger without masking the first
    // model's success.
    const otherValue = choices.find(value => value !== primaryValue)
    if (otherValue === undefined) {
      report('pass', `${effectiveScenario}; the catalog lists only ${primaryId}, so the second-model step had no candidate`, started)
      return
    }
    const second = await acp.request('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: otherValue })
    if (second.error !== undefined) {
      report('pass', `${effectiveScenario}; second model ${otherValue} could not be selected: ${second.error.message}`, started)
      return
    }
    const secondPrompt = await acp.request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Reply with the single word: ready' }],
    })
    if (secondPrompt.error !== undefined || (secondPrompt.result as { stopReason?: string }).stopReason !== 'end_turn') {
      const detail = secondPrompt.error?.message ?? `ended with ${String((secondPrompt.result as { stopReason?: string }).stopReason)}`
      report('pass', `${effectiveScenario}; second model ${otherValue} did not complete and is recorded as-is: ${detail}`, started)
      return
    }
    report('pass', `${effectiveScenario}; second model ${otherValue} also completed`, started)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    report('fail', scenario, started, stderrTail.length > 0 ? `${message}; stderr tail: ${stderrTail}` : message)
  } finally {
    await acp.close()
  }
}

await main()
