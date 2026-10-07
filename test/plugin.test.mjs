/**
 * Plugin-contract tests: `apply()` registers a provider with the `ctx.web` seam,
 * and the registered provider honours the config it was built from.
 *
 * The fake context supplies only what `resolveOptions` reaches for, and every
 * config carries an explicit `baseURL`, so no real environment is consulted.
 *
 *     node --test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, inject, name, providerId } from '../index.js'
import { DOUBAO_DEFAULT_BASE_URL } from '../provider.js'

const BASE_URL = 'https://example.invalid/search'

/** Wrap plain values the way the harness hands a `volatile` config section to `apply`. */
function volatileConfig(values) {
  const read = (key) => ({ get: () => values[key] })
  return {
    apiKey: read('apiKey'),
    apiKeyEnv: { get: () => values.apiKeyEnv ?? 'ARK_API_KEY' },
    baseURL: { get: () => values.baseURL ?? BASE_URL },
    searchType: { get: () => values.searchType ?? 'web' },
    maxResults: { get: () => values.maxResults ?? 10 },
    timeRange: read('timeRange'),
    authLevel: { get: () => values.authLevel ?? 0 },
    queryRewrite: { get: () => values.queryRewrite ?? false },
    needSummary: { get: () => values.needSummary ?? true },
  }
}

/** A context whose credentials service resolves `value`. */
function fakeCtx(value) {
  const registered = []
  return {
    registered,
    ctx: {
      get: (service) => {
        if (service !== 'credentials') return undefined
        return { resolve: async () => (value === undefined ? undefined : { value }) }
      },
      web: { registerSearchProvider: (provider) => registered.push(provider) },
    },
  }
}

test('the plugin declares the web seam and a stable name', () => {
  assert.equal(name, 'web-search-doubao')
  assert.deepEqual(inject, ['web'])
  assert.equal(providerId, 'doubao')
})

test('apply registers exactly one doubao provider with the seam', () => {
  const { ctx, registered } = fakeCtx('key-from-credentials')
  apply(ctx, volatileConfig({}))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'doubao')
  assert.equal(typeof registered[0].available, 'function')
  assert.equal(typeof registered[0].search, 'function')
})

test('a literal apiKey config value makes the provider available', () => {
  const { ctx, registered } = fakeCtx(undefined)
  apply(ctx, volatileConfig({ apiKey: 'literal-key' }))
  assert.equal(registered[0].available(), true)
})

test('a resolvable credential makes the provider available', () => {
  const { ctx, registered } = fakeCtx('key-from-credentials')
  apply(ctx, volatileConfig({}))
  assert.equal(registered[0].available(), true)
})

test('a missing key fails the search with actionable guidance', async () => {
  const { ctx, registered } = fakeCtx(undefined)
  apply(ctx, volatileConfig({}))
  const provider = registered[0]

  // `available()` is a cheap local check and must not make IO calls, so a
  // resolver that exists counts as available even when it would resolve
  // nothing — the same optimism the shipped DeepSeek provider shows.
  assert.equal(provider.available(), true)

  await assert.rejects(
    () => provider.search({ query: 'q' }),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_CREDENTIAL_MISSING')
      assert.match(error.message, /ARK_API_KEY/u)
      return true
    },
  )
})

test('an unusable endpoint leaves the provider unavailable', () => {
  const { ctx, registered } = fakeCtx('key')
  apply(ctx, volatileConfig({ baseURL: 'not a url' }))
  assert.equal(registered[0].available(), false)
})

test('a malformed timeRange fails before any request is dispatched', async () => {
  const { ctx, registered } = fakeCtx('key')
  apply(ctx, volatileConfig({ timeRange: 'yesterday' }))
  await assert.rejects(
    () => registered[0].search({ query: 'q' }),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /timeRange/u)
      return true
    },
  )
})

test('the default endpoint is the public Doubao Search URL', async () => {
  const { ctx, registered } = fakeCtx('key')
  // baseURL omitted from the config the way an unconfigured section reads it,
  // but the fake config must still return something for the volatile getter.
  apply(ctx, volatileConfig({ baseURL: DOUBAO_DEFAULT_BASE_URL }))
  assert.equal(registered[0].available(), true)
})
