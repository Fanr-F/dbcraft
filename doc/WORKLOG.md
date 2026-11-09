# DBCraft 操作日志

> 用途：记录“什么时候、因为什么、改了什么、怎么验证的”。`doc/PROJECT_STATUS.md` 记录“现在是什么状态”，
> 本文件只追加、不覆写，作为可追溯的变更流水。
>
> 规则（从 2026-11-06 起强制执行）：
>
> 1. 每次改代码、脚本、配置或文档，都在本文件末尾追加一条记录；不删除、不改写历史条目。
> 2. 条目编号 `W-YYYYMMDD-NN`，时间按 Asia/Shanghai。
> 3. 每条必须包含：诉求、变更、涉及文件、验证结果、遗留/风险。
> 4. UI 相关改动必须标注“是否已在真实 Electron 中运行”；未运行就写“未真机验收”，不得写成已验证。
> 5. 涉及需求取舍时，同时更新 `doc/PROJECT_STATUS.md` 对应模块；需求本身不擅自改，只在日志记录偏差。

---

## 2026-11-06

### W-20261106-01 MSSQL 驱动接入（tedious）

- **诉求**：接入 MSSQL，完成连接、查询、对象树、表数据、DDL 查看、表编辑与取消。
- **变更**：
  - 用 `tedious` 单连接实现 `MssqlSession`（不使用 `mssql` 池包装），一个标签一个物理连接。
  - 实现查询、对象树（`sys.objects`）、表元数据/结构、查看 DDL、表数据页、参数化 DML、取消、视图识别。
  - 值保真：`useUTC: true`，datetime/date/time 按 UTC 分量格式化；decimal 转字符串；`sys.objects.type` 做 trim。
  - 元数据查询串行化，规避一个连接同时只能跑一个请求导致的 `EINVALIDSTATE`。
  - 增加 `npm run check:mssql` 真机联调脚本。
- **涉及文件**：`src/main/services/mssql/MssqlSession.ts`、`values.ts`、`ConnectionManager.ts`、
  `src/shared/dialect/identifiers.ts`、`src/shared/dialect/ddl.ts`、`src/shared/errors.ts`、
  `scripts/check-mssql-session.mjs`、`package.json`。
- **验证**：SQL Server 2016 SP2（13.0.5026.0）真机跑通 `check:mssql`；`typecheck` 通过。
- **遗留**：MSSQL UI 建表/改表仍返回“尚未实现”；TLS 严格校验、多 schema、非默认命名实例未回归；
  `datetimeoffset` 偏移、高精度 decimal、datetime2 毫秒精度受驱动限制。

### W-20261106-02 SQL Browser / 命名实例

- **诉求**：支持 `host\instance` 与 SQL Browser（UDP 1434）访问方式。
- **变更**：
  - 连接表单新增可选实例名；支持 `host\instance`、`host:port`、IPv6 归一化；实例名与端口互斥。
  - `MssqlSession` 在实例名存在时把 `instanceName` 交给 tedious，由 SQL Browser 解析端口。
  - `EINSTLOOKUP` 错误补充实例名拼写、Browser 服务、UDP 1434、`host:port` 兜底建议。
  - 两个联调脚本支持 `DBCRAFT_MSSQL_INSTANCE`。
- **涉及文件**：`src/shared/mssql-address.ts`、`src/main/services/mssql/MssqlSession.ts`、
  `src/renderer/src/features/connections/ConnectionDialog.tsx`、`src/shared/errors.ts`、
  `scripts/check-mssql-agent.mjs`、`scripts/check-mssql-session.mjs`。
- **验证**：服务器启动 SQL Server Browser、放行 UDP 1434 后，客户端探测返回
  `InstanceName;MSSQLSERVER;...;tcp;1433`；`DBCRAFT_MSSQL_INSTANCE=MSSQLSERVER` 下
  `check:mssql` 与 `check:mssql-agent` 均通过；错误实例返回 `EINSTLOOKUP`。
- **遗留**：非默认命名实例（如 `SQLEXPRESS`）与动态端口尚未真机回归。

### W-20261106-03 MSSQL Agent 后端

- **诉求**：支持 SQL Server Agent Jobs 的监控、脚本化编辑与生命周期控制（MOD-08）。
- **变更**：
  - 新增纯逻辑查询/脚本模块：作业列表、详情（步骤/计划/最近历史）、启停/启用/禁用脚本、
    共享计划警告、`sp_update_job*` 编辑脚本生成。
  - 生命周期操作写查询历史，`source=agent-control`。
  - IPC 增加 `agent:list/detail/action/script`，同步 zod、router、preload、contract。
  - SQL 认证账号需要 `msdb` 权限；多服务器作业只读。
- **涉及文件**：`src/main/services/mssql/agent-queries.ts`、`agent.ts`、`src/shared/agent.ts`、
  `src/shared/ipc-contract.ts`、`src/main/ipc/schemas.ts`、`router.ts`、`src/preload/index.ts`、
  `scripts/check-mssql-agent.mjs`。
- **验证**：SQL Server 2016 SP2 上创建临时作业，跑通列表/搜索/详情/脚本/禁用拦截/启用/启动/停止/历史，
  `check:mssql-agent` 通过；测试作业已清理。
- **遗留**：Agent XPs 禁用、权限不足、共享计划、多服务器只有代码路径，未真机回归。

### W-20261106-04 Agent UI 第一版：弹窗

- **诉求**：尽快可视化验证 Agent 后端。
- **变更**：对象区加入口，主区域弹窗展示作业列表/详情/生命周期/脚本。
- **验证**：无 Electron 真机运行；仅后端联调。
- **结果**：不符合 PRD 的独立页签要求，后续两次重构。

### W-20261106-05 Agent UI 第二版：对象树入口 + 主区域页签

- **诉求**：对齐 PRD：`SQL Server Agent → 作业` 节点，双击打开作业列表页签，双击行开详情页签。
- **变更**：
  - 新增 `AgentTabPanel`，列表/详情作为主区域页签；同一作业重复打开聚焦已有详情页签。
  - 生命周期操作后跨页签刷新；T-SQL 步骤支持“打开命令/复制”。
  - 移除弹窗渲染；`AgentJobsDialog.tsx` 置为兼容空壳。
- **涉及文件**：`AgentTabPanel.tsx`、`Sidebar.tsx`、`Workspace.tsx`、`App.tsx`、`types.ts`、`styles.css`。
- **验证**：`typecheck`、21 组纯逻辑测试通过；UI 未真机验收。
- **遗留**：PRD 的列表页签仍不是用户想要的形态。

### W-20261106-06 密码存储核查（只读审计，无代码变更）

- **诉求**：确认数据库密码是否明文落盘，是否有类似 `Bun.secrets` 的方案。
- **结论**：
  - 密码经 Electron `safeStorage` 加密为 BLOB 存在 `connections.secret`；Windows 为 DPAPI。
  - 渲染层拿不到密码；`listConnections` 剥离 password，只有主进程 `getConnectionInput()` 解密。
  - 加密不可用时选择不保存密码，不退化为明文；日志只记录 `passwordStored`。
  - 与 `Bun.secrets` 相比安全等级接近；元数据库本身不是整库加密。
  - 与 PRD 的“safeStorage 不可用回退 AES-GCM + 主密码”不一致；且没有“不保存密码/清除已保存密码”开关。
- **验证**：源码核对，未修改代码。
- **遗留**：可选做“保存密码”开关、AES-GCM 回退、Windows 凭据管理器集成（评估 `@napi-rs/keyring`）。

### W-20261106-07 剩余工作盘点（只读审计，无代码变更）

- **诉求**：对照 PRD v0.16 / 状态文档 / 源码，列出未完成工作。
- **结论要点**：
  - M1 收口：`build`/`smoke`/`e2e:sqlite`/真实 UI dogfood 未完成；MOD-02 列/别名补全缺失；
    MOD-01 认证插件与 SQLite 拖入缺失；MOD-07 多项基础设置缺失。
  - M3 最大 P0 空窗：MSSQL UI DDL 全部返回“尚未实现”；新表向导缺索引/外键/CHECK/注释页签；
    CHECK 约束不能编辑。
  - MOD-08 剩余：>1000 作业分页、30s 刷新、运行中状态、权限/XPs 真机回归。
  - 非功能：打包/签名、CI、性能/无障碍、流式导出、多结果集/消息面板。
- **验证**：源码抽查（`ddl.ts`、补全候选、导出上限、`TableDesigner`）。
- **遗留**：该盘点已纳入 `doc/UI_TODO.md` 与后续 UI 迭代。

### W-20261106-08 Agent UI 第三版：左侧树展开（当前形态）

- **诉求**：左侧对象列表全部用树结构展开；不要点“作业”弹出一个列表页签。
- **变更**：
  - 左侧对象树支持 `SQL Server Agent → 作业 → 作业项` 三级展开；作业直接列在树中。
  - 表/视图改为可折叠树节点；对象搜索同时过滤作业。
  - 作业项显示启用状态点、禁用/MSX 标记；单击选中、双击打开详情页签。
  - 删除“作业列表”页签类型与入口；`Workspace` 只保留作业详情页签。
  - 作业按标签缓存；展开时自动加载；切换标签/连接自动加载；生命周期操作后清缓存并刷新。
  - 会话未就绪时在树内显示错误，不静默失败。
- **涉及文件**：`Sidebar.tsx`、`App.tsx`、`Workspace.tsx`、`types.ts`、`styles.css`。
- **验证**：`npm run typecheck` 通过；21 组 `test:*` 全部通过；**UI 未真机验收**。
- **遗留/偏差**：作业详情仍用页签（用户只明确否定了列表页签）；PRD 4.8.2 的列表页签被本形态覆盖，
  已写入 `PROJECT_STATUS.md` §2.8；作业数 >1000 时树的性能未验证。

### W-20261106-09 文档记录制度与 UI 清单

- **诉求**：所有操作都要记录文档；接下来从 UI 开始逐项调整。
- **变更**：
  - 新增本文件 `doc/WORKLOG.md`，作为追加式操作日志。
  - 新增 `doc/UI_TODO.md`，作为 UI 逐项调整清单与验收口径。
  - `README.md` 文档索引、`PROJECT_STATUS.md` §7、`AGENTS.md` 记录规则同步。
- **验证**：文档变更，无代码影响。
- **后续**：每次 UI 调整先更新 `UI_TODO` 状态，完成后在 `WORKLOG` 追加条目。

### W-20261106-10 多数据库对象树（数据库 → 表/视图/存储过程 → 表下约束/触发器/索引）

- **诉求**：连接 MSSQL / MySQL 后左侧树列出所有有权限的数据库；库下分表/视图/存储过程；
  表下再展开约束、触发器、索引；连接后要能选择数据库。
