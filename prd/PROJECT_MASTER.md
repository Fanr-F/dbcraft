# DBCraft 项目主文档

| 项目 | 内容 |
|---|---|
| 文档定位 | 合并原 `prd/README.md`、`CONNECTION_TAB_MODEL.md`、`PROJECT_STATUS.md`、`UNFINISHED_ITEMS.md`、`UI_TODO.md`、`WORKLOG.md`，作为「模型 + 现状 + 缺口 + 验收 + 变更」的单一入口 |
| 需求基线 | `prd/PRD.md` v0.20（只读；需求变更需单独评审） |
| 功能总表 | `prd/FEATURE_MATRIX.md`（✅/🟡/❌/⏸ 状态快照） |
| 技术路线 | `prd/TECH_DESIGN.md`（进程、IPC、驱动、存储、安全） |
| 代码基线 | 2026-11-09 工作区（整理时 `git log -1` = `f635064`；功能表记 `6d7f77e` M1 功能提交 + 文档改动） |
| 最近更新 | 2026-11-09（W-20261109-28 文档合并） |
| 更新方式 | 状态/缺口/UI 验收直接改本文；变更流水追加到 §6；功能有无仍以 `FEATURE_MATRIX.md` 为准 |

> 本文不修改 `PRD.md`，也不替代 `TECH_DESIGN.md`。发生冲突时的优先级：
> 源码 / `package.json` / `scripts/` ＞ 本文 ＞ PRD / TECH_DESIGN 中的过时描述。
>
> **口径提醒**：`✅` / 「已实现」只表示代码主路径可用，不等于真实 Electron 手工验收；
> UI 是否点过以本文 §5 为准。不要把「代码走查」「E2E 通过」「真机点击」混写成同一结论。

---

## 目录

