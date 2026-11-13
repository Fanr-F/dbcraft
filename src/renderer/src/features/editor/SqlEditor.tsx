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
  filterCompletions,
  shouldOpenCompletionOnInput,
  type CompletionCandidate,
  type CompletionContext,
  type CompletionGroups,
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
  /** 补全项的类型详情（列名 → 类型）。 */
  completionDetails?: Record<string, string>;
  /** 是否启用补全。 */
  completionEnabled?: boolean;
  /** 自动补全延迟（毫秒）。 */
  completionDelayMs?: number;
  /** 按光标上下文异步补充列/别名等候选。 */
  onRequestCompletion?: (context: CompletionContext) => Promise<CompletionCandidate[]>;
  /** 当前连接的方言；用于函数签名提示。 */
  dialect?: DatabaseType | null;
  shortcuts?: ShortcutMap;
}

interface CompletionState {
  items: string[];
  start: number;
  end: number;
}

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
  completionDetails,
  completionEnabled = true,
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
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

  const openCompletion = async () => {
    if (!completionEnabled) return;
    const element = textareaRef.current;
    if (!element) return;
    const context = extractCompletionContext(element.value, element.selectionStart);
    const groups: CompletionGroups = completionGroups ?? {
      keywords: [],
      functions: [],
      objects: [],
      databases: [],
      schemas: [],
    };
    const base: CompletionCandidate[] = completionCandidatesForContext(context, groups);
    const request = completionRequest.current + 1;
    completionRequest.current = request;

    let extra: CompletionCandidate[] = [];
    if (onRequestCompletion) {
      try {
        extra = await onRequestCompletion(context);
      } catch {
        extra = [];
      }
    }
    if (completionRequest.current !== request) return;

    // 按上下文分类的候选先合并去重，再做前缀/包含匹配。
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const candidate of [...extra, ...base]) {
      const key = candidate.label.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      labels.push(candidate.label);
    }
    const filtered = filterCompletions(labels, context.needle);
    if (filtered.length === 0) {
      setCompletion(null);
      return;
    }
    setCompletion({
      items: filtered,
      start: context.replaceStart,
      end: element.selectionStart,
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
      item,
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
          onChange(next);
          updateCursorLine(event.currentTarget);
          requestAnimationFrame(() => {
            const element = textareaRef.current;
            if (element) updateSignatureHelp(element);
          });
          if (!composing && shouldOpenCompletionOnInput(next, cursor, { inserted })) {
            scheduleCompletion();
          }
          reportSelection(event.currentTarget);
        }}
        onScroll={(event) => {
          syncScroll(event.currentTarget);
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onSelect={(event) => {
          updateBracketMatch(event.currentTarget);
          updateSignatureHelp(event.currentTarget);
          updateCursorLine(event.currentTarget);
          reportSelection(event.currentTarget);
        }}
        onKeyUp={(event) => {
          updateBracketMatch(event.currentTarget);
          updateSignatureHelp(event.currentTarget);
          updateCursorLine(event.currentTarget);
          reportSelection(event.currentTarget);
        }}
        onClick={(event) => {
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
        <div className="sql-completion" role="listbox" aria-label="SQL 补全">
          {completion.items.map((item, index) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`sql-completion-item ${index === activeIndex ? 'is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => acceptCompletion(index)}
            >
              {item}
              {completionDetails?.[item] && (
                <span className="sql-completion-detail">{completionDetails[item]}</span>
              )}
            </button>
          ))}
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
