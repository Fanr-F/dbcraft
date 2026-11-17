# DBCraft

轻量级 Electron 数据库客户端，支持 SQLite、MySQL、Percona、MariaDB、MSSQL。

当前处于 **M1 开发中**：SQLite、MySQL、Percona、MariaDB、MSSQL 均已接入真实连接、查询和对象树；MSSQL Agent 作业在左侧对象树展开，支持详情/启停/启用/禁用与脚本生成。

## 技术栈

- Electron 45 + TypeScript
- React 18 + Vite
- CodeMirror 6（`@codemirror/lang-sql`）SQL 编辑器 + `sql-formatter` 格式化
- RevoGrid Core 数据网格
- electron-vite 开发/构建，electron-builder 打包
- zod 校验 IPC 输入
- better-sqlite3 13（N-API）+ Worker 执行 SQLite 查询
- mysql2 连接 MySQL/Percona；mariadb 连接 MariaDB；tedious 连接 MSSQL

## 开发

要求 Node.js 22.12+。

```bash
npm install
npm run dev
```

如果 `npm install` 后 `node_modules/electron/dist` 不存在（Electron 45 不再自动下载二进制），执行：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

生成演示数据库：

```bash
npm run demo:db   # samples/demo.db，500 用户 + 1,500 订单
```

然后在应用里新建 SQLite 连接，选择 `samples/demo.db`。

## 构建与检查

```bash
npm run typecheck   # TypeScript 检查
npm run build       # 构建 main / preload / renderer / sqlite worker
npm run smoke       # 构建后启动 Electron，检查窗口与 preload 桥接
npm run e2e:sqlite  # 构建后跑 SQLite 真实链路 E2E（连接、对象树、查询、错误）
npm run e2e:mysql   # 构建后跑 MySQL UI E2E（需 127.0.0.1:3307 便携实例）
npm run e2e:mssql   # 构建后跑 MSSQL UI E2E（读取 .env.local，会建删临时表）
npm run pack        # 生成未打包目录（release/）
npm run dist        # 生成 Windows NSIS 安装包
```

MSSQL 联调（需要可连的 SQL Server）：

```powershell
# 项目根创建 .env.local（已被 .gitignore 忽略）
# DBCRAFT_MSSQL_HOST=127.0.0.1
# DBCRAFT_MSSQL_PORT=1433
# DBCRAFT_MSSQL_USER=sa
# DBCRAFT_MSSQL_PASSWORD=...
# DBCRAFT_MSSQL_DATABASE=master
# DBCRAFT_MSSQL_ENCRYPT=true
# DBCRAFT_MSSQL_TRUST=true
# 命名实例可加：DBCRAFT_MSSQL_INSTANCE=MSSQLSERVER（与 PORT 互斥，走 SQL Browser UDP 1434）
npm run check:mssql        # 建删临时表，验证查询/对象树/DDL/表编辑/取消
npm run check:mssql-agent  # 创建/启停/删除临时作业，验证 Agent 列表/详情/脚本/历史
```

