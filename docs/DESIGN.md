# dsh-catch-up 设计（v0.1）

> 离开一会儿，回来一屏看懂 Super-agent 的新进展，知道下一步需要你做什么。不额外调用 LLM。

面向 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的运营者。首版只做一条流程：**读取当前状态 → 与上次已阅的快照对比 → 给出简报 → 用户点"已阅"后推进进度**。

上游锁定在 `deepseek-ai/dsh-superagent-prototype@8c32a9d`（2026-10-31）。下文的源码行号都指这个提交。

## 1. 边界

- **只读。** 不重试、不停止、不回复、不调度任务，也不调用任何会改变 Super-agent 状态的接口。
- **不调用模型。** 简报由固定规则和模板生成。
- **只做状态变化摘要，不还原事件。** Super-agent 只保存每个任务的最新状态（见第 4 节）。离开期间先出现、后又消失的状态，事后无从得知。README 第一屏必须写明这一点。
- **只服务单个运营者。** 面板只监听本机回环地址，一个 Super-agent 实例对应一份阅读进度；多人各自的进度不在 v0.1 范围内。
- 对外说法：只能说"目前检索没发现直接竞品"，不能说"没有竞品"。

## 2. 与官方 Overview 的差别

| | 官方 Overview（`docs/005-panel.md`） | dsh-catch-up |
|---|---|---|
| 时间窗口 | 固定最近 24 小时 | 从**你上次点已阅**到现在 |
| 待处理任务 | 列出所有当前需要人处理的任务 | 分成"新出现的"和"之前看过、仍待处理的" |
| 已结束任务 | 只有计数 | 列出离开期间结束的任务及结果（已合并、已完成、已关闭……） |
| 同一任务的多次变化 | 只显示当前状态 | 一行显示最终状态，必要时补一句可以确认的经过 |
| 阅读进度 | 无 | 有，点"已阅"才推进 |

官方已经有的东西不重复做：系统健康、执行负载、按链接搜索、任务详情。简报里的每一条都指回原处。

## 3. 数据来源

插件通过 Super-agent 面板服务的本机 HTTP 接口读取数据：`http://127.0.0.1:<port>/orchestrator/api/`。

