# DBCraft 未完成项与隐藏需求清单

| 项目 | 内容 |
|---|---|
| 文档目的 | 把当前代码里「没做完、没入口、文档没提但迟早要补」的内容收在一处，作为 v1.0 收口与排期依据 |
| 代码基线 | `9233262` + 当前工作区未提交改动（2026-11-09，M1 开发中） |
| 对照文档 | `doc/PRD.md` v0.20、`doc/PROJECT_STATUS.md`、`doc/UI_TODO.md`、`doc/CONNECTION_TAB_MODEL.md` |
| 收录范围 | 功能缺口、行为一致性、数据安全、会话/存储韧性；纯技术选型、i18n、遥测不展开，发布门槛类只列项 |
| 维护方式 | 完成一项就改状态并追加 `doc/WORKLOG.md`；本文不替代 PRD，也不替代 `PROJECT_STATUS` 的验收结论 |

> 功能有无与总体状态看 `doc/FEATURE_MATRIX.md`；本文只维护「还差什么、怎么补」。

图例：

- 优先级：**P1** 主路径/数据一致性受影响｜**P2** 韧性、边角与体验
- 状态：**❌ 未开始**｜**🟡 半成品**｜**⏸ 明确延后**｜**❓ 待拍板**
- 分组：**H** 代码走查新发现（文档未提或只提了一句）｜**K** 文档已列但代码仍未完成｜**R** 架构已就绪但缺入口/韧性

---

## 1. 总览

| 分组 | 数量 | 说明 |
|---|---|---|
| H 代码走查新发现 | 11 | 多数是「界面上有入口，实际走不通或会误伤」的问题 |
| K 文档已列但未完成 | 10 | `PROJECT_STATUS` / `UI_TODO` 已有记录，本文只汇总入口 |
| R 架构/韧性 | 9 | 类型、存储、生命周期已具备，但缺健康检查、恢复或收尾 |

**建议最先处理（按顺序）**：H-01 → H-03 → H-04 → H-02（需确认语义）→ H-05 → H-06（需拍板）→ H-07/H-08/H-09 → K-09。

---

## 2. H：代码走查新发现

> 这一组不在现有未完成清单里，或只在审计里出现过一句话、没有排期。证据行号以当前工作区为准，函数名同时给出，防止后续行号漂移。

### H-01 MSSQL「加载全部并导出」仍被旧 guard 挡住

- **优先级/状态**：P1 / ❌
- **文档覆盖**：未提；历史审计只写了导出格式可用。
- **证据**：`src/renderer/src/App.tsx` `loadAllForExport()`（约 3542-3613）在 3556-3558 直接返回 `MSSQL 驱动尚未接入。`；`ExportDialog.tsx:215` 仍提供「加载全部（最多 10000 行）」。
- **现象**：MSSQL 结果页点「加载全部」必失败，但 MSSQL 查询、分页、取消、DDL 都已接入。
- **影响**：MSSQL 用户只能导出当前页；与 README「MSSQL 均已接入真实查询」的观感冲突。
- **建议**：删除该特判，走通用 `query.execute({ maxRows: 10000 })`；保留 `truncated` 提示；补 `e2e:mssql` 导出断言。
- **验收**：MSSQL 查询 200 行 → 导出 → 加载全部 → 200 行可导出；超过 1 万行显示截断提示，不再出现「尚未接入」。

### H-02 新建连接会改绑当前标签并清空 SQL/结果/会话

- **优先级/状态**：P1 / ❓
- **文档覆盖**：未提；与 PRD v0.20 Q27「保存连接是配置（类），tab/session 独立」冲突。
- **证据**：`App.tsx` `saveConnection()`（约 2686-2765）。新建分支在 2725-2731 生成 `nextTab = { ...activeTab, connectionId: 新连接, sql: DEFAULT_SQL, table: undefined }`，随后 2754 关闭旧 session、2755 打开新 session，2757-2764 再创建 browse session。
- **现象**：新建连接保存成功后，当前活动 tab 被改绑、SQL 重置、结果与表元数据清空；用户没有确认机会。
- **影响**：用户在写 SQL 时顺手新建一个连接，会丢掉当前工作；每个新连接固定占两条物理连接（tab + browse），与「右击连接 → 查询才建 tab」的目标交互不一致。
- **建议**：新建连接默认只保存配置，可选打开左侧树；不碰当前 tab。若保留「新建后直接查询」的便利，至少在执行前明确确认。
- **验收**：有未保存 SQL 时新建连接，原 tab 的 SQL/结果/session 不变；新连接出现在左侧树；不自动改绑当前 tab。

