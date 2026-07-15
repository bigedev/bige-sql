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
 * 根据数据库类型返回标识符引用符
 * - MySQL/MariaDB: 反引号 `
 * - PostgreSQL/SQLite/达梦: 双引号 "
 */
export function quoteIdentifier(type: string | null | undefined): string {
  return isMySQL(type) ? "`" : '"';
}

/**
 * 用正确的引用符包裹标识符（表名、列名等）
 */
export function quoteName(
  type: string | null | undefined,
  name: string,
): string {
  const q = quoteIdentifier(type);
  return `${q}${name}${q}`;
}

/** 数据库类型 → 显示图标映射 */
const DB_ICONS: Record<string, string> = {
  [DbType.SQLITE]: "📦",
  [DbType.POSTGRESQL]: "🐘",
  [DbType.POSTGRES]: "🐘",
  [DbType.DAMENG]: "🔷",
  [DbType.DM8]: "🔷",
};

/**
 * 获取数据库类型的显示图标
 * @param type 数据库类型字符串
 * @param fallback 未匹配时的默认图标，默认 "🗄️"
 */
export function getDbIcon(
  type: string | null | undefined,
  fallback = "🗄️",
): string {
  return (type && DB_ICONS[type]) || fallback;
}
