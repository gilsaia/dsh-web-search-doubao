/**
 * Register a Doubao Search-backed provider in `ctx.web`. It calls the
 * Volcengine Doubao Search API directly and maps its structured web results onto
 * the seam's portable citation shape, so `web_search` returns a real excerpt per
 * source rather than a title and URL alone.
 *
 * The plugin requires a Volcengine API key: either the literal `apiKey` config
 * value, or a credential resolved under the name `apiKeyEnv` names.
 *
 * @module dsh-web-search-doubao
 */
import type { Volatile } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

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
export declare const name = 'web-search-doubao'

/** The web seam this provider registers into. */
export declare const inject: string[]

/** Plugin config (all fields optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal API key; prefer {@link Config.apiKeyEnv} so no secret enters configuration files. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each search; defaults to `ARK_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** Full search endpoint; defaults to the public Doubao Search URL. */
  baseURL: Volatile<string | undefined>
  /** `web` returns pages; `image` returns images. */
  searchType: Volatile<'web' | 'image'>
  /** Result count when a request carries no bound; the API caps it at 50. */
  maxResults: Volatile<number>
  /** `OneDay` / `OneWeek` / `OneMonth` / `OneYear`, or `YYYY-MM-DD..YYYY-MM-DD`. */
  timeRange: Volatile<string | undefined>
  /** `0` all sources, `1` authoritative sources only. Web searches only. */
  authLevel: Volatile<number>
  /** Let the service rewrite a conversational query into a search-shaped one. */
  queryRewrite: Volatile<boolean>
  /** Request the per-result excerpt this provider surfaces as `snippet`. */
  needSummary: Volatile<boolean>
}

export declare const Config: z<
  Schemastery.ObjectS<
    NoInfer<{
      apiKey: z<string, string, 'volatile'>
      apiKeyEnv: z<string, string, 'volatile-defined'>
      baseURL: z<string, string, 'volatile'>
      searchType: z<'web' | 'image', 'web' | 'image', 'volatile-defined'>
      maxResults: z<number, number, 'volatile-defined'>
      timeRange: z<string, string, 'volatile'>
      authLevel: z<number, number, 'volatile-defined'>
      queryRewrite: z<boolean, boolean, 'volatile-defined'>
      needSummary: z<boolean, boolean, 'volatile-defined'>
    }>
  >,
  Schemastery.ObjectT<
    NoInfer<{
      apiKey: z<string, string, 'volatile'>
      apiKeyEnv: z<string, string, 'volatile-defined'>
      baseURL: z<string, string, 'volatile'>
      searchType: z<'web' | 'image', 'web' | 'image', 'volatile-defined'>
      maxResults: z<number, number, 'volatile-defined'>
      timeRange: z<string, string, 'volatile'>
      authLevel: z<number, number, 'volatile-defined'>
      queryRewrite: z<boolean, boolean, 'volatile-defined'>
      needSummary: z<boolean, boolean, 'volatile-defined'>
    }>
  >,
  'plain'
>

/** The provider id this plugin registers; the seam's `searchProvider` selects it. */
export declare const providerId: string

/** Register the Doubao Search provider with `ctx.web`. */
export declare function apply(ctx: Context, config: Config): void