- **后端变更**：
  - `SchemaObject.type` 增加 `procedure`；新增 `DatabaseInfo` / `TableExtras` / `TableConstraintInfo` /
    `TableTriggerInfo` 及结果类型。
  - `DatabaseSession` 增加 `databases()`、`useDatabase()`、`tableExtras(database, table)`；
    MSSQL / MySQL / MariaDB / SQLite 全部实现。
  - MSSQL：`sys.databases` 列表、`[db].sys.objects` 跨库对象、`[db].sys.objects/triggers/indexes` 子对象、
    `USE [db]` 切换；表名仍用 `schema.table`（dbo 短名）。
  - MySQL / MariaDB：`SHOW DATABASES`、`information_schema.TABLES/ROUTINES/TABLE_CONSTRAINTS/TRIGGERS/STATISTICS`、
    `USE \`db\``。
  - SQLite：单库 `main`，`PRAGMA` 实现索引/触发器/主键/唯一/外键子对象；切换库明确报错。
  - IPC 增加 `schema:databases` / `schema:use-database` / `schema:table-extras`；
    `schema:get` 增加 `database` 选项；契约、zod、router、preload 同步。
  - 新增 `scripts/check-mssql-multidb.mjs` 与 `npm run check:mssql-multidb`。
- **前端变更**：
  - 新增 `ObjectTree.tsx`：多库树、表/视图/存储过程折叠、表下约束/触发器/索引懒加载；
    表节点 chevron 与“打开查询/双击数据”分离。
  - `Sidebar.tsx` 使用 `ObjectTree`，对象搜索同时过滤作业；右键菜单携带 `database`。
  - `App.tsx` 增加 database 状态（列表、当前库、按库对象、表子对象、加载态）；`switchDatabase` / `ensureDatabase`；
    打开新标签时把目标库传给会话；表数据页记录 `table.database` 并在每次查询/元数据/DML 前确保切库。
  - 修复了 UI 层残留的 MSSQL 拦截：`runQuery`、`openTableData`、`openTableStructure` 不再误报“驱动未接入”；
    `openAlterColumn` 改为准确的“MSSQL UI 改列尚未实现”。
  - 表格页签标题带数据库名，避免跨库同名表混淆。
- **涉及文件**：`src/shared/ipc-contract.ts`、`src/main/services/DatabaseSession.ts`、
  `services/mssql/MssqlSession.ts`、`services/mysql/MysqlSession.ts`、`services/mariadb/MariaSession.ts`、
  `services/sqlite/SqliteSession.ts`、`services/ConnectionManager.ts`、`src/main/ipc/schemas.ts`、`router.ts`、
  `src/preload/index.ts`、`src/renderer/src/components/ObjectTree.tsx`、`Sidebar.tsx`、`App.tsx`、
  `src/renderer/src/types.ts`、`src/renderer/src/styles.css`、`scripts/check-mssql-multidb.mjs`、`package.json`。
- **验证**：
  - `npm run typecheck` 通过；21 组 `test:*` 全部通过。
  - `npm run check:mssql` / `check:mssql-agent` 回归通过。
  - 新增 `check:mssql-multidb` 在 SQL Server 2016 SP2 通过：列出 master/model/msdb/tempdb、
    tempdb 跨库表+存储过程、USE 切换与恢复、约束 2 / 触发器 1 / 索引 2；临时对象已清理。
  - **MySQL/MariaDB 未真机验证**：便携实例下载被当前网络/沙箱 TLS 拦住
    （`curl: schannel SEC_E_NO_CREDENTIALS`），只做了类型检查与 SQL 走查。
  - **UI 未真机验收**。
- **遗留/风险**：
  - MySQL/MariaDB 的 `SHOW DATABASES`、`ROUTINES`、`TRIGGERS` 查询需真实实例回归。
  - 多库树首次只加载当前库；其它库展开时加载。搜索目前只搜当前库，跨库搜索未做。
  - 每个表页签独立会话，打开时会先连默认库再 `USE` 目标库；切换数据库期间若同一会话有查询在跑，
    MSSQL 单请求限制仍可能报 `EINVALIDSTATE`（原有并发限制）。
  - 表下子对象每次展开才加载，未做缓存失效；右键菜单的后续 DDL 弹窗若期间切换库，执行目标可能变化。

### W-20261106-11 修复执行 SQL 后结果表格空白（RevoGrid / Vite 开发模式）

- **诉求**：执行 SQL 后工具栏显示行数，但结果区空白，看起来像“没有数据返回”。
- **排查**：
  - 主进程日志与历史记录确认查询已返回行（SQLite 100 行、MSSQL 100 行），问题在渲染层。
  - 开发模式控制台报 `InvalidCharacterError: Failed to execute 'createElementNS' ... '[object Object]'`，
    RevoGrid 渲染时拿到非字符串的 vnode tag，随后 `<!---->` 空壳。
  - 同一份代码生产构建正常，定位为 Vite 依赖预打包与 RevoGrid（Stencil）懒加载入口不兼容；
    不是数据库驱动或查询结果本身的问题。
- **变更**：`electron.vite.config.ts` 的 renderer 增加
  `optimizeDeps.exclude: ['@revolist/react-datagrid', '@revolist/revogrid']`，
  让 Stencil 自己处理懒加载入口。`main.tsx` 曾临时移除 `StrictMode` 排查，已还原，未保留改动。
- **涉及文件**：`electron.vite.config.ts`。
- **验证**：
  - 开发模式（`npm run dev`）执行 `SELECT name, type FROM sqlite_master LIMIT 5` 正常显示 2 列 5 行；
    执行 `SELECT TOP (10) * FROM master..spt_values` 正常显示 6 列 10 行。
  - 排查时用 CDP 观察 `<revo-grid>`：修复前 `innerHTML` 只有 `<!---->`，修复后包含完整表头/行节点。
  - `npm run build`（含 `typecheck`）通过；生产构建行为未变。
- **遗留/风险**：该故障仅出现在 Vite 开发模式；生产构建原本正常。升级 RevoGrid 后需再次回归
  `npm run dev` 下的查询结果渲染。

### W-20261106-12 连接列表与对象树合并；MSSQL 系统库对象可见

- **诉求**：
  - 保存连接列表与下方对象树合并成一个树：分组下直接列连接，连接节点可打开/关闭，当前连接的对象树内联显示。
  - MSSQL 的 SQL Server Agent 放到对象树最后；空表/空视图不再显示“无表/无视图”等空文案。
  - MSSQL 能看到 `master` / `msdb` 的系统表。
- **变更**：
  - `Sidebar.tsx`：移除独立的“对象”区域，改为单棵树；连接节点增加打开/关闭 chevron、连接状态点
    （已连接 / 连接中 / 连接失败 / 未连接）；对象操作按钮和“显示系统对象”开关移到当前连接节点下；
    Agent 节点移到对象树之后；搜索框合并为“搜索连接 / 表 / 视图 / 作业”。
  - `App.tsx`：按所有标签的会话状态聚合每个保存连接的连接状态；切换“显示系统对象”时清空该标签的
    库对象缓存，避免其他数据库沿用旧开关的缓存。
  - `ObjectTree.tsx`：表/视图/存储过程以及表子对象为空时不再渲染空文案。
  - `styles.css`：新增合并树、连接状态点、连接展开按钮和对象操作行样式。
- **涉及文件**：`src/renderer/src/components/Sidebar.tsx`、`ObjectTree.tsx`、`src/renderer/src/App.tsx`、
  `src/renderer/src/styles.css`。
- **验证**：
  - `npm run typecheck`、`npm run build`、`npm run test:groups` 通过。
  - Electron 45（构建版）+ CDP 实测：连接 22（MSSQL）打开后状态点为“已连接”，切换 demo.db 后
    22 变为“未连接”、demo.db 为“已连接”；对象树在连接节点内联显示。
  - 打开“显示系统对象”后 `master` 显示 5 张系统表 / 1 个视图 / 2 个存储过程（含 `spt_values`）；
    切到 `msdb` 显示 144 张表（含 `sysjobs`、`sysjobhistory` 等）。关闭开关并重新加载时不再显示这些对象。
  - Agent 节点位于数据库/表/视图/存储过程之后；空表/空视图不再出现“无表/无视图”文案。
  - UI 已在真实 Electron 构建版中通过 CDP 操作验收；开发模式本轮未重复完整回归。
- **遗留/风险**：
  - 受“一标签一物理会话”约束，树中只内联当前活动标签所属连接的对象；其他连接即使状态点为已连接
    （被其他标签持有），也不会展开对象。
  - 对象搜索仍只覆盖当前库，跨库搜索未做。
  - MySQL / MariaDB 的合并树路径只做了类型检查和逻辑走查，未用真实实例回归。

### W-20261106-13 未连接时隐藏对象树细节

- **诉求**：连接未打开/已断开时，不应继续显示表、视图、存储过程等对象细节。
- **变更**：
  - `Sidebar.tsx` 增加 `activeSessionStatus`，对象树、对象操作、系统对象开关、Agent 仅在会话 `ready` 时渲染；
    未就绪时只显示“未连接 / 正在连接… / 连接失败”单行提示。
  - `App.tsx` 把当前活动标签的会话状态传入侧边栏。
- **涉及文件**：`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/App.tsx`。
- **验证**：
  - `npm run typecheck`、`npm run build` 通过。
  - Electron 45 构建版 + CDP：打开 demo.db 后显示表/视图；右键“断开连接”后表/视图消失，只显示“未连接”，
    状态点变灰；重新点击连接可恢复。
- **遗留/风险**：无新增已知问题。

### W-20261109-01 MOD-03 查询历史收口

- **诉求**：PRD 4.3 的查询历史主路径已存在，但入口、搜索反馈与若干设置项未对齐；本轮补齐
  `Ctrl/Cmd+E`、搜索命中高亮、右键“从历史插入”、已删除连接标记、复制/仅看此连接、
  今天/自定义时间范围、默认脱敏、去重开关、不限制保留条数，以及“再次执行回到原连接/原库”。
