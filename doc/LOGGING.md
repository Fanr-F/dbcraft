# DBCraft 日志约定

| 项目 | 内容 |
|---|---|
| 适用范围 | Electron 主进程、preload、渲染进程 |
| 实现位置 | 主进程 `src/main/logging/logger.ts`；渲染进程 `src/renderer/src/logging.ts` |
| 默认级别 | `npm run dev` / 未打包：`debug`；打包后：`info` |
| 覆盖方式 | 环境变量 `DBCRAFT_LOG_LEVEL=error\|warn\|info\|debug` |
| 落盘位置 | `<userData>/logs/dbcraft.log`（Windows 开发环境通常为 `%APPDATA%\dbcraft\logs`） |
| 轮转 | 单文件 5 MB，保留 3 个历史文件（`.1` / `.2`） |

> 约束来自 PRD §5.3：**日志不得记录 SQL 文本、密码或连接串**。本实现按此执行：查询日志只记录 `sqlLength`，错误日志只记录 `code` / `sqlState` / `errno` / `retryable`，不记录 `message` 原文。

---

## 1. 级别

| 级别 | 用途 | 开发默认可见 | 打包默认可见 |
|---|---|---|---|
| `error` | 崩溃、渲染进程异常退出、未捕获错误 | ✅ | ✅ |
| `warn` | 连接/查询失败、IPC 来源不可信、参数无效 | ✅ | ✅ |
| `info` | 应用启动/退出、会话打开/关闭、查询完成 | ✅ | ✅ |
| `debug` | 测试连接、查询开始、取消请求、关闭会话等细节 | ✅ | ❌ |

- 开发默认 `debug` 由 `app.isPackaged === false` 判定，不需要在脚本里额外设置环境变量；
- 打包后默认 `info`，避免写盘过多；
- 临时调整（PowerShell）：

  ```powershell
  $env:DBCRAFT_LOG_LEVEL = "debug"; npm run dev
  $env:DBCRAFT_LOG_LEVEL = "error"; npm run dev
  ```

  环境变量只在进程启动时读取，运行中修改需要重启。

---

## 2. 输出格式

```text
2026-11-05T07:42:13.512Z [INFO] [session] 会话已打开 {"sessionId":"query-1","type":"sqlite","version":"3.53.4","elapsedMs":12}
2026-11-05T07:42:13.530Z [DEBUG] [session] 开始执行查询 {"requestId":"query-...","sessionId":"query-1","sqlLength":42}
2026-11-05T07:42:13.531Z [INFO] [session] 查询完成 {"requestId":"query-...","rows":100,"elapsedMs":2,"truncated":false,"statementType":"select"}
```

- 时间为 UTC ISO 8601；
- `scope` 用于区分模块（`app` / `ipc` / `session` / `renderer:<scope>`）；
- 控制台与文件内容一致；
- 元信息是 JSON，单条超过 4 KB 会截断；消息单行化，超过 2,000 字符截断。

---

## 3. 主进程用法

```ts
import { createLogger } from '../logging/logger';

const log = createLogger('session');

log.info('会话已打开', { sessionId, type: input.type });
log.warn('查询失败', { requestId, code, sqlState, errno, retryable });
log.debug('开始执行查询', { requestId, sqlLength: sql.length });
```

- `createLogger(scope)` 不会立即创建文件，首次写日志时才初始化目录；
- 文件写入使用 `appendFileSync`，按当前日志量（低频生命周期 + 查询摘要）可接受；
- 若日志目录不可写，会退化为仅控制台输出，并在控制台报一次错。

---

## 4. 渲染进程用法

```ts
import { createLogger } from './logging';

const log = createLogger('ui');
log.info('渲染进程已加载');
log.error('未捕获错误', { message, source, line });
```

渲染进程不能直接写文件，日志通过 preload 暴露的 `window.dbcraft.log.write(...)` 发送到主进程：

- 通道：`log:write`（`ipcRenderer.send`，单向）；
- 主进程只接受主窗口主框架的请求（与其它 IPC 相同的来源校验）；
- 使用 zod 校验：`level` 枚举、`scope` ≤ 64、`message` ≤ 2,000、`meta` ≤ 4,000 字符串；
- 主进程按 `renderer:<scope>` 作用域写入同一日志文件。

`src/renderer/src/main.tsx` 已注册全局 `error` 与 `unhandledrejection` 监听，未捕获异常会进入日志。

---

## 5. 脱敏与禁止记录

`logger.ts` 对元信息键名做自动打码，命中以下模式时值替换为 `***`：

```text
password / passwd / secret / token / authorization / apiKey / api_key / cookie
```

除此之外，调用方必须遵守：

| 禁止记录 | 替代做法 |
|---|---|
| SQL 原文 | 记录 `sqlLength`、`requestId`、`statementType` |
| 密码、连接串 | 永不传入 logger；连接只记录 `type` / `version` |
| 驱动原始错误消息 | 记录 `code`、`sqlState`、`errno`、`retryable` |
| 完整文件路径 | 记录文件名或仅记录类型 |

> 已知边界：渲染进程传入的 `meta` 是字符串，主进程不会再按键名脱敏；渲染进程侧应在调用前自行裁剪，不要传敏感字段。

---

## 6. 与 PRD 的关系

- PRD §5.3「日志不记录 SQL 文本」：已按上述约定执行；
- PRD §5.2「诊断日志导出」（P1）：本日志文件将作为导出源，后续补导出入口与脱敏复核；
- 崩溃统计 / 远程上报：未实现，也不计划默认开启；日志只留在本地。

---

## 7. 验证

- `npm run typecheck` / `npm run build` 通过；
- `npm run e2e:sqlite` 以未打包模式启动 Electron，应产生 `debug` 级日志；
- 手工确认：启动应用后检查 `<userData>/logs/dbcraft.log`，应包含 `[INFO] [app] 应用启动` 与 `[DEBUG]` 行；
- 退出应用后应看到 `应用退出：关闭会话` 与 `会话已关闭，退出应用`。

---

## 8. 待办

- 日志查看器 / 「导出诊断日志」入口（P1）；
- 可选的滚动文件上限与按天归档策略；
- 若日志量显著增长，将同步写盘改为有界异步队列。
