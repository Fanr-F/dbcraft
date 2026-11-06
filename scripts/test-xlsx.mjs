/**
 * 零依赖 XLSX 生成器的纯逻辑测试：校验 ZIP 结构、必需部件与单元格 XML。
 *
 * 运行：npm run test:xlsx
 */
import { buildXlsx, columnName } from '../src/main/export/xlsx.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readZip(buffer) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  assert(eocd >= 0, 'EOCD not found');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    assert(buffer.readUInt32LE(offset) === 0x02014b50, 'central header signature wrong');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    assert(buffer.readUInt32LE(localOffset) === 0x04034b50, 'local header signature wrong');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const size = buffer.readUInt32LE(offset + 20);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, buffer.subarray(start, start + size));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

assert(columnName(0) === 'A', 'A wrong');
assert(columnName(25) === 'Z', 'Z wrong');
assert(columnName(26) === 'AA', 'AA wrong');
assert(columnName(701) === 'ZZ', 'ZZ wrong');
assert(columnName(702) === 'AAA', 'AAA wrong');

const buffer = buildXlsx({
  columns: ['id', 'name', 'flag', 'empty'],
  rows: [
    [1, 'A&B <x>', true, null],
    [2, '中文', false, 'x'],
  ],
});

assert(buffer.readUInt32LE(0) === 0x04034b50, 'zip should start with local header');

const entries = readZip(buffer);
for (const name of [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
  'xl/worksheets/sheet1.xml',
]) {
  assert(entries.has(name), `missing ${name}`);
}

const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
assert(sheet.startsWith('<?xml'), 'sheet should be XML');
assert(sheet.includes('r="A1"'), 'header cell A1 missing');
assert(sheet.includes('r="B2"'), 'string cell B2 missing');
assert(sheet.includes('A&amp;B &lt;x&gt;'), 'XML escaping wrong');
assert(sheet.includes('<c r="A2"><v>1</v></c>'), 'number cell wrong');
assert(sheet.includes('<c r="C2" t="b"><v>1</v></c>'), 'boolean cell wrong');
assert(!sheet.includes('r="D2"'), 'NULL cell should be omitted');
assert(sheet.includes('中文'), 'unicode text missing');

const workbook = entries.get('xl/workbook.xml').toString('utf8');
assert(workbook.includes('sheet1.xml') === false, 'workbook should reference via rels');
assert(workbook.includes('name="Sheet1"'), 'sheet name missing');

const contentTypes = entries.get('[Content_Types].xml').toString('utf8');
assert(contentTypes.includes('spreadsheetml.sheet.main+xml'), 'content type missing');

console.log('xlsx export check passed');
