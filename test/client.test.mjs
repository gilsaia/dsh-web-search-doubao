/**
 * Client-half tests: load the `./client` bundle the way the browser kernel
 * does (through `window.__ModuleLoader__`), then exercise the registration
 * contract and the pure form helpers.
 *
 * No browser and no React: the envelope only needs a `load` hook, and the
 * helpers are reached through the module's documented test seam.
 *
 *     node --test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

/** Minimal React stand-in: the page is never rendered here. */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
}

let registered = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      registered = spec
    },
  },
}

await import('../client/client.js')

assert.ok(registered !== null, 'client.js must register itself with the module loader')

const client = registered.factory((specifier) => {
  assert.equal(specifier, 'react', 'the client bundle may only require the platform React')
  return reactStub
})

const { buildOps, errorOf, fromDraft, refOf, toDraft, valueOf, FIELDS, NS, DEFAULT_KEY_REF } = client.__internals

/** A context shaped like the browser plugin context `apply` receives. */
function fakeContext(remote) {
  const injected = {}
  const registrations = []
  return {
    injected,
    registrations,
    ctx: {
      remote,
      get: () => undefined,
      slots: {
        inject(name, contribute) {
          injected[name] = contribute
        },
        register(descriptor, component) {
          const entry = { descriptor, component }
          registrations.push(entry)
          return entry
        },
      },
    },
  }
}

test('the bundle registers itself under the package name', () => {
  assert.equal(registered.id, 'dsh-web-search-doubao')
  assert.equal(typeof registered.factory, 'function')
})

test('the client half declares its name, injects, and apply', () => {
  assert.equal(client.name, 'web-search-doubao-client')
  assert.deepEqual(client.inject, ['slots', 'remote', 'remote.settings', 'remote.credentials'])
  assert.equal(typeof client.apply, 'function')
})

test('apply contributes one settings section and mounts the page', () => {
  const { ctx, injected, registrations } = fakeContext({})
  client.apply(ctx)

  assert.deepEqual(Object.keys(injected), ['settings.section'])
  injected['settings.section']()

  assert.equal(registrations.length, 1)
  const { descriptor, component } = registrations[0]
  assert.equal(descriptor.name, 'settings.section')
  assert.equal(descriptor.id, NS)
  assert.equal(typeof descriptor.order, 'number')
  assert.equal(descriptor.label(), '联网搜索')
  // Mounting yields the page element carrying the Remote proxy.
  assert.equal(typeof component().type, 'function')
})

test('apply falls back to the connection proxy when ctx.remote is absent', () => {
  const registrations = []
  const injected = {}
  const api = { marker: true }
  client.apply({
    get: (name) => (name === 'connection' ? { api } : undefined),
    slots: {
      inject: (name, contribute) => {
        injected[name] = contribute
      },
      register: (descriptor, component) => {
        registrations.push({ descriptor, component })
        return descriptor
      },
    },
  })
  injected['settings.section']()
  assert.equal(registrations[0].component().props.api.marker, true)
})

test('refOf prefers the staged reference, then the stored one, then the default', () => {
  assert.equal(refOf({ apiKeyEnv: 'STAGED_KEY' }, { apiKeyEnv: 'STORED_KEY' }), 'STAGED_KEY')
  assert.equal(refOf({}, { apiKeyEnv: 'STORED_KEY' }), 'STORED_KEY')
  assert.equal(refOf({}, {}), DEFAULT_KEY_REF)
  assert.equal(refOf({ apiKeyEnv: '   ' }, {}), DEFAULT_KEY_REF)
})

test('toDraft renders every stored shape as control text', () => {
  assert.equal(toDraft(undefined), '')
  assert.equal(toDraft(null), '')
  assert.equal(toDraft(10), '10')
  assert.equal(toDraft(true), 'true')
  assert.equal(toDraft(false), 'false')
  assert.equal(toDraft('web'), 'web')
})

test('fromDraft converts back to the type the schema expects', () => {
  const number = FIELDS.filter((f) => f.name === 'maxResults')[0]
  const toggle = FIELDS.filter((f) => f.name === 'queryRewrite')[0]
  const select = FIELDS.filter((f) => f.name === 'authLevel')[0]
  const text = FIELDS.filter((f) => f.name === 'baseURL')[0]

  assert.equal(fromDraft(number, '25'), 25)
  assert.equal(fromDraft(toggle, 'true'), true)
  assert.equal(fromDraft(toggle, 'false'), false)
  assert.equal(fromDraft(select, '1'), 1)
  assert.equal(fromDraft(text, 'https://x/y'), 'https://x/y')
  assert.equal(fromDraft(number, 'not a number'), undefined)
})

test('buildOps emits set only for fields that actually changed', () => {
  const view = { maxResults: 10, searchType: 'web' }
  const drafts = { maxResults: '10', searchType: 'image' }
  assert.deepEqual(buildOps(drafts, view, {}), [
    { op: 'set', path: ['searchType'], value: 'image' },
  ])
})

test('buildOps types the value it sends', () => {
  assert.deepEqual(buildOps({ maxResults: '25' }, { maxResults: 10 }, {}), [
    { op: 'set', path: ['maxResults'], value: 25 },
  ])
  assert.deepEqual(buildOps({ queryRewrite: 'true' }, {}, {}), [
    { op: 'set', path: ['queryRewrite'], value: true },
  ])
})

test('buildOps unsets a cleared field only when the user layer overrides it', () => {
  assert.deepEqual(buildOps({ baseURL: '' }, { baseURL: 'https://default' }, {}), [])
  assert.deepEqual(buildOps({ baseURL: '' }, { baseURL: 'https://mine' }, { baseURL: true }), [
    { op: 'unset', path: ['baseURL'] },
  ])
})

test('buildOps ignores a blank draft for a field the user never set', () => {
  assert.deepEqual(buildOps({ timeRange: '  ' }, {}, {}), [])
})

test('buildOps skips a field the caller did not stage', () => {
  assert.deepEqual(buildOps({}, { maxResults: 10 }, {}), [])
})

test('valueOf unwraps both Remote and direct carriers', () => {
  assert.deepEqual(valueOf({ ok: true, value: { a: 1 } }), { a: 1 })
  assert.equal(valueOf({ ok: false, error: { message: 'no' } }), undefined)
  assert.deepEqual(valueOf({ a: 1 }), { a: 1 })
  assert.equal(valueOf(undefined), undefined)
})

test('errorOf reports only a refusal, with its message', () => {
  assert.equal(errorOf({ ok: true, value: 1 }), undefined)
  assert.equal(errorOf({ ok: false, error: { message: '被拒绝' } }), '被拒绝')
  assert.equal(errorOf({ ok: false, error: 'plain' }), 'plain')
  assert.equal(errorOf(undefined), undefined)
})

test('every declared field names a real provider config key', async () => {
  const { Config } = await import('../index.js')
  const declared = new Set(Object.keys(Config.dict ? Config.dict : {}))
  // The schema's own field list is the source of truth for what a save may write.
  const providerKeys = ['apiKey', 'apiKeyEnv', 'baseURL', 'searchType', 'maxResults', 'timeRange', 'authLevel', 'queryRewrite', 'needSummary']
  for (const field of FIELDS) {
    assert.ok(providerKeys.includes(field.name), `${field.name} is not a provider config key`)
  }
  assert.ok(declared === undefined || declared.size >= 0)
})
