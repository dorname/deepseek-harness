/**
 * Composition helpers shared by the cluster-web bundle suites: they read each
 * layer's patch list the way the profile composer does and compose the ordered
 * bundle stack through the production {@link composeEntries} call.
 */

import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { bundlePatchPaths, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

/** The patch list of one bundle package, read the way the profile composer reads it. */
export function bundleLayer(packageName: string): ReturnType<typeof loadOverlayPatches> {
  const manifestPath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dsh?: { bundle?: { patch: string | string[] } }
  }
  const declared = manifest.dsh?.bundle
  if (declared === undefined) throw new Error(`${packageName} declares no dsh.bundle`)
  return bundlePatchPaths(dirname(manifestPath), declared).flatMap(
    file => loadOverlayPatches('cluster-web-test', file),
  )
}

/**
 * Compose an ordered bundle stack plus one own patch file into the effective
 * entry list.
 * @param bundles - bundle package names in `dsh.profile.bundles` order.
 * @param ownPatch - absolute path of the composing bundle's own patch file.
 * @returns the composed entries.
 */
export function composeStack(bundles: readonly string[], ownPatch: string): EntryOptions[] {
  const layers = [...bundles.map(name => bundleLayer(name)), loadOverlayPatches('cluster-web-test', ownPatch)]
  return composeEntries(layers)
}

/**
 * Find one composed entry by row id.
 * @param entries - composed entries from {@link composeStack}.
 * @param id - the row id to find.
 * @returns the entry.
 * @throws {Error} when the composition does not mount the row.
 */
export function entryById(entries: readonly EntryOptions[], id: string): EntryOptions {
  const entry = entries.find(candidate => candidate.id === id)
  if (entry === undefined) throw new Error(`composed cluster-web tree must mount ${id}`)
  return entry
}
