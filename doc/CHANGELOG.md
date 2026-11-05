# 变更记录

> 产品差距与模块完成度见 `IMPLEMENTATION_STATUS.md`；日志约定见 `LOGGING.md`。

## 2026-11-05 · 查询链路加固与日志框架

### 修复

- **SQLite 大整数精度**：Worker 开启 `defaultSafeIntegers`，单元格编码对超出 `2^53` 的整数保留字符串，不再被静默四舍五入。
- **SQLite 取消竞态**：先标记 `canceled` 再调用取消；响应带 `connectionClosed`，状态栏进入“会话失败”，可点连接就地重连。
- **SQLite Worker 失效**：`error` / `exit` 后会话标记为不可用，管理器移除并提示重连；不再出现“假在线”。
- **对象树点表 SQL**：新增方言工具，按 MySQL 反引号、SQLite 双引号、MSSQL 方括号生成标识符；MSSQL 用 `TOP` 分页，修复 MySQL 1064 与 MSSQL 无 `LIMIT`。
- **schema 加载失败**：IPC 改为 `SchemaGetResult`，UI 展示具体错误，不再静默空树。
- **MySQL/MariaDB 大结果集**：改为流式读取，只保留前 2,000 行；MariaDB 的 DML/DDL 仍走普通查询以保留 `affectedRows`。
- **错误模型**：`QueryError` 增加 `sqlState` / `errno` / `retryable`，结果区展示原生错误码与 SQLSTATE；SQLite 不伪造 SQLSTATE。
- **MSSQL 会话泄漏**：`openSession` 先关闭同 id 旧会话再判断类型。
- **退出流程**：`before-quit` 等待 `closeAllSessions()` 完成后再退出。
- **IPC 来源**：所有 handler 校验主窗口与主框架，拒绝子帧/未知 WebContents。
- 修正连接表单过期的 M0 文案与 preload 参数命名。

### 新增

- **统一日志框架**
  - 主进程 `src/main/logging/logger.ts`：`error/warn/info/debug`、控制台 + 文件、5 MB × 3 轮转、敏感字段打码。
  - 渲染进程 `src/renderer/src/logging.ts`：经 `log:write` IPC 汇入主进程，带长度与来源校验。
  - 开发/未打包默认 `debug`，打包后默认 `info`，可用 `DBCRAFT_LOG_LEVEL` 覆盖。
  - `main.tsx` 注册全局 `error` / `unhandledrejection` 日志。
  - 新增 `doc/LOGGING.md`。
- **方言工具** `src/shared/dialect/identifiers.ts`：`quoteIdent()` / `buildTablePreviewSql()`。

### 测试

- `npm run typecheck`：通过（包含日志改动）。
- `npm run build`、`npm run e2e:sqlite`：在日志改动之前通过。
- 日志改动之后仅完成 `typecheck`；受限沙箱下 Vite 的 `net use` 探测会触发 `spawn EPERM`，构建/E2E 运行时验证待补。
- E2E 覆盖：取消后会话失效与同标签重连、大整数原值、`SQLITE_ERROR` 展示、IPC 来源校验后全链路正常、应用可正常退出。

### 已知限制

- MySQL / Percona / MariaDB 的流式读取与错误模型未在真实实例上回归（本机 3307/3308 未运行）；此前 spike 仅验证过认证与基础查询。
- MSSQL 驱动仍未接入，只有连接表单。
- 日志还没有查看/导出 UI；写盘为同步 `appendFileSync`，后续日志量增大时改为有界异步队列。

### 文档

- 新增 `doc/IMPLEMENTATION_STATUS.md`（模块覆盖率、缺陷清单、基础设施差距、推进顺序）。
- 新增 `doc/LOGGING.md`（级别、路径、格式、用法、脱敏规则）。
- 新增本文件 `doc/CHANGELOG.md`。
- `README.md` 增加日志章节与文档索引；`AGENTS.md` 增加日志不变量。
