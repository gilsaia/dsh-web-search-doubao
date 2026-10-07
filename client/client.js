// dsh-web-search-doubao — DSH web client face: the plugin's settings page.
//
// Hand-authored, no build step: this file is the `./client` bundle the host
// serves under /plugins, so it must match the loader's client-bundle envelope
// (window.__ModuleLoader__.load({ id, factory })) and use only the platform
// module table. It needs `react` alone — no UI primitives — because every read
// and write goes through the documented Remote namespaces:
//
//   ctx.remote.settings.describe()                        -> every plugin form
//   ctx.remote.settings.mutate(ns, ops, revision)         -> one fenced write
//   ctx.remote.credentials.describe([ref]) / .set(ref,v)  -> the API key
//
// The key never rides a settings response: the schema declares `apiKey` with
// role('secret'), so the settings domain redacts it and the page only learns
// whether the *referenced* credential is configured.
window.__ModuleLoader__.load({
  id: 'dsh-web-search-doubao',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    /** Settings namespace = this plugin's profile entry id. */
    var NS = 'web-search-doubao'
    /** Credential reference the provider falls back to when `apiKeyEnv` is unset. */
    var DEFAULT_KEY_REF = 'ARK_API_KEY'
    /** Where an Agent Plan key comes from. */
    var KEY_CONSOLE = 'https://console.volcengine.com/search-infinity/api-key'
    /** Default endpoint, mirrored from the host half for the placeholder. */
    var DEFAULT_BASE_URL = 'https://open.feedcoopapi.com/search_api/web_search'

    /**
     * The editable fields, in display order. `kind` picks the control; `type`
     * is the JSON type the schema expects, so a select can still write a number.
     */
    var FIELDS = [
      {
        name: 'apiKeyEnv',
        label: '密钥引用名',
        kind: 'text',
        placeholder: DEFAULT_KEY_REF,
        hint: '插件按这个名字去凭据里取 Key。默认 ' + DEFAULT_KEY_REF + '。',
      },
      {
        name: 'baseURL',
        label: '搜索端点',
        kind: 'text',
        placeholder: DEFAULT_BASE_URL,
        hint: '留空使用豆包搜索的公开地址。',
      },
      {
        name: 'searchType',
        label: '搜索类型',
        kind: 'select',
        type: 'string',
        options: [
          ['web', '网页搜索'],
          ['image', '图片搜索'],
        ],
      },
      {
        name: 'maxResults',
        label: '结果条数',
        kind: 'number',
        type: 'number',
        min: 1,
        max: 50,
        hint: '1–50。工具自身还会再截断一次。',
      },
      {
        name: 'timeRange',
        label: '时间范围',
        kind: 'text',
        placeholder: 'OneDay / OneWeek / OneMonth / OneYear / 2026-01-01..2026-10-07',
        hint: '留空表示不限时间。仅网页搜索生效。',
      },
      {
        name: 'authLevel',
        label: '来源权威度',
        kind: 'select',
        type: 'number',
        options: [
          ['0', '全部来源'],
          ['1', '仅权威来源'],
        ],
        hint: '仅网页搜索生效。',
      },
      {
        name: 'queryRewrite',
        label: 'Query 改写',
        kind: 'toggle',
        type: 'boolean',
        hint: '让服务把口语化长问题改写成搜索式 query。',
      },
      {
        name: 'needSummary',
        label: '返回正文摘要',
        kind: 'toggle',
        type: 'boolean',
        hint: '关掉它搜索结果的 snippet 会变空。',
      },
    ]

    /** Field names in schema order; also the set the save compares against. */
    var FIELD_NAMES = FIELDS.map(function (f) {
      return f.name
    })

    /** The credential reference currently in force, given the staged form. */
    function refOf(drafts, view) {
      var staged = drafts && drafts.apiKeyEnv
      if (typeof staged === 'string' && staged.trim().length > 0) return staged.trim()
      var stored = view && view.apiKeyEnv
      if (typeof stored === 'string' && stored.length > 0) return stored
      return DEFAULT_KEY_REF
    }

    /** Render one stored value as the draft text a control edits. */
    function toDraft(value) {
      if (value === undefined || value === null) return ''
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      return String(value)
    }

    /** Convert draft text back to the JSON type the field's schema expects. */
    function fromDraft(field, text) {
      if (field.type === 'number') {
        var n = Number(text)
        return Number.isFinite(n) ? n : undefined
      }
      if (field.type === 'boolean') return text === 'true'
      return text
    }

    /** Same value in both, treating `undefined` and `''` as one "unset". */
    function sameValue(a, b) {
      var left = a === undefined || a === null ? '' : a
      var right = b === undefined || b === null ? '' : b
      return String(left) === String(right)
    }

    /**
     * Build the ordered path edits one save sends: `set` for a changed field,
     * `unset` for a cleared one that the user layer currently overrides.
     *
     * @param drafts - staged text per field name.
     * @param view - the namespace view the drafts were staged against.
     * @param overridden - field names present in the raw user layer.
     * @returns the edits, in field order; empty when nothing changed.
     */
    function buildOps(drafts, view, overridden) {
      var ops = []
      for (var i = 0; i < FIELDS.length; i++) {
        var field = FIELDS[i]
        var text = drafts[field.name]
        if (text === undefined) continue
        var current = view ? view[field.name] : undefined
        var blank = typeof text === 'string' && text.trim().length === 0
        var isOverridden = overridden !== undefined && overridden[field.name] === true

        if (blank) {
          if (isOverridden) ops.push({ op: 'unset', path: [field.name] })
          continue
        }
        var next = fromDraft(field, text)
        if (next === undefined) continue
        if (sameValue(next, current)) continue
        ops.push({ op: 'set', path: [field.name], value: next })
      }
      return ops
    }

    /** Unwrap a Remote reply, which is `{ ok, value }` or `{ ok: false, error }`. */
    function valueOf(response) {
      if (response === undefined || response === null) return undefined
      if (response.ok === false) return undefined
      if (response.ok === true) return response.value
      // A direct (in-process) carrier may hand back the value unwrapped.
      return response.value !== undefined ? response.value : response
    }

    /** The failure message of a refused Remote reply, when it carries one. */
    function errorOf(response) {
      if (response === undefined || response === null) return undefined
      if (response.ok !== false) return undefined
      var error = response.error
      if (typeof error === 'string') return error
      return error && error.message ? error.message : '请求被拒绝'
    }

    var STYLE = [
      '.dws-root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;',
      'display:flex;flex-direction:column;gap:22px;padding:28px 26px;max-width:620px;',
      'color:var(--dsh-text,#1d1d1f);-webkit-font-smoothing:antialiased;}',
      '.dws-root h2{margin:0;font-size:26px;font-weight:600;letter-spacing:-0.021em;}',
      '.dws-sub{margin:7px 0 0;font-size:13.5px;line-height:1.55;color:var(--dsh-text-secondary,rgba(60,60,67,0.62));}',
      '.dws-group{display:flex;flex-direction:column;gap:8px;}',
      '.dws-label{font-size:14.5px;font-weight:600;display:flex;align-items:center;gap:9px;}',
      '.dws-badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;',
      'background:rgba(52,199,89,0.16);color:#1c8f3c;}',
      '.dws-badge.off{background:rgba(120,120,128,0.16);color:var(--dsh-text-secondary,rgba(60,60,67,0.6));}',
      '.dws-badge.warn{background:rgba(255,149,0,0.18);color:#a55b00;}',
      '.dws-input,.dws-select{width:100%;box-sizing:border-box;padding:10px 12px;font-size:14px;',
      'border-radius:10px;border:1px solid var(--dsh-border,rgba(60,60,67,0.2));',
      'background:var(--dsh-input-bg,#fff);color:inherit;outline:none;transition:border-color .15s,box-shadow .15s;}',
      '.dws-input.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}',
      '.dws-input:focus,.dws-select:focus{border-color:var(--dsh-accent,#0071e3);box-shadow:0 0 0 3.5px rgba(0,113,227,0.18);}',
      '.dws-hint{font-size:12px;color:var(--dsh-text-secondary,rgba(60,60,67,0.62));line-height:1.45;}',
      '.dws-hint a{color:var(--dsh-accent,#0071e3);cursor:pointer;text-decoration:none;font-weight:500;}',
      '.dws-hint a:hover{text-decoration:underline;}',
      '.dws-row{display:flex;align-items:center;gap:9px;font-size:14px;}',
      '.dws-actions{display:flex;align-items:center;gap:12px;}',
      '.dws-btn{padding:9px 20px;font-size:14px;font-weight:600;border-radius:999px;border:none;cursor:pointer;',
      'background:var(--dsh-accent,#0071e3);color:#fff;}',
      '.dws-btn:disabled{opacity:.45;cursor:default;}',
      '.dws-btn.ghost{background:transparent;color:var(--dsh-text-secondary,rgba(60,60,67,0.7));}',
      '.dws-status{font-size:12.5px;font-weight:500;padding:6px 13px;border-radius:999px;',
      'background:rgba(52,199,89,0.16);color:#1c8f3c;}',
      '.dws-status.err{background:rgba(255,59,48,0.15);color:#c1271b;}',
      '.dws-note{font-size:12.5px;line-height:1.5;color:var(--dsh-text-secondary,rgba(60,60,67,0.62));',
      'background:rgba(120,120,128,0.08);border-radius:10px;padding:11px 13px;}',
    ].join('')

    function openUrl(url) {
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch (e) {
        /* a blocked popup is not worth an error state */
      }
    }

    /** The plugin's settings page. */
    function DoubaoSearchPage(props) {
      var api = props.api
      var viewState = React.useState(null)
      var view = viewState[0]
      var setView = viewState[1]
      var userState = React.useState({})
      var user = userState[0]
      var setUser = userState[1]
      var draftsState = React.useState({})
      var drafts = draftsState[0]
      var setDrafts = draftsState[1]
      var keyState = React.useState('')
      var keyDraft = keyState[0]
      var setKeyDraft = keyState[1]
      var credState = React.useState(null)
      var credential = credState[0]
      var setCredential = credState[1]
      var statusState = React.useState(null)
      var status = statusState[0]
      var setStatus = statusState[1]
      var loadState = React.useState('loading')
      var phase = loadState[0]
      var setPhase = loadState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var timer = React.useRef ? React.useRef(0) : { current: 0 }

      function flash(message, isError) {
        setStatus({ msg: message, err: isError === true })
        try {
          clearTimeout(timer.current)
          timer.current = setTimeout(function () {
            setStatus(null)
          }, 3600)
        } catch (e) {}
      }

      function seed(nextView) {
        var seeded = {}
        for (var i = 0; i < FIELD_NAMES.length; i++) {
          var name = FIELD_NAMES[i]
          seeded[name] = toDraft(nextView ? nextView[name] : undefined)
        }
        setDrafts(seeded)
      }

      /** Read the namespace form and the referenced credential's state. */
      function load() {
        if (!api || !api.settings || !api.settings.describe) {
          setPhase('unavailable')
          return
        }
        Promise.resolve(api.settings.describe())
          .then(function (response) {
            var described = valueOf(response)
            var namespaces = (described && described.namespaces) || []
            var found = null
            for (var i = 0; i < namespaces.length; i++) {
              if (namespaces[i] && namespaces[i].ns === NS) {
                found = namespaces[i]
                break
              }
            }
            if (found === null) {
              setPhase('unavailable')
              return
            }
            setView(found)
            setUser(found.user && typeof found.user === 'object' ? found.user : {})
            seed(found.value)
            setPhase('ready')
            readCredential(found)
          })
          .catch(function () {
            setPhase('unavailable')
          })
      }

      /** Ask the credentials domain about the reference currently in force. */
      function readCredential(forView) {
        if (!api || !api.credentials || !api.credentials.describe) return
        var ref = refOf(drafts, forView || view)
        Promise.resolve(api.credentials.describe([ref]))
          .then(function (response) {
            var described = valueOf(response)
            var entry = described ? described[ref] : undefined
            setCredential({
              ref: ref,
              configured: entry ? entry.configured === true : false,
              writable: entry ? entry.writable !== false : true,
            })
          })
          .catch(function () {
            setCredential({ ref: ref, configured: false, writable: false })
          })
      }

      React.useEffect
        ? React.useEffect(function () {
            load()
          }, [])
        : null

      function edit(name, text) {
        setDrafts(function (previous) {
          var next = {}
          for (var k in previous) next[k] = previous[k]
          next[name] = text
          return next
        })
        if (name === 'apiKeyEnv') setCredential(null)
      }

      /** Persist the staged fields and, when one was typed, the credential. */
      function save() {
        if (busy || !view) return
        var ops = buildOps(drafts, view.value, user)
        var ref = refOf(drafts, view.value)
        var typedKey = keyDraft.trim()
        if (ops.length === 0 && typedKey.length === 0) {
          flash('没有需要保存的改动')
          return
        }
        setBusy(true)
        var writes = []
        if (ops.length > 0) {
          writes.push(
            Promise.resolve(api.settings.mutate(NS, ops, view.revision)).then(function (response) {
              var failure = errorOf(response)
              if (failure !== undefined) throw new Error(failure)
            }),
          )
        }
        if (typedKey.length > 0) {
          writes.push(
            Promise.resolve(api.credentials.set(ref, typedKey)).then(function (response) {
              var failure = errorOf(response)
              if (failure !== undefined) throw new Error(failure)
            }),
          )
        }
        Promise.all(writes)
          .then(function () {
            setKeyDraft('')
            setBusy(false)
            flash(typedKey.length > 0 ? '✓ 已保存，密钥写入 ' + ref : '✓ 已保存')
            load()
          })
          .catch(function (error) {
            setBusy(false)
            flash('保存失败：' + (error && error.message ? error.message : String(error)), true)
          })
      }

      /** Drop one field's override so the composition value applies again. */
      function reset(name) {
        if (busy || !view || user[name] !== true) return
        setBusy(true)
        Promise.resolve(api.settings.mutate(NS, [{ op: 'unset', path: [name] }], view.revision))
          .then(function (response) {
            var failure = errorOf(response)
            if (failure !== undefined) throw new Error(failure)
            setBusy(false)
            flash('已恢复默认值')
            load()
          })
          .catch(function (error) {
            setBusy(false)
            flash('恢复失败：' + (error && error.message ? error.message : String(error)), true)
          })
      }

      function control(field) {
        var text = drafts[field.name] === undefined ? '' : drafts[field.name]
        var overridden = user[field.name] === true
        var changed = !sameValue(text, view ? view.value[field.name] : undefined)

        var input
        if (field.kind === 'select') {
          input = h(
            'select',
            {
              className: 'dws-select',
              value: text,
              onChange: function (e) {
                edit(field.name, e.target.value)
              },
            },
            [h('option', { key: '__inherit', value: '' }, '（使用默认）')].concat(
              field.options.map(function (pair) {
                return h('option', { key: pair[0], value: pair[0] }, pair[1])
              }),
            ),
          )
        } else if (field.kind === 'toggle') {
          input = h(
            'div',
            { className: 'dws-row' },
            h('input', {
              type: 'checkbox',
              checked: text === 'true',
              onChange: function (e) {
                edit(field.name, e.target.checked ? 'true' : 'false')
              },
            }),
            h('span', null, text === 'true' ? '已开启' : '已关闭'),
          )
        } else {
          input = h('input', {
            className: 'dws-input' + (field.kind === 'number' ? '' : ' mono'),
            type: field.kind === 'number' ? 'number' : 'text',
            min: field.min,
            max: field.max,
            value: text,
            placeholder: field.placeholder || '（使用默认）',
            onChange: function (e) {
              edit(field.name, e.target.value)
            },
          })
        }

        return h(
          'div',
          { className: 'dws-group', key: field.name },
          h(
            'div',
            { className: 'dws-label' },
            field.label,
            changed ? h('span', { className: 'dws-badge warn' }, '未保存') : null,
            overridden && !changed ? h('span', { className: 'dws-badge off' }, '已覆盖') : null,
            overridden && !changed
              ? h(
                  'a',
                  {
                    className: 'dws-hint',
                    style: { cursor: 'pointer' },
                    onClick: function () {
                      reset(field.name)
                    },
                  },
                  '恢复默认',
                )
              : null,
          ),
          input,
          field.hint ? h('div', { className: 'dws-hint' }, field.hint) : null,
        )
      }

      if (phase === 'loading') {
        return h('div', { className: 'dws-root' }, h('style', null, STYLE), h('div', { className: 'dws-hint' }, '正在读取配置…'))
      }
      if (phase === 'unavailable' || !view) {
        return h(
          'div',
          { className: 'dws-root' },
          h('style', null, STYLE),
          h('h2', null, '联网搜索（豆包）'),
          h(
            'div',
            { className: 'dws-note' },
            '宿主没有暴露 ' + NS + ' 这个配置命名空间。请确认 dsh-web-search-doubao 已装进当前 profile 的 bundles，并重启 Harness。',
          ),
        )
      }

      var writable = view.writable !== false
      var pending = buildOps(drafts, view.value, user).length > 0 || keyDraft.trim().length > 0

      return h(
        'div',
        { className: 'dws-root' },
        h('style', null, STYLE),

        h(
          'div',
          null,
          h('h2', null, '联网搜索（豆包）'),
          h(
            'p',
            { className: 'dws-sub' },
            '把 Harness 标准的 web_search 工具接到豆包搜索 API。相比模型服务端搜索，这里每条来源都带正文摘要，而且不额外消耗模型 token。',
          ),
        ),

        h(
          'div',
          { className: 'dws-group' },
          h(
            'div',
            { className: 'dws-label' },
            'API Key',
            credential === null
              ? null
              : credential.configured
                ? h('span', { className: 'dws-badge' }, '● 已配置')
                : h('span', { className: 'dws-badge off' }, '未配置'),
          ),
          h('input', {
            className: 'dws-input mono',
            type: 'password',
            value: keyDraft,
            placeholder: credential && credential.configured ? '已配置，如需更新请输入新 Key' : '粘贴火山引擎 API Key（Agent Plan 专属 Key 可用）',
            disabled: credential !== null && credential.writable === false,
            onChange: function (e) {
              setKeyDraft(e.target.value)
            },
            onKeyDown: function (e) {
              if (e.key === 'Enter') save()
            },
          }),
          h(
            'div',
            { className: 'dws-hint' },
            '密钥写入凭据存储，引用名 ',
            h('code', null, refOf(drafts, view.value)),
            '，不会进入设置文件。 ',
            h('a', { onClick: function () { openUrl(KEY_CONSOLE) } }, '获取 API Key ↗'),
          ),
        ),

        FIELDS.map(control),

        h(
          'div',
          { className: 'dws-actions' },
          h(
            'button',
            { className: 'dws-btn', disabled: busy || !writable || !pending, onClick: save },
            busy ? '保存中…' : '保存',
          ),
          h(
            'button',
            {
              className: 'dws-btn ghost',
              disabled: busy,
              onClick: function () {
                seed(view.value)
                setKeyDraft('')
                flash('已撤销未保存的改动')
              },
            },
            '撤销',
          ),
          status ? h('span', { className: 'dws-status' + (status.err ? ' err' : '') }, status.msg) : null,
        ),

        !writable
          ? h('div', { className: 'dws-note' }, '当前 profile 的配置文档不接受写入，改动无法保存。')
          : h(
              'div',
              { className: 'dws-note' },
              '保存后下一次搜索即生效，无需重启。密钥生效也无需重启。',
            ),
      )
    }

    exports.name = 'web-search-doubao-client'
    exports.inject = ['slots', 'remote', 'remote.settings', 'remote.credentials']
    exports.apply = function (ctx) {
      var api = null
      try {
        api = ctx.remote !== undefined ? ctx.remote : null
      } catch (e) {
        api = null
      }
      if (api === null) {
        try {
          var connection = ctx.get && ctx.get('connection')
          api = connection && connection.api ? connection.api : null
        } catch (e) {
          api = null
        }
      }
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: NS,
            order: 47,
            label: function () {
              return '联网搜索'
            },
          },
          function () {
            return h(DoubaoSearchPage, { api: api })
          },
        )
      })
    }

    // Test seam: the pure helpers a Node test exercises without a browser.
    exports.__internals = {
      NS: NS,
      DEFAULT_KEY_REF: DEFAULT_KEY_REF,
      FIELDS: FIELDS,
      refOf: refOf,
      toDraft: toDraft,
      fromDraft: fromDraft,
      buildOps: buildOps,
      valueOf: valueOf,
      errorOf: errorOf,
    }

    return module.exports
  },
})
