/**
 * 错误码中文解释的纯逻辑测试。
 *
 * 运行：npm run test:errors
 */
import { explainErrorText, explainQueryError } from '../src/shared/errors.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectHint(code, text, includes) {
  const hint = explainQueryError({ code, message: text });
  assert(hint, `expected hint for ${code} / ${text}`);
  assert(hint.includes(includes), `hint "${hint}" does not include "${includes}"`);
}

expectHint('ER_ACCESS_DENIED_ERROR', 'Access denied for user', '用户名或密码');
expectHint('ER_DUP_ENTRY', 'Duplicate entry', '唯一约束');
expectHint('ER_BAD_DB_ERROR', 'Unknown database', '数据库不存在');
expectHint('SQLITE_BUSY', 'database is locked', '锁等待');
expectHint('SQLITE_READONLY', 'attempt to write a readonly database', '只读');
expectHint('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3306', '拒绝连接');
expectHint('PROTOCOL_CONNECTION_LOST', 'Connection lost', '重新连接');

// 通用 SQLITE_ERROR 应先匹配消息细节。
expectHint('SQLITE_ERROR', 'no such table: users', '表不存在');
expectHint('SQLITE_ERROR', 'no such column: nmae', '列名不存在');
expectHint('SQLITE_ERROR', 'near "SELEC": syntax error', 'SQL 语法错误');

// 只有文本时可映射连接类错误。
const authHint = explainErrorText('Access denied for user root@localhost');
assert(authHint && authHint.includes('认证失败'), 'text auth hint missing');

const sslHint = explainErrorText('self-signed certificate in certificate chain');
assert(sslHint && sslHint.includes('自签名'), 'text TLS self-signed hint missing');

const expiredHint = explainErrorText('certificate has expired');
assert(expiredHint && expiredHint.includes('过期'), 'expired certificate hint missing');

const hostnameHint = explainErrorText(
  'Hostname/IP does not match certificate\'s altnames: Host: db.local',
);
assert(hostnameHint && hostnameHint.includes('主机名'), 'hostname mismatch hint missing');

const chainHint = explainErrorText('unable to verify the first certificate');
assert(chainHint && chainHint.includes('证书链'), 'certificate chain hint missing');

// 不认识时返回 null。
assert(explainQueryError({ code: 'SOMETHING_NEW', message: 'weird failure' }) === null, 'unknown code should be null');
assert(explainErrorText('totally unknown') === null, 'unknown text should be null');

console.log('error hints check passed');