- **变更**：
  - `App.tsx`：增加全局 `Ctrl/Cmd+E`（弹窗已打开时不叠加）；新增 `runHistoryRecord`，
    原连接存在时在当前 SQL 标签或新标签中回到原库执行，原连接已删除时只插入编辑器并提示。
  - `HistoryDialog.tsx` / `HistoryDetailDialog.tsx`：搜索命中高亮改为“命中附近片段”而非只看首行；
    行操作增加复制 SQL、仅看此连接、详情、执行、删除；已删除连接显示标记并仍可按连接筛选；
    时间范围增加“今天”和自定义起止时间；默认脱敏读取设置。
  - `SqlEditor.tsx` / `Workspace.tsx`：编辑器右键菜单“从历史插入”；历史记录插入到光标/选区位置。
  - `settings.ts` / `ipc-contract.ts` / `schemas.ts` / `SettingsDialog.tsx`：新增 `historyDedupe`、
    `historyMask`；保留条数增加“不限制”（0），`recordHistory` 在 0 时跳过淘汰。
  - `history-store.ts` / `metadata.ts` / `schemas.ts`：支持 `dedupe=false` 与 `until` 时间上界。
  - `Workspace.tsx`：修复“新建查询”按钮把 React 事件对象误当 `connectionId`、导致新标签未绑定连接的缺陷。
  - `e2e-sqlite.mjs`：同步合并树后的 `.object-tree-body` 选择器、执行按钮 `exact`、新建表入口、
    带库名的表页签标题；删除列的断言改为等待网格刷新；历史用例改为 `Ctrl+E` + 搜索高亮。
  - `test-history.mjs` / `test-settings.mjs`：覆盖 `until`、关闭去重、不限制保留、去重/脱敏设置归一化。
- **涉及文件**：`src/shared/ipc-contract.ts`、`src/shared/settings.ts`、`src/main/ipc/schemas.ts`、
  `src/main/storage/history-store.ts`、`src/main/storage/metadata.ts`、`src/renderer/src/App.tsx`、
  `src/renderer/src/components/HistoryDialog.tsx`、`HistoryDetailDialog.tsx`、`SettingsDialog.tsx`、
  `Toolbar.tsx`、`Workspace.tsx`、`Icon.tsx`、`src/renderer/src/features/editor/SqlEditor.tsx`、
  `src/renderer/src/styles.css`、`scripts/e2e-sqlite.mjs`、`scripts/test-history.mjs`、`scripts/test-settings.mjs`。
- **验证**：
  - `npm run typecheck`、`npm run test:history`、`npm run test:settings`、`npm run test:groups` 通过。
  - `npm run e2e:sqlite` 的历史用例实际执行通过：`Ctrl+E` 打开面板、列表含执行过的 SQL、
    搜索 `SELECT` 后出现 `.history-match`、点击记录插入编辑器；本轮同时修复了新标签未绑定连接的缺陷。
  - 完整 `e2e:sqlite` 仍在最后的“查询超时”断言失败：E2E 通过环境变量 `DBCRAFT_QUERY_TIMEOUT_MS=2000`
    设置超时，但渲染层现在总会下发设置面板的 `queryTimeoutMs`（默认 30 秒）并覆盖环境变量，
    属于既有测试漂移，与本次历史改动无关。
- **UI 验收**：历史面板相关路径已在真实 Electron 构建版中由 E2E 驱动；未做人工点击验收，
  `UI_TODO.md` 仍标“进行中”。
- **遗留/风险**：
  - 历史列表固定最多展示 200 条，尚未做“加载更多/分页”。
  - 默认脱敏只覆盖赋值型敏感字段；`INSERT` 值列表等复杂形式仍需人工确认。
  - 历史“再次执行”会复用当前同连接 SQL 标签或新建标签；不会覆盖其他标签或已打开文件标签。

### W-20261109-02 标签与会话一一对应：切换连接不再改绑当前标签

- **诉求**：标签和会话是一一对应的强约束。打开另一个数据库连接时，不能把当前标签改成另一台数据库服务器的查询，
  也不能清空当前标签的 SQL 与结果。
- **变更**：
  - 删除 `rebindActiveTab`；新增 `selectConnectionTab`（`App.tsx`）。
  - 选择连接时：当前标签已属于该连接则保持不动并确保会话可用；已有其他标签属于该连接则激活；
    都没有则新建一个绑定该连接的查询标签。
  - 工具栏连接下拉与左侧连接节点都改用 `selectConnectionTab`，不再修改任何已有标签的 `connectionId`。
  - 删除连接时仍只清空受影响标签的绑定（既有行为），不属于改绑。
- **涉及文件**：`src/renderer/src/App.tsx`。
- **验证**：
  - `npm run typecheck`、`npm run build` 通过。
  - 代码走查：`QueryTab.connectionId` 仅在新建标签、草稿恢复、删除连接清空绑定时写入，
    不再存在“把当前标签改到另一个连接”的路径。
  - UI 未做人工点击验收；切换连接后原标签 SQL/结果是否保持，需在真实 Electron 中确认。
- **遗留/风险**：
  - 同一连接存在多个标签时，选择连接会优先激活第一个普通 SQL 标签；若用户期望激活最近使用的标签，
    需要额外记录标签的最近激活时间。
  - 多页面签暂不支持拖拽到另一连接；跨连接操作一律通过新建标签完成。

### W-20261109-03 新建表/编辑表结构改为页签 + DDL 差异生成

- **诉求**：右击需要「编辑表结构」「新建表」，并且不要弹窗，直接打开页签；保存后按新建/编辑生成 DDL 并执行。
- **变更**：
  - 新增 `shared/dialect/table-diff.ts`：统一处理新建表与编辑表结构。
    - 新建：`buildCreateTable`。
    - 编辑：按列差异生成 `RENAME TABLE` / `ADD COLUMN` / `DROP COLUMN` / `RENAME COLUMN` /
      `MODIFY COLUMN`；无变化时明确报错。
    - 主键/自增不允许在编辑页签中新增、取消、删除或修改列定义；新增列不能设为主键/自增。
    - SQLite 修改列类型/可空/默认值时改为整表重建。
  - `shared/dialect/sqlite-rebuild.ts` 增加 `buildSqliteRebuildTable`：按完整目标列重建，
    迁移现存列数据、保留主键/自增、重映射并重建显式索引；外键/CHECK/触发器/表注释不保留并警告。
  - 新增 `renderer/src/components/TableDesignTab.tsx`，`QueryTab` 增加 `kind = 'table-design'`
    与 `tableDesign` 元数据；设计页签使用独立会话，不复用来源 SQL 标签的 session。
  - `App.tsx` 新增 `openTableDesignTab` / `executeTableDesign`：
    新建和编辑都打开新页签；编辑先读取 `schema:describe`；执行成功后关闭设计页签、回到来源标签并刷新对象树。
  - `Sidebar.tsx`：表右键菜单增加「编辑表结构…」「新建表…」，原「表结构…」改为「查看表结构…」；
    连接右键菜单增加「新建表…」；左上角新建表按钮改为打开页签。
  - `Workspace.tsx` / `styles.css`：表设计页签布局；删除旧 `TableDesigner.tsx` 弹窗。
  - 删除列时必须在预览页输入原表名确认，满足 AGENTS 的删除列确认约束。
  - E2E 扩展：新建表页签 → 预览 → 执行 → 对象树刷新；右击编辑表结构 → 添加列 → 执行；
    再改列类型触发 SQLite 整表重建。查询超时用例改为先通过设置面板设 10 秒，整套 E2E 可通过。
- **涉及文件**：`src/shared/dialect/table-diff.ts`、`src/shared/dialect/sqlite-rebuild.ts`、
  `src/renderer/src/components/TableDesignTab.tsx`、`Workspace.tsx`、`Sidebar.tsx`、`App.tsx`、
  `src/renderer/src/types.ts`、`src/renderer/src/styles.css`、`scripts/test-ddl.mjs`、
  `scripts/test-sqlite-rebuild.mjs`、`scripts/e2e-sqlite.mjs`；删除 `components/TableDesigner.tsx`。
- **验证**：
  - `npm run typecheck`、`npm run build` 通过。
  - `npm run test:ddl`（新增 table design 用例）、`npm run test:sqlite-rebuild`（新增整表重建回放）、
    `npm run test:settings`、`npm run test:history` 通过。
  - `npm run e2e:sqlite` 全套通过：新建表页签执行 CREATE；编辑页签 ADD COLUMN；
    修改列类型触发 `__dbcraft_rebuild_*` 多语句重建；对象树刷新正常。
- **UI 验收**：SQLite 路径已在真实 Electron 构建版中由 E2E 驱动；未做人工点击验收。
- **遗留/风险**：
  - MySQL / MariaDB 的编辑差异只做类型检查与 SQL 生成，未用真实实例回归；MariaDB 列重命名版本差异沿用既有警告。
  - MSSQL 的 UI 建表/改表仍不支持，入口会直接提示使用 SQL 编辑器。
  - SQLite 整表重建不保留外键、CHECK、触发器与表注释，预览中有警告；外键/触发器需人工重建。
  - 编辑页签暂不处理唯一约束与索引变更，仍通过「创建索引/删除索引」入口完成。

### W-20261109-04 表设计页签执行前选择数据库

- **诉求**：「执行 DDL」按钮前增加数据库下拉框；SQLite 只有 main/表，不显示。
- **变更**：
  - `TableDesignTab.tsx` 在预览页脚、执行按钮前增加「数据库」下拉框。
  - 非 SQLite 连接从 `schema:databases` 的可见库列表渲染；SQLite 隐藏。
  - 新建表可选择目标库；切换时通过现有 `switchDatabase` 对设计页签自己的会话执行 `USE`，
    切换期间禁用下拉与执行按钮，避免 DDL 发到旧库。
  - 编辑表结构时数据库固定为表所在库，下拉框禁用并提示，避免误改其他库的同名表。
  - `Workspace.tsx` / `App.tsx` 透传设计页签的数据库列表、当前库和切换回调。
  - E2E 增加 SQLite 下不渲染数据库下拉的断言。
- **涉及文件**：`src/renderer/src/components/TableDesignTab.tsx`、`Workspace.tsx`、`App.tsx`、
  `src/renderer/src/styles.css`、`scripts/e2e-sqlite.mjs`。
- **验证**：
  - `npm run typecheck`、`npm run build`、`npm run e2e:sqlite` 通过。
  - SQLite 新建表预览页确认 `.table-design-db` 数量为 0。
- **遗留/风险**：
  - MySQL / MariaDB / MSSQL 的数据库下拉只做类型检查与逻辑走查，未连接真实实例点击验证。
  - MSSQL 仍不支持 UI 建表/改表，进入页签前已被拦截，因此该下拉实际只在 MySQL 系可见。
  - 编辑模式固定库；若后续需要“跨库复制表结构”，应新建表而不是切换编辑目标库。

### W-20261109-05 MSSQL schema 树与 UI 建表/改表（含 IDENTITY）

