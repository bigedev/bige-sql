/**
 * BigeSQL - Database MCP Server
 * 开源免费的数据库 MCP Server
 * 支持 MySQL/MariaDB, PostgreSQL, SQLite, Dameng DM8, SQL Server, Oracle
 *
 * 使用方式:
 *   node out/src/server.js              # stdio 模式（默认）
 *   node out/src/server.js --http       # stdio + HTTP 模式（默认端口 3100）
 *   node out/src/server.js --http --port 8080  # 指定 HTTP 端口
 *   node out/src/server.js --http-only  # 仅 HTTP 模式
 *
 * 配置方式: 编辑 connections.json 添加数据库连接
 *
 * 所有工具都接受可选的 connection 参数指定连接名
 * 不传 connection 参数则使用默认第一个连接
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import mysql from "mysql2/promise";
import pg from "pg";
import Database from "better-sqlite3";
import dmdb from "dmdb";
import mssql from "mssql";
import oracledb from "oracledb";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { IncomingMessage, ServerResponse } from "http";
import {
  isMySQL,
  isPostgres,
  isSQLite,
  isDameng,
  isSqlServer,
  isOracle,
} from "./dbTypes";

// ─── 类型定义 ──────────────────────────────────────────────────

interface DbConnectionConfig {
  type: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  path?: string;
  charset?: string;
  timezone?: string;
  readonly?: boolean;
  connectionString?: string;
  /** Oracle 权限: 2=SYSDBA, 4=SYSOPER, 等 */
  oraclePrivilege?: number;
  /** Oracle 使用 SID 格式（host:port:sid）而非服务名（host:port/service） */
  oracleUseSid?: boolean;
}

interface ConnectionsConfig {
  connections: Record<string, DbConnectionConfig>;
}

type AnyPool =
  | mysql.Pool
  | pg.Pool
  | Database.Database
  | mssql.ConnectionPool
  | oracledb.Pool
  | any;

// ─── 连接配置管理 ────────────────────────────────────────────────

const CONFIG_PATH = join(__dirname, "..", "..", "connections.json");

function loadConnections(): Record<string, DbConnectionConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config: ConnectionsConfig = JSON.parse(raw);
  return config.connections || {};
}

const connections = loadConnections();
const connectionNames = Object.keys(connections);

// ─── 连接池管理 ──────────────────────────────────────────────────

const pools: Record<string, AnyPool> = {};

function getDefaultConnection(): string | null {
  return connectionNames[0] || null;
}

interface ConnectionResult {
  pool: AnyPool;
  config: DbConnectionConfig;
}

async function getConnection(name?: string): Promise<ConnectionResult> {
  const connName = name || getDefaultConnection();
  if (!connName) {
    throw new Error("沒有可用的資料庫連線。請在 connections.json 中設定連線。");
  }
  if (!connections[connName]) {
    throw new Error(
      `連線 "${connName}" 未設定。可用連線: ${connectionNames.join(", ") || "(無)"}`,
    );
  }

  if (pools[connName]) {
    try {
      await testPool(pools[connName], connections[connName]);
      return { pool: pools[connName], config: connections[connName] };
    } catch {
      // 连接池已失效，删除后重建
      await closePool(pools[connName], connections[connName]).catch(() => {});
      delete pools[connName];
    }
  }
  pools[connName] = await createPool(connName, connections[connName]);
  return { pool: pools[connName], config: connections[connName] };
}

async function getConnectionWithDb(
  name: string,
  dbName?: string,
): Promise<ConnectionResult> {
  const connName = name || getDefaultConnection();
  if (!connName) {
    throw new Error("沒有可用的資料庫連線。請在 connections.json 中設定連線。");
  }
  if (!connections[connName]) {
    throw new Error(
      `連線 "${connName}" 未設定。可用連線: ${connectionNames.join(", ") || "(無)"}`,
    );
  }
  // 指定了不同的数据库时，使用独立连接池
  const poolKey = dbName ? `${connName}@${dbName}` : connName;
  if (pools[poolKey]) {
    try {
      await testPool(pools[poolKey], connections[connName]);
      return { pool: pools[poolKey], config: connections[connName] };
    } catch {
      await closePool(pools[poolKey], connections[connName]).catch(() => {});
      delete pools[poolKey];
    }
  }
  pools[poolKey] = await createPool(connName, {
    ...connections[connName],
    database: dbName || connections[connName].database,
  });
  return { pool: pools[poolKey], config: connections[connName] };
}

