# @dbcraft/sql-completion

方言感知的 SQL 补全内核：给定 SQL、光标位置和元数据，生成候选列表并排序。
只负责补全本身，不包含编辑器 UI、数据库驱动和元数据缓存。

## 功能

- **上下文识别**：当前语句、光标处的限定符/前缀、所在子句（SELECT/WHERE/FROM/JOIN/ON/EXEC/USE 等）、
  `INSERT INTO t (` 列清单、`SELECT *` 通配符、CTE/派生表列。
- **候选生成**：关键字、函数、表、视图（含 DMV/DMF）、存储过程、列、别名、Schema、数据库、外键 JOIN 片段。
- **排序/匹配**：严格前缀优先；无前缀时回退词首/子序列；支持 `_` 多段匹配
  （`sys.dm_sql`、`sys.sql` → `dm_exec_sql_text`）；按类型、子句、所属表、schema、
  JOIN ON 主键和系统对象加权。
- **方言行为**：MSSQL、MySQL、Percona、MariaDB、SQLite 的大小写、系统对象、限定名和 EXEC 回退差异。
- **补全辅助**：标识符引用、函数签名提示、外键等式、JOIN 目标推荐、自动别名、DBCC 子命令/选项。
- **可注入的语句分析**：宿主可以提供 AST 分析器（如 `node-sql-parser`）；不注入或解析失败时回退内置扫描。
- **可注入的元数据**：通过 `CompletionMetadataProvider` 提供对象/列/外键；包本身不连接数据库。

## 方言支持

| 能力 | MSSQL | MySQL / Percona / MariaDB | SQLite |
|---|---|---|---|
| 系统对象 | `sys` / `INFORMATION_SCHEMA`、`master` | `information_schema` / `mysql` / `performance_schema` / `sys` | `sqlite_*` |
| 限定名 | `db.schema.table` | `db.table` | `db.table`（ATTACH） |
| EXEC 回退 | `master` 系统存储过程 | 无 | 无 |
| 大小写 | 原样 | `lower_case_table_names` | 原样 |

## 使用

```ts
import {
  CompletionService,
  extractCompletionContext,
  type CompletionMetadataProvider,
} from '@dbcraft/sql-completion';

const provider: CompletionMetadataProvider = {
  async loadUserObjects(database) {
    return []; // 用户表/视图/存储过程
  },
  async loadSystemObjects(database) {
    return []; // 没有系统对象概念时返回 []
  },
  async loadColumns(target, qualifiedName) {
    return []; // target: { scope, database, schema, table }
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

需要更准确的表/别名/CTE 推导时，可以注入分析器：

```ts
import type { StatementAnalyzer } from '@dbcraft/sql-completion';

const analyzer: StatementAnalyzer = (statement, dialect) => {
  return null; // 返回 { tables, ctes } 或 null
};

const context = extractCompletionContext(sql, cursor, dialect, analyzer);
```

## 不包含

- 编辑器补全 UI 和插入逻辑；
- 数据库驱动与连接管理；
- 元数据缓存、IPC、错误退避；
- AST 解析器本身（通过 `StatementAnalyzer` 注入）。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run sync:keywords   # 需要先安装 @codemirror/lang-sql
```

方言关键字快照派生自 `@codemirror/lang-sql`（MIT License）。

## License

MIT。
