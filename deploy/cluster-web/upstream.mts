/**
 * Path → upstream selection for cluster-web edge (UT-S46-03).
 * @module
 */

export interface UpstreamTarget {
  host: string
  port: number
}

/**
 * Parse a `host:port` entry.
 * @param entry - raw host:port string.
 * @returns parsed target.
 */
export function parseHostPort(entry: string): UpstreamTarget {
  const [host, portText] = entry.split(':')
  return { host: host ?? '127.0.0.1', port: Number(portText) }
}

/**
 * Choose upstream by URL path.
 * @param urlPath - request URL path (may include query).
 * @param staticUpstream - shell / frontend upstream.
 * @param apiUpstreams - API replica pool.
 * @param nextApiIndex - mutable round-robin cursor (mutated on `/api` hits).
 * @returns selected target.
 */
export function pickUpstream(
  urlPath: string,
  staticUpstream: UpstreamTarget,
  apiUpstreams: readonly UpstreamTarget[],
  nextApiIndex: { value: number },
): UpstreamTarget {
  if (apiUpstreams.length === 0) {
    throw new Error('cluster-web-edge: API upstream pool is empty')
  }
  const pathOnly = urlPath.split('?', 1)[0] ?? '/'
  if (pathOnly === '/api' || pathOnly.startsWith('/api/')) {
    const index = nextApiIndex.value % apiUpstreams.length
    nextApiIndex.value += 1
    return apiUpstreams[index]!
  }
  return staticUpstream
}
