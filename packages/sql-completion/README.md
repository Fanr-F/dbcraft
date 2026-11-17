# @dbcraft/sql-completion

方言感知的 SQL 补全内核，从 DBCraft 中抽出的独立项目。

它负责「给定 SQL、光标位置和元数据，应该给出哪些候选、按什么顺序给」；
不包含编辑器 UI、数据库驱动和缓存实现。CodeMirror、VSCode、CLI 或测试桩
都可以复用它。

## 设计

```text
src/
  types.ts       SqlDialect
  core.ts        上下文扫描、候选模型、排序/匹配、引号、签名、JOIN、DBCC
  keywords.ts    基础关键字 + 各方言关键字/类型快照
  quote.ts       标识符引用
  dialects.ts    方言策略：系统对象、限定名解析、EXEC 回退库、大小写
  provider.ts    元数据 Provider 接口
  engine.ts      CompletionService：context + 方言策略 + provider -> 候选列表
  index.ts       公共入口
```

- **core** 与方言无关；同一套前缀/词段匹配、类型权重、上下文加权。
- **dialects** 只放差异：MSSQL 的 `sys` schema / `master`、MySQL 系统库、
  SQLite `sqlite_*`、两段/三段限定名、`lower_case_table_names` 等。
- **provider** 由宿主注入：包不直接连数据库。缓存、Promise 合并、错误退避
  属于 provider 实现（DBCraft 用 `MetadataStore` + IPC）。
- **engine** 把三者组装起来；它不关心编辑器如何展示和插入。

## 快速开始

```ts
import {
  CompletionService,
  extractCompletionContext,
  type CompletionMetadataProvider,
} from '@dbcraft/sql-completion';

const provider: CompletionMetadataProvider = {
  async loadUserObjects(database) {
    // 返回该库的用户表/视图/存储过程
    return [];
  },
  async loadSystemObjects(database) {
    // 没有系统对象概念时返回 []
    return [];
  },
  async loadColumns(target, qualifiedName) {
    // target: { scope, database, schema, table }
    return [];
  },
  async loadForeignKeys(target, qualifiedName) {
    return [];
  },
};

const service = new CompletionService('mssql', provider);
const sql = 'SELECT * FROM sys.';
const context = extractCompletionContext(sql, sql.length, 'mssql');
const candidates = await service.complete(context, {
  database: 'app',
  databases: ['app', 'master'],
  activeSchema: await provider.loadUserObjects('app'),
  lowerCaseTableNames: 0,
  completionTableAlias: true,
});
```

### 注入 AST 分析（可选）

包本身不依赖 `node-sql-parser`。宿主可以提供 `StatementAnalyzer`，用于更准确
地表引用/别名/CTE 推导；未注入或解析失败时回退内置扫描。

```ts
import type { StatementAnalyzer } from '@dbcraft/sql-completion';

const analyzer: StatementAnalyzer = (statement, dialect) => {
  // 返回 { tables, ctes } 或 null
  return null;
};

const context = extractCompletionContext(sql, cursor, dialect, analyzer);
```

### Provider 约定

- `loadUserObjects` / `loadSystemObjects` 返回**原始对象**；用户/系统过滤由
  方言策略在 engine 里完成，provider 不必重复过滤。
- `loadColumns` 的 `qualifiedName` 是驱动可识别的完整对象名（例如
  `dbo.users`、`db1.users`）；`target` 用于缓存 key。
- `loadForeignKeys` 返回外键列；不支持外键的方言返回空数组。
- 实现方应缓存/合并并发请求；engine 会在 FROM/JOIN 后空闲预取最多 6 张表。

## 方言差异

| 能力 | MSSQL | MySQL / Percona / MariaDB | SQLite |
|---|---|---|---|
| 系统对象 | `sys` / `INFORMATION_SCHEMA`、`master` | `information_schema` / `mysql` / `performance_schema` / `sys` | `sqlite_*` |
| 限定名 | `db.schema.table` | `db.table` | `db.table`（ATTACH） |
| EXEC 回退 | `master` 系统存储过程 | 无 | 无 |
| 大小写 | 原样 | `lower_case_table_names` | 原样 |

系统对象仍然可补全，但默认排在用户对象之后；`FROM/JOIN` 常规输入只给用户对象，
通过 `sys.` / `INFORMATION_SCHEMA.` / `EXEC` 进入系统对象。

## 补全行为摘要

- 严格前缀优先；有前缀命中时过滤子序列噪音。
- 限定符下单段/多段词段匹配：`sys.sql`、`sys.dm_sql` 都能命中
  `dm_exec_sql_text`；真正前缀候选仍排在前面。
- 类型权重：列 > 别名 > 表 > 视图（含 DMV/DMF）> 存储过程 > Schema > 库 >
  函数 > 关键字。
- `JOIN ... ON` 主键加权、外键 JOIN 片段、`SELECT *` 展开、INSERT 列清单、
  CTE/派生表列、DBCC 子命令。
- 限定符补全不截断（`completionResultLimit`），普通位置仍限制 50 条。

## 开发

```bash
npm run typecheck
npm test
npm run sync:keywords   # 需要先安装 @codemirror/lang-sql
```

`src/keywords.ts` 的方言词表派生自 `@codemirror/lang-sql`（MIT License）。
包不依赖 CodeMirror 运行时；升级 CodeMirror 后重新生成即可。

## 不包含

- CodeMirror / VSCode 补全 UI 和插入逻辑；
- 数据库驱动与连接管理；
- 元数据缓存、IPC、错误退避（由 provider 实现）；
- `node-sql-parser`（通过 `StatementAnalyzer` 注入）。

## 从 DBCraft 拆出独立仓库

本包在 DBCraft monorepo 中位于 `packages/sql-completion`。用 subtree 拆出完整
历史并推到独立 GitHub 仓库：

```bash
# 在 DBCraft 仓库根目录
git subtree split --prefix=packages/sql-completion -b sql-completion-standalone

# 新建空仓库后
git remote add completion <your-github-repo>
git push completion sql-completion-standalone:main
```

之后 DBCraft 仍可直接使用 `packages/sql-completion`；独立仓库可以用
`git subtree add/pull` 或普通依赖方式回接。

## License

MIT。关键字快照的原始来源 `@codemirror/lang-sql` 也是 MIT。
