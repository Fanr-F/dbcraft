import { z } from 'zod';
import type { ConnectionInput } from '../../shared/ipc-contract';

const common = z.object({
  name: z.string().trim().min(1).max(80),
  group: z.string().trim().max(120),
  env: z.enum(['dev', 'test', 'prod']),
});

const serverFields = {
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(128),
  password: z.string().max(1024),
  database: z.string().trim().max(128),
};

const sqliteSchema = common.extend({
  type: z.literal('sqlite'),
  filePath: z.string().trim().min(1),
});

const mysqlFamilySchema = common.extend({
  type: z.enum(['mysql', 'percona', 'mariadb']),
  ...serverFields,
  sslMode: z.enum(['disable', 'prefer', 'require', 'verify-ca', 'verify-full']),
  charset: z
    .string()
    .trim()
    .max(32)
    .regex(/^[A-Za-z0-9_-]*$/, '字符集只能包含字母、数字、下划线和连字符')
    .optional(),
});

const mssqlSchema = common.extend({
  type: z.literal('mssql'),
  ...serverFields,
  encrypt: z.boolean(),
  trustServerCertificate: z.boolean(),
  instanceName: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_$#-]*$/, '实例名只能包含字母、数字、下划线、$、# 和连字符')
    .optional(),
});

export const connectionInputSchema: z.ZodType<ConnectionInput> = z.discriminatedUnion('type', [
  sqliteSchema,
  mysqlFamilySchema,
  mssqlSchema,
]);

export const connectionTestSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  input: connectionInputSchema,
});

export const connectionSaveSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  input: connectionInputSchema,
  rememberPassword: z.boolean().optional(),
});

export const connectionOpenSchema = z.object({
  sessionId: z.string().min(1).max(128),
  connectionId: z.string().min(1).max(128),
});

export const queryExecuteSchema = z.object({
  requestId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  sql: z.string().trim().min(1).max(1_000_000),
  params: z
    .array(z.union([z.string().max(100_000), z.number().finite(), z.boolean(), z.null()]))
    .max(10_000)
    .optional(),
  maxRows: z.number().int().min(0).max(10_000).optional(),
  timeoutMs: z.number().int().min(0).max(600_000).optional(),
  connectionId: z.string().max(128).optional(),
  connectionName: z.string().max(120).optional(),
  dialect: z.enum(['sqlite', 'mysql', 'percona', 'mariadb', 'mssql']).optional(),
  database: z.string().max(128).optional(),
  source: z.enum(['editor', 'ddl-preview', 'grid-edit', 'agent-control', 'table-page', 'export']).optional(),
});

export const queryExecuteScriptSchema = z.object({
  requestId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  statements: z.array(z.string().trim().min(1).max(1_000_000)).min(1).max(50),
  maxRows: z.number().int().min(0).max(10_000).optional(),
  timeoutMs: z.number().int().min(0).max(600_000).optional(),
  connectionId: z.string().max(128).optional(),
  connectionName: z.string().max(120).optional(),
  dialect: z.enum(['sqlite', 'mysql', 'percona', 'mariadb', 'mssql']).optional(),
  database: z.string().max(128).optional(),
  source: z.enum(['editor', 'ddl-preview', 'grid-edit', 'agent-control', 'table-page', 'export']).optional(),
});

