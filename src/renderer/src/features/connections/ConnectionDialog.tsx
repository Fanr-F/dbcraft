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
  encrypt: boolean;
  trustServerCertificate: boolean;
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
  encrypt: true,
  trustServerCertificate: false,
};

interface ConnectionDialogProps {
  onClose: () => void;
  onSave: (input: ConnectionInput) => void;
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
    return {
      ...common,
      type: 'mssql',
      host: form.host.trim(),
      port: form.port,
      username: form.username.trim(),
      password: form.password,
      database: form.database.trim(),
      encrypt: form.encrypt,
      trustServerCertificate: form.trustServerCertificate,
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
  };
}

function validate(form: FormState): string | null {
  if (!form.name.trim()) return '请填写连接名称';
  if (form.type === 'sqlite') {
    return form.filePath.trim() ? null : '请选择 SQLite 数据库文件';
  }
  if (!form.host.trim()) return '请填写主机地址';
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
    return '端口必须是 1–65535 的整数';
  }
  if (!form.username.trim()) return '请填写用户名';
  return null;
}

export function ConnectionDialog({ onClose, onSave }: ConnectionDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
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
    onSave(buildInput(form));
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
            <h2 id="connection-dialog-title">新建连接</h2>
            <p>选择数据库类型，填写连接信息。</p>
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
                  <span>主机</span>
                  <input
                    value={form.host}
                    onChange={(event) => update('host', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>端口</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(event) => update('port', Number(event.target.value))}
                  />
                </label>

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
                    placeholder={form.type === 'mariadb' ? 'ed25519 自动协商' : ''}
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

          <p className="form-note">
            M0 只验证表单与 IPC 契约，不会真正连接数据库；连接信息仅保存在内存，密码不写盘。
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