请求规则（`src/app/http.ts:75-79`）：
- 必须带请求头 `x-orchestrator-request: 1`；
- `Host` 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`；
- 要么不带 `Origin`，要么 `Origin` 与 `Host` 同源。Node 端发出的请求默认不带 `Origin`。

**不需要 DSH 的登录令牌。** 2026-11-04 接入实验（第 15 节）证实：DSH 宿主自己的路由（网页首页、`/api/...`）不带令牌会返回 401，而插件用 `webServer.register({ kind: 'prefix' })` 注册的路由，请求会直接交给插件处理，宿主不做令牌检查。所以命令行和插件都只需要满足上面三条规则。

这也意味着：本机任何进程都能读 Super-agent 的这些接口。上面三条规则只防浏览器跨站请求，不防本机程序。这是上游的设计，dsh-catch-up 不扩大也不缩小这个范围；README 里要提一句。

| 路由 | 用途 | 稳定性 |
|---|---|---|
| `GET state` | 服务是否就绪、`paused`、负载 | 文档承诺稳定（`docs/006` Management API） |
| `GET overview` | `problems` 当前系统问题、`person` 待人处理的任务 | 面板内部接口，可能变动 |
| `GET tickets?state=open\|ended&offset&limit` | 任务列表，按 `updatedAt` 从新到旧，每页最多 1000 条（`http.ts:140`、`records.ts:17`） | 面板内部接口 |
| `GET decisions?offset&limit` | 评估决定，带 `at`，用来统计离开期间接单、忽略了多少。**按写入顺序（`rowid` 倒序）排列，不按 `at`**（`src/app/store-read.ts:63`），所以要按 `at` 过滤，整页都早于基准才停止翻页 | 面板内部接口 |

应对接口变动：
- 所有读取集中在 `src/adapter/`，进入核心逻辑之前先做字段校验；
- 校验失败时，简报只显示一行"无法读取：上游接口与 v0.1 适配的版本（8c32a9d）不一致"，不猜测，也不给出半截结果；
- README 写明已验证过的上游提交。

## 4. 快照与指纹

### 4.1 上游实际保存了什么

只保留最新状态的：
- 每个 Assignment（一次执行）只保留**最新一条** report（`src/core/model.ts:225`），之前的进展会被覆盖；
- `attention`（等人回答的问题）只保存当前那一个，问题解决后清空（`model.ts:274-287`）。

能找回来的历史：
- 每次重新执行都会新增一个 Assignment，带 `createdAt`、`endedAt`、`endedReason`；
- 任务结束时记录 `ended.at` 和 `ended.outcome`；
- 每个决定都有 `at`。

### 4.2 为什么不用 `updatedAt` 判断有没有变化

任务在投递输入时也会刷新 `updatedAt`（`src/core/assignments.ts:51`），用它会把"有人在帖子里补了一句话"也算成变化。`updatedAt` 只用来决定翻页翻到哪里停，不参与判断任务有没有变化。

### 4.3 任务指纹

指纹只用任务列表里每一行（`ticketSummary`，`records.ts:118-131`）自带的字段计算，不需要逐个请求任务详情：

```
fingerprint = hash(stage, action, attention?.id, ended?.outcome, deliveryError 是否存在)
```

- 不计入 `summary`（进展文字）：执行中进展文字频繁变化，算进去会让简报很吵。
- 不计入 `assignments`（执行次数）：它只用来补一句经过，见第 6 节。
- `stage` 和 `action` 就是官方的阶段划分（`src/core/stage.ts:5-21`）：`person`（`review`、`answer`、`blocked`、`failed`、`delivery`）、`working`（可能附带 `queued`）、`idle`、`ended`。

### 4.4 系统问题的键

系统问题（`overview.problems[]`）按 `kind` 加上能区分对象的字段组成一个键，例如：
- `source-error` 用 Source 的 id 和出问题的部分；
- `eval-unavailable` 用 `decisionId`；
- `outgoing` 用 `outgoing.id`。

只比较"有没有出现"，不比较说明文字。

## 5. 简报的分区与顺序

| 顺序 | 分区 | 收录条件 | 每条显示 |
|---|---|---|---|
| 1 | **需要你** | 处于 `person` 阶段，并且是新任务或指纹变了 | 动作（审 PR、回答问题、处理受阻或失败、投递失败）、标题、原帖链接、问题原文（如有） |
| 2 | **仍待处理** | 处于 `person` 阶段，指纹与上次已阅时相同 | 同上，并注明"上次已阅时已存在" |
| 3 | **系统问题** | 新出现的问题；离开期间消失的问题合成一行"已恢复 N 项" | 类型、说明 |
| 4 | **已结束，无需操作** | 离开期间进入 `ended` 的任务 | 按结果分组：已合并、已完成、已关闭、无需处理、被人停止 |
| 5 | **进行中** | 离开期间新开、或者从已结束被重新打开（有人在原帖回复会让任务恢复，见 `docs/001` 中 Ticket 的说明），且现在处于 `working` 或 `idle` 阶段的任务 | 只给计数；重新打开的单独计数 |
| 6 | **消息** | 离开期间产生的决定 | 一行计数：接单 N、忽略 N、未完成评估 N |

- 第 1 到第 3 区都为空时，第一行写"离开期间没有需要你处理的事"。
- 第 4 到第 6 区再空也只占一行，遵循官方"状态正常时不占地方"的原则（`docs/005` Principles 6）。

## 6. 合并规则

每个任务只占一行，显示它**当前**的状态。"经过"只写能确认的事实：

- 执行次数比上次多：写"期间重新执行 N 次"；
- 任务在离开期间开始、又在离开期间结束：写"新开并已结束"；
- 上次已阅时任务已结束，现在又打开了：写"被重新打开"；
- 不根据进展文字推测发生过什么，也不写"可能曾经受阻"这类猜测。

## 7. 已阅

- 显示简报**不会**推进阅读进度。
- 每份简报有一个 `briefId`，是这次快照的哈希。
- 执行 `ack <briefId>` 时，把**那一份**快照存为新的基准，而不是执行 ack 那一刻的状态。这样，看完简报之后才发生的变化，下次仍然会显示为新内容。
- `ack` 不带参数时，确认最近一次显示过的那份简报。
- 最近 5 份简报的快照保留在本地，用来对应 `briefId`。
- 第一次运行时没有基准：
  - 当前处于 `person` 阶段的任务列为"当前待处理"；
  - 其他分区不显示；
  - 末尾提示"从现在开始记录"。

## 8. 入口

v0.1 有两个入口，共用同一套核心逻辑和同一份进度文件：

| 入口 | 形式 | 说明 |
|---|---|---|
| DSH 命令（装在 `superagent` profile 里） | `/catchup`、`/catchup ack [briefId]` | 用 `ctx.commands` 注册。命令由界面直接执行，不经过模型，和 done-check 一样。端口从宿主的网页服务读取 |
| 命令行 | `dsh-catch-up [--url <面板地址>] [--json]`、`dsh-catch-up ack [briefId]`、`dsh-catch-up --demo` | `--url` 默认读 `DSH_SUPERAGENT_URL`，和官方脚本一致。可以在 Super-agent 所在的 profile 之外使用 |

链接：
- 每条都附原帖链接，取自任务行 `threads[].url`（GitHub Issue/PR 或飞书话题）；
- **面板没法直接链接到某个任务**：面板当前所在的页面只保存在浏览器的 `sessionStorage` 里（`src/client/route.ts`），URL 里没有。所以每条只附任务 ID，并提示"在面板顶部搜索"。

## 9. 存储

`$DSH_HOME/dsh-catch-up/<host>-<port>/state.json`（`DSH_HOME` 默认 `~/.dsh`）：

```json
{
  "version": 1,
  "baseline": { "at": "…", "tickets": { "<id>": { "fp": "…", "stage": "…", "assignments": 2 } }, "problems": ["…"] },
  "briefs": [{ "id": "…", "at": "…", "snapshot": { … } }]
}
```

- 写入方式：先写临时文件再改名。
- 文件损坏时，显示"阅读进度无法读取，已按首次使用处理"，并把原文件备份为 `.corrupt-<时间>`。

## 10. 分层

```
src/core/      纯逻辑：规范化 → 指纹 → 对比 → 分区 → 简报模型（不依赖 DSH 和网络）
src/adapter/   Super-agent HTTP 客户端：翻页、字段校验、版本不一致时的报错
src/store/     state.json 读写
src/render/    Markdown（DSH 命令用）、终端文本、JSON
src/plugin/    DSH 胶水：命令注册、获取网页服务端口
src/cli.ts     命令行入口
fixtures/      演示数据和测试用的接口录制
```

## 11. 演示模式

- `dsh-catch-up --demo` 读取 `fixtures/demo/` 里的两份快照，走和正式运行完全相同的对比与渲染流程。
- 输出第一行固定写"样例数据"。
- 不需要账号、API Key，也不需要 Super-agent 在运行。

## 12. 测试

- **核心逻辑：** 用 `node:test` 跑快照对比。至少覆盖：
  - 新任务进入 `person` 阶段；
  - 同一个问题仍在等待（归入"仍待处理"）；
  - 问题换了（`attention.id` 变了，算新的）；
  - 只有进展文字变化（不显示）；
  - 只有 `updatedAt` 变化（不显示）；
  - 执行过程中重新执行；
  - 新开并已结束；
  - 已结束的任务被重新打开；
  - 首次运行；
  - ack 一份旧简报，之后才出现的变化仍显示为新内容；
  - 进度文件损坏；
  - 上游字段缺失（报版本不一致）。
- **接口契约：** 已录好，在 `fixtures/contract/`。做法：在隔离实例里不配置仓库，让运行时停在 `setupPending`；用 `scripts/seed-superagent.mjs` 把样例任务直接写进它的 SQLite；重启后，由上游真实的服务端代码生成接口响应，再用 `scripts/record-contract.sh` 录下来。全程没有模型调用。核心逻辑的测试直接用 `8c32a9d-before` → `8c32a9d-after` 这一对数据。
- **端到端：** 在 DSH 0.2.1-rc.5 的隔离 `DSH_HOME` 里安装插件，打 `/catchup` 命令，从网络响应里读输出。不在日常使用的 `~/.dsh` 里测试；在 composer 里只打命令，不发普通消息。
- **命令行对真实实例：** 用隔离的 `DSH_HOME` 启动 Super-agent，并把 `DEEPSEEK_API_KEY` 设为空；写入种子数据，然后运行 `dsh-catch-up --url http://127.0.0.1:3098`。