- **诉求**：MSSQL 支持 schema，表/视图/存储过程下面出现 schema 分支；表设计支持 IDENTITY。
- **后端变更**：
  - `SchemaObject` 增加可选 `schema`；`MssqlSession.schema()` 返回 `schema`，`name` 仍保留 `schema.table` 供现有打开/DDL/DML 使用。
  - `ddl.ts` 解除 MSSQL 拦截，补齐 MSSQL 方言生成：
    - `CREATE TABLE [schema].[table]`，支持 `IDENTITY(1,1)`、NOT NULL、DEFAULT、单列主键/唯一。
    - `ADD COLUMN`、`DROP COLUMN`、`ALTER COLUMN`（类型/可空）、`sp_rename` 表/列重命名、索引创建/删除、DROP TABLE/VIEW、CREATE VIEW。
    - MSSQL 修改默认值需要先删除默认约束，表结构页签明确拒绝默认值变更。
  - `table-diff.ts` 增加 `schema` 输入；MSSQL 使用 `schema.table` 参与差异和 ALTER 生成，禁止在编辑页签切换 schema。
- **UI 变更**：
  - `ObjectTree` 在 MSSQL 的「表 / 视图 / 存储过程」文件夹下按 schema 分组；对象行显示不带 schema 前缀的名称。
  - `TableDesignTab` 增加 MSSQL Schema 输入（新建可编辑，编辑固定）、MSSQL 类型建议；「自增」列头在 MSSQL 显示为 Identity。
  - 新建表从 schema 分支右击进入时继承该 schema；对象区「新建表/新建视图」不再对 MSSQL 禁用。
  - MSSQL 的添加列/重命名列/修改列/删除列统一转到「编辑表结构」页签，避免旧弹窗静默忽略默认值等属性。
- **涉及文件**：`src/shared/ipc-contract.ts`、`src/shared/dialect/ddl.ts`、`src/shared/dialect/table-diff.ts`、
  `src/main/services/mssql/MssqlSession.ts`、`src/renderer/src/components/ObjectTree.tsx`、`Sidebar.tsx`、
  `TableDesignTab.tsx`、`Workspace.tsx`、`App.tsx`、`src/renderer/src/types.ts`、`styles.css`、
  `scripts/test-ddl.mjs`、`scripts/check-mssql-session.mjs`。
- **验证**：
  - `npm run typecheck`、`npm run build`、`npm run test:ddl`、`npm run test:sqlite-rebuild`、
    `npm run e2e:sqlite` 通过。
  - `npm run check:mssql` 在 SQL Server 2016 SP2 真机通过；新增 `[UI DDL]` 用例：
    `CREATE TABLE [dbo].[x]` + `IDENTITY(1,1)` → ADD COLUMN → sp_rename 列 → ALTER COLUMN →
    插入验证自增 → DROP COLUMN → sp_rename 表 → DROP TABLE。
  - 对象树接口返回 `schema=dbo`，状态文档能力已更新。
- **UI 验收**：MSSQL schema 树和表设计页签未做人工 Electron 点击验收；后端 DDL 已真机回放。
- **遗留/风险**：
  - MSSQL 表设计暂不支持编辑默认值、CHECK/外键/触发器、computed/rowversion 列。
  - schema 树目前只做展示分组；跨 schema 移动表仍需 SQL 编辑器。
  - MySQL / MariaDB 没有独立 schema 层，未加分组。

### W-20261109-06 需求梳理与隐藏需求审计

- **诉求**：重新梳理需求文档，区分「用户明确提出的需求」「PRD 自己扩展出来的隐藏需求」「技术选型/远期规划」，
  并逐项对照代码说明已做/未做，避免把 P1、选型和非功能要求混进 v1.0 验收。
- **变更**：
  - 新增 `doc/REQUIREMENTS_AUDIT.md`：
    - 按 L0 明确需求 / L1 支撑能力 / L2 文档推导 / L3 技术选型分层；
    - 列出 4 项核心需求 + MSSQL Agent + 五类数据库的现状；
    - 按连接、编辑器、历史、DDL、表数据、结果导出、设置安全、Agent、非功能九组列出隐藏需求与状态；
    - 汇总 22 条 PRD 与代码/状态文档的硬冲突（默认行数、多语句/多结果集、网格事务连接、Agent 入口、技术栈等）；
    - 给出 v1.0 建议基线、v1.x 降级项、建议删除项，以及 12 个待拍板问题。
  - `README.md`：文档索引补充 `REQUIREMENTS_AUDIT.md`；修正「MSSQL UI 建表/改表尚未接入」的过期描述。
  - `doc/PROJECT_STATUS.md`：对照文档补充审计文档；修正 §5.1/§5.2/§5.6 中 MSSQL UI 建表/改表仍「尚未实现」的过期描述。
  - 未修改 `doc/PRD.md`：按 AGENTS 约定，需求取舍需确认后再回写，本次只输出审计与建议。
- **涉及文件**：`doc/REQUIREMENTS_AUDIT.md`、`README.md`、`doc/PROJECT_STATUS.md`、`doc/WORKLOG.md`。
- **验证**：对照 PRD v0.16、PROJECT_STATUS、UI_TODO 与源码抽查（`ipc-contract.ts`、`settings.ts`、
  `App.tsx`、`SqlEditor.tsx`、`ResultGrid.tsx`、`TableDesignTab.tsx`、`ddl.ts`、`dml.ts`、`agent*.ts` 等）
  人工核对；文档改动，未运行构建与测试。
- **遗留/风险**：
  - 审计中的状态判断以当前工作区为准；未提交改动（表设计页签、MSSQL schema/IDENTITY）已计入。
  - 隐藏需求的「保留/降级/删除」只是建议，需用户确认后再改 PRD 与里程碑。
  - 未逐项跑真实 Electron 验收；历史 E2E 与真机结论沿用 `PROJECT_STATUS.md` 的记录。

### W-20261109-07 PRD v0.17：需求分层与范围决策落地

- **诉求**：根据用户 2026-11-09 的选择，把 PRD 拆成「v1.0 基线 / v1.x 候选 / 技术附录」，
  并落地完整补全、编辑器内多语句/多结果、结果集「不限制」档位、Agent 左侧树形态。
- **变更**：
  - `doc/PRD.md` 升级 v0.17：
    - 新增 §0「需求分层与 v1.0 基线」，列 L0～L3 分层、v1.0 模块承诺、2026-11-09 决策；
    - MOD-02 补全改为完整补全（列/别名/函数/库/Schema/版本感知/自动触发/schema 缓存）；
    - MOD-02 明确编辑器内多语句 + 多结果页签进入 v1.0；
    - 结果集默认改为 2000，档位增加「不限制」，选择时提示内存/性能风险；
    - Agent 入口改为左侧树 + 详情页签，删除作业列表页签要求；
    - 连接超时默认值改为连接/测试 8 秒、查询 30 秒，与实现一致；
    - 删除连接池表述，会话模型统一为「一个标签 = 一个 session = 一个物理连接」；
    - 新增 §9 v1.x 候选与明确不做、§10 技术与非功能附录，原 §9 附录顺延为 §11；
    - 新增 Q16～Q20（网格事务连接、非功能阻塞、流式导出、密码回退、技术栈迁移）；
    - M1 里程碑同步为完整补全 + 多语句/多结果。
  - `doc/PROJECT_STATUS.md`：PRD 对照升级 v0.17；D-4～D-8 更新为当前决策与缺口；
    MOD-02/MOD-06 缺口标注 v1.0 P0 与 v1.x；§4.7 剩余工作同步。
  - `README.md`：尚未接入列表改为「完整补全 / 编辑器内多语句/多结果 / 结果集不限制档位」。
  - `doc/REQUIREMENTS_AUDIT.md`：新增决策记录；Q2/Q3/Q4/Q8/Q12 标记已定；下一步调整。
  - `doc/TECH_DESIGN.md`：对应 PRD 改为 v0.17，注明多语句/多结果、完整补全等设计待补；Agent 入口描述同步。
  - `AGENTS.md`：结果集/单语句约束补充「PRD v0.17 目标」，避免把当前实现误写成最终产品边界。
- **涉及文件**：`doc/PRD.md`、`doc/PROJECT_STATUS.md`、`README.md`、`doc/REQUIREMENTS_AUDIT.md`、`doc/TECH_DESIGN.md`、`AGENTS.md`、`doc/WORKLOG.md`。
- **验证**：文档交叉核对；未运行构建与测试。PRD 中与实现冲突的默认值、多语句、Agent 入口、连接池等描述已统一；
  仍未关闭的 Q16～Q20 保留在 §8。
- **遗留/风险**：
  - PRD v0.17 把完整补全、编辑器内多语句/多结果、结果集「不限制」列为 v1.0 P0，当前代码仍是缺口；
    这是需求先行，不是已实现。
  - 网格事务连接、非功能阻塞、流式导出、密码回退、技术栈迁移仍未拍板。
  - 实现时需重做主查询/结果区与补全缓存；在完成前 `PROJECT_STATUS.md` 已按 P0 欠账记录。

### W-20261109-08 连接 / 服务器 / 标签 / 会话模型补充审计

- **诉求**：继续排查用户没说但实际存在的隐藏需求，重点梳理「标签与连接」「服务器与连接」的关系以及如何管理。
- **变更**：
  - 新增 `doc/CONNECTION_TAB_MODEL.md`：
    - 记录当前模型：保存连接 = 配置；SQL 标签 = session = 物理连接；没有独立服务器实体；对象树只服务当前活动标签；
    - 列出隐藏需求：标签标题/库可见性、标签右键菜单、运行中/未保存/事务标记、会话管理器、连接删除/编辑语义、
      重连恢复库上下文、服务器实体、同服务器多配置、工作区/多窗口；
    - 给出推荐模型（Server / Connection Profile / Session / Tab / Database Context）、管理界面和 v1.0/v1.x 边界；
    - 列出建议验收标准与 Q21～Q28。
  - `doc/PRD.md` 升级 v0.18：新增 §0.5「连接/服务器/标签模型（待评审）」与 Q21～Q28；
    明确当前模型与 v1.0 建议优先补的可见性/保护项。
  - `doc/PROJECT_STATUS.md`：对照 PRD 升级 v0.18；新增 D-9/D-10 与 §2.9 的「连接/服务器/标签模型」「标签/会话可见性」「编辑器事务状态」。
  - `doc/REQUIREMENTS_AUDIT.md`：决策记录补充连接/服务器/标签模型待评审项。
  - `README.md`、`doc/TECH_DESIGN.md`：文档索引与关联审计链接。
