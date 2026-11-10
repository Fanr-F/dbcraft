import { useEffect, useState } from 'react';
import type { AppSettings, LocalStats, ShortcutAction, ShortcutMap } from '@shared/ipc-contract';
import {
  CONNECT_TIMEOUT_OPTIONS,
  DEFAULT_SHORTCUTS,
  EDITOR_FONT_SIZE_OPTIONS,
  HISTORY_RETENTION_OPTIONS,
  QUERY_TIMEOUT_OPTIONS,
  RESULT_ROW_LIMIT_OPTIONS,
  SHORTCUT_ACTIONS,
  DEFAULT_APP_SETTINGS,
} from '@shared/settings';
import { normalizeShortcut } from '../utils/shortcuts';
import { Icon } from './Icon';

interface SettingsDialogProps {
  settings: AppSettings;
  userDataPath: string | null;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<{ ok: boolean; message?: string }>;
}

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  run: '执行 SQL',
  complete: '触发补全',
  format: '格式化 SQL',
  save: '保存 SQL 文件',
  history: '打开查询历史',
};

export function SettingsDialog({
  settings,
  userDataPath,
  onClose,
  onSave,
}: SettingsDialogProps) {
  const [resultRowLimit, setResultRowLimit] = useState(settings.resultRowLimit);
  const [theme, setTheme] = useState(settings.theme);
  const [editorFontSize, setEditorFontSize] = useState(settings.editorFontSize);
  const [historyRetention, setHistoryRetention] = useState(settings.historyRetention);
  const [queryTimeoutMs, setQueryTimeoutMs] = useState(settings.queryTimeoutMs);
  const [connectTimeoutMs, setConnectTimeoutMs] = useState(settings.connectTimeoutMs);
  const [historyEnabled, setHistoryEnabled] = useState(settings.historyEnabled);
  const [historyDedupe, setHistoryDedupe] = useState(settings.historyDedupe);
  const [historyMask, setHistoryMask] = useState(settings.historyMask);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({ ...settings.shortcuts });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<LocalStats | null>(null);

  useEffect(() => {
    const api = window.dbcraft;
    if (!api) return;
    let cancelled = false;
    api.stats
      .get()
      .then((result) => {
        if (!cancelled && result.ok) setStats(result.stats);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const exportLogs = async () => {
    const api = window.dbcraft;
    if (!api) return;
    setDiagnosticsMessage('正在导出…');
    const result = await api.diagnostics.exportLogs();
    if (result.ok) {
      setDiagnosticsMessage(`已导出到 ${result.path}`);
    } else if (result.canceled) {
      setDiagnosticsMessage(null);
    } else {
      setDiagnosticsMessage(result.message);
    }
  };

  const openLogDir = async () => {
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.diagnostics.openLogDir();
    if (!result.ok) setDiagnosticsMessage(result.message);
  };

  const backupDatabase = async () => {
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.diagnostics.backupDatabase();
    if (result.ok) {
      setDiagnosticsMessage(`已备份到 ${result.path}`);
    } else if (!result.canceled) {
      setDiagnosticsMessage(result.message);
    }
  };

  const resetAllData = async () => {
    const answer = window.prompt(
      '将删除所有已保存连接、清空查询历史并恢复默认设置。此操作不可撤销。\n请输入 RESET 确认：',
    );
    if (answer !== 'RESET') {
      setDiagnosticsMessage('已取消重置。');
      return;
    }

    const api = window.dbcraft;
    if (!api) return;

    const connections = await api.connection.removeAll();
    if (!connections.ok) {
      setDiagnosticsMessage(connections.message);
      return;
    }
    const history = await api.history.clear();
    if (!history.ok) {
      setDiagnosticsMessage(history.message ?? '清空历史失败。');
      return;
    }
    const saved = await api.settings.save(DEFAULT_APP_SETTINGS);
    if (!saved.ok) {
      setDiagnosticsMessage(saved.message);
      return;
    }

    setDiagnosticsMessage(
      `已删除 ${connections.removed} 个连接，历史与设置已重置。正在重新加载…`,
    );
    window.setTimeout(() => window.location.reload(), 1200);
  };

  const restoreDatabase = async () => {    if (
      !window.confirm(
        '恢复元数据库会覆盖当前连接、查询历史与设置，并关闭所有数据库会话。当前数据会先自动备份。继续吗？',
      )
    ) {
      return;
    }
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.diagnostics.restoreDatabase();
    if (!result.ok) {
      if (!result.canceled) setDiagnosticsMessage(result.message);
      return;
    }
    setDiagnosticsMessage(
      `已恢复，正在重新加载…（恢复前备份：${result.preRestoreBackup}）`,
    );
    window.setTimeout(() => window.location.reload(), 1200);
  };

  const restoreDefaults = () => {
    setResultRowLimit(DEFAULT_APP_SETTINGS.resultRowLimit);
    setTheme(DEFAULT_APP_SETTINGS.theme);
    setEditorFontSize(DEFAULT_APP_SETTINGS.editorFontSize);
    setHistoryRetention(DEFAULT_APP_SETTINGS.historyRetention);
    setQueryTimeoutMs(DEFAULT_APP_SETTINGS.queryTimeoutMs);
    setConnectTimeoutMs(DEFAULT_APP_SETTINGS.connectTimeoutMs);
    setHistoryEnabled(DEFAULT_APP_SETTINGS.historyEnabled);
    setHistoryDedupe(DEFAULT_APP_SETTINGS.historyDedupe);
    setHistoryMask(DEFAULT_APP_SETTINGS.historyMask);
    setShortcuts({ ...DEFAULT_SHORTCUTS });
    setDiagnosticsMessage('已恢复默认值，点击「保存」后生效。');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const normalizedShortcuts = Object.fromEntries(
        SHORTCUT_ACTIONS.map((action) => [action, normalizeShortcut(shortcuts[action])]),
      ) as ShortcutMap;
      const values = Object.values(normalizedShortcuts);
      if (values.some((value) => value.length === 0)) {
        setError('快捷键不能为空。');
        return;
      }
      if (new Set(values).size !== values.length) {
        setError('快捷键存在冲突，请为每个动作设置不同的组合。');
        return;
      }
      const result = await onSave({
        resultRowLimit,
        theme,
        editorFontSize,
        historyRetention,
        queryTimeoutMs,
        connectTimeoutMs,
        historyEnabled,
        historyDedupe,
        historyMask,
        shortcuts: normalizedShortcuts,
      });
      if (result.ok) {
        onClose();
      } else {
        setError(result.message ?? '保存设置失败。');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p>设置保存在本地元数据库，重启后仍然有效。</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={() => !busy && onClose()}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>主题</span>
            <select
              value={theme}
              onChange={(event) =>
                setTheme(event.target.value as 'dark' | 'light' | 'system')
              }
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="system">跟随系统</option>
            </select>
          </label>

          <label className="field">
            <span>编辑器字号</span>
            <select
              value={editorFontSize}
              onChange={(event) => setEditorFontSize(Number(event.target.value))}
            >
              {EDITOR_FONT_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} px
                </option>
              ))}
            </select>
          </label>

          <div className="field shortcut-settings">
            <span>快捷键</span>
            {SHORTCUT_ACTIONS.map((action) => (
              <label className="check shortcut-row" key={action}>
                <span>{SHORTCUT_LABELS[action]}</span>
                <input
                  value={shortcuts[action]}
                  onChange={(event) =>
                    setShortcuts((current) => ({ ...current, [action]: event.target.value }))
                  }
                  placeholder="如 Ctrl+Enter"
                />
              </label>
            ))}
            <p className="form-note">
              格式如「Ctrl+Enter」「Ctrl+Shift+F」；保存时会自动规范化并检测重复。
            </p>
          </div>

          <label className="field">
            <span>单次查询结果上限</span>
            <select
              value={resultRowLimit}
              onChange={(event) => setResultRowLimit(Number(event.target.value))}
            >
              {RESULT_ROW_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? '不限制' : `${option} 行`}
                </option>
              ))}
            </select>
          </label>
          <p className="form-note">
            超出上限时结果区只保留前 N 行并显示截断提示；导出只包含已加载的行。
            修改在下次执行查询时生效。
          </p>
          {resultRowLimit === 0 && (
            <p className="form-error">
              「不限制」会加载全部结果；大结果集可能占用大量内存并导致界面卡顿，
              建议配合 WHERE / LIMIT 使用。
            </p>
          )}

          <label className="field">
            <span>查询历史保留条数</span>
            <select
              value={historyRetention}
              onChange={(event) => setHistoryRetention(Number(event.target.value))}
            >
              {HISTORY_RETENTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? '不限制' : `${option} 条`}
                </option>
              ))}
            </select>
          </label>
          <p className="form-note">
            超出保留条数后按最后执行时间淘汰；修改在下次写入历史时生效。
            选择「不限制」后不会自动淘汰，超过 50,000 条时搜索可能变慢。
          </p>

          <label className="check">
            <input
              type="checkbox"
              checked={historyEnabled}
              onChange={(event) => setHistoryEnabled(event.target.checked)}
            />
            记录查询历史
          </label>
          <p className="form-note">
            关闭后新执行的查询不再写入历史；已有记录保留，可随时在历史面板清理。
          </p>

          <label className="check">
            <input
              type="checkbox"
              checked={historyDedupe}
              onChange={(event) => setHistoryDedupe(event.target.checked)}
            />
            60 秒内相同 SQL 合并为一条
          </label>
          <p className="form-note">
            开启后同连接同 SQL 在 60 秒内重复执行只保留一条并累计执行次数；关闭后每次都单独记录。
          </p>

          <label className="check">
            <input
              type="checkbox"
              checked={historyMask}
              onChange={(event) => setHistoryMask(event.target.checked)}
            />
            历史默认脱敏显示
          </label>
          <p className="form-note">
            开启后列表与详情把 `password` / `token` 等赋值字面量显示为 `***`；搜索仍匹配原文。
          </p>

          <label className="field">
            <span>查询超时</span>
            <select
              value={queryTimeoutMs}
              onChange={(event) => setQueryTimeoutMs(Number(event.target.value))}
            >
              {QUERY_TIMEOUT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? '不自动取消' : `${option / 1000} 秒`}
                </option>
              ))}
            </select>
          </label>
          <p className="form-note">
            超时后复用取消逻辑；SQLite 会断开会话，需要点「重连」恢复。
            该设置覆盖 `DBCRAFT_QUERY_TIMEOUT_MS` 环境变量。
          </p>

          <label className="field">
            <span>连接/测试超时</span>
            <select
              value={connectTimeoutMs}
              onChange={(event) => setConnectTimeoutMs(Number(event.target.value))}
            >
              {CONNECT_TIMEOUT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option / 1000} 秒
                </option>
              ))}
            </select>
          </label>
          <p className="form-note">
            建立连接与测试连接时的等待上限，超时返回可读错误；修改在下次连接时生效。
            该设置被 `DBCRAFT_CONNECT_TIMEOUT_MS` 环境变量覆盖。
          </p>

          <div className="field">
            <span>快捷键</span>
            <div className="shortcut-grid">
              <span>
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
              </span>
              <span>执行全部 SQL / 只执行选区</span>
              <span>
                <kbd>Ctrl</kbd> + <kbd>Space</kbd>
              </span>
              <span>SQL 补全</span>
              <span>
                <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>
              </span>
              <span>格式化 SQL</span>
              <span>
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
              </span>
              <span>保存 SQL 文件</span>
              <span>
                <kbd>Ctrl</kbd> + <kbd>E</kbd>
              </span>
              <span>打开查询历史</span>
              <span>
                <kbd>Esc</kbd>
              </span>
              <span>关闭补全/弹窗</span>
            </div>
          </div>

          {userDataPath && (
            <label className="field">
              <span>本地数据目录</span>
              <input value={userDataPath} readOnly title={userDataPath} />
            </label>
          )}

          <div className="field check-group">
            <span>诊断</span>
            <button type="button" className="btn" onClick={() => void exportLogs()}>
              导出诊断日志
            </button>
            <button type="button" className="btn" onClick={() => void openLogDir()}>
              打开日志目录
            </button>
            <button type="button" className="btn" onClick={() => void backupDatabase()}>
              备份元数据库
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void restoreDatabase()}
            >
              恢复备份
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void resetAllData()}
            >
              重置应用数据
            </button>
          </div>
          {diagnosticsMessage && (
            <p className="form-note">{diagnosticsMessage}</p>
          )}

          {stats && (
            <p className="form-note">
              本地统计：连接 {stats.connections} 个 · 历史 {stats.history} 条 · 设置{' '}
              {stats.settings} 项 · 元数据库 {(stats.databaseBytes / 1024).toFixed(1)} KB
            </p>
          )}

          {error && <div className="form-error">{error}</div>}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn" disabled={busy} onClick={restoreDefaults}>
            恢复默认
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy ||
              (resultRowLimit === settings.resultRowLimit &&
                theme === settings.theme &&
                editorFontSize === settings.editorFontSize &&
                historyRetention === settings.historyRetention &&
                queryTimeoutMs === settings.queryTimeoutMs &&
                connectTimeoutMs === settings.connectTimeoutMs &&
                historyEnabled === settings.historyEnabled &&
                historyDedupe === settings.historyDedupe &&
                historyMask === settings.historyMask &&
                JSON.stringify(shortcuts) === JSON.stringify(settings.shortcuts))
            }
            onClick={() => void save()}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
