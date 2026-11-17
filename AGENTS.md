# AGENTS.md

DBCraft 是 Windows 桌面数据库客户端（Electron 45 + React 18 + TypeScript + RevoGrid Core）。
当前 M1 开发中：SQLite / MySQL / Percona / MariaDB / MSSQL 均已接真实查询；MOD-08 MSSQL Agent 已实现主路径（左侧对象树展开作业 + 详情页签、启停/脚本）。

## 常用命令

- 安装：`npm install`（要求 Node.js 22.12+）
- Electron 45 不自动下载二进制；若 `node_modules/electron/dist` 不存在：

  ```powershell
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  node node_modules/electron/install.js
  ```

- 开发：`npm run dev`
- 类型检查：`npm run typecheck`（项目没有 lint / formatter）
- 危险语句检查测试：`npm run test:safety`（纯 Node，不启动 Electron）
- 分组树测试：`npm run test:groups`（纯 Node，不启动 Electron）
- DDL 生成器测试：`npm run test:ddl`（纯 Node，不启动 Electron）
- 导出格式测试：`npm run test:export`（纯 Node，不启动 Electron）
- 查询历史测试：`npm run test:history`（纯 Node，不启动 Electron）
- 错误映射测试：`npm run test:errors`（纯 Node，不启动 Electron）
- 连接导入导出测试：`npm run test:connection-export`（纯 Node，不启动 Electron）
- 超时配置测试：`npm run test:timeouts`（纯 Node，不启动 Electron）
- 分页 SQL 测试：`npm run test:pagination`（纯 Node，不启动 Electron）
- 设置解析测试：`npm run test:settings`（纯 Node，不启动 Electron）
- SQL 高亮词法测试：`npm run test:sql-highlight`（纯 Node，不启动 Electron）
- SQL 格式化测试：`npm run test:sql-format`（纯 Node，不启动 Electron）
- SQL 补全测试：`npm run test:sql-completion`（DBCraft 包装层 + AST 注入，纯 Node，不启动 Electron）
- 补全内核测试：`npm run test:completion-core`（`packages/sql-completion`，纯 Node）
- 补全内核类型检查：`npm run typecheck:completion`
- 补全元数据缓存测试：`npm run test:metadata`（纯 Node，不启动 Electron）
- SQL 括号匹配测试：`npm run test:sql-brackets`（纯 Node，不启动 Electron）
- SQL 脱敏测试：`npm run test:sql-mask`（纯 Node，不启动 Electron）
- SQL 脚本分句测试：`npm run test:sql-script`（纯 Node，不启动 Electron）
- XLSX 生成测试：`npm run test:xlsx`（纯 Node，校验 ZIP/OOXML 结构）
- SQLite 重建表测试：`npm run test:sqlite-rebuild`（纯 Node + 内存 SQLite）
- CHECK 提取测试：`npm run test:checks`（纯 Node，不启动 Electron）
- 表格编辑 DML 测试：`npm run test:dml`（纯 Node + 内存 SQLite，覆盖参数化、乐观锁、主键保护）
- MSSQL 值/分页 SQL 测试：`npm run test:mssql`（纯 Node，不连接数据库）
- MSSQL 真实实例联调：`npm run check:mssql`（读取 `.env.local`，建删临时表，需 SQL Server）
- MSSQL Agent 联调：`npm run check:mssql-agent`（读取 `.env.local`，创建/启动/停止/删除测试作业，需 Agent 服务）
- MSSQL 多库联调：`npm run check:mssql-multidb`（列出数据库、跨库对象、切换库、约束/触发器/索引，需 SQL Server）
- MySQL / MariaDB 会话联调：`npm run check:mysql` / `npm run check:mariadb`
  （默认 127.0.0.1:3307/3308，root 空密码；建删临时库，可用 `DBCRAFT_MYSQL_*` / `DBCRAFT_MARIADB_*` 覆盖）
- 构建：`npm run build`（先 typecheck，产物在 `out/`）
- 冒烟：`npm run smoke`（构建后检查窗口与 preload 桥接）
- SQLite E2E：`npm run e2e:sqlite`（自动构建、建临时库、启动 Electron）
- MySQL E2E：`npm run e2e:mysql`（需 `spikes/mysql-auth/scripts/setup.ps1` 启动的 127.0.0.1:3307 实例）
- MSSQL E2E：`npm run e2e:mssql`（读取 `.env.local`，会建删临时表，需 SQL Server）
- 演示库：`npm run demo:db` → `samples/demo.db`（被 `.gitignore` 忽略）
- `npm run pack` / `npm run dist` 尚未验证，离线环境可能因下载打包工具失败

