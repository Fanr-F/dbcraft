/**
 * 分组树构建与计数的纯逻辑测试。
 *
 * 运行：npm run test:groups
 */
import { buildGroupTree, countGroup } from '../src/renderer/src/utils/groups.ts';

function connection(id, name, group) {
  return {
    id,
    input: { type: 'sqlite', filePath: 'demo.db', name, group, env: 'dev' },
    passwordStored: false,
    createdAt: '',
    updatedAt: '',
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tree = buildGroupTree([
  connection('u1', 'Uncategorized B', ''),
  connection('u2', 'Uncategorized A', '   '),
  connection('a1', 'Alpha One', 'A'),
  connection('b1', 'Beta Two', 'A/B'),
  connection('b2', 'Beta One', ' A / B '),
  connection('c1', 'Gamma', 'A/C'),
  connection('d1', 'Delta', 'A/B/C'),
  connection('e1', 'Root E', '///'),
]);

assert(tree.connections.length === 3, 'expected 3 ungrouped connections');
assert(
  tree.connections.map((item) => item.input.name).join(',') ===
    'Root E,Uncategorized A,Uncategorized B',
  'ungrouped connections are not sorted',
);

assert(tree.children.length === 1 && tree.children[0].path === 'A', 'expected single root group A');
const a = tree.children[0];
assert(a.connections.length === 1 && a.connections[0].id === 'a1', 'A direct connections wrong');
assert(a.children.map((child) => child.path).join(',') === 'A/B,A/C', 'A children wrong');

const b = a.children[0];
assert(b.connections.map((item) => item.id).join(',') === 'b2,b1', 'A/B connections wrong');
assert(b.children.length === 1 && b.children[0].path === 'A/B/C', 'A/B/C missing');

assert(countGroup(a) === 5, `A count expected 5, got ${countGroup(a)}`);
assert(countGroup(b) === 3, `A/B count expected 3, got ${countGroup(b)}`);
assert(countGroup(tree) === 8, `root count expected 8, got ${countGroup(tree)}`);

const empty = buildGroupTree([]);
assert(empty.connections.length === 0 && empty.children.length === 0, 'empty tree wrong');

console.log('group tree check passed');
