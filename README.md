# dsh-catch-up

离开一会儿，回来一屏看懂 [Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype) 的新进展，知道下一步需要你做什么。

- **只读**：只发 GET 请求，不重试、不停止、不回复、不调度任何任务。
- **不调用模型**：简报由固定规则生成。
- **状态变化摘要，不是完整事件回放**：Super-agent 只保存每个任务的最新状态，离开期间先出现、后又消失的状态无从得知。
- **已验证的上游提交**：`deepseek-ai/dsh-superagent-prototype@8c32a9d`。接口字段不一致时只会报"版本不一致"，不会给出半截结果。

设计见 [docs/DESIGN.md](docs/DESIGN.md)。目前检索没发现直接竞品。

## 试一下（不需要 Super-agent）

```sh
node src/cli.ts --demo
```

需要 Node ≥ 22.18（直接运行 TypeScript，无需构建）。

## 使用

```sh
export DSH_SUPERAGENT_URL=http://127.0.0.1:3098   # 或每次传 --url
node src/cli.ts            # 显示简报；不会推进阅读进度
node src/cli.ts ack        # 标记已阅（确认最近显示的一份；也可 ack <briefId>）
node src/cli.ts --json     # 机器可读输出
```

`ack` 存下的是**那一份简报**的快照，看完之后才发生的变化下次仍会显示为新内容。阅读进度保存在 `$DSH_HOME/dsh-catch-up/<host>-<port>/state.json`（`DSH_HOME` 默认 `~/.dsh`）。

## 安全说明

Super-agent 的面板接口只防浏览器跨站请求，不防本机程序：本机任何进程都能读它。这是上游的设计，dsh-catch-up 不扩大也不缩小这个范围。

## Windows

Super-agent 的 `stateDir` 配置要求以 `/` 开头：写 `/Agent/tmp/...`，不要写 `D:/...`。

## 测试

```sh
npm test
```

## 作为 DSH 插件使用

装在 **Super-agent 所在的那个 profile** 里（端口取自宿主的网页服务，装在别的 profile 会读到那个 profile 自己的端口，此时请用命令行加 `--url`）：

```sh
npm install && npm run build
dsh --profile superagent plugin add link:<本仓库路径>
```

然后在界面里输入 `/catchup` 或 `/catchup ack [briefId]`。命令不经过模型。

## 状态

v0.1 开发中。已完成：核心对比、接口适配与校验、阅读进度存储、命令行、`--demo`、DSH 命令插件（`src/plugin/`，已用模拟面板测试）、测试。
已验证：命令行对隔离的真实 Super-agent 实例走完 首次运行 → ack → 状态变化 → 简报 → ack（设计 §15.5）。
尚未验证：DSH 内的 `/catchup` 命令本身（需要模型配置）。
