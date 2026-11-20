/**
 * Excel / TSV 粘贴解析与按列类型校验的纯逻辑测试。
 *
 * 运行：npm run test:table-paste
 */
import {
  normalizePastedValue,
  parseClipboardTsv,
  pastedValueError,
} from '../src/shared/table-paste.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
}

// TSV：Tab 分列、LF/CRLF 分行。
equal(parseClipboardTsv('a\tb\nc\td'), [['a', 'b'], ['c', 'd']], 'basic TSV');
equal(parseClipboardTsv('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']], 'CRLF + trailing newline');
equal(parseClipboardTsv('a\t\tb'), [['a', '', 'b']], 'empty middle field');
equal(parseClipboardTsv('a'), [['a']], 'single cell');
equal(parseClipboardTsv(''), [['']], 'empty text');

// 引号：单元格内的 Tab、换行、双引号。
equal(
  parseClipboardTsv('"a\tb"\t"c\nd"\t"say ""hi"""'),
  [['a\tb', 'c\nd', 'say "hi"']],
  'quoted fields keep tabs/newlines and unescape quotes',
);
equal(parseClipboardTsv('x\t"y"'), [['x', 'y']], 'quoted plain field');
equal(parseClipboardTsv('"unterminated\tz'), [['unterminated\tz']], 'unterminated quote is literal');

// 空白单元格 → NULL；空串按默认值处理。
assert(normalizePastedValue('') === null, 'blank pasted value should be null');
assert(normalizePastedValue(' ') === ' ', 'whitespace is preserved');
assert(normalizePastedValue('0') === '0', 'zero stays string');

// 类型校验：合法值。
for (const [type, value] of [
  ['int', '42'],
  ['bigint', '-7'],
  ['decimal(10,2)', '3.14'],
  ['numeric(18,4)', '1e3'],
  ['bit', 'true'],
  ['bit', '0'],
  ['boolean', 'FALSE'],
  ['tinyint(1)', '1'],
  ['varchar(10)', 'hello'],
  ['nvarchar(2)', '中文'],
  ['date', '2024-01-02'],
  ['datetime', '2024-01-02 03:04:05'],
  ['time', '12:30'],
  ['time(3)', '12:30:45.123'],
  ['year', '2024'],
  ["enum('a','b')", 'a'],
  ['TEXT', '随便写'],
]) {
  assert(pastedValueError(type, value) === null, `${type} should accept ${value}`);
}

// 类型校验：明显非法值。
assert(pastedValueError('int', '1.5') === '需要整数', 'int rejects decimal');
assert(pastedValueError('int', 'abc') === '需要整数', 'int rejects text');
assert(pastedValueError('decimal(10,2)', 'abc') === '需要数字', 'decimal rejects text');
assert(pastedValueError('bit', '2') !== null, 'bit rejects 2');
assert(pastedValueError('varchar(3)', 'abcd') === '超过长度 3', 'varchar length');
assert(pastedValueError("enum('a','b')", 'c') === '不在枚举可选值内', 'enum membership');
assert(pastedValueError('year', '24') === '需要四位年份', 'year format');
assert(pastedValueError('time', '25:99') !== null, 'time format');
assert(pastedValueError('date', 'not-a-date') === '日期时间格式无法识别', 'date format');

// NULL / 空串 / 未知类型不报错。
assert(pastedValueError('int', null) === null, 'null is valid');
assert(pastedValueError('int', '') === null, 'empty is treated as null/default');
assert(pastedValueError('', 'abc') === null, 'missing type skips validation');
assert(pastedValueError('geometry', 'POINT(1 2)') === null, 'unknown type passes');

console.log('table paste tests passed');