### H-03「断开连接」没有关闭独立 browse session

- **优先级/状态**：P1 / ❌
- **文档覆盖**：未提；browse session 是 W-20261109-15 之后的新结构。
- **证据**：`App.tsx` `disconnectConnection()`（约 2834-2845）只遍历 `tabs`；browse session id 由 `browseSessionId()` 生成（约 305），打开/关闭在 `openBrowseConnection()` / `closeBrowseConnection()`（约 1220-1243）。
- **现象**：右击连接「断开连接」后，tab 会话关闭，但 `browse-<connectionId>` 仍 ready；左侧树仍可展开/刷新。若该连接只有树、没有 tab，还会提示「该连接当前没有活动会话」。
- **影响**：「断开连接」语义不完整；用户无法判断是否真的断开；树继续持有物理连接。
- **建议**：同时 `closeTabSession(browseSessionId(id))`、清 `browseConnectionId` 与 browse 缓存；提示改为「已断开连接与对象树」。
- **验收**：展开树 → 右击「断开连接」→ 树收起、状态点变未连接；再展开时重新建会话。

### H-04 连接导入导出往返丢 MSSQL 命名实例，且重复导入无去重

- **优先级/状态**：P1 / ❌
- **文档覆盖**：未提。
- **证据**：`src/shared/connection-export.ts:70-84` 的 mssql 分支没有读取 `instanceName`；`serializeConnections()` 又会把 `instanceName` 原样导出。`src/main/ipc/router.ts:282-291` 导入时逐条 `saveConnection`，没有按 server key/名称去重，`skipped` 只统计校验失败。
- **现象**：命名实例连接导出再导入后变回 `host:port`；同一文件连续导入两次会生成两份连接；导入后密码一律为空，但没有补录提示。
- **影响**：备份/迁移会悄悄改变连接方式；连接列表膨胀；用户容易误以为导入是幂等的。
- **建议**：`normalize()` 补 `instanceName`（与 port 互斥规则保持一致）；导入前按 `serverKey + name` 去重，或提供「跳过/覆盖/新建」策略；导入结果提示「密码为空，请编辑补录」。
- **验收**：命名实例导出 → 清空 → 导入，仍走实例；连续导入两次不产生重复；结果返回 imported/skipped 明细。

### H-05 关闭标签不会取消正在执行的查询

- **优先级/状态**：P1 / ❌
- **文档覆盖**：未提；PRD 只要求「关闭标签/断开/退出时提交/丢弃/取消」。
- **证据**：`App.tsx` `closeTab()`（约 2208-2232）没有取消逻辑；`closeTabSession()`（约 1103-1153）直接 `api.session.close()`；`src/main/services/mysql/MysqlSession.ts:528-530` 的 `close()` 用 `connection.end()`（等当前语句跑完，不发送 `KILL QUERY`）；`ConnectionManager.closeSession()`（约 1220-1227）先删 sessions map 再 close。
- **现象**：关闭正在跑长查询的 MySQL 标签后，查询仍继续执行，历史稍后写入，`runningRequests` 也没有清理。
- **影响**：用户以为已停止；长查询继续占锁/占连接；关闭标签后仍可能收到结果并写历史。
- **建议**：关闭标签前先对 `runningRequests[tabId]` 调 `query.cancel`，等待取消结果，再关闭 session；清理 running 状态。
- **验收**：MySQL `SLEEP(60)` 执行中关闭标签，`SHOW PROCESSLIST` 中查询很快消失或结束；历史状态为 `cancelled`；SQLite/MSSQL 行为保持现状。

### H-06 表数据翻页/排序/过滤/导出重查都会写进历史，且来源固定为 editor

