/**
 * Pure-function tests: mapping, error reading, and request building. No network
 * and no API key required.
 *
 *     node --test test/
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildRequestBody,
  mapDoubaoResponse,
  mapDoubaoResult,
  readApiError,
} from '../provider.js'

test('mapDoubaoResult maps the documented fields', () => {
  const source = mapDoubaoResult({
    Title: '标题',
    Url: 'https://example.com/a',
    SiteName: '示例',
    Summary: '摘要正文',
    PublishTime: '2026-10-07T21:28:00+08:00',
  })
  assert.deepEqual(source, {
    url: 'https://example.com/a',
    title: '标题',
    snippet: '摘要正文',
    publishedAt: '2026-10-07T21:28:00+08:00',
  })
})

test('mapDoubaoResult drops entries that cannot be cited', () => {
  assert.equal(mapDoubaoResult({ Title: 'no url' }), undefined)
  assert.equal(mapDoubaoResult({ Url: '   ' }), undefined)
  assert.equal(mapDoubaoResult({}), undefined)
})

test('mapDoubaoResult prefers the longest available body over the short lead', () => {
  const source = mapDoubaoResult({
    Url: 'https://example.com/a',
    Snippet: '短',
    Summary: '这是一个明显更长的摘要正文',
  })
  assert.equal(source?.snippet, '这是一个明显更长的摘要正文')
})

test('mapDoubaoResult falls back through Summary, Content, Snippet', () => {
  assert.equal(
    mapDoubaoResult({ Url: 'https://e.com/1', Content: '来自 Content' })?.snippet,
    '来自 Content',
  )
  assert.equal(
    mapDoubaoResult({ Url: 'https://e.com/2', Snippet: '来自 Snippet' })?.snippet,
    '来自 Snippet',
  )
})

test('mapDoubaoResult refuses the epoch sentinel as a publication date', () => {
  assert.equal(
    mapDoubaoResult({ Url: 'https://e.com/1', PublishTime: '1970-01-01T08:00:00+08:00' })?.publishedAt,
    undefined,
  )
  assert.equal(
    mapDoubaoResult({ Url: 'https://e.com/2', PublishTime: '2026-10-07T00:00:00+08:00' })?.publishedAt,
    '2026-10-07T00:00:00+08:00',
  )
})

test('mapDoubaoResponse dedupes by url and never claims truncation', () => {
  const result = mapDoubaoResponse({
    ResultCount: 3,
    WebResults: [
      { Url: 'https://e.com/a', Title: 'A' },
      { Url: 'https://e.com/a', Title: 'A again' },
      { Url: 'https://e.com/b', Title: 'B' },
      {},
    ],
  })
  assert.equal(result.truncated, false)
  assert.deepEqual(result.sources.map((source) => source.url), ['https://e.com/a', 'https://e.com/b'])
})

test('mapDoubaoResponse tolerates an empty or absent result', () => {
  assert.deepEqual(mapDoubaoResponse(undefined), { sources: [], truncated: false })
  assert.deepEqual(mapDoubaoResponse({}), { sources: [], truncated: false })
})

test('readApiError is undefined for a successful envelope', () => {
  assert.equal(readApiError({ ResponseMetadata: { RequestId: 'x' } }), undefined)
  assert.equal(readApiError({ ResponseMetadata: { Error: null } }), undefined)
  assert.equal(readApiError({}), undefined)
})

test('readApiError reads the HTTP-200 error envelope', () => {
  assert.deepEqual(
    readApiError({
      ResponseMetadata: { Error: { CodeN: 10403, Code: '10403', Message: 'invalid api key' } },
    }),
    { code: '10403', message: 'invalid api key' },
  )
})

const baseOptions = {
  apiKeyEnv: 'ARK_API_KEY',
  baseURL: 'https://open.feedcoopapi.com/search_api/web_search',
}

test('buildRequestBody sends the documented minimum', () => {
  assert.deepEqual(buildRequestBody({ query: 'q', maxResults: 5 }, { ...baseOptions, searchType: 'web' }), {
    Query: 'q',
    SearchType: 'web',
    NeedSummary: true,
    Count: 5,
  })
})

test('buildRequestBody clamps Count to the API range', () => {
  assert.equal(buildRequestBody({ query: 'q' }, { ...baseOptions, maxResults: 999 }).Count, 50)
  assert.equal(buildRequestBody({ query: 'q' }, { ...baseOptions, maxResults: 0 }).Count, 1)
  assert.equal(buildRequestBody({ query: 'q' }, { ...baseOptions }).Count, undefined)
})

test('buildRequestBody adds web-only controls', () => {
  const body = buildRequestBody(
    { query: 'q' },
    { ...baseOptions, searchType: 'web', authLevel: 1, timeRange: 'OneWeek', queryRewrite: true },
  )
  assert.deepEqual(body.Filter, { AuthInfoLevel: 1 })
  assert.equal(body.TimeRange, 'OneWeek')
  assert.deepEqual(body.QueryControl, { QueryRewrite: true })
})

test('buildRequestBody omits web-only controls for image searches', () => {
  const body = buildRequestBody(
    { query: 'q' },
    { ...baseOptions, searchType: 'image', authLevel: 1, timeRange: 'OneWeek', queryRewrite: true },
  )
  assert.equal(body.Filter, undefined)
  assert.equal(body.TimeRange, undefined)
  assert.equal(body.QueryControl, undefined)
  assert.equal(body.SearchType, 'image')
})

test('buildRequestBody rejects a malformed timeRange', () => {
  assert.throws(
    () => buildRequestBody({ query: 'q' }, { ...baseOptions, searchType: 'web', timeRange: 'last week' }),
    /timeRange/u,
  )
  assert.doesNotThrow(() =>
    buildRequestBody(
      { query: 'q' },
      { ...baseOptions, searchType: 'web', timeRange: '2026-01-01..2026-10-07' },
    ),
  )
})

test('buildRequestBody lets the request bound win over the config bound', () => {
  assert.equal(buildRequestBody({ query: 'q', maxResults: 3 }, { ...baseOptions, maxResults: 20 }).Count, 3)
})
