/**
 * 补全元数据缓存（MetadataStore）的纯逻辑测试。
 *
 * 运行：npm run test:metadata
 */
import { MetadataStore } from '../src/renderer/src/utils/metadata-store.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const column = (name, type = 'int') => ({ name, type });

// loading 期间复用同一个 Promise，避免连续按键重复发 IPC。
{
  let calls = 0;
  let release;
  const store = new MetadataStore();
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = store.loadColumns('user', 'db', null, 'users', loader);
  const second = store.loadColumns('user', 'db', null, 'users', loader);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls === 1, `duplicate load should share promise, calls=${calls}`);
  release([column('id')]);
  const [left, right] = await Promise.all([first, second]);
  assert(
    left?.length === 1 && left === right,
    `shared promise should resolve the same data: ${JSON.stringify(left)} ${JSON.stringify(right)}`,
  );
  assert(
    JSON.stringify(store.peekColumns('user', 'db', null, 'users')) ===
      JSON.stringify([column('id')]),
    'ready entry should be readable synchronously',
  );
}

// 用户/系统分区相互独立；失效互不影响。
{
  const store = new MetadataStore();
  await store.loadObjects('user', 'db', async () => [{ name: 'users', type: 'table' }]);
  await store.loadObjects('system', 'db', async () => [{ name: 'sys.tables', type: 'view' }]);
  await store.loadForeignKeys('db', 'users', async () => [
    {
      name: 'fk_user',
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      onDelete: null,
      onUpdate: null,
    },
  ]);
  store.invalidateUser();
  assert(store.peekObjects('user', 'db') === null, 'invalidateUser should clear user objects');
  assert(store.peekObjects('system', 'db')?.length === 1, 'invalidateUser should keep system objects');
  assert(store.peekForeignKeys('db', 'users') === null, 'invalidateUser should clear foreign keys');
  store.invalidateSystem();
  assert(store.peekObjects('system', 'db') === null, 'invalidateSystem should clear system objects');
}

// 失败按指数退避；退避窗口内不再发请求。
{
  let now = 0;
  let calls = 0;
  const store = new MetadataStore({
    now: () => now,
    errorBackoffBaseMs: 1000,
    errorBackoffMaxMs: 8000,
  });
  const loader = async () => {
    calls += 1;
    throw new Error('boom');
  };
  await store.loadColumns('user', 'db', null, 'users', loader);
  assert(calls === 1, 'first load should call loader');
  now = 500;
  await store.loadColumns('user', 'db', null, 'users', loader);
  assert(calls === 1, 'load inside backoff window should not call loader');
  now = 1000;
  await store.loadColumns('user', 'db', null, 'users', loader);
  assert(calls === 2, 'load after backoff should retry');
}

// 失效后旧响应直接丢弃，不写回缓存。
{
  let release;
  const store = new MetadataStore();
  const first = store.loadColumns(
    'user',
    'db',
    null,
    'users',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  store.invalidateUser();
  release([column('id')]);
  const result = await first;
  assert(result === null, 'stale response should resolve null');
  assert(store.peekColumns('user', 'db', null, 'users') === null, 'stale response must not be cached');
  let calls = 0;
  await store.loadColumns('user', 'db', null, 'users', async () => {
    calls += 1;
    return [column('name')];
  });
  assert(calls === 1, 'invalidated key should reload');
}

// LRU：超过上限时淘汰最久未使用的条目。
{
  let tick = 0;
  const store = new MetadataStore({ now: () => ++tick, maxColumns: 2 });
  await store.loadColumns('user', 'db', null, 'a', async () => [column('a1')]);
  await store.loadColumns('user', 'db', null, 'b', async () => [column('b1')]);
  await store.loadColumns('user', 'db', null, 'c', async () => [column('c1')]);
  assert(store.peekColumns('user', 'db', null, 'a') === null, 'oldest column entry should be evicted');
  assert(store.peekColumns('user', 'db', null, 'b') !== null, 'recent entry should remain');
  assert(store.peekColumns('user', 'db', null, 'c') !== null, 'new entry should remain');
}

// 空列结果不缓存（与补全现有行为一致），并进入退避。
{
  const store = new MetadataStore();
  await store.loadColumns('user', 'db', null, 'empty', async () => []);
  assert(store.peekColumns('user', 'db', null, 'empty') === null, 'empty columns must not be ready');
  assert(store.stats().errors === 1, 'empty columns should be counted as error');
}

// 对象与空外键结果允许为空。
{
  const store = new MetadataStore();
  await store.loadObjects('user', 'empty_db', async () => []);
  assert(store.peekObjects('user', 'empty_db') !== null, 'empty object list should be cached');
  await store.loadForeignKeys('db', 'no_fk', async () => []);
  assert(store.peekForeignKeys('db', 'no_fk') !== null, 'empty FK list should be cached');
}

console.log('metadata store check passed');
