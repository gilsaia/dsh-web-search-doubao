/**
 * Live smoke test: exercises the real provider against the Doubao Search API.
 *
 * Requires a Volcengine API key in the environment:
 *
 *     ARK_API_KEY=... node test/smoke.mjs ["query"]
 *
 * Asserts the two things this provider exists for: it returns citeable sources,
 * and each source carries a real excerpt (`snippet`) rather than a title alone.
 */
import { DOUBAO_PROVIDER_ID, DoubaoSearchProvider } from '../provider.js'

const apiKey = process.env.ARK_API_KEY
if (apiKey === undefined || apiKey.length === 0) {
  console.error('smoke: set ARK_API_KEY to a Volcengine API key (an Agent Plan key works).')
  process.exit(2)
}

const baseURL = process.env.DOUBAO_SEARCH_BASE_URL ?? 'https://open.feedcoopapi.com/search_api/web_search'
const query = process.argv[2] ?? 'DeepSeek Harness 是什么'

const provider = new DoubaoSearchProvider(() => ({
  apiKey,
  apiKeyEnv: 'ARK_API_KEY',
  baseURL,
  searchType: 'web',
  maxResults: 5,
  authLevel: 0,
  queryRewrite: false,
  needSummary: true,
}))

console.log(`provider.id        = ${provider.id} (expected ${DOUBAO_PROVIDER_ID})`)
console.log(`provider.available = ${provider.available()}`)

const started = Date.now()
const result = await provider.search({ query, maxResults: 5 })
console.log(`search ok in ${Date.now() - started}ms`)
console.log(`truncated = ${result.truncated}, sources = ${result.sources.length}`)
for (const source of result.sources) {
  console.log(`  - ${JSON.stringify(source).slice(0, 240)}`)
}

const failures = []
if (provider.id !== DOUBAO_PROVIDER_ID) failures.push(`id is ${provider.id}`)
if (!provider.available()) failures.push('provider reports unavailable')
if (result.sources.length === 0) failures.push('no sources returned')
if (!result.sources.every((source) => typeof source.url === 'string' && source.url.length > 0)) {
  failures.push('a source has no url')
}
if (!result.sources.some((source) => typeof source.snippet === 'string' && source.snippet.length > 0)) {
  failures.push('no source carries a snippet')
}
if (result.sources.some((source) => source.publishedAt?.startsWith('1970') === true)) {
  failures.push('a source carries the epoch sentinel as publishedAt')
}

if (failures.length > 0) {
  console.error(`\nsmoke FAILED:\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nsmoke OK')