- **优先级/状态**：P1 / ❓
- **文档覆盖**：未提；`QuerySource` 里已有 `grid-edit`，但没有「表数据浏览」来源。
- **证据**：`App.tsx` 三处请求固定 `source: 'editor'`（约 1557、1651、3604）；表数据翻页/排序/过滤走 `runQuery(..., { internal: true })`，`internal` 只控制危险语句检查和分句，不影响历史。
- **现象**：每翻一页、换一次排序或过滤、导出前重查一次，都会新增历史记录，并显示来源「编辑器」。
- **影响**：历史被表浏览淹没；按来源过滤失真；60 秒去重只能合并完全相同的 SQL（翻页 SQL 不同）。
- **建议**：新增 `table-page` / `export` 来源，或约定 `internal` 查询不写历史（需产品拍板）；至少让 `source` 反映真实入口。
- **验收**：连续翻 5 页后历史不新增，或新增记录标为「表数据」；编辑器执行仍记 `editor`；导出重查不产生重复历史。

### H-07 标签自定义名称不持久化

- **优先级/状态**：P1 / ❌
- **文档覆盖**：未提；`UI_TODO` 只列了标签右键菜单本身。
- **证据**：`App.tsx` `persistDraftTabs()`（约 145-163）只存 `id/title/sql/connectionId/filePath/connectionSnapshot`，没有 `customTitle`；`renameTab()`（约 2420-2431）只改内存。
- **现象**：重命名标签后重启应用，标题恢复成自动标题。
- **影响**：用户整理过的标签名丢失；草稿与界面不一致。
- **建议**：`DraftPayload` 增加 `customTitle` 并做长度限制；恢复时写回；补草稿恢复测试。
- **验收**：重命名 → 关闭应用 → 重启，标题保持；清空自定义名后恢复自动标题。

### H-08 SQLite「测试连接」与实际只读回退口径不一致

- **优先级/状态**：P1 / ❌
- **文档覆盖**：未提。
- **证据**：`src/main/services/ConnectionManager.ts` `testSqliteFile()`（约 121-131）用读写方式打开，失败直接报错；`src/main/workers/sqlite-worker.ts` `open()`（约 49-76）在读写打开失败时会再以 `readonly: true` 重开，并让 session 标记 `isReadOnly`。
- **现象**：只读文件或被占用文件「测试连接」失败，但打开会话可以成功（只读）。
- **影响**：用户误以为文件不可用；测试结果与真实会话能力不一致。
- **建议**：测试复用 worker 的 open 逻辑（或捕获后 readonly 重试），结果里返回 readonly 标记与提示。
- **验收**：只读 `demo.db` 测试连接成功并提示「只读模式」；打开会话同样只读；不可读文件仍失败。

### H-09 已保存密码无法清除；编辑连接时测试必须先重输密码

- **优先级/状态**：P1 / ❌（历史审计提过一句「保存密码开关/清除密码」，未排期）
- **证据**：`src/main/storage/metadata.ts` `saveConnection()`（约 496-507）空密码保留旧 secret；`ConnectionDialog.tsx` 没有「保存密码/清除密码」控件；227-229 在「编辑 + 已有密码」时要求重新输入密码才能测试。
- **现象**：无法在本机清除已保存密码；换账号只能删连接重建；测试按钮对已存密码用户不可用。
- **影响**：凭据生命周期不完整；密码轮换/泄露处置困难。
- **建议**：增加「保存密码」开关与「清除已保存密码」；测试连接允许主进程使用已存密码（仍不回传渲染层）。
- **验收**：编辑连接可一键清除密码；测试连接无需重输；密码仍不出主进程。

### H-10 只剩一个普通 SQL 标签时，「关闭」静默无反应

- **优先级/状态**：P2 / ❌
- **文档覆盖**：未提。
- **证据**：`App.tsx` `closeTab()` 第 2211 行 `if (tabs.length <= 1 && !closing.kind) return;`；`Workspace.tsx` 标签右键菜单「关闭」没有按此条件禁用。
- **现象**：单标签时点关闭没有提示、没有动作。
- **影响**：交互像坏了；与「关闭其他/全部」的行为不一致。
- **建议**：菜单项置灰并提示「至少保留一个 SQL 标签」，或允许关闭后自动新建空标签。
- **验收**：单标签时右键「关闭」置灰或有明确提示；不会静默失败。

