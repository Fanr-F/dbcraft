# DBCraft 实现现状与差距清单

| 项目 | 内容 |
|---|---|
| 对照文档 | `doc/PRD.md` v0.16、`doc/TECH_DESIGN.md` v0.11 |
| 审查日期 | 2026-11-05 |
| 代码基线 | `197bf83 docs: add AGENTS.md` 之后的工作区 |
| 审查方式 | 逐模块对照 PRD 4.x / TECH_DESIGN 4–15 节；`npm run typecheck`；对 better-sqlite3 行为做运行时探针 |

> 本文是“文档要求 → 代码现状”的快照，不代表产品范围变更。实现推进时更新“状态”列即可。

---

## 1. 结论

当前可运行链路只有：**新建连接 → 单语句执行 → 只读结果网格**。

- 8 个 P0 模块中，MOD-03/04/05/07/08 基本为 0；MOD-01/02/06 只有骨架。
- 按 PRD §7，M1 退出标准要求 MSSQL 连接成功、补全、导出主路径可用，因此 **M1 尚未达标**。
- 现有执行链路本身也存在会直接影响用户的数据正确性与会话状态缺陷（见 §3）。

---

## 2. 模块覆盖率

| 模块 | 状态 | 已有 | 主要缺口 |
|---|---|---|---|
| MOD-01 连接管理 | 🟡 约 25% | 五类连接表单、内存连接列表、SQLite/MySQL 系测试连接、会话打开/关闭、对象树 | 连接持久化、编辑/复制/删除、分组与搜索、右键菜单、最近使用、健康状态、断线重连、SQLite 只读降级、认证插件矩阵、错误码映射、MSSQL 实例与驱动、safeStorage |
| MOD-02 SQL 编辑器 | 🟡 约 15% | 多标签、`<textarea>`、Ctrl+Enter 执行、每标签独立会话 | Monaco、语法高亮、补全、格式化、分句器、选中/光标语句执行、多语句与多结果、SQL 文件、30s 草稿、超时、可配置行数、schema 缓存、快捷键 |
| MOD-03 查询历史 | ❌ 0% | — | 元数据库、history/FTS5、60s 去重、脱敏、搜索过滤、复用/删除/清空、导出 |
| MOD-04 UI DDL | ❌ 0% | — | Dialect 抽象、DDL 生成器、设计视图、预览弹窗、索引/约束、SQLite 重建表、维护锁 |
| MOD-05 表数据编辑 | ❌ 约 5% | RevoGrid 只读展示 | 分页/排序/过滤、单元格编辑、增删行、事务提交/回滚、乐观锁、无主键只读、BLOB 查看器、粘贴、撤销、关闭确认 |
| MOD-06 结果与导出 | 🟡 约 35% | 结果网格、行数/耗时/截断、区域复制 | 多结果集/消息面板、SQLSTATE/原生码、NULL 样式、类型对齐、大字段查看器、全部导出格式、可配置上限 |
| MOD-07 设置 | ❌ 0% | — | 设置 UI、主题切换、数据目录、migration/备份、草稿、本地统计 |
| MOD-08 MSSQL Agent | ❌ 0% | 连接表单字段 | MSSQL 驱动、Agent 节点、作业列表/详情、启停/启用/禁用、ALTER 脚本生成 |

---

## 3. 已确认的缺陷

