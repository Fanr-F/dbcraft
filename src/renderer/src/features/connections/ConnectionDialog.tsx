import { useEffect, useState } from 'react';
import {
  DATABASE_TYPE_HINTS,
  DATABASE_TYPE_LABELS,
  DATABASE_TYPES,
  DEFAULT_PORTS,
  ENVIRONMENT_LABELS,
  SSL_MODE_LABELS,
  type ConnectionInput,
  type ConnectionTestResult,
  type DatabaseType,
  type EnvironmentTag,
  type SslMode,
} from '@shared/ipc-contract';
import { Icon } from '../../components/Icon';
import { explainErrorText } from '@shared/errors';
import { normalizeMssqlAddress } from '@shared/mssql-address';

interface FormState {
  type: DatabaseType;
  name: string;
  group: string;
  env: EnvironmentTag;
  filePath: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sslMode: SslMode;
  charset: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  /** MSSQL 命名实例；填写后忽略端口，走 SQL Browser。 */
  instanceName: string;
}

const INITIAL_FORM: FormState = {
  type: 'mysql',
  name: '',
  group: '',
  env: 'dev',
  filePath: '',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: '',
  database: '',
  sslMode: 'prefer',
  charset: '',
  encrypt: true,
  trustServerCertificate: false,
  instanceName: '',
};

interface ConnectionDialogProps {
  initial?: ConnectionInput;
  editingId?: string;
  passwordStored?: boolean;
  onClose: () => void;
  onSave: (input: ConnectionInput, id?: string) => void;
}

function formFromInput(input: ConnectionInput): FormState {
  const base: FormState = {
    ...INITIAL_FORM,
    type: input.type,
    name: input.name,
    group: input.group,
    env: input.env,
    password: '',
  };

  if (input.type === 'sqlite') {
    return { ...base, filePath: input.filePath };
  }

  if (input.type === 'mssql') {
    return {
      ...base,
      host: input.host,
      port: input.port,
      username: input.username,
      database: input.database,
      encrypt: input.encrypt,
      trustServerCertificate: input.trustServerCertificate,
      instanceName: input.instanceName ?? '',
    };
  }

  return {
    ...base,
    host: input.host,
    port: input.port,
    username: input.username,
    database: input.database,
    sslMode: input.sslMode,
    charset: input.charset ?? '',
  };
}

function buildInput(form: FormState): ConnectionInput {
  const common = {
    name: form.name.trim(),
    group: form.group.trim(),
    env: form.env,
  };

  if (form.type === 'sqlite') {
    return { ...common, type: 'sqlite', filePath: form.filePath.trim() };
  }

  if (form.type === 'mssql') {
    const address = normalizeMssqlAddress(form.host, form.port, form.instanceName);
    return {
      ...common,
      type: 'mssql',
      host: address.host,
      port: address.port,
      username: form.username.trim(),
      password: form.password,
      database: form.database.trim(),
      encrypt: form.encrypt,
      trustServerCertificate: form.trustServerCertificate,
      ...(address.instanceName ? { instanceName: address.instanceName } : {}),
    };
  }

  return {
    ...common,
    type: form.type,
    host: form.host.trim(),
    port: form.port,
    username: form.username.trim(),
    password: form.password,
    database: form.database.trim(),
    sslMode: form.sslMode,
    charset: form.charset.trim(),
  };
}

function validate(form: FormState): string | null {
  if (!form.name.trim()) return '请填写连接名称';
  if (form.type === 'sqlite') {
    return form.filePath.trim() ? null : '请选择 SQLite 数据库文件';
  }
  if (!form.host.trim()) return '请填写主机地址';
  const instance = form.instanceName.trim();
  if (form.type === 'mssql' && instance) {
    if (!/^[A-Za-z0-9_$#-]{1,64}$/.test(instance)) {
      return '实例名只能包含字母、数字、下划线、$、# 和连字符';
    }
  } else if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
    return '端口必须是 1–65535 的整数';
  }
  if (!form.username.trim()) return '请填写用户名';
  if (form.charset.trim() && !/^[A-Za-z0-9_-]+$/.test(form.charset.trim())) {
    return '字符集只能包含字母、数字、下划线和连字符';
  }
  return null;
}

