# DBCraft 技术设计（TECH_DESIGN）

| 项目 | 内容 |
|---|---|
| 对应 PRD | `doc/PRD.md` v0.16 |
| 文档版本 | v0.8（评审修订稿） |
| 文档状态 | 待复审 |
| 创建日期 | 2026-11-05 |
| 目标平台 | Windows 10（1809+）/ 11，x64 |
| 开源许可证 | MIT（版权人：fanzhouqi） |
| 技术栈 | Electron + TypeScript + React 18 + Monaco Editor + RevoGrid Core |

## 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-11-05 | 初稿 |
| v0.2 | 2026-11-05 | 根据评审与 Q1–Q4 决策修订：改用 RevoGrid Core；SQLite 重建完整处理索引/触发器/视图/外键；MySQL/Percona/MariaDB 独立连接与认证；补齐会话池、WAL 备份、FTS5 短查询、批量提交等实现细节 |
| v0.3 | 2026-11-05 | 时区规则修正：显示与导出以数据库返回值为准，不做应用层转换；移除连接时区强制设置；有时区类型保留偏移，无时区类型不补；补充「不模拟数据库行为」边界原则 |
| v0.4 | 2026-11-05 | 回写 RevoGrid Core Spike 结果：25,000×30 虚拟滚动、区域选择/TSV 复制/粘贴、自定义编辑器、过滤面板、右键菜单通过；记录 pinned 列映射、单格复制、过滤默认操作符等待办 |
| v0.5 | 2026-11-05 | 回写 MySQL 系认证 Spike（S9）：MySQL 8.0.44 `caching_sha2_password`、MariaDB 11.4.13 `ed25519`/`mysql_native_password`、错误码映射与 TLS 行为 16 项通过；修正 `allowPublicKeyRetrieval` 文档错误；注明 unix_socket 在 Windows 不适用、Percona 需真实实例复核 |
| v0.6 | 2026-11-05 | M0 主工程脚手架落地：Electron 45 + electron-vite 6 + React 18 + RevoGrid Core；安全默认、typed IPC、五类连接表单、模拟结果网格与 smoke 检查；构建配置改为 `electron.vite.config.ts` |
| v0.7 | 2026-11-05 | SQLite 首条真实链路：better-sqlite3 13 N-API + Worker；连接测试/打开/关闭、单语句查询、`sqlite_master` 对象树；500 行示例库验证；记录多语句、取消、10 万行与打包后 Worker 等待办 |
| v0.8 | 2026-11-05 | MySQL/Percona/MariaDB 驱动接入：mysql2 + mariadb、统一 DatabaseSession、对象树、MariaDB ed25519、DATETIME/DECIMAL/JSON 原值验证；记录单会话、TLS 矩阵与 Percona 实例待办 |

---

## 1. 目标与范围

### 1.1 本文解决什么

本文把 PRD 中的 P0 能力落到可实现的技术方案，覆盖：

- Electron 进程/线程模型与 IPC 契约；
- 本地元数据库 schema、migration、并发与恢复；
- 三类数据库的连接、会话、事务与取消；
- SQL 分句、补全、格式化、执行与结果流式传输；
- DDL 生成、预览、执行及 SQLite 重建表；
- 网格编辑、批量提交、乐观锁与冲突处理；
- 查询历史、FTS5 搜索与去重淘汰；
- MSSQL Agent 列表/详情/启停/脚本化编辑；
- 导出、安全、性能、测试、构建与发布；
- 关键技术风险与 spike 验收标准。

### 1.2 不在本文范围

- v1.x 的 SSH 隧道、证书级 SSL、参数化查询、SQLCipher、macOS/Linux 适配；
- 产品交互细节与视觉稿（以 PRD + UI 设计稿为准）；
- 数据库服务端运维、Agent 作业内部执行逻辑；
- 商业模式与运营。

### 1.3 设计原则

1. **主进程持有驱动与密钥**：渲染进程不直接接触数据库、文件系统与密码。
2. **UI 不写方言分支**：所有方言差异收敛到 `Dialect` 接口。
3. **结构化 IPC**：渲染层只能发结构化请求，不能拼接任意 SQL 执行路径。
4. **可回滚优先**：DDL/DML 能进事务就进事务；不能回滚的方言必须明确提示。
5. **流式与分页**：不把大结果集整体放进内存或一次性通过 IPC 传输。
6. **薄 UI、厚服务**：Agent 等模块不在 UI 做权限判断，服务端错误原样透传。
7. **不模拟数据库行为**：不修复历史遗留 schema/数据问题；版本/方言差异按数据库原生行为透传，高风险场景提示改用 SQL/CLI。

---

## 2. 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React 18 + Monaco + RevoGrid + Ant Design)         │
│  - 编辑器 / 网格 / 历史 / DDL 预览 / Agent 页面               │
│  - 只通过 preload 暴露的 typed API 调用主进程                  │
└───────────────────────────┬──────────────────────────────────┘
                            │ contextBridge + IPC (invoke/event)
