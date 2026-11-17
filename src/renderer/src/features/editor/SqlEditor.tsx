import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type ViewUpdate,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  closeCompletion,
  completionStatus,
  currentCompletions,
  selectedCompletion,
  startCompletion,
  type CompletionSource,
} from '@codemirror/autocomplete';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  MSSQL,
  MariaSQL,
  MySQL,
  SQLite,
  StandardSQL,
  sql,
} from '@codemirror/lang-sql';
import { tags } from '@lezer/highlight';
import type { DatabaseType, ShortcutMap } from '@shared/ipc-contract';
import { DEFAULT_SHORTCUTS } from '@shared/settings';
import { normalizeShortcut } from '../../utils/shortcuts';
import { warmUpSqlAnalysis } from '../../utils/sql-analysis';
import { statementAtCursor } from '../../utils/sql-script';
import {
  completionCandidatesForContext,
  completionResultLimit,
  excludeReferencedTables,
  extractCompletionContext,
  extractSignatureHelp,
  matchCompletionCase,
  rankCompletions,
  shouldOpenCompletionOnInput,
  type CompletionCandidate,
  type CompletionContext,
  type CompletionGroups,
  type CompletionKind,
  type SignatureHelp,
} from '../../utils/sql-completion';
import { ContextMenu } from '../../components/ContextMenu';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 传入选中的 SQL 片段；没有选区时传光标所在语句，定位失败时 undefined（执行全文）。 */
  onRun: (sql?: string) => void;
  onSave?: () => void;
  /** 无选区时的全文格式化（由 App 处理通知与状态）。 */
  onFormat?: () => void;
  /** 纯文本格式化；有选区时只替换选区，不影响其余 SQL。 */
  formatSql?: (sql: string) => string;
  /** 选区格式化结果提示。 */
  onFormatNotice?: (kind: 'info' | 'error', message: string) => void;
  /** 一次性格式化请求（工具栏按钮）；token 变化时按当前选区/全文格式化。 */
  formatRequest?: { token: number } | null;
  /** 右键「从历史插入」入口。 */
  onOpenHistory?: () => void;
  /** 一次性插入请求；token 变化时在光标处插入 text。 */
  insertRequest?: { text: string; token: number } | null;
  /** 选区变化时上报选中文本（空字符串表示没有选中）。 */
  onSelectionChange?: (selected: string) => void;
  /** 当前标签是否有查询在执行；执行中按 F5 应取消。 */
  running?: boolean;
  /** 取消当前查询（与执行/取消按钮共用）。 */
  onCancel?: () => void;
  /** 关键字 + 当前连接对象名（按分类供上下文过滤）。 */
  completionGroups?: CompletionGroups;
  /** 是否启用补全。 */
  completionEnabled?: boolean;
  /** 是否在输入时自动弹补全；关闭后仍可用快捷键手动触发。 */
  completionAutoTrigger?: boolean;
  /** 自动补全延迟（毫秒）。 */
  completionDelayMs?: number;
  /** 按光标上下文异步补充列/别名等候选。 */
  onRequestCompletion?: (context: CompletionContext) => Promise<CompletionCandidate[]>;
  /** 当前连接的方言；用于语法高亮、分句与函数签名提示。 */
  dialect?: DatabaseType | null;
  shortcuts?: ShortcutMap;
  /** 当前标签 id；切换标签时重建编辑器状态，清空撤销历史。 */
  editorId?: string;
  /** Tab 宽度，与设置面板的「Tab 宽度」一致。 */
  editorTabSize?: number;
}

interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
  canPaste: boolean;
}

/** 补全项类型的中文标签，显示在候选右侧。 */
const KIND_LABELS: Record<CompletionKind, string> = {
  keyword: '关键字',
  function: '函数',
  table: '表',
  view: '视图',
  procedure: '存储过程',
  database: '数据库',
  schema: 'Schema',
  column: '列',
  alias: '别名',
};