export function ConnectionDialog({
  initial,
  editingId,
  passwordStored = false,
  onClose,
  onSave,
}: ConnectionDialogProps) {
  const editing = Boolean(editingId);
  const [form, setForm] = useState<FormState>(() =>
    initial ? formFromInput(initial) : INITIAL_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setTestResult(null);
  };

  const changeType = (type: DatabaseType) => {
    setError(null);
    setTestResult(null);
    setForm((current) => ({
      ...current,
      type,
      port: DEFAULT_PORTS[type] ?? current.port,
    }));
  };

  const browseSqlite = async () => {
    const api = window.dbcraft;
    if (!api) {
      setError('未检测到 Electron IPC 桥接，无法打开文件选择器。');
      return;
    }
    const filePath = await api.dialog.selectSqliteFile();
    if (!filePath) return;
    setForm((current) => ({
      ...current,
      filePath,
      name:
        current.name ||
        (filePath.split(/[\\/]/).pop() ?? '') ||
        current.name,
    }));
    setError(null);
  };

  const testConnection = async () => {
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }

    // 编辑模式不会把已存密码取回渲染层；此时留空无法完成认证测试。
    if (editing && passwordStored && form.type !== 'sqlite' && !form.password) {
      setError('测试连接需要重新输入密码；保存时可以留空以保持原密码。');
      return;
    }

    setError(null);
    setTestResult(null);
    setTesting(true);

    try {
      const api = window.dbcraft;
      if (!api) {
        setTestResult({
          status: 'failed',
          ok: false,
          message: '未检测到 Electron preload 桥接，当前可能运行在浏览器预览中。',
          elapsedMs: 0,
        });
        return;
      }
      setTestResult(await api.connection.test(buildInput(form)));
    } catch (caught) {
      setTestResult({
        status: 'failed',
        ok: false,
        message: caught instanceof Error ? caught.message : '测试连接失败',
        elapsedMs: 0,
      });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(buildInput(form), editingId);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="connection-dialog-title">{editing ? '编辑连接' : '新建连接'}</h2>
            <p>
              {editing
                ? '修改连接配置；密码留空表示保持原密码。'
                : '选择数据库类型，填写连接信息。'}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <div className="type-grid" role="group" aria-label="数据库类型">
            {DATABASE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`type-card ${form.type === type ? 'is-active' : ''}`}
                onClick={() => changeType(type)}
              >
                <span className={`db-dot db-${type}`} />
                <strong>{DATABASE_TYPE_LABELS[type]}</strong>
                <span>{DATABASE_TYPE_HINTS[type]}</span>
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label className="field">
              <span>连接名称</span>
              <input
                autoFocus
                value={form.name}
                placeholder="例如：本地开发库"
                onChange={(event) => update('name', event.target.value)}
              />
            </label>

            <label className="field">
              <span>分组</span>
              <input
                value={form.group}
                placeholder="可选"
                onChange={(event) => update('group', event.target.value)}
              />
            </label>

            <label className="field">
              <span>环境</span>
              <select
                value={form.env}
                onChange={(event) => update('env', event.target.value as EnvironmentTag)}
              >
                {Object.entries(ENVIRONMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {form.type === 'sqlite' ? (
              <label className="field span-2">
                <span>数据库文件</span>
                <div className="input-row">
                  <input
                    value={form.filePath}
                    placeholder="选择或粘贴 .db / .sqlite 文件路径"
                    onChange={(event) => update('filePath', event.target.value)}
                  />
                  <button type="button" className="btn" onClick={browseSqlite}>
                    浏览…
                  </button>
                </div>
              </label>
            ) : (
              <>
                <label className="field">
                  <span>{form.type === 'mssql' ? '主机 / host\\实例名' : '主机'}</span>
                  <input
                    value={form.host}
                    placeholder={
                      form.type === 'mssql' ? '127.0.0.1 或 192.168.0.52\\SQLEXPRESS' : undefined
                    }
                    onChange={(event) => update('host', event.target.value)}
                  />
                </label>

                {form.type === 'mssql' && (
                  <label className="field">
                    <span>实例名（可选）</span>
                    <input
                      value={form.instanceName}
                      placeholder="如 SQLEXPRESS"
                      onChange={(event) => update('instanceName', event.target.value)}
                    />
                  </label>
                )}

                <label className="field">
                  <span>端口</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    disabled={form.type === 'mssql' && Boolean(form.instanceName.trim())}
                    title={
                      form.type === 'mssql' && form.instanceName.trim()
                        ? '填写实例名时忽略端口，由 SQL Browser 解析'
                        : undefined
                    }
                    onChange={(event) => update('port', Number(event.target.value))}
                  />
                </label>

                {form.type === 'mssql' && (
                  <p className="form-note">
                    填写实例名后忽略端口，通过 SQL Browser（UDP 1434）解析实际端口；
                    需要服务器启动 SQL Server Browser 服务且防火墙放行 UDP 1434。
                  </p>
                )}

                <label className="field">
                  <span>用户名</span>
                  <input
                    value={form.username}
                    onChange={(event) => update('username', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>密码</span>
                  <input
                    type="password"
                    value={form.password}
                    placeholder={
                      editing && passwordStored
                        ? '留空表示保持原密码'
                        : form.type === 'mariadb'
                          ? 'ed25519 自动协商'
                          : ''
                    }
                    onChange={(event) => update('password', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>数据库</span>
                  <input
                    value={form.database}
                    placeholder="可选"
                    onChange={(event) => update('database', event.target.value)}
                  />
                </label>

                {form.type !== 'mssql' && (
                  <label className="field">
                    <span>字符集</span>
                    <input
                      list="connection-charsets"
                      value={form.charset}
                      placeholder="留空使用驱动默认，如 utf8mb4"
                      onChange={(event) => update('charset', event.target.value)}
                    />
                  </label>
                )}

                <datalist id="connection-charsets">
                  <option value="utf8mb4" />
                  <option value="utf8" />
                  <option value="latin1" />
                  <option value="gbk" />
                </datalist>

                {form.type === 'mssql' ? (
                  <div className="field check-group">
                    <span>连接安全</span>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={form.encrypt}
                        onChange={(event) => update('encrypt', event.target.checked)}
                      />
                      加密连接
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={form.trustServerCertificate}
                        onChange={(event) =>
                          update('trustServerCertificate', event.target.checked)
                        }
                      />
                      信任服务器证书
                    </label>
                  </div>
                ) : (
                  <label className="field">
                    <span>SSL 模式</span>
                    <select
                      value={form.sslMode}
                      onChange={(event) => update('sslMode', event.target.value as SslMode)}
                    >
                      {Object.entries(SSL_MODE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>

          {error && <div className="form-error">{error}</div>}

          {testResult && (
            <div className={`test-result test-${testResult.status}`}>
              <span className="test-dot" />
              <span>{testResult.message}</span>
              <span className="test-time">{testResult.elapsedMs} ms</span>
            </div>
          )}

          {testResult && !testResult.ok && explainErrorText(testResult.message) && (
            <p className="form-note">
              建议：{explainErrorText(testResult.message)}
            </p>
          )}

          <p className="form-note">
            连接配置保存在本地元数据库，密码经系统加密后落盘；导出的配置不包含密码。
            MSSQL 使用 SQL 认证；命名实例需要 SQL Server Browser（UDP 1434）。
          </p>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={testConnection} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}