┌───────────────────────────▼──────────────────────────────────┐
│ Main Process (Electron)                                      │
│  - IPC Router（参数校验、权限边界）                            │
│  - ConnectionManager / SessionPool / QueryScheduler          │
│  - MetadataService（连接、历史、设置、草稿、schema 缓存）       │
│  - DialectRegistry / SqlSplitter / CompletionService          │
│  - DdlService / GridService / AgentService / ExportService    │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌────────────▼───────────────┐
│ Worker Threads               │  │ DB Drivers                 │
│  - metadata-sqlite.worker    │  │  - mysql2/promise          │
│  - sqlite-conn-*.worker      │  │  - mariadb                 │
│  - export.worker             │  │  - mssql (tedious)         │
│                              │  │  - better-sqlite3 (worker) │
└──────────────────────────────┘  └────────────────────────────┘
```

### 2.1 进程/线程职责

| 层 | 职责 | 禁止事项 |
|---|---|---|
| Renderer | 渲染 UI、维护视图状态、调用 typed IPC | 不加载 Node 原生模块、不接触密码、不直接连数据库 |
| Preload | `contextBridge` 暴露白名单 API | 不暴露 `ipcRenderer` 原对象、不执行任意命令 |
| Main | 连接管理、查询调度、DDL/DML 编排、IPC 校验 | 不做长时间同步计算、不阻塞事件循环 |
| metadata-sqlite.worker | 元数据库读写、历史写入、migration、FTS5 | 不处理业务 SQL |
| sqlite-conn-*.worker | 单个 SQLite 数据库连接的查询/事务 | 不跨库共享连接 |
| export.worker | 大结果集流式导出 | 不接触渲染层 DOM |

### 2.2 关键约束

- `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`；
- 所有数据库连接与密码只存在于主进程侧（含主进程派生的 Worker）；渲染进程不接触。MySQL/Percona/MariaDB/MSSQL 驱动运行在主进程，SQLite 驱动运行在 Worker；MySQL/Percona 用 mysql2，MariaDB 用 mariadb；Worker 只接收必要参数，不接收无关凭据；
- `better-sqlite3` 同步 API 一律在 Worker 中调用；
- MSSQL 不支持 MARS，因此每个会话独占一个物理连接；
- SQLite 单写库，写事务串行排队，设置 `busy_timeout`。

---

## 3. 建议目录结构

```text
dbcraft/
├─ doc/
│  ├─ PRD.md
│  └─ TECH_DESIGN.md
├─ src/
│  ├─ main/
│  │  ├─ index.ts                 # app 生命周期、单实例锁、窗口
│  │  ├─ ipc/
│  │  │  ├─ router.ts             # 注册 handler + zod 校验
│  │  │  └─ contracts.ts          # 主进程侧类型（与 shared 共用）
│  │  ├─ services/
│  │  │  ├─ connection/
│  │  │  │  ├─ ConnectionManager.ts
│  │  │  │  ├─ SessionPool.ts
│  │  │  │  └─ drivers/{mysql,percona,mariadb,mssql,sqlite}.ts
│  │  │  ├─ query/
│  │  │  │  ├─ QueryScheduler.ts
│  │  │  │  ├─ QueryExecutor.ts
│  │  │  │  └─ ResultStream.ts
│  │  │  ├─ metadata/
│  │  │  │  ├─ MetadataService.ts
│  │  │  │  ├─ migrations/
│  │  │  │  └─ worker.ts
│  │  │  ├─ schema/
│  │  │  ├─ ddl/
│  │  │  ├─ grid/
│  │  │  ├─ history/
│  │  │  ├─ agent/
│  │  │  └─ export/
│  │  ├─ security/
│  │  │  ├─ SecretStore.ts
│  │  │  └─ redact.ts
│  │  └─ workers/
│  │     ├─ sqlite-conn.worker.ts
│  │     └─ export.worker.ts
│  ├─ preload/
│  │  └─ index.ts
│  ├─ renderer/
│  │  ├─ app/
│  │  ├─ features/
│  │  │  ├─ connections/
│  │  │  ├─ editor/
│  │  │  ├─ history/
│  │  │  ├─ ddl/
│  │  │  ├─ grid/
│  │  │  ├─ agent/
│  │  │  └─ settings/
│  │  └─ components/
│  └─ shared/
│     ├─ ipc-contract.ts          # 请求/响应/事件类型
│     ├─ dialect/
│     │  ├─ index.ts
│     │  ├─ sqlite.ts
│     │  ├─ mysql.ts
│     │  └─ mssql.ts
│     ├─ sql/
│     │  ├─ splitter.ts
│     │  ├─ completion/
│     │  └─ formatter.ts
│     ├─ types/
│     └─ errors/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ scripts/
├─ package.json
├─ electron-builder.yml
├─ electron.vite.config.ts
└─ LICENSE
```

---

## 4. IPC 设计

### 4.1 通道划分

| 域 | 通道示例 | 说明 |
|---|---|---|
| 连接 | `connection.list` / `connection.create` / `connection.update` / `connection.delete` / `connection.test` / `connection.open` / `connection.close` | 连接 CRUD 与测试 |
| 查询 | `query.execute` / `query.cancel` / `query.event` | `execute` 返回 requestId；结果/消息/错误通过事件流回传 |
| Schema | `schema.get` / `schema.refresh` | 对象树与补全共用缓存 |
| 历史 | `history.list` / `history.search` / `history.delete` / `history.clear` | 分页返回 |
| DDL | `ddl.preview` / `ddl.execute` | 预览与执行分离 |
| 网格 | `grid.fetch` / `grid.commit` | 提交返回逐行结果 |
| Agent | `agent.list` / `agent.detail` / `agent.action` / `agent.editScript` | `action` 为 start/stop/enable/disable |
| 导出 | `export.start` / `export.cancel` / `export.event` | 进度与完成事件 |
| 设置 | `settings.get` / `settings.set` | 元数据库 settings 表 |

### 4.2 类型约束

```ts
// src/shared/ipc-contract.ts（示意）
export interface QueryExecuteRequest {
  connectionId: string;
  database?: string;
  sql: string;
  tabId: string;
  maxRows: number;
  timeoutMs: number;
  source: 'editor' | 'ddl-preview' | 'grid-edit' | 'agent-control';
}

export type QueryEvent =
  | { requestId: string; type: 'columns'; columns: ColumnMeta[] }
  | { requestId: string; type: 'rows'; rows: unknown[][]; offset: number }
  | { requestId: string; type: 'message'; level: 'info' | 'warn' | 'error'; text: string }
  | { requestId: string; type: 'done'; durationMs: number; affectedRows?: number; returnedRows?: number }
  | { requestId: string; type: 'error'; error: AppError };
```

### 4.3 校验与取消

- 所有 IPC 入参用 `zod` 校验：类型、长度、枚举、ID 格式；
- `requestId` 由主进程生成并返回，渲染层取消时只传 `requestId`；
- 每个 `requestId` 对应一个 `AbortController` 与驱动 cancel 句柄；
- 取消语义：
  - MySQL/Percona/MariaDB：独立连接执行 `KILL QUERY <threadId>`；
  - MSSQL：调用 `request.cancel()`；
  - SQLite：Worker 内 `db.interrupt()`；
  - 至少保证客户端停止等待并清理监听器。

### 4.4 流式结果

- 结果集按 200～1000 行分块发送，避免一次性 IPC 大对象；渲染层消费慢时主进程暂停拉取（有界队列），避免事件堆积。
- 达到 `maxRows` 后停止拉取并关闭游标；「导出全部」重新执行查询并走导出任务，不在后台继续读取。
- 每个 `query.event` 带 `seq`，保证同一 `requestId` 的 `rows`/`done` 顺序。
- 二进制/大文本以摘要传输，查看器按需请求完整值。

### 4.5 错误模型

```ts
export interface AppError {
  code:
    | 'CONN_AUTH' | 'CONN_TIMEOUT' | 'CONN_LOST'
    | 'PERMISSION' | 'SQL_SYNTAX' | 'CONSTRAINT'
    | 'CANCELLED' | 'TIMEOUT' | 'UNSUPPORTED' | 'INTERNAL';
  message: string;          // 中文可读文案
  detail?: string;          // 原生 message
  nativeCode?: string;
  sqlState?: string;
  retryable?: boolean;
}
```

- 主进程统一把驱动错误映射为 `AppError`，渲染层只展示，不解析原生错误。
- `shared/ipc-contract.ts` + zod schema 是 IPC 的单一事实源；新增通道必须同时更新类型与校验。
- IPC handler 校验 `event.senderFrame` 为主窗口；外部链接走白名单，禁止 `window.open` 任意跳转。

---

## 5. 本地元数据库

### 5.1 存储位置与初始化

- Windows 默认：`%APPDATA%\DBCraft\dbcraft.db`；
- 用户可自定义数据目录（MOD-07），切换时关闭连接、迁移文件、重启；
- 元数据库使用 WAL、`busy_timeout=5000`、`foreign_keys=ON`；
- 应用单实例：`app.requestSingleInstanceLock()`；
- 升级前使用 `VACUUM INTO` 或 better-sqlite3 `db.backup()` 生成 `dbcraft.backup-<version>.db`（不能直接复制 WAL 模式下的 `.db`），备份后执行 `PRAGMA integrity_check`；migration 失败回滚。

### 5.2 Schema（v1）

```sql
PRAGMA user_version = 1;

