import { useMemo, useRef, useState } from 'react';
import { tokenizeSql } from '../../utils/sql-highlight';
import { findBracketMatch, type BracketMatch } from '../../utils/sql-brackets';
import {
  applyCompletion,
  extractCompletionContext,
  filterCompletions,
} from '../../utils/sql-completion';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 传入选中的 SQL 片段；没有选区时为 undefined（执行全文）。 */
  onRun: (sql?: string) => void;
  onSave?: () => void;
  onFormat?: () => void;
  /** 关键字 + 当前连接对象名。 */
  completionItems?: string[];
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
  completionItems = [],
}: SqlEditorProps) {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [composing, setComposing] = useState(false);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [bracketMatch, setBracketMatch] = useState<BracketMatch | null>(null);
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

  const openCompletion = () => {
    const element = textareaRef.current;
    if (!element) return;
    const context = extractCompletionContext(element.value, element.selectionStart);
    const filtered = filterCompletions(completionItems, context.prefix);
    if (filtered.length === 0) return;
    setCompletion({ items: filtered, start: context.start, end: element.selectionStart });
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
          setCompletion(null);
          setBracketMatch(null);
          onChange(event.target.value);
        }}
        onScroll={(event) => {
          syncScroll(event.currentTarget);
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onSelect={(event) => updateBracketMatch(event.currentTarget)}
        onKeyUp={(event) => updateBracketMatch(event.currentTarget)}
        onClick={(event) => updateBracketMatch(event.currentTarget)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onBlur={() => setCompletion(null)}
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
    </div>
  );
}
