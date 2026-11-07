/** S52: session/compact over the shipped acp profile — real model, real persistence. */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type AcpTestCompactionResult,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, it } from 'vitest'

/**
 * End-to-end over the shipped `acp` profile: the client-called explicit
 * compaction round-trips statistics and summary blocks, records the
 * bridge-minted initiator on the durable triple, and a later process resumes
 * through the compaction-bearing log. Key-gated; the durable log is read
 * through a plaintext persistence root owned by the test.
 */

const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
}

/**
 * Owned persistence root with plaintext compression so the test can read the
 * committed log. A defined `DSH_SNAPSHOT` value (never `replay`) selects the
 * profile's `compression: none` branch without changing the booted config path.
 * The danger-full-access mode keeps the deterministic probe tool call
 * approval-free; its only effect is one file write inside the test's own temp
 * workspace.
 */
function compactionEnv(cwd: string): NodeJS.ProcessEnv {
  return {
    DSH_SNAPSHOT: 'e2e',
    DSH_SNAPSHOT_SESSIONS_ROOT: join(cwd, '.sessions'),
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
  }
}

/** One committed durable event parsed from the plaintext log. */
interface CommittedEvent {
  type: string
  data: Record<string, unknown>
}

/** Parse every committed durable event under the owned sessions root. */
async function committedEvents(root: string): Promise<CommittedEvent[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const events: CommittedEvent[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const text = await readFile(join(entry.parentPath, entry.name), 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      events.push(JSON.parse(line) as CommittedEvent)
    }
  }
  return events
}

/** Two prose turns long enough to leave the engine a compactible range. */
const PROSE_PROMPTS = [
  'In plain prose (no lists), write about 150 words on how a lighthouse fresnel lens concentrates light into a horizontal beam.',
  'Now write about 150 words of plain prose on how a tidal power station converts rising and falling water levels into electricity.',
] as const

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('acp e2e: session/compact over the shipped profile (S52)', () => {
  it('maps the engine result onto the response and records the bridge-minted initiator (UT-S52-02)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-compact-'))
    let agent: LaunchedAcpTestAgent | undefined
    try {
      agent = launchAcpTestAgent({ agent: AGENT, cwd, env: compactionEnv(cwd) })
      await agent.spawned
      await agent.client.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { session: { compaction: {} } },
      })
      const { sessionId } = await agent.client.newSession({ cwd, mcpServers: [] })
      await expect(agent.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text: PROSE_PROMPTS[0] }],
      })).resolves.toMatchObject({ stopReason: 'end_turn' })

      const response = await agent.client.compact({ sessionId })
      const result: AcpTestCompactionResult | null = response.result
      expect(result).not.toBeNull()
      expect(typeof result!.compactionId).toBe('string')
      expect(typeof result!.summarySeq).toBe('number')
      expect(result!.shadowedCount).toBeGreaterThan(0)
      expect(result!.shadowedTokenCount).toBeGreaterThan(0)
      expect(result!.summary.length).toBeGreaterThan(0)
      expect(result!.summary[0]).toMatchObject({ type: 'text' })

      const events = await committedEvents(join(cwd, '.sessions'))
      const start = events.find(event => event.type === 'compaction/start')
      expect(start).toBeDefined()
      expect(String(start!.data.sourceCommandId)).toMatch(/^acp-/)
      expect(events.some(event => event.type === 'compaction/summary')).toBe(true)
      expect(events.some(event => event.type === 'compaction/end' && event.data.error === undefined)).toBe(true)
      expect(events.some(event => event.type === 'compaction/start' && event.data.compactionId === result!.compactionId)).toBe(true)
    } finally {
      await agent?.close()
      await rm(cwd, { recursive: true, force: true })
    }
  }, 240_000)

  it('drives the declared-client chain: notifications, busy, fresh null, unknown session, resume (ST-S52-01)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-compact-chain-'))
    let first: LaunchedAcpTestAgent | undefined
    let second: LaunchedAcpTestAgent | undefined
    try {
      first = launchAcpTestAgent({ agent: AGENT, cwd, env: compactionEnv(cwd) })
      await first.spawned
      await first.client.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { session: { compaction: {} } },
      })
      const { sessionId } = await first.client.newSession({ cwd, mcpServers: [] })

      // Unknown session and fresh history fail and no-op before any turn.
      await expect(first.client.compact({ sessionId: 'unknown-id' })).rejects.toMatchObject({ code: -32602 })
      await expect(first.client.compact({ sessionId })).resolves.toEqual({ result: null })

      await expect(first.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text: PROSE_PROMPTS[0] }],
      })).resolves.toMatchObject({ stopReason: 'end_turn' })
      await expect(first.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text: PROSE_PROMPTS[1] }],
      })).resolves.toMatchObject({ stopReason: 'end_turn' })

      // Explicit compaction succeeds and the ordered notification pair arrives.
      const inProgress = first.waitForUpdate(
        update => update.sessionUpdate === 'compaction_update' && update.status === 'in_progress',
      )
      const completed = first.waitForUpdate(
        update => update.sessionUpdate === 'compaction_update' && update.status === 'completed',
      )
      const response = await first.client.compact({ sessionId })
      const result: AcpTestCompactionResult | null = response.result
      expect(result).not.toBeNull()
      expect(await inProgress).toMatchObject({ status: 'in_progress', compactionId: result!.compactionId })
      const terminal = await completed
      expect(terminal).toMatchObject({ status: 'completed', compactionId: result!.compactionId })
      expect('summary' in terminal ? terminal.summary?.length : 0).toBeGreaterThan(0)

      // An active turn keeps the agent non-idle. The assistant message chunk
      // commits only at turn end, so the deterministic mid-turn anchor is a
      // real tool call: after its result commits, the loop is streaming the
      // final model segment, where the compaction classifies busy.
      const toolDone = first.waitForUpdate(
        update => update.sessionUpdate === 'tool_call_update' && update.status === 'completed',
      )
      const longTurn = first.client.prompt({
        sessionId,
        prompt: [{
          type: 'text',
          text: 'Use the bash tool to write the exact text BUSY_PROBE into a file named busy.txt in the current directory. Then, in plain prose (no lists), write about 200 words on the history of telegraph repeaters.',
        }],
      })
      await toolDone
      await expect(first.client.compact({ sessionId })).rejects.toMatchObject({ code: -32603, data: { code: 'busy' } })
      await first.client.cancel({ sessionId })
      await expect(longTurn).resolves.toMatchObject({ stopReason: 'cancelled' })
      const probe = await readFile(join(cwd, 'busy.txt'), 'utf8')
      expect(probe).toContain('BUSY_PROBE')

      // A later process reconstructs through the compaction-bearing log and keeps serving turns.
      await first.client.closeSession({ sessionId })
      await first.close()
      first = undefined
      second = launchAcpTestAgent({ agent: AGENT, cwd, env: compactionEnv(cwd) })
      await second.spawned
      await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      await second.client.resumeSession({ sessionId, cwd, mcpServers: [] })
      await expect(second.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'Reply with the single word ACK.' }],
      })).resolves.toMatchObject({ stopReason: 'end_turn' })
    } finally {
      await Promise.allSettled([first?.close(), second?.close()].filter((value): value is Promise<void> => value !== undefined))
      await rm(cwd, { recursive: true, force: true })
    }
  }, 300_000)
})