CREATE TABLE connections (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  db_type       TEXT NOT NULL CHECK (db_type IN ('sqlite','mysql','percona','mariadb','mssql')),
  group_path    TEXT NOT NULL DEFAULT '',
  env_tag       TEXT NOT NULL DEFAULT 'dev' CHECK (env_tag IN ('dev','test','prod')),
  host          TEXT,
  port          INTEGER,
  database_name TEXT,
  username      TEXT,
  secret_blob   BLOB,              -- safeStorage 加密后的密码
  options_json  TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sql_text        TEXT NOT NULL,
  db_type         TEXT NOT NULL,
  connection_id   TEXT,
  connection_name TEXT NOT NULL,
  database_name   TEXT,
  executed_at     INTEGER NOT NULL,
  last_executed_at INTEGER NOT NULL,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('success','failed','cancelled')),
  error_message   TEXT,
  affected_rows   INTEGER,
  returned_rows   INTEGER,
  source          TEXT NOT NULL CHECK (source IN ('editor','ddl-preview','grid-edit','agent-control')),
  exec_count      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_history_last_exec ON history(last_executed_at DESC);
CREATE INDEX idx_history_conn ON history(connection_id, last_executed_at DESC);
CREATE INDEX idx_history_status ON history(status, last_executed_at DESC);