function completionType(kind: CompletionKind): string {
  switch (kind) {
    case 'keyword':
      return 'keyword';
    case 'function':
      return 'function';
    case 'table':
    case 'view':
      return 'class';
    case 'procedure':
      return 'method';
    case 'database':
    case 'schema':
      return 'namespace';
    case 'column':
    case 'alias':
      return 'property';
    default:
      return 'text';
  }
}

function sqlLanguage(dialect: DatabaseType | null | undefined) {
  switch (dialect) {
    case 'mssql':
      return sql({ dialect: MSSQL, upperCaseKeywords: true });
    case 'mysql':
    case 'percona':
      return sql({ dialect: MySQL, upperCaseKeywords: true });
    case 'mariadb':
      return sql({ dialect: MariaSQL, upperCaseKeywords: true });
    case 'sqlite':
      return sql({ dialect: SQLite, upperCaseKeywords: true });
    default:
      return sql({ dialect: StandardSQL, upperCaseKeywords: true });
  }
}

/** 把设置里的快捷键（Ctrl+Shift+F）转成 CodeMirror 的 key 写法（Ctrl-Shift-f）。 */
function shortcutToKey(accelerator: string): string {
  const parts = normalizeShortcut(accelerator).split('+');
  const key = parts.pop() ?? '';
  const modifiers = parts.map((part) =>
    part.toLowerCase() === 'ctrl' ? 'Ctrl' : part.toLowerCase() === 'alt' ? 'Alt' : 'Shift',
  );
  return [...modifiers, key.length === 1 ? key.toLowerCase() : key].join('-');
}

/** 语法高亮只挂 CSS class，颜色由 styles.css 按明暗主题决定，切换主题无需重建编辑器。 */
const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'cm-sql-keyword' },
  { tag: tags.typeName, class: 'cm-sql-type' },
  { tag: tags.standard(tags.name), class: 'cm-sql-function' },
  { tag: [tags.bool, tags.null, tags.number], class: 'cm-sql-number' },
  { tag: [tags.string, tags.special(tags.string)], class: 'cm-sql-string' },
  { tag: [tags.lineComment, tags.blockComment], class: 'cm-sql-comment' },
  {
    tag: [tags.operator, tags.punctuation, tags.paren, tags.brace, tags.squareBracket],
    class: 'cm-sql-operator',
  },
  { tag: tags.invalid, class: 'cm-sql-invalid' },
]);

/** 编辑器外观沿用应用 CSS 变量；用 var() 后主题切换不需要重新配置扩展。 */
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontSize: 'var(--editor-font-size, 13px)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily:
      'var(--sql-font-family, "Cascadia Code", "JetBrains Mono", Consolas, monospace)',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '12px 0',
    caretColor: 'var(--text)',
    tabSize: 'var(--sql-tab-size, 2)',
  },
  '.cm-line': {
    padding: '0 14px 0 8px',
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--border)',
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--faint)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '28px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(56, 189, 248, 0.07)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--accent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(56, 189, 248, 0.3)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--text)',
  },
  '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': {
    backgroundColor: 'rgba(56, 189, 248, 0.28)',
    color: 'inherit',
    outline: 'none',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border-strong)',
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text-soft)',
    borderRadius: '8px',
    boxShadow: '0 12px 28px rgba(2, 6, 23, 0.35)',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily:
      'var(--sql-font-family, "Cascadia Code", "JetBrains Mono", Consolas, monospace)',
    fontSize: '12px',
    maxHeight: '190px',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 8px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    color: 'var(--accent)',
  },
  '.cm-completionDetail': {
    color: 'var(--faint)',
    fontSize: '10px',
    fontStyle: 'normal',
  },
  '.cm-completionMatchedText': {
    color: 'var(--accent)',
    textDecoration: 'none',
    fontWeight: '600',
  },
});

