# dsh-web-search-doubao

Give DeepSeek Harness's standard **`web_search`** tool a search backend that returns
**real excerpts**, not just titles and links.

This is a **search provider plugin** for the harness's web capability seam (`ctx.web`).
It registers a Doubao Search (Volcengine) backend and points the seam at it, so the
model-facing tool `@deepseek-ai/dsh-tool-web` keeps working unchanged — only the
backend behind it changes.

English | [中文](./README.zh.md)

---

## Why this exists

The harness ships `@deepseek-ai/dsh-web-search-deepseek`, which performs search by
asking a model to call the **server-side `web_search` tool** over an
Anthropic-compatible Messages API. That route works, but the results it can surface
carry only a **title and a URL** — the response has no citation excerpts, so the
normalized `sources[].snippet` is always empty.

The Doubao Search API is a plain search endpoint that returns structured results,
including a per-result body. This plugin maps that body onto `snippet`, so every
source arrives with text the model can actually read and cite:

| | model-side `web_search` tool | this plugin (Doubao Search API) |
|---|---|---|
| `sources[].title` / `.url` | ✅ | ✅ |
| `sources[].snippet` | ❌ always empty | ✅ real excerpt per source |
| `sources[].publishedAt` | sometimes the `1970-01-01` epoch sentinel | real date, sentinel filtered out |
| Cost per search | one extra model turn (thousands of tokens) | one API call, no model tokens |
| Typical latency | 6–14 s | ~0.2–0.6 s |

## Requirements

- DeepSeek Harness `>= 0.2.0-rc.2` (the `ctx.web` seam's provider API).
- Node.js `>= 22`.
- A **Volcengine API key**. An **Agent Plan** key works here and draws on the plan's
  AFP quota — the official Agent Plan docs describe Doubao Search as the plan's search
  service, callable with the plan's dedicated API key. A key from an unrelated
  Volcengine product will authenticate but is not covered by the plan.

The endpoint defaults to `https://open.feedcoopapi.com/search_api/web_search`, which is
the public Doubao Search URL. No configuration is needed to reach it.

## Install

```sh
# straight from this repository
dsh plugin --profile web add github:gilsaia/dsh-web-search-doubao

# or from a local checkout
dsh plugin --profile web add /path/to/dsh-web-search-doubao
```

The package declares `dsh.bundle.patch`, so adding it also adds it to the profile's
bundle list, and its patch selects this provider:

```yaml
- insert:
    - id: web-search-doubao
      name: 'dsh-web-search-doubao'

- id: web
  config:
    searchProvider: doubao
    fetchProvider: http
```

`fetchProvider` is restated because a row patch **replaces** the targeted row's whole
`config`; omitting it would unset the fetch provider and break `web_fetch`.

Restart the harness afterwards (or reload the profile), then run a search.

## Provide the key

The plugin requires a key. It resolves one in this order:

1. the literal **`apiKey`** config value;
2. the credential named by **`apiKeyEnv`** (default `ARK_API_KEY`), read through the
   harness credentials service, falling back to the launching environment.

So either export it:

```sh
export ARK_API_KEY=...        # then start the harness
```

or set it in the plugin's config in the profile's patch layer:

```yaml
- id: web-search-doubao
  config:
    apiKey: '...'             # a secret; prefer apiKeyEnv so no key enters a config file
```

A missing key fails the search with `WEB_PROVIDER_CREDENTIAL_MISSING` and a message
naming the reference that was consulted — it never silently returns zero results.

## Configuration

| Field | Type | Default | Meaning |
|---|---|---|---|
| `apiKey` | string (secret) | — | Literal API key. |
| `apiKeyEnv` | credential ref | `ARK_API_KEY` | Credential reference resolved per search. |
| `baseURL` | string | Doubao Search URL | Full endpoint; override for a proxy or a different region. |
| `searchType` | `web` \| `image` | `web` | `image` returns image results instead of pages. |
| `maxResults` | 1–50 | `10` | Result count when a request carries no bound. |
| `timeRange` | string | — | `OneDay` / `OneWeek` / `OneMonth` / `OneYear`, or `YYYY-MM-DD..YYYY-MM-DD`. |
| `authLevel` | 0–2 | `0` | `1` restricts to authoritative sources. Web searches only. |
| `queryRewrite` | boolean | `false` | Let the service rewrite a conversational query into a search-shaped one. |
| `needSummary` | boolean | `true` | Request the excerpt surfaced as `snippet`. Turning this off empties `snippet`. |

`baseURL` can also be overridden with the `DOUBAO_SEARCH_BASE_URL` environment variable.

Every field is read **per search**, so a settings change applies to the next search
without restarting the harness.

## Reverting

Remove the `- id: web` block from `cordis.patch.yml` (or override it in your own patch
layer, which is applied after every bundle layer) to keep the default provider. The
plugin stays registered and selectable, just unused:

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http
```

## Verify

```sh
# pure-function and plugin-contract tests: no network, no key
npm test

# live check against the real API; asserts sources carry snippets
ARK_API_KEY=... npm run test:live
```

To confirm the composition without booting:

```sh
dsh --profile web --dump-config | grep -A4 'id: web$'
# searchProvider: doubao
# fetchProvider: http
```

## How it works

- `provider.js` — `DoubaoSearchProvider`, the wire format, result mapping, and error
  translation. It uses the native `fetch` client and does **not** go through `ctx.llm`.
- `index.js` — the Cordis plugin: `name`, `inject: ['web']`, the `Config` schema, and
  `apply()`, which registers the provider into the seam.
- `cordis.patch.yml` — the bundle patch that mounts the plugin and selects it.

Two details worth knowing if you fork it:

- The API answers failures with **HTTP 200** and an `Error` object under
  `ResponseMetadata`, so a successful status code is not enough — the body is checked
  too.
- The API emits an epoch sentinel (`1970-01-01T08:00:00+08:00`) for pages whose crawl
  time is unknown. That is filtered out rather than surfaced as a publication date.

## Compatibility

`@deepseek-ai/dsh-*` peer dependencies are declared as open ranges (`>=0.2.0-rc.2`)
rather than pinned, so the plugin keeps working across harness release candidates.
DeepSeek Harness is in developer preview and may change the seam's API; if a future
version does, this plugin needs the same update as any other provider.

## License

MIT
