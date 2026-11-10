import type { ColumnDataSchemaModel, EditorBase, EditorCtr } from '@revolist/revogrid';

type EditorKind = 'text' | 'number' | 'date' | 'boolean' | 'textarea' | 'enum';

/**
 * 按列声明类型选择的轻量编辑器。
 * 不改变值的存储格式：除显式选择 NULL/枚举外，保存的仍是编辑器里的字符串。
 */
class TypedCellEditor implements EditorBase {
  element: Element | null = null;
  editCell: any;

  constructor(
    private readonly saveCallback: (value: unknown, preventFocus?: boolean) => void,
    private readonly kind: EditorKind,
    private readonly options: string[] = [],
  ) {}

  componentDidRender(): void {
    setTimeout(() => {
      const element = this.element as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null;
      if (!element) return;
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.select();
      }
    }, 0);
  }

  appendPendingInput(value: string): boolean {
    const element = this.element as HTMLInputElement | HTMLTextAreaElement | null;
    if (!element || (this.kind !== 'text' && this.kind !== 'textarea')) return false;
    element.value += value;
    element.focus();
    return true;
  }

  getValue(): unknown {
    const element = this.element as HTMLInputElement | HTMLTextAreaElement | null;
    return element ? element.value : '';
  }

  beforeDisconnect(): void {
    const element = this.element as HTMLElement | null;
    element?.blur();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const enter = event.key === 'Enter';
    const tab = event.key === 'Tab';
    if (this.kind === 'textarea' && enter && !event.ctrlKey && !event.metaKey) {
      // 大文本保留换行，Ctrl+Enter 才提交。
      return;
    }
    if ((enter || tab) && !event.isComposing) {
      this.beforeDisconnect();
      this.saveCallback(this.getValue(), tab);
    }
  }

  private currentValue(): string {
    const value = this.editCell?.val;
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? '1' : '0';
    return String(value);
  }

  render(h: any): any {
    const onKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
    const ref = (element: Element | null) => {
      this.element = element;
    };
    if (!this.editCell) {
      // editor 插件挂载前可能先渲染一次；保留空输入避免访问未初始化状态。
    }

    if (this.kind === 'boolean') {
      const current = this.currentValue();
      const normalized =
        current === '1' || current.toLowerCase() === 'true'
          ? '1'
          : current === '0' || current.toLowerCase() === 'false'
            ? '0'
            : '';
      return h(
        'select',
        {
          ref,
          value: normalized,
          onChange: (event: Event) => {
            const next = (event.target as HTMLSelectElement).value;
            this.saveCallback(next === '' ? null : next, false);
          },
        },
        [
          h('option', { value: '' }, 'NULL'),
          h('option', { value: '1' }, 'true / 1'),
          h('option', { value: '0' }, 'false / 0'),
        ],
      );
    }

    if (this.kind === 'enum') {
      const current = this.currentValue();
      return h(
        'select',
        {
          ref,
          value: this.options.includes(current) ? current : '',
          onChange: (event: Event) => {
            const next = (event.target as HTMLSelectElement).value;
            this.saveCallback(next === '' ? null : next, false);
          },
        },
        [
          h('option', { value: '' }, 'NULL'),
          ...this.options.map((option) => h('option', { value: option }, option)),
        ],
      );
    }

    if (this.kind === 'textarea') {
      return h('textarea', {
        ref,
        rows: 3,
        class: 'grid-typed-editor is-textarea',
        value: this.currentValue(),
        onKeyDown,
      });
    }

    const type = this.kind === 'number' ? 'number' : this.kind === 'date' ? 'date' : 'text';
    return h('input', {
      ref,
      type,
      ...(type === 'number' ? { step: 'any' } : {}),
      enterKeyHint: 'enter',
      class: 'grid-typed-editor',
      value: this.currentValue(),
      onKeyDown,
    });
  }
}

function parseEnumValues(declaredType: string): string[] {
  const match = /^enum\((.*)\)$/i.exec(declaredType.trim());
  if (!match) return [];
  const values: string[] = [];
  const pattern = /'((?:[^']|'')*)'|"((?:[^"]|"")*)"|([^,]+)/g;
  let item: RegExpExecArray | null;
  while ((item = pattern.exec(match[1]!)) !== null) {
    const raw = item[1] ?? item[2] ?? item[3] ?? '';
    const value = raw.trim().replace(/''/g, "'").replace(/""/g, '"');
    if (value !== '') values.push(value);
  }
  return values;
}

function editorKindFor(declaredType: string | null | undefined): EditorKind | null {
  const type = (declaredType ?? '').trim();
  if (!type) return null;
  if (/^enum\(/i.test(type)) return 'enum';
  if (/bit|bool/i.test(type)) return 'boolean';
  if (/int|numeric|decimal|number|real|float|double|money|serial/i.test(type)) {
    return 'number';
  }
  // 纯 date 才用原生日期框；datetime/timestamp 保留文本，避免丢时间部分。
  if (/^date$/i.test(type) || /\bdate\b/i.test(type) && !/datetime|timestamp/i.test(type)) {
    return 'date';
  }
  if (/text|blob|json|clob/i.test(type)) return 'textarea';
  return null;
}

/** 返回 RevoGrid 的 editor 定义；null 表示使用默认文本编辑器。 */
export function typedEditor(declaredType: string | null | undefined): EditorCtr | undefined {
  const kind = editorKindFor(declaredType);
  if (!kind) return undefined;
  const editorKind = kind;
  const options = kind === 'enum' ? parseEnumValues(declaredType ?? '') : [];
  if (kind === 'enum' && options.length === 0) return undefined;

  return class extends TypedCellEditor {
    constructor(_data: ColumnDataSchemaModel, save: (value: unknown, preventFocus?: boolean) => void) {
      super(save, editorKind, options);
    }
  } as unknown as EditorCtr;
}
