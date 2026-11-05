# AGENTS.md

DBCraft 是 Windows 桌面数据库客户端（Electron 45 + React 18 + TypeScript + RevoGrid Core）。
当前 M1 开发中：SQLite / MySQL / Percona / MariaDB 已接真实查询；MSSQL 只有连接表单，驱动未接入。

## 常用命令

- 安装：`npm install`（要求 Node.js 22.12+）
- Electron 45 不自动下载二进制；若 `node_modules/electron/dist` 不存在：

  ```powershell
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  node node_modules/electron/install.js
  ```

- 开发：`npm run dev`
- 类型检查：`npm run typecheck`（项目没有 lint / formatter）
- 构建：`npm run build`（先 typecheck，产物在 `out/`）
- 冒烟：`npm run smoke`（构建后检查窗口与 preload 桥接）
- SQLite E2E：`npm run e2e:sqlite`（自动构建、建临时库、启动 Electron）
- 演示库：`npm run demo:db` → `samples/demo.db`（被 `.gitignore` 忽略）
- `npm run pack` / `npm run dist` 尚未验证，离线环境可能因下载打包工具失败

## 架构不变量

- **保存连接只是配置**。每个 SQL 标签 = 一个 session = 一个物理连接；`sessionId` 就是标签 id。
  不要引入连接池，也不要按保存连接复用 session。
- `src/shared/ipc-contract.ts` 是 IPC 唯一契约；新增/修改通道时同步更新
  `src/main/ipc/schemas.ts`、`src/main/ipc/router.ts`、`src/preload/index.ts`。
- `src/main/services/ConnectionManager.ts` 持有 sessions；`DatabaseSession` 是驱动接口；
  SQLite / MySQL / MariaDB 适配器分别在 `services/` 下。
- 渲染进程只能通过 `window.dbcraft` 访问主进程；保持 `contextIsolation`、`sandbox`、CSP，
  不要把 Node 或数据库驱动引入 renderer。
- 驱动分工：MySQL / Percona 用 `mysql2`；MariaDB 用 `mariadb`（`ed25519` 只能走它）。
  Percona 与 MySQL 共用代码路径，但还没有真实 Percona 实例验证。
- 结果值保真：`dateStrings`、`bigNumberStrings`、`jsonStrings`；不要做时区转换，
  也不要把 DECIMAL 转成 number。
- 结果最多 2,000 行，且只支持单语句。SQLite 多语句会被明确拒绝，不要用简单 split 绕过。
- 取消：MySQL/MariaDB 用控制连接执行 `KILL QUERY`；SQLite 终止该标签的 Worker，会话失效需重连。
  被 KILL 的语句可能仍成功返回（例如 `SLEEP` 返回 1），必须用 `requestId` 的 canceled 标记覆盖响应。
- 事务状态未跟踪；状态栏写“标签会话”，不要声称自动提交。
- 连接信息和密码只在内存中，目前不写盘；未接入 safeStorage 前不要加明文持久化。

## 构建 / 测试细节

- 没有 CI、lint、单元测试；真正门槛是 `typecheck` + `build` + `e2e:sqlite`。
- SQLite 查询在 `src/main/workers/sqlite-worker.ts`，它是 main 的第二个 Rollup input。
  改 worker 后必须跑 `npm run e2e:sqlite`。
- `better-sqlite3` 13 是 N-API 预编译，Electron 45 可直接加载，不要加 `@electron/rebuild`。
- `asarUnpack: out/main/**` 是为了让 worker 及其共享 chunk 一起解包；不要只解包 `sqlite-worker.js`。
- MySQL / MariaDB 手工验证可启动便携实例：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File spikes/mysql-auth/scripts/setup.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File spikes/mysql-auth/scripts/teardown.ps1
  ```

  端口 `3307` / `3308`；凭据见 `spikes/mysql-auth/README.md`（root 空密码；ed_user / Spike!Pass123）。
- `spikes/` 是参考原型，不要 import 到 `src/`。

## 环境坑

- Windows PowerShell 5.1 会把 UTF-8 无 BOM 的 `.ps1` 按 ANSI 解码；中文注释可能吞掉换行并导致语法错误。
  `.ps1` 保持 ASCII，或写成 UTF-8 BOM。
- GitHub 访问不稳定，git 配置了 github 专用代理。push 报 TLS / handshake 错误时依次尝试：

  ```powershell
  git -c "http.https://github.com.proxy=" push origin main
  git -c http.sslBackend=openssl push origin main
  ```

- `doc/PRD.md` / `doc/TECH_DESIGN.md` 可能滞后；以 `package.json`、`scripts/` 和源码为准。
