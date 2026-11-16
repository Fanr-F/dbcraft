import { useEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseType, ShortcutMap } from '@shared/ipc-contract';
import { DEFAULT_SHORTCUTS } from '@shared/settings';
import { matchesShortcut } from '../../utils/shortcuts';
import { tokenizeSql } from '../../utils/sql-highlight';
import { statementAtCursor } from '../../utils/sql-script';
import { findBracketMatch, type BracketMatch } from '../../utils/sql-brackets';
import {
  applyCompletion,
  completionCandidatesForContext,
  extractCompletionContext,
  extractSignatureHelp,
  rankCompletions,
  shouldOpenCompletionOnInput,
  type CompletionCandidate,
  type CompletionContext,
  type CompletionGroups,
  type CompletionKind,
  type RankedCompletion,
  type SignatureHelp,
} from '../../utils/sql-completion';
import { ContextMenu } from '../../components/ContextMenu';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 传入选中的 SQL 片段；没有选区时传光标所在语句，定位失败时 undefined（执行全文）。 */
  onRun: (sql?: string) => void;
  onSave?: () => void;
  onFormat?: () => void;
  /** 右键「从历史插入」入口。 */
  onOpenHistory?: () => void;
  /** 一次性插入请求；token 变化时在光标处插入 text。 */
  insertRequest?: { text: string; token: number } | null;
  /** 选区变化时上报选中文本（空字符串表示没有选中）。 */
  onSelectionChange?: (selected: string) => void;
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
  /** 当前连接的方言；用于函数签名提示。 */
  dialect?: DatabaseType | null;
  shortcuts?: ShortcutMap;
}

interface CompletionState {
  items: RankedCompletion[];
  start: number;
  end: number;
  left: number;
  top: number;
}

interface CompletionPosition {
  left: number;
  top: number;
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

export function SqlEditor({
  value,
  onChange,
  onRun,
  onSave,
  onFormat,
  onOpenHistory,
  insertRequest,
  onSelectionChange,
  completionGroups,
  completionEnabled = true,
  completionAutoTrigger = true,
  completionDelayMs = 0,
  onRequestCompletion,
  dialect = null,
  shortcuts = DEFAULT_SHORTCUTS,
}: SqlEditorProps) {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastInsertToken = useRef<number | null>(null);
  const completionRequest = useRef(0);
  const completionTimer = useRef<number | null>(null);
  /** 最近一次输入后的光标位置：用来识别浏览器在每次输入后补发的 select 事件。 */
  const lastInputCaret = useRef<number | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const measureCanvas = useRef<HTMLCanvasElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [completionLoading, setCompletionLoading] = useState<CompletionPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [cursorLine, setCursorLine] = useState(0);
  const [lineHeight, setLineHeight] = useState(20);
  const [bracketMatch, setBracketMatch] = useState<BracketMatch | null>(null);
  const [signatureHelp, setSignatureHelp] = useState<SignatureHelp | null>(null);
  const tokens = useMemo(() => tokenizeSql(value), [value]);
  const tokenOffsets = useMemo(() => {
    let offset = 0;
    return tokens.map((token) => {
      const start = offset;
      offset += token.text.length;
      return start;
    });
  }, [tokens]);
  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const gutterWidth = Math.max(44, String(lineCount).length * 9 + 22);

  const syncScroll = (element: HTMLTextAreaElement) => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    highlight.scrollTop = element.scrollTop;
    highlight.scrollLeft = element.scrollLeft;
  };

  const updateBracketMatch = (element: HTMLTextAreaElement) => {
    setBracketMatch(findBracketMatch(tokens, element.selectionStart));
  };

  const updateSignatureHelp = (element: HTMLTextAreaElement) => {
    if (!dialect) {
      setSignatureHelp(null);
      return;
    }
    setSignatureHelp(
      extractSignatureHelp(element.value, element.selectionStart, dialect),
    );
  };

  const updateCursorLine = (element: HTMLTextAreaElement) => {
    const line = element.value.slice(0, element.selectionStart).split('\n').length - 1;
    setCursorLine(line);
    const measured = Number.parseFloat(getComputedStyle(element).lineHeight);
    if (Number.isFinite(measured) && measured > 0) setLineHeight(measured);
    setScrollTop(element.scrollTop);
  };

  /** 上报选区文本，供工具栏“执行”决定只跑选中内容还是全文。 */
  const reportSelection = (element: HTMLTextAreaElement) => {
    onSelectionChange?.(element.value.slice(element.selectionStart, element.selectionEnd));
  };

