# DBCraft

轻量级 Electron 数据库客户端，支持 SQLite、MySQL、Percona、MariaDB、MSSQL。

当前处于 **M0 原型**：窗口骨架、typed IPC、连接表单、结果网格原型。查询执行与真实驱动将在 M1 接入。

## 技术栈

- Electron + TypeScript
- React 18 + Vite
- RevoGrid Core 数据网格
- electron-vite 开发/构建，electron-builder 打包
- zod 校验 IPC 输入

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

## 构建与检查

```bash
npm run typecheck   # TypeScript 检查
npm run build       # 构建 main / preload / renderer
npm run smoke       # 构建后启动 Electron，检查窗口与 preload 桥接
npm run pack        # 生成未打包目录（release/）
npm run dist        # 生成 Windows NSIS 安装包
```

## 目录

```text
src/
├─ main/                 # Electron 主进程、窗口、IPC
│  ├─ index.ts
│  └─ ipc/
├─ preload/              # contextBridge，暴露 window.dbcraft
├─ renderer/             # React 界面
│  ├─ index.html
│  └─ src/
│     ├─ components/
│     ├─ features/
│     │  ├─ connections/
│     │  ├─ editor/
│     │  └─ grid/
│     └─ data/
└─ shared/               # IPC 契约与共享类型
```

## 安全默认

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 禁用新窗口，阻止页面导航
- 生产环境注入 CSP
- preload 只暴露白名单 IPC 方法

## M0 边界

已完成/演示：

- 主窗口与暗色界面骨架
- 对象树、标签页、SQL 编辑区、结果区、状态栏
- 五种数据库类型的连接表单
- `app.get-info`、`dialog.select-sqlite-file`、`connection.test` 三个 typed IPC 通道
- 500 行模拟结果集，RevoGrid 区域选择与复制

尚未接入：

- 真实数据库驱动与连接测试
- SQL 执行/取消、结果流
- 元数据、对象树真实数据
- 历史、设置、导出、数据编辑、DDL、Agent

连接信息当前只保存在渲染进程内存中，密码不写盘。

## 文档

- `doc/PRD.md`
- `doc/TECH_DESIGN.md`

## 许可证

MIT，版权人 fanzhouqi。
