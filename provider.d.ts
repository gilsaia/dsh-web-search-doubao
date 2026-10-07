/**
 * `DoubaoSearchProvider`: a `WebSearchProvider` backed by the Volcengine Doubao
 * Search API. The wire format and the native `fetch` client are provider-private
 * and do not use `ctx.llm`.
 * @module dsh-web-search-doubao/provider
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export declare const DOUBAO_PROVIDER_ID = 'doubao'

/** Full Doubao Search endpoint. */
export declare const DOUBAO_DEFAULT_BASE_URL = 'https://open.feedcoopapi.com/search_api/web_search'

/** The API's hard cap on `Count` for a web search. */
export declare const DOUBAO_API_MAX_RESULTS = 50

/** Default result count when neither the request nor the config bounds it. */
export declare const DOUBAO_DEFAULT_MAX_RESULTS = 10

/** Search kinds the API accepts. */
export declare const DOUBAO_SEARCH_TYPES: readonly ['web', 'image']

/** One element of `Result.WebResults`, as far as this provider reads it. */
export interface DoubaoWebResult {
  Title?: string
  Url?: string
  SiteName?: string
  Snippet?: string
  Summary?: string
  Content?: string
  PublishTime?: string
  AuthInfoLevel?: number
}

/** The subset of the response envelope this provider reads. */
export interface DoubaoResponseBody {
  ResponseMetadata?: {
    RequestId?: string
    Error?: { CodeN?: number; Code?: string; Message?: string } | null
  }
  Result?: { ResultCount?: number; WebResults?: readonly DoubaoWebResult[] } | null
}

/** Resolved options for one search. */
export interface DoubaoSearchProviderOptions {
  /** Literal key from config, when present. */
  apiKey?: string
  /** Resolver for the configured credential reference. */
  resolveApiKey?: (signal?: AbortSignal) => Promise<string | undefined>
  /** The reference the resolver reads; used in the missing-credential message. */
  apiKeyEnv: string
  /** Fully resolved endpoint. */
  baseURL: string
  searchType?: 'web' | 'image'
  maxResults?: number
  timeRange?: string
  authLevel?: number
  queryRewrite?: boolean
  needSummary?: boolean
}

/**
 * Map one Doubao web result to a normalized source; `undefined` when the entry
 * carries no URL and therefore cannot be cited.
 */
export declare function mapDoubaoResult(item: DoubaoWebResult): WebSearchSource | undefined

/** Map a `Result` object to a normalized search result with deduped sources. */
export declare function mapDoubaoResponse(response: DoubaoResponseBody['Result']): WebSearchResult

/** Read the API's HTTP-200 error envelope, when present. */
export declare function readApiError(
  body: DoubaoResponseBody,
): { code: string; message: string } | undefined

/** Build the request body for one search. */
export declare function buildRequestBody(
  request: WebSearchRequest,
  options: DoubaoSearchProviderOptions,
): Record<string, unknown>

/** The Doubao-backed search provider. */
export declare class DoubaoSearchProvider implements WebSearchProvider {
  readonly id: string
  constructor(resolveOptions: () => DoubaoSearchProviderOptions)
  available(): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}
