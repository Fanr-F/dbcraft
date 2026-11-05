# DBCraft

轻量级 Electron 数据库客户端，支持 SQLite、MySQL、Percona、MariaDB、MSSQL。

当前处于 **M1 开发中**：SQLite 已接入真实连接、查询和对象树；其余数据库类型仍为连接表单占位。

## 技术栈

- Electron 45 + TypeScript
- React 18 + Vite
- RevoGrid Core 数据网格
- electron-vite 开发/构建，electron-builder 打包
- zod 校验 IPC 输入
- better-sqlite3 13（N-API）+ Worker 执行 SQLite 查询

## 开发

要求 Node.js 22.12+。

```bash
npm install
npm run dev
```

如果 `npm install` 后 `node_modules/electron/dist` 不存在（Electron 45 不再自动下载二进制），执行：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

生成演示数据库：

```bash
npm run demo:db   # samples/demo.db，500 用户 + 1,500 订单
```

然后在应用里新建 SQLite 连接，选择 `samples/demo.db`。

## 构建与检查

```bash
npm run typecheck   # TypeScript 检查
npm run build       # 构建 main / preload / renderer / sqlite worker
npm run smoke       # 构建后启动 Electron，检查窗口与 preload 桥接
npm run e2e:sqlite  # 构建后跑 SQLite 真实链路 E2E（连接、对象树、查询、错误）
npm run pack        # 生成未打包目录（release/）
npm run dist        # 生成 Windows NSIS 安装包
```

## 目录

```text
src/
├─ main/
│  ├─ index.ts                 # 窗口、安全默认、生命周期
│  ├─ ipc/                     # IPC 路由与 zod schema
│  ├─ services/sqlite/         # 连接管理、Worker 会话
│  └─ workers/                 # sqlite-worker
├─ preload/                    # contextBridge，暴露 window.dbcraft
├─ renderer/                   # React 界面
│  ├─ index.html
│  └─ src/
│     ├─ components/
│     ├─ features/
│     │  ├─ connections/
│     │  ├─ editor/
│     │  └─ grid/
│     └─ types.ts
└─ shared/                     # IPC 契约与共享类型
```

## 安全默认

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 禁用新窗口，阻止页面导航
- 生产环境注入 CSP
- preload 只暴露白名单 IPC 方法

## 当前进度

已完成：

- 主窗口、暗色界面、标签页、SQL 编辑区、结果区、状态栏
- 五种数据库类型的连接表单
- SQLite 连接测试、打开、关闭
- SQLite 单语句查询（SELECT / PRAGMA / UPDATE / INSERT / DELETE / DDL）
- 查询结果动态列、行数、耗时、影响行数、错误展示
- `sqlite_master` 对象树：表/视图列表、刷新、点击填入查询
- SQLite 查询在独立 Worker 中执行，不阻塞主进程
- 结果最多返回 2,000 行，超出标记截断

尚未接入：

- MySQL / Percona / MariaDB / MSSQL 真实驱动
- 多语句执行、查询取消、事务状态跟踪
- 查询历史、设置、导出、数据编辑、DDL、Agent
- 10 万行性能验证、打包后 asar Worker 冒烟测试

连接信息当前只保存在渲染进程内存中，密码不写盘。

## 文档

- `doc/PRD.md`
- `doc/TECH_DESIGN.md`

## 许可证

MIT，版权人 fanzhouqi。
