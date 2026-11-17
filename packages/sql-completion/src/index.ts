/**
 * 方言感知的 SQL 补全内核。
 *
 * 分层：
 * - `core.ts`：与方言无关的上下文扫描、候选生成、排序/匹配、引号、签名、JOIN；
 * - `dialects.ts`：方言策略（系统对象、限定名解析、大小写、EXEC 回退库）；
 * - `provider.ts`：元数据 Provider 接口，由宿主注入；
 * - `engine.ts`：把 context + 方言策略 + provider 组装成候选列表。
 *
 * 包本身不依赖 CodeMirror、数据库驱动或 Electron；AST 分析通过
 * `StatementAnalyzer` 由宿主注入（未注入时回退内置扫描）。
 */
export * from './types.ts';
export * from './core.ts';
export * from './keywords.ts';
export * from './quote.ts';
export * from './dialects.ts';
export * from './provider.ts';
export * from './engine.ts';