### H-11 死文件与临时探针脚本留在仓库

- **优先级/状态**：P2 / 🟡
- **文档覆盖**：未提。
- **证据**：`src/renderer/src/components/AgentJobsDialog.tsx` 只有 3 行占位导出（注释说 UI 已迁到 `AgentTabPanel`）；仓库根有未跟踪的 `scripts/tmp-probe-mssql-rows.mjs`、`scripts/tmp-probe-mssql-types.mjs`、`scripts/tmp-probe-tedious.mjs`。
- **现象**：历史遗留 shim 与临时联调脚本混在源码/脚本目录。
- **影响**：新人误读；提交与构建噪音；探针脚本可能含本地环境假设。
- **建议**：确认无引用后删除 `AgentJobsDialog.tsx`；删除或收纳 `tmp-probe-*`（需要的逻辑并入 `check:mssql`）。
- **验收**：`npm run typecheck` / `npm run build` 通过；仓库不再有 `tmp-probe-*` 与无引用 shim。

---

## 3. K：文档已列但代码仍未完成

> 这些不是新发现，详细边界见括号内来源；这里只保证「一眼能看到还欠什么」。

| ID | 缺口 | 来源 | 优先级 | 状态 |
|---|---|---|---|---|
| K-01 | DDL：唯一约束/索引变更进设计页签、CHECK/外键编辑、列序调整、可编辑预览、SQLite 重建保留触发器/视图、MSSQL 默认值/computed/rowversion | `PROJECT_STATUS` §4.7/§5.4、`UI_TODO` §5 | P1/P2 | ❌/⏸ |
| K-02 | 表数据：类型化编辑器、多列排序、多条件 AND 过滤、NULL vs 默认值、`IDENTITY_INSERT`、BLOB 查看器、多行删除、SQLite `rowid`；分页档位补 1000（`Workspace.tsx:704` 目前只有 50/200/500） | `UI_TODO` §4、`PROJECT_STATUS` §2.5 | P1 | 🟡 |
| K-03 | 结果/导出：真流式写文件、进度/取消、>1 万行、选中区域/全部结果集导出、CSV 选项、导出敏感数据提示 | `PROJECT_STATUS` §4.7 | P2 | ❌ |
| K-04 | 编辑器：版本感知补全、类型提示、光标所在语句执行、错误波浪线、`GO 5`、MSSQL `PRINT`/`RAISERROR`/MySQL warning 进消息面板、最近文件/另存为/拖入、参数化执行 | `UI_TODO` §3、`PROJECT_STATUS` §2.2 | P1/P2 | 🟡 |
| K-05 | 历史：列表分页/加载更多（当前固定 200，`HistoryDialog.tsx:175`）、`.sql`/`.csv` 导出、复杂形式的敏感字段脱敏 | `PROJECT_STATUS` §2.3 | P1/P2 | 🟡 |
| K-06 | Agent：30 秒自动刷新、运行中/空闲状态、>1000 作业的服务端分页（`agent-queries.ts:87` 列表无 TOP/OFFSET）、右键菜单完整化、权限不足/Agent XPs 真机回归 | `PROJECT_STATUS` §2.8 | P1/P2 | 🟡 |
| K-07 | 设置：跟随系统主题、字体族/Tab 宽度、补全开关与延迟、快捷键自定义、数据目录迁移、网格偏好 | `PROJECT_STATUS` §2.7 | P2 | ❌ |
| K-08 | 连接：SQLite 文件拖入、认证插件字段、独立「只读连接」标记、Percona 真实实例回归、全量错误码 | `PROJECT_STATUS` §2.1 | P2 | 🟡 |
| K-09 | DDL/刷新后表子对象缓存不失效：`executeDdlScript`（`App.tsx:3477-3487`）未清 `tableExtrasByTab`，`loadTableExtras`（`App.tsx:1054`）命中缓存直接返回；`refreshSchema`（`App.tsx:2453-2459`）同样没清 | `UI_TODO` §0.2（已列，未实现） | P1 | ❌ |
| K-10 | 非功能：打包/签名/安装包、性能基线、无障碍、CI 门禁、崩溃率与冷启动指标 | `PROJECT_STATUS` §4.2/§4.7 | P2 | ❌ |