## 13. v0.1 发布标准

1. 在真实的 Super-agent 实例上走完：首次运行 → ack → 实例状态变化 → 简报准确反映变化 → 再次 ack 后清空。
2. 第 12 节列出的测试全部通过。
3. `--demo` 在没有 DSH 的机器上可以运行，README 的动图就用它录。
4. README 第一屏写明：只读、不调模型、"状态变化摘要而不是完整事件回放"、已验证的上游提交。

## 14. 之后再说

- 面板里的简报页签和"已阅"按钮；
- "稍后处理"；
- 飞书推送；
- 每人一份阅读进度；
- 从 GitHub 读取 PR 的审查状态；
- 适配上游接口的新版本。

## 15. 待确认事项与接入实验

### 15.1 接入实验（2026-11-04）

实验环境：
- Windows 上的 DSH 0.2.1-rc.5；
- 一个隔离的 `DSH_HOME`，profile `probe` 由 Web 模板新建；
- 启动时 `DEEPSEEK_API_KEY` 设为空，不可能产生模型调用；
- 一个一次性的探针插件（仓库里的 `spike/catchup-probe/`）：不属于任何 bundle，用 `dsh plugin add link:` 安装，注入 `webServer` 和 `commands`，用和 Super-agent 相同的方式注册前缀路由 `/catchup-probe`，并照搬 Super-agent 的同源规则。