## 架构不变量

- **保存连接只是配置**。每个 SQL 标签 = 一个 session = 一个物理连接；`sessionId` 就是标签 id。
  不要引入连接池，也不要按保存连接复用 session。
  PRD v0.20 起 v1.0 目标是「服务器 → 连接配置」模型；当前实现仍是扁平保存连接，
  在服务器实体完成前不要按服务器级 UI 验收；「一个标签一个物理连接」不变。
  PRD v0.20 的 Q27 规则：保存连接是配置（类），session 是运行时对象；编辑保存只改配置，不重连/不改写已打开 tab；
  关闭左侧树，双击连接重连；双击连接只打开左侧树，右击 →「查询」才创建 tab + session；删除连接不强制关闭已有 session。
  当前实现会静默重连绑定标签，改代码时按目标规则处理。
- `src/shared/ipc-contract.ts` 是 IPC 唯一契约；新增/修改通道时同步更新
  `src/main/ipc/schemas.ts`、`src/main/ipc/router.ts`、`src/preload/index.ts`。
- `src/main/services/ConnectionManager.ts` 持有 sessions；`DatabaseSession` 是驱动接口；
  SQLite / MySQL / MariaDB / MSSQL 适配器分别在 `services/` 下。
- 渲染进程只能通过 `window.dbcraft` 访问主进程；保持 `contextIsolation`、`sandbox`、CSP，
  不要把 Node 或数据库驱动引入 renderer。
- SQL 编辑器内核是 CodeMirror 6（`@codemirror/lang-sql`），不要换回 textarea + 高亮层；
  补全内核已抽到 workspace 包 `packages/sql-completion`（`@dbcraft/sql-completion`）：
  `core.ts` 放方言无关的上下文/候选/排序/匹配，`dialects.ts` 放方言策略，
  `provider.ts` 定义元数据接口，`engine.ts` 组装候选；编辑器只负责弹层与插入。
  `src/renderer/src/utils/sql-completion.ts` 只是包装层，唯一职责是注入
  `utils/sql-analysis.ts` 的 AST 分析器；不要再把方言分支或元数据 IPC 写回包装层/App。
  语句上下文优先由 `utils/sql-analysis.ts`（`node-sql-parser`，按方言懒加载 chunk）提取表/别名/CTE；
  解析失败或解析器尚未加载时回退 `extractCompletionContext` 的扫描实现，不要让补全依赖解析成功。
  补全元数据缓存统一走 `utils/metadata-store.ts`：用户/系统分区、loading Promise 合并、错误退避、
  generation 失效；通过 `CompletionMetadataProvider` 注入引擎，不要在 `App.tsx` 里重新建列/对象/外键缓存。
  系统分区懒加载，DDL 只失效用户分区。
  DBCC 子命令/`WITH` 选项是 T-SQL 命令而不是目录对象，词表在包的 `core.ts` 的
  `DBCC_COMMANDS` / `DBCC_OPTIONS`；`DBCC ` 与 `DBCC ... WITH ` 分别标记为 `dbcc` / `dbcc-with`，
  不要试图从 `sys.all_objects` 查 DBCC。
  方言关键字快照在 `packages/sql-completion/src/keywords.ts`，由 `@codemirror/lang-sql` 的
  dialect spec 生成（`npm run sync:keywords`）；不要另维护一份不完整的 T-SQL 关键字表；
  MSSQL `sys.`/`dbo.` 的候选来自 `sys.all_objects`（系统对象开关只影响对象树展示，补全需要完整词表）；
  常规 FROM/JOIN 只加载用户对象，系统对象通过 `sys.`/`INFORMATION_SCHEMA.` 或 EXEC 进入，避免数千个系统对象淹没用户表。
  MySQL 的 `sys`/`information_schema`/`mysql`/`performance_schema` 是系统**库**：显式写 `库.` 时
  必须走 `loadAllObjects`（用户 + 系统），不能被用户对象过滤器清空；`information_schema` 的目录名
  是大写（`TABLES`/`COLUMNS`），`getTableMeta` 在该库下做大小写不敏感匹配；`SYSTEM VIEW` 按 `view` 返回。
  排序时词段匹配优先于贪心子序列：`sys.file` 必须保留 `host_summary_by_file_io`
  （贪心子序列会先命中 `io` 的 `i` 导致 `l` 失败，不能因此丢弃候选）。
  格式化优先走 `sql-formatter`，MySQL `DELIMITER` 例程脚本因第三方会拆坏 `END$$`/`DELIMITER ;`
  而走 `utils/sql-format.ts` 的本地保守实现；改格式化后跑 `npm run test:sql-format`。
  PRD 附录 A.2 / Q20 仍写 Monaco，属未同步的文档偏差（见 PROJECT_MASTER D-1），不要据此回退。
