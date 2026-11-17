# SQL 补全路线图（SQL Prompt 参考）

> 定位：补全体验的竞品参考与后续实施计划。不是需求基线；需求取舍仍以 `PRD.md` 和 `PROJECT_MASTER.md` 为准。

## 1. 目的与边界

- Redgate SQL Prompt 是**闭源商业软件**；本文只参考公开文档和交互行为，**不复制代码、资源或词表**。
- 参考范围：补全的候选生成、排序、片段、对象操作与上下文判断。
- 不在本文范围：SQL Prompt 的格式化、代码分析/自动修复、AI 建议、SSMS 集成。
- 目标：让自研补全在「上下文、排序、快捷输入、对象操作」上接近 SQL Prompt 的手感，同时保持 DBCraft 的多方言和「一标签一物理连接」架构。

## 2. 当前基线（截至 W-20261117-13）

| 能力 | 现状 |
|---|---|
| 编辑器内核 | CodeMirror 6 + `@codemirror/lang-sql`，补全源在 `utils/sql-completion.ts` |
| 语句分析 | `utils/sql-analysis.ts`：`node-sql-parser` 按方言懒加载 chunk，解析表/别名/CTE；失败回退扫描 |
| 排序 | 严格前缀 + 匹配层级 + 类型权重 + 子句/qualifier/所属表权重 + `boost` + 去重 |
| 元数据 | `utils/metadata-store.ts`：用户/系统分区、Promise 合并、错误退避、generation 失效、LRU、AST 预取 |
| JOIN | 外键推导目标表、`JOIN ... ON ...` 片段、`ON` 等值条件 |
| 对象 | MSSQL 系统视图/DMV/DMF（`function`）、扩展存储过程（`extended`）、DBCC 子命令/`WITH` 选项 |
| 其他 | 自动别名开关、通配符「展开为 N 列」、大小写跟随、DBCC、CTE/派生表列 |

验证命令：`npm run test:sql-completion`、`npm run test:metadata`、`npm run test:settings`、`npm run typecheck`、`npm run build`；MSSQL 真实实例用 `npm run check:mssql`。

## 3. SQL Prompt 对照

| 能力 | SQL Prompt 体验 | 当前 DBCraft | 计划 |
|---|---|---|---|
| 上下文期望 | FROM 只给表、WHERE 给列、EXEC 给过程、ON 给关联列 | AST + `completionExpectation`，已具备 | 保持 |
| JOIN 补全 | 按 FK 给整段 JOIN/ON，自动别名 | FK 目标 + ON 片段，已具备 | 多列/多表继续打磨 |
| 通配符展开 | `SELECT *` 展开为**带别名**的列 | 有展开项，但按列名去重，多表会丢重复列 | **P0** |
| 候选详情 | 名称、类型、所属表、schema、PK/FK 图标 | 只有类型/FK 描述 | **P1** |
| 排序记忆 | 使用频率 + 收藏 + 最近使用 + 上下文 | 前缀/类型/上下文 + boost | **P1** |
| 代码片段 | `ssf`/`ij` 等短码展开、可自定义 | 无 | P1 |
| 临时表/表变量 | `#t`、`@t TABLE`、`SELECT INTO` 可补列 | 仅 CTE/派生表 | P1 |
| 匹配方式 | 前缀 / 包含 / 驼峰可配 | 严格前缀 + 限定符下按 `_` 词段命中（`sys.sql` / `sys.dm_sql` → `dm_exec_sql_text`） | P2 |
| 重构 | 限定/取消限定、插入/移除别名、重命名 | 自动别名开关 | P2 |
| 元数据速度 | 后台缓存 | MetadataStore + 预取 | 已对齐 |
| AI 建议 | 有 | 无 | 暂不做 |

## 4. 分阶段计划

### Phase A：低成本、立刻提升手感

#### A1. 通配符展开按表限定（P0）

- 目标：`SELECT * FROM users u JOIN orders o` 展开为 `u.id, u.name, ..., o.id, o.user_id, ...`。
- 做法：
  - `App.tsx` 的 `context.wildcard` 分支不再按列名去重，改为按 `${表.列}` 去重；
  - 多表时用 `quoteColumnName` 生成 `alias.column`（无别名时用表名）；
  - 单表保持裸列名；
  - “展开为 N 列”候选继续 `boost: 100` 置顶。
- 验收：新增纯逻辑测试（多表重复列、别名、无限定名）；真实 Electron 手动验收。
- 风险：列数很多时插入文本很长；可设置上限或提示。

#### A2. 候选详情对齐 SQL Prompt

