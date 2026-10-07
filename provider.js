/**
 * `DoubaoSearchProvider`: a `WebSearchProvider` backed by the Volcengine Doubao
 * Search API (`POST /search_api/web_search` with `Authorization: Bearer`).
 *
 * It maps the API's structured web results onto the seam's portable citation
 * shape — `Url` → `url`, `Title` → `title`, the result body → `snippet`, and
 * `PublishTime` → `publishedAt`. That body is the reason this provider exists
 * next to the model-side `web_search` tool: the tool route returns title and
 * URL only, while this API returns a real excerpt per source.
 *
 * The wire format and the native `fetch` client are provider-private and do not
 * use `ctx.llm`.
 *
 * @module dsh-web-search-doubao/provider
 */
import { WebError } from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under; the seam selects it by this string. */
export const DOUBAO_PROVIDER_ID = 'doubao'

/**
 * Doubao Search endpoint. It is a single fixed URL, not a base that a path is
 * appended to, so `baseURL` config carries the whole thing.
 */
export const DOUBAO_DEFAULT_BASE_URL = 'https://open.feedcoopapi.com/search_api/web_search'

/** The API's hard cap on `Count` for a web search. */
export const DOUBAO_API_MAX_RESULTS = 50

/** Default result count when neither the request nor the config bounds it. */
export const DOUBAO_DEFAULT_MAX_RESULTS = 10

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-doubao/0.1.0'

/** Search kinds the API accepts. */
export const DOUBAO_SEARCH_TYPES = ['web', 'image']

/** Time-range shortcuts the API accepts alongside `YYYY-MM-DD..YYYY-MM-DD`. */
const TIME_RANGE_SHORTCUTS = new Set(['OneDay', 'OneWeek', 'OneMonth', 'OneYear'])

/** `YYYY-MM-DD..YYYY-MM-DD`. */
const DATE_RANGE = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/

/**
 * Error codes that mean the credential itself is the problem. The API answers
 * these with HTTP 200, so they have to be read out of the body.
 */
const AUTH_ERROR_CODES = new Set(['10403', '10401', '401', '403'])

/** Error codes that mean the account has no search quota left. */
const QUOTA_ERROR_CODES = new Set(['10406', '10407', '10408', '10412'])

/** Error codes that mean the request was throttled. */
const RATE_LIMIT_ERROR_CODES = new Set(['429', '700429'])

/**
 * Pick the first non-blank string. The API exposes the same body under
 * `Summary` and `Content`, and a shorter lead under `Snippet`; which one is
 * populated depends on the search source, so prefer the longest available.
 */
function firstNonBlank(...values) {
  let best
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length === 0) continue
    if (best === undefined || trimmed.length > best.length) best = trimmed
  }
  return best
}

/**
 * Whether a `PublishTime` is worth surfacing. The API emits an epoch sentinel
 * (`1970-01-01T08:00:00+08:00`) for pages whose crawl time is unknown; carrying
 * that into `publishedAt` would render as "1970" and read as a real date.
 */
function isUsablePublishedAt(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const year = Number.parseInt(value.slice(0, 4), 10)
  return Number.isInteger(year) && year > 1970
}

/**
 * Map one Doubao web result to a normalized source. Entries without a URL
 * cannot be cited and are dropped by {@link mapDoubaoResponse}.
 *
 * @param item - one element of `Result.WebResults`.
 * @returns the normalized source, or `undefined` when the entry is unciteable.
 */