- 驱动分工：MySQL / Percona 用 `mysql2`；MariaDB 用 `mariadb`（`ed25519` 只能走它）；
  MSSQL 直接用 `tedious` 的单个 `Connection`（一个标签一个物理连接，不用 `mssql` 的池包装），
  参数占位符是 `@p1`/`@p2`（`mssql` 包只保留给探活脚本）。
  单个 `Connection` 同一时刻只能有一个 Request，`MssqlSession.run` 已用 Promise 队列串行化；
  补全会并发请求多张表的列元数据，不要绕过这个队列直接 `execSql`。
  Percona 与 MySQL 共用代码路径，但还没有真实 Percona 实例验证。
- MSSQL 值保真：连接固定 `useUTC: true`，datetime/date/time 按 UTC 分量拼回字符串，不做应用层时区转换；
  `datetimeoffset` 由驱动归一化为时间点（原始偏移丢失），`decimal` 超过 15 位有效数字会丢精度，
  `datetime2` 只保留到毫秒——这些是驱动限制，不要假装已完全保真。
  MSSQL 的 `sys.objects.type` 是 `char(2)`，读取后必须 trim。
  MSSQL 元数据读取（`objectInfo` / `columnInfo`）必须走 `sys.all_objects` / `sys.all_columns`：
  `sys.objects` / `sys.columns` 不包含 `sys` schema 下的系统视图，否则 `sys.objects.`、`sys.databases` 和 DMV 补全拿不到列。
  `schema()` 同时收录表值函数/DMF（`IF`/`TF`/`FT` → `SchemaObject.type='function'`）；
  补全按视图参与 FROM/JOIN，对象树暂不展示（不要把它们塞进 `table`/`view` 类型）。
  `X`（扩展存储过程，如 `sys.sp_executesql`）按 `procedure` 返回并标记 `extended: true`；
  扩展存储过程没有 SQL 定义，`getDdl` 和 DDL 导出必须跳过，不能生成伪造的 CREATE TABLE。
- MSSQL 命名实例：`instanceName` 与 `port` 互斥；命名实例走 SQL Browser（UDP 1434），
  `normalizeMssqlAddress`（`shared/mssql-address.ts`）负责 `host\instance` / `host:port` 归一化。
  联调脚本可用 `DBCRAFT_MSSQL_INSTANCE=MSSQLSERVER` 覆盖；默认实例路径已于 2016 SP2 真机回归。
- MSSQL Agent：查询/脚本生成在 `services/mssql/agent-queries.ts`（纯逻辑、可用 Node 联调），
  历史记录与 IPC 包装在 `services/mssql/agent.ts`；生命周期操作写 `source=agent-control` 历史，
  作业配置只生成 `sp_update_job*` 脚本、不直接改。UI 入口是对象树的 `SQL Server Agent → 作业`，
  展开后在树中直接列出作业（单击选中、双击打开详情页签）；不再单独开作业列表页签。
- 多数据库对象树：MSSQL / MySQL 系由 `DatabaseSession.databases()` 列出可见库、`useDatabase()` 切库、
  `schema({ database })` 跨库取表/视图/存储过程、`tableExtras(database, table)` 取约束/触发器/索引；
  `SchemaObject.type` 含 `procedure`。UI 入口是 `components/ObjectTree.tsx`，数据库/表子对象按需加载；
  表数据页把所属库写入 `QueryTab.table.database`，查询/元数据/DML 前用 `ensureDatabase` 切回该库。
  MySQL 补全的系统库/列路径已在 MySQL 8.4 真实实例回归；MySQL / MariaDB 多库对象树其余路径仍需真实实例回归。
