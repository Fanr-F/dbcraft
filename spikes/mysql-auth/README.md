# MySQL 系认证 Spike

验证 DBCraft 对 MySQL / Percona / MariaDB 的驱动选择、认证插件、TLS 与错误映射。不是正式功能代码。

## 结论

- **MySQL 8.0.44 + mysql2**：`caching_sha2_password`、`mysql_native_password`、TLS、错误码均通过。
- **MariaDB 11.4.13 + mariadb**：`mysql_native_password`、`ed25519` 通过；`ed25519` 不能被 mysql2 替代。
- **Percona**：与 MySQL 共用 mysql2 与 `caching_sha2_password` 路径，本机无二进制，待真实实例复核。
- **unix_socket / PAM**：服务端本机认证，Windows 客户端经 TCP 用不到，v1.0 不验收。

## 环境

| 项目 | 版本 |
|---|---|
| 系统 | Windows（x64） |
| Node.js | 24.22.1 |
| mysql2 | 3.24.6 |
| mariadb | 3.5.4 |
| MySQL | 8.0.44（便携版，127.0.0.1:3307） |
| MariaDB | 11.4.13（便携版，127.0.0.1:3308） |

服务端与数据目录放在 `%TEMP%\dbcraft-mysql-auth`，不进仓库。

## 运行

```powershell
cd spikes/mysql-auth
npm install

# 下载、解压、初始化并启动两个实例
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1

# 跑认证矩阵，生成 result.json
npm run probe

# 停止实例（加 -RemoveData 可清空数据目录）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/teardown.ps1
```

`setup.ps1` 默认使用：

- MySQL：`https://cdn.mysql.com/Downloads/MySQL-8.0/mysql-8.0.44-winx64.zip`
- MariaDB：`https://mirrors.tuna.tsinghua.edu.cn/mariadb/mariadb-11.4.13/winx64-packages/mariadb-11.4.13-winx64.zip`

MariaDB 官方 `archive.mariadb.org` 在当前网络下很慢，脚本改用清华镜像；如需官方源，改 `$mariaZipUrl` 即可。

## 用例结果

共 16 项通过，`result.json` 为原始输出。

| 用例 | 结果 | 观测 |
|---|---|---|
| MySQL `caching_sha2_password` 首次认证（非 TLS） | 通过 | 约 5ms；mysql2 自动请求 RSA 公钥 |
| MySQL 认证缓存命中 | 通过 | 1ms；fast auth |
| MySQL TLS（自签证书，不校验） | 通过 | 5ms |
| MySQL TLS 严格校验自签证书 | 按预期失败 | `HANDSHAKE_SSL_ERROR: self-signed certificate in certificate chain` |
| MySQL `mysql_native_password` | 通过 | 8.0 仍可用 |
| MySQL 密码错误 | 按预期失败 | `ER_ACCESS_DENIED_ERROR` / 1045 / SQLState 28000 |
| MySQL 库不存在（root） | 按预期失败 | `ER_BAD_DB_ERROR` / 1049 |
| MySQL 无库权限（普通账号） | 按预期失败 | `ER_DBACCESS_DENIED_ERROR` / 1044 |
| MySQL 端口未监听 | 按预期失败 | `ECONNREFUSED` |
| MariaDB `mysql_native_password` | 通过 | mariadb 驱动 |
| MariaDB `ed25519` | 通过 | 13ms |
| MariaDB `ed25519` 经 mysql2 | 按预期失败 | `AUTH_SWITCH_PLUGIN_ERROR`，未知插件 `client_ed25519` |
| MariaDB 原生密码经 mysql2（对照） | 通过 | 不能据此复用驱动 |
| MariaDB 密码错误 | 按预期失败 | 1045 / SQLState 28000 |
| MariaDB 库不存在（root） | 按预期失败 | 1049 |
| MariaDB 无库权限（普通账号） | 按预期失败 | 1044 |
| MariaDB `unix_socket` | 不适用 | Windows 无插件：1524 `Plugin 'unix_socket' is not loaded` |

## 关键发现

### 1. mysql2 不支持 `allowPublicKeyRetrieval`

MySQL Connector/J 的 `allowPublicKeyRetrieval` 在 mysql2 3.24 中不存在。传入后 mysql2 直接丢弃并告警：

```text
Ignoring invalid configuration option passed to Connection: allowPublicKeyRetrieval.
This is currently a warning, but in future versions of MySQL2, an error will be thrown ...
```

`connection.config.allowPublicKeyRetrieval` 读出来是 `undefined`。首次 `caching_sha2_password` 认证时，mysql2 总是向服务端请求 RSA 公钥，然后用它加密密码。

影响：

- 不能照搬 MySQL Connector/J 的“默认禁止公钥获取”安全模型。
- 非 TLS 连接的密码虽经 RSA 加密，但公钥由服务端提供，仍有 MITM 风险。
- DBCraft 应默认引导 TLS；明文连接明确标注“未加密”。需要更强保证时使用 TLS，或通过 `authPlugins` 固定服务端公钥。

### 2. MariaDB `ed25519` 必须用 mariadb 驱动

mariadb 3.5.4 原生支持 `client_ed25519`，实测 13ms 连接成功。

同一账号交给 mysql2 会失败：

```text
AUTH_SWITCH_PLUGIN_ERROR
Server requests authentication using unknown plugin client_ed25519.
```

因此按 `vendor` 分驱动不是“多此一举”，而是 ed25519 可用性的前提。

### 3. 错误码要分流

| 码 | 含义 |
|---|---|
| 1045 | 账号或密码错误 |
| 1044 | 账号存在，但没有该库权限 |
| 1049 | 库不存在 |

MariaDB 的 `message` 带 `(conn:21, no: 1045, SQLState: 28000)` 前缀，MySQL 不带。UI 应按 `code` / `errno` / `sqlState` 映射，不能解析消息文本。

### 4. 自签证书需要显式信任

`ssl: { rejectUnauthorized: false }` 可连接；默认严格校验失败，错误码是 mysql2 的 `HANDSHAKE_SSL_ERROR`（不是 Node 的证书错误码）。连接表单需要“验证证书”开关，默认开启。

### 5. MySQL 8.0 与 8.4 的 `mysql_native_password`

8.0.44 仍可创建并连接 `mysql_native_password` 账号；MySQL 8.4 默认禁用该插件。DBCraft 不做兼容层，按数据库原生行为展示错误。

### 6. unix_socket / PAM

`CREATE USER ... IDENTIFIED VIA unix_socket` 在 Windows 上直接报 1524。即使连的是 Linux 服务端，TCP 连接也走不到本地套接字认证；v1.0 目标平台是 Windows，故标记不适用。

## 待办

- 用真实 Percona Server 8.0/8.4 实例复核连接与 `VERSION()`/`@@version_comment` 识别。
- 在 M1 连接管理实现中固化：驱动选择、TLS 开关、错误码映射、未加密连接提示。

## 文件

```text
spikes/mysql-auth/
├─ package.json
├─ result.json              # 本次运行结果
├─ scripts/
│  ├─ setup.ps1             # 下载/初始化/启动便携实例
│  ├─ teardown.ps1          # 停止实例
│  ├─ lib.mjs               # 连接封装与错误归一化
│  └─ probe.mjs             # 认证矩阵
└─ README.md
```