export function SqlEditor(props: SqlEditorProps) {
  const {
    value,
    editorId,
    dialect = null,
    completionEnabled = true,
    completionAutoTrigger = true,
    completionDelayMs = 0,
    editorTabSize = 2,
    insertRequest,
    formatRequest,
  } = props;

  /** 扩展只创建一次；所有回调/设置都从 ref 读取最新值，避免重建编辑器。 */
  const latest = useRef(props);
  latest.current = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEditorId = useRef(editorId);
  const lastInsertToken = useRef<number | null>(null);
  const lastFormatToken = useRef<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [signatureHelp, setSignatureHelp] = useState<SignatureHelp | null>(null);
  const [completionLoading, setCompletionLoading] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const languageCompartment = useRef(new Compartment());
  const completionCompartment = useRef(new Compartment());
  const shortcutsCompartment = useRef(new Compartment());
  const tabSizeCompartment = useRef(new Compartment());

  const tabSizeExtension = (size: number) => [
    EditorState.tabSize.of(size),
    indentUnit.of(' '.repeat(size)),
  ];

  const updateSignature = (view: EditorView) => {
    const currentDialect = latest.current.dialect;
    if (!currentDialect) {
      setSignatureHelp(null);
      return;
    }
    setSignatureHelp(
      extractSignatureHelp(
        view.state.doc.toString(),
        view.state.selection.main.head,
        currentDialect,
      ),
    );
  };

  const completionSource: CompletionSource = async (context) => {
    const current = latest.current;
    if (current.completionEnabled === false) return null;
    // 超长 SQL 不做补全（与执行前的 >1MB 提示保持一致）；先看长度避免无谓拷贝。
    if (context.state.doc.length > 1_000_000) return null;
    const doc = context.state.doc.toString();
    const ourContext = extractCompletionContext(doc, context.pos, current.dialect);
    // 字符串/注释里不弹补全，避免把列名插进字面量。
    if (ourContext.inLiteral) return null;
    // CodeMirror 会在每次输入后查询候选；沿用旧的触发规则，避免在空格/标点后
    // 无条件弹出整张关键字表。手动 Ctrl+Space 不受此限制。
    if (
      !context.explicit &&
      current.completionAutoTrigger !== false &&
      !shouldOpenCompletionOnInput(doc, context.pos, {
        inserted: true,
        context: ourContext,
      })
    ) {
      return null;
    }

    const groups: CompletionGroups = current.completionGroups ?? {
      keywords: [],
      functions: [],
      objects: [],
      databases: [],
      schemas: [],
    };
    const base = completionCandidatesForContext(ourContext, groups);
    // CodeMirror 弹层没有内置加载态：本地候选为空、需要等元数据时，
    // 超过 120ms 仍未返回就显示「正在加载补全…」，避免用户以为没反应。
    let loadingTimer: number | null = null;
    if (current.onRequestCompletion && base.length === 0) {
      const view = viewRef.current;
      const wrap = wrapRef.current;
      const coords = view?.coordsAtPos(context.pos);
      if (view && wrap && coords) {
        const rect = wrap.getBoundingClientRect();
        const position = {
          left: Math.max(4, coords.left - rect.left),
          top: coords.bottom - rect.top + 2,
        };
        loadingTimer = window.setTimeout(() => {
          if (!context.aborted) setCompletionLoading(position);
        }, 120);
      }
    }
    let extra: CompletionCandidate[] = [];
    if (current.onRequestCompletion) {
      try {
        extra = await current.onRequestCompletion(ourContext);
      } catch {
        extra = [];
      } finally {
        if (loadingTimer !== null) window.clearTimeout(loadingTimer);
      }
    }
    setCompletionLoading(null);
    if (context.aborted) return null;

    const candidates = excludeReferencedTables([...extra, ...base], ourContext);
    const ranked = rankCompletions(candidates, ourContext.needle, {
      context: ourContext,
      limit: completionResultLimit(ourContext),
    });
    if (ranked.length === 0) return null;
    return {
      from: ourContext.replaceStart,
      to: ourContext.replaceEnd,
      // 候选已经按现有规则排序/过滤，交给 CodeMirror 再排会打乱列 > 表 > 关键字的顺序。
      filter: false,
      options: ranked.map((item, index) => ({
        label: item.label,
        detail: item.detail ?? KIND_LABELS[item.kind],
        type: completionType(item.kind),
        boost: Math.max(0, 99 - index),
        apply: (view, _completion, from, to) => {
          const typed = view.state.sliceDoc(from, to);
          const insert = item.insertText ?? matchCompletionCase(item.label, typed);
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
            userEvent: 'input.complete',
          });
        },
      })),
    };
  };

  const autocompleteExtension = () =>
    autocompletion({
      override: [completionSource],
      activateOnTyping:
        latest.current.completionEnabled !== false &&
        latest.current.completionAutoTrigger !== false,
      activateOnTypingDelay: Math.max(0, latest.current.completionDelayMs ?? 0),
      closeOnBlur: true,
      maxRenderedOptions: 50,
      defaultKeymap: true,
    });

  const runFromView = () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to).trim();
    latest.current.onRun(
      selected.length > 0
        ? selected
        : statementAtCursor(
            view.state.doc.toString(),
            from,
            latest.current.dialect ?? undefined,
          ) ?? undefined,
    );
  };

  /** F5 与工具栏「执行」一致：有选区执行选区，无选区执行整段 SQL。 */
  const runAllOrSelection = () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to).trim();
    latest.current.onRun(selected.length > 0 ? selected : undefined);
  };

  /** F5：执行中再按一次取消；空闲时执行。 */
  const runOrCancelAll = () => {
    if (latest.current.running) {
      latest.current.onCancel?.();
      return;
    }
    runAllOrSelection();
  };

  /**
   * 格式化入口：有选区只替换选区（保留选区，可 Ctrl+Z 撤销），
   * 无选区交给 App 的全文格式化（沿用已有通知/空 SQL 处理）。
   */
  const formatFromView = () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) {
      latest.current.onFormat?.();
      return;
    }

    const selected = view.state.sliceDoc(from, to);
    if (!selected.trim()) {
      latest.current.onFormatNotice?.('info', '选中的 SQL 为空，未格式化。');
      view.focus();
      return;
    }
    const formatter = latest.current.formatSql;
    if (!formatter) {
      // 没有提供纯格式化函数时退回全文格式化，避免选区格式化静默失效。
      latest.current.onFormat?.();
      return;
    }

    const formatted = formatter(selected);
    if (formatted === selected) {
      latest.current.onFormatNotice?.('info', '选中的 SQL 已是格式化状态。');
      view.focus();
      return;
    }
    view.dispatch({
      changes: { from, to, insert: formatted },
      selection: { anchor: from, head: from + formatted.length },
      userEvent: 'input.format',
    });
    view.focus();
    latest.current.onFormatNotice?.('info', '已格式化选中 SQL。');
  };

  /**
   * 接受当前补全；弹层刚出现的 75ms 内 CodeMirror 会拒绝接受（防误触），
   * 这里等过保护期再接受，期间若用户继续输入则放弃。
   */
  const acceptCompletionWhenReady = (view: EditorView): boolean => {
    // 直接尝试接受：CodeMirror 可能同时存在已显示但仍有旧请求 pending 的上下文，
    // 只看 completionStatus === 'active' 会误判成不可接受。
    if (currentCompletions(view.state).length === 0 || !selectedCompletion(view.state)) {
      return false;
    }
    if (acceptCompletion(view)) return true;
    const docLength = view.state.doc.length;
    const cursor = view.state.selection.main.head;
    window.setTimeout(() => {
      if (
        viewRef.current === view &&
        view.state.doc.length === docLength &&
        view.state.selection.main.head === cursor &&
        selectedCompletion(view.state)
      ) {
        acceptCompletion(view);
      }
    }, 80);
    return true;
  };

  /**
   * Tab：补全弹层打开时接受候选（与 Enter 一致）；否则缩进。
   * 有选区时按行缩进，光标处插入与「Tab 宽度」设置一致的空格。
   * 需要把焦点移出编辑器时可按 Ctrl+M 切换 CodeMirror 的 Tab 焦点模式。
   */
  const handleTab = (view: EditorView): boolean => {
    if (acceptCompletionWhenReady(view)) return true;
    if (completionStatus(view.state) === 'pending') closeCompletion(view);

    const range = view.state.selection.main;
    if (!range.empty) return indentMore(view);
    const unit = ' '.repeat(Math.max(1, latest.current.editorTabSize ?? 2));
    view.dispatch({
      changes: { from: range.from, insert: unit },
      selection: { anchor: range.from + unit.length },
      userEvent: 'input.indent',
    });
    return true;
  };

  const shortcutKeymap = () => {
    const shortcuts = latest.current.shortcuts ?? DEFAULT_SHORTCUTS;
    // 用户快捷键必须压过 CodeMirror 默认键位（例如 Mod-Enter 插入空行）。
    return Prec.highest(
      keymap.of([
        {
          key: 'F5',
          run: () => {
            runOrCancelAll();
            return true;
          },
        },
        {
          key: shortcutToKey(shortcuts.run),
          run: () => {
            runFromView();
            return true;
          },
        },
        {
          key: shortcutToKey(shortcuts.save),
          run: () => {
            latest.current.onSave?.();
            return true;
          },
        },
        {
          key: shortcutToKey(shortcuts.format),
          run: () => {
            formatFromView();
            return true;
          },
        },
        {
          key: shortcutToKey(shortcuts.complete),
          run: (view) => startCompletion(view),
        },
      ]),
    );
  };

  const handleUpdate = (update: ViewUpdate) => {
    const view = update.view;
    if (update.docChanged) {
      latest.current.onChange(view.state.doc.toString());
    }
    if (update.docChanged || update.selectionSet) {
      const { from, to } = view.state.selection.main;
      latest.current.onSelectionChange?.(view.state.sliceDoc(from, to));
      updateSignature(view);
    }
    if (update.focusChanged && !view.hasFocus) {
      setSignatureHelp(null);
      setCompletionLoading(null);
    }
  };

  const handleContextMenu = (event: MouseEvent, view: EditorView) => {
    event.preventDefault();
    const { from, to } = view.state.selection.main;
    const x = event.clientX;
    const y = event.clientY;
    const openMenu = (canPaste: boolean) =>
      setMenu({ x, y, hasSelection: from !== to, canPaste });
    if (!navigator.clipboard?.readText) {
      openMenu(true);
      return true;
    }
    void navigator.clipboard.readText().then(
      (text) => openMenu(text.length > 0),
      () => openMenu(true),
    );
    return true;
  };

  const createEditorState = (doc: string) => {
    const size = latest.current.editorTabSize ?? 2;
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        completionCompartment.current.of(autocompleteExtension()),
        highlightActiveLine(),
        languageCompartment.current.of(sqlLanguage(latest.current.dialect)),
        syntaxHighlighting(sqlHighlightStyle),
        editorTheme,
        tabSizeCompartment.current.of(tabSizeExtension(size)),
        shortcutsCompartment.current.of(shortcutKeymap()),
        keymap.of([
          { key: 'Tab', run: handleTab, shift: (view) => indentLess(view) },
          // 弹层刚打开时 CodeMirror 的 Enter 可能因 interactionDelay 落到换行；
          // 这里补一次接受，未打开补全时返回 false，仍由 defaultKeymap 换行。
          { key: 'Enter', run: (view) => acceptCompletionWhenReady(view) },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({
          'aria-label': 'SQL 编辑器',
          spellcheck: 'false',
          autocapitalize: 'off',
          autocomplete: 'off',
        }),
        EditorView.domEventHandlers({ contextmenu: handleContextMenu }),
        EditorView.updateListener.of(handleUpdate),
      ],
    });
  };

  // 创建编辑器；组件卸载时销毁。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: createEditorState(latest.current.value),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换标签：重建 EditorState（同时清空撤销历史），避免把上一个标签的内容撤回来。
  useEffect(() => {
    if (lastEditorId.current === editorId) return;
    lastEditorId.current = editorId;
    const view = viewRef.current;
    if (!view) return;
    setSignatureHelp(null);
    view.setState(createEditorState(latest.current.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorId]);

  // 外部改文本（格式化、打开文件、表格分页等）同步到编辑器，并进入撤销历史。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartment.current.reconfigure(sqlLanguage(dialect)),
    });
    // 提前加载当前方言的 AST 解析器；加载前补全仍走扫描实现。
    void warmUpSqlAnalysis(dialect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tabSizeCompartment.current.reconfigure(tabSizeExtension(editorTabSize)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorTabSize]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: completionCompartment.current.reconfigure(autocompleteExtension()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionEnabled, completionAutoTrigger, completionDelayMs]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: shortcutsCompartment.current.reconfigure(shortcutKeymap()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.shortcuts]);

  // 历史面板选择记录后，把 SQL 插到当前光标/选区位置，而不是覆盖整个编辑器。
  useEffect(() => {
    if (!insertRequest || lastInsertToken.current === insertRequest.token) return;
    const view = viewRef.current;
    if (!view) return;
    lastInsertToken.current = insertRequest.token;

    const { from, to } = view.state.selection.main;
    const before = view.state.sliceDoc(0, from);
    const after = view.state.sliceDoc(to);
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
    const insert = `${prefix}${insertRequest.text}${suffix}`;
    const anchor = from + prefix.length + insertRequest.text.length;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor },
    });
    view.focus();
  }, [insertRequest]);

  // 工具栏「格式化」按钮：与 Ctrl+Shift+F / 右键菜单走同一套选区/全文逻辑。
  useEffect(() => {
    if (!formatRequest || lastFormatToken.current === formatRequest.token) return;
    lastFormatToken.current = formatRequest.token;
    formatFromView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatRequest]);

  const copySelection = async () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    try {
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    } catch {
      return;
    }
    view.focus();
  };

  /** 剪切：先写剪贴板，成功后再改文本，避免复制失败却删掉内容。 */
  const cutSelection = async () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    try {
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    } catch {
      return;
    }
    view.dispatch({
      changes: { from, to, insert: '' },
      selection: { anchor: from },
      userEvent: 'delete.cut',
    });
    view.focus();
  };

  const pasteFromClipboard = async () => {
    const view = viewRef.current;
    if (!view) return;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (!text) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.paste',
    });
    view.focus();
  };

  return (
    <div ref={wrapRef} className="sql-editor-wrap">
      <div ref={hostRef} className="sql-editor-host" />

      {completionLoading && (
        <div
          className="sql-completion-loading"
          role="status"
          aria-label="正在加载补全"
          style={{ left: completionLoading.left, top: completionLoading.top }}
        >
          正在加载补全…
        </div>
      )}

      {signatureHelp && (
        <div className="sql-signature" role="status" aria-label="函数签名">
          <strong>{signatureHelp.name}</strong>
          <span>(</span>
          {signatureHelp.parameters.map((parameter, index) => (
            <span key={`${parameter}-${index}`}>
              <span
                className={
                  index === signatureHelp.activeParameter ? 'sql-signature-active' : undefined
                }
              >
                {parameter}
              </span>
              {index < signatureHelp.parameters.length - 1 ? ', ' : ''}
            </span>
          ))}
          <span>)</span>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: '执行 SQL',
              onSelect: runFromView,
            },
            {
              label: '格式化 SQL',
              disabled: !props.onFormat && !props.formatSql,
              onSelect: formatFromView,
            },
            {
              label: '复制',
              disabled: !menu.hasSelection,
              onSelect: () => void copySelection(),
            },
            {
              label: '剪切',
              disabled: !menu.hasSelection,
              onSelect: () => void cutSelection(),
            },
            {
              label: '粘贴',
              disabled: !menu.canPaste,
              onSelect: () => void pasteFromClipboard(),
            },
            {
              label: '从历史插入',
              disabled: !props.onOpenHistory,
              onSelect: () => props.onOpenHistory?.(),
            },
          ]}
        />
      )}
    </div>
  );
}