这一轮没有安装 Super-agent：下面两个问题都只取决于 DSH 宿主，不取决于 Super-agent。装上 Super-agent 的实验见第 15.3 节。

| 请求 | 结果 |
|---|---|
| 插件路由，不带令牌、不带 Cookie，带请求头 | **200**，插件读到 `ws.port = 3096` |
| 插件路由，不带请求头 | 403（插件自己的规则拦下，不是宿主） |
| 插件路由，`Host: localhost:3096` | 200 |
| 插件路由，伪造的 `Host` | 403（插件自己的规则） |
| 宿主路由 `/` 和 `/api/sessions`，不带令牌 | **401** |

每组请求跑了两遍，结果一致。刚启动时第一遍请求没有任何响应（curl 返回 `000`），因为插件还没加载完；正式代码要对"服务还没就绪"做一次带等待的重试，并给出明确提示。

### 15.2 结论

1. **端口：可以拿到。** 不属于 bundle 的插件也能注入 `webServer`，在请求处理时读到 `port`。
   - 没验证的部分：从 DSH 命令内部发起回环请求。打命令需要一个会话，而 key 为空的实例会被界面要求先登录或填 API Key，所以这条路这次没走通。命令处理函数和路由处理函数在同一个进程里读同一个属性，风险很低，但端到端测试仍要在真实的 Super-agent profile 上补上。
   - 推论：插件只有装在 **Super-agent 所在的那个 profile** 里，拿到的才是 Super-agent 的端口。装在别的 profile 里拿到的是那个 profile 自己的端口，所以那种情况只能用命令行加 `--url`。第 8 节的入口划分不变。
2. **令牌：不需要。** 见第 3 节。社区反馈 #11714 里遇到的 401 是宿主自己的页面和接口，不是 `/orchestrator`。

### 15.3 真实 Super-agent 实验（2026-11-04）

在同一个隔离的 `DSH_HOME` 里新建 `superagent` profile，装上 `8c32a9d` 构建出的 bundle 和探针插件，端口 3098，启动时 `DEEPSEEK_API_KEY` 为空。

1. **Windows 上可以直接跑，不需要 tmux 和 WSL。** 绕过官方启动脚本，直接用 `dsh --profile superagent` 启动，面板接口正常工作。
   - 坑：`stateDir` 的配置校验要求以 `/` 开头（POSIX 路径），写 `D:/...` 会被拒，插件不启动。写成 `/Agent/tmp/...` 就行，Node 在 Windows 上会把它解析到当前盘。README 的 Windows 说明里要写这一条。
2. **接口契约和设计一致。** 任务行带 `stage`、`action`、`attention`、`assignments`（执行次数）、`summary`、`ended`、`threads[].url`。另外还有两个现成字段可以直接用：
   - `note`：上游已经替人写好的一句提示，比如问题原文；
   - `reply`：回复入口的链接和标签，例如"GitHub #12"。
3. **探针插件装在 Super-agent 的 profile 里，读到的端口就是 3098**，即 Super-agent 自己的端口。第 15.2 节的推论得到证实。
4. **决定列表按写入顺序排列**，见第 3 节。
5. **进程锁：** Super-agent 对 `stateDir` 加锁，锁 30 秒不刷新才算失效（`src/app/runtime.ts:93`）。强制停止后要等锁过期才能再启动，开发脚本要等这一段时间。
6. 运行时停在 `setupPending` 时不会启动任何执行：`load.running` 一直为 0，排队的任务保持排队。

### 15.4 还没确认的

1. 从 DSH 命令内部发起回环请求的端到端测试：需要一个能打命令的会话，也就是要有模型配置。这会产生真实的模型调用，所以等真正部署 Super-agent 的时候再测。
2. 验证指标：找几位真实的 Super-agent 用户，看他们读完简报后，逐个打开任务的次数有没有减少。
