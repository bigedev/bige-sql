# BigeSQL — 开源多数据库管理工具 & MCP Server

一站式数据库管理工具 + AI MCP Server，支持 **MySQL/MariaDB、PostgreSQL、SQLite、达梦 DM8**。

既是 **VS Code 插件**（图形化界面），也是 **MCP Server**（AI 助手可通过协议直接访问数据库），支持 stdio 和 HTTP 双模式。

---

## ✨ 功能特性

| 特性                | 说明                                             |
| ------------------- | ------------------------------------------------ |
| 🗄️ **多数据库支持** | MySQL / MariaDB / PostgreSQL / SQLite / 达梦 DM8 |
| 🎨 **图形界面**     | VS Code 侧边栏管理连接，Webview SQL 编辑器       |
| 🤖 **MCP 协议**     | 支持 stdio + HTTP 双模式                         |
| 🔌 **连接管理**     | 添加/编辑/删除/测试数据库连接                    |
| 📋 **表浏览器**     | 树形展示表、视图、列结构                         |
| ⌨️ **SQL 编辑器**   | 语法高亮、执行查询、结果表格展示                 |
| 🚦 **服务管理**     | 扩展内一键启动/停止 MCP Server，状态栏指示       |
| 🔒 **安全**         | 密码不硬编码，支持 `.gitignore` 排除             |

## 支持的数据库

| 数据库              | 驱动               | 方式                |
| ------------------- | ------------------ | ------------------- |
| **MySQL / MariaDB** | `mysql2`           | TCP 直连            |
| **PostgreSQL**      | `pg`               | TCP 直连            |
| **SQLite**          | `better-sqlite3`   | 本地文件            |
| **达梦 DM8**        | `dmdb`（官方驱动） | TCP 直连，无需 ODBC |

---

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 18.x
- **VS Code** ≥ 1.85.0
- **npm** ≥ 9.x

### 方式一：从 VSIX 安装（推荐）