CREATE VIRTUAL TABLE history_fts USING fts5(
  sql_text,
  content='history',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER history_ai AFTER INSERT ON history BEGIN
  INSERT INTO history_fts(rowid, sql_text) VALUES (new.id, new.sql_text);
END;
CREATE TRIGGER history_ad AFTER DELETE ON history BEGIN
  INSERT INTO history_fts(history_fts, rowid, sql_text) VALUES ('delete', old.id, old.sql_text);
END;
CREATE TRIGGER history_au AFTER UPDATE OF sql_text ON history BEGIN
  INSERT INTO history_fts(history_fts, rowid, sql_text) VALUES ('delete', old.id, old.sql_text);
  INSERT INTO history_fts(rowid, sql_text) VALUES (new.id, new.sql_text);
END;

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE drafts (
  tab_id     TEXT PRIMARY KEY,
  sql_text   TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schema_cache (
  connection_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,
  PRIMARY KEY (connection_id, database_name)
);
```

### 5.3 Migration 策略

- 使用 `PRAGMA user_version` 作为版本号；
- `migrations/001_init.ts`、`002_xxx.ts` 顺序执行，每个 migration 在事务内；
- 启动时比较 `user_version` 与代码内 `LATEST_SCHEMA_VERSION`；
- 升级前备份；失败则关闭数据库、恢复备份、提示错误；
- 不兼容的大版本变更需单独写迁移工具。

### 5.4 历史写入与去重

- 单 writer（metadata worker）串行处理，避免并发写锁；
- 写入流程在事务内：
  1. 查找 `COALESCE(connection_id,'') + sql_text` 且 `last_executed_at >= now - 60s` 的记录（以最后一次执行时间为基准的滑动窗口）；
  2. 命中则 `exec_count += 1`、更新 `last_executed_at`、耗时、状态、行数、错误；
  3. 未命中则插入新记录；`error_message` 入库前截断至 500 字符；
  4. 超过保留上限时删除最旧记录（按 `last_executed_at`）；
- FTS5 触发器自动同步索引；
- 退出前 flush 队列；失败不影响查询结果。

### 5.5 搜索

- 优先：`history_fts MATCH ?`（trigram，支持中文/子串）；用户输入必须作为 FTS 短语加引号并转义内部 `"`，避免 `:`、`-`、`*` 等被当作查询语法。
- 短查询：输入长度 < 3 时直接走 `LIKE`（trigram 无法匹配 1–2 个字符）。
- 回退：`sql_text LIKE '%' || ? || '%' ESCAPE '\'`，大小写不敏感；先转义 `%`、`_`、`\`。
- 组合过滤在 SQL 层拼接参数化条件；
- 结果分页，默认 50 条/页；
- `LIKE` 回退仅在 trigram 不可用、短查询或用户选择时启用，并在设置中提示性能差异。

---

## 6. Dialect 抽象与类型映射

### 6.1 连接类型与认证矩阵

| 连接类型 | `db_type` | 驱动 | 默认端口 | 认证方式 |
|---|---|---|---|---|
| SQLite | `sqlite` | better-sqlite3 | —（文件） | 无（v1.0 不支持加密文件） |
| MySQL | `mysql` | mysql2 | 3306 | `caching_sha2_password`（8.0/8.4 默认）、`mysql_native_password`、`sha256_password`；TLS 可选 |
| Percona | `percona` | mysql2 | 3306 | 同 MySQL 8.0/8.4，使用 `caching_sha2_password`；通过 `VERSION()`/`@@version_comment` 识别发行版 |
| MariaDB | `mariadb` | `mariadb` | 3306 | `mysql_native_password`（默认）、`ed25519`；`unix_socket`/PAM 仅服务端本地认证，Windows 客户端不适用 |
| MSSQL | `mssql` | mssql/tedious | 1433 | SQL 认证；`encrypt`/`trustServerCertificate` |

规则：

- 新建连接第一步选择连接类型；认证插件列表、默认参数、驱动按类型切换。
- `DialectRegistry.get(db_type)` 将 `mysql`/`percona`/`mariadb` 映射到同一 MySQL 方言，并注入 `vendor`；连接驱动按 `vendor` 选择。
- MariaDB 不复用 mysql2，避免 `ed25519` 等插件不兼容；MySQL/Percona 使用 mysql2。
- **mysql2 3.x 不识别 `allowPublicKeyRetrieval`**：传入会被丢弃并打印告警；非 TLS 首次 `caching_sha2_password` 认证会自动向服务端请求 RSA 公钥。v1.0 不提供“禁止公钥获取”开关；明文连接在 UI 标记“未加密”，默认引导启用 TLS。需要防 MITM 时使用 TLS，或通过 `authPlugins` 固定服务端公钥。
- MariaDB `ed25519` 实测必须使用 `mariadb` 驱动；mysql2 返回 `AUTH_SWITCH_PLUGIN_ERROR`（`client_ed25519`）。
- `unix_socket`/PAM 属于服务端本机认证，Windows 客户端经 TCP 无法使用；v1.0 不作为验收项。
- 连接错误按驱动 `code`/`errno` 映射：1045 认证失败、1044 库级权限不足、1049 库不存在；不解析原始消息（MariaDB 消息带 `(conn:n, no:, SQLState:)` 前缀）。
- `VERSION()`/`@@version_comment` 仅用于展示与诊断，不用于版本兼容层；版本/方言差异按数据库原生行为透传。
- 连接测试与实际查询使用同一驱动与认证路径；失败时原样返回驱动错误并附中文提示。
- 导出连接配置不含密码；密码由 safeStorage 加密后存 `secret_blob`。

### 6.2 接口

```ts
export interface Dialect {
  readonly id: 'sqlite' | 'mysql' | 'mssql';
  /** MySQL 系发行版；sqlite/mssql 为 undefined */
  readonly vendor?: 'mysql' | 'percona' | 'mariadb';

  quoteIdent(name: string): string;
  quoteString(value: string): string;
  placeholders(count: number): string;
  paginate(sql: string, limit: number, offset: number): string;

  buildCreateTable(model: TableModel): string[];
  buildAlterTable(diff: TableDiff): string[];
  buildDropTable(name: string): string[];
  buildRenameTable(from: string, to: string): string[];
  buildRenameColumn(table: string, from: string, to: string): string[];

  supports(feature: DialectFeature, serverVersion?: ServerVersion): boolean;
  mapType(dbType: string): UiType;
  mapUiType(uiType: UiType): string;
  explainError(error: unknown): AppError;
  splitScript(sql: string): SqlStatement[];
}
```

### 6.3 类型映射

| UI 类型 | SQLite | MySQL 系 | MSSQL | 传输格式 |
|---|---|---|---|---|
| integer | INTEGER | BIGINT/INT | BIGINT/INT | `number` 或 `string`（超 2^53） |
| decimal | NUMERIC | DECIMAL | DECIMAL/NUMERIC | `string` |
| boolean | INTEGER 0/1 | TINYINT(1) | BIT | `boolean` |
| string | TEXT | VARCHAR/TEXT | NVARCHAR | `string` |
| datetime | TEXT/INTEGER | DATETIME/TIMESTAMP | DATETIME2/DATETIMEOFFSET | ISO 8601 |
| binary | BLOB | BLOB | VARBINARY | `Buffer` → Base64 |
| json | TEXT | MySQL/Percona：JSON；MariaDB：LONGTEXT + CHECK | NVARCHAR | 解析后展示/原文保留 |
| uuid | TEXT | CHAR(36)/BINARY(16) | UNIQUEIDENTIFIER | `string` |

规则：

- `BIGINT`/`DECIMAL` 一律以字符串跨 IPC，避免 JS 精度丢失；
- MySQL 系 `tinyint(1)` 默认按数字处理，设置项可开启「按布尔展示」；
- SQLite 使用声明类型 + 值类型推断，无法确定时按文本编辑；
- MariaDB `JSON`、`CHECK`、`RETURNING`、`SEQUENCE` 等差异按数据库原生行为展示/执行，不做额外兼容层；
- 日期时间按数据库返回值展示/导出，具体见 6.5。

### 6.4 会话 SET

- MSSQL 连接初始化：`SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;`，DDL 前再次确认；
- SQLite 连接初始化：`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`
- MySQL 系连接初始化：字符集 `utf8mb4`；按连接配置设置 `sql_mode`；不修改会话 `time_zone`；MariaDB 认证走 `mariadb` 驱动。

### 6.5 时区

- **不做应用层时区转换**：显示和导出都使用驱动返回的数据库值。
- 有时区类型（如 MSSQL `DATETIMEOFFSET`）：保留原始偏移，展示/导出不重算。
- 无时区类型（MySQL `DATETIME`、MSSQL `DATETIME2`、SQLite `TEXT`/`INTEGER` 时间）：按原值展示/导出，不补时区。
- MySQL/Percona/MariaDB：不强制修改会话 `time_zone`；`TIMESTAMP` 由数据库按服务器/会话时区返回，应用不再二次转换。
- 界面可显示服务器时区作为提示，但不参与计算；CSV/JSON/SQL Insert 不添加时区。

---

## 7. SQL 执行流水线

### 7.1 分句器

状态机处理：

- 普通文本；
- 单引号字符串（`''` 转义）；
- 双引号标识符；
- 反引号标识符；
- 方括号标识符（MSSQL）；
- `--` 行注释、`#`（MySQL 系）行注释、`/* */` 块注释；
- MSSQL `GO`：独占一行（忽略大小写与首尾空白）才切分；
- MySQL 系 `DELIMITER`：切换当前分隔符，直到恢复 `;`。

输出：

```ts
interface SqlStatement {
  text: string;
  startOffset: number;
  endOffset: number;
  index: number;
  batchIndex: number; // GO/DELIMITER 批次
}
```

边界用例必须覆盖：

- `SELECT 'a;b'` 不切分；
- `-- ;` 注释内不切分；
- `/* ; */` 块注释内不切分；
- `GO` 在字符串内不切分；
- `DELIMITER $$` 后的 `;` 不切分，`$$` 才切分。

### 7.2 执行流程

```text
渲染层 query.execute
  → IPC 校验
  → SessionPool.acquire(requestId)
  → SqlSplitter.split()
  → 逐语句执行
      → 绑定超时/取消
      → 结果分块 query.event
      → 写入历史（异步）
  → 释放/归还会话
```

规则：

- 默认执行光标所在语句；有选区时执行选区；
- 多语句按顺序执行，某条失败后停止后续语句（可设置「遇错继续」P1）；
- MSSQL 每个 `GO` 批独立发送；MySQL 系/SQLite 语句共享当前会话事务（若用户显式 `BEGIN`）；
- 单条语句失败时，保留已成功语句的结果与消息；
- 用户显式事务未提交时，关闭标签需确认提交/回滚；
- 查询超时后先尝试服务端 cancel，再清理会话状态。

### 7.3 补全

- Monaco `CompletionItemProvider`，按 `Dialect` 注册；
- 数据源：内存 schema 缓存（库→表→列）+ 方言关键字/函数表；
- 上下文：解析当前语句的 FROM/JOIN/UPDATE/INTO/别名；
- 解析器：自研轻量上下文解析优先，`node-sql-parser` 兜底；
- 解析失败：降级为关键字/前缀补全，不阻塞输入；
- 版本感知：按 `SERVERPROPERTY`/`VERSION()`/`sqlite_version()` 过滤；
- 大库：列按需加载，避免对象树首次加载拉全量。

### 7.4 格式化

- `sql-formatter`，方言映射：
  - SQLite → `sqlite`
  - MySQL / Percona → `mysql`
  - MariaDB → `mariadb`
  - MSSQL → `transactsql`
- 配置：关键字大小写、缩进宽度、逗号位置；
- 失败时保留原文并提示，不破坏用户内容。

### 7.5 参数化（v1.x）

- 识别 `?` 与 `:name`；
- v1.0 不执行参数化，遇到占位符时提示「v1.x 支持」；
- 历史详情预留 `parameters_json` 字段扩展位（v1.x migration 添加）。

### 7.6 会话池与调度

- 每个连接配置一个会话池：MySQL 系/MSSQL 默认 `max=8`，空闲 5 分钟回收；SQLite 每个标签独立 Worker，LRU 上限 4。
- 标签不长期持有物理连接：查询时 acquire，完成后 release；只有显式事务或网格提交期间持有 lease，直到事务结束；网格编辑租用独立会话/独立事务。
- MSSQL 不依赖 MARS，一个会话同一时刻只执行一个请求；同一连接的多标签排队执行。
- 全局并发上限默认 8，超出排队；取消的请求从队列移除并释放会话。
- 连接断开时池内会话标记失效，下次查询自动重建；未提交事务提示用户处理。

---

## 8. DDL 生成与执行

### 8.1 流程

```text
设计视图 → TableModel / TableDiff
  → Dialect.buildCreateTable / buildAlterTable
  → 预览弹窗（Monaco，可编辑）
  → 用户确认
  → 逐条执行
  → 刷新对象树 / schema 缓存
  → 写入历史（source=ddl-preview）
```

### 8.2 方言事务能力

| 方言 | DDL 事务 | 失败处理 |
|---|---|---|
| SQLite | 支持（重建表需显式事务） | 整体回滚 |
| MySQL 系 | DDL 隐式提交 | 逐条展示，无法回滚，提示已执行部分 |
| MSSQL | 多数 DDL 可事务 | 尽量整体回滚；`GO` 分批时逐批处理 |

### 8.3 SQLite 重建表

触发条件：

- 修改列类型/长度/可空/默认值；
- 列重排；
- 低版本 SQLite 删除列；
- 复杂约束变更。

算法：

```text
PRAGMA foreign_keys = OFF;          -- 必须在事务外
BEGIN;
CREATE TABLE __new_<table> (...);
INSERT INTO __new_<table> (...) SELECT ... FROM <table>;
DROP TABLE <table>;
ALTER TABLE __new_<table> RENAME TO <table>;
-- 重建索引、触发器、视图
-- 恢复 sqlite_sequence（AUTOINCREMENT）
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
```

补充：

- 重建前从 `sqlite_master` 读取并保存：索引、触发器、视图、原表外键定义、`sqlite_sequence` 值；
- 索引、触发器、视图必须一起重建；无法解析/重建的对象**阻止执行**并提示具体对象，不静默丢弃；
- 外键：新表 DDL 保留原表外键；其他表引用旧表的外键在重命名后仍指向同名表；`foreign_key_check` 有结果则回滚；
- 增加按数据库文件的**应用级维护锁**：重建期间暂停/排队其他会话的写操作；`PRAGMA foreign_keys` 是连接级设置，不能只依赖它；
- 大表显示进度，取消即回滚；
- `WITHOUT ROWID`、生成列、STRICT、复杂默认值：按数据库原生能力处理；无法安全重建时阻止执行并提示改用 SQL；
- 失败时保留原表（事务回滚）。

### 8.4 标识符与字符串

- 标识符：
  - SQLite/MySQL 系：双引号/反引号按方言；
  - MSSQL：`[name]`，`]` 转义为 `]]`；
- 字符串：
  - 单引号转义 `''`；
  - MSSQL Unicode 加 `N` 前缀；
- 默认值：区分字面量、函数、表达式；无法判定时要求用户确认。

---

## 9. 表数据编辑

### 9.1 行标识

优先级：

1. 主键（单列/复合）；
2. MSSQL `rowversion`；
3. SQLite `rowid`；
4. 无可靠标识 → 只读，或用户显式开启风险编辑（所有列原值）。

### 9.2 乐观锁

- UPDATE：`WHERE pk = ? AND col1 = ? AND col2 = ?`，只比较**本次修改的列**的原值；
  - 目的：防止覆盖他人对同一列的修改；
  - 未修改列不参与 WHERE，避免无关冲突。
- DELETE：`WHERE pk = ?` + `rowversion`（若有），否则比较所有列原值；
- 受影响行数为 0 → 冲突；计数语义必须按驱动确认：
  - MySQL/Percona/MariaDB 启用 `CLIENT_FOUND_ROWS`（mysql2 `foundRows` / mariadb 对应选项），返回「匹配行数」而不是「实际改变行数」，避免把改成原值误判为冲突；
  - MSSQL 保持 `SET NOCOUNT OFF`，使用 `rowCount`；
  - SQLite 使用 `changes()`，并验证同值 UPDATE 的计数；不确定时先 `SELECT` 预检。
- 批量提交按行分批，避免超过 SQL Server 2100 参数 / MySQL 参数上限；默认每批 200 行或 1000 个参数。
- 无可靠比较列 → 降级为主键匹配，提交前提示风险；
- 大字段/BLOB 不参与比较（性能与驱动差异），DELETE 时同样排除并提示。

示例：

```sql
UPDATE users
SET name = ?, email = ?
WHERE id = ?
  AND name = ?      -- 原值
  AND email = ?;    -- 原值
```

### 9.3 提交事务

- 网格使用独立连接/独立事务，不与编辑器手动事务共享；
- 语句顺序：DELETE → UPDATE → INSERT；
- 任一行失败：整批回滚；
- 「跳过冲突行」：提交前排除冲突行，剩余行整体提交；
- 自动提交模式：逐条执行，失败不回滚已成功项；
- 提交前预检：查询冲突行（基于原值/rowversion）；
- 锁等待/死锁：可读提示 + 重试；
- 连接中断：保留未提交更改，标记断开，重连后可重提。

### 9.4 特殊列

| 列类型 | 行为 |
|---|---|
| 自增/IDENTITY | 新增行默认留空；显式写入需开启开关（MSSQL `SET IDENTITY_INSERT`） |
| 生成列/计算列 | 只读，不生成 INSERT/UPDATE |
| `rowversion`/`timestamp` | 只读，用于乐观锁 |
| 默认值 | 留空=默认值；显式 NULL 通过右键设置 |
| 主键 | 默认只读；修改需二次确认 |
| BLOB | v1.0 只读查看，不支持编辑 |

---

## 10. 查询历史

### 10.1 记录时机

- 每次执行（成功/失败/取消）都记录；
- DDL 预览执行 → `source=ddl-preview`；
- 网格单条/批量提交 → `source=grid-edit`；
- Agent 启停/启用/禁用 → `source=agent-control`；
- 60 秒内同连接同 SQL 合并，累计 `exec_count`。

### 10.2 脱敏

- 检测 `PASSWORD`、`IDENTIFIED BY`、明显密钥字面量；
- 列表默认显示 `***`，详情可切换；
- 搜索仍匹配原文，但导出/复制前提示；
- 日志不记录 SQL 文本，错误消息入库前脱敏。

### 10.3 淘汰

- 默认 10,000 条；
- 按 `last_executed_at` 删除最旧；
- 删除时 FTS5 触发器同步；
- 「不限制」超过 50,000 条提示性能降级。

---

## 11. MSSQL Agent

### 11.1 列表查询

核心查询（示意，需按实际列名调整）：

```sql
SELECT
  j.job_id,
  j.name,
  j.enabled,
  c.name AS category_name,
  h.run_status,
  h.run_date,
  h.run_time,
  h.run_duration,
  nr.next_run_date,
  nr.next_run_time,
  SUSER_SNAME(j.owner_sid) AS owner_name
FROM msdb.dbo.sysjobs j
LEFT JOIN msdb.dbo.syscategories c ON c.category_id = j.category_id
OUTER APPLY (
  SELECT TOP (1) run_status, run_date, run_time, run_duration
  FROM msdb.dbo.sysjobhistory
  WHERE job_id = j.job_id AND step_id = 0
  ORDER BY instance_id DESC
) h
OUTER APPLY (
  SELECT TOP (1) next_run_date, next_run_time
  FROM msdb.dbo.sysjobschedules
  WHERE job_id = j.job_id
  ORDER BY next_run_date, next_run_time
) nr
WHERE (@name IS NULL OR j.name LIKE '%' + @name + '%')
ORDER BY j.name
OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
```

另起 count 查询用于总数；>1000 作业时服务端分页 + 虚拟滚动，不拉全量。

### 11.2 详情

- 步骤：`sysjobsteps`；
- 计划：`sysjobschedules` + `sysschedules`；
- 历史：`sysjobhistory` 最近 100/500 条，按 `instance_id DESC`；
- 频率描述：覆盖常见 `freq_type` 组合；无法解析显示原始字段。

### 11.3 生命周期操作

| 操作 | 调用 | 前置校验 |
|---|---|---|
| 启动 | `msdb.dbo.sp_start_job @job_name = N'...'` | 作业未禁用；多服务器禁用按钮 |
| 停止 | `msdb.dbo.sp_stop_job @job_name = N'...'` | 二次确认 |
| 启用 | `msdb.dbo.sp_update_job @job_name = N'...', @enabled = 1` | — |
| 禁用 | `msdb.dbo.sp_update_job @job_name = N'...', @enabled = 0` | 二次确认 |

- 操作期间按钮置灰，防重复提交；
- 成功/失败均刷新列表；
- 失败原样展示原生错误码 + message；
- 每次操作写入历史，SQL 文本为对应的 `EXEC` 语句，`source=agent-control`；
- 多服务器作业（`sysjobservers`）禁用生命周期按钮。

### 11.4 脚本化编辑

- 生成 `USE msdb` + `GO` + `sp_update_job` / `sp_update_jobstep` / `sp_update_schedule`；
- 字符串转义 `''`，Unicode 加 `N`；
- `@step_id`、`@schedule_id` 使用生成时快照，脚本头部提示；计划更新使用 `@schedule_id`，不用名称定位；
- 共享计划：按 `schedule_id` 统计 `sysjobschedules` 引用数，>1 时警告；
- 新增/删除步骤或计划：只在注释中给出 `sp_add_*` / `sp_delete_*` 改法，不生成破坏性语句；
- 脚本作为普通编辑器标签，执行后手动刷新列表。

### 11.5 权限

- 查看：`SQLAgentReaderRole` 或更高；
- 启停/启用/禁用：`SQLAgentOperatorRole` 或作业所属者权限；
- 不预探测权限，失败透传；
- 提示文案包含角色建议，但不代为执行 `sp_configure`。

---

## 12. 导出

### 12.1 架构

- `export.worker` **不接触数据库凭据**；主进程负责执行查询，并通过 `MessagePort` 把行块/列元数据流式传给 worker：
  - 列元数据与行块；
  - 格式、目标路径、选项；
- 分块查询 → 流式写临时文件 → 完成后原子替换；
- 支持取消：worker 收到 cancel 后关闭流、删除临时文件。

### 12.2 格式

| 格式 | 规则 |
|---|---|
| CSV | UTF-8 with BOM；逗号分隔；双引号转义；CRLF；可选表头/分隔符 |
| JSON | 数组/NDJSON 可选；NULL→`null`，空串→`""` |
| SQL Insert | 方言标识符/字符串转义；`N''`；自增列处理；分批写入 |
| Excel (P1) | SheetJS；不依赖商业 Grid |

CSV 安全：单元格以 `=`、`+`、`-`、`@`、Tab、CR 开头时，默认加前导 `'` 或关闭公式解析，防止 Excel 公式注入。

### 12.3 NULL 与二进制

- CSV NULL 默认空字段，可选 `\N` 标记；
- 二进制默认 Base64，可选 Hex；
- 日期/时间：按数据库返回值输出；有时区类型保留原偏移，无时区类型不添加时区，不做应用层转换；
- 超过 100MB 提示预计大小。

---

## 13. 安全设计

### 13.1 进程边界

- 渲染层 sandbox + contextIsolation；
- preload 只暴露白名单方法；
- IPC 入参 zod 校验；
- 禁止渲染层传任意 SQL 到「执行任意命令」通道；
- 所有文件路径由主进程校验并限制在用户选择的目录/文件。

### 13.2 密码与密钥

- `safeStorage.encryptString` 加密密码，密文存 `connections.secret_blob`；
- Windows 使用 DPAPI；
- safeStorage 不可用时回退 AES-GCM + 主密码；
- 导出连接配置不含密码；
- 日志与错误消息脱敏。

### 13.3 静态数据

- v1.0 元数据库为本地 SQLite 明文文件；
- 依赖操作系统账户隔离与磁盘加密；
- SQLCipher 列入 v1.x；
- 卸载时询问是否删除本地数据。

### 13.4 危险操作

- DDL 与批量 DML 必须预览 SQL；
- 生产连接拦截 `DROP`/`TRUNCATE`/无 WHERE 的 `UPDATE`/`DELETE`；
- 停止/禁用 Agent 作业二次确认；
- 主进程执行权唯一，渲染层只做确认。

---

## 14. 性能设计

| 场景 | 策略 |
|---|---|
| 启动 | 延迟加载 Monaco/RevoGrid；Vite 分包；主窗口优先 |
| 对象树 | 按库/表懒加载；列按需；缓存到元数据库 |
| 补全 | 内存 schema 缓存；<100ms 目标 |
| 结果集 | 分页/流式；行虚拟化；单次上限 1000 |
| 历史搜索 | FTS5 trigram；<100ms（1 万条） |
| 大导出 | Worker + 流式写文件 |
| 内存 | 不缓存完整结果集；大字段按需读取 |
| SQLite 写 | 单 writer、WAL、busy_timeout |
| MSSQL | 每会话独立连接，避免 MARS 依赖 |

---

## 15. 测试策略

### 15.1 单元测试（Vitest）

- 分句器边界（字符串/注释/`GO`/`DELIMITER`）；
- Dialect 类型映射与标识符转义；
- DDL 快照（SQLite/MySQL 系/MSSQL）；
- SQLite 重建表序列；
- 乐观锁 SQL 生成；
- 历史去重/淘汰；
- Agent 脚本生成与转义；
- 错误映射。

### 15.2 集成测试

- docker-compose：MySQL 5.7/8.0/8.4、Percona 8.0/8.4、MariaDB 10.3/10.6/11.x、MSSQL 2017/2019/2022；EOL 版本仅做冒烟；
- SQLite 固定 fixture 文件；
- 覆盖 MySQL/Percona/MariaDB/MSSQL 连接与认证、分页、事务提交、DDL、Agent 查询；
- Windows CI 额外验证 better-sqlite3 N-API 预编译、打包后 Worker 路径与 native 模块解包。

### 15.3 E2E（Playwright for Electron）

- 连接 → 执行 → 历史搜索 → 复用；
- 网格编辑 → 冲突 → 回滚/提交；
- RevoGrid 区域选择 → 复制 TSV → 粘贴回网格；
- DDL 预览 → 执行；
- Agent 列表 → 启停 → 刷新。

已落地：`npm run e2e:sqlite` 覆盖 SQLite 连接测试、对象树、查询、写入、错误与多语句拒绝。

### 15.4 性能基线

- CI 记录启动耗时、历史搜索、对象树加载；
- 超过阈值阻断合并；
- 内存基线单独记录。

---

## 16. 构建与发布

- Vite + electron-builder；
- Windows NSIS 安装包；
- better-sqlite3 13 使用 N-API 预编译（`prebuilds/win32-x64.node`），Electron 45 实测直接加载，无需 `@electron/rebuild` 或 node-gyp；
- `asarUnpack: ["out/main/**", "**/*.node"]`；Worker 及其共享 chunk 随构建产物解包，运行时把 `app.asar` 替换为 `app.asar.unpacked`；对打包后的 exe 做 smoke test；
- 固定 Electron 大版本，记录 Node/ABI；
- 代码签名证书在 GA 前申请；
- v1.0 不内置静默自动更新，仅提供版本检查/下载链接；
- 打包前生成第三方 License 清单；
- 产物不含开发依赖、测试 fixture、本地数据库。

---

## 17. 技术风险与 Spike

| # | 风险 | Spike 验收标准 |
|---|---|---|
| S1 | better-sqlite3 + Electron ABI | 🟡 部分通过（2026-11-05）：better-sqlite3 13.0.3 N-API 预编译在 Electron 45 直接加载，Worker 内查询/写入/对象树已跑通；10 万行性能、取消、打包后 asar Worker 待验证 |
| S2 | MSSQL tedious 连接 | SQL 认证 + `encrypt`/`trustServerCertificate` 连接成功；`msdb` 查询可用 |
| S3 | FTS5 trigram 中文/子串 | 1 万/5 万条下搜索 <100ms/<500ms；`LIKE` 回退可用 |
| S4 | RevoGrid Core 集成 | ✅ 通过（2026-11-05，`spikes/revogrid/`）：25,000×30 虚拟滚动、区域选择/TSV 复制/粘贴、枚举/布尔/日期/大文本编辑器、过滤面板、自研右键菜单、滚动到行均通过。待办：pinned 列映射、单格复制路径、过滤默认操作符、IME/无障碍人工验证；多区域为 Pro，v1.0 用单区域 |
| S5 | SQL 解析容错 | 不完整 SQL 下补全不崩溃、可降级 |
| S6 | Monaco 中文输入法 | 中文输入、补全、撤销无明显异常 |
| S7 | 启动/内存 | 冷启动 <3s、热启动 <2s、常驻 <300MB 基线 |
| S8 | 元数据库 migration | 升级/备份/失败回滚可重复验证 |
| S9 | MySQL 系认证 | ✅ 通过（2026-11-05，`spikes/mysql-auth/`）：MySQL 8.0.44 `caching_sha2_password`、MariaDB 11.4.13 `mysql_native_password`/`ed25519`、TLS、错误码 16 项全通过；已在 M1 连接表单与查询管线复用（见 17.4）。待办：Percona 用真实实例复核；`unix_socket` 在 Windows 客户端不适用 |
| S10 | SQLite 重建全依赖 | 索引/触发器/视图/外键/`sqlite_sequence` 全部重建；并发会话维护锁有效；失败回滚保留原表 |

### 17.1 RevoGrid Spike 结果（S4）

- 位置：`spikes/revogrid/`
- 环境：RevoGrid Core 4.31.4 + React 18 + Vite 6 + Edge Headless
- 数据：25,000 行 × 30 列

| 验证项 | 结果 | 备注 |
|---|---|---|
| 25,000 行渲染/滚动 | 通过 | 行/列虚拟化正常 |
| 区域选择 | 通过 | 拖拽/Shift 点击 |
| 复制 TSV | 通过 | 多选区域 `Ctrl+C` |
| 粘贴区域 | 通过 | `Ctrl+V` 写入 2×2 区域 |
| 枚举/布尔/日期编辑器 | 通过 | React 自定义编辑器 |
| 大文本/中文编辑器 | 通过 | `<textarea>`，中文可保存/显示 |
| 过滤面板 | 通过 | 列头漏斗可打开，默认操作符为 `None` |
| 右键菜单 | 通过（需自研） | 容器 `contextmenu` + `getSelectedRange()` |
| 滚动到指定行 | 通过 | `scrollToRow` |
| 单格复制 | 需确认 | 未触发 `clipboardrangecopy`，正式实现需补路径或确认原生行为 |
| IME 组合输入 | 待人工 | 中文文本写入通过，组合态未验证 |
| 无障碍 | 待人工 | 需 NVDA/键盘导航检查 |

关键发现：

1. `getSelectedRange().x` **不包含 pinned 列**；映射列时必须按 `range.colType` 分组：`colPinStart` / `colPinEnd` / `rgCol`。
2. RevoGrid Core 不带业务右键菜单，需要自研；Spike 已实现并验证。
3. 单格复制与区域复制行为不同；正式实现需要补单格复制路径。
4. 过滤面板默认 `None`，建议正式产品默认 `Contains` 或 `Equal`。
5. Core 只有单区域选择；多区域是 Pro，v1.0 单区域足够。

结论：**RevoGrid Core 通过 S4，可作为 v1.0 数据网格。** 正式实现需补齐 pinned 列映射、自研右键菜单、单格复制、过滤默认操作符，并完成 IME/无障碍人工验证。

### 17.2 MySQL 系认证 Spike 结果（S9）

- 位置：`spikes/mysql-auth/`
- 环境：Windows + Node 24.22.1；MySQL 8.0.44 便携版（127.0.0.1:3307）；MariaDB 11.4.13 便携版（127.0.0.1:3308）；mysql2 3.24.6；mariadb 3.5.4
- 方法：真实用户、真实 TCP/TLS 连接；`npm run probe` 生成 `result.json`
- 结果：16 项通过，0 失败

| 用例 | 结果 | 说明 |
|---|---|---|
| MySQL `caching_sha2_password` 首次认证（非 TLS） | 通过 | mysql2 自动请求服务端 RSA 公钥 |
| MySQL 认证缓存命中 | 通过 | fast auth，不再交换公钥 |
| MySQL TLS（自签证书，`rejectUnauthorized:false`） | 通过 | 连接与查询正常 |
| MySQL TLS 严格校验自签证书 | 按预期失败 | `HANDSHAKE_SSL_ERROR`；需显式信任选项 |
| MySQL `mysql_native_password` | 通过 | 8.0 仍可用；8.4 默认禁用 |
| MySQL 密码错误 | 按预期失败 | `ER_ACCESS_DENIED_ERROR` / 1045 |
| MySQL 数据库不存在（root） | 按预期失败 | `ER_BAD_DB_ERROR` / 1049 |
| MySQL 无库权限（普通账号） | 按预期失败 | `ER_DBACCESS_DENIED_ERROR` / 1044 |
| MySQL 端口未监听 | 按预期失败 | `ECONNREFUSED` |
| MariaDB `mysql_native_password` | 通过 | mariadb 驱动 |
| MariaDB `ed25519` | 通过 | mariadb 驱动，13ms |
| MariaDB `ed25519` 经 mysql2 | 按预期失败 | `AUTH_SWITCH_PLUGIN_ERROR`，未知插件 `client_ed25519` |
| MariaDB 原生密码经 mysql2（对照） | 通过 | 仅证明不能覆盖 ed25519 |
| MariaDB 密码错误 | 按预期失败 | 1045 |
| MariaDB 数据库不存在 / 无库权限 | 按预期失败 | 1049 / 1044 |
| MariaDB `unix_socket` | 不适用 | Windows 无该插件（1524）；v1.0 目标 Windows，客户端经 TCP 用不到 |

关键发现：

1. **mysql2 3.x 不支持 `allowPublicKeyRetrieval`**：传入会被丢弃并告警（“Ignoring invalid configuration option…”），首次 `caching_sha2_password` 认证总是向服务端请求 RSA 公钥。§6.1 已按实测修正。安全含义：非 TLS 下密码虽用 RSA 加密，但公钥来自服务端，存在 MITM 风险；正式实现默认引导 TLS，明文连接明确标注“未加密”，需要更强保证时用 TLS 或通过 `authPlugins` 固定服务端公钥。
2. **MariaDB `ed25519` 必须使用 `mariadb` 驱动**：mysql2 在认证切换阶段报未知插件；这验证了按 `vendor` 分驱动的决策，而不是只按数据库方言复用连接。
3. **错误码必须分流**：1045 账号/密码、1044 库级权限、1049 库不存在；MariaDB 原始消息带 `(conn:n, no:, SQLState:)` 前缀，UI 应按 `code`/`errno`/`sqlState` 映射，不解析消息文本。
4. **TLS 自签证书**：`rejectUnauthorized:false` 可用；严格校验失败。连接表单需要“验证证书”开关，默认开启，自签场景由用户显式关闭。
5. **`unix_socket` 与 PAM 在 Windows 客户端不适用**：属于服务端本机认证；v1.0 不作为验收门槛。
6. **Percona 未单独跑服务端**：本机无 Docker/Percona 二进制；Percona 8.0/8.4 与 MySQL 共用 mysql2 与 `caching_sha2_password` 路径，代码无分支，但仍需在 M1/CI 用真实 Percona 实例复核版本识别与连接。

结论：**S9 对 MySQL 与 MariaDB 通过**；Percona 视为同一认证路径、待真实实例复核；`unix_socket` 标记为 Windows 不适用。

### 17.3 SQLite 真实查询链路（S1 部分）

- 环境：Windows + Electron 45.2.3 + better-sqlite3 13.0.3（N-API 预编译）+ worker_threads
- 代码：`src/main/services/sqlite/`、`src/main/workers/sqlite-worker.ts`
- 能力：连接测试、打开、关闭；单语句查询；`sqlite_master` 对象树；结果列/行/耗时/影响行数/截断标记
- 验证数据：`npm run demo:db` 生成 500 用户、1,500 订单、2 表 + 1 视图
- 自动化：`npm run e2e:sqlite` 覆盖连接、对象树、SELECT、UPDATE、错误与多语句拒绝

| 验证项 | 结果 |
|---|---|
| Electron 45 加载 better-sqlite3 13 | 通过（无需 rebuild） |
| 连接测试 | `SQLite 3.53.4 · 文件可读`，17ms |
| 打开连接 | 成功，状态栏显示版本 |
| `sqlite_master` 查询 | 4 行，0–2ms |
| `SELECT` 100 行 | 通过，2–3ms |
| `UPDATE` | `1 行受影响` |
| 表不存在 | `no such table: missing_table`，UI 展示错误 |
| 多语句 | 按预期拒绝，提示一次只能执行一条 SQL |
| 对象树 | 2 表 + 1 视图，点击填入 `SELECT * FROM "table" LIMIT 100;` |

关键结论：

1. **better-sqlite3 13 的 N-API 预编译可直接用于 Electron 45**，原先“必须 `@electron/rebuild`”的假设不成立；仍需在打包产物中验证 `asarUnpack` 后的 Worker 路径。
2. Worker 按连接隔离，SQLite 同步 API 不阻塞主进程事件循环。
3. 当前限制：单语句、最多 2,000 行、无取消、无事务状态跟踪、多语句与 10 万行性能未验证。

结论：**S1 部分通过**，作为 M1 SQLite 主路径可用；打包、性能和取消能力待补测。

### 17.4 MySQL / Percona / MariaDB 驱动接入（S9 后续）

- 环境：Electron 45.2.3；MySQL 8.0.44（3307）；MariaDB 11.4.13（3308）；mysql2 3.24.6；mariadb 3.5.4
- 实现：统一 `DatabaseSession` 接口；`MysqlSession` 负责 MySQL/Percona，`MariaSession` 负责 MariaDB；每个保存的连接对应一个主进程会话
- 验证账号：MySQL `root`；MariaDB `ed_user`（`ed25519`）
- 示例表：`demo_users` 100 行 + `active_users` 视图

| 验证项 | 结果 |
|---|---|
| MySQL 连接测试 | 通过，9ms |
| MySQL 对象树 | 1 表 + 1 视图 |
| MySQL `SELECT` 10 行 | 通过，1–2ms |
| DATETIME 原值 | `2026-01-01 09:30:00`，未做时区转换 |
| DECIMAL | `3.25`，按字符串返回，无精度丢失 |
| JSON | 原文本字符串 |
| MariaDB ed25519 连接 | 通过，18–37ms |
| MariaDB 对象树 / 查询 | 1 表 + 1 视图；5 行查询正常 |
| MariaDB 元数据 | `rowsAsArray` + `meta`，列名通过 `name()` 读取 |

关键发现：

1. mysql2 使用 `rowsAsArray: true` 时仍返回完整 `fields`；MariaDB 通过结果数组的 `meta` 暴露列信息，且列名是方法 `name()` 而非属性。
2. `dateStrings`、`bigNumberStrings`、`jsonStrings` 能保留数据库返回值形态，符合“不做应用层时区/格式转换”的约束。
3. 当前每个保存连接只有一个会话，多个标签页共用时请求串行；尚未实现 8 连接会话池。
4. TLS 的 `prefer` 已实现“失败后回退明文”，但尚未覆盖完整 TLS 矩阵；`verify-ca`/`verify-full` 暂用系统 CA。
5. Percona 与 MySQL 共用 `MysqlSession`，仍待真实 Percona 实例复核。

结论：**MySQL 与 MariaDB 的 M1 查询链路通过**；Percona 沿用同一代码路径，待实例复核。

---

## 18. 里程碑映射

| 里程碑 | 技术交付 |
|---|---|
| M0 | 窗口骨架、typed IPC、连接表单、结果网格原型 |
| M1 | 多库驱动（SQLite/MySQL/Percona/MariaDB/MSSQL）、会话池、SQL 执行/取消、结果流、基础设置 |
| M2 | 元数据库 migration、历史/FTS5、网格事务/乐观锁 |
| M3 | DDL 生成/预览、SQLite 重建、Agent 列表/详情/启停/脚本 |
| M4 | 性能/安全专项、签名打包、回归与发布检查 |

> M0 脚手架已落地（2026-11-05）：Electron 45 + electron-vite 6 + React 18 + RevoGrid Core；包含安全默认、typed IPC、五类连接表单、结果网格与 `npm run smoke` 冒烟检查。M1 已接入 SQLite（见 17.3）与 MySQL/Percona/MariaDB（见 17.4）；MSSQL 驱动、会话池、SQL 取消与历史仍待后续交付。

---

## 19. 待确认项

1. `node-sql-parser` 对不完整 SQL 的容错是否满足补全需求，是否需要更轻的自研 parser。
2. RevoGrid Core Spike 已完成（见 17.1）；正式实现需补 pinned 列映射、单格复制路径、过滤默认操作符，并完成 IME/无障碍人工验证。多区域属 Pro，v1.0 使用单区域。
3. MySQL 系认证 Spike 已完成（见 17.2）；Percona 仍需真实实例复核，`unix_socket`/PAM 在 Windows 客户端不适用。
4. mysql2 非 TLS 下无法拒绝服务端公钥获取；正式实现默认引导 TLS，并在连接表单明确标注未加密连接的风险。
5. SQLite 连接 Worker 的数量上限与回收策略。
6. SQLite 已完成单语句查询；多语句、取消、事务状态、10 万行性能与打包后 asar Worker 路径待验证。
7. 代码签名证书的采购时间与发布渠道。

---

## 20. 参考

- `doc/PRD.md` v0.16
- RevoGrid Core Spike：`spikes/revogrid/`
- MySQL 系认证 Spike：`spikes/mysql-auth/`
- Electron Security Checklist
- SQLite FTS5 trigram tokenizer
- RevoGrid Core 文档与 MIT 许可
- RevoGrid / Glide / Tabulator 数据网格对比
- Microsoft `sp_start_job` / `sp_stop_job` / `sp_update_job` 文档
- MySQL / Percona / MariaDB 认证插件与版本差异文档