MySQL / MariaDB 可用便携实例联调（默认 `127.0.0.1:3307` / `3308`，root 空密码；
可用 `DBCRAFT_MYSQL_*` / `DBCRAFT_MARIADB_*` 覆盖）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File spikes/mysql-auth/scripts/setup.ps1
npm run check:mysql        # 建删临时库，验证库/对象/列/跨库/分页/取消
npm run check:mariadb
npm run e2e:mysql          # 启动 Electron，验证连接表单/对象树/查询/多语句
```

## 目录

```text
src/
├─ main/
│  ├─ index.ts                 # 窗口、安全默认、生命周期
│  ├─ ipc/                     # IPC 路由与 zod schema
│  ├─ services/                # 统一连接管理 + SQLite/MySQL/MariaDB/MSSQL 会话
│  └─ workers/                 # sqlite-worker
├─ preload/                    # contextBridge，暴露 window.dbcraft
├─ renderer/                   # React 界面
│  ├─ index.html
│  └─ src/
│     ├─ components/
│     ├─ features/
│     │  ├─ connections/
│     │  ├─ editor/
│     │  └─ grid/
│     └─ types.ts
└─ shared/                     # IPC 契约与共享类型
```

## 安全默认

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 禁用新窗口，阻止页面导航
- 生产环境注入 CSP
- preload 只暴露白名单 IPC 方法

## 当前进度

已完成：

- 主窗口、暗色界面、标签页、SQL 编辑区、结果区、状态栏
- 五种数据库类型的连接表单
- SQLite / MySQL / Percona / MariaDB / MSSQL 连接测试、打开、关闭
- 编辑器内多语句执行：按 `;` / MSSQL `GO` / MySQL `DELIMITER` 分句，逐条执行、遇错停止，多结果页签 + 消息面板
- 当前单语句内部路径仍用 `query:execute`（表数据页、DDL、Agent 等）
- 查询结果动态列、行数、耗时、影响行数、错误展示
- 对象树：SQLite 读 `sqlite_master`；MySQL 系读 `information_schema`；MSSQL 读 `sys.objects`
- 多数据库对象树：MSSQL / MySQL 系连接后列出有权限的数据库，库下分表/视图/存储过程，
  表下可展开约束/触发器/索引；点击数据库切换当前库
- 表/视图列表、刷新、点击填入查询
- SQLite 查询在独立 Worker 中执行，不阻塞主进程
- MariaDB `ed25519` 账号走 `mariadb` 驱动
- MSSQL 走 `tedious` 单连接：查询、对象树、表结构、查看 DDL、表数据页、参数化 DML 与取消
- MSSQL 命名实例（`host\instance`）：通过 SQL Browser（UDP 1434）解析端口，也可直接填 `host:port`；
  已在 SQL Server 2016 默认实例上验证（`DBCRAFT_MSSQL_INSTANCE=MSSQLSERVER`）
- SQL Server Agent：左侧对象树 `SQL Server Agent → 作业` 展开作业列表；单击选中，双击打开详情页签
  （步骤/计划/最近 100/500 条历史、启停/启用/禁用、T-SQL 步骤命令在编辑器打开、生成 `sp_update_job*` 脚本）；
  生命周期操作写入查询历史（来源 `agent-control`）
- DATETIME、DECIMAL、JSON、BIGINT 按数据库返回形态展示
- 查询取消：MySQL/MariaDB 用 `KILL QUERY`，连接保留；SQLite 终止 Worker，需要重连
- 每个 SQL 标签一个独立会话/物理连接；标签间查询与取消互不阻塞
- 结果集不设行数上限，查询/导出默认加载全部行；大结果集请用 `WHERE`/`LIMIT` 控制范围（内存随行数增长）

尚未接入：

- MSSQL Agent 30s 自动刷新与作业运行中状态（P1）
- 版本感知、补全类型提示、通配符展开、SQLite ATTACH 库内对象、MySQL 跨库列（列/别名/限定名/库/Schema/函数补全、函数签名、大小写跟随、空格触发、编辑器内多语句与多结果页签已实现）
- 标签持久化（v1.x；服务器实体/分组/事务面板/独立 browse session/browse-only 对象操作/快照持久化已实现；服务器级 Agent 明确不做）
- 错误波浪线、真流式导出/进度/取消（当前导出前最多加载 1 万行）
- 打包/安装包、性能基线与无障碍

> MSSQL UI 建表/改表已支持 schema + IDENTITY 主路径；默认值、computed、rowversion 等列属性仍需用 SQL 编辑器。

设计取舍：**服务器是身份，保存连接是连接配置（类），session 是运行时对象**（PRD v0.20 目标；当前实现仍是扁平保存连接）。双击保存连接打开左侧树，右击 →「查询」创建 tab + session；每个 SQL 标签与一个 session 强绑定，一个会话对应一个物理连接。关闭标签即关闭会话；不做连接池。编辑/删除保存连接不影响已创建的 tab session。标签之间查询和取消互不阻塞。

连接配置持久化在主进程元数据库 `<userData>/dbcraft-meta.db`；密码经 `safeStorage` 加密后落盘，只在主进程解密，不回传渲染层。

## 日志

- `npm run dev` 默认 `debug` 级别；打包后默认 `info`。
- 覆盖级别（PowerShell）：`$env:DBCRAFT_LOG_LEVEL = "debug"; npm run dev`，可选 `error|warn|info|debug`。
- 开发/未打包写入项目根 `logs/dbcraft.log`（即当前工作目录下）；打包后写入 `<userData>/logs/dbcraft.log`；
  可用 `DBCRAFT_LOG_DIR` 覆盖。单文件 5 MB 轮转、保留 3 个历史文件；`logs/` 已加入 `.gitignore`。
- 渲染进程日志经 `log:write` IPC 汇入同一文件，来源校验与长度校验在 IPC 层完成。
- 日志不记录 SQL 文本、密码或连接串；敏感字段自动打码。详见 `prd/PROJECT_MASTER.md` §3.8「日志约定」。

## 文档

- `prd/PRD.md`：需求基线（只读；需求变更需单独评审）
- `prd/FEATURE_MATRIX.md`：功能清单与实现状态（✅/🟡/❌/⏸ 总表）
- `prd/TECH_DESIGN.md`：技术设计（进程、IPC、驱动、存储、安全）
- `prd/PROJECT_MASTER.md`：项目主文档：文档定位、连接/服务器/标签/会话模型、实现现状与验收、未完成项、UI 真机验收、变更记录

## 许可证

MIT，版权人 fanzhouqi。
