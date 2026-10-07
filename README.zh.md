# dsh-web-search-doubao

让 DeepSeek Harness 标准的 **`web_search`** 工具换上一个能返回**真实正文摘录**（而不只是标题和链接）的搜索后端。

这是一个给 Harness 的 Web 能力接缝（`ctx.web`）用的**搜索 provider 插件**：它注册一个豆包搜索（火山引擎）后端并把接缝指向它。模型侧的工具 `@deepseek-ai/dsh-tool-web` 完全不用改，变的只是它背后的后端。

[English](./README.md) | 中文

---

## 为什么需要它

Harness 自带 `@deepseek-ai/dsh-web-search-deepseek`，它的做法是让模型通过 Anthropic 兼容的 Messages API 调用**服务端 `web_search` 工具**。这条路能用，但它能拿到的结果只有**标题和 URL** —— 响应里没有引用摘录，所以归一化后的 `sources[].snippet` 永远是空的。

豆包搜索 API 是一个普通的搜索接口，返回结构化结果，其中**包含每条结果的正文**。本插件把这段正文映射到 `snippet`，于是每条来源都带着模型真正能读、能引用的文字：

| | 模型侧 `web_search` 工具 | 本插件（豆包搜索 API） |
|---|---|---|
| `sources[].title` / `.url` | ✅ | ✅ |
| `sources[].snippet` | ❌ 永远为空 | ✅ 每条都有真实摘录 |
| `sources[].publishedAt` | 有时是 `1970-01-01` 纪元哨兵值 | 真实日期，哨兵值已过滤 |
| 单次搜索成本 | 额外一整轮模型调用（数千 token） | 一次 API 调用，不烧模型 token |
| 典型耗时 | 6~14 秒 | 约 0.2~0.6 秒 |

## 前置条件

- DeepSeek Harness `>= 0.2.0-rc.2`（`ctx.web` 接缝的 provider API）。
- Node.js `>= 22`。
- 一把**火山引擎 API Key**。**Agent Plan 的 Key 可以用**，并走套餐内 AFP 抵扣 —— 官方 Agent Plan 文档把豆包搜索描述为该套餐的搜索服务，用套餐专属 API Key 调用。其他火山产品的 Key 虽然能通过鉴权，但不在套餐覆盖范围内。

端点默认 `https://open.feedcoopapi.com/search_api/web_search`，即豆包搜索的公开地址，无需配置。

## 安装

```sh
# 直接从本仓库安装
dsh plugin --profile web add github:gilsaia/dsh-web-search-doubao

# 或从本地目录安装
dsh plugin --profile web add /path/to/dsh-web-search-doubao
```

本包声明了 `dsh.bundle.patch`，所以安装时会同时把它加进 profile 的 bundle 列表，其补丁会把接缝指向本 provider：

```yaml
- insert:
    - id: web-search-doubao
      name: 'dsh-web-search-doubao'

- id: web
  config:
    searchProvider: doubao
    fetchProvider: http
```

`fetchProvider` 必须一并重写：行补丁是**整体替换**目标行的 `config`，漏掉它会把 fetch provider 一起清空，导致 `web_fetch` 失效。

装完后重启 Harness（或重新加载 profile），然后发起一次搜索即可。

## 提供密钥

插件**要求提供密钥**，解析顺序为：

1. 配置里的字面量 **`apiKey`**；
2. **`apiKeyEnv`** 指定的凭证名（默认 `ARK_API_KEY`），先经 Harness 凭证服务解析，再回退到启动环境变量。

所以要么导出环境变量：

```sh
export ARK_API_KEY=...        # 然后启动 Harness
```

要么在 profile 的补丁层里配置：

```yaml
- id: web-search-doubao
  config:
    apiKey: '...'             # 这是密钥；更推荐 apiKeyEnv，避免密钥进入配置文件
```

密钥缺失时搜索会以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，并明确指出查过哪个引用名 —— 不会静默返回零结果。

## 配置项

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `apiKey` | string（secret） | — | 字面量 API Key。 |
| `apiKeyEnv` | 凭证引用 | `ARK_API_KEY` | 每次搜索解析的凭证名。 |
| `baseURL` | string | 豆包搜索地址 | 完整端点；用于代理或其他地域。 |
| `searchType` | `web` \| `image` | `web` | `image` 返回图片结果。 |
| `maxResults` | 1–50 | `10` | 请求未指定上限时的结果条数。 |
| `timeRange` | string | — | `OneDay` / `OneWeek` / `OneMonth` / `OneYear`，或 `YYYY-MM-DD..YYYY-MM-DD`。 |
| `authLevel` | 0–2 | `0` | `1` 只返回权威来源。仅网页搜索生效。 |
| `queryRewrite` | boolean | `false` | 让服务把口语化问题改写成搜索式 query。 |
| `needSummary` | boolean | `true` | 请求正文摘录（即 `snippet`）。关掉它 `snippet` 就会变空。 |

`baseURL` 也可用环境变量 `DOUBAO_SEARCH_BASE_URL` 覆盖。

所有字段都是**每次搜索实时读取**的，改配置无需重启。

## 回退

删掉 `cordis.patch.yml` 里的 `- id: web` 块（或在你自己的补丁层里覆盖它 —— 你的层在所有 bundle 层之后应用）即可保留默认 provider。插件仍然注册、仍可选，只是不被使用：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http
```

## 验证

```sh
# 纯函数与插件契约测试：不联网、不需要 Key
npm test

# 真实 API 冒烟测试；断言每条来源都带 snippet
ARK_API_KEY=... npm run test:live
```

不启动也能确认配置合成：

```sh
dsh --profile web --dump-config | grep -A4 'id: web$'
# searchProvider: doubao
# fetchProvider: http
```

## 实现说明

- `provider.js` —— `DoubaoSearchProvider`，负责 wire format、结果映射与错误翻译。使用原生 `fetch`，**不经过** `ctx.llm`。
- `index.js` —— Cordis 插件本体：`name`、`inject: ['web']`、`Config` schema 与 `apply()`，后者把 provider 注册进接缝。
- `cordis.patch.yml` —— 挂载插件并选中它的 bundle 补丁。

两个如果要 fork 值得注意的细节：

- 该 API 失败时返回的是 **HTTP 200** + `ResponseMetadata` 里的 `Error` 对象，所以只看状态码不够，必须检查响应体。
- 该 API 对爬取时间未知的页面会返回纪元哨兵值（`1970-01-01T08:00:00+08:00`）。本插件会过滤掉它，而不是当成发布日期展示。

## 版本兼容

`@deepseek-ai/dsh-*` 的 peer 依赖声明为开放区间（`>=0.2.0-rc.2`）而非固定版本，以便跨 Harness 的 RC 版本继续可用。DeepSeek Harness 处于开发者预览阶段，接缝 API 可能变化；一旦变化，本插件需要和其他 provider 一样跟进。

## 许可证

MIT