---

## 4. R：架构已就绪但缺入口/韧性

| ID | 缺口 | 现状与证据 | 影响 | 建议 |
|---|---|---|---|---|
| R-01 | 会话健康检测、心跳、自动重连、错误重试入口 | 全仓未找到应用层 ping/keepalive；`QueryError.retryable` 只在 `App.tsx:342` 显示「可重试」，没有操作入口 | 服务器断连只有下一次执行才暴露；锁等待/死锁只能手动重跑 | 增加轻量 `ping`/重连策略；错误面板提供「重试」；状态栏区分「空闲/断连」 |
| R-02 | 窗口尺寸/位置/最大化记忆 | `src/main/index.ts:24-42` 固定 `width/height`，无状态读写 | 每次启动都回到默认大小 | 记录 bounds 到元数据库或本地配置，恢复时校验可见区域 |
| R-03 | 渲染层错误边界与恢复入口 | `main.tsx:11-29` 只有 `window.error` / `unhandledrejection` 日志；没有 React `ErrorBoundary` | 组件渲染异常会白屏，用户只能杀进程 | 增加错误边界、错误页与「重新加载」；关键页面单独兜底 |
| R-04 | 元数据库逐版本迁移与升级前备份 | `metadata.ts:155-172` 直接写 `user_version = 5`，靠 `ensureLastOpenedColumn` / `ensureServerColumn` 补列；没有按版本分支，也没有升级前自动备份 | 后续 schema 变更缺少统一升级路径；升级失败回滚依赖手工备份 | 引入 `migrations` 表/版本分支；升级前自动 `backup()`；失败回滚并在 UI 提示 |
| R-05 | SQL 文件外部变更检测、另存为、最近文件 | `App.tsx:3687-3746` 只有打开/覆盖保存；保存对话框用已有 `path` 直接覆盖 | 外部编辑后保存会覆盖；没有「另存为」和最近列表 | 保存前比对 mtime/内容；增加「另存为」；最近文件存本地设置 |
| R-06 | MSSQL DDL 会话 SET | 全仓未找到 `ANSI_NULLS` / `QUOTED_IDENTIFIER` 设置；PRD C15 有要求 | 依赖会话选项的 DDL/索引行为可能和 SSMS 不一致 | 在 `ddl:execute` 前按需设置并恢复；补真机用例 |
| R-07 | 库级 DDL 跳过存储过程 | `App.tsx:3250` 注释：「库级 DDL 目前只覆盖表和视图；存储过程留给后续」 | 生成的库级脚本不完整 | 按方言补 `sys.sql_modules` / `SHOW CREATE PROCEDURE` / `sqlite_master` 的适用对象 |
| R-08 | 服务器实体的操作与孤儿清理 | `servers` 表、`server_id`、树形分组已实现（`metadata.ts:127-149`）；`removeConnection` 会清孤儿（563-575），但 `saveConnection` 换 host 时旧 server 行不会清；重命名/删除/健康状态按决策不做 | 数据库里可能积累不可见 server 行；服务器级操作缺失但已明确不做 | 更新连接后清理无引用 server；其余保持 ⏸，不扩大 v1.0 |
| R-09 | `ConnectionTestStatus 'not-implemented'` 与样式残留 | `ipc-contract.ts:45` 定义了该状态，但 `testConnection()` 从不返回；`styles.css:1717` 仍有 `.test-not-implemented` | 类型与样式是早期占位，容易误导 | 删除该状态与样式，或明确保留原因并注释 |

---

## 5. 文档与代码的不一致

