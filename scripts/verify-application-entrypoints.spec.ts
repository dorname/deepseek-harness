/** Application-entrypoint classification and dsh-launch enforcement. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applicationEntrypointViolations, DEPLOY_ENTRY_CLASSIFICATIONS } from './verify-application-entrypoints.ts'

const cleanups: string[] = []

afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-application-entrypoints-'))
  cleanups.push(root)
  return root
}

function write(root: string, path: string, content: string): void {
  const target = resolve(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

describe('application entrypoints', () => {
  it('accepts the repository launcher inventory', () => {
    expect(applicationEntrypointViolations(resolve(import.meta.dirname, '..'))).toEqual([])
  })

  it('rejects a package-level application bin', () => {
    const root = fixture()
    write(root, 'packages/example/app/package.json', JSON.stringify({ bin: { app: 'lib/bin.js' } }))

    expect(applicationEntrypointViolations(root)).toEqual([
      'packages/example/app/package.json: package bin bypasses the dsh launcher; applications use apps/cli profiles',
    ])
  })

  it('rejects an unclassified executable source', () => {
    const root = fixture()
    write(root, 'packages/example/app/src/bin.ts', '#!/usr/bin/env node\n')

    expect(applicationEntrypointViolations(root)).toEqual([
      'packages/example/app/src/bin.ts: executable source has no application/build/test classification',
    ])
  })

  it('rejects an executable at an application package root', () => {
    const root = fixture()
    write(root, 'apps/example/rogue.mjs', '#!/usr/bin/env node\n')

    expect(applicationEntrypointViolations(root)).toEqual([
      'apps/example/rogue.mjs: executable source has no application/build/test classification',
    ])
  })

  it('rejects an executable at the repository root', () => {
    const root = fixture()
    write(root, 'rogue.mjs', '#!/usr/bin/env node\n')

    expect(applicationEntrypointViolations(root)).toEqual([
      'rogue.mjs: executable source has no application/build/test classification',
    ])
  })

  it('rejects an unclassified executable in an app workspace', () => {
    const root = fixture()
    write(root, 'apps/rogue/src/bin.ts', '#!/usr/bin/env node\n')

    expect(applicationEntrypointViolations(root)).toEqual([
      'apps/rogue/src/bin.ts: executable source has no application/build/test classification',
    ])
  })

  it('rejects a packaging dispatcher owned by the CLI workspace', () => {
    const root = fixture()
    write(root, 'apps/cli/src/runtime-bootstrap.ts', '#!/usr/bin/env node\n')

    expect(applicationEntrypointViolations(root)).toEqual([
      'apps/cli/src/runtime-bootstrap.ts: executable source has no application/build/test classification',
    ])
  })

  it('rejects a private Python application carrier outside dsh', () => {
    const root = fixture()
    write(root, 'packages/sdk/rogue-python-runtime/package.json', JSON.stringify({ private: true }))
    write(root, 'packages/sdk/rogue-python-runtime/src/bin.ts', '#!/usr/bin/env node\n')

    expect(applicationEntrypointViolations(root)).toEqual([
      'packages/sdk/rogue-python-runtime/src/bin.ts: executable source has no application/build/test classification',
    ])
  })

  it('rejects a classified demo wrapper that launches a package entry', () => {
    const root = fixture()
    write(root, 'package.json', JSON.stringify({ scripts: { 'demo:ptc': 'node scripts/demo-ptc.mjs' } }))
    write(root, 'scripts/demo-ptc.mjs', "spawn('node', ['packages/example/app/src/bin.ts'])\n")

    expect(applicationEntrypointViolations(root)).toEqual([
      'scripts/demo-ptc.mjs: application launcher wrapper must launch apps/cli/src/bin.ts',
      'scripts/demo-ptc.mjs: application launcher wrapper must not launch a package entry directly',
    ])
  })

  it('rejects a start:web script that bypasses the dsh launcher', () => {
    const root = fixture()
    write(root, 'package.json', JSON.stringify({ scripts: { 'start:web': 'node packages/example/app/src/bin.ts web' } }))

    expect(applicationEntrypointViolations(root)).toEqual([
      'package.json scripts.start:web: application launcher script must launch apps/cli/src/bin.ts',
      'package.json scripts.start:web: application launcher script must not launch a package entry directly',
    ])
  })

  it('rejects a dev:web wrapper that serves without the dsh launcher', () => {
    const root = fixture()
    write(root, 'package.json', JSON.stringify({ scripts: { 'dev:web': 'tsx scripts/dev-web.ts --poll' } }))
    write(root, 'scripts/dev-web.ts', "execa('vite', ['build', '--watch'])\n")

    expect(applicationEntrypointViolations(root)).toEqual([
      'scripts/dev-web.ts: application launcher wrapper must launch apps/cli/src/bin.ts',
    ])
  })

  it('rejects a new root demo until its launch role is classified', () => {
    const root = fixture()
    write(root, 'package.json', JSON.stringify({ scripts: { 'demo:new-app': 'dsh --profile new-app' } }))

    expect(applicationEntrypointViolations(root)).toEqual([
      'package.json scripts.demo:new-app: demo launcher has no explicit dsh or in-process classification',
    ])
  })

  it('rejects a deploy entry script without an explicit classification', () => {
    const root = fixture()
    for (const path of DEPLOY_ENTRY_CLASSIFICATIONS.keys()) write(root, path, 'export {}\n')
    write(root, 'deploy/example/server.mts', "import { createServer } from 'node:http'\n")

    expect(applicationEntrypointViolations(root)).toEqual([
      'deploy/example/server.mts: deploy entry script has no explicit classification',
    ])
  })

  it('rejects a classified deploy entry whose file is missing', () => {
    const root = fixture()
    write(root, 'deploy/cluster-web/edge.mts', 'export {}\n')

    // Only the one classified file exists; every other classified path is
    // reported as missing so a renamed entry cannot keep its stale class.
    const violations = applicationEntrypointViolations(root)
    expect(violations).toContain('deploy/cluster-web/forward.mts: classified deploy entry is missing')
    expect(violations).toContain('deploy/cluster-web/supervise.mts: classified deploy entry is missing')
    expect(violations.every(failure => failure.endsWith('classified deploy entry is missing'))).toBe(true)
  })
})
