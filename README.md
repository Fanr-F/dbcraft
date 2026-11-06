# DBCraft

轻量级 Electron 数据库客户端，支持 SQLite、MySQL、Percona、MariaDB、MSSQL。

当前处于 **M1 开发中**：SQLite、MySQL、Percona、MariaDB 已接入真实连接、查询和对象树；MSSQL 仍为连接表单占位。

## 技术栈

- Electron 45 + TypeScript
- React 18 + Vite
- RevoGrid Core 数据网格
- electron-vite 开发/构建，electron-builder 打包
- zod 校验 IPC 输入
- better-sqlite3 13（N-API）+ Worker 执行 SQLite 查询
- mysql2 连接 MySQL/Percona；mariadb 连接 MariaDB

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
│  ├─ services/                # 统一连接管理 + SQLite/MySQL/MariaDB 会话
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
- SQLite / MySQL / Percona / MariaDB 连接测试、打开、关闭
- 单语句查询（SELECT / PRAGMA / DML / DDL）
- 查询结果动态列、行数、耗时、影响行数、错误展示
- 对象树：SQLite 读 `sqlite_master`；MySQL 系读 `information_schema`
- 表/视图列表、刷新、点击填入查询
- SQLite 查询在独立 Worker 中执行，不阻塞主进程
- MariaDB `ed25519` 账号走 `mariadb` 驱动
- DATETIME、DECIMAL、JSON、BIGINT 按数据库返回形态展示
- 查询取消：MySQL/MariaDB 用 `KILL QUERY`，连接保留；SQLite 终止 Worker，需要重连
- 每个 SQL 标签一个独立会话/物理连接；标签间查询与取消互不阻塞
- 结果默认最多返回 2,000 行（设置可调 100/500/1000/2000/5000），超出标记截断

尚未接入：

- MSSQL 真实驱动与 MOD-08 Agent
- 列/别名补全、错误波浪线、多结果集
- 真流式导出/进度/取消（当前导出前最多加载 1 万行）
- 打包/安装包、性能基线与无障碍

设计取舍：**保存连接只是配置**；每个 SQL 标签打开独立会话，一个会话对应一个物理连接。关闭标签即关闭会话；不做连接池。标签之间查询和取消互不阻塞。

连接配置持久化在主进程元数据库 `<userData>/dbcraft-meta.db`；密码经 `safeStorage` 加密后落盘，只在主进程解密，不回传渲染层。

## 日志

- `npm run dev` 默认 `debug` 级别；打包后默认 `info`。
- 覆盖级别（PowerShell）：`$env:DBCRAFT_LOG_LEVEL = "debug"; npm run dev`，可选 `error|warn|info|debug`。
- 开发/未打包写入项目根 `logs/dbcraft.log`（即当前工作目录下）；打包后写入 `<userData>/logs/dbcraft.log`；
  可用 `DBCRAFT_LOG_DIR` 覆盖。单文件 5 MB 轮转、保留 3 个历史文件；`logs/` 已加入 `.gitignore`。
- 渲染进程日志经 `log:write` IPC 汇入同一文件，来源校验与长度校验在 IPC 层完成。
- 日志不记录 SQL 文本、密码或连接串；敏感字段自动打码。详见 `doc/PROJECT_STATUS.md` §6「日志约定」。

## 文档

- `doc/PRD.md`：需求
- `doc/TECH_DESIGN.md`：技术设计
- `doc/PROJECT_STATUS.md`：实现现状、差距、缺陷、验收、DDL 方案、日志约定与变更里程碑

## 许可证

MIT，版权人 fanzhouqi。