- **涉及文件**：`doc/CONNECTION_TAB_MODEL.md`、`doc/PRD.md`、`doc/PROJECT_STATUS.md`、`doc/REQUIREMENTS_AUDIT.md`、`README.md`、`doc/TECH_DESIGN.md`、`doc/WORKLOG.md`。
- **验证**：源码核对当前行为（`App.tsx` 的 `selectConnectionTab` / `openTabSession` / `reconnectActive` /
  `disconnectConnection` / `deleteSavedConnection` / `saveConnection`，`Sidebar.tsx` 的对象树渲染条件，
  `Workspace.tsx` 标签栏，`ConnectionManager.ts` 的 `sessions` Map，`types.ts` 的 `QueryTab`）；未运行构建与测试。
- **遗留/风险**：
  - 本文是模型审计与建议，不是已实现功能；v1.0 建议项（标签标题/库、右键菜单、重连恢复库、删除/编辑保护、展开与开标签拆分）
    仍需排期实现。
  - 服务器实体、会话管理器、事务面板、工作区/多窗口建议放 v1.x；是否调整由 Q21～Q28 决定。
  - 当前「一标签一物理连接」架构不变；服务器实体属于信息架构层，不是连接池。

### W-20261109-09 连接/服务器/标签模型决策落地（PRD v0.19）

- **诉求**：用户确认第二轮模型决策：Q21 A（v1.0 服务器实体）、Q22 A + 数据库下拉、Q23 A（标签右键菜单）、
  Q24 B（状态栏会话数 + 重连）、Q25 B（完整事务面板）、Q26 B（v1.x 服务器浏览器）；Q27 询问「编辑连接」含义。
- **变更**：
  - `doc/PRD.md` 升级 v0.19：
    - §0.2 v1.0 基线加入服务器实体、标签标题/数据库下拉、标签右键菜单、状态栏会话数、事务面板；
    - §0.3 记录 Q21～Q27 决策；
    - §0.5 更新模型结论（v1.0 服务器实体、v1.x 服务器浏览器）；
    - 新增 §4.1.6「服务器与连接配置」；§4.2.3 补标签标题/数据库下拉/右键菜单/状态标签；
    - §4.5.3 补完整事务面板（开始/提交/回滚、关闭提示、与网格分离）；
    - §4.2.5/§4.5.6 补对应 AC；
    - §8 Q21～Q26 标记已定，Q27 补「编辑连接」说明并保持待定；
    - §7 v1.0 范围、§9 v1.x 候选同步。
  - `doc/CONNECTION_TAB_MODEL.md`：新增第二轮决策记录；§4.3/§5/§6/§7/§8 同步
    （服务器实体 v1.0、服务器浏览器 v1.x、标签/数据库/事务面板 v1.0、Q27 说明）。
  - `doc/PROJECT_STATUS.md`：PRD 对照升级 v0.19；D-9/D-10 改为已定决策，新增 D-11（Q27 待定）；
    §2.9 与 §4.7 增加服务器实体、标签/会话可见性、事务面板、重连恢复库等 v1.0 P0 缺口。
  - `README.md`、`AGENTS.md`、`doc/TECH_DESIGN.md`：同步「服务器 → 连接配置」目标与当前扁平实现的差异。
  - `doc/REQUIREMENTS_AUDIT.md`：决策记录补充 Q21～Q27。
- **涉及文件**：`doc/PRD.md`、`doc/CONNECTION_TAB_MODEL.md`、`doc/PROJECT_STATUS.md`、
  `doc/REQUIREMENTS_AUDIT.md`、`README.md`、`AGENTS.md`、`doc/TECH_DESIGN.md`、`doc/WORKLOG.md`。
- **验证**：文档交叉核对；未运行构建与测试。Q27 仅补充说明，未替用户选择。
- **遗留/风险**：
  - v1.0 现在包含服务器实体、标签管理、数据库下拉、完整事务面板，工作量明显增加；当前代码均未实现。
  - Q27（删除/编辑连接语义）仍未定；当前删除连接会重置标签 SQL，编辑连接会静默重连。
  - 服务器实体与「一标签一物理连接」不冲突；服务器浏览器 UI 放 v1.x，避免 v1.0 同时改信息架构与执行模型。

### W-20261109-10 Q27 规则修正：保存连接与 tab 解耦

- **诉求**：用户明确「保存连接和已经连接的 tab 没有关系，不要混为一谈」；编辑连接保存后应关闭左侧树，
  需要双击连接重新连接，不能自动重连已有 tab。
- **变更**：
  - `doc/PRD.md`：Q27 改为已定规则；§0.5 与 §4.1.6 增加「编辑保存只改配置，不重连/不改写 tab；关闭左侧树；
    双击连接重连；现有 tab 保留旧会话，新 tab/重连使用新配置；删除连接保留 SQL」；补充对应 AC。
  - `doc/CONNECTION_TAB_MODEL.md`：决策记录、§4.2 关键规则、§5.1、§6 AC、§7 说明同步；
    明确「对象树需要独立 browse session，不能继续完全依赖当前 tab 的查询 session」。
  - `doc/PROJECT_STATUS.md`：D-11 改为 Q27 已定，并记录当前实现需要修改。
  - `doc/REQUIREMENTS_AUDIT.md`：决策记录更新 Q27。
  - `AGENTS.md`：补充 Q27 目标规则，提醒当前实现会静默重连绑定标签。
- **涉及文件**：`doc/PRD.md`、`doc/CONNECTION_TAB_MODEL.md`、`doc/PROJECT_STATUS.md`、
  `doc/REQUIREMENTS_AUDIT.md`、`AGENTS.md`、`doc/WORKLOG.md`。
- **验证**：文档交叉核对；未运行构建与测试。
- **遗留/风险**：
  - 当前代码与 Q27 目标相反：`saveConnection` 会重连所有绑定标签，`deleteSavedConnection` 会重置标签 SQL；
    实现时需要改。
  - 「关闭左侧树但不影响 tab」要求对象树与 tab 的 session 解耦，可能需要新增连接级 browse session；
    这会增加物理连接数，需要单独设计。
  - 已打开 tab 保留旧会话、新 tab/重连使用新配置，需要明确 UI 提示（避免用户误以为旧 tab 已用新配置）。

### W-20261109-11 类/对象模型与交互入口修正（PRD v0.20）

- **诉求**：用户明确模型：保存连接是配置（类），session 是运行时对象；双击连接打开左侧树；右击连接 →「查询」创建 tab + session；
  一个 tab 强绑定一个 session；多库服务器在执行按钮旁用下拉切库；编辑/删除保存连接不影响已创建 session；删除后已有 session 保留到用户自行关闭。
- **变更**：
  - `doc/PRD.md` 升级 v0.20：
    - §0.5 增加类/对象模型、双击打开树 / 右击查询创建 tab+session、执行旁数据库下拉、tab-session 强绑定；
    - §4.1.6 明确双击连接只开左侧树、右击查询才建 tab+session；编辑/删除连接不影响已有 tab session；
    - §4.2.3 数据库下拉改为「执行按钮旁」，强调 tab-session 一对一、不改绑；
    - §8 Q27 说明改为类/对象模型，删除时已有 session 保留到用户关闭；
    - 补充对应 AC。
  - `doc/CONNECTION_TAB_MODEL.md`：决策记录、§4.2 关键规则、§5.1、§6 AC、§7 Q27 说明同步；
    明确 browse session 与 tab session 分离。
  - `doc/PROJECT_STATUS.md`：PRD 对照升级 v0.20；D-11、§2.9、§4.7 同步类/对象模型、入口拆分、删除保留 session。
  - `README.md`、`AGENTS.md`、`doc/TECH_DESIGN.md`：同步模型与目标交互。
  - `doc/REQUIREMENTS_AUDIT.md`：Q27 决策记录更新。
- **涉及文件**：`doc/PRD.md`、`doc/CONNECTION_TAB_MODEL.md`、`doc/PROJECT_STATUS.md`、
  `doc/REQUIREMENTS_AUDIT.md`、`README.md`、`AGENTS.md`、`doc/TECH_DESIGN.md`、`doc/WORKLOG.md`。
- **验证**：文档交叉核对；未运行构建与测试。
- **遗留/风险**：
  - 当前实现与目标差异较大：单击/展开连接会选中或创建 tab；编辑连接会重连所有绑定标签；删除连接会重置标签 SQL 并关闭 session。
  - 为实现双击连接只开树、右击查询才建 tab，需要独立的 browse session，并把 tab 的 session 生命周期与保存连接配置解耦。
  - 删除保存连接后，已有 tab 仍需保留 session 并继续执行；当前渲染层 `runQuery` 依赖 `connections.find(tab.connectionId)`，
    需要保留 tab 级连接快照或 tombstone，不能简单清空 `connectionId`。

### W-20261109-12 代码第一刀：标签/会话可见性与 Q27 连接解耦

- **诉求**：开始按 Q21～Q27 与类/对象模型改代码；先落地标签/会话可见性、连接编辑/删除行为、入口交互。
- **变更**：
  - `types.ts`：`QueryTab` 增加 `customTitle`、`connectionSnapshot`（删除保存连接后 tab 保留快照）。
  - `App.tsx`：
    - 新增 `connectionForTab`，保存连接删除后 tab 仍可用快照执行/展示；
    - 新增 `tabLabels`（连接 + 当前库 + 标签标题）、`tabStatuses`（运行中/失败/未保存）、`activeSessionCount`；
    - 执行按钮旁数据库切换复用 `switchDatabase`；
    - 新增标签右键菜单动作：关闭、关闭其他、关闭右侧、全部关闭、复制、重命名、取消查询、重连；
    - 编辑保存连接不再重连绑定标签，只收起该连接的左侧树并提示；
    - 删除连接不再重置标签 SQL/结果、不再关闭 session；保留 `connectionSnapshot`，已有 session 继续运行；
    - 重连恢复当前库（先记录库，再重开 session 后 `switchDatabase`）；
    - 关闭批量标签统一清理 runtime 状态。
  - `Workspace.tsx`：标签标题使用 `tabLabels`；标签状态点；标签右键菜单；执行按钮旁数据库下拉。
  - `StatusBar.tsx`：显示当前库和活动会话数。
  - `Sidebar.tsx`：连接节点支持双击展开树；右键菜单「查询」；编辑/删除连接后按信号收起对应树。
  - `styles.css`：标签状态点与执行旁数据库下拉样式。
  - `doc/UI_TODO.md`：新增标签/数据库/连接解耦状态，全部标「进行中/待人工验收」。
- **涉及文件**：`src/renderer/src/types.ts`、`src/renderer/src/App.tsx`、
  `src/renderer/src/components/Workspace.tsx`、`StatusBar.tsx`、`Sidebar.tsx`、`src/renderer/src/styles.css`、
  `doc/UI_TODO.md`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 全套通过（`passed`）。
