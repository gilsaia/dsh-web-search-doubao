/**
 * `dsh-web-search-doubao`: registers a Doubao Search-backed
 * `WebSearchProvider` with the harness's web capability seam (`ctx.web`).
 *
 * A function/namespace plugin, not a service: a search provider does not own the
 * `ctx.web` key — it registers INTO the seam's provider registry. The key is
 * owned by `@deepseek-ai/dsh-web`.
 *
 * The plugin requires a Volcengine API key. Provide it as the `apiKey` config
 * value (a secret, never written to the settings file by the harness's secret
 * handling) or export it under the name `apiKeyEnv` names.
 *
 * @module dsh-web-search-doubao
 */
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  DOUBAO_DEFAULT_BASE_URL,
  DOUBAO_DEFAULT_MAX_RESULTS,
  DOUBAO_PROVIDER_ID,
  DOUBAO_SEARCH_TYPES,
  DoubaoSearchProvider,
} from './provider.js'

export {
  DOUBAO_API_MAX_RESULTS,
  DOUBAO_DEFAULT_BASE_URL,
  DOUBAO_DEFAULT_MAX_RESULTS,
  DOUBAO_PROVIDER_ID,
  DOUBAO_SEARCH_TYPES,
  DoubaoSearchProvider,
  buildRequestBody,
  mapDoubaoResponse,
  mapDoubaoResult,
  readApiError,
} from './provider.js'

/** Cordis plugin name used by loader diagnostics and by the settings namespace. */
export const name = 'web-search-doubao'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Default credential reference; matches the name the Volcengine docs suggest for an Ark key. */
const DEFAULT_API_KEY_ENV = 'ARK_API_KEY'

/** Environment variable overriding the endpoint. */
const BASE_URL_ENV = 'DOUBAO_SEARCH_BASE_URL'

/**
 * Plugin config. Every field is `volatile`, so one search reads one coherent
 * snapshot and a settings change lands on the next search rather than requiring
 * a re-registration.
 */
export const Config = z.object({
  /** Literal API key. Prefer {@link Config.apiKeyEnv} so no secret enters a config file. */
  apiKey: z.string().role('secret').volatile(),
  /** Credential reference resolved for each search; defaults to `ARK_API_KEY`. */
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  /** Full search endpoint; defaults to the public Doubao Search URL. */
  baseURL: z.string().volatile(),
  /** `web` returns pages; `image` returns images. */
  searchType: z.union(DOUBAO_SEARCH_TYPES).default('web').volatile(),
  /** Result count when a request carries no bound; the API caps it at 50. */
  maxResults: z.number().step(1).min(1).max(50).default(DOUBAO_DEFAULT_MAX_RESULTS).volatile(),
  /** `OneDay` / `OneWeek` / `OneMonth` / `OneYear`, or `YYYY-MM-DD..YYYY-MM-DD`. */
  timeRange: z.string().volatile(),
  /** `0` all sources, `1` authoritative sources only. Web searches only. */
  authLevel: z.number().step(1).min(0).max(2).default(0).volatile(),
  /** Let the service rewrite a conversational query into a search-shaped one. */
  queryRewrite: z.boolean().default(false).volatile(),
  /** Request the per-result excerpt this provider surfaces as `snippet`. */
  needSummary: z.boolean().default(true).volatile(),
})

/**
 * Project one resolved settings section into the options the provider serves its
 * next search with. Environment fallbacks live here rather than in the provider,
 * so every value the provider reads is already fully defaulted.
 *
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative settings section.
 * @returns options for one search.
 */
function resolveOptions(ctx, config) {
  const apiKeyEnv = credentialRef(config.apiKeyEnv)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined

  return {
    ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(apiKeyEnv)
        if (resolved !== undefined && resolved.value.length > 0) return resolved.value
      }
      // Without the credentials seam the launch environment is the whole plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL:
      config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? DOUBAO_DEFAULT_BASE_URL,
    searchType: config.searchType,
    maxResults: config.maxResults,
    ...(config.timeRange !== undefined && config.timeRange.length > 0
      ? { timeRange: config.timeRange }
      : {}),
    authLevel: config.authLevel,
    queryRewrite: config.queryRewrite,
    needSummary: config.needSummary,
  }
}

/** Register the Doubao Search provider with `ctx.web`. */
export function apply(ctx, config) {
  ctx.web.registerSearchProvider(
    new DoubaoSearchProvider(() =>
      resolveOptions(ctx, {
        apiKey: config.apiKey.get(),
        apiKeyEnv: config.apiKeyEnv.get(),
        baseURL: config.baseURL.get(),
        searchType: config.searchType.get(),
        maxResults: config.maxResults.get(),
        timeRange: config.timeRange.get(),
        authLevel: config.authLevel.get(),
        queryRewrite: config.queryRewrite.get(),
        needSummary: config.needSummary.get(),
      }),
    ),
  )
}

/** The provider id this plugin registers; the seam's `searchProvider` selects it. */
export const providerId = DOUBAO_PROVIDER_ID