| # | 主题 | 文档写法 | 代码现状 | 处理建议 |
|---|---|---|---|---|
| C-01 | 表数据分页档位 | PRD §4.5.2 写 50/200/500/1000；审计 C3 已指出缺 1000 | `Workspace.tsx:704` 只有 `[50, 200, 500]` | 补 1000，或回写 PRD 统一为 50/200/500 |
| C-02 | 新建连接语义 | PRD v0.20 Q27：保存连接是配置，编辑/删除不影响已建 tab session；AGENTS 还写着「当前实现会静默重连绑定标签」 | 编辑连接已不重连（W-20261109-12）；但**新建**连接会改绑当前 tab（H-02） | 先确认 H-02 的产品语义；同步修正 AGENTS 的过期句子 |
| C-03 | 服务器模型 | README 第 148 行仍写「当前实现仍是扁平保存连接」 | `servers` 表 + `server_id` + 左侧树按服务器分组已实现（W-20261109-13/14） | 更新 README 为「服务器实体与分组已实现；服务器级浏览/操作仍按 v1.x/明确不做」 |
| C-04 | MSSQL 导出能力 | README/审计只说 MSSQL 已接入、导出格式可用 | 「加载全部」分支被旧 guard 挡住（H-01） | 修 H-01；文档补一句「导出全部依赖查询重跑，最多 1 万行」 |

---

## 6. 建议实施顺序

### 第一波：修「有入口但走不通/会误伤」

1. H-01 MSSQL 导出 guard（改动小、收益直接）
2. H-03 断开连接关闭 browse session
3. H-04 导入导出命名实例 + 去重 + 密码补录提示
4. H-02 新建连接语义（先确认：只落配置，还是允许改绑但必须确认）
5. H-05 关闭标签先取消查询

### 第二波：一致性与数据安全

1. H-06 内部查询历史来源（需拍板：记但标 `table-page`，还是不记）
2. H-07 `customTitle` 持久化
3. H-08 SQLite 测试与只读回退统一
4. H-09 密码清除/测试连接
5. K-09 DDL 后清表子对象缓存
6. K-02 分页档位补 1000

### 第三波：韧性与长尾

R-01～R-06、H-10、H-11、K-01/K-03～K-08/K-10 按模块排期；K 组不改变「v1.x 明确延后」的既有决策。

**每波完成后的门槛**：

- 代码类：`npm run typecheck` + 对应纯逻辑测试 + `npm run build` + `npm run e2e:sqlite`；MSSQL/MySQL 相关补 `e2e:mssql` / `e2e:mysql`。
- UI 类：真实 Electron 点击验收后再回填 `UI_TODO.md`；不能在沙箱里标「已完成」。
- 文档类：改完状态后追加 `WORKLOG`，并同步 `PROJECT_STATUS` 对应模块的缺口描述。

---

## 7. 证据索引

- 标签/会话/草稿/导出：`src/renderer/src/App.tsx`（`saveConnection`、`disconnectConnection`、`closeTab`、`persistDraftTabs`、`loadAllForExport`、`runQuery`）
- 主进程会话：`src/main/services/ConnectionManager.ts`（`testSqliteFile`、`openSessionById`、`closeSession`、`executeDdl`）
- 驱动关闭/取消：`src/main/services/mysql/MysqlSession.ts`、`src/main/services/mssql/MssqlSession.ts`、`src/main/services/sqlite/SqliteSession.ts`、`src/main/workers/sqlite-worker.ts`
- 连接导入导出：`src/shared/connection-export.ts`、`src/main/ipc/router.ts`
- 元数据库与密码：`src/main/storage/metadata.ts`
- 设置与历史：`src/main/storage/history-store.ts`、`src/renderer/src/components/HistoryDialog.tsx`、`src/shared/settings.ts`
- Agent：`src/main/services/mssql/agent-queries.ts`、`src/renderer/src/components/AgentTabPanel.tsx`、`src/renderer/src/components/Sidebar.tsx`
- 生命周期与安全：`src/main/index.ts`、`src/renderer/src/main.tsx`、`src/main/ipc/router.ts`

---

## 8. 维护记录

| 日期 | 变更 | 记录 |
|---|---|---|
| 2026-11-09 | 创建本文：汇总代码走查新发现的 11 项、文档已列未完成的 10 项、韧性 9 项，并标注文档/代码冲突 | `W-20261109-25` |