- **遗留/风险**：
  - Q21 服务器实体（服务器 → 连接配置）尚未实现；当前仍按扁平保存连接。
  - Q25 完整 BEGIN/COMMIT 事务面板尚未实现。
  - 左侧树仍使用当前活动 tab 的 session，不是独立 browse session；编辑保存只收起树，没有真正用新配置重建 browse session。
  - 删除连接后的 `connectionSnapshot` 只存在内存，未写入草稿；重启后这些 tab 会失去快照。
  - UI 未做人工点击验收；E2E 覆盖了标签查询主路径，未覆盖新右键菜单/数据库下拉/删除连接。

### W-20261109-13 事务面板、服务器实体与 toast 点击穿透

- **诉求**：继续 Q21 服务器实体、Q25 完整事务面板，并修复 E2E 中 toast 遮挡按钮的问题。
- **变更**：
  - Q25 事务面板：
    - `types.ts` 新增 `TransactionRuntime`；`App.tsx` 按 SQL 首关键字识别 `BEGIN` / `START TRANSACTION` / `COMMIT` / `ROLLBACK`，
      维护每个 tab 的事务状态、开始时间与语句计数；
    - 执行按钮旁显示「无事务 / 事务中 · N 条」，提供「开始事务 / 提交 / 回滚」；
    - 关闭标签、批量关闭标签时检查未提交事务并二次确认；
    - 状态栏显示「事务中」。
  - Q21 服务器实体（后端主路径）：
    - 新增 `shared/server-identity.ts`：按 SQLite 文件路径 / host:port / MSSQL 命名实例生成 server key 与展示名；
    - 元数据库新增 `servers` 表与 `connections.server_id`，`user_version = 5`；启动时为旧连接回填 server；
    - `ConnectionRecord` 增加可选 `serverId` / `serverName`；保存连接时自动查找/创建服务器；
    - 连接列表 LEFT JOIN servers，侧边栏连接副标题显示服务器名。
  - 修复 `.toast` 遮挡：设置 `pointer-events: none`，避免 toast 拦截按钮点击。
- **涉及文件**：`src/renderer/src/types.ts`、`src/renderer/src/App.tsx`、
  `src/renderer/src/components/Workspace.tsx`、`StatusBar.tsx`、`Sidebar.tsx`、`src/renderer/src/styles.css`、
  `src/shared/ipc-contract.ts`、`src/shared/server-identity.ts`、`src/main/storage/metadata.ts`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run test:connection-export`、`npm run test:settings` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过（第二次运行；第一次因 toast 遮挡失败，已修复 `pointer-events`）。
- **遗留/风险**：
  - 服务器实体目前只有数据模型/连接管理等后端主路径，左侧仍是连接列表；`服务器 → 连接配置` 的树形分组 UI 未完成。
  - 事务识别只按语句首关键字，不是完整 SQL 解析；`BEGIN TRY` 等 MSSQL 块可能误判，后续需细化。
  - 服务器删除/重命名、服务器级 Agent、独立 browse session、删除连接快照持久化仍未做。
  - 新 UI 未人工点击验收；事务面板/服务器副标题未纳入 E2E。

### W-20261109-14 服务器树形分组 UI

- **诉求**：把已落地的服务器实体显示到左侧树，形成「服务器 → 连接配置」分组。
- **变更**：
  - `Sidebar.tsx`：连接列表按 `serverId`/server key 分组，新增可折叠的服务器头（服务器名、类型、连接数）；
    用户分组仍然保留，服务器分组嵌套在用户分组内；搜索时服务器头同样按匹配连接过滤。
  - `styles.css`：服务器头样式。
  - 事务识别补充 `BEGIN TRY`/`BEGIN CATCH` 排除，避免 MSSQL 块误判为事务。
- **涉及文件**：`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/styles.css`、`src/renderer/src/App.tsx`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过。
- **遗留/风险**：
  - 服务器树仍复用当前活动 tab 的 session；独立 browse session 未实现，展开非活动连接仍会触发选中/新建标签逻辑。
  - 服务器级 Agent、服务器删除/重命名、服务器健康状态未做。
  - 服务器分组 UI 未人工点击验收；E2E 未覆盖服务器头折叠/搜索。

### W-20261109-15 独立 browse session

- **诉求**：让「双击连接只打开左侧树、右击查询才创建 tab」真正落地，且编辑/删除连接不影响已打开 tab。
- **变更**：
  - `App.tsx`：
    - 新增 `browseConnectionId` 与 `browse-<connectionId>` session；
    - 双击/展开连接调用 browse session，不再创建或激活 tab；
    - 右键连接 →「查询」仍创建普通 tab + session；
    - browse session 复用现有 `schemas/databases/dbObjects/currentDatabase` 等状态（按 browse session id 存储）；
    - 支持 browse 树切换数据库、刷新、显示系统对象、加载表子对象；
    - browse 树单击表：如果当前 tab 属于同一连接则填入 SQL，否则新建查询 tab；
    - browse 树双击表：新建表数据 tab 并执行分页查询；
    - browse 树存储过程：新建查询 tab；
    - 编辑/删除连接时关闭对应 browse session，但不影响 tab session；
    - DDL 执行后同时刷新 tab schema 与 browse schema。
  - `Sidebar.tsx`：连接展开/双击改为打开 browse session；browse 树使用独立数据源；browse-only 时新建表/视图/脚本/对象右键菜单暂禁用（需先创建 tab）。
- **涉及文件**：`src/renderer/src/App.tsx`、`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/styles.css`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过。
- **遗留/风险**：
  - browse-only 连接的对象右键菜单/新建表/新建视图/执行脚本暂不可用，需要先通过「查询」打开 tab；后续可改为在 browse 连接上直接创建 tab。
  - 搜索仍主要匹配当前 tab 的对象；browse-only 连接的对象搜索未完全覆盖。
  - 服务器级 Agent、服务器删除/重命名/健康状态、`connectionSnapshot` 持久化、完整补全/多语句/多结果仍未做。
  - UI 未人工点击验收；E2E 覆盖了 browse 树打开表/表数据/DDL 刷新主路径。

### W-20261109-16 browse-only 连接的对象操作

- **诉求**：browse-only 连接（没有对应 tab）也要能新建表/视图/执行脚本、右键操作对象。
- **变更**：
  - `App.tsx` 新增 `ensureConnectionTab(connectionId)`：优先复用该连接已有的普通查询 tab，没有则创建一个并打开 session；
  - `Sidebar.tsx`：
    - browse-only 时点击「新建表 / 新建视图 / 执行脚本」先 `ensureConnectionTab`，再执行原动作；
    - browse-only 时右键对象先 `ensureConnectionTab`，再打开对象菜单；
    - 对象菜单后续动作仍复用现有 App 处理器（此时活动 tab 已属于该连接）。
- **涉及文件**：`src/renderer/src/App.tsx`、`src/renderer/src/components/Sidebar.tsx`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过。
- **遗留/风险**：
  - browse-only 操作会先创建/激活一个查询 tab，这是为了复用现有 DDL 处理器；后续可改为不切换当前 tab 的后台会话。
  - 服务器级 Agent、browse 对象搜索、`connectionSnapshot` 持久化、完整补全/多语句/多结果仍未做。
  - UI 未人工点击验收。

### W-20261109-17 browse 对象搜索与连接快照持久化

- **诉求**：补上 browse 树的搜索覆盖，并让删除连接后的 tab 快照在重启后仍保留。
- **变更**：
  - `Sidebar.tsx`：搜索命中同时检查 browse session 的数据库/对象；browse 连接默认展开。
  - `App.tsx`：草稿 `DraftPayload` 增加 `connectionSnapshot`，保存/恢复时一起持久化；
    删除连接后的 tab 在重启后仍能显示原连接快照（但 session 不会恢复，仍需重新连接/已关闭不可重连）。
- **涉及文件**：`src/renderer/src/App.tsx`、`src/renderer/src/components/Sidebar.tsx`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过。
- **遗留/风险**：
  - 快照只用于展示/识别，不包含密码；重启后不会恢复 session。
  - 服务器级 Agent、服务器删除/重命名/健康状态、完整补全/多语句/多结果仍未做。
  - UI 未人工点击验收；E2E 未覆盖 browse 搜索/快照恢复。

### W-20261109-19 SQL 补全 Phase 1：列 / 别名 / 限定名 / 函数

- **诉求**：开始做完整 SQL 补全，先落地最常用的列、别名、限定名与函数补全。
- **变更**：
  - `sql-completion.ts`：
    - `CompletionContext` 增加 `needle`、`qualifier`、`replaceStart`、`statement`、`tables`、`clause`；
    - 新增轻量 FROM/JOIN/UPDATE/INTO 表引用解析（含 `AS`/裸别名、schema/数据库三段式）；
    - 新增 SQLite/MySQL/Percona/MariaDB/MSSQL 常用函数表；
    - 保留原有 `filterCompletions` / `applyCompletion` 行为。
  - `SqlEditor.tsx`：
    - 支持异步 `onRequestCompletion(context)`；
    - 输入 `.` 自动触发补全；`Ctrl+Space` 仍手动触发；
    - 限定名补全只替换点后的前缀，保留 `u.`。
  - `App.tsx`：
    - 新增补全 provider：按别名/表解析表名，调用 `schema:table` 拉列并缓存；
    - 无别名时根据 FROM/JOIN 表补列与别名；
    - 未知限定符尝试按数据库名返回对象名；
    - DDL/刷新/切库时清理列缓存；
    - 基础补全加入方言函数。
  - `Workspace.tsx`：透传补全 provider。
  - `test-sql-completion.mjs`：新增别名解析、qualifier/needle、函数表断言。
- **涉及文件**：`src/renderer/src/utils/sql-completion.ts`、`src/renderer/src/features/editor/SqlEditor.tsx`、
  `src/renderer/src/App.tsx`、`src/renderer/src/components/Workspace.tsx`、`scripts/test-sql-completion.mjs`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run test:sql-completion` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过。
- **遗留/风险**：
  - 库/Schema 补全只做了“限定符匹配数据库名返回对象名”的简化版；MSSQL 多段 schema、SQLite ATTACH 仍需完善。
  - 版本感知、补全项类型/签名、完整自动触发（空格/关键字段）、解析失败降级仍待 Phase 2/3。
  - 列缓存按 tab/库/表内存保存，DDL/刷新/切库会清空；跨库/跨 schema 缓存未细分。
  - 补全 UI 未人工验收；E2E 未覆盖补全弹层。

### W-20261109-20 SQL 补全 Phase 2：函数签名提示

