# DBCraft 项目现状、差距与验收

| 项目 | 内容 |
|---|---|
| 对照文档 | `doc/PRD.md` v0.16、`doc/TECH_DESIGN.md` v0.11 |
| 最近更新 | 2026-11-06 |
| 代码基线 | 基线提交 `e4e1a10` 之后的工作区（40+ 轮改动尚未提交） |
| 文档定位 | 记录「实现到哪、还差什么、怎么验收、有哪些约定与历史」；操作流水见 `doc/WORKLOG.md` |

> 本文由原先的 `IMPLEMENTATION_STATUS.md`、`PRD_AUDIT.md`、`DDL_PLAN.md`、`VERIFICATION.md`、
> `LOGGING.md`、`CHANGELOG.md`、`SESSION_2026-11-06.md` 合并整理而成，并取代这些文件。
> **需求以 `PRD.md` 为准，设计以 `TECH_DESIGN.md` 为准**；本文只记录实现事实，不修改需求。
> 文档冲突时的优先级：源码 / `package.json` / `scripts/` ＞ 本文 ＞ PRD / TECH_DESIGN 中的过时描述。

## 目录

1. [项目结论与待决策](#1-项目结论与待决策)
2. [模块现状与差距](#2-模块现状与差距)
3. [缺陷、风险与已修复项](#3-缺陷风险与已修复项)
4. [测试与验收](#4-测试与验收)
5. [MOD-04 UI DDL 现状与后续方案](#5-mod-04-ui-ddl-现状与后续方案)
6. [日志约定](#6-日志约定)
7. [变更里程碑](#7-变更里程碑)
8. [本次交付快照与提交检查](#8-本次交付快照与提交检查)
9. [附录：文档合并映射](#9-附录文档合并映射)

---

## 1. 项目结论与待决策

### 1.1 当前可运行链路

**新建连接 → 单语句执行 → 结果网格 → 表格编辑 / 导出 / 查询历史 / UI DDL / 设置。**

- 已接真实查询：SQLite、MySQL、Percona、MariaDB、MSSQL（SQL Server 2016 SP2 已实测）。
- 8 个 P0 模块中，MOD-01～MOD-07 已具备可用主路径，MOD-08（MSSQL Agent）已实现列表/详情/启停/脚本主路径（对象树入口 + 主区域页签）。
- MSSQL 驱动已接入，M1 的「MSSQL 连接成功」门槛已满足；`build` / `smoke` / `e2e:sqlite` 与真机 dogfood 仍待补跑。
- 主查询仍只接受单语句；多语句脚本通过对象区「脚本」入口走 `ddl:execute`，不改变 `query:execute` 的单语句语义。

### 1.2 模块完成度总览

状态图例：🟢 基本完成（≥90%）｜🟡 部分完成｜❌ 未实现。完成度为估算，按「PRD 主路径 + 入口 + 边界」综合判断。

| 模块 | 状态 | 估算 | 已有能力摘要 | 主要缺口 |
|---|---|---:|---|---|
| MOD-01 连接管理 | 🟡 | 90% | 五类连接表单、测试连接、元数据库持久化（safeStorage）、编辑/复制/删除/断开、多级分组、搜索、最近使用、系统对象开关、生产危险语句拦截、SQLite 只读降级、库级 DDL、连接导入/导出、字符集、证书错误解释、超时、MSSQL 连接、多数据库对象树（库/表/视图/存储过程/表子对象） | SQLite 文件拖入、认证插件字段、全量错误码、真实 Percona 与 MySQL 多库回归 |
| MOD-02 SQL 编辑器 | 🟡 | 75% | 多标签、选区执行、取消、语法高亮、行号、括号匹配、格式化、关键字+对象名补全、草稿自动保存/恢复、关闭确认、SQL 文件打开/保存、多语句脚本窗口 | 列/别名/限定名补全、schema 缓存、错误波浪线、光标所在语句、多结果集/消息面板、最近文件、参数化执行、`GO`/`DELIMITER`、快捷键自定义 |
| MOD-03 查询历史 | 🟢 | 97% | history 表、成功/失败/取消记录、60s 去重、可配置保留条数、FTS5 trigram 搜索（短查询回退 LIKE）、组合过滤、时间/耗时排序、详情、插入/再次执行、JSON 导出、删除/清空、赋值型脱敏、写入队列与退出前 flush | FTS 索引损坏自动重建、更完整的敏感内容识别 |
| MOD-04 UI DDL | 🟢 | 95% | 查看/复制 DDL、新建表/视图、加/删/重命名/修改列、SQLite 重建表、重命名/删除表、删除视图、索引管理、表结构（列/索引/外键/CHECK/注释）、表注释编辑、多语句脚本逐条结果、库级 DDL | CHECK 约束编辑（PRD 未要求）、列序调整、触发器/视图在重建表中的保留策略、通用预览弹窗抽取 |
| MOD-05 表数据编辑 | 🟡 | 86% | 数据页、50/200/500 分页、下拉/列头服务端排序、参数化 LIKE 过滤、单元格编辑、多行粘贴、增删行、单事务提交/回滚、乐观锁、本地撤销栈、主键/生成列保护、无主键高风险仅新增、只读提示 | TSV 区域复制、BLOB 大字段查看器 |
| MOD-06 结果与导出 | 🟡 | 91% | 结果网格、NULL 灰斜体、数字/日期右对齐、长文本悬停、列头本地排序、复制列名、复制单元格、单元格查看器、行数/耗时/截断提示、CSV/JSON/SQL/Excel 导出、导出前加载全部（最多 1 万行） | 真流式导出/进度/取消、多结果集、多列排序、超过 1 万行、网格右键菜单 |
| MOD-07 设置与偏好 | 🟡 | 85% | settings 表与面板、深浅主题、编辑器字号、结果行数上限、历史开关/保留条数、查询超时、数据目录、本地统计、诊断日志导出、元数据库备份/恢复、恢复默认、重置应用数据、快捷键说明 | 其他编辑器偏好、快捷键自定义、浅色主题个别强调色、migration 可视化 |
| MOD-08 MSSQL Agent | 🟡 | 80% | 对象树 `SQL Server Agent → 作业 → 作业项`、树内搜索/状态、详情页签（步骤/计划/最近 100/500 条历史）、启动/停止/启用/禁用、`sp_update_job*` 脚本生成、共享计划警告、多服务器只读、步骤命令在编辑器打开、`agent-control` 历史 | 30s 自动刷新、运行中/空闲状态、Agent XPs 禁用/权限失败真机回归、>1000 作业分页 |

### 1.3 需要确认的决策

| # | 问题 | 现状 | 建议 |
|---|---|---|---|
| D-1 | 技术栈是否迁到 PRD 附录 A.2 的 Monaco + Ant Design + Zustand + TanStack Query + SheetJS | 当前是原生 textarea 高亮、手写 CSS、useState、零依赖 XLSX | 二选一：按 PRD 迁移，或正式修订 PRD 承认轻量方案；不要长期两套说法 |
| D-2 | M1 是否必须包含 MSSQL 连接 | 已接入 `tedious`，SQL Server 2016 SP2 实测连接/查询/对象树/DDL/表编辑/取消通过 | 后续补 MOD-08 Agent，并按真机 dogfood 收口 |
| D-3 | 切换连接时是否保留当前 SQL 标签 | PRD §3.1 要求不关闭现有标签；当前会把当前标签改绑到新连接并清空结果 | 建议改为新建标签或按标签独立绑定，见缺陷 B-2 |
| D-4 | 主查询与多语句的边界 | AGENTS 规定 `query:execute` 只支持单语句；PRD MOD-06 提到「返回最后一条语句结果」 | 保留单语句主查询 + 脚本窗口的现状，并回写 PRD 说明 |
| D-5 | 结果集默认上限是 1000 还是 2000 | PRD 默认 1000；代码与设置默认 2000，可配置 100/500/1000/2000/5000 | 统一为 2000 并回写 PRD，或把默认值改回 1000 |

---

## 2. 模块现状与差距

### 2.1 MOD-01 连接管理

已实现：

- SQLite / MySQL / Percona / MariaDB / MSSQL 连接表单；SQLite 文件选择；测试连接。
- MSSQL 走 `tedious` 单连接：测试连接、会话、查询、对象树、表元数据/结构、查看 DDL、表数据页、表编辑与取消；
  已在 SQL Server 2016 SP2（Developer Edition）上跑通。
- MSSQL 命名实例：支持 `主机\实例名`、`主机:端口` 与独立实例名输入；实例名走 SQL Browser（UDP 1434）解析，
  与端口互斥；错误提示会引导启动 SQL Server Browser 或改用端口。
  已在 SQL Server 2016 SP2 默认实例上通过 SQL Browser 解析 `MSSQLSERVER` → 1433 并完成会话/Agent 联调。
- 元数据库 `<userData>/dbcraft-meta.db` 持久化连接；密码经 `safeStorage` 加密为 BLOB，只在主进程解密，不回传渲染层。
- 连接编辑、复制、删除、断开、右键菜单；编辑保存后同连接标签自动用新配置重连。
- 多级分组（`A/B/C`）、折叠、重命名/删除分组、拖拽换组；连接与对象合并为一棵树：
  分组下直接列保存连接，连接节点可打开/关闭对象树，当前连接的对象树内联显示；连接右侧状态点区分
  已连接/连接中/连接失败/未连接。连接与表/视图/作业共用搜索框；最近使用排序。
- 系统对象开关（SQLite、MSSQL；其他方言禁用并提示）。MSSQL 打开后可浏览 `master` / `msdb` 等系统库中的
  `is_ms_shipped = 1` 表/视图，例如 `master..spt_values`、`msdb..sysjobs`。
- 生产连接危险语句拦截（`DROP` / `TRUNCATE` / 无顶层 `WHERE` 的 `UPDATE`、`DELETE`）。
- SQLite 锁/权限错误回退只读，UI 横幅提示并禁用建表。
- 库级 DDL 汇总；连接配置 JSON 导入/导出（永不含密码）。
- 字符集配置；自签名/过期/主机名不匹配/证书链不完整四类中文提示。
- 会话打开/关闭、对象树、失败原因与重连入口；TLS 回退明文警告条。连接未就绪时只显示“未连接/正在连接”提示，
  不渲染数据库、表、视图、存储过程或 Agent 细节。
- 多数据库对象树（MSSQL / MySQL 系）：列出有权限的数据库、切换当前库、库下表/视图/存储过程、
  表下约束/触发器/索引（懒加载）；SQLite 维持单库树。

主要缺口：

| 缺口 | 说明 |
|---|---|
| SQLite 文件拖入 | 无 drag/drop 处理 |
| 认证插件 | 表单无插件字段，认证行为由驱动默认值决定 |
| 错误码覆盖 | 常见码已有中文建议，未覆盖全部驱动码 |
| Percona 真机 | 与 MySQL 共用代码路径，但无真实 Percona 实例回归 |
| 多库真机 | MSSQL 多库已真机验证；MySQL / MariaDB 多库查询未在真实实例回归（便携实例下载失败） |
| MSSQL 保真边界 | `datetimeoffset` 原始偏移被驱动归一化为 UTC；`decimal` 超过 15 位有效数字会丢精度；`datetime2` 只到毫秒 |
| MSSQL UI DDL | 查看 DDL/表结构已支持；UI 建表/改表仍返回「尚未实现」提示，需用 SQL 编辑器 |
| MSSQL 命名实例 | 默认实例经 SQL Browser 已验证；命名实例（非 `MSSQLSERVER`）与动态端口尚未真机回归 |

### 2.2 MOD-02 SQL 编辑器

已实现：

- 多标签、每标签独立会话、Ctrl+Enter 执行（有选区只执行选区）、取消、行数/耗时统计。
- 语法高亮（高亮层 + 透明 textarea，IME 组合期间隐藏高亮层）、行号、括号匹配（跳过字符串/注释）。
- 格式化（关键字大写、子句换行、缩进、字符串/注释原样保留），Ctrl+Shift+F。
- 基础补全：关键字 + 当前连接表/视图名，Ctrl+Space，前缀优先、键盘选择、回车/Tab 插入、Esc 关闭。
- 30 秒草稿自动保存与启动恢复（最多 20 个标签）、关闭未保存标签确认。
- SQL 文件打开/保存（Ctrl+S；首次保存弹对话框）。
- 多语句脚本窗口：按顶层分号切分（字符串/注释内分号不误切），单次最多 50 条，逐条结果。

主要缺口：

| 缺口 | 说明 |
|---|---|
| 列/别名/限定名补全 | 仅有表/视图名；无 schema 缓存与列级补全 |
| 错误波浪线 | 未实现 |
| 光标所在语句 | 只支持选区执行，未按光标定位语句 |
| 多结果集 / 消息面板 | 只有单结果区 |
| SQL 文件能力 | 缺新建/另存为/最近文件/拖入 |
| 参数化执行（P1） | 无 |
| `GO` / `DELIMITER` | 分句器只按顶层分号 |
| 快捷键自定义 | 设置面板只展示说明 |

### 2.3 MOD-03 查询历史

已实现：

- 元数据库 `history` 表，自动记录 SQL、方言、连接快照、库名、状态、耗时、影响/返回行数、来源；
  成功、失败、取消都记录。
- 同连接同 SQL 60 秒内合并并累计 `exec_count`；保留条数可配置（1000/5000/10000/50000，默认 10000）。
- FTS5 trigram 搜索：≥3 字符走 `MATCH`，短查询或 FTS 不可用时回退 `LIKE`；启动时重建索引。
- 组合过滤：方言、状态、来源、连接、库名包含、最近 1/7/30 天；排序：时间/耗时升降序。
- 详情面板、插入编辑器、插入并执行、删除单条、清空全部、按连接清空、导出当前筛选 JSON。
- 赋值型敏感字段脱敏显示（`password/token/secret/... = '...'` → `'***'`），只影响列表/详情/导出。
- 内存写入队列 + 定时落库；退出或备份/恢复前 flush。

主要缺口：

- 敏感内容识别仅覆盖赋值型，不处理 INSERT 值等复杂形式。

### 2.4 MOD-04 UI DDL

已在 §5 详细说明。当前能力覆盖查看/复制 DDL、新建表/视图、加/删/重命名/修改列、
SQLite 重建表（含复合主键）、重命名/删除表、删除视图、索引管理、表结构与注释、CHECK 展示、
多语句脚本与逐条结果、库级 DDL。

剩余：CHECK 约束编辑（PRD 未要求）、列序调整、重建表时触发器/视图的保留策略、通用预览弹窗抽取。

### 2.5 MOD-05 表数据编辑

已实现：

- 双击表/视图打开 `表 · <name>` 标签，生成 `SELECT * ... LIMIT/OFFSET`；每页 50/200/500。
- 下拉排序 + 列头点击排序（服务端 `ORDER BY`，回到第 1 页）。
- 服务端过滤：`WHERE <col> LIKE ? ESCAPE '!'`，`%`/`_`/`!` 按字面量转义，值走参数。
- 单元格编辑、多行粘贴、新增行、删除选中行；主键与生成列只读。
- 提交时单事务执行全部 UPDATE/INSERT/DELETE，任一行失败整体回滚。
- 乐观锁：UPDATE 带被修改列原值；UPDATE/DELETE 命中 0 行判定冲突并整体回滚。
- 本地撤销栈（最多 30 步）；提交/回滚/重新查询/切连接/关标签后清空。
- 无主键表、视图、只读会话禁用编辑并显示原因；无主键表可显式开启「允许新增行（高风险）」，
  主进程仍校验 insert-only。
- 有待提交修改时锁定分页、排序、切连接、关闭标签。

剩余：TSV 区域复制、BLOB 大字段查看器。

### 2.6 MOD-06 结果与导出

已实现：

- 结果网格；NULL 灰色斜体；数字/日期右对齐；长文本悬停；列头显示类型 tooltip。
- 普通查询结果列头本地排序；表数据页列头触发服务端排序。
- 复制列名（制表符分隔）、复制选中单元格（NULL 复制为空）；单元格查看器（完整值、类型、行号、字符数、复制）。
- 行数/耗时/截断提示；超过上限显示「仅显示前 N 行」。
- CSV（UTF-8 BOM、CRLF、转义、NULL 空字段）、JSON、SQL Insert（三方言语义）、Excel `.xlsx`。
- 导出前「加载全部（最多 10000 行）」：重新执行只读语句后导出；超过 1 万行仍截断提示。

剩余：真流式导出与进度/取消、多结果集页签/消息面板、多列排序、超过 1 万行、网格右键菜单。

### 2.7 MOD-07 设置与偏好

已实现：

- 元数据库 `settings` 表；设置面板；非法值回退默认。
- 深/浅主题；编辑器字号 12/13/14/16 px；结果行数上限 100/500/1000/2000/5000。
- 查询历史开关与保留条数；查询超时 0/10/30/60/120 秒（0 为不自动取消）。
- 连接/测试超时 3/5/8/10/30 秒（默认 8 秒，环境变量 `DBCRAFT_CONNECT_TIMEOUT_MS` 优先）。
- 本地数据目录、本地统计（连接数/历史条数/设置项数/元数据库大小）。
- 诊断日志导出（最多 10 MB）、打开日志目录。
- 元数据库备份/恢复（恢复前校验 `connections` 表并留自动备份）；恢复默认；重置应用数据（输入 `RESET`）。
- 快捷键说明（Ctrl+Enter、Ctrl+Space、Ctrl+Shift+F、Ctrl+S、Esc）。

剩余：更多编辑器偏好、快捷键自定义、浅色主题个别强调色、migration 可视化。

### 2.8 MOD-08 MSSQL Agent

已实现（左侧对象树展开 + 作业详情页签）：

- 对象树：MSSQL 连接下 `SQL Server Agent → 作业` 可逐级展开，作业直接列在树中（启用状态点、禁用/MSX 标记、
  上次结果 tooltip），受对象搜索框过滤；单击选中，双击打开详情页签，同一作业重复打开聚焦已有详情页签。
  Agent 节点固定在该连接对象树最后（数据库/表/视图/存储过程之后）；空作业列表不再显示“没有作业”。
  按用户反馈，不再单独打开作业列表页签（与 PRD 4.8.2 的列表页签不同）。
- 作业详情页签：基本信息、步骤（序号/名称/子系统/成功失败动作/命令摘要，T-SQL 步骤可在编辑器打开命令/复制）、
  计划（频率描述/下次运行/共享标记）、运行历史（最近 100/500 条，失败消息红色）。
- 生命周期：启动/停止/启用/禁用，操作期间按钮置灰；停止/禁用二次确认；禁用作业启动被拒绝；
  失败原样展示 SQL Server 原生错误；操作成功后详情页与左侧作业树刷新。
- 脚本化编辑：生成 `USE msdb` + `GO` + `sp_update_job` / `sp_update_jobstep` / `sp_update_schedule`，
  在编辑器打开；共享计划警告；步骤/计划用生成时 id 快照。
- 生命周期操作写入查询历史，`source = agent-control`。
- 已验证：SQL Server 2016 SP2 上创建临时作业，跑通列表/搜索/详情/脚本/启用/启动/停止/禁用/历史落库。

剩余：30s 自动刷新与「运行中/空闲」状态（P1）、多服务器作业与 Agent XPs 禁用/权限不足的真机回归、
共享计划真机验证、作业数 >1000 的服务端分页。

### 2.9 跨模块与非功能

| 项 | 状态 | 说明 |
|---|---|---|
| 深浅主题 | ✅ | 设置持久化，RevoGrid 同步 |
| 危险操作二次确认 | ✅ | 删除列/表/视图输入对象名；生产语句弹确认 |
| 错误文案中文映射 | 🟡 | 常见认证/库表/锁/语法/约束/网络/TLS 已覆盖，非全量 |
| 快捷键全集 | 🟡 | 缺 `Shift+Alt+F`、`Ctrl+E`、`F2`、`Delete` 等，且不可自定义 |
| 单实例 / CSP / IPC 校验 | ✅ | `contextIsolation`、`sandbox`、来源与参数校验 |
| 结果值保真 | 🟡 | SQLite/MySQL 系按原值；MSSQL 的 `datetimeoffset`/高精度 `decimal`/`datetime2` 受驱动限制，见 §2.1 |
| IPC 流式分块/背压 | ❌ | 主进程内部流式读取，IPC 仍是单次 invoke |
| 版本化 migration / 升级备份 | 🟡 | 有 `user_version` 与在线备份/恢复，无逐版本迁移备份策略 |
| 自动化测试 | 🟡 | 21 组纯逻辑测试 + SQLite E2E + MSSQL/Agent 真实实例联调脚本；无 Vitest、无 React 组件测试、无 CI |
| 性能基线 / 无障碍 | ❌ | 无启动/首屏/内存度量，无 WCAG/键盘路径验收 |
| 打包 / 签名 / 安装包 | ❌ | `pack` / `dist` 未验证 |

---

## 3. 缺陷、风险与已修复项

### 3.1 未关闭缺陷

| # | 级别 | 位置 | 说明 |
|---|---|---|---|
| B-2 | P2 | `src/renderer/src/App.tsx` | 切换连接会改绑当前标签并清空结果，与 PRD §3.1「切换连接不关闭现有 SQL 标签」冲突 |
| B-3 | P2 | `src/main/services/query-values.ts` | 二进制只保留前 32 字节 hex；`Date` 走 `toISOString()` 属应用层时区转换（当前 MySQL 系配置 `dateStrings`，通常走不到） |
| B-4 | P2 | `ResultGrid` / 结果区 | 列过滤固定 `filter: 'string'`；无网格右键菜单（单格复制已由结果工具栏的「复制单元格」提供） |
| B-5 | P2 | 连接设置 | 认证插件字段缺失；连接/测试超时已进设置面板，环境变量仍可覆盖 |
| B-6 | P2 | 导出 | 非真流式；最多加载 1 万行；无进度与取消 |
| B-8 | P2 | 文档 | README / PRD / TECH 存在滞后描述；本次已更新 README 文档索引与功能概览，PRD/TECH 仍需按决策回写 |

> 不要把以上缺陷描述成「已验收通过」；UI 路径目前仍缺真机验收，见 §4.5。

### 3.2 已修复的关键缺陷（防回归基线）

| 缺陷 | 修复要点 |
|---|---|
| SQLite 大整数精度丢失 | Worker 开启 safeIntegers，超 `2^53` 整数以字符串返回；`SELECT 9007199254740993` 保持原值 |
| SQLite 取消竞态 / 假在线 | 先标记 canceled 再取消；Worker `error`/`exit` 标记会话失效，UI 提供重连 |
| 对象树 SQL 方言错误 | `quoteIdent` 按 SQLite 双引号、MySQL 反引号、MSSQL 方括号生成；MSSQL 使用 `TOP`/`OFFSET FETCH` |
| schema 失败被吞成空树 | `SchemaGetResult` 返回错误并在 UI 展示 |
| MySQL/MariaDB 大结果集 | 改为流式读取，只保留上限行数 |
| 错误模型不足 | `QueryError` 增加 `sqlState`/`errno`/`retryable`，UI 展示原生错误与中文建议 |
| MSSQL 会话泄漏 | `openSession` 先关闭同 id 旧会话再判断类型 |
| MSSQL 驱动未接入 | 用 `tedious` 单连接接入：测试连接/查询/对象树/表元数据/查看 DDL/表数据页/表编辑/取消；SQL Server 2016 SP2 实测通过 |
| MSSQL 请求并发冲突 | 一个物理连接同一时刻只能跑一个请求，元数据查询改为串行，避免 `EINVALIDSTATE` |
| MSSQL 值格式 | Date 按 UTC 分量拼回 `datetime/datetime2/date/time`，`decimal` 转字符串；`sys.objects.type` 读取后 trim |
| 退出时未关闭会话 | `before-quit` 等待 `closeAllSessions()` 后退出 |
| IPC 来源未校验 | 所有 handler 校验主窗口与主框架，拒绝子帧/未知 WebContents |
| 连接表单过期文案 | 移除「M0 只验证表单」等描述 |
| DDL 未写入历史 | `ddl:execute` 成功后按 `source=ddl-preview` 落库，失败保留错误摘要，一次执行合并为一条 |
| 连接/测试超时无 UI | 设置面板新增「连接/测试超时」，环境变量仍优先；MySQL/MariaDB 建连时透传 |
| FTS 索引损坏不自愈 | MATCH 异常时先重建索引并重试一次，仍失败才回退 LIKE |
| E2E 取消断言过弱 | 增加同标签重连、失败提示等断言 |
| RevoGrid 开发模式结果空白 | Vite 预打包会拆坏 RevoGrid/Stencil 懒加载入口，`optimizeDeps.exclude` 排除两包后，`npm run dev` 下 SQLite/MSSQL 结果正常渲染 |

### 3.3 风险说明

- **所有 UI 改动尚未在真实 Electron 中完整跑过**（本轮与之前 39 轮均受环境限制）。
  最高风险：连接持久化/密码解密、右键菜单、各类弹窗、表格编辑/粘贴/撤销、高亮层对齐、
  补全弹层、SQLite 重建表、浅色主题、备份/恢复/重置。
- MySQL / Percona / MariaDB 的流式读取、TLS 回退、`KILL QUERY` 只在代码层完成，未在真实实例回归。
- 纯逻辑测试不覆盖 React 组件、真实驱动错误与 IPC 端到端攻击面。
- `build` / `smoke` / `e2e:sqlite` 依赖本机 Electron 与构建工具，受限沙箱下会因 `spawn EPERM` 失败。
- MSSQL 只在 SQL Server 2016 SP2 上验证过主路径；未验证 TLS 严格校验、多 schema 同名对象、
  命名实例（非默认实例）与动态端口、Agent 权限不足/Agent XPs 禁用路径。

---

## 4. 测试与验收

### 4.1 当前自动化检查

本次整理文档时在**当前工作区**重新执行：

```powershell
npm run typecheck
npm run test:safety
npm run test:groups
npm run test:ddl
npm run test:dml
npm run test:export
npm run test:history
npm run test:errors
npm run test:connection-export
npm run test:timeouts
npm run test:pagination
npm run test:settings
npm run test:sql-highlight
npm run test:sql-format
npm run test:sql-completion
npm run test:sql-brackets
npm run test:sql-mask
npm run test:sql-script
npm run test:xlsx
npm run test:sqlite-rebuild
npm run test:checks
npm run test:mssql
```

结果：`typecheck` 通过；**21 组纯逻辑测试全部通过**；`check:mssql` 在 SQL Server 2016 SP2 上通过。
`build` / `smoke` / `e2e:sqlite` 本轮未执行。

| 命令 | 覆盖 |
|---|---|
| `test:safety` | 生产连接危险语句识别（16 例：注释、字符串、子查询、大小写、方言环境） |
| `test:groups` | 分组树嵌套、排序、计数、空路径 |
| `test:ddl` | CREATE TABLE/VIEW、ADD/DROP/RENAME/MODIFY COLUMN、INDEX、DROP、表注释 |
| `test:dml` | 参数化 DML、乐观锁、主键/生成列、无主键 insert-only、真实内存 SQLite 回放 |
| `test:export` | CSV / JSON / SQL Insert 与转义、NULL 与空串 |
| `test:history` | 去重、淘汰、FTS 搜索与短查询回退、组合过滤、排序、按连接清空 |
| `test:errors` | 错误码与证书错误 → 中文建议 |
| `test:connection-export` | 连接导入导出、密码剥离、字符集校验、非法输入 |
| `test:timeouts` | 超时配置解析 |
| `test:pagination` | 分页/排序/过滤 SQL、LIKE 转义与真实 SQLite 回放 |
| `test:settings` | 设置归一化（行数、主题、字号、历史、超时） |
| `test:sql-highlight` | SQL 词法切分无损性与 token 分类 |
| `test:sql-format` | 格式化：关键字/注释/字符串/多语句/幂等 |
| `test:sql-completion` | 补全前缀、排序去重、插入位置 |
| `test:sql-brackets` | 圆/方/花括号、嵌套、字符串/注释、未配对 |
| `test:sql-mask` | 历史 SQL 赋值型脱敏边界 |
| `test:sql-script` | 多语句分句（字符串/注释分号、50 条上限） |
| `test:xlsx` | ZIP/OOXML 结构、单元格类型、XML 转义 |
| `test:sqlite-rebuild` | 重建表语句生成 + 真实 SQLite 回放（数据/索引/类型/复合主键） |
| `test:checks` | 从 CREATE TABLE 提取 CHECK（嵌套括号/字符串/注释） |
| `test:mssql` | MSSQL 值格式化（datetime/date/time/decimal/binary）、限定名/命名实例解析、分页过滤 `@p1`、Agent 时间/频率/脚本生成 |

`npm run check:mssql` / `npm run check:mssql-agent` 不是纯逻辑测试：读取 `.env.local`，在真实 SQL Server 上
建删临时表/作业，覆盖连接、查询、对象树、表元数据/结构、DDL、表数据页、参数化 DML/乐观锁、取消，
以及 Agent 列表/详情/脚本/启停/启用/禁用与运行历史。

### 4.2 必须在沙箱外补跑

```powershell
npm run build        # 先 typecheck，再 electron-vite build
npm run smoke        # 构建后启动 Electron，检查窗口与 preload 桥接
npm run e2e:sqlite   # 自动构建、建临时库、完整 SQLite E2E
```

说明：

- `e2e:sqlite` 使用 `--user-data-dir=<临时目录>`，不污染真实 `%APPDATA%`；
- 预期看到「e2e:sqlite passed」；
- 失败时优先看第一条断言对应的功能；测试脚本 `scripts/e2e-sqlite.mjs` 带中文注释。

### 4.3 E2E 覆盖场景（SQLite）

1. 新建 SQLite 连接 + 测试连接（校验版本号）；保存后自动打开会话，状态栏显示版本。
2. 对象树出现表与视图；系统对象默认隐藏，勾选后出现 `sqlite_sequence`，取消后隐藏。
3. 点表填入 `SELECT * FROM "demo_users"`；执行后网格出现数据、状态栏行数正确。
4. 超过 2000 行显示「仅显示前 2000 行」。
5. UPDATE 返回「1 行受影响」；错误表名同时显示 `no such table` 与 `SQLITE_ERROR`；多语句被拒绝。
6. 生产连接无 WHERE 的 DELETE 弹确认，取消后数据仍在。
7. 取消查询 → 会话失败；提示条含原因，点「重连」后同标签继续查询。
8. BIGINT `9007199254740993` 不丢精度；两个标签互不阻塞。
9. 查看 DDL、新建表、生成库级 DDL、查询历史插入、超时、表数据页翻页/排序、重命名/删除表、
   添加/删除列、创建/删除索引。
10. 应用退出时先关闭会话，Playwright `app.close()` 可正常完成。

> 其中部分断言是在受限环境下新增、尚未实际执行的，需在 §4.2 补跑后确认。

### 4.4 手工验收（`npm run dev`）

#### 4.4.1 连接与持久化

1. 新建 SQLite 连接指向 `samples/demo.db`，保存后自动打开，对象树出现表/视图。
2. 新建 MySQL 连接（可用 `spikes/mysql-auth/scripts/setup.ps1` 启动 3307），保存后重开应用，连接仍在。
3. 字符集：MySQL 系连接填写 `utf8mb4` 后保存并重开，配置仍保留；留空时使用驱动默认。
4. 右键连接 → 编辑，改名并保存；标题/列表更新，若该连接有打开的标签会自动重连。
5. 右键连接 → 复制、断开、删除；删除需二次确认，标签解除绑定。
6. 导出单个/全部连接为 JSON，检查文件里没有密码字段值；再导入，提示密码需重新输入。
7. 分组：新建连接时填 `项目A/测试环境`，出现嵌套分组；右键重命名/删除；拖拽连接换组。
8. 连接搜索、对象树搜索均可用，大小写不敏感。
9. 设置 `DBCRAFT_CONNECT_TIMEOUT_MS=1000` 后连接不可达主机，应在约 1 秒内失败。
10. 打开已保存连接后，最近使用排序生效；SQLite 文件被锁/无权限时进入只读并显示横幅。

#### 4.4.2 查询、编辑器与历史

1. 执行 `SELECT * FROM demo_users LIMIT 5;`，结果网格正常；列头悬停显示类型；
   NULL 灰色斜体，数字列右对齐，长文本悬停可见完整内容。
2. 高亮：关键字、字符串、注释、数字分色；行号随滚动同步且不遮挡点击；括号配对高亮；
   中文输入法组合期间文字可见；滚动长 SQL 时高亮层与光标不漂移。
3. 点「格式化」或 Ctrl+Shift+F：关键字大写、子句换行；字符串里的 `select` 不被改写。
4. 执行错误 SQL，错误区同时显示原始错误、SQLSTATE/错误码与「建议」。
5. 打开「查询历史」：能看到刚执行的记录；搜索 `demo_users` 命中；点记录插入编辑器；
   删除单条、清空全部；「详情」显示完整 SQL、耗时、连接与错误。
6. 历史过滤：类型/状态/来源/连接筛选；排序切换；「插入并执行」；「导出 JSON」；
   「清空当前连接」只删除该连接记录。
7. 历史搜索：≥3 字符走 FTS（子串命中），2 字符仍能通过 LIKE 命中；库名与「最近 1/7/30 天」收窄结果。
8. 脱敏：执行 `UPDATE ... SET password = 'x'` 后勾选「脱敏显示」，列表/详情/导出显示 `'***'`；
   插入编辑器仍是原始 SQL。
9. 设置里的「快捷键」列出当前可用组合；底部「本地统计」与侧边栏连接数、历史条数一致。
10. 关闭「记录查询历史」后执行查询，历史不再新增；重新开启后恢复。
11. 选中一段 SQL 后 Ctrl+Enter 只执行选区；未选中时执行全文。
12. 草稿：修改 SQL 后等待 30 秒（或正常退出），重开应用恢复标签与 SQL；
    30 秒内关标签应提示最近修改尚未写入草稿。
13. SQL 文件：打开 `.sql` 生成新标签；Ctrl+S 覆盖；无路径时弹保存对话框。
14. 长查询超过 30 秒提示「查询超时」；SQLite 会话失败，点「重连」恢复；
    `DBCRAFT_QUERY_TIMEOUT_MS=0` 重启后不再自动取消。

#### 4.4.3 结果与导出

1. 执行 `SELECT * FROM demo_users LIMIT 5;`，结果区「导出」→ CSV/JSON/SQL Insert/Excel。
   Excel 打开 CSV 检查中文不乱码、NULL 为空字段；打开 `.xlsx` 检查列名、数字/布尔/NULL 与中文。
2. 点「加载全部（最多 10000 行）」后行数增加；对 `UPDATE` 执行该操作应提示仅支持查询语句。
3. 普通查询结果点击列头可本地排序；「复制列名」粘贴后得到制表符分隔的列名。
4. 点击单元格后「查看单元格」显示完整值、类型、行号与字符数，可复制；
   「复制单元格」直接把当前单元格内容写入剪贴板（NULL 复制为空）。
5. 超过结果上限时显示「仅显示前 N 行」。

#### 4.4.4 连接安全

1. 连接环境选「生产」→ 执行 `DELETE FROM demo_orders;`，弹确认并展示 SQL；取消后数据仍在。
2. 生产连接执行 `UPDATE demo_users SET status='x';`（无 WHERE）同样弹确认。
3. 非生产连接不弹确认。
4. MySQL `sslMode=prefer` 且 TLS 不可用时，连接后顶部显示「TLS 不可用，已回退为明文连接」。
5. 自签名/过期证书的 `verify-ca` 实例，错误区给出对应中文证书建议。

#### 4.4.5 SQLite 只读（较难构造）

用另一进程长期持有写锁，或移除文件写权限后打开，预期：

- 连接成功但顶部显示「当前为只读模式…」；
- 「新建表」按钮禁用；
- 执行写入时数据库返回只读错误，错误区给出中文建议。

#### 4.4.6 UI DDL

1. 表右键 → 查看 DDL：新标签出现 `CREATE TABLE ...`；复制 DDL 可用。
2. 新建表：填写表名与列 → 预览 → 执行 → 对象树出现新表。
3. 添加列/删除列/创建索引/删除索引：均需预览；删除列需要输入列名两次。
4. 重命名表、删除表、删除视图：删除类需要输入对象名确认。
5. 表结构：列类型/可空/默认值/主键正确；索引、外键、CHECK、表注释可见。
   MySQL 系可「编辑注释」并保存；SQLite 不显示该按钮。
6. 重命名列：选列 + 新列名 → 预览 `RENAME COLUMN` → 执行后查询新列。
7. 新建视图：对象区顶部「视图」按钮 → 名称与 SELECT → 预览 → 执行；对象树出现视图，双击可查数据。
8. 修改列（MySQL 系）：类型/非空/默认值自动回填，改类型 → 预览 `MODIFY COLUMN` → 执行。
   SQLite 下生成多语句重建表预览，执行后数据/索引保留、列类型更新；复合主键表也能重建，
   外键悬空时整体回滚；主键/自增列不在下拉中。
9. 连接右键 → 生成库级 DDL：新标签包含该库所有表/视图的建表 SQL。
10. 执行后对象树刷新。
11. 多语句脚本：对象区「脚本」→ 粘贴两条 `ALTER TABLE ...` 或 `CREATE INDEX` → 显示「识别到 N 条」→
    执行后逐条结果与对象树刷新；字符串中的 `';'` 仍只识别为对应语句。
12. 表结构弹窗能看到 CHECK 表达式；SQLite 表注释为空。

#### 4.4.7 表数据页

1. 双击表 → 新标签 `表 · xxx`，默认 200 行。
2. 上一页/下一页、每页 50/200/500、排序下拉与列头点击排序均生效。
3. 补全：输入 `demo_us` 后 Ctrl+Space 出现 `demo_users`（输入法可能占用快捷键，可切英文）；
   上下键选择、回车插入；Esc 关闭。
4. 双击非主键单元格改值 → 出现「待提交 N 项」，分页/排序/切连接被禁用；点「回滚」恢复原值。
5. 改值后「提交修改」→ 提示已提交并刷新；重新查询确认落库。
6. 点「新增行」，填写几列后提交；INSERT 只包含填写过的列，自增主键由数据库生成。
7. 删除选中行，提交后消失；主键列不可编辑。
8. 用第二个会话改同一行后再提交第一个会话的修改，提示冲突并保持待提交状态。
9. 编辑几处后「撤销」：最近一步回退；连续撤销回到初始值；提交后撤销不可用。
10. 无主键表 / 视图 / 只读 SQLite 文件：显示只读原因，编辑按钮不可用。
11. 过滤：选择列、输入包含内容并回车；SQL 使用 `LIKE ?`，结果只含匹配行；清除后恢复全量。
12. 多行粘贴：从表格复制区域贴到另一块（含主键列）→ 只读列不变，其余进入待提交；
    撤销一次整体回退这次粘贴。
13. 无主键表：默认只读；开启「允许新增行（高风险）」后只有新增行可编辑，已有行只读、
    删除已有行被拒绝；提交只执行 INSERT。关闭开关前必须先提交或回滚。

#### 4.4.8 设置、备份与恢复

1. 设置结果上限为 100，保存后执行 `SELECT * FROM demo_users`，最多 100 行并显示截断提示。
2. 重开应用设置仍为 100；改回 2000 后新查询恢复。
3. 手工改元数据库为非法值，启动回退默认 2000，不阻塞启动。
4. 点「导出诊断日志」得到包含启动日志的 `.log` 文件；「打开日志目录」打开对应目录。
5. 点「备份元数据库」选择路径，得到 `.db`；用 SQLite 客户端能打开并看到 connections/history/settings。
6. 恢复：先备份，修改连接后恢复；确认后重新加载，连接/历史/设置回到备份时状态，
   并在 userData 留下 `dbcraft-meta.backup-<时间>.db`。选非 DBCraft 的 SQLite 文件应提示缺少
   `connections` 表且不改动当前数据。
7. 重置：设置中「重置应用数据」，不输入 RESET 取消；输入 RESET 后连接清空、历史清空、
   设置回默认，界面自动重新加载。
8. 字号 12/14/16 px 立即生效，重开保留；「恢复默认」+保存后回到 13 px。
9. 执行 DDL（新建表/加列等）后打开查询历史，能看到 `source=ddl-preview` 的记录；
   「插入到编辑器」可还原执行过的语句。失败 DDL 同样记录并显示错误摘要。
10. 关闭并重开应用，查询历史仍存在。
11. 查询超时改为 10 秒后长查询约 10 秒提示超时；改为「不自动取消」后不再中断。
12. 历史保留改为 1000 后执行若干查询，历史表最多保留 1000 条。
13. 设置「连接/测试超时」为 3 秒后测试不可达主机，应在约 3 秒内返回超时错误；
    设置 `DBCRAFT_CONNECT_TIMEOUT_MS=1000` 重启后环境变量优先。

### 4.5 已知未验证 / 风险点

- 本轮及前 39 轮的 UI 改动未在真实 Electron 中完整运行；最高风险见 §3.3。
- MySQL / Percona / MariaDB 流式查询、TLS 回退、`KILL QUERY` 仅代码层完成。
- MSSQL 只在 SQL Server 2016 SP2 上验证主路径；TLS 严格校验、多 schema、命名实例（非默认实例）
  与动态端口、Agent 权限不足/Agent XPs 禁用路径未验证。
- MSSQL Agent 的 UI（对象树入口、列表/详情页签、按钮置灰、脚本打开新标签）尚未在真实 Electron 中运行；
  后端查询/脚本/生命周期已用 Node 对真实实例验证。
- 合并树只内联当前活动 SQL 标签所属连接的对象；其他连接即使状态点为“已连接”（有其他标签持有会话），
  也不会展开对象。这是“一标签一物理会话”的现有约束，未改成每连接独立会话。
- 对象搜索只覆盖当前库；跨库搜索仍需先切换数据库。
- 打包（`npm run pack` / `dist`）与安装包未验证。
- 自动化测试只覆盖纯逻辑与 SQLite E2E，不覆盖 React 组件和真实驱动。

### 4.6 测试数据与清理

- 演示库：`npm run demo:db` → `samples/demo.db`（已 gitignore）。
- 开发日志：项目根 `logs/dbcraft.log`（已 gitignore）；可用 `DBCRAFT_LOG_DIR` 覆盖。
- 元数据库：`<userData>/dbcraft-meta.db`；E2E/冒烟使用临时 `--user-data-dir`，结束后删除。
- E2E 临时目录：`%TEMP%\dbcraft-e2e-*`，脚本 finally 中清理。

### 4.7 仍需实现的功能（不做假验收）

1. **MOD-08 MSSQL Agent 剩余项**：30s 自动刷新、运行中/空闲状态、Agent XPs 禁用/权限失败真机回归、作业数 >1000 的服务端分页。
2. **MOD-02 高级编辑**：列/别名/限定名补全、schema 缓存、错误波浪线、光标语句、
   多结果集/消息面板、最近文件、参数化执行、`GO`/`DELIMITER`。
3. **MOD-06 输出**：真流式导出与进度/取消、多结果集、多列排序、超过 1 万行、网格右键菜单。
4. **MOD-05**：TSV 区域复制、BLOB 大字段查看器。
5. **MOD-04**：MSSQL UI 建表/改表、CHECK 编辑（可选）、列序调整、重建表时保留触发器/视图、通用预览弹窗。
6. **MOD-01**：SQLite 拖入、认证插件、全量错误码、真实 Percona 回归。
7. **MOD-07**：更多编辑器偏好、快捷键自定义。
8. **非功能**：打包/签名/安装包、性能基线、无障碍、CI 门禁。

> MSSQL Agent 剩余项见 §2.8；SQL Browser 默认实例路径已回归（2026-11-06）。

---

## 5. MOD-04 UI DDL 现状与后续方案

### 5.1 范围与边界

- 方言：SQLite + MySQL / Percona / MariaDB 的建表/改表；MSSQL 已支持查看 DDL、表结构与库级 DDL，
  UI 建表/改表尚未实现（生成器返回明确提示，请用 SQL 编辑器）。
- 对象：表、视图、索引；视图只支持查看/删除，不做可视编辑。
- 所有 UI 生成的 DDL 必须先预览，用户确认后才执行；执行后刷新对象树。
- 不做：MSSQL UI 建表/改表、ER 图、迁移文件、版本对比、触发器/存储过程编辑。
- DDL 是否写入查询历史：PRD 要求 `source=ddl-preview`，已实现；一次执行合并为一条记录，
  失败时保留错误摘要。

### 5.2 已完成阶段

| 阶段 | 状态 | 内容 |
|---|---|---|
| Phase 1 只读入口 | ✅ | `ddl:get`；SQLite 读 `sqlite_master`，MySQL 系用 `SHOW CREATE TABLE/VIEW`，MSSQL 读 `sys.sql_modules` / `sys.columns` 生成；对象树右键查看/复制 DDL |
| Phase 2 预览与执行 | ✅ | `ddl:execute`；SQLite 事务包裹，失败 `ROLLBACK`；单次 ≤50 条、单条 ≤100 KB；逐条结果 |
| Phase 3 新建表 | ✅ | 表名 + 列（类型/主键/自增/非空/唯一/默认值）；`buildCreateTable`；预览可编辑；执行后刷新（MSSQL 暂不支持） |
| Phase 4 改表 | ✅ | 重命名/删除表、删除视图、添加/删除/重命名列、MySQL 系修改列、SQLite 重建表、新建视图（MSSQL 暂不支持） |
| Phase 5 索引与结构 | ✅ | 创建/删除索引；表结构查看（列/索引/外键/CHECK/注释）；表注释编辑；多语句脚本逐条结果；库级 DDL |

### 5.3 SQLite 重建表（已实现）

`buildSqliteRebuild` 生成以下序列：

1. `BEGIN`；
2. 创建临时表 `__new_<name>`（复合主键用表级 `PRIMARY KEY (...)`）；
3. `INSERT INTO __new_<name> (cols) SELECT cols FROM <name>`；
4. `DROP TABLE <name>`；
5. `ALTER TABLE __new_<name> RENAME TO <name>`；
6. 重建原显式索引；
7. `PRAGMA foreign_key_check`，有结果则 `ROLLBACK`；
8. `COMMIT`。

约束与已知边界：

- 执行前通过 `ddl:execute` 的 `sqliteForeignKeysOff` 关闭外键，结束后恢复；
- 表达式索引明确拒绝；
- CHECK、外键定义、触发器不会保留，预览中明确警告；视图不在重建范围内；
- 版本提示：`RENAME COLUMN` 需 SQLite 3.25+，`DROP COLUMN` 需 3.35+；
- 列序调整未实现。

### 5.4 剩余工作与待决策

| 编号 | 事项 | 建议 |
|---|---|---|
| D1 | 预览弹窗用 Monaco 还是 textarea | 继续 textarea（离线、零依赖）；引入 Monaco 后再统一 |
| D2 | 是否引入 Ant Design | 不引入，保持手写 CSS；若 D-1 决定迁移再统一评估 |
| D3 | DDL 写入查询历史 | 已实现：所有 `ddl:execute` 走 `source: 'ddl-preview'`，一次执行合并为一条记录 |
| D4 | 多语句上限 | 维持单次 ≤50 条、单条 ≤100 KB |
| D5 | 重建表外键/触发器 | 继续用 `PRAGMA foreign_keys=OFF` + `foreign_key_check`；触发器保留另行设计 |
| D6 | 视图编辑 | 本期不支持，仅查看/删除 |
| D7 | 列序调整 | 需要重建表并重排列定义，后续单独实现 |

### 5.5 IPC 与文件落点

- 契约：`src/shared/ipc-contract.ts` 中 `DdlColumn`、`DdlIndex`、`TableDefinition`、`DdlStatementResult`；
  通道 `ddl:get`、`ddl:execute`、`schema:describe`、`schema:table`。
- 生成逻辑：`src/shared/dialect/`（`ddl.ts`、`sqlite-rebuild.ts`、`checks.ts`、`dml.ts`、`identifiers.ts`），
  纯函数、可单测、渲染层可用。
- 执行：只在主进程 `ConnectionManager` / 各 `DatabaseSession`；`query:execute` 保持单语句语义。
- UI：`TableDesigner`、`TableStructureDialog`、`AlterColumnDialog`、`IndexDialog`、`SqlScriptDialog` 等。
- 取消：沿用 `requestId`；SQLite 重建期间取消会终止 Worker，需明确提示「取消会断开标签会话」。

### 5.6 DDL 验收要点

- 所有生成 SQL 先预览；删除类必须输入对象名确认；
- SQLite 重建后数据、显式索引、类型、复合主键保留；外键冲突整体回滚；
- MySQL 系修改列生成单条 `ALTER`；SQLite 修改列生成多语句预览；
- MSSQL 的 UI 建表/改表入口给出「尚未实现，请用 SQL 编辑器」提示；查看 DDL/表结构可用。

---

## 6. 日志约定

| 项目 | 内容 |
|---|---|
| 适用范围 | Electron 主进程、preload、渲染进程 |
| 实现位置 | 主进程 `src/main/logging/logger.ts`；渲染进程 `src/renderer/src/logging.ts` |
| 默认级别 | 开发/未打包 `debug`；打包后 `info` |
| 覆盖方式 | `DBCRAFT_LOG_LEVEL=error\|warn\|info\|debug` |
| 落盘位置 | 开发：`<工作目录>/logs/dbcraft.log`；打包：`<userData>/logs/dbcraft.log` |
| 覆盖目录 | `DBCRAFT_LOG_DIR`（相对路径按当前工作目录解析） |
| 轮转 | 单文件 5 MB，保留 3 个历史文件（`.1` / `.2`） |

> PRD §5.3 约束：**日志不得记录 SQL 文本、密码或连接串**。查询日志只记录 `sqlLength`；
> 错误日志只记录 `code` / `sqlState` / `errno` / `retryable`，不记录驱动 `message` 原文。

### 6.1 级别

| 级别 | 用途 | 开发默认 | 打包默认 |
|---|---|---|---|
| `error` | 崩溃、渲染进程异常、未捕获错误 | ✅ | ✅ |
| `warn` | 连接/查询失败、IPC 来源不可信、参数无效 | ✅ | ✅ |
| `info` | 启动/退出、会话打开/关闭、查询完成 | ✅ | ✅ |
| `debug` | 测试连接、查询开始、取消请求等细节 | ✅ | ❌ |

临时调整（环境变量只在启动时读取）：

```powershell
$env:DBCRAFT_LOG_LEVEL = "debug"; npm run dev
$env:DBCRAFT_LOG_LEVEL = "error"; npm run dev
```

### 6.2 输出格式与用法

```text
2026-11-05T07:42:13.512Z [INFO] [session] 会话已打开 {"sessionId":"query-1","type":"sqlite","version":"3.53.4","elapsedMs":12}
2026-11-05T07:42:13.530Z [DEBUG] [session] 开始执行查询 {"requestId":"query-...","sessionId":"query-1","sqlLength":42}
2026-11-05T07:42:13.531Z [INFO] [session] 查询完成 {"requestId":"query-...","rows":100,"elapsedMs":2,"truncated":false,"statementType":"select"}
```

- 时间为 UTC ISO 8601；`scope` 区分模块（`app` / `ipc` / `session` / `renderer:<scope>`）。
- 控制台与文件内容一致；元信息 JSON 单条超过 4 KB 截断，消息超过 2,000 字符截断。

主进程：

```ts
import { createLogger } from '../logging/logger';

const log = createLogger('session');
log.info('会话已打开', { sessionId, type: input.type });
log.warn('查询失败', { requestId, code, sqlState, errno, retryable });
log.debug('开始执行查询', { requestId, sqlLength: sql.length });
```

渲染进程：

```ts
import { createLogger } from './logging';

const log = createLogger('ui');
log.info('渲染进程已加载');
log.error('未捕获错误', { message, source, line });
```

- 渲染进程不能直接写文件，经 `window.dbcraft.log.write(...)` → `log:write` 单向通道 → 主进程。
- 主进程只接受主窗口主框架请求；zod 校验 `level`、`scope` ≤64、`message` ≤2000、`meta` ≤4000。
- `src/renderer/src/main.tsx` 已注册全局 `error` / `unhandledrejection` 监听。

### 6.3 脱敏与禁止记录

`logger.ts` 对元信息键名自动打码，命中以下模式时值替换为 `***`：

```text
password / passwd / secret / token / authorization / apiKey / api_key / cookie
```

调用方仍必须遵守：

| 禁止记录 | 替代做法 |
|---|---|
| SQL 原文 | 记录 `sqlLength`、`requestId`、`statementType` |
| 密码、连接串 | 永不传入 logger；连接只记录 `type` / `version` |
| 驱动原始错误消息 | 记录 `code`、`sqlState`、`errno`、`retryable` |
| 完整文件路径 | 记录文件名或仅记录类型 |

已知边界：渲染进程传入的 `meta` 是字符串，主进程不会再按键名脱敏；渲染侧应在调用前自行裁剪。

### 6.4 与 PRD 的关系与待办

- PRD §5.3「日志不记录 SQL 文本」：已按上述约定执行。
- PRD §5.2「诊断日志导出」（P1）：已实现设置面板导出与打开目录。
- 崩溃统计/远程上报：未实现，也不计划默认开启；日志只留在本地。
- 待办：日志查看器、按天归档、日志量增大后改有界异步队列。

---

## 7. 变更里程碑

> 原 `CHANGELOG.md` 的逐条流水已按主题合并到本节。需要逐文件对照时以 git 历史为准。

### 7.1 2026-11-05：基础加固与第一轮功能

| 主题 | 关键内容 |
|---|---|
| 查询链路加固 | SQLite BIGINT 精度、取消竞态、Worker 失效、方言标识符、schema 错误、MySQL 流式读取、错误模型（sqlState/errno/retryable）、MSSQL 会话泄漏、退出关闭会话、IPC 来源校验 |
| 日志框架 | 主进程/渲染进程统一日志、5 MB×3 轮转、`DBCRAFT_LOG_LEVEL`、`DBCRAFT_LOG_DIR`、项目根 `logs/`；日志约定已并入本文 §6 |
| 连接持久化 | 元数据库 `<userData>/dbcraft-meta.db`、connections 表、safeStorage 密码、启动载入、删除连接、E2E/smoke 数据目录隔离 |
| 需求审查 A1–A6 | 会话提示条/重连、列类型 tooltip、系统对象开关、分组展示、截断行数提示、TLS 回退警告 |
| 连接操作 | 右键菜单、编辑/复制/断开、搜索、多级分组与拖拽、最近使用、SQLite 只读降级 |
| 安全与 DDL | 生产危险语句拦截、查看/复制 DDL、`ddl:execute`、新建表向导、库级 DDL |
| 导出与历史 | CSV/JSON/SQL Insert 导出、查询历史基础版、查询超时 |
| 表数据页 | 双击表、50/200/500 分页、排序、连接导入/导出 |
| 错误与验证 | 中文错误建议、验收清单、9 组纯逻辑测试 |

### 7.2 2026-11-06：功能补齐与收尾

| 领域 | 关键内容 |
|---|---|
| 编辑器 | 语法高亮、行号、括号匹配、格式化、基础补全、SQL 文件打开/保存、草稿与崩溃恢复、关闭确认、选中执行、多语句脚本 |
| 查询历史 | FTS5 trigram、索引损坏自愈（重建后重试，仍失败回退 LIKE）、组合过滤、时间/耗时排序、详情、再次执行、JSON 导出、按连接清空、赋值型脱敏、写入队列、历史开关、保留条数 |
| UI DDL | 重命名/删除表、添加/删除/重命名列、MySQL 修改列、SQLite 重建表（含复合主键）、新建视图、索引管理、表结构（索引/外键/CHECK/注释）、表注释编辑、脚本逐条结果、DDL 执行写入历史 |
| 表数据编辑 | 单元格编辑、多行粘贴、增删行、单事务提交/回滚、乐观锁、撤销栈、无主键高风险仅新增、服务端过滤、参数化 DML |
| 结果与导出 | NULL/数字/日期样式、长文本悬停、列头本地排序、复制列名、复制单元格、单元格查看器、Excel 导出、加载全部 1 万行 |
| MSSQL 驱动 | `tedious` 单连接接入：测试连接/查询/对象树/表元数据/查看 DDL/表数据页/参数化 DML/乐观锁/取消/视图；SQL Server 2016 SP2 实测通过 |
| MSSQL Agent | 作业列表/详情/启停/启用/禁用/脚本生成/共享计划警告/`agent-control` 历史；SQL Server 2016 SP2 实测通过 |
| 设置与诊断 | settings 表、深浅主题、字号、结果上限、历史保留、查询超时、连接/测试超时、本地统计、诊断日志导出、元数据库备份/恢复、恢复默认、重置应用数据、快捷键说明 |
| 测试 | 纯逻辑测试扩到 21 组（新增 MSSQL 值/分页）；E2E 增加 DDL/历史/取消/精度/系统对象等断言 |
| 文档 | 多份状态文档（本次合并为本文） |

### 7.3 验证快照

| 时间 | 结果 |
|---|---|
| 2026-11-05 | `typecheck` 与 9 组纯逻辑测试通过；`build`/E2E 受沙箱阻塞 |
| 2026-11-06（40 轮收尾） | 旧文档记录为 17～21 组通过，统计口径不一致 |
| 2026-11-06（MSSQL + Agent 接入） | `typecheck` + **21 组纯逻辑测试全部通过**；`check:mssql` / `check:mssql-agent` 在 SQL Server 2016 SP2 上通过；`build`/`smoke`/`e2e:sqlite` 未执行 |

> 旧文档中的「21 组」包含统计口径差异；`package.json` 当前实际是 21 个 `test:*` 脚本（另有 1 个需真实 MSSQL 的 `check:mssql`）。

### 7.4 2026-11-06 后续调整

> 逐条明细见 `doc/WORKLOG.md`；UI 逐项状态见 `doc/UI_TODO.md`。

| 主题 | 关键内容 |
|---|---|
| MSSQL 命名实例 | SQL Browser UDP 1434 真机打通；`check:mssql` / `check:mssql-agent` 支持 `DBCRAFT_MSSQL_INSTANCE` |
| 密码存储审计 | 确认 safeStorage/DPAPI 加密、渲染层不可见、加密不可用时不落明文；记录与 PRD 回退方案的差异 |
| 剩余工作盘点 | 对照 PRD 标记 M1/M2/M3 的 P0 缺口与工程化缺口 |
| Agent UI 调整 | 弹窗 → 主区域页签 → **左侧树展开作业 + 详情页签**（按用户反馈覆盖 PRD 列表页签） |
| 文档制度 | 新增 `doc/WORKLOG.md`（追加式操作日志）与 `doc/UI_TODO.md`（UI 调整清单） |

---

## 8. 本次交付快照与提交检查

### 8.1 基线

- 分支：`main`。
- 基线提交：`e4e1a10 chore: write dev logs under project logs directory`。
- 当前状态：改动未提交，`git status --short` 包含源码、脚本、文档、新目录。
- 环境限制：沙箱可能阻止 `spawn`，`build` / `smoke` / `e2e:sqlite` 与真实 UI 需在沙箱外补跑。

### 8.2 本轮新增/变更的 IPC（均同步契约、zod、router、preload）

- 连接：`connection:list/save/delete/remove-all/open/import`
- 查询：`QueryRequest.params / maxRows / timeoutMs`
- MSSQL Agent：`agent:list/detail/action/script`
- 元数据：`schema:table`、`schema:describe`
- 表格编辑：`table:apply`
- DDL：`ddl:get/execute`（含 `sqliteForeignKeysOff`）
- 历史：`history:list/delete/clear/clear-connection`
- 设置：`settings:get/save`、`stats:get`
- 诊断：`diagnostics:export-logs/open-log-dir/backup-database/restore-database`
- 文件：`file:open-sql/save-sql`
- 导出：`export:save/save-xlsx`

### 8.3 提交前检查

```powershell
npm run typecheck
npm run test:safety
npm run test:groups
npm run test:ddl
npm run test:dml
npm run test:export
npm run test:history
npm run test:errors
npm run test:connection-export
npm run test:timeouts
npm run test:pagination
npm run test:settings
npm run test:sql-highlight
npm run test:sql-format
npm run test:sql-completion
npm run test:sql-brackets
npm run test:sql-mask
npm run test:sql-script
npm run test:xlsx
npm run test:sqlite-rebuild
npm run test:checks
npm run test:mssql
npm run check:mssql   # 需 .env.local 与可连的 SQL Server
npm run check:mssql-agent   # 需 SQL Server Agent 服务（会建删测试作业）

npm run build
npm run smoke
npm run e2e:sqlite
npm run dev   # 按 §4.4 手工验收
```

提交前还应：

- `git diff --stat` 复核改动范围；
- 确认没有把日志、`samples/demo.db`、临时 E2E 目录或密码写入版本库；
- 对本轮新增的 UI 至少完成一轮真机冒烟，再勾选「已验证」。

---

## 9. 附录：文档合并映射

| 原文档 | 合并后位置 | 说明 |
|---|---|---|
| `IMPLEMENTATION_STATUS.md` | §1、§2、§3、§4.1 | 模块覆盖率、缺陷、验证快照 |
| `PRD_AUDIT.md` | §1、§2、§3、§4.7 | 需求三分类、逐模块差距、测试缺口 |
| `DDL_PLAN.md` | §5 | MOD-04 范围、阶段、方案、决策、落点 |
| `VERIFICATION.md` | §4 | 自动检查、E2E、手工验收、风险、清理 |
| `LOGGING.md` | §6 | 日志级别、路径、格式、脱敏、待办 |
| `CHANGELOG.md` | §7 | 逐条流水合并为里程碑 |
| `SESSION_2026-11-06.md` | §8 | 基线、IPC 变更、测试、提交检查 |

后续维护约定：

- 新增功能或修复缺陷时，更新对应模块的「现状/缺口」与 §7 里程碑；
- 验收状态变化时更新 §4.3/§4.5；
- 不再拆回多份状态文档；PRD/TECH 仍独立维护。
