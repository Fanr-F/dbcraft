import { useEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseType } from '@shared/ipc-contract';
import { tokenizeSql } from '../../utils/sql-highlight';
import { findBracketMatch, type BracketMatch } from '../../utils/sql-brackets';
import {
  applyCompletion,
  extractCompletionContext,
  extractSignatureHelp,
  filterCompletions,
  shouldAutoTriggerCompletion,
  type CompletionContext,
  type SignatureHelp,
} from '../../utils/sql-completion';
import { ContextMenu } from '../../components/ContextMenu';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 传入选中的 SQL 片段；没有选区时为 undefined（执行全文）。 */
  onRun: (sql?: string) => void;
  onSave?: () => void;
  onFormat?: () => void;
  /** 右键「从历史插入」入口。 */
  onOpenHistory?: () => void;
  /** 一次性插入请求；token 变化时在光标处插入 text。 */
  insertRequest?: { text: string; token: number } | null;
  /** 关键字 + 当前连接对象名。 */
  completionItems?: string[];
  /** 按光标上下文异步补充列/别名等候选。 */
  onRequestCompletion?: (context: CompletionContext) => Promise<string[]>;
  /** 当前连接的方言；用于函数签名提示。 */
  dialect?: DatabaseType | null;
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
  completionItems = [],
  onRequestCompletion,
  dialect = null,
}: SqlEditorProps) {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastInsertToken = useRef<number | null>(null);
  const completionRequest = useRef(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
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

  const openCompletion = async () => {
    const element = textareaRef.current;
    if (!element) return;
    const context = extractCompletionContext(element.value, element.selectionStart);
    const base = context.qualifier
      ? []
      : filterCompletions(completionItems, context.needle);
    const request = completionRequest.current + 1;
    completionRequest.current = request;

    let extra: string[] = [];
    if (onRequestCompletion) {
      try {
        extra = await onRequestCompletion(context);
      } catch {
        extra = [];
      }
    }
    if (completionRequest.current !== request) return;

    const filtered = filterCompletions([...extra, ...base], context.needle);
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

  const acceptCompletion = (index: number) => {
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
          setCompletion(null);
          setBracketMatch(null);
          const next = event.target.value;
          onChange(next);
          requestAnimationFrame(() => {
            const element = textareaRef.current;
            if (element) updateSignatureHelp(element);
          });
          if (
            !composing &&
            (next.endsWith('.') ||
              shouldAutoTriggerCompletion(next, event.target.selectionStart))
          ) {
            window.setTimeout(() => void openCompletion(), 0);
          }
        }}
        onScroll={(event) => {
          syncScroll(event.currentTarget);
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onSelect={(event) => {
          updateBracketMatch(event.currentTarget);
          updateSignatureHelp(event.currentTarget);
        }}
        onKeyUp={(event) => {
          updateBracketMatch(event.currentTarget);
          updateSignatureHelp(event.currentTarget);
        }}
        onClick={(event) => {
          updateBracketMatch(event.currentTarget);
          updateSignatureHelp(event.currentTarget);
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onBlur={() => {
          completionRequest.current += 1;
          setCompletion(null);
          setSignatureHelp(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
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
              setCompletion(null);
              return;
            }
          }

          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            const target = event.currentTarget;
            const selected = target.value
              .slice(target.selectionStart, target.selectionEnd)
              .trim();
            onRun(selected.length > 0 ? selected : undefined);
          } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            onSave?.();
          } else if (
            (event.ctrlKey || event.metaKey) &&
            event.shiftKey &&
            event.key.toLowerCase() === 'f'
          ) {
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