| # | 严重度 | 状态 | 位置 | 说明 |
|---|---|---|---|---|
| 1 | P0 | ✅ 已修 | `src/main/workers/sqlite-worker.ts` | SQLite 整数未开 safeIntegers，`9007199254740993` 实测返回 `9007199254740992`（精度丢失）。 |
| 2 | P0 | ✅ 已修 | `src/main/services/ConnectionManager.ts`、`src/main/services/sqlite/SqliteSession.ts` | SQLite 取消时先 `failAll` 后置 `canceled`，导致响应不带 `connectionClosed`，会话留在表里但 Worker 已死；标签显示仍在线且无法就地恢复。 |
| 3 | P0 | ✅ 已修 | `src/main/services/sqlite/SqliteSession.ts` | Worker `error`/`exit` 后未标记会话失效，后续查询挂起或报错但 UI 仍显示已连接。 |
| 4 | P1 | ✅ 已修 | `src/renderer/src/App.tsx` | 点击对象树生成 `SELECT * FROM "name" LIMIT 100`：MySQL 默认 `sql_mode` 下双引号是字符串（1064），MSSQL 不支持 `LIMIT`。 |
| 5 | P1 | ✅ 已修 | `src/main/services/ConnectionManager.ts`、`src/shared/ipc-contract.ts` | schema 加载失败被吞成 `[]`，对象树“假空”，没有错误提示。 |
| 6 | P1 | ✅ 已修 | `src/main/services/mysql/MysqlSession.ts`、`src/main/services/mariadb/MariaSession.ts` | 改为流式读取，只保留前 2000 行。MySQL 全走流式；MariaDB 对结果集语句流式、DML/DDL 保留普通查询以拿 `affectedRows`。尚未在真实 MySQL/MariaDB 实例上回归。 |
| 7 | P1 | ✅ 已修 | `src/shared/ipc-contract.ts`、各 Session | 错误模型增加 `sqlState`/`errno`/`retryable`；从驱动错误提取并在结果区展示，SQLite 不伪造 SQLSTATE。 |
| 8 | P2 | ⏳ 待修 | `src/main/services/query-values.ts` | 二进制只保留前 32 字节 hex，值被截断；`Date` 走 `toISOString()` 属应用层时区转换（当前 MySQL 系配 `dateStrings`，基本走不到）。 |
| 9 | P2 | ⏳ 待修 | `src/renderer/src/App.tsx` | 切换连接会重建当前标签会话并清空结果，与 PRD §3.1“切换连接不关闭现有 SQL 标签”冲突。 |
| 10 | P2 | ✅ 已修 | `src/renderer/src/features/connections/ConnectionDialog.tsx` | 表单底部仍写“M0 只验证表单，不会真正连接数据库”，与行为不符。 |
| 11 | P2 | ✅ 已修 | `src/main/services/ConnectionManager.ts` | `openSession` 对 MSSQL 在关闭旧会话前提前 return，同 sessionId 可能泄漏旧会话。 |
| 12 | P2 | ✅ 已修 | `src/preload/index.ts` | `schema.get` 形参误命名为 `connectionId`（实际为 sessionId）。 |
| 13 | P2 | ✅ 已修 | `src/main/index.ts` | `before-quit` 改为先阻止退出、等待 `closeAllSessions()` 完成后再 `app.quit()`，SQLite Worker 与数据库连接可正常关闭。 |
| 14 | P2 | ✅ 已修 | `src/main/ipc/router.ts` | 所有 IPC handler 统一校验 `event.sender` 为主窗口、`senderFrame` 为主框架，拒绝子帧/未知 WebContents。 |
| 15 | P2 | ⏳ 待修 | `src/renderer/src/features/grid/ResultGrid.tsx` | 所有列 `filter: 'string'`；无右键菜单、单格复制、NULL 样式（S4 待办）。 |
| 16 | P2 | ⏳ 待修 | 全局 | 行数上限口径不一致：代码 2000、PRD 默认 1000、AGENTS 记录 2000，需要决策。 |
| 17 | P2 | ✅ 已修 | `scripts/e2e-sqlite.mjs` | 取消用例只断言“连接仍高亮”，未验证同标签恢复（本轮已补强）。 |

---

## 4. 技术基础设施缺口