- **诉求**：在函数调用 `(` 后显示参数签名，并高亮当前参数。
- **变更**：
  - `sql-completion.ts`：
    - 新增 SQLite/MySQL/Percona/MariaDB/MSSQL 常用函数签名表；
    - 新增 `extractSignatureHelp(text, cursor, dialect)`：扫描最内层未闭合括号、函数名和顶层逗号，返回参数列表与当前参数索引；
    - 忽略字符串/注释/引号/方括号内的括号。
  - `SqlEditor.tsx`：
    - 增加 `dialect` 属性；
    - 输入/点击/移动光标时更新签名提示；
    - 编辑器右下角显示 `NAME(param1, param2)`，当前参数高亮。
  - `Workspace.tsx`：把连接方言传给编辑器。
  - `styles.css`：签名提示样式。
  - `test-sql-completion.mjs`：新增 DATEADD / CONCAT / STRFTIME / 已闭合函数用例。
- **涉及文件**：`src/renderer/src/utils/sql-completion.ts`、`src/renderer/src/features/editor/SqlEditor.tsx`、
  `src/renderer/src/components/Workspace.tsx`、`src/renderer/src/styles.css`、`scripts/test-sql-completion.mjs`。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run test:sql-completion` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过。
- **遗留/风险**：
  - 签名表只覆盖常用函数，不完整；同名函数在不同方言下的差异只按连接类型区分。
  - 签名提示只按光标位置显示，不做参数类型校验/可选参数标记。
  - 库/Schema 补全、版本感知、大小写跟随、完整自动触发仍未做。
  - UI 未人工验收；E2E 未覆盖签名提示。

### W-20261109-18 明确不做服务器级 Agent

- **诉求**：用户确认当前「Agent 挂在连接配置下」的结构可以，不需要服务器级 Agent。
- **变更**：
  - `doc/PRD.md` §4.1.6：Agent 保持连接配置下，不引入服务器级 Agent；服务器删除/重命名/健康状态不做 UI。
  - `doc/CONNECTION_TAB_MODEL.md`：审计表标记服务器级 Agent / 服务器级健康状态为「明确不做」，更新 browse session 状态。
  - `doc/PROJECT_STATUS.md`：D-9、§2.9、§4.7 从剩余项移除服务器级 Agent。
  - `README.md`、`doc/UI_TODO.md`：同步「明确不做」。
- **涉及文件**：`doc/PRD.md`、`doc/CONNECTION_TAB_MODEL.md`、`doc/PROJECT_STATUS.md`、`README.md`、`doc/UI_TODO.md`、`doc/WORKLOG.md`。
- **验证**：文档变更，无代码影响；未运行构建/测试。
- **遗留/风险**：同一 MSSQL 服务器多连接配置仍会各自出现 Agent 节点，这是当前结构接受的取舍。

### W-20261109-21 SQL 补全 Phase 3：库/Schema、大小写跟随、空格触发与 MySQL/MariaDB 联调

- **诉求**：继续完成库/Schema 补全与大小写跟随；同时补上 MySQL / MariaDB 类似 MSSQL 的真实实例测试。
- **变更**：
  - `sql-completion.ts`：
    - `TableReference` 增加 `parts`，保留 `db.schema.table` 的原始分段；
    - 新增 `splitQualifier`、`matchCompletionCase`、`extractAttachedDatabases`、`shouldAutoTriggerCompletion`；
    - `applyCompletion` 按输入大小写改写补全项（全小写/全大写才改写，混合大小写的真实标识符保持原样）；
    - 自动触发支持 `.` 以及 `FROM/JOIN/INTO/UPDATE/TABLE/VIEW/EXEC/USE/SET` 后的空格。
  - `App.tsx`：
    - 补全 provider 支持：`别名.` / `表名.` 列补全，MSSQL `Schema.`、`库.`、`库.Schema.`，MySQL `库.`、`库.表.`，SQLite `main.` / `temp.`；
    - 新增库对象缓存 `schemaObjectCache`，跨库取对象不改会话当前库；
    - `FROM/JOIN/UPDATE/INTO/TABLE/VIEW/EXEC` 后补当前库对象与 schema 名；
    - 基础补全加入库名、schema 名、SQLite `ATTACH ... AS alias` 别名；
    - 刷新/切库/DDL 后清理库对象缓存。
  - `SqlEditor.tsx`：输入 `.` 或对象名关键字后的空格时自动打开补全。
  - `scripts/test-sql-completion.mjs`：新增多段限定符、MSSQL/MySQL 表引用、ATTACH、大小写跟随、空格触发断言。
  - 新增 `scripts/check-mysql-session.mjs` 与 `npm run check:mysql` / `npm run check:mariadb`：
    建删临时库，验证连接、库列表、当前库/跨库对象、列元数据、分页、取消与会话存活。
  - `MysqlSession.ts` / `MariaSession.ts`：内部 `.ts` 导入补齐扩展名，便于 Node 直接运行真实实例联调（与 MssqlSession 一致）。
- **涉及文件**：`src/renderer/src/utils/sql-completion.ts`、`src/renderer/src/features/editor/SqlEditor.tsx`、
  `src/renderer/src/App.tsx`、`scripts/test-sql-completion.mjs`、`scripts/check-mysql-session.mjs`、
  `package.json`、`src/main/services/mysql/MysqlSession.ts`、`src/main/services/mariadb/MariaSession.ts`、文档。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run test:sql-completion` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过；
  - `npm run check:mysql` 通过（MySQL 8.0.44，127.0.0.1:3307）；
  - `npm run check:mariadb` 通过（MariaDB 11.4.13，127.0.0.1:3308）；
  - `npm run check:mssql`、`npm run check:mssql-multidb` 通过（SQL Server 2016 SP2，192.168.0.52）。
- **遗留/风险**：
  - SQLite `ATTACH` 只解析别名并参与基础补全；附挂库内部对象仍需元数据接口，暂不返回候选。
  - MySQL 跨库列补全受 `getTableMeta` 限制（只查当前库），跨库只补表名；MSSQL 三段式列补全依赖 `OBJECT_ID`，跨库场景未真机回归。
  - 版本感知、补全类型/签名详情、通配符展开、解析失败降级仍未做。
  - 补全弹层与关键字空格自动触发未人工验收；E2E 未覆盖补全弹层。
  - MySQL/MariaDB 联调依赖 `spikes/mysql-auth/scripts/setup.ps1` 启动的本地便携实例。

### W-20261109-22 编辑器内多语句 + 多结果页签/消息面板

- **诉求**：编辑器里一次执行多条 SQL，顺序执行、遇错停止，每条查询一个结果页签，非查询/错误进入消息面板；补齐 `GO` / `DELIMITER` 分句。
- **变更**：
  - `sql-script.ts`：
    - `splitSqlStatements(sql, limit, dialect?)` 改为按方言字符扫描；
    - 支持 MSSQL 单独一行的 `GO`（不发送给服务器）；
    - 支持 MySQL 系 `DELIMITER $$`，自定义分隔符不进入语句，可复位为 `;`；
    - 保留字符串/注释/引号标识符内分隔符不误切、50 条上限。
  - `ipc-contract.ts` / `schemas.ts` / `router.ts` / `preload`：
    - 新增 `query:execute-script`、`QueryScriptRequest/Response`、`QueryScriptStatement`；
    - `query:execute` 保持单语句语义，供表数据页/DDL/Agent 内部路径继续使用。
  - `ConnectionManager.executeQueryScript`：
    - 逐条执行，遇错停止；每条独立超时/取消/历史记录；
    - 返回语句结果、`total`、总耗时、取消/超时标记；
    - 失败语句保留 `QueryError`，连接关闭时标记 `connectionClosed`。
  - `App.tsx`：
    - 非内部执行先分句；多语句走 `executeScript`，单语句继续走原路径；
    - 危险语句逐条检查，确认后以 `skipDanger` 重新执行；
    - 多结果状态写入 `RunState.statements/activeResult/scriptTotal`；
    - 结果页签切换、消息面板切换、事务状态按成功语句顺序回放。
  - `Workspace.tsx` / `styles.css`：
    - 结果页签（仅查询结果）+「消息」页签；
    - 消息面板显示每条语句的 SQL、成功/失败/取消/超时、行数或影响行数、耗时、错误元数据与建议；
    - 失败后提示剩余未执行语句数。
  - `StatusBar.tsx`：多语句显示「N 条语句」与总耗时。
  - `SqlScriptDialog.tsx`：分句时传入方言，文案补充 `GO`/`DELIMITER`。
  - `e2e-sqlite.mjs`：新增多语句结果页签、消息面板、遇错停止断言。
  - `test-sql-script.mjs`：新增 MSSQL `GO`、MySQL `DELIMITER` 用例。
