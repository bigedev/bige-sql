/**
 * BigeSQL - 数据库类型常量与工具函数
 *
 * 统一管理数据库类型字符串，消除各文件中的硬编码。
 */
export const DbType = {
  MYSQL: "mysql",
  MARIADB: "mariadb",
  POSTGRESQL: "postgresql",
  POSTGRES: "postgres",
  SQLITE: "sqlite",
  DAMENG: "dameng",
  DM8: "dm8",
  SQLSERVER: "sqlserver",
  MSSQL: "mssql",
  ORACLE: "oracle",
} as const;

export type DbType = (typeof DbType)[keyof typeof DbType];

/**
 * 判断是否为 MySQL / MariaDB
 */
export function isMySQL(type: string | null | undefined): boolean {
  return type === DbType.MYSQL || type === DbType.MARIADB;
}

/**
 * 判断是否为 PostgreSQL
 */
export function isPostgres(type: string | null | undefined): boolean {
  return type === DbType.POSTGRESQL || type === DbType.POSTGRES;
}

/**
 * 判断是否为 SQLite
 */
export function isSQLite(type: string | null | undefined): boolean {
  return type === DbType.SQLITE;
}

/**
 * 判断是否为达梦 DM8
 */
export function isDameng(type: string | null | undefined): boolean {
  return type === DbType.DAMENG || type === DbType.DM8;
}

/**
 * 判断是否为 SQL Server
 */
export function isSqlServer(type: string | null | undefined): boolean {
  return type === DbType.SQLSERVER || type === DbType.MSSQL;
}

/**
 * 判断是否为 Oracle
 */
export function isOracle(type: string | null | undefined): boolean {
  return type === DbType.ORACLE;
}

/**
 * 根据数据库类型返回标识符引用符
 * - MySQL/MariaDB: 反引号 `
 * - PostgreSQL/SQLite/达梦/Oracle: 双引号 "
 * - SQL Server: 方括号 []（也兼容双引号，但方括号是默认）
 */
export function quoteIdentifier(type: string | null | undefined): string {
  if (isMySQL(type)) return "`";
  if (isSqlServer(type)) return "]"; // 返回左括号，用 quoteName 拼接
  return '"';
}

/**
 * 用正确的引用符包裹标识符（表名、列名等）
 */
export function quoteName(
  type: string | null | undefined,
  name: string,
): string {
  const q = quoteIdentifier(type);
  // SQL Server 用方括号
  if (isSqlServer(type)) {
    return `[${name}]`;
  }
  return `${q}${name}${q}`;
}