- 结果值保真：`dateStrings`、`bigNumberStrings`、`jsonStrings`；不要做时区转换，
  也不要把 DECIMAL 转成 number。
- 结果集不设行数上限：查询与导出默认加载全部行，不要再引入 `maxRows`/`resolveRowLimit`/截断逻辑。
  大结果集内存随行数增长，需在 SQL 侧用 `WHERE` / `LIMIT` 控制范围；不要把它描述成「安全地无限加载」。
  表格数据页仍有 50/200/500 行分页，那是浏览分页，不是查询结果截断。
  `query:execute` 仍是单语句路径，SQLite 直接多语句会被明确拒绝；
  编辑器多语句走 `query:execute-script`：渲染层按方言分句（`;` / MSSQL `GO` / MySQL `DELIMITER`），
  主进程逐条执行、遇错停止，每条语句一个结果或进入消息面板，不要用简单 split 绕过。
- 查询默认 30 秒超时，设置面板可调（0/10/30/60/120 秒，通过 `QueryRequest.timeoutMs` 下发并覆盖
  `DBCRAFT_QUERY_TIMEOUT_MS`，0 关闭）；连接/测试超时优先读
  `DBCRAFT_CONNECT_TIMEOUT_MS`，未设置时用设置面板的 `connectTimeoutMs`（默认 8000）。超时复用 cancel，
  SQLite 会终止 Worker 并让会话失效，UI 必须保留重连入口。新增执行路径也要考虑超时与取消。
- 取消：MySQL/MariaDB 用控制连接执行 `KILL QUERY`；SQLite 终止该标签的 Worker，会话失效需重连。
  被 KILL 的语句可能仍成功返回（例如 `SLEEP` 返回 1），必须用 `requestId` 的 canceled 标记覆盖响应。
- 日志统一走 `src/main/logging/logger.ts`（主进程）与 `src/renderer/src/logging.ts`（渲染进程，
  经 `log:write` 汇入主进程）。`npm run dev` 默认 `debug`，打包后 `info`，可用 `DBCRAFT_LOG_LEVEL` 覆盖。
  开发日志在项目根 `logs/`（已 gitignore），打包后写 userData；可用 `DBCRAFT_LOG_DIR` 覆盖。
  日志不得记录 SQL 文本、密码或连接串；约定见 `prd/PROJECT_MASTER.md` §3.8「日志约定」。
- 表数据页只是带分页上下文的 SQL 标签：双击表生成 `SELECT * ... LIMIT/OFFSET`，每页 50/200/500，
  可下拉或点击列头排序（`ORDER BY`），过滤生成参数化 `LIKE ? ESCAPE '!'`；分页/排序/过滤 SQL 用
  `buildTablePageQuery`（`shared/dialect/identifiers.ts`），不要手写方言分支，也不要把过滤值拼进 SQL。
- 表数据编辑走 `table:apply`：渲染层先改本地行，提交时由主进程 `applyTableEdits` 在一个事务内
  执行；DML 必须用 `shared/dialect/dml.ts` 生成参数化语句，列名先在 `schema:table` 元数据白名单里
  校验，不要在渲染层或主进程手拼字面量。UPDATE 必须带被修改列的原始值做乐观锁；UPDATE/DELETE
  影响 0 行按冲突整体回滚。主键与生成列只读；无主键表默认只读，只有显式开启
  `allowNoPrimaryKeyInsert` 时才允许 INSERT（主进程仍会校验 edit 全为 insert）。
  改动后跑 `npm run test:dml`。
- 生产连接（`env === 'prod'`）执行 `DROP` / `TRUNCATE` / 无顶层 `WHERE` 的 `UPDATE`、`DELETE` 前必须经过
  `src/shared/dialect/safety.ts` 的检查与确认弹窗；改动检查逻辑后跑 `npm run test:safety`。
  该检查在渲染层执行，属于防误操作，不是权限边界；不要把它描述成数据库级保护。
- 连接配置持久化在主进程元数据库 `<userData>/dbcraft-meta.db`（`src/main/storage/metadata.ts`）。
  密码经 `safeStorage` 加密后存 BLOB，只在主进程 `openSessionById` 内解密，**不回传渲染层**；
  渲染层持有连接 id 与不含密码的配置。不要新增明文密码落盘路径，也不要把密码写进日志。