1. [文档定位与阅读顺序](#1-文档定位与阅读顺序)
2. [连接 / 服务器 / 标签 / 会话模型](#2-连接--服务器--标签--会话模型)
3. [项目现状、差距与验收](#3-项目现状差距与验收)
4. [未完成项与隐藏需求](#4-未完成项与隐藏需求)
5. [UI 调整清单与真机验收](#5-ui-调整清单与真机验收)
6. [变更记录](#6-变更记录)
7. [附录：旧文档合并映射](#7-附录旧文档合并映射)

---

## 1. 文档定位与阅读顺序

### 1.1 文档地图

| 文档 | 定位 | 更新方式 | 适合谁 |
|---|---|---|---|
| `PRD.md` | 需求基线（v0.20）：分层、v1.0 基线、模块细节、§9 v1.x、技术附录 | **只读**；需求变化需单独评审后改 PRD | 产品、研发、测试 |
| `FEATURE_MATRIX.md` | **功能总表**：按模块列出需要做的功能，标 `✅/🟡/❌/⏸` | 功能完成或新增需求时更新 | 所有人 |
| `TECH_DESIGN.md` | 技术设计：进程模型、IPC、驱动、存储、安全 | 架构变化时更新；可能滞后于代码 | 研发 |
| `PROJECT_MASTER.md`（本文） | 连接/标签/会话模型、实现现状、缺陷、测试与验收、未完成项、UI 验收、变更流水 | 每次改动/验收后更新 | 所有人 |

### 1.2 权威边界（冲突时看这里）

| 问题 | 以谁为准 | 说明 |
|---|---|---|
| 产品要不要做、优先级是什么 | `PRD.md` §0.2 / §9 | 需求取舍要单独评审；本文不替 PRD 做决定 |
| 这个功能现在有没有 | `FEATURE_MATRIX.md` + 代码 | 状态是代码快照；`✅` 不等于真机验收 |
| 还差什么、怎么修 | 本文 §4 | 含证据、影响、建议与验收点 |
| 做到什么程度、验收过没有 | 本文 §3.6 / §5 | 自动化、真机、人工验收分开看 |
| 连接/标签/会话怎么设计 | 本文 §2 + `PRD.md` §0.5 | v0.20 目标模型 |
| 技术怎么实现 | `TECH_DESIGN.md` + 源码 | 文档滞后时以源码/测试脚本为准 |
| 某次改了什么 | 本文 §6 | 追加式记录，不改历史 |

### 1.3 建议阅读顺序

- **新加入项目**：`PRD.md` §0 → §2 → §4；`FEATURE_MATRIX.md`；本文 §4（下一步）；本文 §3.1～§3.4；本文 §2（模型，避免改错）；`TECH_DESIGN.md` + 源码。
- **产品 / 排期**：`PRD.md` §0.2 / §9 → `FEATURE_MATRIX.md` 的 `❌/🟡` → 本文 §4.7 建议顺序 → 本文 §3.6。
- **开发 / 修 bug**：本文 §4 对应条目 → `FEATURE_MATRIX.md` 状态 → 源码证据 → 本文 §3.5 已知缺陷 → 本文 §5 验收。
- **测试 / 验收**：`FEATURE_MATRIX.md` 的 `🟡/❌` → 本文 §3.6 自动化与手工清单 → 本文 §5 勾选与真机记录。

### 1.4 维护规则

1. **PRD 只读**：需要改需求时先评审，再改 PRD；不要在整理/实现时顺手改写。
2. **功能状态只维护一处**：`FEATURE_MATRIX.md` 负责「有没有」；本文 §4 负责「怎么补」；本文 §3 负责「验收结论」。
3. **完成一项**：改 `FEATURE_MATRIX.md` 状态 → 更新本文 §3 对应缺口与 §5 UI 状态 → 在本文 §6 追加变更记录。
4. **`✅` 的口径**：代码主路径可用；是否真机点过看本文 §5，是否有自动化看本文 §3.6。
5. **变更记录只追加**：编号按 `W-YYYYMMDD-NN` 递增，不改历史条目。

---

## 2. 连接 / 服务器 / 标签 / 会话模型

> 对照 `PRD.md` v0.20 §0.5、当前工作区代码。状态图例：✅ 已有｜🟡 部分/隐式｜❌ 没有｜⏸ v1.x｜❓ 待拍板。

### 2.1 结论

1. **保存连接是配置（类），session 是运行时对象，tab 与 session 强绑定**：一个 SQL 标签 = 一个 session = 一条物理连接；关闭标签关闭 session；不做连接池。
2. **服务器实体已落地**：`servers` 表、`connections.server_id`、左侧按服务器分组（W-20261109-13/14）。服务器级 Agent、服务器删除/重命名/健康状态**明确不做**。
3. **独立 browse session 已实现**：双击/展开连接只打开左侧对象树（`browse-<connectionId>`），不创建/激活查询 tab；右击连接 →「查询」才创建 tab + session（W-20261109-15/16/17）。
4. **库上下文可见**：标签标题显示连接 + 当前库；执行按钮旁数据库下拉；状态栏显示当前库与活动会话数；切换即对该 tab 的 session 执行 `USE`（W-20261109-12）。
5. **编辑/删除保存连接与已有 tab session 解耦**：编辑只更新配置、不重连/不改写 tab、收起左侧树；删除保留 tab 的 session/SQL/结果并标记「连接已删除」，由用户自行关闭；关闭后不可重连（W-20261109-12/17）。
6. **重连恢复当前库**：SQLite 超时/断线重连后回到原库（W-20261109-12）。
7. **H-01～H-11 已全部修复**：新建连接不再改绑 tab、断开连接会关闭 browse session、标签自定义名随草稿持久化、单标签关闭有提示；剩余缺口见 §3 / §4。

### 2.2 当前模型（代码事实）

| 概念 | 当前实现 | 证据 |
|---|---|---|
| 保存连接 | `ConnectionRecord` + `ConnectionInput`：类型、名称、分组、环境、host/port/instance、database、用户名、SSL、字符集、`serverId` | `src/shared/ipc-contract.ts` |
| 服务器 | `servers` 表 + `connections.server_id`；左侧树按 server key 分组 | `src/main/storage/metadata.ts`、`src/renderer/src/components/Sidebar.tsx` |
| 数据库 | 会话级 `USE`；`schema:databases` 列表、`schema:use-database` | `ConnectionManager`、各 `*Session` |
| 会话 | 主进程 `sessions: Map<sessionId, DatabaseSession>`；`sessionId` 就是标签 id；browse 用 `browse-<connectionId>` | `src/main/services/ConnectionManager.ts` |
| 标签 | `QueryTab`：SQL、connectionId、table/tableDesign/agentJob、`customTitle`、`connectionSnapshot` | `src/renderer/src/types.ts` |
| 当前库 | 渲染层 `currentDatabaseByTab`（browse 单独一组）；对象树切库时写入 | `App.tsx` |
| 连接状态 | 按保存连接聚合所有标签的会话状态 | `App.tsx` 的 `connectionStates` |
| 对象树 | 双击连接打开独立 browse session；browse-only 对象操作会先创建/激活查询 tab | `Sidebar.tsx`、`App.tsx` |
| 断开连接 | 关闭该连接所有 tab session；标签和 SQL 保留；**browse session 当前未一起关闭（H-03）** | `disconnectConnection` |
| 删除连接 | 保留 tab session/SQL/结果，写 `connectionSnapshot`；标签标记「连接已删除」 | `deleteSavedConnection` |
| 编辑连接 | 只更新配置，不重连绑定标签；收起该连接左侧树 | `saveConnection` |
| 关闭最后标签 | 自动新建一个绑定同一连接的查询标签；单标签时「关闭」静默无反应（H-10） | `closeTab` |
| 草稿恢复 | 只恢复 SQL 标签的 id/title/customTitle/sql/connectionId/filePath/connectionSnapshot；不恢复 session、库、结果、表数据/Agent 标签 | `DRAFT_STORAGE_KEY` |

关系图（当前）：

```text
Server（servers 表）
└─ 保存连接配置（connections.server_id）
   ├─ SQL 标签 A ── sessionId=tabA ── 物理连接 ── 当前库 A
   ├─ SQL 标签 B ── sessionId=tabB ── 物理连接 ── 当前库 B
   ├─ 表数据标签 C ─ sessionId=tabC ── 物理连接 ── 表所属库 C
   └─ browse session（browse-<connectionId>）── 左侧对象树
```

### 2.3 术语

| 术语 | 定义 | 与当前实现的关系 |
|---|---|---|
| 服务器 Server | 一个数据库服务实例：类型 + host + port/instance；SQLite 是文件路径 | 已有 `servers` 表与左侧分组 |
| 连接配置 Connection Profile | 服务器 + 认证 + 默认库 + SSL/字符集/环境/名称/分组 | 当前「保存连接」 |
| 会话 Session | 一条活着的物理连接；有当前库、事务状态、只读、版本 | 一个 tab 一个 session；browse 也各自一条 |
| 标签 Tab | UI 文档：SQL/表数据/表设计/作业详情；绑定连接配置，拥有 session | `QueryTab` |
| 库上下文 Database Context | 会话当前 `USE` 的库；每个标签独立 | `currentDatabaseByTab`，标题/状态栏/下拉可见 |
| 工作区 Workspace | 一组连接配置 + 标签布局 + 默认库 | 没有；v1.x |

> UI 叫法：左侧「服务器 / 连接」，中间「标签」，状态栏「会话」。不要把「保存连接」和「已打开的会话」都叫「连接」。

### 2.4 隐藏需求清单

#### 2.4.1 服务器与连接配置

| 隐藏需求 | 现状 | 风险/说明 | 建议 |
|---|---|---|---|
| 独立服务器节点（host:port/instance） | ✅ `servers`/`server_id` + 服务器分组 | 同一服务器多个库/账号归到同一 server | 保留 |
| 一台服务器多个连接配置 | ✅ 按 `server_id` 分组 | 凭据仍各自保存 | 保留；凭据复用 v1.x |
| 服务器级 Agent 节点 | ⏸ 明确不做，Agent 保持在连接配置下 | 同一 MSSQL 服务器多配置会出现多套 Agent | 不做 |
| 服务器级数据库列表/健康状态 | ⏸ 不做服务器级 UI | 当前按连接/会话展示 | 不做 |
| 连接配置默认库 | ✅ `database` 字段 | 与标签当前库容易混淆 | 标签标题显示实际库 |
| 连接只读/环境/SSL/字符集 | 🟡 环境标签有；只读没有 | 多标签共享同一配置 | v1.0 显示环境徽标；只读 v1.x |
| 连接编辑时提示影响范围 | ✅ 已改为不重连已有 tab | 新 tab/重连才用新配置 | 保留 |
| 连接删除时保留 SQL | ✅ 保留 session/SQL/结果 + 快照 | 关闭后不可重连 | 保留 |
| 连接断开/关闭全部会话 | 🟡 断开单个连接并同时关闭 browse（H-03 已修） | 没有「全部断开」 | v1.0 可加「全部断开」 |
| 连接配置导入/导出 | ✅ 不含密码；命名实例可往返，重复导入跳过（H-04 已修） | — | 保留 |

#### 2.4.2 标签管理

| 隐藏需求 | 现状 | 风险/说明 | 建议 |
|---|---|---|---|
| 标签标题显示连接/库 | ✅ 连接 + 当前库 + 查询序号 | — | 保留 |
| 标签颜色/图标区分环境 | ❌ | 生产/测试标签容易混 | v1.0 可用环境色条 |
| 未保存/未提交/运行中标记 | ✅ 标签状态点 | 后台失败不被其他 ready 遮蔽 | 保留 |
| 标签右键菜单 | ✅ 关闭系列/复制/重命名/取消/重连 | — | 保留 |
| 标签拖拽排序 | ❌ | 标签多时难管理 | v1.x |
| 中键关闭、双击重命名 | ❌ | 常用交互缺失 | v1.x |
| 固定标签/防止误关 | ❌ | 重要查询容易被关 | v1.x |
| 重新打开已关闭标签 | ❌ | 误关后只能靠草稿 | v1.x |
| 标签过多滚动/收缩 | 🟡 横向排列 | 窄窗口溢出 | v1.0 基础滚动 |
| 后台查询可取消 | ✅ 标签右键「取消查询」 | — | 保留 |
| 标签类型统一管理 | 🟡 SQL/表数据/表设计/Agent | 关闭/复制/重命名行为不完全一致 | v1.0 统一标签模型 |
| 标签自定义名称持久化 | ✅ 随草稿保存/恢复（W-20261109-35） | — | 保留 |

#### 2.4.3 会话管理

| 隐藏需求 | 现状 | 风险/说明 | 建议 |
|---|---|---|---|
| 活动会话列表 | 🟡 状态栏显示数量；完整面板没有 | 不知道开了多少连接、连到哪 | v1.0 数量；完整面板 v1.x |
| 会话对应服务器/库/用户 | 🟡 状态栏显示库；无用户 | 无法定位 | v1.x 会话面板 |
| 会话数上限/提醒 | ❌ | 同一连接开很多标签会打满服务器连接数 | v1.x 限制/提醒 |
| 会话失败原因与重连 | ✅ 单标签提示条；重连恢复库 | — | 保留 |
| 重连/断开全部 | 🟡 标签内重连、连接级断开；无「一键全部」 | 只能逐个标签 | v1.0 可加连接级「重连全部」 |
| 事务状态显示 | ✅ 事务面板 + 状态栏 | 识别只按首关键字 | 后续细化解析 |
| 关闭标签时有未提交事务提示 | ✅ | — | 保留 |
| 后台标签失败提示 | ✅ 标签状态点 | — | 保留 |
| 会话只读/版本 | 🟡 状态栏 | 多标签时只显示当前 | v1.0 标签 tooltip |
| 会话持久化/恢复 | ❌ 只恢复 SQL 草稿 | 重启后要重新连 | v1.x |

#### 2.4.4 对象树 / 服务器浏览器

| 隐藏需求 | 现状 | 风险/说明 | 建议 |
|---|---|---|---|
| 左侧同时浏览多个服务器 | ❌ 只渲染当前 browse/活动连接 | 当前最大的信息架构限制 | v1.x 服务器浏览器 |
| 展开连接不等于打开标签 | ✅ 独立 browse session | 右击 →「查询」才创建 tab | 保留 |
| 服务器 → 数据库 → schema → 对象 | 🟡 服务器分组 + browse 多库树 | 完整多服务器同时浏览 v1.x | 保留 |
| 当前库标记/切换库 | ✅ 树内切换；标题/状态栏显示 | — | 保留 |
| 跨库搜索 | ❌ 只搜已加载库 | 大库难找 | v1.x |
| 系统对象开关 | ✅ SQLite/MSSQL；MySQL 系禁用 | — | 保留 |
| Agent 节点位置 | ✅ 当前连接对象树最后 | 保持连接级 | 不做服务器级 |
| 对象树展开状态持久化 | ❌ 全局状态 | 重启/切标签丢失 | v1.x |

#### 2.4.5 持久化与工作区

| 隐藏需求 | 现状 | 风险/说明 | 建议 |
|---|---|---|---|
| 恢复上次打开的标签/会话 | ❌ 只恢复 SQL 草稿 | 重启后上下文丢失 | v1.x |
| 恢复标签当前库 | ❌ 草稿不存 database | 多库体验差 | v1.0 可先存 `database` 字段 |
| 恢复表数据/表设计/Agent 标签 | ❌ | 只恢复 SQL 标签 | v1.x |
| 工作区/项目（连接+标签集合） | ❌ | 多项目切换靠分组 | v1.x |
| 多窗口/标签拖出 | ❌ 单窗口 | 无法并排看两个库 | v1.x |
| 标签布局/分屏 | ❌ | 只能上下看结果 | v1.x |

### 2.5 目标模型与关键规则

目标关系：

```text
Server（类型 + host/port/instance；SQLite = 文件路径）
├─ Connection Profiles（认证/默认库/SSL/环境/显示名）
│    ├─ Sessions（每条 SQL/表数据/DDL/Agent 标签默认一条）
│    │    └─ Database Context（当前 USE 的库）
│    └─ 左侧 browse session（只服务对象树）
├─ Databases
│    └─ Schemas → Tables / Views / Procedures / Triggers / Indexes
└─ SQL Server Agent（仅 MSSQL；按决策挂在连接配置下，不做服务器级）
```

关键规则：

1. **服务器是身份，连接配置是凭据与默认值**。同一服务器可有多个连接配置，服务器节点只出现一次。
2. **保存连接是类，session 是对象，tab 与 session 强绑定**：一个 tab 一个 session；关闭 tab 关闭 session；不改绑。
3. **库上下文属于 session**，但必须在标签标题和状态栏可见；执行按钮旁提供数据库下拉；新标签默认继承当前标签的库。
4. **入口分离**：双击保存连接 → 左侧对象树（browse session）；右击 →「查询」→ tab + session。完整服务器浏览器 v1.x。
5. **断开/重连分层**：编辑保存只关闭 browse session；显式「断开连接」应关闭 browse + 该配置的 tab session（需确认）；重连恢复每个标签的库上下文。
6. **删除连接配置不销毁 session**：已有 tab 保留运行、SQL/结果，标记「连接已删除」，由用户关闭；不重置为 `SELECT 1;`。
7. **编辑连接配置**：只更新配置；关闭左侧树；已有 tab 保留旧会话，新 tab/后续重连用新配置。
8. **事务状态可见**：状态栏/事务面板显示显式事务；网格未提交修改单独显示；关闭有事务的标签要提示。
9. **不做连接池**：继续「一个标签一个物理连接」；但显示会话数，连接数异常时提醒。
10. **不自动共享密码**：同一服务器的多个连接配置各自保存凭据；后续可做显式「复用服务器凭据」。
11. **执行旁数据库下拉**：多数据库服务器在「执行」按钮旁提供；切换只影响当前 tab 的 session。

### 2.6 v1.0 / v1.x / 不做

**v1.0 必做（Q21～Q27 决策后，主路径已落地）**：

- 服务器实体（Q21 A）：服务器 → 连接配置 → 会话；连接管理器按服务器分组。
- 标签标题（Q22 A）：连接名 + 当前库 + 查询序号；表数据/DDL/Agent 标签统一格式。
- 数据库下拉（Q22 A）：非 SQLite 标签切换即 `USE`；失败保持原库。
- 标签右键菜单（Q23 A）：关闭/关闭其他/关闭右侧/全部关闭/复制/重命名；运行中/失败可取消/重连。
- 标签状态标记：未保存、运行中、失败、事务中。
- 状态栏（Q24 B + Q25 B）：服务器/连接名、当前库、活动会话数、事务状态；连接级重连/断开。
- 事务面板（Q25 B）：开始/提交/回滚；关闭有事务标签提示；与网格未提交修改分开。
- 重连恢复当前库。
- 独立 browse session（Q27）：双击打开树；右击查询才建 tab。
- 编辑/删除连接解耦（Q27）。

**v1.x**：

- 服务器浏览器（Q26 B）：左侧同时展开多个服务器/数据库。
- 完整会话管理器、工作区/项目、标签持久化、多窗口/拖出标签、分屏。
- 连接池/会话复用（若未来推翻一标签一连接模型）。
- 标签固定/最近关闭/拖拽排序/中键关闭。
- 连接配置凭据复用、服务器级健康检查。

**不建议做**：

- v1.0 引入连接池或按保存连接复用 session（破坏隔离与 MSSQL 单请求模型）。
- 自动把同服务器连接合并成一个物理连接（用户可能用不同账号/环境）。
- 删除连接时静默清空标签内容。
- 有运行中查询/未提交修改时无提示重连。

### 2.7 验收标准（模型）

- AC：同一连接两个标签分别切到 `db_a`、`db_b`，切换标签时标题/状态栏/下拉分别显示对应库，执行使用对应库。
- AC：非 SQLite 标签在下拉选择另一个库，该标签 session 执行 `USE`；失败保持原库并提示。
- AC：SQLite 会话超时后重连，标签恢复到超时前的当前库，不落到连接默认库。
- AC：一个保存连接被两个 tab 使用，编辑保存后两个 tab 不被重连/关闭/改写，SQL 与结果保留；左侧树关闭，双击后重建 browse session。
- AC：编辑保存后新建 tab，新 tab 使用新配置创建新 session；旧 tab 保持原 session。
- AC：双击保存连接只打开左侧树，不创建查询 tab；右击 →「查询」才创建 tab + session。
- AC：对象树已展开时编辑连接保存导致树关闭，tab 的查询 session 不受影响（browse 与 tab session 分离）。
- AC：一个连接有 3 个打开的 tab，删除连接后 3 个 tab 的 session/SQL/结果保留并标记「连接已删除」；用户关闭后不可重连。
- AC：同一连接打开 5 个标签，状态栏/连接节点显示 5 个活动会话。
- AC：当前标签执行 `BEGIN`，事务面板/状态栏显示事务中，可提交/回滚；关闭标签提示未提交事务。
- AC：后台标签查询运行中，右键可看到运行状态并取消。
- AC：右键当前标签「关闭其他」，其他标签 session 关闭，当前标签保留。
- AC：同一服务器两个连接配置（不同默认库/账号）在连接管理器中归在同一服务器下，可分别测试/编辑。

### 2.8 问题与决策记录

| # | 问题 | 决策 |
|---|---|---|
| Q21 | v1.0 是否引入独立「服务器」实体 | **已定 A**：v1.0 做服务器实体与连接管理；完整服务器浏览器见 Q26 |
| Q22 | 标签标题是否必须显示连接/库 | **已定 A**，并增加每个标签的数据库下拉 |
| Q23 | v1.0 是否做标签右键菜单 | **已定 A**（关闭系列/复制/重命名） |
| Q24 | v1.0 是否做会话管理器 | **已定 B**：状态栏会话数 + 重连；完整面板 v1.x |
| Q25 | v1.0 是否做事务状态 | **已定 B**：完整 BEGIN/COMMIT 面板进 v1.0 |
| Q26 | 对象树是否允许同时浏览多个服务器 | **已定 B**：多服务器浏览器放 v1.x |
| Q27 | 连接删除/编辑语义 | **已定**：保存连接是配置（类），session 是运行时对象；编辑/删除不影响已创建 tab session；编辑保存关闭左侧树，双击重连；删除时已有 session 保留到用户关闭 |
| Q28 | 多窗口/工作区 | **已定 B**：v1.x |

**Q27 的「编辑连接」指什么**：指右键左侧连接列表里的**保存连接配置**（名称、分组、环境、host/port/instance、默认库、用户名/密码、SSL、字符集），不是编辑某个已打开 tab。类/对象关系：保存连接是配置（类），session 是运行时对象；一个 tab 与一个 session 强绑定。编辑保存只更新配置，不重连/不关闭/不改写已有 tab session；关闭该连接的左侧树；双击连接重新建立 browse session。已有 tab 保留旧 session；新建 tab 或后续重连使用新配置。删除连接：关闭左侧树；已有 tab session 保留运行、SQL/结果保留，标记「连接已删除」，由用户自行关闭；不强制关闭、不重置；关闭后不可重连。

> 为实现「关闭树但不影响 tab」，对象树使用独立 browse session，不能继续完全依赖当前 tab 的查询 session。

---

## 3. 项目现状、差距与验收

### 3.1 当前可运行链路

**新建连接 → 编辑器多语句执行 → 多结果页签/消息面板 → 表格编辑 / 导出 / 查询历史 / UI DDL / 设置。**

- 已接真实查询：SQLite、MySQL、Percona、MariaDB、MSSQL（SQL Server 2016 SP2 已实测）。
- 8 个 P0 模块中，MOD-01～MOD-07 已具备可用主路径，MOD-08（MSSQL Agent）已实现作业树/详情/启停/脚本主路径（左侧对象树 + 详情页签）。
- MSSQL 驱动已接入，M1 的「MSSQL 连接成功」门槛已满足；`build` / `e2e:sqlite` / `e2e:mysql` / `e2e:mssql` 已跑通，`smoke` 与真机 dogfood 仍待补跑。
- 编辑器内多语句已接通：`query:execute-script` 逐条执行，按 `;` / MSSQL `GO` / MySQL `DELIMITER` 分句，遇错停止；结果区支持多结果页签与消息面板。`query:execute` 仍保留给表数据页、DDL、Agent 等单语句内部路径。

### 3.2 模块完成度总览

状态图例：🟢 基本完成（≥90%）｜🟡 部分完成｜❌ 未实现。完成度为估算，按「PRD 主路径 + 入口 + 边界」综合判断。

| 模块 | 状态 | 估算 | 已有能力摘要 | 主要缺口 |
|---|---|---:|---|---|
| MOD-01 连接管理 | 🟡 | 91% | 五类连接表单、测试连接、元数据库持久化（safeStorage）、编辑/复制/删除/断开、多级分组、搜索、最近使用、系统对象开关、生产危险语句拦截、SQLite 只读降级、库级 DDL、连接导入/导出、字符集、证书错误解释、超时、MSSQL 连接、多数据库对象树（库/schema/表/视图/存储过程/表子对象）、服务器实体与分组、独立 browse session | **v1.0 P0**：SQLite 文件拖入、认证插件字段、全量错误码、真实 Percona 与 MySQL 多库回归；H-02/H-03/H-04/H-08/H-09 |
| MOD-02 SQL 编辑器 | 🟡 | 92% | 多标签、选区执行、取消、语法高亮、行号、括号匹配、格式化、关键字+函数+对象名补全、列/别名/限定名补全（W-20261109-19）、函数签名（W-20261109-20）、库/Schema/多段限定名/大小写跟随（W-20261109-21）、编辑器内多语句/多结果页签/消息面板与 `GO`/`DELIMITER` 分句（W-20261109-22）、草稿自动保存/恢复、关闭确认、SQL 文件打开/保存、多语句脚本窗口 | **v1.0 P0**：版本感知、补全类型提示、光标语句；**v1.x**：错误波浪线、最近文件、参数化执行、快捷键自定义 |
| MOD-03 查询历史 | 🟢 | 99% | history 表、成功/失败/取消记录、可关闭的 60s 去重、保留条数（含不限制）、FTS5 trigram 搜索（短查询回退 LIKE）、命中片段高亮、组合过滤（今天/自定义时间）、时间/耗时排序、详情、插入光标处、再次执行回到原连接/原库、复制/仅看此连接、连接已删除标记、JSON 导出、删除/清空、默认脱敏、写入队列与退出前 flush | 更完整的敏感内容识别、历史列表分页/加载更多 |
| MOD-04 UI DDL | 🟢 | 97% | 查看/复制 DDL、新建表/编辑表结构页签（列差异生成 ALTER、SQLite 整表重建、删除列输入表名确认）、MSSQL schema + IDENTITY、新建视图、加/删/重命名/修改列、重命名/删除表、删除视图、索引管理、表结构（列/索引/外键/CHECK/注释）、表注释编辑、多语句脚本逐条结果、库级 DDL | CHECK 约束编辑、列序调整、编辑页签内唯一约束/索引变更、SQLite 重建保留外键/触发器、MSSQL 默认值/computed/rowversion 编辑 |
| MOD-05 表数据编辑 | 🟡 | 86% | 数据页、50/200/500 分页、下拉/列头服务端排序、参数化 LIKE 过滤、单元格编辑、多行粘贴、增删行、单事务提交/回滚、乐观锁、本地撤销栈、主键/生成列保护、无主键高风险仅新增、只读提示 | 1000 分页档位、多列排序、类型化过滤/编辑器、列宽/隐藏/固定/记忆、NULL vs 默认值、`IDENTITY_INSERT`、BLOB 查看器、多行删除、冲突预检、TSV 区域复制、网格右键菜单 |
| MOD-06 结果与导出 | 🟡 | 95% | 结果网格、NULL 灰斜体、数字/日期右对齐、长文本悬停、列头本地排序、复制列名、复制单元格、单元格查看器、行数/耗时/截断提示、多结果页签/消息面板（W-20261109-22）、结果集「不限制」档位（W-20261109-24）、CSV/JSON/SQL/Excel 导出、导出前加载全部（最多 1 万行） | **v1.x**：真流式导出/进度/取消、多列排序、超过 1 万行、网格右键菜单；H-01 MSSQL 加载全部 guard |
| MOD-07 设置与偏好 | 🟡 | 86% | settings 表与面板、深浅主题、编辑器字号、结果行数上限（含不限制）、历史开关/保留条数、查询超时、数据目录展示、本地统计、诊断日志导出、元数据库备份/恢复、恢复默认、重置应用数据、快捷键说明 | 其他编辑器偏好、快捷键自定义、跟随系统主题、浅色主题个别强调色、逐版本 migration/升级备份、数据目录迁移 |
| MOD-08 MSSQL Agent | 🟡 | 80% | 对象树 `SQL Server Agent → 作业 → 作业项`、树内搜索/状态、详情页签（步骤/计划/最近 100/500 条历史）、启动/停止/启用/禁用、`sp_update_job*` 脚本生成、共享计划警告、多服务器只读、步骤命令在编辑器打开、`agent-control` 历史 | 30s 自动刷新、运行中/空闲状态、Agent XPs 禁用/权限失败真机回归、>1000 作业分页、右键菜单完整化 |

> PRD v0.17 的 v1.0 P0 中，完整补全、编辑器内多语句/多结果页签、`GO`/`DELIMITER`、结果集「不限制」档位已落地；版本感知、补全类型提示仍是缺口。

### 3.3 需要确认的决策

| # | 问题 | 现状 | 建议 |
|---|---|---|---|
| D-1 | 技术栈是否迁到 PRD 附录 A.2 的 Monaco + Ant Design + Zustand + TanStack Query + SheetJS | 当前是原生 textarea 高亮、手写 CSS、useState、零依赖 XLSX | 二选一：按 PRD 迁移，或正式修订 PRD 承认轻量方案；不要长期两套说法 |
| D-2 | M1 是否必须包含 MSSQL 连接 | 已接入 `tedious`，SQL Server 2016 SP2 实测连接/查询/对象树/DDL/表编辑/取消通过 | 后续补 MOD-08 Agent，并按真机 dogfood 收口 |
| D-3 | 切换连接时是否保留当前 SQL 标签 | 已按「标签 ↔ 会话一一对应」处理：选择另一个连接时激活该连接已有标签，没有则新建标签，绝不改绑当前标签 | 已解决，见 B-2 修复记录 |
| D-4 | 编辑器是否支持多语句/多结果 | 已实现：编辑器多语句走 `query:execute-script`，逐条执行、遇错停止，结果区支持多结果页签与消息面板；`query:execute` 保留单语句内部路径（W-20261109-22） | 保留；后续补真正的驱动级多结果与 warning/PRINT 消息 |
| D-5 | 结果集默认上限与「不限制」 | 已实现：默认 2000，档位 100/500/1000/2000/5000/不限制；`maxRows=0` 在驱动层转 `Infinity`，设置面板提示内存风险（W-20261109-24） | 保留；大结果集卡顿风险由用户确认提示承担，后续可补流式/分页 |
| D-6 | SQL 补全范围 | PRD v0.17：完整补全为 v1.0；已实现列/别名/限定名/函数/库/Schema/多段限定名/大小写跟随/自动触发（W-20261109-19/21） | 继续补版本感知、类型提示、SQLite ATTACH 库内对象、MySQL 跨库列 |
| D-7 | MSSQL Agent 入口 | PRD v0.17 已改为左侧树 + 详情页签；当前实现一致 | 已解决，保留树形态 |
| D-8 | 网格事务是否独立连接 | PRD §4.5.3 仍写独立连接/事务，当前实现使用同一会话 | 待 Q16 决策；建议 v1.0 保持同一会话并改写 PRD |
| D-9 | 连接/服务器/标签模型 | 服务器实体/分组、独立 browse session、browse 搜索、删除连接快照持久化已实现；服务器级 Agent 明确不做 | **Q21 A / Q26 B 主路径已实现**；保持连接级 Agent |
| D-10 | 标签管理与会话可见性 | 已实现标签标题（连接/库）、执行旁数据库下拉、标签右键菜单、状态点、状态栏当前库/会话数（W-20261109-12）；事务面板主路径（W-20261109-13） | **Q22 A / Q23 A / Q24 B / Q25 B 已完成主路径**；事务识别边界与人工验收待补 |
| D-11 | 连接删除/编辑语义 | 已改为编辑保存不重连标签、只收起左侧树；删除连接保留 tab session/SQL/结果，使用 `connectionSnapshot` 继续展示 | **Q27 主路径已实现**；H-02/H-03 等边界仍待补 |

### 3.4 各模块现状与差距

#### 3.4.1 MOD-01 连接管理

已实现：

- SQLite / MySQL / Percona / MariaDB / MSSQL 连接表单；SQLite 文件选择；测试连接。
- MSSQL 走 `tedious` 单连接：测试连接、会话、查询、对象树、表元数据/结构、查看 DDL、表数据页、表编辑与取消；已在 SQL Server 2016 SP2（Developer Edition）上跑通。
- MSSQL 命名实例：支持 `主机\实例名`、`主机:端口` 与独立实例名输入；实例名走 SQL Browser（UDP 1434）解析，与端口互斥；错误提示引导启动 SQL Server Browser 或改用端口；已在默认实例 `MSSQLSERVER` 上验证。
- 元数据库 `<userData>/dbcraft-meta.db` 持久化连接；密码经 `safeStorage` 加密为 BLOB，只在主进程解密，不回传渲染层。
- 连接编辑、复制、删除、断开、右键菜单；编辑保存不重连已有标签，只收起该连接左侧树；删除保留 tab session/SQL/结果与快照。
- 多级分组（`A/B/C`）、折叠、重命名/删除分组、拖拽换组；连接与对象合并为一棵树：分组下直接列保存连接，连接节点可打开/关闭对象树，当前连接的对象树内联显示；连接右侧状态点区分已连接/连接中/连接失败/未连接；搜索合并；最近使用排序。
- 服务器实体：`servers` 表 + `server_id`，左侧按服务器分组（服务器头可折叠）。
- 独立 browse session：双击/展开连接只打开树；右击「查询」才创建 tab；browse-only 对象操作会先 `ensureConnectionTab`。
- 系统对象开关（SQLite、MSSQL；其他方言禁用并提示）；MSSQL 可浏览 `master` / `msdb` 中 `is_ms_shipped = 1` 的表/视图。
- 生产连接危险语句拦截（`DROP` / `TRUNCATE` / 无顶层 `WHERE` 的 `UPDATE`、`DELETE`）。
- SQLite 锁/权限错误回退只读，UI 横幅提示并禁用建表。
- 库级 DDL 汇总；连接配置 JSON 导入/导出（永不含密码）。
- 字符集配置；自签名/过期/主机名不匹配/证书链不完整四类中文提示。
- 会话打开/关闭、对象树、失败原因与重连入口；TLS 回退明文警告条；未就绪时只显示“未连接/正在连接”提示。
- 多数据库对象树（MSSQL / MySQL 系）：列出有权限的数据库、切换当前库、库下表/视图/存储过程、表下约束/触发器/索引（懒加载）；SQLite 单库树。

主要缺口：

| 缺口 | 说明 |
|---|---|
| SQLite 文件拖入 | 无 drag/drop 处理 |
| 认证插件 | 表单无插件字段，认证行为由驱动默认值决定 |
| 错误码覆盖 | 常见码已有中文建议，未覆盖全部驱动码 |
| Percona 真机 | 与 MySQL 共用代码路径，但无真实 Percona 实例回归 |
| 多库真机 | MSSQL 多库已真机验证；MySQL / MariaDB 多库查询未在真实实例回归（便携实例下载失败） |
| MSSQL 保真边界 | `datetimeoffset` 原始偏移被驱动归一化为 UTC；`decimal` 超过 15 位有效数字会丢精度；`datetime2` 只到毫秒 |
| MSSQL UI DDL | 已支持 schema + IDENTITY 的建表/改表、加/删/改列、重命名与索引；默认值/computed/rowversion 仍只读 |
| MSSQL schema 树 | 表/视图/存储过程已按 schema 分组；跨 schema 移动对象仍需 SQL 编辑器 |
| MSSQL 命名实例 | 默认实例经 SQL Browser 已验证；命名实例（非 `MSSQLSERVER`）与动态端口尚未真机回归 |

#### 3.4.2 MOD-02 SQL 编辑器

已实现：

- 多标签、每标签独立会话、Ctrl+Enter 执行（有选区只执行选区）、取消、行数/耗时统计。
- 语法高亮（高亮层 + 透明 textarea，IME 组合期间隐藏高亮层）、行号、括号匹配（跳过字符串/注释）。
- 格式化（关键字大写、子句换行、缩进、字符串/注释原样保留），Ctrl+Shift+F。
- 补全：关键字 + 当前连接表/视图名，Ctrl+Space，前缀优先、键盘选择、回车/Tab 插入、Esc 关闭；列/别名/`别名.`/`表名.`/函数/函数签名/库/Schema/多段限定名（W-20261109-19/20/21）、大小写跟随、`.` 与关键字后空格自动触发。
- 30 秒草稿自动保存与启动恢复（最多 20 个标签）、关闭未保存标签确认。
- SQL 文件打开/保存（Ctrl+S；首次保存弹对话框）。
- 编辑器内多语句：`;` / MSSQL `GO` / MySQL `DELIMITER` 分句，逐条执行、遇错停止；每条查询一个结果页签，非查询/错误进入消息面板（W-20261109-22）。
- 多语句脚本窗口：按顶层分号切分（字符串/注释内分号不误切），单次最多 50 条，逐条结果。

主要缺口：

| 缺口 | 说明 |
|---|---|
| 补全剩余（PRD v1.0 P0） | 版本感知、补全类型提示、通配符展开、SQLite ATTACH 库内对象、MySQL 跨库列、解析失败降级 |
| 光标所在语句（PRD v1.0 P0） | 只支持选区执行，未按光标定位语句 |
| 驱动级多结果 | 仍是逐条 IPC，不是驱动级多结果集；MSSQL `PRINT`/`RAISERROR`、MySQL warning 未进消息面板 |
| `GO` 重复次数 | `GO 5` 未实现；`GO` 只按独立行识别 |
| 错误波浪线（v1.x） | 未实现 |
| SQL 文件能力（v1.x） | 缺新建/另存为/最近文件/拖入 |
| 参数化执行（v1.x） | 无 |
| 快捷键自定义（v1.x） | 设置面板只展示说明 |
| 超长 SQL | 执行前检查 >1 MB 并提示拆分/另存，不再无提示提交 |

#### 3.4.3 MOD-03 查询历史

已实现：

- 元数据库 `history` 表，自动记录 SQL、方言、连接快照、库名、状态、耗时、影响/返回行数、来源；成功、失败、取消都记录。
- 同连接同 SQL 60 秒内合并并累计 `exec_count`，可在设置中关闭；保留条数可配置（1000/5000/10000/50000/不限制，默认 10000）。
- FTS5 trigram 搜索：≥3 字符走 `MATCH`，短查询或 FTS 不可用时回退 `LIKE`；启动时重建索引；索引损坏先重建并重试一次。
- 搜索命中显示为命中附近片段并高亮；输入防抖 200ms。
- 组合过滤：方言、状态、来源、连接（含已删除连接）、库名包含、今天/最近 1/7/30 天/自定义起止；排序：时间/耗时升降序。
- 入口：工具栏、`Ctrl/Cmd+E`、编辑器右键“从历史插入”。
- 行操作：插入光标处、再次执行、复制 SQL、仅看此连接、详情、删除；再次执行回到原连接/原库，原连接已删除时只插入编辑器并提示。
- 详情面板、插入并执行、清空全部、按连接清空、导出当前筛选 JSON。
- 赋值型敏感字段脱敏显示（`password/token/secret/... = '...'` → `'***'`），默认值由设置控制，只影响列表/详情/导出。
- 内存写入队列 + 定时落库；退出或备份/恢复前 flush。

主要缺口：

- 敏感内容识别仅覆盖赋值型，不处理 INSERT 值等复杂形式。
- 历史列表固定最多 200 条（`HistoryDialog.tsx:175`），尚未做分页/加载更多。
- `.sql` / `.csv` 导出未做。

#### 3.4.4 MOD-04 UI DDL

详细方案见 §3.7。当前能力覆盖查看/复制 DDL、新建表/视图、加/删/重命名/修改列、SQLite 重建表（含复合主键）、重命名/删除表、删除视图、索引管理、表结构与注释、CHECK 展示、多语句脚本与逐条结果、库级 DDL。

- 新建表与编辑表结构为独立页签（`table-design`），使用自己的会话；保存时由 `shared/dialect/table-diff.ts` 生成：新建走 `CREATE TABLE`；编辑按差异生成 `RENAME TABLE` / `ADD/DROP/RENAME/MODIFY COLUMN`。
- SQLite 修改列类型/可空/默认值时走整表重建；重建保留主键、自增与显式索引，外键/CHECK/触发器/表注释不保留并在预览中警告。
- 删除列必须在预览页输入原表名确认；主键/自增列不能删除或在编辑页签改属性。
- 非 SQLite 连接在「执行 DDL」前可选择目标数据库；SQLite 只有 main，不显示下拉；编辑表结构时数据库固定为表所在库。
- MSSQL 支持 schema 与 IDENTITY：`CREATE TABLE [schema].[table]`、`IDENTITY(1,1)`、`ALTER COLUMN`、`sp_rename`、索引与 DROP；表设计页签提供 schema 输入和 Identity 勾选。
- MSSQL 对象树在「表 / 视图 / 存储过程」下按 schema 分组；新建表从 schema 分支进入时继承该 schema。
- MSSQL 的加列/删列/改列统一转到编辑表结构页签，避免旧弹窗静默忽略默认值等属性。
- 真机 `check:mssql` 已回放 schema + IDENTITY 建表、ADD/RENAME/MODIFY/DROP 全链路。

剩余：CHECK 约束编辑（PRD 未强要求）、列序调整、编辑页签内唯一约束/索引变更、SQLite 重建时外键/触发器/视图的保留策略、MSSQL 默认值/computed/rowversion 列编辑、可编辑预览、重建维护锁/进度/取消、`WITHOUT ROWID`/STRICT/生成列安全重建。

#### 3.4.5 MOD-05 表数据编辑

已实现：

- 双击表/视图打开 `表 · <name>` 标签，生成 `SELECT * ... LIMIT/OFFSET`；每页 50/200/500。
- 下拉排序 + 列头点击排序（服务端 `ORDER BY`，回到第 1 页）。
- 服务端过滤：`WHERE <col> LIKE ? ESCAPE '!'`，`%`/`_`/`!` 按字面量转义，值走参数。
- 单元格编辑、多行粘贴、新增行、删除选中行；主键与生成列只读。
- 提交时单事务执行全部 UPDATE/INSERT/DELETE，任一行失败整体回滚。
- 乐观锁：UPDATE 带被修改列原值；UPDATE/DELETE 命中 0 行判定冲突并整体回滚。
- 本地撤销栈（最多 30 步）；提交/回滚/重新查询/切连接/关标签后清空。
- 无主键表、视图、只读会话禁用编辑并显示原因；无主键表可显式开启「允许新增行（高风险）」，主进程仍校验 insert-only。
- 有待提交修改时锁定分页、排序、切连接、关闭标签。
- 表数据页记录所属库，翻页/查询/元数据/DML 前自动切回该库（W-20261106-10）。

剩余：1000 分页档位（`Workspace.tsx:704` 目前只有 50/200/500）、多列排序、类型化过滤（文本/数字/日期/布尔、操作符、多条件 AND）、列宽拖拽/隐藏/固定前 N 列/按表记忆、类型化单元格编辑器、主键修改二次确认、`IDENTITY_INSERT`、NULL vs 留空默认值、BLOB/大文本查看器与 hex、多行选择+批量删除、必填列高亮、自动提交模式/提交前确认、冲突预检/跳过冲突行、退出应用三选一、MSSQL `rowversion`、SQLite `rowid`、TSV 区域复制、网格右键菜单。

#### 3.4.6 MOD-06 结果与导出

已实现：

- 结果网格；NULL 灰色斜体；数字/日期右对齐；长文本悬停；列头显示类型 tooltip。
- 普通查询结果列头本地排序；表数据页列头触发服务端排序。
- 复制列名（制表符分隔）、复制选中单元格（NULL 复制为空）；单元格查看器（完整值、类型、行号、字符数、复制）。
- 行数/耗时/截断提示；超过上限显示「仅显示前 N 行」。
- CSV（UTF-8 BOM、CRLF、转义、NULL 空字段）、JSON、SQL Insert（三方言语义）、Excel `.xlsx`。
- 导出前「加载全部（最多 10000 行）」：重新执行只读语句后导出；超过 1 万行仍截断提示。
- 多结果页签 + 消息面板（W-20261109-22）；结果集「不限制」档位（W-20261109-24）。

剩余：H-01 MSSQL「加载全部并导出」仍被旧 guard 挡住；真流式导出与进度/取消（v1.x）；多列排序；超过 1 万行；选中区域/全部结果集导出；CSV 分隔符/表头选项；NULL `\N` 标记；导出敏感数据提示；`PRINT`/`RAISERROR`/warning 消息；网格右键菜单；执行计划（v1.x）。

#### 3.4.7 MOD-07 设置与偏好

已实现：

- 元数据库 `settings` 表；设置面板；非法值回退默认。
- 深/浅主题；编辑器字号 12/13/14/16 px；结果行数上限 100/500/1000/2000/5000/不限制（不限制提示内存风险）。
- 查询历史开关与保留条数；查询超时 0/10/30/60/120 秒（0 为不自动取消）。
- 连接/测试超时 3/5/8/10/30 秒（默认 8 秒，环境变量 `DBCRAFT_CONNECT_TIMEOUT_MS` 优先）。
- 本地数据目录、本地统计（连接数/历史条数/设置项数/元数据库大小）。
- 诊断日志导出（最多 10 MB）、打开日志目录。
- 元数据库备份/恢复（恢复前校验 `connections` 表并留自动备份）；恢复默认；重置应用数据（输入 `RESET`）。
- 快捷键说明（Ctrl+Enter、Ctrl+Space、Ctrl+Shift+F、Ctrl+S、Esc）。

剩余：更多编辑器偏好、快捷键自定义、跟随系统主题、浅色主题个别强调色、逐版本 migration/升级备份（R-04）、数据目录迁移、网格自动提交/提交确认、i18n（v1.x）。

#### 3.4.8 MOD-08 MSSQL Agent

已实现（左侧对象树展开 + 作业详情页签）：

- 对象树：MSSQL 连接下 `SQL Server Agent → 作业` 可逐级展开，作业直接列在树中（启用状态点、禁用/MSX 标记、上次结果 tooltip），受对象搜索框过滤；单击选中，双击打开详情页签，同一作业重复打开聚焦已有详情页签。Agent 节点固定在该连接对象树最后；空作业列表不再显示“没有作业”。不再单独打开作业列表页签（与 PRD 4.8.2 的列表页签不同）。
- 作业详情页签：基本信息、步骤（序号/名称/子系统/成功失败动作/命令摘要，T-SQL 步骤可在编辑器打开命令/复制）、计划（频率描述/下次运行/共享标记）、运行历史（最近 100/500 条，失败消息红色）。
- 生命周期：启动/停止/启用/禁用，操作期间按钮置灰；停止/禁用二次确认；禁用作业启动被拒绝；失败原样展示 SQL Server 原生错误；操作成功后详情页与左侧作业树刷新。
- 脚本化编辑：生成 `USE msdb` + `GO` + `sp_update_job` / `sp_update_jobstep` / `sp_update_schedule`，在编辑器打开；共享计划警告；步骤/计划用生成时 id 快照。
- 生命周期操作写入查询历史，`source = agent-control`。
- 已验证：SQL Server 2016 SP2 上创建临时作业，跑通列表/搜索/详情/脚本/启用/启动/停止/禁用/历史落库。

剩余：30s 自动刷新与「运行中/空闲」状态（P1）、多服务器作业与 Agent XPs 禁用/权限不足的真机回归、共享计划真机验证、作业数 >1000 的服务端分页、右键菜单完整化。

#### 3.4.9 跨模块与非功能

| 项 | 状态 | 说明 |
|---|---|---|
| 深浅主题 | ✅ | 设置持久化，RevoGrid 同步 |
| 危险操作二次确认 | ✅ | 删除列/表/视图输入对象名；生产语句弹确认 |
| 错误文案中文映射 | 🟡 | 常见认证/库表/锁/语法/约束/网络/TLS 已覆盖，非全量 |
| 快捷键全集 | 🟡 | 缺 `Shift+Alt+F`、`Ctrl+E`、`F2`、`Delete` 等，且不可自定义 |
| 单实例 / CSP / IPC 校验 | ✅ | `contextIsolation`、`sandbox`、来源与参数校验 |
| 连接/服务器/标签模型 | 🟡 | 服务器实体/分组、独立 browse session、browse 搜索、删除连接快照持久化已实现；服务器级 Agent 明确不做 |
| 标签/会话可见性 | 🟡 | 标签标题、数据库下拉、右键菜单、状态点、状态栏、事务面板已实现；标签持久化仍缺 |
| 编辑器事务状态 | 🟡 | 已实现 BEGIN/START TRANSACTION/COMMIT/ROLLBACK 识别、事务面板、关闭提示与状态栏；识别只按首关键字，不是完整解析 |
| 结果值保真 | 🟡 | SQLite/MySQL 系按原值；MSSQL 的 `datetimeoffset`/高精度 `decimal`/`datetime2` 受驱动限制 |
| IPC 流式分块/背压 | ❌ | 主进程内部流式读取，IPC 仍是单次 invoke |
| 版本化 migration / 升级备份 | 🟡 | 有 `user_version` 与在线备份/恢复，无逐版本迁移备份策略 |
| 自动化测试 | 🟡 | 21 组纯逻辑测试 + SQLite E2E + MSSQL/Agent 真实实例联调脚本；无 Vitest、无 React 组件测试、无 CI |
| 性能基线 / 无障碍 | ❌ | 无启动/首屏/内存度量，无 WCAG/键盘路径验收 |
| 打包 / 签名 / 安装包 | ❌ | `pack` / `dist` 未验证 |

### 3.5 缺陷、风险与已修复项

#### 3.5.1 未关闭缺陷

| # | 级别 | 位置 | 说明 |
|---|---|---|---|
| B-3 | P2 | `src/main/services/query-values.ts` | 二进制只保留前 32 字节 hex；`Date` 走 `toISOString()` 属应用层时区转换（当前 MySQL 系配置 `dateStrings`，通常走不到） |
| B-4 | P2 | `ResultGrid` / 结果区 | 列过滤固定 `filter: 'string'`；无网格右键菜单（单格复制已由结果工具栏的「复制单元格」提供） |
| B-5 | P2 | 连接设置 | 认证插件字段缺失；连接/测试超时已进设置面板，环境变量仍可覆盖 |
| B-6 | P2 | 导出 | 非真流式；最多加载 1 万行；无进度与取消 |
| B-8 | P2 | 文档 | README / PRD / TECH 存在滞后描述；README 文档索引与功能概览已更新，PRD/TECH 仍需按决策回写 |

> 不要把以上缺陷描述成「已验收通过」；UI 路径仍缺真机验收，见 §5。

#### 3.5.2 已修复的关键缺陷（防回归基线）

| 缺陷 | 修复要点 |
|---|---|
| 切换连接改绑当前标签 | 选择连接时只激活该连接已有标签或新建标签；当前标签的 `connectionId`、SQL 与结果不再被改写，保证标签与会话一一对应 |
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

#### 3.5.3 风险说明

- **所有 UI 改动尚未在真实 Electron 中完整跑过**（多轮受环境限制）。最高风险：连接持久化/密码解密、右键菜单、各类弹窗、表格编辑/粘贴/撤销、高亮层对齐、补全弹层、SQLite 重建表、浅色主题、备份/恢复/重置。
- MySQL / Percona / MariaDB 的流式读取、TLS 回退、`KILL QUERY` 只在代码层完成，未在真实实例完整回归（`check:mysql` / `check:mariadb` / `e2e:mysql` 已在便携实例通过主路径）。
- 纯逻辑测试不覆盖 React 组件、真实驱动错误与 IPC 端到端攻击面。
- `build` / `smoke` / `e2e:sqlite` 依赖本机 Electron 与构建工具，受限沙箱下会因 `spawn EPERM` 失败。
- MSSQL 只在 SQL Server 2016 SP2 上验证过主路径；未验证 TLS 严格校验、多 schema 同名对象、命名实例（非默认）与动态端口、Agent 权限不足/Agent XPs 禁用路径。

### 3.6 测试与验收

#### 3.6.1 自动化检查（21 组纯逻辑测试）

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

最近一次整理时：`typecheck` 通过；21 组纯逻辑测试全部通过；`check:mssql` 在 SQL Server 2016 SP2 上通过；`build` / `smoke` / `e2e:sqlite` 当时未执行。

| 命令 | 覆盖 |
|---|---|
| `test:safety` | 生产连接危险语句识别（注释、字符串、子查询、大小写、方言环境） |
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
| `test:sql-completion` | 补全前缀/排序去重/插入位置、别名与多段限定符、MSSQL/MySQL 表引用、SQLite ATTACH 别名、大小写跟随、空格触发、函数签名 |
| `test:sql-brackets` | 圆/方/花括号、嵌套、字符串/注释、未配对 |
| `test:sql-mask` | 历史 SQL 赋值型脱敏边界 |
| `test:sql-script` | 多语句分句（字符串/注释分号、50 条上限、MSSQL `GO`、MySQL `DELIMITER`） |
| `test:xlsx` | ZIP/OOXML 结构、单元格类型、XML 转义 |
| `test:sqlite-rebuild` | 重建表语句生成 + 真实 SQLite 回放（数据/索引/类型/复合主键） |
| `test:checks` | 从 CREATE TABLE 提取 CHECK（嵌套括号/字符串/注释） |
| `test:mssql` | MSSQL 值格式化（datetime/date/time/decimal/binary）、限定名/命名实例解析、分页过滤 `@p1`、Agent 时间/频率/脚本生成 |

真实实例联调脚本（不是纯逻辑测试）：

- `npm run check:mssql` / `check:mssql-agent`：读取 `.env.local`，在真实 SQL Server 上建删临时表/作业，覆盖连接、查询、对象树、表元数据/结构、DDL、表数据页、参数化 DML/乐观锁、取消，以及 Agent 列表/详情/脚本/启停/启用/禁用与运行历史。
- `npm run check:mysql` / `check:mariadb`：默认连接 `127.0.0.1:3307` / `3308`（便携实例由 `spikes/mysql-auth/scripts/setup.ps1` 启动，root 空密码；可用环境变量覆盖），建删临时库，覆盖连接、库列表、当前库/跨库对象、列元数据、分页/过滤、取消与会话存活、错误后会话可用。
- `npm run check:mssql-multidb`：多库列表、跨库对象、`USE` 切换与恢复、约束/触发器/索引。

#### 3.6.2 必须在沙箱外补跑

```powershell
npm run build        # 先 typecheck，再 electron-vite build
npm run smoke        # 构建后启动 Electron，检查窗口与 preload 桥接
npm run e2e:sqlite   # 自动构建、建临时库、完整 SQLite E2E
npm run e2e:mysql    # 需 127.0.0.1:3307 便携 MySQL
npm run e2e:mssql    # 需 .env.local 与可连的 SQL Server
```

说明：

- E2E 都使用 `--user-data-dir=<临时目录>`，不污染真实 `%APPDATA%`；
- 预期看到 `[e2e:sqlite] passed` / `[e2e:mysql] passed` / `[e2e:mssql] passed`；
- 失败时优先看第一条断言对应的功能；测试脚本 `scripts/e2e-*.mjs` 带中文注释；
- `e2e:mysql` 会建删临时库；`e2e:mssql` 会建删 `dbo.dbcraft_e2e_mssql`。

#### 3.6.3 E2E 覆盖场景

**SQLite（`npm run e2e:sqlite`）**：

1. 新建 SQLite 连接 + 测试连接（校验版本号）；保存后自动打开会话，状态栏显示版本。
2. 对象树出现表与视图；系统对象默认隐藏，勾选后出现 `sqlite_sequence`，取消后隐藏。
3. 点表填入 `SELECT * FROM "demo_users"`；执行后网格出现数据、状态栏行数正确。
4. 超过 2000 行显示「仅显示前 2000 行」。
5. UPDATE 返回「1 行受影响」；错误表名同时显示 `no such table` 与 `SQLITE_ERROR`；多语句生成多结果页签，遇错停止并进入消息面板。
6. 生产连接无 WHERE 的 DELETE 弹确认，取消后数据仍在。
7. 取消查询 → 会话失败；提示条含原因，点「重连」后同标签继续查询。
8. BIGINT `9007199254740993` 不丢精度；两个标签互不阻塞。
9. 查看 DDL、新建表、生成库级 DDL、查询历史插入、超时、表数据页翻页/排序、重命名/删除表、添加/删除列、创建/删除索引。
10. 应用退出时先关闭会话，Playwright `app.close()` 可正常完成。

**MySQL（`npm run e2e:mysql`）**：

1. 预建临时库和 `items` 表；通过连接表单新建 MySQL 连接（主机/端口/用户/密码/库/SSL），测试连接并保存。
2. 状态栏显示 MySQL 版本，对象树出现当前库与 `items`。
3. 查询 `items` 返回 2 行；多语句 `SELECT 1; SELECT 2;` 生成两个结果页签，消息面板包含两条 SQL。
4. 退出后自动删除临时库。

**MSSQL（`npm run e2e:mssql`）**：

1. 读取 `.env.local`，预建 `dbo.dbcraft_e2e_mssql`；通过连接表单新建 MSSQL 连接（加密 + 信任证书），测试并保存。
2. 状态栏显示 T-SQL / SQL Server 版本，对象树出现测试表。
3. 查询返回 2 行；`SELECT 1 AS a` + `GO` + `SELECT 2 AS b` 生成两个结果页签，`GO` 不进入消息面板。
4. 退出后自动删除测试表。

#### 3.6.4 手工验收（`npm run dev`）

> UI 逐项勾选见 §5；这里是跨模块的后端/持久化验收清单。

**连接与持久化**：

1. 新建 SQLite 连接指向 `samples/demo.db`，保存后自动打开，对象树出现表/视图。
2. 新建 MySQL 连接（可用 `spikes/mysql-auth/scripts/setup.ps1` 启动 3307），保存后重开应用，连接仍在。
3. 字符集：MySQL 系连接填写 `utf8mb4` 后保存并重开，配置仍保留；留空时使用驱动默认。
4. 右键连接 → 编辑，改名并保存；标题/列表更新；已有标签**不重连**，左侧树收起；双击后重新连接树。
5. 右键连接 → 复制、断开、删除；删除保留 tab session/SQL/结果并标记「连接已删除」；断开后树应收起（H-03 修好后）。
6. 导出单个/全部连接为 JSON，检查文件里没有密码字段值；再导入，提示密码需重新输入。
7. 分组：新建连接时填 `项目A/测试环境`，出现嵌套分组；右键重命名/删除；拖拽连接换组。
8. 连接搜索、对象树搜索均可用，大小写不敏感。
9. 设置 `DBCRAFT_CONNECT_TIMEOUT_MS=1000` 后连接不可达主机，应在约 1 秒内失败。
10. 最近使用排序生效；SQLite 文件被锁/无权限时进入只读并显示横幅。

**查询、编辑器与历史**：

1. `SELECT * FROM demo_users LIMIT 5;` 结果网格正常；列头悬停显示类型；NULL 灰色斜体，数字列右对齐，长文本悬停可见完整内容。
2. 高亮：关键字、字符串、注释、数字分色；行号随滚动同步且不遮挡点击；括号配对高亮；中文输入法组合期间文字可见；长 SQL 滚动时光标不漂移。
3. 点「格式化」或 Ctrl+Shift+F：关键字大写、子句换行；字符串里的 `select` 不被改写。
4. 执行错误 SQL，错误区同时显示原始错误、SQLSTATE/错误码与「建议」。
5. 查询历史：搜索命中、插入编辑器、删除单条、清空全部、详情显示完整 SQL/耗时/连接/错误。
6. 历史过滤：类型/状态/来源/连接筛选；排序切换；「插入并执行」；「导出 JSON」；「清空当前连接」。
7. 历史搜索：≥3 字符走 FTS（子串命中），2 字符仍能通过 LIKE 命中；库名与「最近 1/7/30 天」收窄结果。
8. 脱敏：执行 `UPDATE ... SET password = 'x'` 后勾选「脱敏显示」，列表/详情/导出显示 `'***'`；插入编辑器仍是原始 SQL。
9. 设置里的「快捷键」列出当前可用组合；底部「本地统计」与侧边栏连接数、历史条数一致。
10. 关闭「记录查询历史」后执行查询，历史不再新增；重新开启后恢复。
11. 选中一段 SQL 后 Ctrl+Enter 只执行选区；未选中时执行全文（当前为全文，非光标语句）。
12. 草稿：修改 SQL 后等待 30 秒（或正常退出），重开恢复标签与 SQL；30 秒内关标签应提示最近修改尚未写入草稿。
13. SQL 文件：打开 `.sql` 生成新标签；Ctrl+S 覆盖；无路径时弹保存对话框。
14. 长查询超过 30 秒提示「查询超时」；SQLite 会话失败，点「重连」恢复；`DBCRAFT_QUERY_TIMEOUT_MS=0` 重启后不再自动取消。

**结果与导出**：

1. `SELECT * FROM demo_users LIMIT 5;` → 导出 CSV/JSON/SQL Insert/Excel；Excel 打开 CSV 检查中文不乱码、NULL 为空字段；打开 `.xlsx` 检查列名、数字/布尔/NULL 与中文。
2. 「加载全部（最多 10000 行）」后行数增加；对 `UPDATE` 执行应提示仅支持查询语句；MSSQL 应能加载（修 H-01 后）。
3. 普通查询结果列头可本地排序；「复制列名」粘贴后为制表符分隔。
4. 「查看单元格」显示完整值、类型、行号与字符数，可复制；「复制单元格」写入剪贴板（NULL 为空）。
5. 超过结果上限时显示「仅显示前 N 行」。

**连接安全**：

1. 连接环境选「生产」→ 执行 `DELETE FROM demo_orders;`，弹确认并展示 SQL；取消后数据仍在。
2. 生产连接执行 `UPDATE demo_users SET status='x';`（无 WHERE）同样弹确认。
3. 非生产连接不弹确认。
4. MySQL `sslMode=prefer` 且 TLS 不可用时，连接后顶部显示「TLS 不可用，已回退为明文连接」。
5. 自签名/过期证书的 `verify-ca` 实例，错误区给出对应中文证书建议。

**SQLite 只读（较难构造）**：用另一进程长期持有写锁，或移除文件写权限后打开，预期连接成功但顶部显示「当前为只读模式…」；「新建表」禁用；写入返回只读错误并给中文建议。

**UI DDL**：

1. 表右键 → 查看 DDL：新标签出现 `CREATE TABLE ...`；复制 DDL 可用。
2. 新建表：填写表名与列 → 预览 → 执行 → 对象树出现新表。
3. 添加列/删除列/创建索引/删除索引：均需预览；删除列需要输入列名两次。
4. 重命名表、删除表、删除视图：删除类需要输入对象名确认。
5. 表结构：列类型/可空/默认值/主键正确；索引、外键、CHECK、表注释可见；MySQL 系可编辑注释；SQLite 不显示该按钮。
6. 重命名列：选列 + 新列名 → 预览 `RENAME COLUMN` → 执行后查询新列。
7. 新建视图：名称与 SELECT → 预览 → 执行；对象树出现视图，双击可查数据。
8. 修改列（MySQL 系）：类型/非空/默认值自动回填，改类型 → 预览 `MODIFY COLUMN` → 执行；SQLite 生成多语句重建预览，执行后数据/索引保留、列类型更新；复合主键表也能重建，外键悬空时整体回滚。
9. 连接右键 → 生成库级 DDL：新标签包含该库所有表/视图的建表 SQL。
10. 执行后对象树刷新。
11. 多语句脚本：粘贴两条 `ALTER TABLE ...` 或 `CREATE INDEX` → 显示「识别到 N 条」→ 逐条结果与对象树刷新；字符串中的 `';'` 仍只识别为对应语句。
12. 表结构弹窗能看到 CHECK 表达式；SQLite 表注释为空。

**表数据页**：

1. 双击表 → 新标签 `表 · xxx`，默认 200 行。
2. 上一页/下一页、每页 50/200/500、排序下拉与列头点击排序均生效。
3. 补全：输入 `demo_us` 后 Ctrl+Space 出现 `demo_users`；上下键选择、回车插入；Esc 关闭。
4. 双击非主键单元格改值 → 出现「待提交 N 项」，分页/排序/切连接被禁用；点「回滚」恢复原值。
5. 改值后「提交修改」→ 提示已提交并刷新；重新查询确认落库。
6. 「新增行」，填写几列后提交；INSERT 只包含填写过的列，自增主键由数据库生成。
7. 删除选中行，提交后消失；主键列不可编辑。
8. 第二个会话改同一行后再提交第一个会话的修改，提示冲突并保持待提交状态。
9. 「撤销」：最近一步回退；连续撤销回到初始值；提交后撤销不可用。
10. 无主键表 / 视图 / 只读 SQLite 文件：显示只读原因，编辑按钮不可用。
11. 过滤：选择列、输入包含内容并回车；SQL 使用 `LIKE ?`，结果只含匹配行；清除后恢复全量。
12. 多行粘贴：从表格复制区域贴到另一块（含主键列）→ 只读列不变，其余进入待提交；撤销一次整体回退。
13. 无主键表：默认只读；开启「允许新增行（高风险）」后只有新增行可编辑，已有行只读、删除被拒绝；提交只执行 INSERT；关闭开关前必须先提交或回滚。

**设置、备份与恢复**：

1. 结果上限设为 100，保存后 `SELECT * FROM demo_users` 最多 100 行并显示截断提示。
2. 重开应用设置仍为 100；改回 2000 后新查询恢复。
3. 手工改元数据库为非法值，启动回退默认 2000，不阻塞启动。
4. 「导出诊断日志」得到包含启动日志的 `.log` 文件；「打开日志目录」打开对应目录。
5. 「备份元数据库」选择路径，得到 `.db`；用 SQLite 客户端能打开并看到 connections/history/settings。
6. 恢复：先备份，修改连接后恢复；确认后重新加载，连接/历史/设置回到备份时状态，并在 userData 留下 `dbcraft-meta.backup-<时间>.db`。选非 DBCraft 的 SQLite 文件应提示缺少 `connections` 表且不改动当前数据。
7. 重置：设置中「重置应用数据」，不输入 RESET 取消；输入 RESET 后连接清空、历史清空、设置回默认，界面自动重新加载。
8. 字号 12/14/16 px 立即生效，重开保留；「恢复默认」+保存后回到 13 px。
9. 执行 DDL 后打开查询历史，能看到 `source=ddl-preview` 的记录；「插入到编辑器」可还原；失败 DDL 同样记录并显示错误摘要。
10. 关闭并重开应用，查询历史仍存在。
11. 查询超时改为 10 秒后长查询约 10 秒提示超时；改为「不自动取消」后不再中断。
12. 历史保留改为 1000 后执行若干查询，历史表最多保留 1000 条。
13. 设置「连接/测试超时」为 3 秒后测试不可达主机，应在约 3 秒内返回超时错误；设置 `DBCRAFT_CONNECT_TIMEOUT_MS=1000` 重启后环境变量优先。

#### 3.6.5 已知未验证 / 风险点

- 多轮 UI 改动未在真实 Electron 中完整运行；最高风险见 §3.5.3。
- MySQL / Percona / MariaDB 流式查询、TLS 回退、`KILL QUERY` 仅在便携实例主路径验证。
- MSSQL 只在 SQL Server 2016 SP2 上验证主路径；TLS 严格校验、多 schema、命名实例（非默认）与动态端口、Agent 权限不足/Agent XPs 禁用路径未验证。
- MSSQL Agent 的 UI（对象树入口、详情页签、按钮置灰、脚本打开新标签）尚未人工点击；后端查询/脚本/生命周期已用 Node 对真实实例验证。
- 合并树只内联当前 browse/活动连接的对象；其他连接即使状态点为“已连接”也不会展开。
- 对象搜索只覆盖当前库；跨库搜索仍需先切换数据库。
- 打包（`npm run pack` / `dist`）与安装包未验证。
- 自动化测试只覆盖纯逻辑与 SQLite E2E，不覆盖 React 组件和真实驱动。

#### 3.6.6 测试数据与清理

- 演示库：`npm run demo:db` → `samples/demo.db`（已 gitignore）。
- 开发日志：项目根 `logs/dbcraft.log`（已 gitignore）；可用 `DBCRAFT_LOG_DIR` 覆盖。
- 元数据库：`<userData>/dbcraft-meta.db`；E2E/冒烟使用临时 `--user-data-dir`，结束后删除。
- E2E 临时目录：`%TEMP%\dbcraft-e2e-*`，脚本 finally 中清理。

### 3.7 MOD-04 UI DDL 现状与后续方案

#### 3.7.1 范围与边界

- 方言：SQLite + MySQL / Percona / MariaDB 的建表/改表；MSSQL 已支持 schema + IDENTITY 的建表/改表主路径（`CREATE TABLE [schema].[table]`、`IDENTITY(1,1)`、加/删/改列、`sp_rename`、索引），默认值/computed/rowversion 等列属性仍只读；复杂 schema 变更新用 SQL 编辑器。
- 对象：表、视图、索引；视图只支持查看/删除，不做可视编辑。
- 所有 UI 生成的 DDL 必须先预览，用户确认后才执行；执行后刷新对象树。
- DDL 是否写入查询历史：PRD 要求 `source=ddl-preview`，已实现；一次执行合并为一条记录，失败保留错误摘要。

#### 3.7.2 已完成阶段

| 阶段 | 状态 | 内容 |
|---|---|---|
| Phase 1 只读入口 | ✅ | `ddl:get`；SQLite 读 `sqlite_master`，MySQL 系用 `SHOW CREATE TABLE/VIEW`，MSSQL 读 `sys.sql_modules` / `sys.columns` 生成；对象树右键查看/复制 DDL |
| Phase 2 预览与执行 | ✅ | `ddl:execute`；SQLite 事务包裹，失败 `ROLLBACK`；单次 ≤50 条、单条 ≤100 KB；逐条结果 |
| Phase 3 新建表 | ✅ | 表名 + 列（类型/主键/自增/非空/唯一/默认值）；`buildCreateTable`；预览可执行；执行后刷新（MSSQL 支持 schema + IDENTITY） |
| Phase 4 改表 | ✅ | 重命名/删除表、删除视图、添加/删除/重命名列、MySQL 系修改列、SQLite 重建表、新建视图（MSSQL 支持 schema + IDENTITY） |
| Phase 5 索引与结构 | ✅ | 创建/删除索引；表结构查看（列/索引/外键/CHECK/注释）；表注释编辑；多语句脚本逐条结果；库级 DDL |

#### 3.7.3 SQLite 重建表（已实现）

`buildSqliteRebuild` 生成：

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
- 列序调整未实现；`WITHOUT ROWID`/STRICT/生成列无法安全重建时应阻止；
- 重建期间取消会终止 Worker，需提示「取消会断开标签会话」。

#### 3.7.4 剩余工作与待决策

| 编号 | 事项 | 建议 |
|---|---|---|
| D1 | 预览弹窗用 Monaco 还是 textarea | 继续 textarea（离线、零依赖）；引入 Monaco 后再统一 |
| D2 | 是否引入 Ant Design | 不引入，保持手写 CSS；若 D-1 决定迁移再统一评估 |
| D3 | DDL 写入查询历史 | 已实现：所有 `ddl:execute` 走 `source: 'ddl-preview'`，一次执行合并为一条 |
| D4 | 多语句上限 | 维持单次 ≤50 条、单条 ≤100 KB |
| D5 | 重建表外键/触发器 | 继续用 `PRAGMA foreign_keys=OFF` + `foreign_key_check`；触发器保留另行设计 |
| D6 | 视图编辑 | 本期不支持，仅查看/删除 |
| D7 | 列序调整 | 需要重建表并重排列定义，后续单独实现 |

#### 3.7.5 IPC 与文件落点

- 契约：`src/shared/ipc-contract.ts` 中 `DdlColumn`、`DdlIndex`、`TableDefinition`、`DdlStatementResult`；通道 `ddl:get`、`ddl:execute`、`schema:describe`、`schema:table`。
- 生成逻辑：`src/shared/dialect/`（`ddl.ts`、`sqlite-rebuild.ts`、`checks.ts`、`dml.ts`、`identifiers.ts`），纯函数、可单测、渲染层可用。
- 执行：只在主进程 `ConnectionManager` / 各 `DatabaseSession`；`query:execute` 保持单语句语义，编辑器多语句走 `query:execute-script`。
- UI：`TableDesigner`、`TableStructureDialog`、`AlterColumnDialog`、`IndexDialog`、`SqlScriptDialog` 等。
- 取消：沿用 `requestId`；SQLite 重建期间取消会终止 Worker，需明确提示。

#### 3.7.6 DDL 验收要点

- 所有生成 SQL 先预览；删除类必须输入对象名确认；
- SQLite 重建后数据、显式索引、类型、复合主键保留；外键冲突整体回滚；
- MySQL 系修改列生成单条 `ALTER`；SQLite 修改列生成多语句预览；
- MSSQL 的 UI 建表/改表已支持 schema + IDENTITY 主路径；默认值/computed/rowversion 等列属性仍只读，复杂变更用 SQL 编辑器。

### 3.8 日志约定

| 项目 | 内容 |
|---|---|
| 适用范围 | Electron 主进程、preload、渲染进程 |
| 实现位置 | 主进程 `src/main/logging/logger.ts`；渲染进程 `src/renderer/src/logging.ts` |
| 默认级别 | 开发/未打包 `debug`；打包后 `info` |
| 覆盖方式 | `DBCRAFT_LOG_LEVEL=error\|warn\|info\|debug` |
| 落盘位置 | 开发：`<工作目录>/logs/dbcraft.log`；打包：`<userData>/logs/dbcraft.log` |
| 覆盖目录 | `DBCRAFT_LOG_DIR`（相对路径按当前工作目录解析） |
| 轮转 | 单文件 5 MB，保留 3 个历史文件（`.1` / `.2`） |

> PRD §5.3：**日志不得记录 SQL 文本、密码或连接串**。查询日志只记录 `sqlLength`；错误日志只记录 `code` / `sqlState` / `errno` / `retryable`，不记录驱动 `message` 原文。

#### 3.8.1 级别

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

#### 3.8.2 输出格式与用法

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

#### 3.8.3 脱敏与禁止记录

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

#### 3.8.4 与 PRD 的关系与待办

- PRD §5.3「日志不记录 SQL 文本」：已按上述约定执行。
- PRD §5.2「诊断日志导出」（P1）：已实现设置面板导出与打开目录。
- 崩溃统计/远程上报：未实现，也不计划默认开启；日志只留在本地。
- 待办：日志查看器、按天归档、日志量增大后改有界异步队列。

### 3.9 变更里程碑

> 逐条明细见 §6。

#### 3.9.1 2026-11-05：基础加固与第一轮功能

| 主题 | 关键内容 |
|---|---|
| 查询链路加固 | SQLite BIGINT 精度、取消竞态、Worker 失效、方言标识符、schema 错误、MySQL 流式读取、错误模型（sqlState/errno/retryable）、MSSQL 会话泄漏、退出关闭会话、IPC 来源校验 |
| 日志框架 | 主进程/渲染进程统一日志、5 MB×3 轮转、`DBCRAFT_LOG_LEVEL`、`DBCRAFT_LOG_DIR`、项目根 `logs/` |
| 连接持久化 | 元数据库 `<userData>/dbcraft-meta.db`、connections 表、safeStorage 密码、启动载入、删除连接、E2E/smoke 数据目录隔离 |
| 需求审查 A1–A6 | 会话提示条/重连、列类型 tooltip、系统对象开关、分组展示、截断行数提示、TLS 回退警告 |
| 连接操作 | 右键菜单、编辑/复制/断开、搜索、多级分组与拖拽、最近使用、SQLite 只读降级 |
| 安全与 DDL | 生产危险语句拦截、查看/复制 DDL、`ddl:execute`、新建表向导、库级 DDL |
| 导出与历史 | CSV/JSON/SQL Insert 导出、查询历史基础版、查询超时 |
| 表数据页 | 双击表、50/200/500 分页、排序、连接导入/导出 |
| 错误与验证 | 中文错误建议、验收清单、9 组纯逻辑测试 |

#### 3.9.2 2026-11-06：功能补齐与收尾

| 领域 | 关键内容 |
|---|---|
| 编辑器 | 语法高亮、行号、括号匹配、格式化、基础补全、SQL 文件打开/保存、草稿与崩溃恢复、关闭确认、选中执行、多语句脚本 |
| 查询历史 | FTS5 trigram、索引损坏自愈、组合过滤、时间/耗时排序、详情、再次执行、JSON 导出、按连接清空、赋值型脱敏、写入队列、历史开关、保留条数 |
| UI DDL | 重命名/删除表、添加/删除/重命名列、MySQL 修改列、SQLite 重建表（含复合主键）、新建视图、索引管理、表结构（索引/外键/CHECK/注释）、表注释编辑、脚本逐条结果、DDL 执行写入历史 |
| 表数据编辑 | 单元格编辑、多行粘贴、增删行、单事务提交/回滚、乐观锁、撤销栈、无主键高风险仅新增、服务端过滤、参数化 DML |
| 结果与导出 | NULL/数字/日期样式、长文本悬停、列头本地排序、复制列名、复制单元格、单元格查看器、Excel 导出、加载全部 1 万行 |
| MSSQL 驱动 | `tedious` 单连接接入：测试连接/查询/对象树/表元数据/查看 DDL/表数据页/参数化 DML/乐观锁/取消/视图；SQL Server 2016 SP2 实测通过 |
| MSSQL Agent | 作业列表/详情/启停/启用/禁用/脚本生成/共享计划警告/`agent-control` 历史；SQL Server 2016 SP2 实测通过 |
| 设置与诊断 | settings 表、深浅主题、字号、结果上限、历史保留、查询超时、连接/测试超时、本地统计、诊断日志导出、元数据库备份/恢复、恢复默认、重置应用数据、快捷键说明 |
| 测试 | 纯逻辑测试扩到 21 组（新增 MSSQL 值/分页）；E2E 增加 DDL/历史/取消/精度/系统对象等断言 |

#### 3.9.3 验证快照

| 时间 | 结果 |
|---|---|
| 2026-11-05 | `typecheck` 与 9 组纯逻辑测试通过；`build`/E2E 受沙箱阻塞 |
| 2026-11-06（40 轮收尾） | 旧文档记录为 17～21 组通过，统计口径不一致 |
| 2026-11-06（MSSQL + Agent 接入） | `typecheck` + **21 组纯逻辑测试全部通过**；`check:mssql` / `check:mssql-agent` 在 SQL Server 2016 SP2 上通过；`build`/`smoke`/`e2e:sqlite` 未执行 |
| 2026-11-09（文档合并前） | `typecheck` + 21 组纯逻辑测试通过；`build` / `e2e:sqlite` / `e2e:mysql` / `e2e:mssql` 多轮通过；`smoke` 仍需沙箱外补跑 |

> `package.json` 当前实际是 21 个 `test:*` 脚本（另有需真实实例的 `check:*`）。

#### 3.9.4 2026-11-06 后续调整

| 主题 | 关键内容 |
|---|---|
| MSSQL 命名实例 | SQL Browser UDP 1434 真机打通；`check:mssql` / `check:mssql-agent` 支持 `DBCRAFT_MSSQL_INSTANCE` |
| 密码存储审计 | 确认 safeStorage/DPAPI 加密、渲染层不可见、加密不可用时不落明文；记录与 PRD 回退方案的差异 |
| 剩余工作盘点 | 对照 PRD 标记 M1/M2/M3 的 P0 缺口与工程化缺口 |
| Agent UI 调整 | 弹窗 → 主区域页签 → **左侧树展开作业 + 详情页签**（按用户反馈覆盖 PRD 列表页签） |
| 文档制度 | 新增追加式操作日志与 UI 调整清单（现已并入本文） |

### 3.10 交付快照与提交检查

#### 3.10.1 基线

- 分支：`main`。
- 早期状态文档基线：`e4e1a10 chore: write dev logs under project logs directory`；功能表基线：`6d7f77e feat: complete M1 connection, editor and MSSQL work`。当前 HEAD：`f635064 docs: remove obsolete requirements audit`。
- 当前状态：文档合并后需重新提交；`git status --short` 会显示删除的 6 份旧文档与新增本文。
- 环境限制：沙箱可能阻止 `spawn`，`build` / `smoke` / `e2e:sqlite` 与真实 UI 需在沙箱外补跑。

#### 3.10.2 已稳定的 IPC（均同步契约、zod、router、preload）

- 连接：`connection:list/save/delete/remove-all/open/import`
- 查询：`QueryRequest.params / maxRows / timeoutMs`、`query:execute-script`
- MSSQL Agent：`agent:list/detail/action/script`
- 元数据：`schema:table`、`schema:describe`、`schema:databases`、`schema:use-database`、`schema:table-extras`
- 表格编辑：`table:apply`
- DDL：`ddl:get/execute`（含 `sqliteForeignKeysOff`）
- 历史：`history:list/delete/clear/clear-connection`
- 设置：`settings:get/save`、`stats:get`
- 诊断：`diagnostics:export-logs/open-log-dir/backup-database/restore-database`
- 文件：`file:open-sql/save-sql`
- 导出：`export:save/save-xlsx`

#### 3.10.3 提交前检查

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
npm run check:mysql   # 需 127.0.0.1:3307 便携实例（会建删临时库）
npm run check:mariadb   # 需 127.0.0.1:3308 便携实例（会建删临时库）

npm run build
npm run smoke
npm run e2e:sqlite
npm run e2e:mysql
npm run e2e:mssql
npm run dev   # 按 §3.6.4 与 §5 手工验收
```

提交前还应：

- `git diff --stat` 复核改动范围；
- 确认没有把日志、`samples/demo.db`、临时 E2E 目录或密码写入版本库；
- 对本轮新增的 UI 至少完成一轮真机冒烟，再勾选「已验证」。

---

## 4. 未完成项与隐藏需求

> 功能有无与总体状态看 `FEATURE_MATRIX.md`；本节只维护「还差什么、怎么补」。

图例：

- 优先级：**P1** 主路径/数据一致性受影响｜**P2** 韧性、边角与体验
- 状态：**❌ 未开始**｜**🟡 半成品**｜**⏸ 明确延后**｜**❓ 待拍板**
- 分组：**H** 代码走查新发现｜**K** 文档已列但代码仍未完成｜**R** 架构已就绪但缺入口/韧性｜**C** 文档与代码不一致

### 4.1 总览

| 分组 | 数量 | 说明 |
|---|---|---|
| H 代码走查新发现 | 11 | 多数是「界面上有入口，实际走不通或会误伤」的问题 |
| K 文档已列但未完成 | 10 | 本文 §3 已有记录，这里只汇总入口 |
| R 架构/韧性 | 9 | 类型、存储、生命周期已具备，但缺健康检查、恢复或收尾 |
| C 文档/代码不一致 | 4 | 需要回写文档或补代码 |

**H 组已全部修复**（W-20261109-30～40）；下一步优先处理 K-09、K-02、H 组之外的 K/R 项。

### 4.2 H：代码走查新发现

> 证据行号以当前工作区为准，函数名同时给出，防止后续行号漂移。

#### H-01 MSSQL「加载全部并导出」仍被旧 guard 挡住（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-37）
- **原问题**：`loadAllForExport()` 对 MSSQL 直接返回「MSSQL 驱动尚未接入」，但其他查询/导出路径已接入。
- **修复**：删除 MSSQL 特判，统一走 `query.execute({ maxRows: 10000 })` 和现有截断提示。
- **验收**：MSSQL 查询 200 行 → 导出 → 加载全部 → 200 行可导出；超过 1 万行显示截断提示。

#### H-02 新建连接会改绑当前标签并清空 SQL/结果/会话（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-32）
- **原问题**：`saveConnection()` 新建分支会把活动 tab 改绑到新连接、重置 SQL、清空结果并重开 session。
- **修复**：新建连接只保存配置并提示「双击连接打开对象树，右击查询创建标签」，不再改动当前标签；编辑连接仍只更新配置、关闭左侧树。
- **验收**：有未保存 SQL 时新建连接，原 tab 的 SQL/结果/session 不变；新连接出现在左侧树。

#### H-03「断开连接」没有关闭独立 browse session（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-34）
- **原问题**：`disconnectConnection()` 只遍历 tab，browse session 仍 ready，左侧树继续可展开/刷新。
- **修复**：断开时同时关闭 `browse-<connectionId>`、清 `browseConnectionId` 与按 session 的缓存；提示区分「已断开连接与对象树」。
- **验收**：展开树 → 右击「断开连接」→ 树收起、状态点变未连接；再展开时重新建会话。

#### H-04 连接导入导出往返丢 MSSQL 命名实例，且重复导入无去重（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-33）
- **原问题**：`connection-export.ts` 的 mssql 分支没有读取 `instanceName`；导入逐条保存，没有按服务器/名称去重。
- **修复**：导入保留合法 `instanceName`（非法值丢弃）；新增 `connectionProfileKey`（服务器 key + 名称），导入时跳过同服务器同名配置并返回 `duplicates`；导入提示「跳过 N 个重复」并继续提示密码需重新输入。
- **验收**：命名实例导出再导入仍走实例；连续导入两次不产生重复；结果返回 imported/skipped/duplicates。

#### H-05 关闭标签不会取消正在执行的查询（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-38）
- **原问题**：`closeTab()` 没有取消逻辑，`closeTabSession()` 直接 `session.close()`；MySQL 的 `connection.end()` 会等当前语句跑完。
- **修复**：关闭单个标签前先 `await cancelQueryForTab(id, true)`，再关闭 session；批量关闭也逐个取消；取消失败不阻塞关闭。
- **验收**：MySQL `SLEEP(60)` 执行中关闭标签，查询很快结束，历史状态为 `cancelled`；其他标签不受影响。

#### H-06 表数据翻页/排序/过滤/导出重查都会写进历史，且来源固定为 editor（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-40）
- **原问题**：表数据翻页/排序/过滤和导出重查都固定 `source: 'editor'`，历史被表浏览淹没且来源过滤失真。
- **修复**：`QuerySource` 增加 `table-page` / `export`；`runQuery` 对带 `tab.table` 的内部查询自动标为 `table-page`，导出重查标为 `export`；历史弹窗与详情增加对应中文标签。
- **验收**：表数据翻页/排序/过滤记录来源为「表数据」；导出重查为「导出」；编辑器执行仍为「编辑器」。

#### H-07 标签自定义名称不持久化（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-35）
- **原问题**：`persistDraftTabs()` 没有保存 `customTitle`，重命名只改内存，重启恢复自动标题。
- **修复**：`DraftPayload` 增加 `customTitle`，保存/恢复均做 80 字符限制；`renameTab` 同步截断。
- **验收**：重命名 → 关闭应用 → 重启，标题保持；清空自定义名后恢复自动标题。

#### H-08 SQLite「测试连接」与实际只读回退口径不一致（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-31）
- **原问题**：`testSqliteFile()` 用读写方式打开，失败直接报错；Worker 打开时会回退只读，导致测试失败但会话可用。
- **修复**：测试连接复用同样的锁/权限判断，失败时以 `readonly: true` 重开并返回 `readonly` 标记与「只读模式」提示。
- **验收**：只读/被占用文件测试连接成功并提示只读；不可读文件仍失败。

#### H-09 已保存密码无法清除；编辑连接时测试必须先重输密码（已修复）

- **优先级/状态**：P1 / ✅（W-20261109-30）
- **原问题**：`saveConnection()` 空密码保留旧 secret；连接对话框没有保存/清除密码控件；编辑连接测试要求重新输入密码。
- **修复**：连接对话框增加「保存到本地」开关，取消勾选并保存会清除已存密码；`connection:test` 允许携带连接 id，主进程在密码为空时使用已存密码测试，密码仍不回传渲染层；`connection:save` 增加 `rememberPassword` 选项。
- **验收**：编辑连接可取消勾选并保存来清除密码；测试连接无需重输；密码仍只在主进程解密。

#### H-10 只剩一个普通 SQL 标签时，「关闭」静默无反应（已修复）

- **优先级/状态**：P2 / ✅（W-20261109-36）
- **原问题**：`closeTab()` 在只剩一个非 kind 标签时直接返回；标签右键「关闭」没有置灰。
- **修复**：右键「关闭」在只剩一个 SQL 标签时置灰；`closeTab` 被直接调用时给出「至少保留一个 SQL 标签」提示。
- **验收**：单标签时右键「关闭」置灰或有明确提示；不会静默失败。

#### H-11 死文件与临时探针脚本留在仓库（已清理）

- **优先级/状态**：P2 / ✅（W-20261109-39）
- **原问题**：`AgentJobsDialog.tsx` 是 3 行兼容空壳；仓库曾有未跟踪的 `tmp-probe-*` 脚本。
- **修复**：确认无引用后删除 `AgentJobsDialog.tsx`；当前工作区未发现 `scripts/tmp-probe-*.mjs`。
- **验收**：`npm run typecheck` / `npm run build` 通过；仓库不再有无引用 shim 与临时探针。

### 4.3 K：文档已列但代码仍未完成

| ID | 缺口 | 来源 | 优先级 | 状态 |
|---|---|---|---|---|
| K-01 | DDL：唯一约束/索引变更进设计页签、列序调整、SQLite 重建保留触发器/视图、MSSQL 默认值/computed/rowversion | §3.4.4 / §3.7、§5 | P1/P2 | ❌/⏸ |
| K-02 | 表数据：类型化编辑器、多列排序、多条件 AND 过滤、NULL vs 默认值、`IDENTITY_INSERT`、BLOB 查看器、多行删除、SQLite `rowid` | §5、§3.4.5 | P1 | 🟡 |
| K-03 | 结果/导出：真流式写文件、进度/取消、>1 万行、选中区域/全部结果集导出 | §3.6.4 | P2 | ❌ |
| K-04 | 编辑器：SQLite ATTACH 库内对象、MySQL 跨库列、错误波浪线、代码折叠、`GO 5`、驱动级多结果集、参数化执行 | §3.4.2、§5 | P1/P2 | 🟡 |
| K-05 | 历史：更复杂的敏感字段形式（如嵌套函数、JSON 文本） | §3.4.3 | P2 | 🟡 |
| K-06 | Agent：运行中/空闲状态、>1000 作业的服务端分页（`agent-queries.ts:87` 列表无 TOP/OFFSET）、右键菜单完整化、权限不足/Agent XPs 真机回归 | §3.4.8 | P1/P2 | 🟡 |
| K-07 | 设置：字体族/Tab 宽度、补全开关与延迟、数据目录迁移、网格偏好 | §3.4.7 | P2 | ❌ |
| K-08 | 连接：SQLite 文件拖入、认证插件字段、独立「只读连接」标记、Percona 真实实例回归、全量错误码 | §3.4.1 | P2 | 🟡 |
| K-09 | DDL/刷新后表子对象缓存不失效 | ✅ 已修复（W-20261109-51）：执行 DDL 与刷新 schema 时清空该 tab/browse session 的 `tableExtras` | — | — |
| K-10 | 非功能：打包/签名/安装包、性能基线、无障碍、CI 门禁、崩溃率与冷启动指标 | §3.6.2 / §3.9 | P2 | ❌ |

### 4.4 R：架构已就绪但缺入口/韧性

| ID | 缺口 | 现状与证据 | 影响 | 建议 |
|---|---|---|---|---|
| R-01 | 会话健康检测、心跳、自动重连、错误重试入口 | 全仓未找到应用层 ping/keepalive；`QueryError.retryable` 只在 `App.tsx:342` 显示「可重试」，没有操作入口 | 服务器断连只有下一次执行才暴露；锁等待/死锁只能手动重跑 | 增加轻量 `ping`/重连策略；错误面板提供「重试」；状态栏区分「空闲/断连」 |
| R-02 | 窗口尺寸/位置/最大化记忆 | `src/main/index.ts:24-42` 固定 `width/height`，无状态读写 | 每次启动都回到默认大小 | 记录 bounds 到元数据库或本地配置，恢复时校验可见区域 |
| R-03 | 渲染层错误边界与恢复入口 | `main.tsx:11-29` 只有 `window.error` / `unhandledrejection` 日志；没有 React `ErrorBoundary` | 组件渲染异常会白屏，用户只能杀进程 | 增加错误边界、错误页与「重新加载」；关键页面单独兜底 |
| R-04 | 元数据库逐版本迁移与升级前备份 | `metadata.ts:155-172` 直接写 `user_version = 5`，靠 `ensureLastOpenedColumn` / `ensureServerColumn` 补列；没有按版本分支，也没有升级前自动备份 | 后续 schema 变更缺少统一升级路径；升级失败回滚依赖手工备份 | 引入 `migrations` 表/版本分支；升级前自动 `backup()`；失败回滚并在 UI 提示 |
| R-05 | SQL 文件外部变更检测、另存为、最近文件 | `App.tsx:3687-3746` 只有打开/覆盖保存；保存对话框用已有 `path` 直接覆盖 | 外部编辑后保存会覆盖；没有「另存为」和最近列表 | 保存前比对 mtime/内容；增加「另存为」；最近文件存本地设置 |
| R-06 | MSSQL DDL 会话 SET | ✅ 已修复（W-20261109-52）：连接建立后设置 `ANSI_NULLS ON; QUOTED_IDENTIFIER ON` | — | — |
| R-07 | 库级 DDL 跳过存储过程 | ✅ 已修复（W-20261109-56）：按方言读取存储过程定义并纳入库级 DDL | — | — |
| R-08 | 服务器实体的操作与孤儿清理 | `servers` 表、`server_id`、树形分组已实现（`metadata.ts:127-149`）；`removeConnection` 会清孤儿（563-575），但 `saveConnection` 换 host 时旧 server 行不会清；重命名/删除/健康状态按决策不做 | 数据库里可能积累不可见 server 行；服务器级操作缺失但已明确不做 | 更新连接后清理无引用 server；其余保持 ⏸，不扩大 v1.0 |
| R-09 | `ConnectionTestStatus 'not-implemented'` 与样式残留 | `ipc-contract.ts:45` 定义了该状态，但 `testConnection()` 从不返回；`styles.css:1717` 仍有 `.test-not-implemented` | 类型与样式是早期占位，容易误导 | 删除该状态与样式，或明确保留原因并注释 |

### 4.5 文档与代码的不一致

| # | 主题 | 文档写法 | 代码现状 | 处理建议 |
|---|---|---|---|---|
| C-01 | 表数据分页档位 | PRD §4.5.2 写 50/200/500/1000；审计已指出缺 1000 | `Workspace.tsx:704` 只有 `[50, 200, 500]` | 补 1000，或回写 PRD 统一为 50/200/500 |
| C-02 | 新建连接语义 | PRD v0.20 Q27：保存连接是配置，编辑/删除不影响已建 tab session；AGENTS 还写着「当前实现会静默重连绑定标签」 | 编辑连接已不重连（W-20261109-12）；但**新建**连接会改绑当前 tab（H-02） | 先确认 H-02 的产品语义；同步修正 AGENTS 的过期句子 |
| C-03 | 服务器模型 | README 仍可能写「当前实现仍是扁平保存连接」 | `servers` 表 + `server_id` + 左侧树按服务器分组已实现（W-20261109-13/14） | 更新 README 为「服务器实体与分组已实现；服务器级浏览/操作仍按 v1.x/明确不做」 |
| C-04 | MSSQL 导出能力 | README/审计只说 MSSQL 已接入、导出格式可用 | 「加载全部」分支被旧 guard 挡住（H-01） | 修 H-01；文档补一句「导出全部依赖查询重跑，最多 1 万行」 |

### 4.6 证据索引

- 标签/会话/草稿/导出：`src/renderer/src/App.tsx`（`saveConnection`、`disconnectConnection`、`closeTab`、`persistDraftTabs`、`loadAllForExport`、`runQuery`）
- 主进程会话：`src/main/services/ConnectionManager.ts`（`testSqliteFile`、`openSessionById`、`closeSession`、`executeDdl`）
- 驱动关闭/取消：`src/main/services/mysql/MysqlSession.ts`、`src/main/services/mssql/MssqlSession.ts`、`src/main/services/sqlite/SqliteSession.ts`、`src/main/workers/sqlite-worker.ts`
- 连接导入导出：`src/shared/connection-export.ts`、`src/main/ipc/router.ts`
- 元数据库与密码：`src/main/storage/metadata.ts`
- 设置与历史：`src/main/storage/history-store.ts`、`src/renderer/src/components/HistoryDialog.tsx`、`src/shared/settings.ts`
- Agent：`src/main/services/mssql/agent-queries.ts`、`src/renderer/src/components/AgentTabPanel.tsx`、`src/renderer/src/components/Sidebar.tsx`
- 生命周期与安全：`src/main/index.ts`、`src/renderer/src/main.tsx`、`src/main/ipc/router.ts`

### 4.7 建议实施顺序

**第一波：修「有入口但走不通/会误伤」**

1. H-01 MSSQL 导出 guard（改动小、收益直接）
2. H-03 断开连接关闭 browse session
3. H-04 导入导出命名实例 + 去重 + 密码补录提示
4. H-02 新建连接语义（先确认：只落配置，还是允许改绑但必须确认）
5. H-05 关闭标签先取消查询

**第二波：一致性与数据安全**

1. H-06 内部查询历史来源（需拍板：记但标 `table-page`，还是不记）
2. H-07 `customTitle` 持久化
3. H-08 SQLite 测试与只读回退统一
4. H-09 密码清除/测试连接
5. K-09 DDL 后清表子对象缓存
6. K-02 分页档位补 1000

**第三波：韧性与长尾**

R-01～R-06、H-10、H-11、K-01/K-03～K-08/K-10 按模块排期；K 组不改变「v1.x 明确延后」的既有决策。

**每波完成后的门槛**：

- 代码类：`npm run typecheck` + 对应纯逻辑测试 + `npm run build` + `npm run e2e:sqlite`；MSSQL/MySQL 相关补 `e2e:mssql` / `e2e:mysql`。
- UI 类：真实 Electron 点击验收后再回填 §5；不能在沙箱里标「已完成」。
- 文档类：改完状态后追加 §6，并同步 §3 对应模块的缺口描述。

---

## 5. UI 调整清单与真机验收

> 使用方式：**一次只做一项**。先在真实 Electron（`npm run dev`）里复现当前形态，再改代码，
> 改完在 §6 追加记录，并回填本节状态。
>
> 状态：`[ ]` 未开始｜`[~]` 进行中｜`[x]` 已完成且真机验收｜`[?]` 待确认/待用户拍板
>
> 真机验收不可用沙箱代替。没在 Electron 里点过，只能标 `[~]`，不能标 `[x]`。

### 5.1 当前形态确认（优先）

#### 5.1.1 左侧对象树

- [~] 保存连接与对象树合并为一棵：分组下直接列连接，连接节点打开/关闭对象树，当前连接对象内联显示
- [~] 连接节点显示打开/关闭状态，右侧状态点区分已连接 / 连接中 / 连接失败 / 未连接
- [~] 未连接时只显示“未连接/正在连接”，不显示表、视图、存储过程、Agent 等对象细节
- [~] `SQL Server Agent → 作业 → 作业项` 三级展开，且 Agent 位于对象树最后
- [~] 表 / 视图节点可折叠，数量与对象搜索联动；空文件夹不再显示“无表/无视图”
- [~] 作业项：启用状态点、禁用/MSX 标记、悬停展示上次运行信息
- [~] 单击作业只选中，不打开页签；双击打开作业详情页签
- [~] 作业树加载中有提示；会话失败/权限不足时树内显示错误
- [~] 切换标签/连接后，展开状态与作业缓存行为符合预期
- [ ] 作业很多（>100）时树的滚动与渲染可接受
- [ ] 对象树与连接列表在窄窗口下的宽度/换行/横向溢出

#### 5.1.2 多数据库树（MSSQL / MySQL 系）

- [~] 连接后列出所有有权限的数据库，标记当前库
- [~] 点击数据库切换当前库（`USE`），并加载该库对象
- [~] 库下分「表 / 视图 / 存储过程」，可折叠、数量正确
- [~] 单击表/视图填入查询，双击打开表数据页；存储过程生成 EXEC/CALL
- [~] 表节点可展开「约束 / 触发器 / 索引」，懒加载并显示数量/类型
- [~] 表数据页签记录所属数据库，翻页/查询前自动回到该库
- [~] 新查询/DDL 页签继承当前选中的数据库
- [~] MSSQL「显示系统对象」可浏览 `master` / `msdb` 的 `is_ms_shipped` 表/视图
- [~] MSSQL 的「表 / 视图 / 存储过程」下按 schema 分组（待人工真机验收）
- [ ] 真实 MySQL / MariaDB 实例回归（当前只通过类型检查与 MSSQL 真机）
- [~] 跨库搜索（搜索时按需加载所有数据库对象；待真机验收）
- [ ] 系统数据库过滤/分组（master、mysql、sys 等是否默认收起）
- [ ] 表子对象缓存失效（DDL 后重新展开应刷新）
- [ ] 右键 DDL 弹窗打开后若切换库，执行目标库的锁定/提示

#### 5.1.3 作业详情页签

- [~] 详情页签不重复打开同一作业；关闭后从树再次双击可重新打开
- [~] 详情页头部按钮按状态置灰（禁用作业不能启动、多服务器只读）
- [~] 步骤表“打开命令/复制”只对 T-SQL 生效
- [~] 计划共享警告、历史失败红色高亮
- [~] 生命周期操作后，详情与左侧树都刷新

### 5.2 左侧对象树 / Agent（近期）

- [~] 作业树增加显式刷新入口（对象树顶部刷新已联动作业；详情页有刷新按钮，待真机验收）
- [ ] 作业树支持右键：启动/停止/启用/禁用、在编辑器中打开、复制作业名
- [ ] SQL Server Agent 节点在未连接/非 MSSQL 时的空态与禁用态
- [ ] 表/视图/作业的空态文案统一（“无表/无视图/没有作业”）
- [ ] 树节点键盘操作：上下移动、左右展开/收起、Enter 打开
- [ ] 记住每个连接的树展开状态（当前是全局状态）
- [ ] 连接节点显示健康状态（已连接/连接中/失败），失败悬停原因
- [ ] SQLite 文件拖入连接（MOD-01 P0 缺口）

### 5.3 主框架 / 标签栏 / 工具栏

- [~] 切换连接保留现有 SQL 标签，不把当前标签改绑并清空结果（B-2；代码已改，待人工真机验收）
- [~] 标签标题显示连接 / 当前库（W-20261109-12；E2E/构建通过，待人工验收）
- [~] 执行按钮旁数据库下拉（W-20261109-12；SQLite 隐藏；MySQL 系待真机）
- [~] 标签右键菜单：关闭 / 关闭其他 / 关闭右侧 / 全部关闭 / 复制 / 重命名（W-20261109-12；待人工验收）
- [~] 标签状态点：运行中 / 失败 / 未保存或未提交（W-20261109-12；待人工验收）
- [~] 状态栏显示当前库与活动会话数（W-20261109-12；待人工验收）
- [~] 编辑保存连接不重连标签、收起左侧树（W-20261109-12；待人工验收）
- [~] 删除连接保留 tab session / SQL / 结果，标记「连接已删除」（W-20261109-12；快照持久化 W-20261109-17）
- [~] 完整 BEGIN/COMMIT 事务面板（W-20261109-13；主路径已实现，待人工验收）
- [~] 服务器实体后端：`servers` 表 + `server_id` + 连接副标题服务器名（W-20261109-13；树形分组 UI W-20261109-14）
- [~] 服务器 → 连接配置的树形分组（W-20261109-14；已显示服务器头，待人工验收）
- [?] 服务器级 Agent 明确不做，保持当前连接级 Agent 结构
- [?] 服务器删除/重命名/健康状态明确不做，当前结构已够用
- [~] 独立 browse session（W-20261109-15/16/17；双击连接只开树；browse-only 对象操作会先创建 tab；搜索覆盖 browse 对象；待人工验收）
- [~] 删除连接后的 tab 快照持久化（W-20261109-17；只持久化展示快照，不恢复 session）
- [ ] 标签过多时的滚动/收缩策略；中键关闭；关闭按钮命中区域
- [ ] 工具栏按钮在窄窗口下的换行/折叠
- [ ] 全局通知（toast）位置、时长、错误可复制

### 5.4 SQL 编辑器与补全（MOD-02）

- [~] 补全弹层：列名、`别名.`、`表名.`、函数（W-20261109-19；待人工验收）
- [~] 函数签名提示：输入 `(`/`,` 后显示参数并高亮当前参数（W-20261109-20；待人工验收）
- [~] 补全弹层：MSSQL `库.Schema.表`、MySQL `库.表`、SQLite `main.`/`temp.`、库名/Schema 名（W-20261109-21；待人工验收）
- [~] 补全触发：`.`、`FROM/JOIN/INTO/UPDATE/TABLE/VIEW/EXEC/USE/SET` 后空格自动触发、手动 Ctrl+Space、大小写跟随（W-20261109-19/21；待人工验收）
- [ ] 补全弹层：版本感知、类型提示、通配符展开、SQLite ATTACH 库内对象、MySQL 跨库列
- [ ] 补全弹层定位、滚动、键盘选择、Esc 关闭、IME 不冲突
- [ ] 错误波浪线（解析失败/可定位错误）
- [ ] 未选中时执行“光标所在语句”
- [~] 多语句执行：`;` / MSSQL `GO` / MySQL `DELIMITER` 分句、逐条执行、遇错停止（W-20261109-22；E2E 覆盖 SQLite 主路径，待人工验收）
- [~] 多结果页签 + 消息面板（W-20261109-22；E2E 覆盖结果切换/失败停止，待人工验收）
- [ ] 驱动级多结果集、MSSQL `PRINT`/`RAISERROR` 消息、MySQL warning 进入消息面板
- [ ] `GO 5` 重复批次
- [~] 打开/另存为/最近文件/拖入 `.sql`（W-20261109-54；待真机验收）

### 5.5 查询历史（MOD-03）

- [~] `Ctrl/Cmd+E` 打开历史；弹窗打开时不叠加
- [~] 搜索命中高亮命中片段；今天/自定义时间范围
- [~] 行操作：插入光标处、再次执行、复制、仅看此连接、详情、删除
- [~] 已删除连接显示标记，并仍可按连接筛选
- [~] 默认脱敏、去重开关、保留条数“不限制”
- [~] 再次执行回到原连接/原库；原连接已删除时只插入编辑器
- [ ] 人工真机逐项点击验收（当前仅 E2E 覆盖）

### 5.6 结果网格与表数据（MOD-05/MOD-06）

- [~] 结果行数「不限制」档位 + 内存风险提示（W-20261109-24；E2E 覆盖 SQLite，待人工验收）
- [ ] 过滤 UI：文本/数字/日期/布尔操作符、多条件 AND
- [ ] 多列排序（Shift+点击）与列头序号
- [ ] 列宽拖拽、隐藏列、固定前 N 列、按表记忆
- [ ] 多行选择 + 批量删除（Delete 键）
- [ ] F2 编辑、日期/布尔编辑器、大文本弹窗、BLOB 查看器
- [ ] 显式 NULL vs 留空默认值；`IDENTITY_INSERT`
- [ ] 冲突预检与“跳过冲突行”
- [ ] 单元格/区域复制（TSV）、网格右键菜单
- [ ] 空结果、截断、加载中的统一空态/骨架

### 5.7 DDL 与弹窗（MOD-04）

- [~] 右击表「编辑表结构…」、右击连接/表「新建表…」在独立页签打开（待人工真机验收）
- [~] 保存后按新建/编辑生成 DDL；SQLite 修改列走整表重建（E2E 已覆盖）
- [~] 删除列在预览页输入表名确认
- [~] 执行 DDL 前可选择目标数据库（SQLite 隐藏；编辑模式固定表所在库；待 MySQL 真机验收）
- [ ] 编辑页签支持唯一约束/索引变更（当前仍走索引入口）
- [~] MSSQL UI 建表/改表（页签支持 schema + IDENTITY + 加/删/改列；后端 DDL 已真机回放）
- [ ] 新表向导补齐索引/外键/CHECK/注释页签
- [ ] CHECK 约束新建/删除/编辑
- [ ] 列顺序调整、表注释预览
- [ ] DDL 预览弹窗：完整 SQL、可编辑、风险区、方言事务能力
- [ ] 删除/重命名等危险操作的对象名确认一致性
- [ ] 弹窗尺寸、滚动、焦点陷阱、Esc 行为统一

### 5.8 设置 / 主题 / 打磨

- [~] “跟随系统”主题（W-20261109-57；待真机验收）
- [ ] 字体族、Tab 宽度、关键字大小写、补全开关与延迟
- [~] 历史去重/脱敏开关（设置面板已接入，待人工真机验收）
- [ ] 网格自动提交/提交确认
- [ ] 自定义数据目录 + 迁移
- [ ] 浅色主题对比度与强调色
- [ ] 快捷键说明与实际行为一致

### 5.9 真机验收记录

> 每次 `npm run dev` 验收在此追加；格式：日期 / 提交或工作区 / 结论 / 截图路径（可选）。

| 日期 | 版本/工作区 | 结论 | 备注 |
|---|---|---|---|
| 2026-11-06 | Agent 左侧树改造 | 待验收 | 沙箱无法启动 Electron |
| 2026-11-06 | RevoGrid 开发模式空白修复 | 已验收 | `npm run dev` 下用 CDP 执行 SQLite / MSSQL 查询，结果表格正常渲染 |
| 2026-11-06 | 连接/对象树合并 + MSSQL 系统库 | 已验收 | Electron 45 构建版 CDP：连接开关状态、Agent 置后、master/msdb 系统对象可见 |
| 2026-11-09 | W-20261109-12 标签/数据库/连接解耦 | E2E 通过，人工待验收 | `npm run e2e:sqlite` 通过；未人工点击新右键菜单/数据库下拉/删除连接 |
| 2026-11-09 | W-20261109-13 事务面板/服务器实体 | E2E 通过，人工待验收 | 事务面板、服务器副标题、toast 点击穿透未人工验收 |
| 2026-11-09 | W-20261109-15 独立 browse session | E2E 通过，人工待验收 | 双击连接只开树、browse 树查表/表数据/DDL 刷新通过；browse-only 建表/视图/脚本未做 |
| 2026-11-09 | W-20261109-16 browse-only 对象操作 | E2E 通过，人工待验收 | browse-only 对象操作会先创建 tab；未人工点击 |
| 2026-11-09 | W-20261109-17 browse 搜索/快照持久化 | E2E 通过，人工待验收 | 搜索与快照恢复未人工点击 |
| 2026-11-09 | W-20261109-19 SQL 补全 Phase 1 | typecheck/test/build/E2E 通过，人工待验收 | 列/别名/限定名/函数；未人工点击补全弹层 |
| 2026-11-09 | W-20261109-20 函数签名提示 | typecheck/test/build/E2E 通过，人工待验收 | 签名表只覆盖常用函数；未人工点击 |
| 2026-11-09 | W-20261109-21 库/Schema 补全 + 大小写跟随 | typecheck/test/build/E2E/MySQL/MariaDB/MSSQL 联调通过，人工待验收 | 未人工点击补全弹层；ATTACH/跨库列仍有限制 |
| 2026-11-09 | W-20261109-22 编辑器多语句 + 多结果/消息面板 | typecheck/test/build/E2E 通过，人工待验收 | 逐条 IPC；PRINT/warning 未进消息面板 |
| 2026-11-09 | W-20261109-23 MySQL / MSSQL UI E2E | e2e:mysql / e2e:mssql 真机通过 | 未覆盖取消/超时/DDL/表编辑 |
| 2026-11-09 | W-20261109-24 结果集「不限制」档位 | typecheck/test:settings/E2E 通过，人工待验收 | 真正无限加载，大结果集仍可能卡顿 |

---

## 6. 变更记录

> 追加式记录：每次改代码、脚本、配置或文档，在末尾追加一条；不删除、不改写历史条目。
> 编号 `W-YYYYMMDD-NN`，时间按 Asia/Shanghai。每条包含：诉求、变更、涉及文件、验证结果、遗留/风险。
> UI 相关改动必须标注是否已在真实 Electron 中运行；未运行写「未真机验收」，不得写成已验证。

### 2026-11-06

- **W-20261106-01 MSSQL 驱动接入（tedious）**：诉求是完成连接、查询、对象树、表数据、DDL 查看、表编辑与取消。变更：用 `tedious` 单连接实现 `MssqlSession`（不用 `mssql` 池包装），一个标签一个物理连接；实现查询、`sys.objects` 对象树、表元数据/结构、查看 DDL、表数据页、参数化 DML、取消、视图识别；`useUTC: true`，datetime/date/time 按 UTC 分量格式化，decimal 转字符串，`sys.objects.type` trim；元数据查询串行化规避 `EINVALIDSTATE`；新增 `check:mssql`。验证：SQL Server 2016 SP2（13.0.5026.0）真机跑通，`typecheck` 通过。遗留：MSSQL UI 建表/改表当时未实现；TLS 严格校验、多 schema、非默认命名实例未回归。
- **W-20261106-02 SQL Browser / 命名实例**：支持 `host\instance` 与 UDP 1434。变更：连接表单新增可选实例名；支持 `host\instance`、`host:port`、IPv6 归一化，实例名与端口互斥；`MssqlSession` 把 `instanceName` 交给 tedious；`EINSTLOOKUP` 补充排查建议；联调脚本支持 `DBCRAFT_MSSQL_INSTANCE`。验证：SQL Browser 启动后 `check:mssql` / `check:mssql-agent` 通过。遗留：非默认命名实例与动态端口未真机回归。
- **W-20261106-03 MSSQL Agent 后端**：变更：新增纯逻辑查询/脚本模块（列表、详情、启停/启用/禁用脚本、共享计划警告、`sp_update_job*` 生成）；生命周期写 `source=agent-control` 历史；新增 `agent:list/detail/action/script` 并同步契约/zod/router/preload；多服务器作业只读。验证：SQL Server 2016 SP2 临时作业全流程通过。遗留：Agent XPs 禁用、权限不足、共享计划、多服务器仅代码路径。
- **W-20261106-04 Agent UI 第一版：弹窗**：对象区加入口，主区域弹窗展示列表/详情/生命周期/脚本。验证：无 Electron 真机，仅后端联调。结果：不符合 PRD 独立页签，后续两次重构。
- **W-20261106-05 Agent UI 第二版：对象树入口 + 主区域页签**：新增 `AgentTabPanel`，列表/详情作为页签；生命周期跨页签刷新；T-SQL 步骤“打开命令/复制”；移除弹窗。验证：`typecheck`、21 组测试通过；UI 未真机验收。遗留：列表页签仍不是用户想要的形态。
- **W-20261106-06 密码存储核查（只读审计）**：确认密码经 `safeStorage` 加密为 BLOB 存 `connections.secret`，Windows 为 DPAPI；渲染层拿不到密码；加密不可用时不落明文；日志只记 `passwordStored`。与 PRD 的 AES-GCM 回退不一致，且无保存/清除密码开关。未改代码。
- **W-20261106-07 剩余工作盘点（只读审计）**：对照 PRD/状态/源码列出 M1 收口、M3 P0 空窗（MSSQL UI DDL、新表向导、CHECK 编辑）、MOD-08 剩余、非功能缺口。源码抽查未运行测试。结论纳入 UI 清单与后续迭代。
- **W-20261106-08 Agent UI 第三版：左侧树展开（当前形态）**：对象树支持 `SQL Server Agent → 作业 → 作业项` 三级展开；作业直接列在树中；表/视图可折叠；对象搜索过滤作业；作业项显示状态/禁用/MSX；单击选中、双击详情；删除作业列表页签；按标签缓存作业，生命周期后清缓存刷新；会话未就绪时树内报错。验证：`typecheck` + 21 组测试通过；UI 未真机验收。遗留：详情仍用页签；>1000 作业性能未验证。
- **W-20261106-09 文档记录制度与 UI 清单**：新增追加式操作日志与 UI 调整清单（现并入本文），同步 README、状态文档与 AGENTS。纯文档。
- **W-20261106-10 多数据库对象树**：`SchemaObject.type` 增加 `procedure`；新增 `DatabaseInfo`/`TableExtras`/约束/触发器类型；`DatabaseSession` 增加 `databases()`/`useDatabase()`/`tableExtras()`；MSSQL `sys.databases` + `[db].sys.objects` + `USE [db]`；MySQL 系 `SHOW DATABASES` + `information_schema` + `USE`；SQLite PRAGMA 子对象、切库明确报错；新增 `schema:databases/use-database/table-extras`；前端新增 `ObjectTree.tsx`，表数据页记录所属库并自动切库；修复 UI 层 MSSQL 拦截误报。验证：`typecheck` + 21 组测试；`check:mssql` / `check:mssql-agent` / 新增 `check:mssql-multidb` 通过；MySQL/MariaDB 未真机。遗留：跨库搜索、子对象缓存失效、切库期间 DDL 目标变化。
- **W-20261106-11 修复执行 SQL 后结果表格空白（RevoGrid / Vite 开发模式）**：开发模式控制台报 `InvalidCharacterError`，定位为 Vite 预打包与 RevoGrid/Stencil 懒加载入口不兼容；`electron.vite.config.ts` 增加 `optimizeDeps.exclude`。验证：开发模式 SQLite/MSSQL 查询正常渲染，`build`（含 `typecheck`）通过。遗留：升级 RevoGrid 后需回归。
- **W-20261106-12 连接列表与对象树合并；MSSQL 系统库对象可见**：`Sidebar.tsx` 合并为单棵树、连接状态点、对象操作/系统对象开关移到当前连接、Agent 置后、搜索合并；`App.tsx` 聚合连接状态、切换系统对象清缓存；空对象不再显示空文案；新增样式。验证：`typecheck`/`build`/`test:groups` 通过；Electron 45 构建版 + CDP 实测连接状态、master/msdb 系统对象、Agent 置后。遗留：只内联当前活动标签所属连接；跨库搜索未做；MySQL 系未真机。
- **W-20261106-13 未连接时隐藏对象树细节**：`Sidebar.tsx` 增加 `activeSessionStatus`，对象树/操作/系统对象/Agent 仅在 ready 时渲染；未就绪只显示“未连接/正在连接/连接失败”。验证：`typecheck`/`build` 通过；CDP 断开后对象消失、状态点变灰、重连恢复。
- **W-20261109-01 查询历史收口**：补齐 `Ctrl/Cmd+E`、搜索命中高亮、右键“从历史插入”、已删除连接标记、复制/仅看此连接、今天/自定义时间、默认脱敏、去重开关、不限制保留条数、“再次执行回到原连接/原库”；修复新建查询按钮误把事件对象当 `connectionId`。验证：`typecheck` + `test:history`/`test:settings`/`test:groups` + `e2e:sqlite` 历史用例通过。遗留：历史固定 200 条、脱敏只覆盖赋值型。
- **W-20261109-02 标签与会话一一对应**：删除 `rebindActiveTab`，新增 `selectConnectionTab`；选择连接时激活同连接已有标签或新建，不改绑当前标签；工具栏/左侧连接节点统一使用。验证：`typecheck`/`build` 通过，代码走查确认无改绑路径；UI 未人工验收。遗留：同连接多标签时优先激活第一个；不支持跨连接拖拽。
- **W-20261109-03 新建表/编辑表结构改为页签 + DDL 差异生成**：新增 `shared/dialect/table-diff.ts`（新建 `CREATE TABLE`；编辑生成 RENAME/ADD/DROP/RENAME/MODIFY；主键/自增保护；SQLite 改列走重建）；`sqlite-rebuild.ts` 增加完整目标列重建、保留主键/自增/显式索引；新增 `TableDesignTab.tsx` 与 `table-design` 标签；删除列需输入表名；删除旧弹窗。验证：`typecheck`/`build`/`test:ddl`/`test:sqlite-rebuild`/`test:settings`/`test:history` + `e2e:sqlite` 全套通过。遗留：MySQL/MariaDB 未真机；SQLite 重建不保留外键/CHECK/触发器/注释；编辑页签不支持唯一约束/索引变更。
- **W-20261109-04 表设计页签执行前选择数据库**：预览页脚增加数据库下拉；非 SQLite 从 `schema:databases` 渲染；切换时对设计页签 session 执行 `USE`；编辑模式固定表所在库；E2E 增加 SQLite 不渲染下拉断言。验证：`typecheck`/`build`/`e2e:sqlite` 通过。遗留：MySQL/MariaDB/MSSQL 下拉未真机点击；MSSQL 实际只在 MySQL 系可见。
- **W-20261109-05 MSSQL schema 树与 UI 建表/改表（含 IDENTITY）**：`SchemaObject` 增加 `schema`；`ddl.ts` 解除 MSSQL 拦截，支持 `CREATE TABLE [schema].[table]`、IDENTITY、ADD/DROP/ALTER COLUMN、`sp_rename`、索引、DROP、CREATE VIEW；`table-diff.ts` 支持 schema；对象树按 schema 分组；表设计页签支持 schema/Identity；MSSQL 加/删/改列转设计页签。验证：`typecheck`/`build`/`test:ddl`/`test:sqlite-rebuild`/`e2e:sqlite` 通过；`check:mssql` 真机回放通过。遗留：默认值/CHECK/外键/触发器/computed/rowversion 不支持；跨 schema 移动需 SQL；MySQL 系无 schema 层。
- **W-20261109-06 需求梳理与隐藏需求审计**：新增需求审计文档（后已删除），按 L0～L3 分层、列隐藏需求与 22 条冲突、v1.0/v1.x 建议；更新 README/状态文档，不改 PRD。验证：人工核对源码，未跑构建。遗留：建议需确认后改 PRD。
- **W-20261109-07 PRD v0.17：需求分层与范围决策落地**：PRD 增加 §0 分层/v1.0 基线、完整补全、编辑器内多语句/多结果、结果集不限制、Agent 左侧树、超时默认值、删除连接池、§9 v1.x、§10 技术附录、Q16～Q20；同步状态/README/TECH/AGENTS。验证：文档交叉核对，未跑构建。遗留：完整补全/多语句/不限制当时仍是代码缺口；Q16～Q20 待拍板。
- **W-20261109-08 连接/服务器/标签/会话模型补充审计**：新增模型审计（现并入本文 §2），记录当前模型、隐藏需求、推荐模型、v1.0/v1.x 边界与 Q21～Q28；PRD v0.18 增加 §0.5；状态文档增加 D-9/D-10。验证：源码核对；未跑构建。遗留：服务器实体、会话管理器、事务面板等仍需排期。
- **W-20261109-09 连接/服务器/标签模型决策落地（PRD v0.19）**：Q21 A、Q22 A + 数据库下拉、Q23 A、Q24 B、Q25 B、Q26 B 落地；PRD 增加服务器与连接配置、标签标题/下拉/右键/状态、事务面板、AC；同步模型审计/状态/README/AGENTS/TECH。验证：文档核对。遗留：v1.0 工作量增加，代码尚未实现；Q27 待定。
- **W-20261109-10 Q27 规则修正：保存连接与 tab 解耦**：PRD Q27 改为已定：编辑保存只改配置、不重连/不改写 tab、关闭左侧树、双击重连；删除保留 SQL；模型审计/状态/AGENTS 同步；明确对象树需要独立 browse session。验证：文档核对。遗留：当前代码与目标相反，需实现。
- **W-20261109-11 类/对象模型与交互入口修正（PRD v0.20）**：明确保存连接是配置（类）、session 是运行时对象；双击连接开树；右击查询建 tab + session；tab-session 强绑定；执行旁数据库下拉；编辑/删除不影响已有 session；删除后保留到用户关闭。同步模型审计/状态/README/AGENTS/TECH。验证：文档核对。遗留：当前实现差异较大，需要 browse session 与 tab 快照。
- **W-20261109-12 标签/会话可见性与 Q27 连接解耦（代码第一刀）**：`QueryTab` 增加 `customTitle`/`connectionSnapshot`；新增 `connectionForTab`、`tabLabels`、`tabStatuses`、`activeSessionCount`；执行旁数据库切换；标签右键菜单；编辑保存不重连、删除保留 session/SQL/结果；重连恢复当前库；关闭批量标签清 runtime。验证：`typecheck`/`build`/`e2e:sqlite` 通过。遗留：服务器实体、事务面板、独立 browse session 未做；快照只在内存；UI 未人工验收。
- **W-20261109-13 事务面板、服务器实体与 toast 点击穿透**：事务面板按首关键字识别 BEGIN/COMMIT/ROLLBACK，维护状态/开始时间/语句计数，关闭标签提示，状态栏显示；服务器实体新增 `server-identity.ts`、`servers` 表与 `connections.server_id`、启动回填、连接副标题；修复 toast `pointer-events: none`。验证：`typecheck`/`test:connection-export`/`test:settings`/`build`/`e2e:sqlite` 通过。遗留：服务器树 UI、事务完整解析、browse session 等未做。
- **W-20261109-14 服务器树形分组 UI**：`Sidebar.tsx` 按 `serverId`/server key 分组，新增可折叠服务器头（名称/类型/连接数），嵌套在用户分组内，搜索时按匹配连接过滤；补充 `BEGIN TRY`/`BEGIN CATCH` 事务排除。验证：`typecheck`/`build`/`e2e:sqlite` 通过。遗留：仍复用当前活动 tab session；服务器级操作未做。
- **W-20261109-15 独立 browse session**：新增 `browseConnectionId` 与 `browse-<connectionId>` session；双击/展开只开树；右击查询才建 tab；browse 复用自己的 schemas/databases/dbObjects/currentDatabase；支持切库/刷新/系统对象/表子对象；browse 单击表填入或新建 tab，双击表新建表数据 tab，存储过程新建查询 tab；编辑/删除关闭 browse 不影响 tab；DDL 后同时刷新。验证：`typecheck`/`build`/`e2e:sqlite` 通过。遗留：browse-only 菜单/建表/视图/脚本暂不可用（W-20261109-16 补）；搜索覆盖不全；UI 未人工验收。
- **W-20261109-16 browse-only 连接的对象操作**：新增 `ensureConnectionTab(connectionId)`；browse-only 新建表/视图/脚本/右键对象先确保 tab。验证：`typecheck`/`build`/`e2e:sqlite` 通过。遗留：会先创建/激活查询 tab；UI 未人工验收。
- **W-20261109-17 browse 对象搜索与连接快照持久化**：搜索命中同时检查 browse session 的数据库/对象；browse 连接默认展开；草稿 `DraftPayload` 增加 `connectionSnapshot`，重启后仍显示原连接快照（不恢复 session）。验证：`typecheck`/`build`/`e2e:sqlite` 通过。遗留：快照不含密码、不恢复 session；UI/E2E 未覆盖搜索与快照恢复。
- **W-20261109-19 SQL 补全 Phase 1：列 / 别名 / 限定名 / 函数**：`sql-completion.ts` 增加 `needle`/`qualifier`/`replaceStart`/`statement`/`tables`/`clause`，新增 FROM/JOIN/UPDATE/INTO 表引用解析与方言函数表；`SqlEditor` 支持异步补全、`.` 触发、限定名只替换点后前缀；`App` 新增 provider（按别名/表拉列并缓存，DDL/切库清缓存）。验证：`typecheck`/`test:sql-completion`/`build`/`e2e:sqlite` 通过。遗留：库/Schema 简化版；版本感知/类型提示/空格触发/解析降级未做；补全 UI 未人工验收。
- **W-20261109-20 SQL 补全 Phase 2：函数签名提示**：新增方言函数签名表与 `extractSignatureHelp`（扫描最内层未闭合括号、函数名、顶层逗号，忽略字符串/注释/引号/方括号）；`SqlEditor` 增加 `dialect` 属性并显示 `NAME(param1, param2)`，当前参数高亮；`Workspace` 传方言。验证：`typecheck`/`test:sql-completion`/`build`/`e2e:sqlite` 通过。遗留：签名表不完整；不做类型校验；UI 未人工验收。
- **W-20261109-18 明确不做服务器级 Agent**：PRD/模型/状态/README/UI 清单一律标记「服务器级 Agent / 服务器级健康状态明确不做」，保持连接级 Agent。纯文档。
- **W-20261109-21 SQL 补全 Phase 3：库/Schema、大小写跟随、空格触发与 MySQL/MariaDB 联调**：`TableReference` 增加 `parts`；新增 `splitQualifier`/`matchCompletionCase`/`extractAttachedDatabases`/`shouldAutoTriggerCompletion`；补全支持 MSSQL `Schema.`/`库.`/`库.Schema.`、MySQL `库.`/`库.表.`、SQLite `main.`/`temp.`；新增库对象缓存；基础补全加入库名/schema/ATTACH 别名；新增 `check:mysql`/`check:mariadb`；驱动内部 `.ts` 导入补扩展名。验证：`typecheck`/`test:sql-completion`/`build`/`e2e:sqlite`/`check:mysql`（8.0.44）/`check:mariadb`（11.4.13）/`check:mssql`/`check:mssql-multidb` 通过。遗留：ATTACH 库内对象未返回；MySQL 跨库列受 `getTableMeta` 限制；版本感知/类型提示/通配符/解析降级未做；UI 未人工验收。
- **W-20261109-22 编辑器内多语句 + 多结果页签/消息面板**：`splitSqlStatements(sql, limit, dialect?)` 改为方言字符扫描，支持 MSSQL 独立行 `GO`、MySQL `DELIMITER $$`、字符串/注释/引号标识符内不切分、50 条上限；新增 `query:execute-script` 与 `QueryScriptRequest/Response`；`ConnectionManager.executeQueryScript` 逐条执行、遇错停止、每条独立超时/取消/历史；`App` 非内部执行先分句，多语句走 script，危险语句逐条确认，结果状态写入 `RunState`；`Workspace` 结果页签/消息面板；`StatusBar` 显示 N 条语句与总耗时；`SqlScriptDialog` 传方言；E2E/测试补充。验证：`typecheck`/`test:sql-script`/`test:sql-completion`/`build`/`e2e:sqlite` 通过。遗留：仍是逐条 IPC；PRINT/RAISERROR/warning 未进消息面板；`GO 5` 未实现；长脚本整体耗时无上限；UI 未人工验收。
- **W-20261109-23 MySQL / MSSQL UI E2E**：新增 `scripts/e2e-mysql.mjs`（预建临时库 + `items`，UI 新建连接/测试/保存，校验版本/对象树/查询/多语句/消息面板，退出删库）与 `scripts/e2e-mssql.mjs`（读取 `.env.local`，预建表，UI 新建连接/测试/保存，校验版本/对象树/查询/`GO` 两结果页签，退出删表）；`package.json` 增加 `e2e:mysql`/`e2e:mssql`；README/AGENTS/状态文档同步。验证：两个 E2E 真机通过。遗留：依赖便携实例/`.env.local`；未覆盖取消/超时/DDL/表编辑。
- **W-20261109-24 结果集「不限制」档位**：`shared/settings.ts` 增加 `0` 哨兵与 `resolveRowLimit`；四个驱动改用 `resolveRowLimit`；IPC 允许 `maxRows=0`；设置面板增加「不限制」与内存风险提示；E2E 断言 2001 行不截断；`test-settings` 覆盖哨兵/Infinity/负值回退。验证：`typecheck`/`test:settings`/`build`/`e2e:sqlite` 通过。遗留：真正无限加载，大结果集可能卡顿；无执行前二次确认；导出仍最多 1 万行。
- **W-20261109-25 未完成项与隐藏需求清单**：新增未完成项清单（现并入本文 §4）：H 组 11 项、K 组 10 项、R 组 9 项、文档/代码冲突、三波实施顺序、验收门槛、证据索引；README/状态/UI 清单同步。验证：文档交叉核对。遗留：基于代码走查，未逐项真机复现；H-02/H-06 需拍板。
- **W-20261109-26 prd 目录整理与功能状态总表**：新增 `FEATURE_MATRIX.md`（164 行，`✅ 81 / 🟡 23 / ❌ 52 / ⏸ 8`）与 prd 目录索引（现并入本文 §1）；README/UNFINISHED/PROJECT_STATUS 同步；PRD 未改动。验证：交叉核对、脚本统计行数、PRD SHA256 一致。遗留：功能表是代码快照，UI 仍需真机验收。
- **W-20261109-27 清理过时需求审计文档**：删除 `prd/REQUIREMENTS_AUDIT.md`（基线停留在 v0.16/v0.17，状态已被功能表取代，明细已由未完成项承接）；更新 README/prd 索引/状态/未完成项/模型审计引用；记录恢复方式。验证：无引用残留，PRD SHA256 不变。遗留：只删除明确过时的一份。
- **W-20261109-28 六份文档合并为项目主文档**：诉求是把除 `PRD.md`、`FEATURE_MATRIX.md`、`TECH_DESIGN.md` 外的文档整理成一个，随后删除源文件。变更：新增 `prd/PROJECT_MASTER.md`，合并原 `prd/README.md`、`CONNECTION_TAB_MODEL.md`、`PROJECT_STATUS.md`、`UNFINISHED_ITEMS.md`、`UI_TODO.md`、`WORKLOG.md` 的内容，去重后按「文档定位 / 模型 / 现状与验收 / 未完成项 / UI 清单 / 变更记录」重排；删除六份源文件；更新 `README.md`、`AGENTS.md`、`FEATURE_MATRIX.md`、`TECH_DESIGN.md` 中的引用，并把 `PRD.md` 两处旧链接改指本文 §2（仅链接维护，未改需求内容）。验证：交叉核对合并内容与源文件；纯文档改动，未运行构建/测试。遗留：无；合并后 `prd/` 只保留 PRD、FEATURE_MATRIX、TECH_DESIGN、PROJECT_MASTER 四份文档。
- **W-20261109-29 功能总表事实核对**：诉求是检查 `FEATURE_MATRIX.md` 的描述与代码是否一致。变更：修正 M01-07「系统对象仅 MSSQL 有开关」为 SQLite/MSSQL 均可开关；M08-02 手动刷新由 ✅ 改为 🟡（作业树与详情页均无显式刷新入口）；M08-11 作业右键菜单由 🟡 改为 ❌（树内没有右键菜单，启停需打开详情页）；补充 M01-08 状态点是会话状态聚合而非主动健康检查；补全 M02-11 未完成边界；M04-18 改为明确「当前未识别/阻止」；M06-06 明确 SQLite 只有 result code 不伪造 SQLSTATE；代码基线从 `9233262` 更新为 `6d7f77e`；统计更新为 `✅80 / 🟡23 / ❌53 / ⏸8`（MOD-08 为 `6/2/4/3`）。涉及 `prd/FEATURE_MATRIX.md`、`prd/PROJECT_MASTER.md`。验证：用脚本按表格行统计状态，与 §0 总览、§12 统计一致；对照 `App.tsx`（`systemObjectsSupported`）、`Sidebar.tsx`（作业树无刷新/右键菜单）、`AgentTabPanel.tsx`（详情页刷新、100/500 历史）、`Workspace.tsx`（分页档位/单行删除）核对。遗留：M08-06 的共享计划/多服务器只读仍按「代码路径可用」标 ✅，没有真实多服务器实例回归，后续可按真机结果收紧为 🟡。
- **W-20261109-30 M01-13 保存密码开关与已存密码测试**：诉求是实现「保存密码开关 / 清除已保存密码」，并让编辑连接测试时无需重输密码。变更：`ipc-contract.ts` 增加 `ConnectionSaveOptions.rememberPassword`，`connection.test` 增加可选连接 id；`schemas.ts` 增加 `connectionTestSchema` 与保存选项；`metadata.saveConnection` 在 `rememberPassword=false` 时清除 secret 并返回提示；`ConnectionManager.testConnection` 在密码为空且提供 id 时从主进程读取已存密码；`ConnectionDialog` 增加「保存到本地」开关、移除测试前必须重输密码的限制、保存时传递选项；`App.saveConnection` 透传选项。涉及文件：`src/shared/ipc-contract.ts`、`src/main/ipc/schemas.ts`、`src/main/ipc/router.ts`、`src/preload/index.ts`、`src/main/storage/metadata.ts`、`src/main/services/ConnectionManager.ts`、`src/renderer/src/features/connections/ConnectionDialog.tsx`、`src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中手工点击。遗留：清除密码采用「取消勾选并保存」两步操作，没有单独的立即清除按钮；未补连接保存/密码读取的自动化测试。
- **W-20261109-31 M01-02 SQLite 测试连接只读口径**：诉求是让 SQLite「测试连接」和真实会话一致处理只读/被占用文件。变更：`ConnectionTestResult` 增加 `readonly`；`testSqliteFile()` 在锁/权限错误时回退 `readonly: true` 重开并返回版本与只读标记；成功提示改为「只读模式（文件被占用或无写权限）」；不可读文件仍失败。涉及 `src/shared/ipc-contract.ts`、`src/main/services/ConnectionManager.ts`。验证：`npm run typecheck`、`npm run build` 通过；未构造只读文件做真机验证。遗留：只读测试尚未纳入 `e2e:sqlite`。
- **W-20261109-32 M01-15 新建连接不再改绑当前标签**：诉求是让新建连接只保存配置，不影响当前 tab 的 SQL/结果/session。变更：`App.saveConnection` 新建分支删除改绑 tab、清空 runs/tableMetas/pending/undo/noPk、关闭旧 session、自动打开 browse session 的逻辑；保存后仅提示「双击连接打开对象树，右击查询创建标签」。涉及 `src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中手工验收。遗留：新建连接暂不自动展开左侧树，需要用户双击；既有 `e2e:sqlite` 未覆盖「新建连接不影响当前 tab」。
- **W-20261109-33 M01-10 连接导入导出命名实例与去重**：诉求是补上 MSSQL 命名实例往返和重复导入去重。变更：`connection-export.ts` 的 mssql 分支保留合法 `instanceName`（非法值丢弃）；`server-identity.ts` 新增 `connectionProfileKey`（服务器 key + 名称）；`ipc-contract.ts` 的导入结果增加 `duplicates`；`router.ts` 导入前读取现有连接并按 key 跳过重复，导入提示包含跳过数量。涉及 `src/shared/connection-export.ts`、`src/shared/server-identity.ts`、`src/shared/ipc-contract.ts`、`src/main/ipc/router.ts`、`src/renderer/src/App.tsx`、`scripts/test-connection-export.mjs`。验证：`npm run typecheck`、`npm run test:connection-export`、`npm run build` 通过。遗留：去重策略目前固定「跳过」，没有覆盖/新建选项；未在真实 Electron 中手工导入验证。
- **W-20261109-34 H-03 断开连接同时关闭 browse session**：诉求是让「断开连接」同时关闭左侧对象树的独立 browse session。变更：`disconnectConnection` 在关闭 tab session 前先关闭 `browse-<connectionId>`、清 `browseConnectionId` 与按 session 的缓存；提示区分「已断开连接与对象树」。涉及 `src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中点击验收。遗留：没有专门的单元测试；对象树折叠状态仍由 UI 自行处理。
- **W-20261109-35 H-07 标签自定义名称持久化**：诉求是重命名标签后重启仍保留名称。变更：`DraftPayload` 的标签项增加 `customTitle`，`persistDraftTabs` 保存、`loadDraftTabs` 恢复，均限制 80 字符；`renameTab` 同步截断。涉及 `src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未做重启手工验收。遗留：草稿恢复仍只覆盖 SQL 标签，不恢复 session/结果。
- **W-20261109-36 H-10 单标签关闭行为**：诉求是避免只剩一个 SQL 标签时「关闭」静默无反应。变更：`Workspace` 标签右键「关闭」在仅剩一个 SQL 标签时置灰；`App.closeTab` 被直接调用时提示「至少保留一个 SQL 标签」。涉及 `src/renderer/src/App.tsx`、`src/renderer/src/components/Workspace.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中点击验收。遗留：未改变「关闭后自动新建空标签」的备选交互。
- **W-20261109-37 H-01 MSSQL 加载全部导出**：诉求是去掉 MSSQL「加载全部」的旧 guard。变更：删除 `loadAllForExport` 中 `connection.input.type === 'mssql'` 直接返回「MSSQL 驱动尚未接入」的分支，统一走 `query.execute({ maxRows: 10000 })` 与现有截断提示。涉及 `src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 MSSQL 实例上点导出。遗留：`e2e:mssql` 未补导出断言；超过 1 万行仍截断。
- **W-20261109-38 H-05 关闭标签先取消查询**：诉求是关闭正在执行查询的标签时先取消服务端查询。变更：`cancelQueryForTab` 增加 `silent` 参数；`closeTab` 在关闭 session 前 `await` 取消；`closeTabsByIds` 批量关闭时逐个取消；取消失败不阻塞关闭。涉及 `src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未用 MySQL `SLEEP` 做真机验证。遗留：主进程 `MysqlSession.close()` 仍是 `connection.end()`，取消依赖关闭前的 `query.cancel`；SQLite 取消仍会终止 Worker。
- **W-20261109-39 H-11 清理死文件**：诉求是移除无引用 shim 与临时探针脚本。变更：确认 `AgentJobsDialog.tsx` 无引用后删除；当前工作区未发现 `scripts/tmp-probe-*.mjs`。涉及 `src/renderer/src/components/AgentJobsDialog.tsx`（删除）。验证：`npm run typecheck`、`npm run build` 通过。遗留：无。
- **W-20261109-40 H-06 补齐历史来源**：诉求是让表数据浏览和导出重查在历史里显示真实来源，而不是一律「编辑器」。变更：`QuerySource` 增加 `table-page` / `export`，同步 zod、history-store、历史弹窗/详情标签；`runQuery` 对 `tab.table` 的内部查询自动用 `table-page`，导出重查用 `export`。涉及 `src/shared/ipc-contract.ts`、`src/main/ipc/schemas.ts`、`src/main/storage/history-store.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/components/HistoryDialog.tsx`、`HistoryDetailDialog.tsx`。验证：`npm run typecheck`、`npm run test:history`、`npm run test:sql-mask`、`npm run build` 通过。遗留：内部表数据查询仍会写历史（只改来源，没有做「不记录」策略）；未做真机点击验收。
- **W-20261109-41 功能表状态同步（H 组收口）**：诉求是把已完成的 H 组修复同步回功能表与模型文档。变更：M02-15 说明改为自定义标签名已持久化；X-10 改为 ✅；统计更新为 `✅88 / 🟡21 / ❌47 / ⏸8`；模型 §2.1 结论、连接导入/导出、断开 browse、标签自定义名、§4.1 建议顺序同步；H-01～H-11 均标记已修复。涉及 `prd/FEATURE_MATRIX.md`、`prd/PROJECT_MASTER.md`。验证：脚本按表格行统计，结果与 §0/§12 一致。遗留：H 组已收口，K/R/C 组仍有大量未完成项。
- **W-20261109-42 M05-01 表数据分页补 1000**：诉求是支持 50/200/500/1000 四档分页。变更：`Workspace.tsx` 每页下拉增加 1000；`type` 仍为 number，无需改协议。涉及 `src/renderer/src/components/Workspace.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中切到 1000 行验收。遗留：分页 SQL 与后端未变；未补 E2E。
- **W-20261109-43 M02-17 超长 SQL 保护**：诉求是 >1MB SQL 执行前给出明确提示。变更：`runQuery` 在空 SQL 检查后增加 `sql.length > 1_000_000` 拦截，提示拆分语句或保存为 `.sql` 文件。涉及 `src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未构造 1MB SQL 做真机验证。遗留：编辑器格式化/补全仍未对超长 SQL 做降级。
- **W-20261109-44 M06-12 导出敏感数据提示**：诉求是导出前提示文件包含完整数据及敏感数据风险。变更：`ExportDialog` 顶部增加固定提示「导出文件将包含完整查询结果；如包含密码、令牌或个人数据，请妥善保管并在必要时脱敏」。涉及 `src/renderer/src/components/ExportDialog.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未真机点击。遗留：提示只是文本，没有按内容检测敏感列。
- **W-20261109-45 M06-10 CSV 导出选项**：诉求是支持 CSV 分隔符、表头开关和 NULL `\N` 标记。变更：`toCsv` 增加 `CsvOptions`（delimiter/header/nullMarker），按分隔符正确引用；导出弹窗增加逗号/分号/Tab、包含表头、NULL 空字段/`\N` 选项；`test-export` 增加选项用例。涉及 `src/shared/export/formats.ts`、`src/renderer/src/components/ExportDialog.tsx`、`scripts/test-export.mjs`。验证：`npm run typecheck`、`npm run test:export`、`npm run build` 通过。遗留：CSV 公式注入防护仍未做；未真机点击。
- **W-20261109-46 M08-08 Agent 30 秒自动刷新**：诉求是作业树与详情页定期刷新。变更：`Sidebar` 在作业树展开时每 30 秒调用 `onLoadAgentJobs`（用 ref 避免定时器被频繁重建）；`AgentJobDetailView` 每 30 秒重新加载当前作业详情。涉及 `src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/components/AgentTabPanel.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未用真实 MSSQL Agent 观察 30 秒刷新。遗留：自动刷新未做开关；作业树无显式手动刷新按钮的问题仍在（M08-02）。
- **W-20261109-47 M08-02 Agent 手动刷新**：诉求是补上作业列表/详情的手动刷新入口。变更：对象树顶部刷新按钮在 MSSQL 连接下同时调用 `loadAgentJobs`；作业详情工具栏增加「刷新」按钮。涉及 `src/renderer/src/App.tsx`、`src/renderer/src/components/AgentTabPanel.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 MSSQL Agent 上点击。遗留：作业行本身仍没有独立刷新按钮；UI 清单只标「进行中」。
- **W-20261109-48 M03-10 历史加载更多**：诉求是历史列表支持分页/加载更多。变更：`HistoryDialog` 增加 `limit` 状态（默认 200），查询带上 limit；底部在满页且未到 1000 时显示「加载更多」，每次 +200；说明文案显示当前上限。涉及 `src/renderer/src/components/HistoryDialog.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未真机点击。遗留：仍是「增大 limit 重查」，不是真正的 offset 分页；超过 1000 条无法继续加载。
- **W-20261109-49 M01-07 跨库对象搜索**：诉求是搜索不再只覆盖当前库。变更：`ObjectTree` 在搜索词非空时展示所有数据库，并按需调用 `onLoadDatabase` 加载未缓存库；`Sidebar` 增加 `onLoadBrowseDatabase`，搜索时保留 browse 连接以便加载；`App` 用 browse session 调用 `loadDatabaseObjects`。涉及 `src/renderer/src/components/ObjectTree.tsx`、`Sidebar.tsx`、`src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未用真实多库实例搜索验收。遗留：搜索会一次性加载所有数据库对象，大库可能较慢；没有服务端搜索。
- **W-20261109-50 M02-03 光标所在语句执行**：诉求是未选中时只执行光标所在语句。变更：`sql-script.ts` 新增 `statementAtCursor`（复用 `splitSqlStatements`，按顺序定位原始区间，语句间空白优先取前一条）；`SqlEditor` Ctrl/Cmd+Enter 在无选区时调用它，定位失败回退全文；`test-sql-script` 增加 SQLite/MSSQL GO 光标用例。涉及 `src/renderer/src/utils/sql-script.ts`、`src/renderer/src/features/editor/SqlEditor.tsx`、`scripts/test-sql-script.mjs`。验证：`npm run typecheck`、`npm run test:sql-script`、`npm run build` 通过。遗留：重复语句/注释中包含相同文本时按 `indexOf` 定位可能偏移，后续可改为区间切分器。
- **W-20261109-51 K-09 DDL/刷新后清表子对象缓存**：诉求是 DDL 或手动刷新后重新展开表能看到最新约束/触发器/索引。变更：`executeDdlScript` 成功后清空当前 tab 的 `tableExtrasByTab`；`refreshSchema` 清当前 tab、`refreshBrowseSchema` 清 browse session 的缓存。涉及 `src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中执行 DDL 后展开表验收。遗留：大库分级加载仍未实现。
- **W-20261109-52 R-06/M04-23 MSSQL 会话 SET**：诉求是让 DDL/索引行为与 SSMS 默认会话选项一致。变更：`MssqlSession.create` 连接成功后执行 `SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;`，失败不阻塞连接。涉及 `src/main/services/mssql/MssqlSession.ts`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 SQL Server 上跑 DDL 回归。遗留：未逐会话验证设置值；`SET` 失败被静默忽略。
- **W-20261109-53 M03-09 历史导出 SQL/CSV**：诉求是历史记录支持 `.sql` 与 `.csv` 导出。变更：新增 `shared/history-export.ts`（SQL 带来源注释、CSV 含时间/方言/连接/库/状态/来源/行数/耗时/SQL）；历史弹窗增加 JSON/SQL/CSV 三个导出按钮；`test-export` 增加历史导出用例。涉及 `src/shared/history-export.ts`、`src/renderer/src/components/HistoryDialog.tsx`、`scripts/test-export.mjs`。验证：`npm run typecheck`、`npm run test:export`、`npm run build` 通过。遗留：CSV 仍可能包含敏感 SQL，依赖用户确认；未真机点击。
- **W-20261109-54 M02-14 SQL 文件新建/另存为/最近/拖入**：诉求是补齐 SQL 文件操作。变更：新增 `file:read-sql` IPC（契约/zod/router/preload）；`App.openSqlFile(path?)` 支持直接读路径；新增 `newSqlFile`、`saveSqlFile(forceDialog)`；最近文件存 `localStorage`（最多 10 个）并在工作区提供下拉；窗口级 `dragover/drop` 打开 `.sql`/`.txt`；工作区增加「新建 SQL」「另存为」按钮。涉及 `src/shared/ipc-contract.ts`、`src/main/ipc/schemas.ts`、`src/main/ipc/router.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/components/Workspace.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未真机拖入/点击最近文件。遗留：最近文件只存路径，不校验文件是否仍存在；拖入只接受第一个文件。
- **W-20261109-55 M02-06 驱动消息采集**：诉求是把 MSSQL `PRINT`/`RAISERROR` 与 MySQL/MariaDB warning 显示到结果区。变更：`QueryResult` 增加 `messages`；MSSQL `execOn` 监听 connection 的 `infoMessage` 并随查询返回；MySQL/MariaDB 查询后读取 `SHOW WARNINGS`；`RunState` 增加 `messages`，Workspace 在结果区显示驱动消息。涉及 `src/shared/ipc-contract.ts`、`src/main/services/mssql/MssqlSession.ts`、`src/main/services/mysql/MysqlSession.ts`、`src/main/services/mariadb/MariaSession.ts`、`src/renderer/src/types.ts`、`src/renderer/src/components/Workspace.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 MSSQL/MySQL 上验证 PRINT/RAISERROR/warning。遗留：仍不是驱动级多结果集，多语句继续逐条 IPC；`SHOW WARNINGS` 每查询多一次往返；驱动消息未进入脚本消息面板，只在结果区顶部显示。
- **W-20261109-56 M04-10/R-07 库级 DDL 覆盖存储过程**：诉求是库级 DDL 不再跳过存储过程。变更：`DdlObjectKind` 增加 `procedure`；MSSQL `getDdl` 对 `V`/`P` 都读 `sys.sql_modules`；MySQL/MariaDB 对 procedure 用 `SHOW CREATE PROCEDURE`；SQLite 明确报不支持；库级 DDL 循环不再跳过 procedure。涉及 `src/shared/ipc-contract.ts`、`src/main/services/mssql/MssqlSession.ts`、`src/main/services/mysql/MysqlSession.ts`、`src/main/services/mariadb/MariaSession.ts`、`src/main/services/sqlite/SqliteSession.ts`、`src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实实例生成库级脚本。遗留：MSSQL 存储过程定义可能依赖 `SET ANSI_NULLS` 等上下文；未补真机回归。
- **W-20261109-57 M07-02 跟随系统主题**：诉求是主题可跟随系统。变更：`AppSettings.theme` 增加 `system`；设置归一化允许 system；设置面板增加「跟随系统」；App 监听 `prefers-color-scheme` 计算有效主题并设置 `data-theme`，RevoGrid 使用有效主题。涉及 `src/shared/ipc-contract.ts`、`src/shared/settings.ts`、`src/renderer/src/components/SettingsDialog.tsx`、`src/renderer/src/App.tsx`。验证：`npm run typecheck`、`npm run test:settings`、`npm run build` 通过；未在真实 Electron 中切换系统主题验收。遗留：主题切换只影响 CSS 与网格，窗口原生主题未处理。
- **W-20261109-58 M02-11 补全增强**：诉求是补版本感知、类型提示和 `SELECT *` 展开。变更：`completionItems` 按连接版本过滤 `WITH/OVER/PARTITION/RETURNING`；列补全加载时记录 `declaredType`，补全弹层右侧显示类型；`SELECT *` 后手动补全展开当前表/别名列；`SqlEditor`/`Workspace` 增加 `completionDetails`。涉及 `src/renderer/src/App.tsx`、`src/renderer/src/features/editor/SqlEditor.tsx`、`src/renderer/src/components/Workspace.tsx`、`src/renderer/src/styles.css`。验证：`npm run typecheck`、`npm run build` 通过；未真机点击补全。遗留：SQLite ATTACH 库内对象和 MySQL 跨库列仍未做；版本过滤只按主/次版本粗筛。
- **W-20261109-59 M03-11 INSERT 值脱敏**：诉求是历史脱敏覆盖 INSERT 列值。变更：`maskSensitiveSql` 改为 token 替换模型，覆盖赋值型与 `INSERT INTO t(cols) VALUES (...)`（含多行值）；只有敏感列对应的字符串/数字值替换为 `'***'`；`test-sql-mask` 增加单行/多行/非敏感 INSERT 用例。涉及 `src/renderer/src/utils/sql-mask.ts`、`scripts/test-sql-mask.mjs`。验证：`npm run typecheck`、`npm run test:sql-mask`、`npm run build` 通过。遗留：嵌套函数、JSON 文本中的密钥仍不识别。
- **W-20261109-60 文档目录 doc → prd**：诉求是把文档目录改名为 `prd/`。变更：`git mv doc prd`；更新 `README.md`、`AGENTS.md` 与四份文档中的 `prd/` 路径引用及历史记录中的目录文字。涉及 `prd/PRD.md`、`prd/FEATURE_MATRIX.md`、`prd/TECH_DESIGN.md`、`prd/PROJECT_MASTER.md`、`README.md`、`AGENTS.md`。验证：`grep` 无残留 `doc/` 路径；纯文档改动，未运行构建/测试。遗留：Git 历史中的旧路径仍为 `doc/`。
- **W-20261109-61 M02-18 当前行高亮**：诉求是编辑器显示当前行。变更：`SqlEditor` 跟踪光标行与滚动位置，按计算出的行高在文本层下方渲染 `.sql-current-line`；光标移动/输入/滚动时更新。涉及 `src/renderer/src/features/editor/SqlEditor.tsx`、`src/renderer/src/styles.css`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中检查对齐。遗留：错误波浪线与代码折叠未做；当前行高亮未覆盖 IME 组合态。
- **W-20261109-62 M02-20 快捷键自定义**：诉求是允许自定义并检测冲突。变更：`AppSettings.shortcuts` 增加执行/补全/格式化/保存/历史五个快捷键；`shared/settings` 默认值与归一化；新增 `shortcuts.ts`（规范化、匹配）；`SqlEditor` 与历史全局快捷键改用映射；设置面板可编辑，保存前规范化并阻止重复。涉及 `src/shared/ipc-contract.ts`、`src/shared/settings.ts`、`src/renderer/src/utils/shortcuts.ts`、`src/renderer/src/features/editor/SqlEditor.tsx`、`src/renderer/src/components/Workspace.tsx`、`src/renderer/src/components/SettingsDialog.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`scripts/test-settings.mjs`。验证：`npm run typecheck`、`npm run test:settings`、`npm run build` 通过；未真机改键验收。遗留：只覆盖五个主要动作；Esc/取消、F2/Delete 等仍固定。
- **W-20261109-63 M04-12 DDL 事务能力标注**：诉求是统一标注 DDL 预览的方言事务能力。变更：`ddl.ts` 新增 `ddlTransactionHint`；TableDesignTab、Add/DropColumn、TableAction、Index、AlterColumn、CreateView 预览统一显示说明（SQLite 可回滚、MSSQL 多数可事务、MySQL 系隐式提交）。涉及 `src/shared/dialect/ddl.ts` 与 7 个预览组件。验证：`npm run typecheck`、`npm run build` 通过；未真机逐个弹窗检查。遗留：提示是静态文案，未根据具体语句判断事务能力。
- **W-20261109-64 M04-07 MSSQL 表注释编辑**：诉求是 MSSQL 表注释也能在 UI 编辑。变更：`buildTableComment('mssql', ...)` 生成 `sp_addextendedproperty` / `sp_updateextendedproperty` / `sp_dropextendedproperty` 条件脚本，支持 `schema.table` 与引号转义；表结构弹窗头部文案改为注释可直接编辑；`test-ddl` 增加 MSSQL 注释用例。涉及 `src/shared/dialect/ddl.ts`、`src/renderer/src/components/TableStructureDialog.tsx`、`scripts/test-ddl.mjs`。验证：`npm run typecheck`、`npm run test:ddl`、`npm run build` 通过；未在真实 SQL Server 上验证扩展属性。遗留：SQLite 本身没有表注释；MSSQL 扩展属性依赖当前账号权限。
- **W-20261109-65 M04-05 外键/唯一约束编辑**：诉求是表结构弹窗不再只展示约束。变更：`ddl.ts` 新增 `buildAddForeignKey` / `buildDropForeignKey`（MySQL 系 `DROP FOREIGN KEY`、MSSQL `DROP CONSTRAINT`、SQLite 明确要求重建）；`TableStructureDialog` 增加外键表单（列/引用表/引用列/ON DELETE/ON UPDATE）与唯一索引表单、删除按钮；新增约束表单样式；`test-ddl` 增加外键用例。涉及 `src/shared/dialect/ddl.ts`、`src/renderer/src/components/TableStructureDialog.tsx`、`src/renderer/src/styles.css`、`scripts/test-ddl.mjs`。验证：`npm run typecheck`、`npm run test:ddl`、`npm run build` 通过；未在真实 MySQL/MSSQL 上执行。遗留：主键仍只读；SQLite 外键增删仍需重建，UI 只提示；唯一约束以唯一索引实现。
- **W-20261109-66 M04-11 可编辑 DDL 预览**：诉求是表设计预览可编辑并恢复默认。变更：`TableDesignTab` 增加 `editedSql` 状态，预览 textarea 可编辑；执行时按方言用 `splitSqlStatements` 重新分句；提供「恢复为 UI 生成结果」。涉及 `src/renderer/src/components/TableDesignTab.tsx`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中编辑预览执行。遗留：其他小型 DDL 弹窗仍未全部开放编辑。
- **W-20261109-67 M04-06 CHECK 约束编辑**：诉求是表结构弹窗可增删 CHECK。变更：`ddl.ts` 新增 `buildAddCheck` / `buildDropCheck`（MySQL `DROP CHECK`、MariaDB/MSSQL `DROP CONSTRAINT`、SQLite 明确要求重建）；`TableStructureDialog` 增加 CHECK 表单与删除按钮；`test-ddl` 增加用例。涉及 `src/shared/dialect/ddl.ts`、`src/renderer/src/components/TableStructureDialog.tsx`、`scripts/test-ddl.mjs`。验证：`npm run typecheck`、`npm run test:ddl`、`npm run build` 通过；未在真实 MySQL/MSSQL 上执行。遗留：SQLite CHECK 增删仍需重建；无编辑（只能删后重加）。
- **W-20261109-68 M04-18 阻止不安全 SQLite 重建**：诉求是识别 `WITHOUT ROWID`/STRICT/生成列并阻止重建。变更：`TableDetail` 增加 `tableSql`，SQLite `getTableDetail` 返回原始 `CREATE TABLE`；`buildSqliteRebuild`/`buildSqliteRebuildTable` 检测到这些结构时返回明确错误；`test-sqlite-rebuild` 增加三类阻止用例。涉及 `src/shared/ipc-contract.ts`、`src/main/services/sqlite/SqliteSession.ts`、`src/shared/dialect/sqlite-rebuild.ts`、`scripts/test-sqlite-rebuild.mjs`。验证：`npm run typecheck`、`npm run test:sqlite-rebuild`、`npm run build` 通过。遗留：只做阻止，不提供手工重建向导；正则可能对包含 `AS (` 的复杂默认值误判。
- **W-20261109-69 M04-16 SQLite 重建保留外键/CHECK**：诉求是重建表时不再丢外键和 CHECK。变更：`injectSqliteConstraints` 把 `detail.foreignKeys` 与 `detail.checks` 注入新 `CREATE TABLE`；两个重建入口都调用；警告改为「外键/CHECK 已保留，触发器/视图/注释不保留」；`test-sqlite-rebuild` 增加保留断言。涉及 `src/shared/dialect/sqlite-rebuild.ts`、`scripts/test-sqlite-rebuild.mjs`。验证：`npm run typecheck`、`npm run test:sqlite-rebuild` 通过；未做真实 SQLite 回放外键/CHECK。遗留：触发器、视图仍不保留；外键表名未处理 schema 前缀。
- **W-20261109-70 M04-08 触发器管理**：诉求是触发器不再只读展示。变更：`TableDetail` 增加 `triggers`；SQLite/MySQL/MariaDB/MSSQL `getTableDetail` 返回触发器列表；`ddl.ts` 新增 `buildDropTrigger`；表结构弹窗增加触发器列表、删除按钮和「在编辑器中新建触发器」模板；`test-ddl` 增加 drop trigger 用例。涉及 `src/shared/ipc-contract.ts`、四个 Session、`src/shared/dialect/ddl.ts`、`src/renderer/src/components/TableStructureDialog.tsx`、`src/renderer/src/App.tsx`、`scripts/test-ddl.mjs`。验证：`npm run typecheck`、`npm run test:ddl`、`npm run build` 通过；未在真实实例上创建/删除触发器。遗留：新建触发器只提供模板，不做表单；触发器定义源文本未展示。
- **W-20261109-71 M04-17 SQLite 维护遮罩/进度/取消**：诉求是 DDL 期间有可见维护状态与取消入口。变更：`executeDdlScript` 对 SQLite 设置 `maintenance` 状态；App 渲染阻塞式维护弹窗、不确定进度条和已运行秒数；取消调用 `closeTabSession` 终止 Worker 并提示重连。涉及 `src/renderer/src/App.tsx`、`src/renderer/src/styles.css`。验证：`npm run typecheck`、`npm run build` 通过；未在真实 Electron 中执行长 DDL/取消。遗留：这是应用级遮罩，不是数据库级维护锁；进度是不确定进度，没有真实语句级进度。
- **W-20261109-72 M04-19 列顺序调整**：诉求是表设计支持调整列顺序。变更：`TableDesignTab` 增加上移/下移按钮；`buildModifyColumn` 支持 `FIRST`/`AFTER`；`buildTableDesign` 检测已有列顺序变化，SQLite 走重建、MySQL/MariaDB 生成逐列 `MODIFY COLUMN`，MSSQL 明确提示用 SQL；`test-ddl` 增加 MySQL/SQLite 顺序用例。涉及 `src/renderer/src/components/TableDesignTab.tsx`、`src/shared/dialect/ddl.ts`、`src/shared/dialect/table-diff.ts`、`scripts/test-ddl.mjs`。验证：`npm run test:ddl`、`npm run typecheck`、`npm run build` 通过；未在真实 MySQL/SQLite 上执行。遗留：MSSQL 不支持；顺序调整不能与其他列变更合并保存；包含主键/自增列的 MySQL 顺序调整会被拒绝。

---

## 7. 附录：旧文档合并映射

| 原文档 | 合并后位置 | 说明 |
|---|---|---|
| `prd/README.md` | §1 | 文档地图、权威边界、阅读顺序、维护规则 |
| `prd/CONNECTION_TAB_MODEL.md` | §2 | 模型结论、代码事实、术语、隐藏需求、目标模型、Q21～Q28、AC |
| `prd/PROJECT_STATUS.md` | §3 | 可运行链路、模块完成度、决策、模块差距、缺陷、测试/验收、DDL、日志、里程碑、交付快照 |
| `prd/UNFINISHED_ITEMS.md` | §4 | H/K/R/C 分组、证据、建议顺序、验收门槛 |
| `prd/UI_TODO.md` | §5 | UI 逐项清单、状态标记、真机验收记录 |
| `prd/WORKLOG.md` | §6 | 追加式变更流水（W-20261106-01 ～ W-20261109-28） |

> 文件已删除，内容以上表位置为准；Git 历史仍可追溯原文。