从 [Releases](https://github.com/bigedev/bige-sql/releases) 下载 `.vsix` 文件，然后在 VS Code 中：

```
扩展 → 右上角 `...` → Install from VSIX...
```

### 方式二：从源码构建

```bash
git clone https://github.com/bigedev/bige-sql.git
cd bige-sql
npm install
npm run compile
```

然后在 VS Code 中按 `F5` 启动调试窗口，或自行打包安装。

### 打包为 VSIX

项目内置了打包脚本，方便发布或分发：

```bash
# 完整打包（先编译，再打包）
npm run package

# 如果已编译，跳过编译步骤
npm run package:no-compile
```

执行后会在项目根目录生成 `bige-sql-<version>.vsix` 文件，可直接用于安装或分发。

> **💡 提示**: VSIX 已通过 `.vscodeignore` 自动排除源代码、测试文件、文档等无用文件，减小体积。

### 配置数据库连接

编辑项目根目录的 `connections.json` 添加您的数据库连接：

```json
{
  "connections": {
    "my-mysql": {
      "type": "mysql",
      "host": "192.168.1.100",
      "port": 3306,
      "user": "root",
      "password": "your_password",
      "database": "mydb"
    },
    "my-postgres": {
      "type": "postgresql",
      "host": "127.0.0.1",
      "port": 5432,
      "user": "postgres",
      "password": "",
      "database": "mydb"
    },
    "my-sqlite": {
      "type": "sqlite",
      "path": "/data/mydb.db"
    },
    "my-dameng": {
      "type": "dameng",
      "host": "192.168.1.23",
      "port": 5236,
      "user": "SYSDBA",
      "password": "SYSDBA"
    }
  }
}
```

> **⚠️ 注意**: `connections.json` 已加入 `.gitignore`，避免误提交凭据到 Git。
>
> 也可在 VS Code 设置中配置 `bigeSql.connectionsFilePath` 指定自定义路径（支持绝对路径）。

> **💡 参考**: 查看 `connections.example.json` 获取更多配置项示例。

---

## 🎯 使用方式一：VS Code 插件（图形界面）

### 安装插件

在 VS Code 中按 `F5` 启动调试，或从 `.vsix` 安装。

### 使用界面

1. **侧边栏** — 点击活动栏的 🗄️ **BigeSQL** 图标
2. **添加连接** — 点击侧边栏顶部的 **+** 按钮，填写表单
3. **浏览表** — 展开连接节点，查看表和列结构
4. **执行查询** — 右键连接或表，选择 **打开 SQL 查询编辑器**
5. **MCP Server** — 点击底部状态栏 **BigeSQL MCP** 启动，运行中可点击停止
6. **快捷键** — 在 SQL 编辑器中按 `Cmd+Enter` / `Ctrl+Enter` 执行

### 命令列表

| 命令                           | 说明               |
| ------------------------------ | ------------------ |
| `BigeSQL: 添加数据库连接`      | 打开添加连接表单   |
| `BigeSQL: 打开 SQL 查询编辑器` | 打开 SQL 编辑器    |
| `BigeSQL: 刷新连接列表`        | 从文件重新加载连接 |
| `BigeSQL: 测试连接`            | 测试连接是否正常   |
| `BigeSQL: 编辑连接`            | 修改连接配置       |
| `BigeSQL: 删除连接`            | 删除数据库连接     |
| `BigeSQL: Start MCP Server`    | 启动 MCP 服务      |
| `BigeSQL: Stop MCP Server`     | 停止 MCP 服务      |

---

## 🤖 使用方式二：MCP Server（AI 助手）

让 AI 助手（GitHub Copilot、Claude 等）通过 MCP 协议直接访问您的数据库。

### 方式 A：VS Code 扩展管理（推荐）

安装扩展后，通过以下任一方式启动：

- **状态栏** — 点击底部 **BigeSQL MCP** 图标
- **命令面板** — 执行 `BigeSQL: Start MCP Server`

启动后自动运行 HTTP 模式，状态栏显示 **BigeSQL MCP • 运行中**，点击可停止。

### 方式 B：配置 VS Code MCP（stdio）

在项目 `.vscode/mcp.json` 中添加：

```json
{
  "servers": {
    "bige-sql": {
      "type": "command",
      "command": "node",
      "args": ["/path/to/bige-sql/out/src/server.js"],
      "description": "BigeSQL 多数据库 MCP Server"
    }
  }
}
```

重启 VS Code 后，Copilot 即可自动识别并使用数据库工具。

### 方式 C：独立 HTTP 服务

```bash
# stdio + HTTP 双模式（默认端口 5237）
node out/src/server.js --http

# 仅 HTTP 模式
node out/src/server.js --http-only

# 自定义端口
node out/src/server.js --http --port 8080
```

HTTP 端点：`http://127.0.0.1:5237/mcp`

支持标准 MCP Streamable HTTP 传输，可与任意兼容的 MCP 客户端（其他 IDE、自定义 Agent 等）配合使用。

### MCP 工具列表

| 工具                       | 参数                                                                        | 说明                                                 |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `list-connections`         | —                                                                           | 列出所有已配置的连接                                 |
| `test-connection`          | `connection` (可选)                                                         | 测试数据库连接                                       |
| `list-databases`           | `connection` (可选)                                                         | 列出所有数据库（MySQL/PG）                           |
| `list-schemas`             | `connection` (可选)                                                         | 列出 schema（PG）/ 数据库列表（MySQL）/ 用户（达梦） |
| `list-tables`              | `connection` (可选), `database` (可选), `schema` (可选)                     | 列出所有表和视图                                     |
| `list-views`               | `connection` (可选)                                                         | 列出视图及其定义                                     |
| `describe-table`           | `connection` (可选), `tableName` (必填), `database` (可选), `schema` (可选) | 查看表字段结构                                       |
| `get-table-info`           | `connection` (可选), `tableName` (必填)                                     | 表详细信息（行数、大小、引擎）                       |
| `get-schema`               | `connection` (可选), `tableName` (必填)                                     | 获取表 DDL/建表语句                                  |
| `search-tables`            | `connection` (可选), `keyword` (必填)                                       | 按名称模糊搜索表                                     |
| `list-indexes`             | `connection` (可选), `tableName` (必填)                                     | 列出表索引                                           |
| `get-primary-keys`         | `connection` (可选), `tableName` (必填), `database` (可选), `schema` (可选) | 获取主键信息                                         |
| `get-foreign-keys`         | `connection` (可选), `tableName` (必填), `database` (可选), `schema` (可选) | 获取外键关系                                         |
| `get-triggers`             | `connection` (可选), `tableName` (必填), `database` (可选), `schema` (可选) | 获取指定表的所有触发器信息                           |
| `list-procedures`          | `connection` (可选), `database` (可选), `schema` (可选)                     | 列出存储过程和函数                                   |
| `get-procedure`            | `connection` (可选), `name` (必填)                                          | 获取存储过程/函数源码                                |
| `get-procedure-parameters` | `connection` (可选), `name` (必填), `database` (可选), `schema` (可选)      | 获取存储过程/函数的参数列表                          |
| `query`                    | `connection` (可选), `sql` (必填)                                           | 执行 SELECT 查询                                     |
| `execute`                  | `connection` (可选), `sql` (必填)                                           | 执行 INSERT/UPDATE/DELETE                            |
| `explain-query`            | `connection` (可选), `sql` (必填)                                           | 获取执行计划                                         |

> 所有工具的 `connection` 参数默认使用第一个配置的连接。
> `database` 和 `schema` 参数可用于跨数据库/跨 schema 查询，不传则使用连接默认值。

---

## 🏗️ 项目架构

```text
bige-sql/
├── package.json                    # 依赖 & VS Code 扩展清单
├── package.nls.json                # 扩展清单本地化（命令名、视图名等）
├── package.nls.zh-cn.json          # 中文简体本地化
├── package.nls.zh-tw.json          # 中文繁体本地化
├── tsconfig.json                   # TypeScript 编译配置（strict 模式）
├── .vscodeignore                   # VSIX 打包排除规则
├── .gitignore                      # Git 忽略规则
├── connections.example.json        # 连接配置示例
├── test-mcp-http.mjs               # HTTP MCP 测试脚本
├── LICENSE                         # MIT 许可证
├── src/
│   ├── extension.ts                # VS Code 插件入口（注册命令、视图、Webview）
│   ├── server.ts                   # MCP Server（stdio + HTTP 双模式入口）
│   ├── mcpServerProvider.ts        # MCP 服务提供者（状态栏管理、生命周期）
│   ├── dbTypes.ts                  # 数据库类型常量与工具函数
│   ├── connectionManager.ts        # 连接配置读写管理
│   ├── databaseService.ts          # 数据库查询引擎（MySQL/PG/SQLite/达梦）
│   ├── connectionTreeProvider.ts   # 侧边栏连接树视图
│   └── queryEditorProvider.ts      # SQL 编辑器 Webview 提供者
├── l10n/
│   ├── bundle.l10n.json            # 运行时本地化（默认英文）
│   ├── bundle.l10n.zh-cn.json      # 中文简体
│   └── bundle.l10n.zh-tw.json      # 中文繁体
├── media/
│   ├── database.svg                # 活动栏图标
│   ├── addConnection.js            # 添加/编辑连接 Webview 前端
│   ├── icon.png                    # 扩展市场图标（PNG）
│   └── icon.svg                    # 扩展市场图标（SVG）
├── .vscode/
│   ├── launch.json                 # VS Code 调试配置（Run Extension / Attach）
│   └── settings.json               # 工作区设置
└── out/                            # 编译输出（自动生成，已 gitignore）
```

---

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run compile

# 监听模式（开发时使用）
npm run watch

# 打包 VSIX
npm run package

# 在 VS Code 中按 F5 启动调试
```

### 调试插件

1. 在 VS Code 中打开本项目
2. 按 `F5` 或运行 **Run Extension** 调试配置
3. 新窗口会加载扩展
4. 点击活动栏的 BigeSQL 图标开始使用

### 调试 MCP Server

```bash
# 单独运行 MCP Server（stdio）
node out/src/server.js

# HTTP 模式
node out/src/server.js --http
```

VS Code 提供了 **Run MCP Server** 调试配置，可直接附加调试器。

---

## 📄 License

MIT

## 示例

在 VS Code Copilot Chat 中直接提问：

```text
@bige-sql 查询 idcloud-mysql 中的 ac_user 表前10条记录
@bige-sql 列出 my-postgres 中所有表
```
