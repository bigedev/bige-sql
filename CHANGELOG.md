# Changelog

本项目所有值得记录的变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.2.4]

### Fixed
- 修复达梦数据库 SYSDBA 用户业务表不可见的问题
- 修复达梦数据库 DML 语句（INSERT/UPDATE/DELETE）未提交导致数据不生效的问题：达梦连接为 `autoCommit=false`，执行 DML 后显式 `commit()`，避免连接关闭时事务回滚、数据丢失
- 修复可视化查询编辑器执行后结果显示 "undefined" 的问题（`locale` 中函数字段被 `JSON.stringify` 丢弃导致前台取值为 `undefined`）

### Changed
- 重构 Oracle/达梦模式层级：树形第一级由"用户"统一改为"模式"（schemas），`listSchemas` 不再过滤系统模式，列出所有模式
- 可视化查询工具同步调整：Oracle/达梦下拉列表显示模式（schemas）替代用户列表
- MySQL/MariaDB 第一级（数据库列表）节点改用数据库图标

## [0.2.3]

### Fixed
- 修复 MCP 服务器访问不到数据库连接的问题（将 `connections.json` 实际路径传递给 MCP 子进程）

### Changed
- SQLite 驱动从 `better-sqlite3` 迁移到 Node 内置 `node:sqlite`，移除原生模块依赖，规避平台/ABI 兼容问题

## [0.2.2]

### Added
- 为 MySQL/PostgreSQL 连接添加 SSL 支持

### Changed
- 隐藏数据库系统库：MySQL（`information_schema`/`mysql`/`performance_schema`/`sys`）、PostgreSQL（`postgres` 及模板库）、SQL Server（`master`/`model`/`msdb`/`tempdb`）
- 支持单个连接结构树刷新（`refreshConnection`），无需整体刷新

## [0.2.1]

### Added
- 添加数据库实体名称过滤功能，支持按名称筛选表/视图等节点

### Changed
- 连接配置存储迁移至 VS Code 全局存储目录，升级/重装扩展时配置不丢失，并支持 MCP Server 共享配置路径
- MCP 工具（`list-databases` / `execute`）返回结果添加连接信息前缀
- 格式化代码，优化 query 工具返回格式

## [0.2.0]

### Added
- 添加 SQL Server 和 Oracle 数据库支持（MCP Server）
- 添加 GitHub Actions 自动化发布 VSIX 工作流程

## [0.1.0]

### Added
- 首个版本：多数据库管理 VS Code 扩展 & MCP Server
  - 多数据库类型支持：MySQL/MariaDB、PostgreSQL、SQLite、达梦 DM8 等
  - 连接树视图：数据库 → Schema → 表/视图/存储过程 → 列/主键/外键/索引/触发器
  - 可视化 SQL 查询编辑器
  - 内置 MCP Server，供 AI 客户端调用
  - 国际化：简体中文 / 繁体中文 / English
