import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const target = resolve(process.argv[2] ?? 'samples/demo.db');
const directory = dirname(target);
if (!existsSync(directory)) {
  mkdirSync(directory, { recursive: true });
}
if (existsSync(target)) {
  unlinkSync(target);
}

const db = new Database(target);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE demo_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT
  );

  CREATE TABLE demo_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES demo_users(id),
    total REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX idx_demo_users_status ON demo_users(status);
  CREATE INDEX idx_demo_orders_user ON demo_orders(user_id);

  CREATE VIEW active_users AS
    SELECT id, name, email, created_at
    FROM demo_users
    WHERE status = 'active';
`);

const statuses = ['active', 'pending', 'blocked'];
const departments = ['Platform', 'Frontend', 'Backend', 'Data', 'QA'];
const pad = (value, length = 2) => String(value).padStart(length, '0');

const insertUser = db.prepare(`
  INSERT INTO demo_users (name, email, status, created_at, amount, note)
  VALUES (@name, @email, @status, @created_at, @amount, @note)
`);

const insertOrder = db.prepare(`
  INSERT INTO demo_orders (user_id, total, created_at)
  VALUES (?, ?, ?)
`);

const seed = db.transaction(() => {
  for (let index = 0; index < 500; index += 1) {
    const number = index + 1;
    const month = (index % 12) + 1;
    const day = (index % 28) + 1;
    const createdAt = `2026-${pad(month)}-${pad(day)} 09:${pad(index % 60)}:00`;

    const info = insertUser.run({
      name: `User ${number}`,
      email: `user${number}@example.com`,
      status: statuses[index % statuses.length],
      created_at: createdAt,
      amount: Math.round(((index * 37) % 100000) + 100) / 100,
      note: `${departments[index % departments.length]} · 示例数据 · 第 ${number} 行`,
    });

    for (let order = 0; order < 3; order += 1) {
      insertOrder.run(
        Number(info.lastInsertRowid),
        Math.round((number * 13 + order * 7) * 100) / 100,
        createdAt,
      );
    }
  }
});

seed();

const userCount = db.prepare('SELECT COUNT(*) AS count FROM demo_users').get().count;
const orderCount = db.prepare('SELECT COUNT(*) AS count FROM demo_orders').get().count;

db.close();

console.log(`created ${target}`);
console.log(`demo_users=${userCount} demo_orders=${orderCount}`);