async function createPool(
  name: string,
  config: DbConnectionConfig,
): Promise<AnyPool> {
  if (isMySQL(config.type)) {
    return mysql.createPool({
      host: config.host || "127.0.0.1",
      port: config.port || 3306,
      user: config.user || "root",
      password: config.password || "",
      database: config.database,
      charset: config.charset || "utf8mb4",
      timezone: config.timezone || "+08:00",
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
    });
  }

  if (isPostgres(config.type)) {
    const pool = new pg.Pool({
      host: config.host || "127.0.0.1",
      port: config.port || 5432,
      user: config.user || "postgres",
      password: config.password || "",
      database: config.database || "postgres",
      max: 1,
      idleTimeoutMillis: 30000,
    });
    // 初始化连接池
    await pool.query("SELECT 1");
    return pool;
  }

  if (isSQLite(config.type)) {
    const dbPath = config.path;
    if (!dbPath) {
      throw new Error("SQLite 連線需要設定 path");
    }
    const db = new Database(dbPath, { readonly: config.readonly || false });
    return db;
  }

  if (isDameng(config.type)) {
    const host = config.host || "127.0.0.1";
    const port = config.port || 5236;
    const user = config.user || "SYSDBA";
    const password = config.password || "SYSDBA";
    const dmUrl = `dm://${user}:${password}@${host}:${port}?autoCommit=false&loginEncrypt=false&connectTimeout=5000&socketTimeout=10000`;
    // 不使用连接池，每次 getConnection 创建直连
    return {
      _dmUrl: dmUrl,
      getConnection: () => dmdb.getConnection(dmUrl),
    };
  }

  if (isSqlServer(config.type)) {
    const pool = new mssql.ConnectionPool({
      server: config.host || "127.0.0.1",
      port: config.port || 1433,
      user: config.user || "sa",
      password: config.password || "",
      database: config.database || "master",
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
      pool: {
        max: 1,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    });
    await pool.connect();
    return pool;
  }

  if (isOracle(config.type)) {
    const connectString =
      config.connectionString ||
      (config.host && config.port
        ? config.oracleUseSid
          ? `${config.host}:${config.port}:${config.database || "XE"}`
          : `${config.host}:${config.port}/${config.database || "XE"}`
        : config.database || "XE");
    const privilege =
      config.oraclePrivilege ??
      (config.user?.toUpperCase() === "SYS" ? oracledb.SYSDBA : undefined);
    const poolConfig: any = {
      user: config.user || "scott",
      password: config.password || "tiger",
      connectString,
      poolMin: 0,
      poolMax: 1,
      poolIncrement: 1,
      poolTimeout: 60,
    };
    if (privilege !== undefined) poolConfig.privilege = privilege;
    const pool = await oracledb.createPool(poolConfig);
    return pool;
  }

  throw new Error(
    `不支援的資料庫類型: "${config.type}"。支援的類型: mysql, postgresql, sqlite, dameng, sqlserver, oracle`,
  );
}

// ─── SQL 执行封装 ────────────────────────────────────────────────

async function executeQuery(
  pool: AnyPool,
  sql: string,
  config: DbConnectionConfig,
): Promise<any> {
  if (isMySQL(config.type)) {
    const pool2 = pool as mysql.Pool;
    const [rows] = await pool2.query(sql);
    return rows;
  }

  if (isPostgres(config.type)) {
    const pool2 = pool as pg.Pool;
    const result = await pool2.query(sql);
    return result.rows;
  }

  if (isSQLite(config.type)) {
    const db = pool as Database.Database;
    const stmt = db.prepare(sql);
    const upper = sql.trim().toUpperCase();
    if (
      upper.startsWith("SELECT") ||
      upper.startsWith("WITH") ||
      upper.startsWith("PRAGMA")
    ) {
      return stmt.all();
    } else {
      const info = stmt.run();
      return {
        affectedRows: info.changes,
        lastInsertRowid: info.lastInsertRowid,
      };
    }
  }

  if (isDameng(config.type)) {
    const dmPool = pool as any;
    const conn = await dmPool.getConnection();
    try {
      const result = await conn.execute(sql, [], {
        outFormat: dmdb.OUT_FORMAT_OBJECT,
      });
      if (result.rows && result.rows.length > 0) {
        return result.rows;
      }
      if (result.rowsAffected !== undefined) {
        return { affectedRows: result.rowsAffected };
      }
      return result.rows || [];
    } finally {
      await conn.close();
    }
  }

  if (isSqlServer(config.type)) {
    const pool2 = pool as mssql.ConnectionPool;
    const request = pool2.request();
    const result = await request.query(sql);
    // recordset 为 undefined 表示非查询语句，为空数组表示查询无结果
    if (result.recordset !== undefined) {
      return result.recordset || [];
    }
    if (result.rowsAffected && result.rowsAffected[0] !== undefined) {
      return { affectedRows: result.rowsAffected[0] };
    }
    return [];
  }

  if (isOracle(config.type)) {
    const oraclePool = pool as oracledb.Pool;
    const conn = await oraclePool.getConnection();
    try {
      const result = await conn.execute(sql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      if (result.rows && result.rows.length > 0) {
        return result.rows.map((r: any) => {
          const normalized: any = {};
          for (const key of Object.keys(r)) {
            normalized[key.toLowerCase()] = r[key];
          }
          return normalized;
        });
      }
      if (result.rowsAffected !== undefined) {
        return { affectedRows: result.rowsAffected };
      }
      return [];
    } finally {
      await conn.close();
    }
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

async function closePool(
  pool: AnyPool,
  config: DbConnectionConfig,
): Promise<void> {
  if (isMySQL(config.type)) {
    await (pool as mysql.Pool).end();
  } else if (isPostgres(config.type)) {
    await (pool as pg.Pool).end();
  } else if (isSQLite(config.type)) {
    (pool as Database.Database).close();
  } else if (isSqlServer(config.type)) {
    await (pool as mssql.ConnectionPool).close();
  } else if (isOracle(config.type)) {
    await (pool as oracledb.Pool).close();
  }
  // dameng 为直连模式，无需关闭池
}

/** 检查连接池是否仍有效，失效时抛出异常 */
async function testPool(
  pool: AnyPool,
  config: DbConnectionConfig,
): Promise<void> {
  if (
    isMySQL(config.type) ||
    isPostgres(config.type) ||
    isSqlServer(config.type)
  ) {
    await (pool as any).query("SELECT 1");
  } else if (isSQLite(config.type)) {
    (pool as Database.Database).prepare("SELECT 1").get();
  } else if (isOracle(config.type)) {
    const oraclePool = pool as oracledb.Pool;
    const conn = await oraclePool.getConnection();
    try {
      await conn.execute("SELECT 1 FROM DUAL", [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
    } finally {
      await conn.close();
    }
  } else if (isDameng(config.type)) {
    const conn = await (pool as any).getConnection();
    try {
      await conn.execute("SELECT 1");
    } finally {
      await conn.close();
    }
  }
}

// ─── 表信息查询 ──────────────────────────────────────────────────

async function listTables(
  pool: AnyPool,
  config: DbConnectionConfig,
): Promise<any[]> {
  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment,
              ENGINE AS engine, TABLE_ROWS AS rowCount, CREATE_TIME AS createTime,
              TABLE_COLLATION AS collation
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = '${config.database}'
       ORDER BY TABLE_NAME`,
      config,
    );
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT tablename AS name, 'TABLE' AS type
       FROM pg_catalog.pg_tables
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       UNION ALL
       SELECT viewname AS name, 'VIEW' AS type
       FROM pg_catalog.pg_views
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY name`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(
      pool,
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
      config,
    );
  }

  if (isDameng(config.type)) {
    const ownerFilter = config.user
      ? `WHERE OWNER = '${config.user.replace(/'/g, "''")}'`
      : `WHERE OWNER NOT IN ('SYS','SYSDBA','SYSAUDITOR','CTISYS')`;
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, 'TABLE' AS type FROM ALL_TABLES ${ownerFilter}
       UNION ALL
       SELECT OBJECT_NAME AS name, 'VIEW' AS type FROM ALL_OBJECTS
       WHERE OBJECT_TYPE = 'VIEW' ${ownerFilter}
       ORDER BY name`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
       ORDER BY TABLE_NAME`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, 'TABLE' AS type
       FROM ALL_TABLES
       WHERE OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
       UNION ALL
       SELECT VIEW_NAME AS name, 'VIEW' AS type
       FROM ALL_VIEWS
       WHERE OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
       ORDER BY name`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

async function describeTable(
  pool: AnyPool,
  config: DbConnectionConfig,
  tableName: string,
): Promise<any[]> {
  const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');
  if (isMySQL(config.type)) {
    return executeQuery(pool, `DESCRIBE \`${safeName}\``, config);
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT column_name AS "Field", data_type AS "Type",
              is_nullable AS "Null", column_default AS "Default"
       FROM information_schema.columns
       WHERE table_name = '${safeName}'
       ORDER BY ordinal_position`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(pool, `PRAGMA table_info('${safeName}')`, config);
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type",
              NULLABLE AS "Null", DATA_DEFAULT AS "Default"
       FROM ALL_TAB_COLUMNS
       WHERE TABLE_NAME = '${safeName}'
       ORDER BY COLUMN_ID`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type",
              IS_NULLABLE AS "Null", COLUMN_DEFAULT AS "Default"
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_NAME = '${safeName}'
       ORDER BY ORDINAL_POSITION`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type",
              NULLABLE AS "Null", DATA_DEFAULT AS "Default"
       FROM ALL_TAB_COLUMNS
       WHERE TABLE_NAME = '${safeName}'
       ORDER BY COLUMN_ID`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 获取表 DDL ──────────────────────────────────────────────────

async function getTableSchema(
  pool: AnyPool,
  config: DbConnectionConfig,
  tableName: string,
): Promise<any> {
  const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');
  const q = isMySQL(config.type) ? "`" : '"';

  if (isMySQL(config.type)) {
    return executeQuery(pool, `SHOW CREATE TABLE \`${safeName}\``, config);
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT column_name AS "Field", data_type AS "Type",
              is_nullable AS "Null", column_default AS "Default",
              ordinal_position
       FROM information_schema.columns
       WHERE table_name = '${safeName}'
       ORDER BY ordinal_position`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    // SQLite 直接在 sqlite_master 存了完整 DDL
    return executeQuery(
      pool,
      `SELECT sql FROM sqlite_master WHERE name = '${safeName}' AND type IN ('table','view')`,
      config,
    );
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT DBMS_METADATA.GET_DDL('TABLE', '${safeName}') AS ddl FROM dual`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    // SQL Server 使用 sp_help 或 INFORMATION_SCHEMA 获取列信息
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type",
              IS_NULLABLE AS "Null", COLUMN_DEFAULT AS "Default",
              ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_NAME = '${safeName}'
       ORDER BY ORDINAL_POSITION`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type",
              NULLABLE AS "Null", DATA_DEFAULT AS "Default",
              COLUMN_ID
       FROM ALL_TAB_COLUMNS
       WHERE TABLE_NAME = '${safeName}'
       ORDER BY COLUMN_ID`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 列出表索引 ──────────────────────────────────────────────────

async function getTableIndexes(
  pool: AnyPool,
  config: DbConnectionConfig,
  tableName: string,
): Promise<any> {
  const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');

  if (isMySQL(config.type)) {
    return executeQuery(pool, `SHOW INDEX FROM \`${safeName}\``, config);
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT indexname AS index_name, indexdef AS index_definition
       FROM pg_indexes
       WHERE tablename = '${safeName}'
       ORDER BY indexname`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(pool, `PRAGMA index_list('${safeName}')`, config);
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT INDEX_NAME, COLUMN_NAME, INDEX_TYPE
       FROM ALL_IND_COLUMNS
       WHERE TABLE_NAME = '${safeName}'
       ORDER BY INDEX_NAME, COLUMN_POSITION`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT i.name AS index_name,
              COL_NAME(ic.object_id, ic.column_id) AS column_name,
              i.type_desc AS index_type
       FROM sys.indexes i
       JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
       WHERE i.object_id = OBJECT_ID('${safeName}')
       ORDER BY i.name, ic.index_column_id`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT INDEX_NAME, COLUMN_NAME, INDEX_TYPE
       FROM ALL_IND_COLUMNS
       WHERE TABLE_NAME = '${safeName}'
       ORDER BY INDEX_NAME, COLUMN_POSITION`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 获取执行计划 ──────────────────────────────────────────────

async function explainQuery(
  pool: AnyPool,
  config: DbConnectionConfig,
  sql: string,
): Promise<any> {
  if (isMySQL(config.type)) {
    return executeQuery(pool, `EXPLAIN ${sql}`, config);
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `EXPLAIN (ANALYZE false, FORMAT JSON) ${sql}`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(pool, `EXPLAIN QUERY PLAN ${sql}`, config);
  }

  if (isDameng(config.type)) {
    return executeQuery(pool, `EXPLAIN ${sql}`, config);
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SET SHOWPLAN_XML ON; ${sql}; SET SHOWPLAN_XML OFF;`,
      config,
    );
  }

  if (isOracle(config.type)) {
    // Oracle: EXPLAIN PLAN FOR 然后查询 DBMS_XPLAN
    await executeQuery(pool, `EXPLAIN PLAN FOR ${sql}`, config);
    return executeQuery(
      pool,
      `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'BASIC'))`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 获取表详细信息 ────────────────────────────────────────────

async function getTableInfo(
  pool: AnyPool,
  config: DbConnectionConfig,
  tableName: string,
): Promise<any> {
  const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');

  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine,
              TABLE_ROWS AS rowCount, AVG_ROW_LENGTH AS avgRowLength,
              DATA_LENGTH AS dataSize, INDEX_LENGTH AS indexSize,
              TABLE_COLLATION AS collation, CREATE_TIME AS createTime,
              UPDATE_TIME AS updateTime, TABLE_COMMENT AS comment
       FROM information_schema.TABLES
       WHERE TABLE_NAME = '${safeName}' AND TABLE_SCHEMA = '${config.database}'`,
      config,
    );
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT c.relname AS name,
              pg_size_pretty(pg_total_relation_size(c.oid)) AS totalSize,
              pg_size_pretty(pg_table_size(c.oid)) AS tableSize,
              pg_size_pretty(pg_indexes_size(c.oid)) AS indexSize,
              (SELECT count(*) FROM pg_stat_user_tables WHERE relname = c.relname) AS rowCount,
              obj_description(c.oid) AS comment
       FROM pg_class c
       WHERE c.relname = '${safeName}' AND c.relkind IN ('r','v')`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(
      pool,
      `SELECT name, type, rootpage AS rootPage
       FROM sqlite_master
       WHERE name = '${safeName}' AND type IN ('table','view')`,
      config,
    );
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLESPACE_NAME AS tablespace,
              NUM_ROWS AS rowCount, LAST_ANALYZED AS lastAnalyzed
       FROM ALL_TABLES
       WHERE TABLE_NAME = '${safeName}'`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_NAME = '${safeName}'`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, 'TABLE' AS type,
              NUM_ROWS AS rowCount, LAST_ANALYZED AS lastAnalyzed
       FROM ALL_TABLES
       WHERE TABLE_NAME = '${safeName}'`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 搜索表 ──────────────────────────────────────────────────────

async function searchTables(
  pool: AnyPool,
  config: DbConnectionConfig,
  keyword: string,
): Promise<any> {
  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = '${config.database}' AND TABLE_NAME LIKE '%${keyword}%'
       ORDER BY TABLE_NAME`,
      config,
    );
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT tablename AS name, 'TABLE' AS type
       FROM pg_catalog.pg_tables
       WHERE schemaname NOT IN ('pg_catalog','information_schema')
         AND tablename ILIKE '%${keyword}%'
       UNION ALL
       SELECT viewname AS name, 'VIEW' AS type
       FROM pg_catalog.pg_views
       WHERE schemaname NOT IN ('pg_catalog','information_schema')
         AND viewname ILIKE '%${keyword}%'
       ORDER BY name`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(
      pool,
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table','view') AND name LIKE '%${keyword}%'
       ORDER BY name`,
      config,
    );
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM ALL_TABLES
       WHERE OWNER NOT IN ('SYS','SYSDBA','SYSAUDITOR','CTISYS')
         AND TABLE_NAME LIKE '%${keyword}%'
       ORDER BY TABLE_NAME`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_NAME LIKE '%${keyword}%'
       ORDER BY TABLE_NAME`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, 'TABLE' AS type
       FROM ALL_TABLES
       WHERE OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
         AND TABLE_NAME LIKE '%${keyword}%'
       UNION ALL
       SELECT VIEW_NAME AS name, 'VIEW' AS type
       FROM ALL_VIEWS
       WHERE OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
         AND VIEW_NAME LIKE '%${keyword}%'
       ORDER BY name`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 列出 Schema ────────────────────────────────────────────────

async function listSchemas(
  pool: AnyPool,
  config: DbConnectionConfig,
): Promise<any> {
  if (isMySQL(config.type)) {
    // MySQL 中 DATABASE 即 schema
    return executeQuery(pool, "SHOW DATABASES", config);
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT schema_name AS name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog','information_schema')
       ORDER BY schema_name`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(
      pool,
      `SELECT DISTINCT name AS name FROM sqlite_master WHERE type = 'table'
       UNION ALL SELECT 'main' AS name
       ORDER BY name`,
      config,
    );
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT DISTINCT OWNER AS name FROM ALL_TABLES
       WHERE OWNER NOT IN ('SYS','SYSDBA','SYSAUDITOR','CTISYS')
       ORDER BY name`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('sys','INFORMATION_SCHEMA','guest','db_accessadmin','db_backupoperator','db_datareader','db_datawriter','db_ddladmin','db_denydatareader','db_denydatawriter','db_owner','db_securityadmin')
       ORDER BY SCHEMA_NAME`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT DISTINCT OWNER AS name FROM ALL_TABLES
       WHERE OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
       ORDER BY name`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 获取外键关系 ──────────────────────────────────────────────

async function getForeignKeys(
  pool: AnyPool,
  config: DbConnectionConfig,
  tableName: string,
): Promise<any> {
  const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');

  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS columnName,
              REFERENCED_TABLE_NAME AS refTable,
              REFERENCED_COLUMN_NAME AS refColumn
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_NAME = '${safeName}' AND TABLE_SCHEMA = '${config.database}'
         AND REFERENCED_TABLE_NAME IS NOT NULL`,
      config,
    );
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT
        kcu.column_name AS columnName,
        ccu.table_name AS refTable,
        ccu.column_name AS refColumn,
        tc.constraint_name AS constraintName
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = '${safeName}'`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(pool, `PRAGMA foreign_key_list('${safeName}')`, config);
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS columnName,
              REFERENCED_TABLE_NAME AS refTable,
              REFERENCED_COLUMN_NAME AS refColumn
       FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
       WHERE c.CONSTRAINT_TYPE = 'R' AND c.TABLE_NAME = '${safeName}'`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS columnName,
              REFERENCED_TABLE_NAME AS refTable,
              REFERENCED_COLUMN_NAME AS refColumn
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
       WHERE kcu.TABLE_NAME = '${safeName}'`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT cc.COLUMN_NAME AS columnName,
              c.TABLE_NAME AS refTable,
              (SELECT COLUMN_NAME FROM ALL_CONS_COLUMNS
               WHERE CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
                 AND OWNER = c.OWNER
                 AND ROWNUM = 1) AS refColumn
       FROM ALL_CONSTRAINTS c
       JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER
       WHERE c.CONSTRAINT_TYPE = 'R' AND c.TABLE_NAME = '${safeName}'`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 列出存储过程和函数 ────────────────────────────────────────

async function listProcedures(
  pool: AnyPool,
  config: DbConnectionConfig,
): Promise<any> {
  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type,
              CREATED AS createTime, LAST_ALTERED AS modifiedTime
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = '${config.database}'
       ORDER BY ROUTINE_NAME`,
      config,
    );
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT proname AS name,
              CASE WHEN prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS type
       FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       ORDER BY proname`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(
      pool,
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('procedure','function')
       ORDER BY name`,
      config,
    );
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT OBJECT_NAME AS name, OBJECT_TYPE AS type
       FROM ALL_OBJECTS
       WHERE OBJECT_TYPE IN ('PROCEDURE','FUNCTION') AND OWNER NOT IN ('SYS','SYSDBA')
       ORDER BY OBJECT_NAME`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
       FROM INFORMATION_SCHEMA.ROUTINES
       ORDER BY ROUTINE_NAME`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT OBJECT_NAME AS name, OBJECT_TYPE AS type
       FROM ALL_OBJECTS
       WHERE OBJECT_TYPE IN ('PROCEDURE','FUNCTION')
         AND OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
       ORDER BY OBJECT_NAME`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 获取存储过程/函数源码 ──────────────────────────────────────

async function getProcedureSource(
  pool: AnyPool,
  config: DbConnectionConfig,
  name: string,
): Promise<any> {
  if (isMySQL(config.type)) {
    return executeQuery(pool, `SHOW CREATE PROCEDURE \`${name}\``, config);
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT pg_get_functiondef(p.oid) AS source
       FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE p.proname = '${name}' AND n.nspname NOT IN ('pg_catalog','information_schema')`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(
      pool,
      `SELECT sql FROM sqlite_master WHERE name = '${name}' AND type IN ('procedure','function')`,
      config,
    );
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT TEXT FROM ALL_SOURCE WHERE NAME = '${name}' AND OWNER NOT IN ('SYS','SYSDBA') ORDER BY LINE`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT OBJECT_DEFINITION(OBJECT_ID('${name}')) AS source`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT TEXT FROM ALL_SOURCE
       WHERE NAME = '${name}' AND OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
       ORDER BY LINE`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 获取主键信息 ──────────────────────────────────────────────

async function getPrimaryKeys(
  pool: AnyPool,
  config: DbConnectionConfig,
  tableName: string,
): Promise<any> {
  const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');

  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_NAME = '${safeName}' AND TABLE_SCHEMA = '${config.database}'
         AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      config,
    );
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT kcu.column_name AS columnName, tc.constraint_name AS constraintName
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = '${safeName}'`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(pool, `PRAGMA table_info('${safeName}')`, config);
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName
       FROM ALL_CONS_COLUMNS
       WHERE CONSTRAINT_NAME IN (
         SELECT CONSTRAINT_NAME FROM ALL_CONSTRAINTS
         WHERE CONSTRAINT_TYPE = 'P' AND TABLE_NAME = '${safeName}'
       )
       ORDER BY POSITION`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_NAME = '${safeName}' AND CONSTRAINT_NAME IN (
         SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_TYPE = 'PRIMARY KEY' AND TABLE_NAME = '${safeName}'
       )
       ORDER BY ORDINAL_POSITION`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName
       FROM ALL_CONS_COLUMNS
       WHERE CONSTRAINT_NAME IN (
         SELECT CONSTRAINT_NAME FROM ALL_CONSTRAINTS
         WHERE CONSTRAINT_TYPE = 'P' AND TABLE_NAME = '${safeName}'
       )
       ORDER BY POSITION`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 列出视图及定义 ────────────────────────────────────────────

async function listViews(
  pool: AnyPool,
  config: DbConnectionConfig,
): Promise<any> {
  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, VIEW_DEFINITION AS definition
       FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = '${config.database}'
       ORDER BY TABLE_NAME`,
      config,
    );
  }

  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT viewname AS name, definition
       FROM pg_catalog.pg_views
       WHERE schemaname NOT IN ('pg_catalog','information_schema')
       ORDER BY viewname`,
      config,
    );
  }

  if (isSQLite(config.type)) {
    return executeQuery(
      pool,
      `SELECT name, sql AS definition FROM sqlite_master
       WHERE type = 'view'
       ORDER BY name`,
      config,
    );
  }

  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT VIEW_NAME AS name, TEXT AS definition
       FROM ALL_VIEWS
       WHERE OWNER NOT IN ('SYS','SYSDBA','SYSAUDITOR','CTISYS')
       ORDER BY VIEW_NAME`,
      config,
    );
  }

  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT TABLE_NAME AS name, VIEW_DEFINITION AS definition
       FROM INFORMATION_SCHEMA.VIEWS
       ORDER BY TABLE_NAME`,
      config,
    );
  }

  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT VIEW_NAME AS name, TEXT AS definition
       FROM ALL_VIEWS
       WHERE OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
       ORDER BY VIEW_NAME`,
      config,
    );
  }

  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ── 触发器列表 ────────────────────────────────────────────

async function getTriggers(
  pool: AnyPool,
  config: DbConnectionConfig,
  tableName: string,
): Promise<any[]> {
  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT tgname AS "triggerName",
        pg_get_triggerdef(t.oid) AS "triggerDefinition"
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE c.relname = '${tableName.replace(/'/g, "''")}'
        AND NOT tgisinternal
      ORDER BY tgname`,
      config,
    );
  }
  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT TRIGGER_NAME AS "triggerName",
        ACTION_TIMING AS "timing",
        EVENT_MANIPULATION AS "event"
      FROM information_schema.TRIGGERS
      WHERE EVENT_OBJECT_TABLE = '${tableName.replace(/'/g, "''")}'
        AND EVENT_OBJECT_SCHEMA = '${config.database || ""}'
      ORDER BY TRIGGER_NAME`,
      config,
    );
  }
  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT name AS "triggerName",
        OBJECT_DEFINITION(object_id) AS "triggerDefinition"
      FROM sys.triggers
      WHERE parent_id = OBJECT_ID('${tableName.replace(/'/g, "''")}')
      ORDER BY name`,
      config,
    );
  }
  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT TRIGGER_NAME AS "triggerName",
        TRIGGER_BODY AS "triggerDefinition"
      FROM ALL_TRIGGERS
      WHERE TABLE_NAME = '${tableName.replace(/'/g, "''")}'
      ORDER BY TRIGGER_NAME`,
      config,
    );
  }
  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ── 存储过程参数 ──────────────────────────────────────────

async function getProcedureParameters(
  pool: AnyPool,
  config: DbConnectionConfig,
  procName: string,
): Promise<any[]> {
  if (isPostgres(config.type)) {
    return executeQuery(
      pool,
      `SELECT p.proname AS "procedureName",
        pg_get_function_arguments(p.oid) AS "arguments"
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.proname = '${procName.replace(/'/g, "''")}'
        AND n.nspname NOT IN ('pg_catalog','information_schema')
      LIMIT 1`,
      config,
    );
  }
  if (isMySQL(config.type)) {
    return executeQuery(
      pool,
      `SELECT PARAMETER_NAME AS "paramName",
        PARAMETER_MODE AS "paramMode",
        DATA_TYPE AS "dataType"
      FROM information_schema.PARAMETERS
      WHERE SPECIFIC_NAME = '${procName.replace(/'/g, "''")}'
        AND SPECIFIC_SCHEMA = '${config.database || ""}'
      ORDER BY ORDINAL_POSITION`,
      config,
    );
  }
  if (isSqlServer(config.type)) {
    return executeQuery(
      pool,
      `SELECT p.name AS "paramName",
        t.name AS "dataType",
        p.max_length AS "maxLength"
      FROM sys.parameters p
      JOIN sys.types t ON p.system_type_id = t.system_type_id
      WHERE p.object_id = OBJECT_ID('${procName.replace(/'/g, "''")}')
      ORDER BY p.parameter_id`,
      config,
    );
  }
  if (isDameng(config.type)) {
    return executeQuery(
      pool,
      `SELECT ARGUMENT_NAME AS "paramName",
        DATA_TYPE AS "dataType",
        IN_OUT AS "paramMode"
      FROM ALL_ARGUMENTS
      WHERE OBJECT_NAME = '${procName.replace(/'/g, "''")}'
      ORDER BY POSITION`,
      config,
    );
  }
  if (isOracle(config.type)) {
    return executeQuery(
      pool,
      `SELECT ARGUMENT_NAME AS "paramName",
        DATA_TYPE AS "dataType",
        IN_OUT AS "paramMode"
      FROM ALL_ARGUMENTS
      WHERE OBJECT_NAME = '${procName.replace(/'/g, "''")}'
        AND OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
      ORDER BY POSITION`,
      config,
    );
  }
  throw new Error(`不支援的資料庫類型: ${config.type}`);
}

// ─── 格式化输出 ──────────────────────────────────────────────────

function formatResult(data: any): string {
  return JSON.stringify(data, null, 2);
}

// ─── MCP Server 工厂 ────────────────────────────────────────────

function createMcpServer(): McpServer {
  const srv = new McpServer(
    {
      name: "BigeSQL MCP Server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ── 列出连接 ──
  srv.registerTool(
    "list-connections",
    {
      description: `列出所有已配置的数据库连接。当前可用连接: ${connectionNames.join(", ") || "(无)"}`,
    },
    async () => {
      const list = connectionNames.map((n) => {
        const c = connections[n];
        return {
          name: n,
          type: c.type,
          database: c.database || c.path || c.connectionString || "",
        };
      });
      return { content: [{ type: "text", text: formatResult(list) }] };
    },
  );

  // ── 测试连接 ──
  srv.registerTool(
    "test-connection",
    {
      description: "测试指定数据库连接是否正常",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const config = connections[connName];
      if (!config) {
        return {
          content: [{ type: "text", text: `❌ 连接 "${connName}" 未配置` }],
          isError: true,
        };
      }
      const { pool, config: cfg } = await getConnection(connName);
      const sql = isOracle(cfg.type)
        ? "SELECT 1 AS result FROM DUAL"
        : "SELECT 1 AS result";
      const result = await executeQuery(pool, sql, cfg);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 列出数据库 ──
  srv.registerTool(
    "list-databases",
    {
      description:
        "列出服务器上的所有数据库（仅 MySQL/PostgreSQL/SQL Server 支持）",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      let result: any[];
      if (isMySQL(cfg.type)) {
        result = await executeQuery(pool, "SHOW DATABASES", cfg);
      } else if (isPostgres(cfg.type)) {
        result = await executeQuery(
          pool,
          "SELECT datname AS database FROM pg_database WHERE datistemplate = false ORDER BY datname",
          cfg,
        );
      } else if (isSqlServer(cfg.type)) {
        result = await executeQuery(
          pool,
          "SELECT name AS database FROM sys.databases ORDER BY name",
          cfg,
        );
      } else {
        return {
          content: [{ type: "text", text: "当前数据库类型不支持列出数据库" }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 列出表 ──
  srv.registerTool(
    "list-tables",
    {
      description: "列出指定数据库中的所有表和视图",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        database: z.string().optional().describe("数据库名，可选"),
        schema: z.string().optional().describe("Schema名，可选"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnectionWithDb(
        connName,
        args.database,
      );
      const result = await listTables(pool, cfg);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 描述表结构 ──
  srv.registerTool(
    "describe-table",
    {
      description: "查看指定表的字段结构（列名、类型、默认值等）",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        tableName: z.string().describe("表名（必填）"),
        database: z.string().optional().describe("数据库名，可选"),
        schema: z.string().optional().describe("Schema名，可选"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnectionWithDb(
        connName,
        args.database,
      );
      const result = await describeTable(pool, cfg, args.tableName);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 查询 ──
  srv.registerTool(
    "query",
    {
      description: "执行 SQL SELECT 查询语句，返回结果集",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        sql: z.string().describe("SQL SELECT 查询语句（必填）"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await executeQuery(pool, args.sql, cfg);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 执行 ──
  srv.registerTool(
    "execute",
    {
      description:
        "执行 SQL DML 语句（INSERT, UPDATE, DELETE, CREATE, ALTER, DROP），返回影响行数",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        sql: z
          .string()
          .describe("SQL 语句（INSERT, UPDATE, DELETE 等）（必填）"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await executeQuery(pool, args.sql, cfg);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取表 DDL ──
  srv.registerTool(
    "get-schema",
    {
      description:
        "获取指定表的 DDL 建表语句或完整字段结构，用于了解表的精确定义",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        tableName: z.string().describe("表名（必填）"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await getTableSchema(pool, cfg, args.tableName);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 列出索引 ──
  srv.registerTool(
    "list-indexes",
    {
      description: "列出指定表的所有索引信息，包含索引名、列名、类型等",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        tableName: z.string().describe("表名（必填）"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await getTableIndexes(pool, cfg, args.tableName);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取执行计划 ──
  srv.registerTool(
    "explain-query",
    {
      description: "获取 SQL 语句的执行计划，用于分析和优化查询性能",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        sql: z.string().describe("要分析的 SQL 语句（必填）"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await explainQuery(pool, cfg, args.sql);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取表详细信息 ──
  srv.registerTool(
    "get-table-info",
    {
      description:
        "获取指定表的详细信息，包含行数、数据大小、索引大小、引擎、字符集等",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        tableName: z.string().describe("表名（必填）"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await getTableInfo(pool, cfg, args.tableName);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 搜索表 ──
  srv.registerTool(
    "search-tables",
    {
      description: "按关键词模糊搜索表名和视图名，返回匹配的表和视图列表",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        keyword: z.string().describe("搜索关键词（必填），用于模糊匹配表名"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await searchTables(pool, cfg, args.keyword);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 列出 Schema ──
  srv.registerTool(
    "list-schemas",
    {
      description:
        "列出数据库中的所有 schema（PostgreSQL）/ 数据库列表（MySQL）/ 用户（达梦）",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await listSchemas(pool, cfg);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取外键关系 ──
  srv.registerTool(
    "get-foreign-keys",
    {
      description:
        "获取指定表的外键约束信息，包含引用表和列，用于了解表间关联关系",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        tableName: z.string().describe("表名（必填）"),
        database: z.string().optional().describe("数据库名，可选"),
        schema: z.string().optional().describe("Schema名，可选"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnectionWithDb(
        connName,
        args.database,
      );
      const result = await getForeignKeys(pool, cfg, args.tableName);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 列出存储过程和函数 ──
  srv.registerTool(
    "list-procedures",
    {
      description: "列出数据库中的所有存储过程（PROCEDURE）和函数（FUNCTION）",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        database: z.string().optional().describe("数据库名，可选"),
        schema: z.string().optional().describe("Schema名，可选"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnectionWithDb(
        connName,
        args.database,
      );
      const result = await listProcedures(pool, cfg);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取存储过程/函数源码 ──
  srv.registerTool(
    "get-procedure",
    {
      description: "获取指定存储过程或函数的定义源码",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        name: z.string().describe("存储过程或函数名（必填）"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await getProcedureSource(pool, cfg, args.name);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取主键信息 ──
  srv.registerTool(
    "get-primary-keys",
    {
      description: "获取指定表的主键列信息",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        tableName: z.string().describe("表名（必填）"),
        database: z.string().optional().describe("数据库名，可选"),
        schema: z.string().optional().describe("Schema名，可选"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnectionWithDb(
        connName,
        args.database,
      );
      const result = await getPrimaryKeys(pool, cfg, args.tableName);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 列出视图及定义 ──
  srv.registerTool(
    "list-views",
    {
      description: "列出数据库中所有视图及其定义（CREATE VIEW 语句）",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnection(connName);
      const result = await listViews(pool, cfg);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取触发器 ──
  srv.registerTool(
    "get-triggers",
    {
      description: "获取指定表的所有触发器信息",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        tableName: z.string().describe("表名（必填）"),
        database: z.string().optional().describe("数据库名，可选"),
        schema: z.string().optional().describe("Schema名，可选"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnectionWithDb(
        connName,
        args.database,
      );
      const result = await getTriggers(pool, cfg, args.tableName);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  // ── 获取存储过程参数 ──
  srv.registerTool(
    "get-procedure-parameters",
    {
      description: "获取指定存储过程/函数的参数列表",
      inputSchema: z.object({
        connection: z
          .string()
          .optional()
          .describe(
            `连接名称，可选。默认: ${getDefaultConnection() || "第一个可用连接"}`,
          ),
        name: z.string().describe("存储过程或函数名（必填）"),
        database: z.string().optional().describe("数据库名，可选"),
        schema: z.string().optional().describe("Schema名，可选"),
      }),
    },
    async (args) => {
      const connName = args.connection || getDefaultConnection() || "";
      const { pool, config: cfg } = await getConnectionWithDb(
        connName,
        args.database,
      );
      const result = await getProcedureParameters(pool, cfg, args.name);
      return { content: [{ type: "text", text: formatResult(result) }] };
    },
  );

  return srv;
}

// ─── 启动 ────────────────────────────────────────────────────────

const DEFAULT_HTTP_PORT = 5237;

function parseArgs(): { http: boolean; httpOnly: boolean; port: number } {
  const args = process.argv.slice(2);
  const http = args.includes("--http");
  const httpOnly = args.includes("--http-only");
  const portIdx = args.indexOf("--port");
  const port =
    portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : DEFAULT_HTTP_PORT;
  return {
    http: http || httpOnly,
    httpOnly,
    port: isNaN(port) ? DEFAULT_HTTP_PORT : port,
  };
}

async function main(): Promise<void> {
  const { http, httpOnly, port } = parseArgs();

  if (!httpOnly) {
    const srv = createMcpServer();
    const stdioTransport = new StdioServerTransport();
    await srv.connect(stdioTransport);
    console.error("🚀 Database MCP Server (stdio) started");
  }

  if (http) {
    // HTTP 模式：每个会话使用独立的 transport + McpServer
    // 同时支持 SSE (GET 建连) 和 Streamable HTTP (POST 消息)
    interface HttpSession {
      transport: StreamableHTTPServerTransport;
      server: McpServer;
    }
    const sessions = new Map<string, HttpSession>();

    const httpApp = createMcpExpressApp({ host: "127.0.0.1" });
    httpApp.all(
      "/mcp",
      async (
        req: IncomingMessage & { body?: unknown },
        res: ServerResponse,
      ) => {
        const sessionId = (req.headers as Record<string, string>)[
          "mcp-session-id"
        ];
        const existing = sessionId ? sessions.get(sessionId) : undefined;

        try {
          if (existing) {
            // 已有会话：复用 transport
            await existing.transport.handleRequest(req, res, req.body);
          } else {
            // 新会话：创建 transport + McpServer
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              enableJsonResponse: true,
            });
            const server = createMcpServer();
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            if (transport.sessionId) {
              sessions.set(transport.sessionId, { transport, server });
            }
          }
        } catch (err: any) {
          console.error("❌ HTTP handler error:", err.message);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      },
    );
    const server = httpApp.listen(port, () => {
      console.error(
        `🌐 MCP HTTP server listening on http://127.0.0.1:${port}/mcp`,
      );
    });
    // 禁用 HTTP 空闲超时（默认 5 分钟），避免 MCP SSE 流被意外断开
    server.timeout = 0;
    server.keepAliveTimeout = 0;
    server.headersTimeout = 0;
  }

  console.error(
    `📡 已配置 ${connectionNames.length} 个连接: ${connectionNames.join(", ")}`,
  );
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
