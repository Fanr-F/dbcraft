import type { QueryError } from './ipc-contract';

/** 常见驱动/SQLite 错误码 → 可读建议。只做解释，不改变原始错误。 */
const CODE_HINTS: Record<string, string> = {
  ER_ACCESS_DENIED_ERROR: '用户名或密码错误，或该账号没有从当前主机连接的权限。',
  ER_ACCESS_DENIED_NO_PASSWORD_ERROR: '该账号需要密码，请检查连接配置。',
  ER_BAD_DB_ERROR: '数据库不存在，请检查数据库名。',
  ER_NO_DB_ERROR: '尚未选择数据库，请在连接配置中填写数据库名。',
  ER_NO_SUCH_TABLE: '表不存在，请刷新对象树后重试。',
  ER_BAD_FIELD_ERROR: '列名不存在，请检查 SQL 中的列名。',
  ER_DUP_ENTRY: '唯一约束冲突：要写入的值已存在。',
  ER_LOCK_WAIT_TIMEOUT: '锁等待超时，请稍后重试，或检查是否有长事务占用。',
  ER_LOCK_DEADLOCK: '检测到死锁，事务已被回滚，请重试。',
  ER_PARSE_ERROR: 'SQL 语法错误，请检查语句拼写与方言。',
  ER_SYNTAX_ERROR: 'SQL 语法错误，请检查语句拼写与方言。',
  ER_NOT_SUPPORTED_AUTH_MODE: '客户端不支持该认证插件；MariaDB 的 ed25519 请使用 MariaDB 连接类型。',
  PROTOCOL_CONNECTION_LOST: '连接已断开，请重新连接。',
  PROTOCOL_SEQUENCE_TIMEOUT: '协议等待超时，请检查网络或服务器负载。',
  ECONNREFUSED: '目标端口拒绝连接，请确认数据库服务已启动且端口正确。',
  ECONNRESET: '连接被重置，请检查网络或服务器会话限制。',
  ETIMEDOUT: '连接超时，请检查网络、防火墙或实例状态。',
  EPIPE: '连接管道已断开，请重新连接。',
  HANDSHAKE_SSL_ERROR: 'TLS 握手失败，请检查 SSL 模式或服务器证书。',
  SQLITE_BUSY: '数据库被占用（锁等待），请稍后重试。',
  SQLITE_LOCKED: '数据库表被锁定，请稍后重试。',
  SQLITE_READONLY: '数据库以只读方式打开，写入被拒绝。',
  SQLITE_CANTOPEN: '无法打开数据库文件，请检查路径与文件权限。',
  SQLITE_CONSTRAINT: '约束冲突（唯一、非空或外键约束）。',
  SQLITE_NOTADB: '文件不是有效的 SQLite 数据库。',
  SQLITE_CORRUPT: '数据库文件已损坏，请从备份恢复。',
  SQLITE_ERROR: 'SQL 执行失败，请检查语句与对象是否存在。',
  QUERY_TIMEOUT: '查询超时被取消；可优化 SQL，或通过 DBCRAFT_QUERY_TIMEOUT_MS 调整超时。',
};

const MESSAGE_HINTS: Array<[RegExp, string]> = [
  [/no such table/i, '表不存在，请刷新对象树后重试。'],
  [/no such column/i, '列名不存在，请检查 SQL 中的列名。'],
  [/no such function/i, '函数不存在或当前方言不支持该函数。'],
  [/syntax error/i, 'SQL 语法错误，请检查语句拼写与方言。'],
  [/database is locked/i, '数据库被占用（锁等待），请稍后重试。'],
  [/readonly database|read-only/i, '数据库为只读，写入被拒绝。'],
  [/unable to open database file/i, '无法打开数据库文件，请检查路径与文件权限。'],
  [/access denied/i, '认证失败：用户名、密码或主机权限不正确。'],
  [/unknown database/i, '数据库不存在，请检查数据库名。'],
  [/econnrefused/i, '目标端口拒绝连接，请确认数据库服务已启动且端口正确。'],
  [/certificate has expired|expired certificate/i, '服务器证书已过期，请更新证书或调整 SSL 模式。'],
  [
    /hostname.*(does not match|mismatch)|does not match.*hostname|certificate.*(altname|subject)/i,
    '证书与主机名不匹配，请使用证书上的主机名，或降低 SSL 校验级别。',
  ],
  [/self.signed|self signed/i, '服务器使用自签名证书；请导入受信任 CA，或仅在可信网络降低 SSL 校验。'],
  [
    /unable to verify the first certificate|unable to get (local )?issuer|unknown ca/i,
    '证书链不完整或 CA 不受信任，请配置服务器证书链或系统信任库。',
  ],
  [/certificate|tls|ssl/i, '证书校验失败，请调整 SSL 模式或信任服务器证书。'],
];

/** 返回一句中文建议；没有匹配时返回 null，不伪造原因。 */
export function explainQueryError(error: Pick<QueryError, 'code' | 'message'>): string | null {
  // SQLITE_ERROR 是通用码，先看具体消息（no such table 等），避免被泛化。
  if (error.code && error.code !== 'SQLITE_ERROR' && CODE_HINTS[error.code]) {
    return CODE_HINTS[error.code];
  }

  const message = error.message ?? '';
  for (const [pattern, hint] of MESSAGE_HINTS) {
    if (pattern.test(message)) return hint;
  }

  if (error.code && CODE_HINTS[error.code]) {
    return CODE_HINTS[error.code];
  }

  return null;
}

/** 连接测试/打开失败等只有文本的场景。 */
export function explainErrorText(message: string): string | null {
  return explainQueryError({ code: null, message });
}