export function mapDoubaoResult(item) {
  const url = typeof item?.Url === 'string' ? item.Url.trim() : ''
  if (url.length === 0) return undefined

  const title = typeof item.Title === 'string' ? item.Title.trim() : ''
  const snippet = firstNonBlank(item.Summary, item.Content, item.Snippet)

  return {
    url,
    ...(title.length > 0 ? { title } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(isUsablePublishedAt(item.PublishTime) ? { publishedAt: item.PublishTime } : {}),
  }
}

/**
 * Map a Doubao Search response envelope to a normalized search result.
 *
 * The API returns no generated answer for a plain web search (`Choices` is
 * null), so `content` stays absent — the seam documents it as optional, and
 * inventing one would make the result lie. The web service owns the final
 * `maxResults` truncation, so `truncated` is always `false` here.
 *
 * @param response - the parsed `Result` object.
 * @returns the normalized result with deduped sources.
 */
export function mapDoubaoResponse(response) {
  const seen = new Set()
  const sources = []
  for (const item of response?.WebResults ?? []) {
    const source = mapDoubaoResult(item)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  return { sources, truncated: false }
}

/**
 * Read the API's error envelope. The service answers failures with HTTP 200 and
 * an `Error` object under `ResponseMetadata`, so `response.ok` alone is not
 * enough to call a search successful.
 *
 * @param body - the parsed response body.
 * @returns the error code and message, or `undefined` when there is none.
 */
export function readApiError(body) {
  const error = body?.ResponseMetadata?.Error
  if (error === null || error === undefined) return undefined
  const code = error.CodeN !== undefined ? String(error.CodeN) : String(error.Code ?? '')
  const message = typeof error.Message === 'string' && error.Message.length > 0
    ? error.Message
    : 'Doubao Search returned an unspecified error'
  return { code, message }
}

/** Turn one API error into a `WebError` that tells the user what to change. */
function apiError(code, message) {
  if (AUTH_ERROR_CODES.has(code)) {
    return new WebError(
      `Doubao Search rejected the credential (${code}: ${message}).\n\n` +
        'The search API authenticates with a Volcengine API key. Set it in this plugin\'s ' +
        '"apiKey" config, or export it under the name this plugin\'s "apiKeyEnv" names ' +
        '(default ARK_API_KEY). An Agent Plan key works here and draws on the plan\'s AFP ' +
        'quota; an API key from another Volcengine product does not.',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
  if (QUOTA_ERROR_CODES.has(code)) {
    return new WebError(
      `Doubao Search has no quota left (${code}: ${message}).\n\n` +
        'Top up the account, or confirm the plan\'s search allowance is still enabled in the ' +
        'Volcengine console.',
      'WEB_PROVIDER_ERROR',
    )
  }
  if (RATE_LIMIT_ERROR_CODES.has(code)) {
    return new WebError(
      `Doubao Search throttled the request (${code}: ${message}). Retry after a short pause.`,
      'WEB_PROVIDER_ERROR',
    )
  }
  return new WebError(`Doubao Search error (${code}: ${message})`, 'WEB_PROVIDER_ERROR')
}

/** Clamp a result count to the API's accepted range. */
function clampCount(value) {
  if (value === undefined) return undefined
  return Math.max(1, Math.min(DOUBAO_API_MAX_RESULTS, Math.trunc(value)))
}

/**
 * Validate `timeRange` and return it unchanged.
 *
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when the value is not a
 *   shortcut or a well-formed `YYYY-MM-DD..YYYY-MM-DD` range.
 */
function resolveTimeRange(value) {
  if (value === undefined || value.length === 0) return undefined
  if (TIME_RANGE_SHORTCUTS.has(value)) return value
  if (!DATE_RANGE.test(value)) {
    throw new WebError(
      `Doubao Search "timeRange" must be OneDay, OneWeek, OneMonth, OneYear, or ` +
        `YYYY-MM-DD..YYYY-MM-DD; received ${JSON.stringify(value)}.`,
      'WEB_PROVIDER_ERROR',
    )
  }
  return value
}

/**
 * Build the request body. `NeedSummary` is what makes the API return the
 * excerpt this provider surfaces as `snippet`, so it defaults on.
 */
export function buildRequestBody(request, options) {
  const searchType = options.searchType ?? 'web'
  const count = clampCount(request.maxResults ?? options.maxResults)
  const body = {
    Query: request.query,
    SearchType: searchType,
    NeedSummary: options.needSummary ?? true,
  }
  if (count !== undefined) body.Count = count

  if (searchType === 'web') {
    if (options.authLevel !== undefined && options.authLevel > 0) {
      body.Filter = { AuthInfoLevel: options.authLevel }
    }
    const timeRange = resolveTimeRange(options.timeRange)
    if (timeRange !== undefined) body.TimeRange = timeRange
    if (options.queryRewrite === true) body.QueryControl = { QueryRewrite: true }
  }

  return body
}

/** Abort checks that mirror the seam's cancellation contract. */
function throwIfAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal)
}

function searchAborted(signal, fallback) {
  return new WebError('Doubao Search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * The Doubao-backed search provider. HTTP redirects fail as
 * `WEB_PROVIDER_ERROR`, and a missing credential fails as
 * `WEB_PROVIDER_CREDENTIAL_MISSING` before any request is dispatched.
 */
export class DoubaoSearchProvider {
  id = DOUBAO_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   *   once at each operation's entry so one search never mixes two settings
   *   sections. A thunk because the plugin's settings section can change
   *   between searches.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions
  }

  available() {
    const options = this.resolveOptions()
    return (
      ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined) &&
      URL.canParse(options.baseURL)
    )
  }

  async search(request, signal) {
    const options = this.resolveOptions()
    const apiKey = await this.resolveApiKey(options, signal)
    throwIfAborted(signal)

    const body = buildRequestBody(request, options)
    throwIfAborted(signal)

    let response
    try {
      response = await fetch(options.baseURL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Doubao Search request to ${JSON.stringify(options.baseURL)} failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    throwIfAborted(signal)

    if (!response.ok) {
      let detail = ''
      try {
        detail = `: ${JSON.stringify(await response.json())}`
      } catch {
        // A non-JSON error body carries no extra detail worth reporting.
      }
      throw new WebError(
        `Doubao Search API error (HTTP ${response.status})${detail}`,
        'WEB_PROVIDER_ERROR',
      )
    }

    let parsed
    try {
      parsed = await response.json()
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Doubao Search returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    const failure = readApiError(parsed)
    if (failure !== undefined) throw apiError(failure.code, failure.message)

    return mapDoubaoResponse(parsed.Result)
  }

  /**
   * Resolve one operation's API key without retaining a credential on the
   * provider.
   *
   * @throws {@link WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when neither the
   *   literal config value nor the referenced credential supplies one.
   */
  async resolveApiKey(options, signal) {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey

    const resolved = options.resolveApiKey === undefined
      ? undefined
      : await options.resolveApiKey(signal)
    if (resolved !== undefined && resolved.length > 0) return resolved

    throw new WebError(
      `Doubao Search has no API key for ${JSON.stringify(options.apiKeyEnv)}.\n\n` +
        'Set "apiKey" in this plugin\'s config, or provide the key in the launching ' +
        `environment as ${options.apiKeyEnv}, or store it through the harness credentials ` +
        'service under that name. An Agent Plan key works here and draws on the plan\'s AFP ' +
        'quota.',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}
