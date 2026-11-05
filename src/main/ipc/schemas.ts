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
});

const mssqlSchema = common.extend({
  type: z.literal('mssql'),
  ...serverFields,
  encrypt: z.boolean(),
  trustServerCertificate: z.boolean(),
});

export const connectionInputSchema: z.ZodType<ConnectionInput> = z.discriminatedUnion('type', [
  sqliteSchema,
  mysqlFamilySchema,
  mssqlSchema,
]);

export const connectionOpenSchema = z.object({
  connectionId: z.string().min(1).max(128),
  config: connectionInputSchema,
});

export const queryExecuteSchema = z.object({
  connectionId: z.string().min(1).max(128),
  sql: z.string().trim().min(1).max(1_000_000),
});

export function formatConnectionIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.join('.');
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .join('；');
}
