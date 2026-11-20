import type { QueryCell } from './ipc-contract';

/**
 * 解析 Excel / 剪贴板 TSV。
 * Excel 复制区域时用 Tab 分列、换行分行；单元格内含 Tab/换行时会用双引号包裹，
 * 内部的双引号写成 `""`。这里按这个约定解析，不做方言相关处理。
 */
export function parseClipboardTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let position = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (position < text.length) {
    const char = text[position]!;
    if (quoted) {
      if (char === '"') {
        if (text[position + 1] === '"') {
          field += '"';
          position += 2;
          continue;
        }
        quoted = false;
        position += 1;
        continue;
      }
      field += char;
      position += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      position += 1;
      continue;
    }
    if (char === '\t') {
      pushField();
      position += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[position + 1] === '\n') position += 1;
      pushRow();
      position += 1;
      continue;
    }
    field += char;
    position += 1;
  }

  pushRow();
  // 末尾换行（以及全空文本）会多产生一个空行；保留至少一行。
  while (rows.length > 1) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === '') rows.pop();
    else break;
  }
  return rows;
}

/** 粘贴单元格的取值：空白单元格按 NULL/默认值处理，其余保持原始字符串。 */
export function normalizePastedValue(raw: string): QueryCell {
  return raw === '' ? null : raw;
}

function parseEnumOptions(body: string): string[] {
  const options: string[] = [];
  const pattern = /'((?:[^']|'')*)'|"((?:[^"]|"")*)"|([^,]+)/g;
  let item: RegExpExecArray | null;
  while ((item = pattern.exec(body)) !== null) {
    const raw = item[1] ?? item[2] ?? item[3] ?? '';
    const value = raw.trim().replace(/''/g, "'").replace(/""/g, '"');
    if (value !== '') options.push(value);
  }
  return options;
}

/**
 * 按列声明类型做粘贴时的轻量校验。
 * 只拦截明显不可能写入的输入（数字列贴了中文、布尔贴了 2、超出 varchar 长度等），
 * 日期/时间交给宿主环境解析；未知类型一律放行，避免误报。
 */
export function pastedValueError(
  declaredType: string | null | undefined,
  value: QueryCell,
): string | null {
  if (value === null || value === undefined) return null;
  const type = (declaredType ?? '').trim();
  if (!type) return null;
  const text = String(value).trim();
  if (text === '') return null;

  const enumMatch = /^enum\s*\((.*)\)$/i.exec(type);
  if (enumMatch) {
    const options = parseEnumOptions(enumMatch[1] ?? '');
    return options.length > 0 && !options.includes(String(value))
      ? '不在枚举可选值内'
      : null;
  }

  const length = /^(?:n?char|n?varchar|varchar2|nvarchar2|character varying)\s*\(\s*(\d+)/i.exec(
    type,
  );
  if (length && text.length > Number(length[1])) {
    return `超过长度 ${length[1]}`;
  }

  if (/^(bit|bool|boolean)\b/i.test(type) || /^tinyint\s*\(\s*1\s*\)/i.test(type)) {
    return /^(0|1|true|false)$/i.test(text) ? null : '需要 0/1 或 true/false';
  }
  if (
    /^(tinyint|smallint|mediumint|int|integer|bigint|serial|bigserial|smallserial)\b/i.test(type)
  ) {
    return /^[+-]?\d+$/.test(text) ? null : '需要整数';
  }
  if (/^(decimal|numeric|number|float|double|real|money|smallmoney)\b/i.test(type)) {
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)
      ? null
      : '需要数字';
  }
  if (/^time(\s|\(|$)/i.test(type)) {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(text);
    if (!match) return '需要 HH:MM[:SS] 格式';
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = match[3] === undefined ? 0 : Number(match[3]);
    return hours <= 23 && minutes <= 59 && seconds <= 59
      ? null
      : '需要 HH:MM[:SS] 格式';
  }
  if (/^(date|datetime|datetime2|smalldatetime|datetimeoffset|timestamp)\b/i.test(type)) {
    return Number.isNaN(Date.parse(text)) ? '日期时间格式无法识别' : null;
  }
  if (/^year\b/i.test(type)) {
    return /^\d{4}$/.test(text) ? null : '需要四位年份';
  }

  return null;
}
