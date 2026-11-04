# 接口契约数据

这些文件是 Super-agent 面板接口的**真实响应**：由上游 `deepseek-ai/dsh-superagent-prototype@8c32a9d` 的服务端代码生成。运行环境是 Windows 上的 DSH 0.2.1-rc.5，使用隔离的 `DSH_HOME`；启动时 `DEEPSEEK_API_KEY` 为空，没有配置任何仓库，所以运行时一直停在 `setupPending`，不会处理消息，也不会调用模型。

**里面的任务数据是样例。** 仓库 `example/widgets`、人名 alice/bob/carol、各个任务，都是 `scripts/seed-superagent.mjs` 直接写进隔离实例数据库的；接口里的结构和投影逻辑（阶段、`note`、`reply`、排序、分页）来自上游真实代码。

| 目录 | 内容 |
|---|---|
| `8c32a9d-empty/` | 刚装好、什么都没有的实例 |
| `8c32a9d-before/` | 上次已阅时：T1 等你回答，T2 执行中，T3 待审，T4 已合并 |
| `8c32a9d-after/` | 回来时：T1 仍在等回答；T2 失败一次、重新执行后待审；T3 已合并；新增 T5 已完成、T6 排队、T7 等你选方案；另有一条被忽略的消息 |

重新录制：

1. 停掉实例，并等它的 `stateDir` 锁过期（30 秒）；
2. 执行 `node scripts/seed-superagent.mjs <orchestrator.sqlite> before|after`；
3. 启动实例；
4. 执行 `sh scripts/record-contract.sh 8c32a9d-<名字>`。

`8c32a9d-empty/` 是更早用手工 curl 录的，文件名格式和另外两组略有不同。
