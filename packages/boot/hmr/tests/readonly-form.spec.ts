/** The cluster read-only configuration form: HMR fails closed, the default form is untouched. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import Hmr from '../src/index.ts'
import { reportResult } from './helpers/reporter.ts'

/** Mount the HMR plugin with the given environment and report the failure, if any. */
function mount(readonly: string | undefined): Error | undefined {
  const previous = process.env.DSH_CONFIG_READONLY
  if (readonly === undefined) delete process.env.DSH_CONFIG_READONLY
  else process.env.DSH_CONFIG_READONLY = readonly
  try {
    const ctx = new Context()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-readonly-'))
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.DSH_CONFIG_READONLY
      else process.env.DSH_CONFIG_READONLY = previous
    })
    // Construct directly: the fail-closed check is in the constructor.
    new Hmr(ctx, { root: [] })
    onTestFinished(() => ctx.fiber.dispose())
    return undefined
  } catch (error: unknown) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

it('UT-S42-04: DSH_CONFIG_READONLY=1 fails HMR load closed', () => {
  const failure = mount('1')
  expect(failure).toBeInstanceOf(Error)
  expect(failure?.message).toContain('DSH_CONFIG_READONLY=1')
  reportResult('UT-S42-04', 'pass')
})

it('UT-S42-05: without the variable the readonly gate does not fire', () => {
  const failure = mount(undefined)
  // A bare test context has no loader, so construction proceeds past the
  // readonly gate and fails touching the missing loader instead — proof the
  // DSH_CONFIG_READONLY check passed and the default form is untouched.
  expect(failure?.message).not.toContain('DSH_CONFIG_READONLY')
  reportResult('UT-S42-05', 'pass')
})