- 目标：候选右侧显示对象来源，而不是只有类型。
- 做法：
  - 列：`int · users · PK`；
  - 表/视图：`dbo · table/view`；
  - function/DMF：`sys · function`；
  - 扩展存储过程：`sys · extended procedure`；
  - 继续放在 `CompletionCandidate.detail`，不引入自定义弹层。
- 验收：`test:sql-completion` 覆盖 detail 字段；手动观察弹层。

#### A3. 匹配方式设置（默认仍严格前缀）

- 新增 `AppSettings.completionMatchMode: 'prefix' | 'contains' | 'camel'`，默认 `prefix`。
- `rankCompletions` 按模式过滤：
  - `prefix`：现有行为；
  - `contains`：子串命中，仍按命中位置分层；
  - `camel`：按单词边界匹配（`cu` → `CustomerName`）。
- 设置面板增加下拉；`test:settings` 覆盖默认/非法值回退。
- 注意：默认不要改回模糊子序列，避免重新引入 `se` → `users` 的噪音。

### Phase B：最像 SQL Prompt 的两项

#### B1. 使用频率排序 + 收藏

- 目标：越用越顺手，常用对象/列自动提前；收藏项永远靠前。
- 存储：元数据库新增 `completion_usage`，不含 SQL 文本：
  ```sql
  CREATE TABLE completion_usage (
    usage_key TEXT PRIMARY KEY,   -- connectionId|database|kind|schema|table|name
    count INTEGER NOT NULL DEFAULT 0,
    last_used INTEGER NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0
  );
  ```
- IPC：`completion:get-usage` / `completion:record-usage`（新增通道需同步 `ipc-contract.ts`、`schemas.ts`、`router.ts`、preload）。
- 排序：`boost += min(count, 20) * 2 + recencyBonus + (favorite ? 100 : 0)`。
- 记录时机：编辑器 `apply` 成功后上报；关闭标签不记。
- 隐私：只存对象名/列名和连接标识，不存 SQL 文本；遵守日志约定。
- 验收：`test:metadata` 或新增 usage store 纯测试；真实 Electron 里连续使用后观察排序。

#### B2. 代码片段

- 内置片段：`ssf` → `SELECT * FROM`、`sst` → `SELECT TOP 10 * FROM`、`ij` → `INNER JOIN ... ON ...`、`cte` → `WITH ... AS (...)`。
- 候选 `kind='snippet'`，`insertText` 支持 CodeMirror snippet 占位符（`${1:table}`）。
- 后续：设置面板/JSON 自定义片段；按方言过滤（MSSQL 的 `TOP`）。
- 验收：`test:sql-completion` 覆盖片段候选与插入；手动验收光标位置。

### Phase C：语义层

#### C1. 临时表 / 表变量 / SELECT INTO

- 解析并加入虚拟表：
  - `CREATE TABLE #t (...)` / `##t`；
  - `DECLARE @t TABLE (...)`；
  - `SELECT ... INTO #t FROM ...`（输出列来自 SELECT 列表）。
- 位置：`sql-analysis.ts` 或 `extractVirtualTables`，保持纯逻辑可测；
- 效果：`FROM #t`、`#t.`、`@t.` 都能补列；
- 风险：临时表可能跨语句创建，先支持当前语句/脚本内可见的定义。

#### C2. 重构动作

- 编辑器右键/命令面板：
  - 插入别名、移除别名；
  - 限定/取消限定列；
  - 重命名对象/别名并更新引用（后续，需要 AST 改写）。
- 与现有自动别名设置、CodeMirror 命令体系结合。

#### C3. 更丰富的候选弹层（可选）

- 如果 CodeMirror 默认弹层不够，再评估自定义渲染：
  - 列：名称、类型、所属表、PK/FK 标记；
  - 表：schema、类型、是否系统对象；
  - 过滤按钮：只看列/表/函数。
- 优先用 `detail`/`info` 实现，避免维护自定义弹层。

## 5. 建议顺序

1. A1 通配符展开（先修正确性）；
2. B1 使用频率 + 收藏（最接近 SQL Prompt 的“顺手”感）；
3. A2 候选详情 + A3 匹配方式；
4. B2 代码片段；
5. C1 临时表/表变量；
6. C2 重构；C3 弹层按需。

## 6. 非目标

- 不复制 SQL Prompt 的闭源代码/资源/词表；
- 不做 SSMS/Visual Studio 插件；
- 不追求格式化、代码分析、AI 建议的对等；
- 不引入连接池或按连接复用 session。

## 7. 相关文档

- `prd/TECH_DESIGN.md` §7.3 补全
- `prd/PROJECT_MASTER.md` §3.4.2 MOD-02、§4.7 建议顺序、§6 变更记录
- `AGENTS.md`：补全/元数据/AST 架构约定