export const historyListSchema = z.object({
  query: z.string().max(1000).optional().default(''),
  dialect: z.enum(['sqlite', 'mysql', 'percona', 'mariadb', 'mssql']).optional(),
  status: z.enum(['success', 'failed', 'cancelled']).optional(),
  source: z.enum(['editor', 'ddl-preview', 'grid-edit', 'agent-control', 'table-page', 'export']).optional(),
  connectionId: z.string().max(128).optional(),
  databaseName: z.string().max(128).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  sortBy: z.enum(['time', 'duration']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(1000).optional().default(200),
});

export const schemaGetSchema = z.object({
  sessionId: z.string().min(1).max(128),
  includeSystemObjects: z.boolean().optional().default(false),
  database: z.string().min(1).max(256).optional(),
});

export const schemaDatabasesSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export const schemaUseDatabaseSchema = z.object({
  sessionId: z.string().min(1).max(128),
  database: z.string().min(1).max(256),
});

export const schemaTableExtrasSchema = z.object({
  sessionId: z.string().min(1).max(128),
  database: z.string().min(1).max(256),
  table: z.string().min(1).max(256),
});

export const ddlGetSchema = z.object({
  sessionId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  kind: z.enum(['table', 'view']),
});

export const schemaTableSchema = z.object({
  sessionId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  kind: z.enum(['table', 'view']),
});

export const schemaDescribeSchema = z.object({
  sessionId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
});

const tableCellSchema = z.union([
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const tableValueMap = z.record(z.string().min(1).max(256), tableCellSchema);

const tableEditSchema = z.object({
  kind: z.enum(['update', 'insert', 'delete']),
  keys: tableValueMap.optional(),
  values: tableValueMap.optional(),
  original: tableValueMap.optional(),
});

export const tableApplySchema = z.object({
  requestId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  table: z.string().min(1).max(256),
  edits: z.array(tableEditSchema).min(1).max(1000),
  allowNoPrimaryKeyInsert: z.boolean().optional(),
  connectionId: z.string().max(128).optional(),
  connectionName: z.string().max(120).optional(),
  database: z.string().max(128).optional(),
});

export const ddlExecuteSchema = z.object({  sessionId: z.string().min(1).max(128),
  statements: z.array(z.string().max(100_000)).min(1).max(50),
  options: z
    .object({
      sqliteForeignKeysOff: z.boolean().optional(),
      connectionId: z.string().max(128).optional(),
      connectionName: z.string().max(120).optional(),
      database: z.string().max(128).optional(),
    })
    .optional(),
});

export const agentListSchema = z.object({
  sessionId: z.string().min(1).max(128),
  search: z.string().max(200).optional().default(''),
});

export const agentDetailSchema = z.object({
  sessionId: z.string().min(1).max(128),
  jobName: z.string().trim().min(1).max(256),
  historyLimit: z.union([z.literal(100), z.literal(500)]).optional(),
});

export const agentActionSchema = z.object({
  sessionId: z.string().min(1).max(128),
  jobName: z.string().trim().min(1).max(256),
  action: z.enum(['start', 'stop', 'enable', 'disable']),
  connectionId: z.string().max(128).optional(),
  connectionName: z.string().max(120).optional(),
  database: z.string().max(128).optional(),
});

export const agentScriptSchema = z.object({
  sessionId: z.string().min(1).max(128),
  jobName: z.string().trim().min(1).max(256),
});

export const exportSaveSchema = z.object({
  suggestedName: z.string().trim().min(1).max(120),
  content: z.string().max(50_000_000),
});

const xlsxCellSchema = z.union([
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const exportXlsxSchema = z.object({
  suggestedName: z.string().trim().min(1).max(120),
  columns: z.array(z.string().max(1000)).max(500),
  rows: z.array(z.array(xlsxCellSchema).max(500)).max(100_000),
});

export const settingsSaveSchema = z.object({
  resultRowLimit: z.union([z.literal(0), z.literal(100), z.literal(500), z.literal(1000), z.literal(2000), z.literal(5000)]),
  theme: z.enum(['dark', 'light']),
  editorFontSize: z.union([z.literal(12), z.literal(13), z.literal(14), z.literal(16)]),
  historyRetention: z.union([z.literal(0), z.literal(1000), z.literal(5000), z.literal(10000), z.literal(50000)]),
  queryTimeoutMs: z.union([z.literal(0), z.literal(10000), z.literal(30000), z.literal(60000), z.literal(120000)]),
  connectTimeoutMs: z.union([z.literal(3000), z.literal(5000), z.literal(8000), z.literal(10000), z.literal(30000)]),
  historyEnabled: z.boolean(),
  historyDedupe: z.boolean(),
  historyMask: z.boolean(),
});

export const fileSaveSqlSchema = z.object({
  content: z.string().max(5_000_000),
  path: z.string().max(4096).optional(),
  suggestedName: z.string().trim().min(1).max(200),
});

export const fileReadSqlSchema = z.object({
  path: z.string().min(1).max(4096),
});

export const logWriteSchema = z.object({  level: z.enum(['error', 'warn', 'info', 'debug']),
  scope: z.string().trim().min(1).max(64),
  message: z.string().min(1).max(2000),
  meta: z.string().max(4000).optional(),
});

export function formatConnectionIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.join('.');
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .join('；');
}