- SQLite 打开遇到锁/权限错误会回退 `readonly`，会话标记 `isReadOnly`；UI 只把它当提示并禁用建表，
  不要宣称这是写保护（数据库仍会拒绝写入并返回原生错误）。
- 开发/测试启动（`e2e:sqlite`、`smoke`）通过 `--user-data-dir` 指向临时目录，不要污染真实 `%APPDATA%`。
- UI DDL 的删除列/表/视图必须让用户输入对象名确认；重命名/加列/删列/索引先生成 SQL 预览，再走 `ddl:execute`，
  不要直接执行未经预览的语句。
- 查询历史由主进程在 `executeQuery` 内写入元数据库（内存队列 + 定时落库，关闭元数据库前 flush；
  SQL 文本本地明文保存，符合 PRD；但日志仍不得记录 SQL 文本）。关闭标签经 `history:record`
  以 `status=saved` / `source=closed-tab` 写入（关闭 dedupe，避免改写执行记录）。
  去重/淘汰/搜索/脱敏在 `storage/history-store.ts`，改动后跑 `npm run test:history`。

## 构建 / 测试细节

- 没有 CI、lint；现有门槛是 `typecheck` + `test:safety` + `test:groups` + `test:ddl` + `test:dml` + `test:export` + `test:history` + `test:errors` + `test:connection-export` + `test:timeouts` + `test:pagination` + `test:settings` + `test:sql-highlight` + `test:sql-format` + `test:sql-completion` + `test:completion-core` + `typecheck:completion` + `test:metadata` + `test:sql-brackets` + `test:sql-mask` + `test:sql-script` + `test:xlsx` + `test:sqlite-rebuild` + `test:checks` + `test:mssql` + `build` + `e2e:sqlite`。
- 纯逻辑模块（`shared/dialect/safety.ts`、`shared/dialect/ddl.ts`、`renderer/src/utils/groups.ts`）
  由 Node 类型剥离直接跑测试；这些模块内部 import 其他 `.ts` 文件时要写显式 `.ts` 后缀
  （`tsconfig.json` 已开启 `allowImportingTsExtensions`）。
- SQLite 查询在 `src/main/workers/sqlite-worker.ts`，它是 main 的第二个 Rollup input。
  改 worker 后必须跑 `npm run e2e:sqlite`。
- `better-sqlite3` 13 是 N-API 预编译，Electron 45 可直接加载，不要加 `@electron/rebuild`。
- `asarUnpack: out/main/**` 是为了让 worker 及其共享 chunk 一起解包；不要只解包 `sqlite-worker.js`。
- MySQL / MariaDB 手工验证可启动便携实例：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File spikes/mysql-auth/scripts/setup.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File spikes/mysql-auth/scripts/teardown.ps1
  ```

  端口 `3307` / `3308`；凭据见 `spikes/mysql-auth/README.md`（root 空密码；ed_user / Spike!Pass123）。
- `spikes/` 是参考原型，不要 import 到 `src/`。

## 文档记录（强制）

- **每次改动都必须记录**：代码、脚本、配置、文档。改完在 `prd/PROJECT_MASTER.md` §6「变更记录」末尾追加一条
  （编号 `W-YYYYMMDD-NN`），写清诉求、变更、涉及文件、验证结果、遗留/风险；不要改写历史条目。
- UI 改动同时维护 `prd/PROJECT_MASTER.md` §5 的勾选状态；没在真实 Electron 里点过只能标“进行中/未真机验收”，
  不能写“已完成”。
- 状态变化同步 `prd/PROJECT_MASTER.md` §3；需求取舍不擅自改 `prd/PRD.md`，偏差写进状态文档和变更记录。
- 文档索引在 `README.md`「文档」一节；项目主文档为 `prd/PROJECT_MASTER.md`。

## 环境坑

- Windows PowerShell 5.1 会把 UTF-8 无 BOM 的 `.ps1` 按 ANSI 解码；中文注释可能吞掉换行并导致语法错误。
  `.ps1` 保持 ASCII，或写成 UTF-8 BOM。
- GitHub 访问不稳定，git 配置了 github 专用代理。push 报 TLS / handshake 错误时依次尝试：

  ```powershell
  git -c "http.https://github.com.proxy=" push origin main
  git -c http.sslBackend=openssl push origin main
  ```

- `prd/PRD.md` / `prd/TECH_DESIGN.md` 可能滞后；以 `package.json`、`scripts/` 和源码为准。
