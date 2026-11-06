# AGENTS.md

DBCraft 是 Windows 桌面数据库客户端（Electron 45 + React 18 + TypeScript + RevoGrid Core）。
当前 M1 开发中：SQLite / MySQL / Percona / MariaDB 已接真实查询；MSSQL 只有连接表单，驱动未接入。

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
- SQL 补全测试：`npm run test:sql-completion`（纯 Node，不启动 Electron）
- SQL 括号匹配测试：`npm run test:sql-brackets`（纯 Node，不启动 Electron）
- SQL 脱敏测试：`npm run test:sql-mask`（纯 Node，不启动 Electron）
- SQL 脚本分句测试：`npm run test:sql-script`（纯 Node，不启动 Electron）
- XLSX 生成测试：`npm run test:xlsx`（纯 Node，校验 ZIP/OOXML 结构）
- SQLite 重建表测试：`npm run test:sqlite-rebuild`（纯 Node + 内存 SQLite）
- CHECK 提取测试：`npm run test:checks`（纯 Node，不启动 Electron）
- 表格编辑 DML 测试：`npm run test:dml`（纯 Node + 内存 SQLite，覆盖参数化、乐观锁、主键保护）
- 构建：`npm run build`（先 typecheck，产物在 `out/`）
- 冒烟：`npm run smoke`（构建后检查窗口与 preload 桥接）
- SQLite E2E：`npm run e2e:sqlite`（自动构建、建临时库、启动 Electron）
- 演示库：`npm run demo:db` → `samples/demo.db`（被 `.gitignore` 忽略）
- `npm run pack` / `npm run dist` 尚未验证，离线环境可能因下载打包工具失败

## 架构不变量

- **保存连接只是配置**。每个 SQL 标签 = 一个 session = 一个物理连接；`sessionId` 就是标签 id。
  不要引入连接池，也不要按保存连接复用 session。
- `src/shared/ipc-contract.ts` 是 IPC 唯一契约；新增/修改通道时同步更新
  `src/main/ipc/schemas.ts`、`src/main/ipc/router.ts`、`src/preload/index.ts`。
- `src/main/services/ConnectionManager.ts` 持有 sessions；`DatabaseSession` 是驱动接口；
  SQLite / MySQL / MariaDB 适配器分别在 `services/` 下。
- 渲染进程只能通过 `window.dbcraft` 访问主进程；保持 `contextIsolation`、`sandbox`、CSP，
  不要把 Node 或数据库驱动引入 renderer。
- 驱动分工：MySQL / Percona 用 `mysql2`；MariaDB 用 `mariadb`（`ed25519` 只能走它）。
  Percona 与 MySQL 共用代码路径，但还没有真实 Percona 实例验证。
- 结果值保真：`dateStrings`、`bigNumberStrings`、`jsonStrings`；不要做时区转换，
  也不要把 DECIMAL 转成 number。
- 结果默认最多 2,000 行（设置面板可调 100/500/1000/2000/5000，通过 `QueryRequest.maxRows` 下发），
  且只支持单语句。SQLite 多语句会被明确拒绝，不要用简单 split 绕过。
- 查询默认 30 秒超时，设置面板可调（0/10/30/60/120 秒，通过 `QueryRequest.timeoutMs` 下发并覆盖
  `DBCRAFT_QUERY_TIMEOUT_MS`，0 关闭）；连接/测试超时读取
  `DBCRAFT_CONNECT_TIMEOUT_MS`（默认 8000）。超时复用 cancel，
  SQLite 会终止 Worker 并让会话失效，UI 必须保留重连入口。新增执行路径也要考虑超时与取消。
- 取消：MySQL/MariaDB 用控制连接执行 `KILL QUERY`；SQLite 终止该标签的 Worker，会话失效需重连。
  被 KILL 的语句可能仍成功返回（例如 `SLEEP` 返回 1），必须用 `requestId` 的 canceled 标记覆盖响应。
- 日志统一走 `src/main/logging/logger.ts`（主进程）与 `src/renderer/src/logging.ts`（渲染进程，
  经 `log:write` 汇入主进程）。`npm run dev` 默认 `debug`，打包后 `info`，可用 `DBCRAFT_LOG_LEVEL` 覆盖。
  开发日志在项目根 `logs/`（已 gitignore），打包后写 userData；可用 `DBCRAFT_LOG_DIR` 覆盖。
  日志不得记录 SQL 文本、密码或连接串；约定见 `doc/PROJECT_STATUS.md` §6「日志约定」。
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
  SQL 文本本地明文保存，符合 PRD；但日志仍不得记录 SQL 文本）。去重/淘汰/搜索/脱敏在
  `storage/history-store.ts`，改动后跑 `npm run test:history`。

## 构建 / 测试细节

- 没有 CI、lint；现有门槛是 `typecheck` + `test:safety` + `test:groups` + `test:ddl` + `test:dml` + `test:export` + `test:history` + `test:errors` + `test:connection-export` + `test:timeouts` + `test:pagination` + `test:settings` + `test:sql-highlight` + `test:sql-format` + `test:sql-completion` + `test:sql-brackets` + `test:sql-mask` + `test:sql-script` + `test:xlsx` + `test:sqlite-rebuild` + `test:checks` + `build` + `e2e:sqlite`。
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

## 环境坑

- Windows PowerShell 5.1 会把 UTF-8 无 BOM 的 `.ps1` 按 ANSI 解码；中文注释可能吞掉换行并导致语法错误。
  `.ps1` 保持 ASCII，或写成 UTF-8 BOM。
- GitHub 访问不稳定，git 配置了 github 专用代理。push 报 TLS / handshake 错误时依次尝试：

  ```powershell
  git -c "http.https://github.com.proxy=" push origin main
  git -c http.sslBackend=openssl push origin main
  ```

- `doc/PRD.md` / `doc/TECH_DESIGN.md` 可能滞后；以 `package.json`、`scripts/` 和源码为准。