- **涉及文件**：`src/renderer/src/utils/sql-script.ts`、`src/renderer/src/types.ts`、`src/renderer/src/App.tsx`、
  `src/renderer/src/components/Workspace.tsx`、`StatusBar.tsx`、`SqlScriptDialog.tsx`、`src/renderer/src/styles.css`、
  `src/shared/ipc-contract.ts`、`src/main/ipc/schemas.ts`、`src/main/ipc/router.ts`、`src/preload/index.ts`、
  `src/main/services/ConnectionManager.ts`、`scripts/test-sql-script.mjs`、`scripts/e2e-sqlite.mjs`、文档。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run test:sql-script` 通过；
  - `npm run test:sql-completion` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过（含多语句结果页签/消息面板/遇错停止）。
- **遗留/风险**：
  - 仍是「逐条 IPC 执行」，不是驱动级多结果集；MSSQL `PRINT`/`RAISERROR` 与 MySQL warning 未进入消息面板。
  - `GO 5` 重复次数未实现；`GO` 只按换行独立行识别。
  - 多语句超时按每条语句独立计时；长脚本整体耗时上限未单独限制。
  - 消息面板与结果页签未人工点击验收；E2E 仅覆盖 SQLite。

### W-20261109-23 MySQL / MSSQL UI E2E

- **诉求**：补齐与 `e2e:sqlite` 同级的 MySQL / MSSQL 真实实例 UI E2E，覆盖连接表单、对象树、查询与多语句。
- **变更**：
  - 新增 `scripts/e2e-mysql.mjs`：
    - 预建临时库 + `items` 表；
    - Playwright + Electron 走 UI 新建 MySQL 连接、测试连接、保存；
    - 校验状态栏版本、对象树、查询 2 行、多语句结果页签与消息面板；
    - 退出后删除临时库。
  - 新增 `scripts/e2e-mssql.mjs`：
    - 读取 `.env.local`，预建 `dbo.dbcraft_e2e_mssql`；
    - UI 新建 MSSQL 连接（加密 + 信任证书）、测试、保存；
    - 校验状态栏 T-SQL 版本、对象树、查询 2 行；
    - 用 `GO` 执行两条语句，校验两个结果页签且 `GO` 不进入消息面板；
    - 退出后删除测试表。
  - `package.json` 新增 `e2e:mysql` / `e2e:mssql`（先 build 再执行）。
  - README / AGENTS / PROJECT_STATUS 补充命令、前置条件与覆盖场景。
- **涉及文件**：`scripts/e2e-mysql.mjs`、`scripts/e2e-mssql.mjs`、`package.json`、`AGENTS.md`、`README.md`、
  `doc/PROJECT_STATUS.md`、`doc/WORKLOG.md`。
- **验证**：
  - `npm run e2e:mysql` 通过（MySQL 8.0.44，127.0.0.1:3307）；
  - `npm run e2e:mssql` 通过（SQL Server 2016 SP2，192.168.0.52）。
- **遗留/风险**：
  - `e2e:mysql` 依赖 `spikes/mysql-auth/scripts/setup.ps1` 启动的便携实例，不自动拉起；
  - `e2e:mssql` 依赖 `.env.local` 与可连 SQL Server，会建删 `dbo.dbcraft_e2e_mssql`；
  - 两个 E2E 未覆盖取消、超时、DDL、表数据编辑；这些仍由 `check:mysql` / `check:mssql` 覆盖。

### W-20261109-24 结果集「不限制」档位

- **诉求**：设置面板增加「不限制」结果行数档位，查询返回多少行就加载多少行。
- **变更**：
  - `shared/settings.ts`：
    - `RESULT_ROW_LIMIT_OPTIONS` 增加 `0`；
    - 新增 `RESULT_ROW_LIMIT_UNLIMITED = 0`；
    - `normalizeRowLimit(0)` 保留为 0，不再回退 2000；
    - 新增 `resolveRowLimit`，把 0 转成 `Infinity` 给驱动层。
  - 驱动层：
    - MySQL / MariaDB / MSSQL / SQLite Worker 改用 `resolveRowLimit`；
    - `maxRows=0` 时不再截断，读取全部结果。
  - IPC：
    - `query:execute` / `query:execute-script` 的 `maxRows` 允许 0；
    - `settings:save` 允许 `resultRowLimit=0`。
  - `SettingsDialog`：
    - 下拉增加「不限制」；
    - 选中后显示内存风险提示。
  - `e2e-sqlite.mjs`：
    - 切换「不限制」后执行 2001 行查询，断言不出现截断提示；
    - 随后恢复 2000，避免影响后续用例。
  - `test-settings.mjs`：新增 0 哨兵、`resolveRowLimit(0) === Infinity`、负值回退断言。
- **涉及文件**：`src/shared/settings.ts`、`src/main/services/mysql/MysqlSession.ts`、
  `src/main/services/mariadb/MariaSession.ts`、`src/main/services/mssql/MssqlSession.ts`、
  `src/main/workers/sqlite-worker.ts`、`src/main/ipc/schemas.ts`、`src/shared/ipc-contract.ts`、
  `src/renderer/src/components/SettingsDialog.tsx`、`scripts/test-settings.mjs`、`scripts/e2e-sqlite.mjs`、文档。
- **验证**：
  - `npm run typecheck` 通过；
  - `npm run test:settings` 通过；
  - `npm run build` 通过；
  - `npm run e2e:sqlite` 通过（含不限制 2001 行不截断）。
- **遗留/风险**：
  - 这是真正的无限加载，没有硬行数上限；大结果集仍可能占用大量内存并卡顿。
  - 「不限制」只通过设置面板提示风险，没有执行前二次确认。
  - 导出仍按「加载全部最多 1 万行」处理，不受结果不限档位影响。
  - 结果不限档位未在 MySQL / MSSQL UI E2E 中单独验证（驱动共用 `resolveRowLimit`，纯逻辑测试覆盖）。

### W-20261109-25 未完成项与隐藏需求清单文档

- **诉求**：把代码里未完成、文档没提但需要补的功能整理成文档，放到 `doc/` 下，作为 v1.0 收口清单。
- **变更**：
  - 新增 `doc/UNFINISHED_ITEMS.md`：
    - H 组 11 项代码走查新发现（MSSQL 导出 guard、新建连接改绑、断开连接不关 browse、
      导入导出丢命名实例、关标签不取消查询、内部查询污染历史、标签自定义名不持久化、
      SQLite 测试口径、密码清除、单标签关闭无响应、死文件/临时探针）；
    - K 组 10 项文档已列但代码未完成（DDL/表数据/导出/编辑器/历史/Agent/设置/连接/缓存/非功能）；
    - R 组 9 项架构已就绪但缺入口（健康检查、窗口状态、错误边界、元数据库升级、SQL 文件变更、
      MSSQL SET、库级 DDL、服务器孤儿、残留类型）；
    - 文档/代码冲突 5 条、建议实施三波与验收门槛、证据索引。
  - `README.md` 文档索引增加本文。
  - `doc/PROJECT_STATUS.md` §4.7 增加指向本文的提示。
  - `doc/UI_TODO.md` 顶部增加「更完整未完成项见本文」的说明，避免两处清单漂移。
  - `doc/REQUIREMENTS_AUDIT.md` 顶部注明代码级状态以本文为准。
- **涉及文件**：`doc/UNFINISHED_ITEMS.md`、`README.md`、`doc/PROJECT_STATUS.md`、`doc/UI_TODO.md`、
  `doc/REQUIREMENTS_AUDIT.md`、`doc/WORKLOG.md`。
- **验证**：文档交叉核对（PRD/审计/状态/UI_TODO/源码行号）；纯文档改动，未运行构建或测试。
- **遗留/风险**：
  - 清单基于代码走查，未逐项在真实 Electron 中复现；H-02/H-06 涉及产品语义，需用户拍板后再改代码。
  - 行号会随代码变动漂移，已同时写函数名；完成一项后需回填本文与 `UI_TODO`/`PROJECT_STATUS`。
  - 未处理未跟踪的 `scripts/tmp-probe-*.mjs` 与 `AgentJobsDialog.tsx`，仅在 H-11 记录。

### W-20261109-26 doc 目录整理与功能状态总表

- **诉求**：整理 `doc/` 下的文档，列出需要实现的功能并标记是否已实现；明确保留原始 `PRD.md` 不改。
- **变更**：
  - 新增 `doc/FEATURE_MATRIX.md`：
    - 按 MOD-01～MOD-08、跨模块标签/会话/事务、发布门槛分 10 组，共 164 行功能；
    - 每行标 `✅ 已实现 / 🟡 部分实现 / ❌ 未实现 / ⏸ 明确延后`，并附说明与验证方式；
    - 统计：`✅ 81 / 🟡 23 / ❌ 52 / ⏸ 8`；另列 v1.x 候选，避免把已决策延后项当欠账。
  - 新增 `doc/README.md`：doc 目录地图、权威边界（PRD/功能表/未完成项/状态/UI 验收）、建议阅读顺序、维护规则。
  - `README.md` 文档索引加入 `doc/README.md` 与 `doc/FEATURE_MATRIX.md`，并标注 PRD 只读。
  - `doc/UNFINISHED_ITEMS.md` 顶部增加功能总表链接；`doc/PROJECT_STATUS.md` §4.7 同步指向功能总表。
  - 保留 `doc/PRD.md` 原样，未移动/重命名/删除任何现有文档。
- **涉及文件**：`doc/FEATURE_MATRIX.md`、`doc/README.md`、`README.md`、`doc/UNFINISHED_ITEMS.md`、
  `doc/PROJECT_STATUS.md`、`doc/WORKLOG.md`。
- **验证**：
  - 功能表与 PRD §0.2/§9、`REQUIREMENTS_AUDIT`、`PROJECT_STATUS`、`UI_TODO`、`UNFINISHED_ITEMS` 交叉核对；
  - 状态数量由脚本按表格行统计，合计 164；
  - `doc/PRD.md` 整理前后 SHA256 一致（`13A50E21B49854A6BBCCAC781ABB561C94FE9B614F8570555B40E4D5CD7904DA`）；
  - 纯文档改动，未运行构建或测试。
- **遗留/风险**：
  - 功能表是代码快照；`✅` 只代表主路径已实现，大量 UI 项仍需按 `UI_TODO.md` 真机点击验收；
  - 未做文档归档/移动，避免破坏引用；如后续要归档，先确认无引用再统一移到 `doc/archive/`；
  - `REQUIREMENTS_AUDIT` 仍是 v0.17 需求基线，后续需求取舍需回写 PRD 后再同步功能表。

### W-20261109-27 清理过时需求审计文档

- **诉求**：先提交当前工作，再清理 `doc/` 下多余文档；保留原始 `PRD.md`。
- **变更**：
  - 删除 `doc/REQUIREMENTS_AUDIT.md`：
    - 基线停留在 PRD v0.16/v0.17，状态表已被 `FEATURE_MATRIX.md` 取代；
    - 未完成明细已由 `UNFINISHED_ITEMS.md` 承接；
    - 需求分层与决策已在 PRD §0 / §9、`CONNECTION_TAB_MODEL.md` 中。
  - 更新引用：`README.md`、`doc/README.md`、`doc/PROJECT_STATUS.md`、`doc/UNFINISHED_ITEMS.md`、
    `doc/CONNECTION_TAB_MODEL.md`。
  - `doc/README.md` 记录删除原因与恢复方式（`git show 6d7f77e:doc/REQUIREMENTS_AUDIT.md`）。
  - 其余文档保留：`PROJECT_STATUS.md`（测试/验收/日志约定/里程碑）、`UI_TODO.md`（人工验收）、
    `TECH_DESIGN.md`（技术设计）、`CONNECTION_TAB_MODEL.md`（模型决策）、`WORKLOG.md`（历史）。
- **涉及文件**：`doc/REQUIREMENTS_AUDIT.md`（删除）、`README.md`、`doc/README.md`、
  `doc/PROJECT_STATUS.md`、`doc/UNFINISHED_ITEMS.md`、`doc/CONNECTION_TAB_MODEL.md`、`doc/WORKLOG.md`。
- **验证**：
  - 活跃文档中无 `REQUIREMENTS_AUDIT` 引用残留；
  - `doc/PRD.md` SHA256 仍为 `13A50E21B49854A6BBCCAC781ABB561C94FE9B614F8570555B40E4D5CD7904DA`；
  - 纯文档改动，未运行构建或测试。
- **遗留/风险**：
  - 只删除明确过时的一份；其余文档均有唯一内容，未做激进合并；
  - 如后续要把 `UNFINISHED_ITEMS.md`/`UI_TODO.md` 合并进 `FEATURE_MATRIX.md`，需先确认并迁移验收/修法细节。