| 文档要求 | 现状 |
|---|---|
| 元数据库 + migration + 备份（TECH §5） | 不存在；连接区只在渲染进程内存 |
| 历史表 + FTS5 trigram（TECH §5.2/5.5） | 不存在 |
| `Dialect` 接口（TECH §6.2） | 不存在；本轮仅补了标识符/分页的最小工具 |
| 分句器（TECH §7.1） | 不存在；SQLite 仍拒绝多语句 |
| 补全 / 格式化（TECH §7.3/7.4） | 不存在；`monaco-editor`、`sql-formatter`、`node-sql-parser` 未安装 |
| 流式结果事件（TECH §4.4） | 主进程内部已按流读取并限制行数；IPC 仍是单次 invoke 返回，尚未做分块事件与背压 |
| `AppError` 错误模型（TECH §4.5） | 部分：`QueryError` 已有 `code`/`sqlState`/`errno`/`retryable` 并在 UI 展示；尚无统一错误分类、中文映射与重连策略 |
| 导出 worker（TECH §12） | 不存在 |
| safeStorage / SecretStore（TECH §13.2） | 不存在 |
| 历史/DDL/网格/Agent/设置/导出 IPC | 不存在；当前仅 8 个通道 |
| Vitest / docker-compose / 主路径 E2E（TECH §15） | 只有 smoke 与 e2e:sqlite |
| PRD 定稿技术栈（Monaco、Ant Design、Zustand、TanStack Query、SheetJS） | 均未安装；当前为手写 CSS + useState |

---

## 5. 文档与实现冲突（需决策）

1. **结果集上限**：PRD §4.2.3/§4.6.1 默认 1000 且可配置；代码固定 2000。
2. **切换连接语义**：PRD §3.1 与当前“重建当前标签会话”不一致。
3. **技术栈**：PRD 附录 A.2 已定稿 Monaco + Ant Design + Zustand + TanStack Query；当前是 textarea + 手写 CSS + useState。是继续按文档迁移，还是先保持轻量、同步修订文档，需要明确。
4. **M1 范围**：PRD 要求 MSSQL 连接成功；README/AGENTS 记录 MSSQL 未接入。建议以 PRD 为准补驱动，或正式下调 M1 退出标准。
5. **SQLite 多语句**：PRD MOD-06 要求“返回最后一条语句结果”，AGENTS 明确“只支持单语句、拒绝多语句”。当前实现遵循 AGENTS。

---

## 6. 建议推进顺序

1. 修复 §3 中 P0/P1（本轮已完成 #1–#7、#10–#14、#17）。
2. 元数据库 + 设置（后置一切持久化能力的前提）。
3. MSSQL 驱动 + 结果集上限/超时可配置 + 导出。
4. 补全（Monaco + schema 缓存 + 分句器）与查询历史（FTS5）。
5. DDL 设计器/预览/SQLite 重建、网格事务编辑、Agent。

---

## 7. 本轮验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过（包含日志框架改动） |
| `npm run build` | 通过（日志改动之前；日志改动后待补） |
| `npm run e2e:sqlite` | 通过（日志改动之前；日志改动后待补） |

> 日志框架加入后仅重新跑了 `typecheck`。受限沙箱下 Vite 会执行 `net use` 探测并触发 `spawn EPERM`，因此 `build` / `e2e:sqlite` 需在完全访问模式或沙箱外补跑；补跑后应检查 `%APPDATA%\dbcraft\logs\dbcraft.log` 是否包含 `[INFO] [app] 应用启动` 与 `[DEBUG]` 行。

E2E 新增回归断言：

- SQLite 取消查询后，状态栏进入“会话失败”，点击连接可重连并在同一标签继续查询；
- `SELECT 9007199254740993` 在结果网格中保持原值，不再被四舍五入；
- `SELECT * FROM missing_table` 的错误区同时展示 `no such table` 与 `SQLITE_ERROR`；
- IPC 来源校验生效后，连接、查询、对象树等全部交互仍正常；
- 应用退出时会先关闭会话，Playwright `app.close()` 可正常完成。

残余风险：MySQL/MariaDB 的流式读取尚未在真实实例上回归（本轮环境无运行中的 3307/3308 实例），目前仅有类型检查与构建保证；后续应在 `spikes/mysql-auth` 启实例后补一次手工/自动验证。

> 环境备注：本轮修复了工作区 `D:\Code\dbcraft` 缺失的 Windows 文件权限（当前用户完全控制）。修改前的备份与回滚脚本位于 `D:\Code\acl-recovery\`，报告为 `acl-report-cfca5545e36b408b861b55bf14f91bcc.jsonl`。
