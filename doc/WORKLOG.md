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
