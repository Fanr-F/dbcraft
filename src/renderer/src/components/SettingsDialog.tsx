import { useEffect, useState } from 'react';
import type {
  AppDataLocation,
  AppSettings,
  LocalStats,
  ShortcutAction,
  ShortcutMap,
} from '@shared/ipc-contract';
import {
  COMPLETION_DELAY_OPTIONS,
  CONNECT_TIMEOUT_OPTIONS,
  DEFAULT_SHORTCUTS,
  EDITOR_FONT_FAMILY_OPTIONS,
  EDITOR_FONT_SIZE_OPTIONS,
  EDITOR_TAB_SIZE_OPTIONS,
  HISTORY_RETENTION_OPTIONS,
  QUERY_TIMEOUT_OPTIONS,
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
  const [theme, setTheme] = useState(settings.theme);
  const [editorFontSize, setEditorFontSize] = useState(settings.editorFontSize);
  const [editorFontFamily, setEditorFontFamily] = useState(settings.editorFontFamily);
  const [editorTabSize, setEditorTabSize] = useState(settings.editorTabSize);
  const [sqlKeywordCase, setSqlKeywordCase] = useState(settings.sqlKeywordCase);
  const [completionEnabled, setCompletionEnabled] = useState(settings.completionEnabled);
  const [completionAutoTrigger, setCompletionAutoTrigger] = useState(
    settings.completionAutoTrigger,
  );
  const [completionTableAlias, setCompletionTableAlias] = useState(
    settings.completionTableAlias,
  );
  const [completionDelayMs, setCompletionDelayMs] = useState(settings.completionDelayMs);
  const [historyRetention, setHistoryRetention] = useState(settings.historyRetention);
  const [queryTimeoutMs, setQueryTimeoutMs] = useState(settings.queryTimeoutMs);
  const [connectTimeoutMs, setConnectTimeoutMs] = useState(settings.connectTimeoutMs);
  const [historyEnabled, setHistoryEnabled] = useState(settings.historyEnabled);
  const [historyDedupe, setHistoryDedupe] = useState(settings.historyDedupe);
  const [historyMask, setHistoryMask] = useState(settings.historyMask);
  const [gridAutoCommit, setGridAutoCommit] = useState(settings.gridAutoCommit);
  const [gridConfirmCommit, setGridConfirmCommit] = useState(settings.gridConfirmCommit);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({ ...settings.shortcuts });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<LocalStats | null>(null);
  const [dataLocation, setDataLocation] = useState<AppDataLocation | null>(null);
  const [dataDirectoryMessage, setDataDirectoryMessage] = useState<string | null>(null);

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
    api.app
      .getDataLocation()
      .then((location) => {
        if (!cancelled) setDataLocation(location);
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
    setTheme(DEFAULT_APP_SETTINGS.theme);
    setEditorFontSize(DEFAULT_APP_SETTINGS.editorFontSize);
    setEditorFontFamily(DEFAULT_APP_SETTINGS.editorFontFamily);
    setEditorTabSize(DEFAULT_APP_SETTINGS.editorTabSize);
    setSqlKeywordCase(DEFAULT_APP_SETTINGS.sqlKeywordCase);
    setCompletionEnabled(DEFAULT_APP_SETTINGS.completionEnabled);
    setCompletionAutoTrigger(DEFAULT_APP_SETTINGS.completionAutoTrigger);
    setCompletionTableAlias(DEFAULT_APP_SETTINGS.completionTableAlias);
    setCompletionDelayMs(DEFAULT_APP_SETTINGS.completionDelayMs);
    setHistoryRetention(DEFAULT_APP_SETTINGS.historyRetention);
    setQueryTimeoutMs(DEFAULT_APP_SETTINGS.queryTimeoutMs);
    setConnectTimeoutMs(DEFAULT_APP_SETTINGS.connectTimeoutMs);
    setHistoryEnabled(DEFAULT_APP_SETTINGS.historyEnabled);
    setHistoryDedupe(DEFAULT_APP_SETTINGS.historyDedupe);
    setHistoryMask(DEFAULT_APP_SETTINGS.historyMask);
    setGridAutoCommit(DEFAULT_APP_SETTINGS.gridAutoCommit);
    setGridConfirmCommit(DEFAULT_APP_SETTINGS.gridConfirmCommit);
    setShortcuts({ ...DEFAULT_SHORTCUTS });
    setDiagnosticsMessage('已恢复默认值，点击「保存」后生效。');
  };

  const chooseDataDirectory = async () => {
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.app.chooseDataDirectory();
    setDataDirectoryMessage(result.message);
    if (result.location) setDataLocation(result.location);
  };

  const resetDataDirectory = async () => {
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.app.resetDataDirectory();
    setDataDirectoryMessage(result.message);
    if (result.location) setDataLocation(result.location);
  };

  const refreshStats = async () => {
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.stats.get();
    if (result.ok) setStats(result.stats);
  };

  const copyStats = async () => {
    if (!stats) return;
    const text = JSON.stringify(
      { exportedAt: new Date().toISOString(), ...stats },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      setDiagnosticsMessage('统计已复制到剪贴板。');
    } catch {
      setDiagnosticsMessage('复制失败，请检查剪贴板权限。');
    }
  };

  const clearHistory = async () => {
    const api = window.dbcraft;
    if (!api) return;
    if (!window.confirm('清空全部查询历史？该操作不可撤销。')) return;
    const result = await api.history.clear();
    setDiagnosticsMessage(result.ok ? '查询历史已清空。' : (result.message ?? '清空失败。'));
    if (result.ok) await refreshStats();
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
        theme,
        editorFontSize,
        editorFontFamily,
        editorTabSize,
        sqlKeywordCase,
        completionEnabled,
        completionAutoTrigger,
        completionTableAlias,
        completionDelayMs,
        historyRetention,
        queryTimeoutMs,
        connectTimeoutMs,
        historyEnabled,
        historyDedupe,
        historyMask,
        gridAutoCommit,
        gridConfirmCommit,
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

          <label className="field">
            <span>编辑器字体</span>
            <select
              value={editorFontFamily}
              onChange={(event) => setEditorFontFamily(event.target.value)}
            >
              {EDITOR_FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Tab 宽度</span>
            <select
              value={editorTabSize}
              onChange={(event) => setEditorTabSize(Number(event.target.value))}
            >
              {EDITOR_TAB_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>格式化关键字大小写</span>
            <select
              value={sqlKeywordCase}
              onChange={(event) =>
                setSqlKeywordCase(
                  event.target.value as AppSettings['sqlKeywordCase'],
                )
              }
            >
              <option value="upper">大写</option>
              <option value="lower">小写</option>
              <option value="preserve">保持原样</option>
            </select>
          </label>

          <label className="field field-check">
            <span>启用 SQL 补全</span>
            <input
              type="checkbox"
              checked={completionEnabled}
              onChange={(event) => setCompletionEnabled(event.target.checked)}
            />
          </label>
          <label className="field field-check">
            <span>输入时自动弹出补全</span>
            <input
              type="checkbox"
              checked={completionAutoTrigger}
              disabled={!completionEnabled}
              onChange={(event) => setCompletionAutoTrigger(event.target.checked)}
            />
          </label>
          <label className="field field-check">
            <span>FROM/JOIN 表名自动加别名</span>
            <input
              type="checkbox"
              checked={completionTableAlias}
              disabled={!completionEnabled}
              onChange={(event) => setCompletionTableAlias(event.target.checked)}
            />
          </label>
          <label className="field">
            <span>自动补全延迟</span>
            <select
              value={completionDelayMs}
              disabled={!completionEnabled || !completionAutoTrigger}
              onChange={(event) => setCompletionDelayMs(Number(event.target.value))}
            >
              {COMPLETION_DELAY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? '立即' : `${option} ms`}
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

          <label className="field field-check">
            <span>表数据默认自动提交</span>
            <input
              type="checkbox"
              checked={gridAutoCommit}
              onChange={(event) => setGridAutoCommit(event.target.checked)}
            />
          </label>
          <p className="form-note">
            开启后，已有行的修改在停止编辑 800ms 后自动提交；新增行仍需手动提交或关闭自动提交。
          </p>
          <label className="field field-check">
            <span>表数据提交前确认</span>
            <input
              type="checkbox"
              checked={gridConfirmCommit}
              onChange={(event) => setGridConfirmCommit(event.target.checked)}
            />
          </label>
          <p className="form-note">
            每次提交前弹出确认，自动提交时尤其建议开启；每个标签仍可单独切换。
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
              <input
                value={dataLocation?.current ?? userDataPath}
                readOnly
                title={dataLocation?.current ?? userDataPath}
              />
            </label>
          )}
          <div className="field check-group">
            <span>数据目录迁移</span>
            <button type="button" className="btn" onClick={() => void chooseDataDirectory()}>
              选择目录并迁移
            </button>
            <button
              type="button"
              className="btn"
              disabled={!dataLocation?.custom}
              onClick={() => void resetDataDirectory()}
            >
              恢复默认目录
            </button>
          </div>
          <p className="form-note">
            新目录在下次启动时复制元数据库与日志，然后切换；原目录不会被删除。
            {dataDirectoryMessage ? ` ${dataDirectoryMessage}` : ''}
          </p>

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
            <div className="field check-group">
              <span>本地统计</span>
              <span className="pane-hint">
                连接 {stats.connections} 个 · 历史 {stats.history} 条 · 设置{' '}
                {stats.settings} 项 · 元数据库 {(stats.databaseBytes / 1024).toFixed(1)} KB
              </span>
              <button type="button" className="btn" onClick={() => void copyStats()}>
                复制统计
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void clearHistory()}>
                清空查询历史
              </button>
            </div>
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
              (theme === settings.theme &&
                editorFontSize === settings.editorFontSize &&
                editorFontFamily === settings.editorFontFamily &&
                editorTabSize === settings.editorTabSize &&
                sqlKeywordCase === settings.sqlKeywordCase &&
                completionEnabled === settings.completionEnabled &&
                completionAutoTrigger === settings.completionAutoTrigger &&
                completionTableAlias === settings.completionTableAlias &&
                completionDelayMs === settings.completionDelayMs &&
                historyRetention === settings.historyRetention &&
                queryTimeoutMs === settings.queryTimeoutMs &&
                connectTimeoutMs === settings.connectTimeoutMs &&
                historyEnabled === settings.historyEnabled &&
                historyDedupe === settings.historyDedupe &&
                historyMask === settings.historyMask &&
                gridAutoCommit === settings.gridAutoCommit &&
                gridConfirmCommit === settings.gridConfirmCommit &&
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