  /** 用 canvas 量出光标前文本宽度，让补全弹层贴着光标而不是固定在左下角。 */
  const measureLineWidth = (element: HTMLTextAreaElement, lineText: string): number => {
    const style = getComputedStyle(element);
    const canvas = measureCanvas.current ?? document.createElement('canvas');
    measureCanvas.current = canvas;
    const context = canvas.getContext('2d');
    const fallback = lineText.length * (Number.parseFloat(style.fontSize) || 13) * 0.6;
    if (!context) return fallback;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const tabSize =
      Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sql-tab-size'),
        10,
      ) || 2;
    return context.measureText(lineText.replace(/\t/g, ' '.repeat(tabSize))).width;
  };

  const caretPosition = (element: HTMLTextAreaElement): CompletionPosition => {
    const before = element.value.slice(0, element.selectionStart);
    const lineIndex = (before.match(/\n/g) ?? []).length;
    const lineText = before.slice(before.lastIndexOf('\n') + 1);
    const style = getComputedStyle(element);
    const measured = Number.parseFloat(style.lineHeight);
    const line = Number.isFinite(measured) && measured > 0 ? measured : lineHeight;
    const textWidth = measureLineWidth(element, lineText);
    const maxLeft = Math.max(gutterWidth + 4, element.clientWidth - 230);
    const left = Math.max(
      gutterWidth + 4,
      Math.min(gutterWidth + textWidth - element.scrollLeft, maxLeft),
    );
    const caretTop = 12 + lineIndex * line - element.scrollTop;
    const menuHeight = 200;
    const above = caretTop + line + menuHeight > element.clientHeight;
    const top = above
      ? Math.max(4, caretTop - menuHeight - 4)
      : Math.max(
          4,
          Math.min(caretTop + line + 2, Math.max(4, element.clientHeight - menuHeight - 4)),
        );
    return { left, top };
  };

  const openCompletion = async () => {
    if (!completionEnabled) return;
    const element = textareaRef.current;
    if (!element) return;
    const text = element.value;
    // 超长 SQL 不做补全（与执行前的 >1MB 提示保持一致）。
    if (text.length > 1_000_000) {
      setCompletion(null);
      setCompletionLoading(null);
      return;
    }
    const context = extractCompletionContext(text, element.selectionStart);
    // 字符串/注释里不弹补全，避免把列名插进字面量。
    if (context.inLiteral) {
      setCompletion(null);
      setCompletionLoading(null);
      return;
    }
    const groups: CompletionGroups = completionGroups ?? {
      keywords: [],
      functions: [],
      objects: [],
      databases: [],
      schemas: [],
    };
    const base = completionCandidatesForContext(context, groups);
    const request = completionRequest.current + 1;
    completionRequest.current = request;

    // 只有需要异步加载（列/限定对象）时才显示加载态，避免本地关键字候选闪烁。
    let loadingTimer: number | null = null;
    if (onRequestCompletion && base.length === 0) {
      const position = caretPosition(element);
      loadingTimer = window.setTimeout(() => setCompletionLoading(position), 120);
    }

    let extra: CompletionCandidate[] = [];
    if (onRequestCompletion) {
      try {
        extra = await onRequestCompletion(context);
      } catch {
        extra = [];
      }
    }
    if (loadingTimer !== null) window.clearTimeout(loadingTimer);
    setCompletionLoading(null);
    if (completionRequest.current !== request) return;

    // 排序规则：前缀 > 单词开头 > 模糊子序列；同分再按列/别名/表等类型优先级。
    const ranked = rankCompletions([...extra, ...base], context.needle);
    if (ranked.length === 0) {
      setCompletion(null);
      return;
    }
    setCompletion({
      items: ranked,
      start: context.replaceStart,
      end: context.replaceEnd,
      ...caretPosition(element),
    });
    setActiveIndex(0);
  };

  const clearCompletionTimer = () => {
    if (completionTimer.current !== null) {
      window.clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
  };

  const scheduleCompletion = () => {
    clearCompletionTimer();
    completionTimer.current = window.setTimeout(() => {
      completionTimer.current = null;
      void openCompletion();
    }, Math.max(0, completionDelayMs));
  };

  // 键盘选择超出可视区时自动滚动，避免“选中项看不见”。
  useEffect(() => {
    if (!completion) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, completion]);

  const acceptCompletion = (index: number) => {
    clearCompletionTimer();
    const element = textareaRef.current;
    if (!completion || !element) return;
    const item = completion.items[index];
    if (!item) return;

    const next = applyCompletion(
      element.value,
      completion.start,
      completion.end,
      item.label,
      { insertText: item.insertText },
    );
    onChange(next.text);
    setCompletion(null);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.cursor, next.cursor);
    });
  };

  // 历史面板选择记录后，把 SQL 插到当前光标/选区位置，而不是覆盖整个编辑器。
  useEffect(() => {
    if (!insertRequest || lastInsertToken.current === insertRequest.token) return;
    const element = textareaRef.current;
    if (!element) return;
    lastInsertToken.current = insertRequest.token;

    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const before = element.value.slice(0, start);
    const after = element.value.slice(end);
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
    onChange(`${before}${prefix}${insertRequest.text}${suffix}${after}`);

    const cursor = before.length + prefix.length + insertRequest.text.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(cursor, cursor);
    });
  }, [insertRequest, onChange]);

  /** 把命中的前缀/子序列字符包成高亮片段。 */
  const renderCompletionLabel = (item: RankedCompletion) => {
    if (item.matches.length === 0) return item.label;
    const marked = new Set(item.matches);
    return item.label.split('').map((char, index) =>
      marked.has(index) ? (
        <mark key={index} className="sql-completion-match">
          {char}
        </mark>
      ) : (
        char
      ),
    );
  };

  /** 引号/括号自动配对：仅在光标无选区时插入成对字符，闭括号已存在时跳过而不是重复输入。 */
  const handleAutoPair = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.nativeEvent.isComposing) return false;
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start !== end) return false;
    const key = event.key;
    const pairs: Record<string, string> = {
      '(': ')',
      '[': ']',
      "'": "'",
      '"': '"',
      '`': '`',
    };
    const closing = pairs[key];
    if (closing !== undefined) {
      // 单词中间的单引号（如 O'Brien）不配对，避免破坏已有内容。
      if (key === "'" && /[A-Za-z0-9_]/.test(element.value[start - 1] ?? '')) return false;
      event.preventDefault();
      setCompletion(null);
      const next = `${element.value.slice(0, start)}${key}${closing}${element.value.slice(start)}`;
      onChange(next);
      requestAnimationFrame(() => {
        element.setSelectionRange(start + 1, start + 1);
      });
      return true;
    }
    if ([')', ']', "'", '"', '`'].includes(key) && element.value[start] === key) {
      event.preventDefault();
      requestAnimationFrame(() => {
        element.setSelectionRange(start + 1, start + 1);
      });
      return true;
    }
    return false;
  };

  return (
    <div
      className={`sql-editor-wrap ${composing ? 'is-composing' : ''}`}
      style={{ ['--sql-gutter-width' as string]: `${gutterWidth}px` }}
    >
      <div className="sql-gutter" aria-hidden="true">
        <div
          className="sql-gutter-inner"
          style={{ transform: `translateY(-${scrollTop}px)` }}
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index} className="sql-gutter-line">
              {index + 1}
            </div>
          ))}
        </div>
      </div>
      <div
        className="sql-current-line"
        aria-hidden="true"
        style={{
          top: 12 + cursorLine * lineHeight - scrollTop,
          height: lineHeight,
        }}
      />
      <pre ref={highlightRef} className="sql-highlight" aria-hidden="true">
        {tokens.map((token, index) => {
          const offset = tokenOffsets[index] ?? 0;
          const matched =
            bracketMatch !== null &&
            (offset === bracketMatch.open || offset === bracketMatch.close);
          return (
            <span
              key={index}
              className={`sql-tok-${token.type}${matched ? ' sql-bracket-match' : ''}`}
            >
              {token.text}
            </span>
          );
        })}
        {'\n'}
      </pre>
      <textarea
        ref={textareaRef}
        className="sql-editor"
        aria-label="SQL 编辑器"
        spellCheck={false}
        wrap="off"
        value={value}
        onChange={(event) => {
          completionRequest.current += 1;
          clearCompletionTimer();
          setCompletion(null);
          setBracketMatch(null);
          const next = event.target.value;
          const cursor = event.target.selectionStart;
          const inserted = next.length >= value.length;
          lastInputCaret.current = cursor;
          onChange(next);
          updateCursorLine(event.currentTarget);
          requestAnimationFrame(() => {
            const element = textareaRef.current;
            if (element) updateSignatureHelp(element);
          });
          if (
            !composing &&
            completionAutoTrigger &&
            shouldOpenCompletionOnInput(next, cursor, { inserted })
          ) {
            scheduleCompletion();
          }
          reportSelection(event.currentTarget);
        }}
        onScroll={(event) => {
          syncScroll(event.currentTarget);
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onSelect={(event) => {
          const element = event.currentTarget;
          // 浏览器在每次输入后也会补发 select（光标随字符移动）。这类 select 不能关掉刚弹出的
          // 补全，否则弹层会“闪一下就消失”；只有真的移动光标/选中文本才作废旧上下文。
          const caret = element.selectionStart;
          const typingEcho =
            caret === element.selectionEnd && lastInputCaret.current === caret;
          if (!typingEcho) {
            // 光标移动/点击后旧补全的替换区间已失效，先关闭并作废未完成的异步请求。
            lastInputCaret.current = null;
            completionRequest.current += 1;
            setCompletion(null);
            setCompletionLoading(null);
          }
          updateBracketMatch(element);
          updateSignatureHelp(element);
          updateCursorLine(element);
          reportSelection(element);
        }}
        onKeyUp={(event) => {
          updateBracketMatch(event.currentTarget);
          updateSignatureHelp(event.currentTarget);
          updateCursorLine(event.currentTarget);
          reportSelection(event.currentTarget);
        }}
        onClick={(event) => {
          completionRequest.current += 1;
          setCompletion(null);
          setCompletionLoading(null);
          updateBracketMatch(event.currentTarget);
          updateSignatureHelp(event.currentTarget);
          updateCursorLine(event.currentTarget);
          reportSelection(event.currentTarget);
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onBlur={() => {
          completionRequest.current += 1;
          clearCompletionTimer();
          setCompletion(null);
          setCompletionLoading(null);
          setSignatureHelp(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (matchesShortcut(event, shortcuts.complete)) {
            event.preventDefault();
            openCompletion();
            return;
          }

          if (handleAutoPair(event)) return;

          if (completion) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % completion.items.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(
                (current) => (current - 1 + completion.items.length) % completion.items.length,
              );
              return;
            }
            if (event.key === 'Home' || event.key === 'PageUp') {
              event.preventDefault();
              setActiveIndex(0);
              return;
            }
            if (event.key === 'End' || event.key === 'PageDown') {
              event.preventDefault();
              setActiveIndex(completion.items.length - 1);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              acceptCompletion(activeIndex);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              completionRequest.current += 1;
              clearCompletionTimer();
              setCompletion(null);
              return;
            }
            // 左右移动光标会让替换区间失效，直接关闭由浏览器处理移动。
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              completionRequest.current += 1;
              setCompletion(null);
            }
          }

          if (matchesShortcut(event, shortcuts.run)) {
            event.preventDefault();
            const target = event.currentTarget;
            const selected = target.value
              .slice(target.selectionStart, target.selectionEnd)
              .trim();
            onRun(
              selected.length > 0
                ? selected
                : statementAtCursor(target.value, target.selectionStart, dialect ?? undefined) ?? undefined,
            );
          } else if (matchesShortcut(event, shortcuts.save)) {
            event.preventDefault();
            onSave?.();
          } else if (matchesShortcut(event, shortcuts.format)) {
            event.preventDefault();
            onFormat?.();
          }
        }}
      />

      {completion && (
        <div
          className="sql-completion"
          role="listbox"
          aria-label="SQL 补全"
          style={{ left: completion.left, top: completion.top }}
        >
          {completion.items.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`sql-completion-item ${index === activeIndex ? 'is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => acceptCompletion(index)}
            >
              <span className="sql-completion-label">{renderCompletionLabel(item)}</span>
              <span className="sql-completion-detail">
                {item.detail ?? KIND_LABELS[item.kind]}
              </span>
            </button>
          ))}
        </div>
      )}

      {!completion && completionLoading && (
        <div
          className="sql-completion is-loading"
          role="status"
          aria-label="正在加载补全"
          style={{ left: completionLoading.left, top: completionLoading.top }}
        >
          <span className="sql-completion-loading">正在加载补全…</span>
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
              label: '从历史插入',
              disabled: !onOpenHistory,
              onSelect: () => onOpenHistory?.(),
            },
            {
              label: '格式化 SQL',
              disabled: !onFormat,
              onSelect: () => onFormat?.(),
            },
          ]}
        />
      )}
    </div>
  );
}
