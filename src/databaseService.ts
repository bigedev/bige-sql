/**
 * BigeSQL - 数据库服务
 * 支持 MySQL, PostgreSQL, SQLite, Dameng DM8, SQL Server, Oracle
 */
import mysql from "mysql2/promise";
import pg from "pg";
import Database from "better-sqlite3";
import dmdb from "dmdb";
import mssql from "mssql";
import oracledb from "oracledb";
import { ConnectionManager, DbConfig } from "./connectionManager";
import {
  isMySQL,
  isPostgres,
  isSQLite,
  isDameng,
  isSqlServer,
  isOracle,
} from "./dbTypes";

interface QueryResult {
  rows: any[];
  isSelect: boolean;
  fields?: any[];
  affectedRows?: number;
}

export class DatabaseService {
  private pools: Record<string, any> = {};

  constructor(private connectionManager: ConnectionManager) {}

  private async getPool(
    connName: string,
    dbName?: string,
  ): Promise<{ pool: any; config: DbConfig }> {
    const config = this.connectionManager.getConnectionRaw(connName);
    if (!config) throw new Error(`Connection "${connName}" does not exist`);

    // 指定了不同数据库时，使用独立连接池
    const poolKey = dbName ? `${connName}@${dbName}` : connName;

    if (this.pools[poolKey]) {
      try {
        await this.testPool(this.pools[poolKey], config);
        return { pool: this.pools[poolKey], config };
      } catch {
        delete this.pools[poolKey];
      }
    }

    const pool = dbName
      ? await this.createPool({ ...config, database: dbName })
      : await this.createPool(config);
    this.pools[poolKey] = pool;
    return { pool, config };
  }

  private async createPool(config: DbConfig): Promise<any> {
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
        connectionLimit: 5,
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
        max: 5,
        idleTimeoutMillis: 30000,
      });
      await pool.query("SELECT 1");
      return pool;
    }

    if (isSQLite(config.type)) {
      if (!config.path) throw new Error("SQLite connection requires path");
      return new Database(config.path, {
        readonly: config.readonly || false,
      });
    }

    if (isDameng(config.type)) {
      const host = config.host || "127.0.0.1";
      const port = config.port || 5236;
      const user = config.user || "SYSDBA";
      const password = config.password || "SYSDBA";
      const dmUrl = `dm://${user}:${password}@${host}:${port}`;
      const poolAlias = `dmdb_${host}_${port}_${user}`;
      const dm = dmdb as any;
      if (!dm.pools[poolAlias]) {
        const pool = await dm.createPool({
          poolAlias,
          connectString: dmUrl,
          poolMax: 5,
          poolMin: 0,
          poolTimeout: 60,
        });
        // createPool 返回的 pool 已自动注册到 dm.pools
        return pool;
      }
      return dm.pools.get(poolAlias);
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
          max: 5,
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
        poolMax: 5,
        poolIncrement: 1,
        poolTimeout: 60,
      };
      if (privilege !== undefined) poolConfig.privilege = privilege;
      return oracledb.createPool(poolConfig);
    }

    throw new Error(`Unsupported database type: "${config.type}"`);
  }

  private async testPool(pool: any, config: DbConfig): Promise<void> {
    if (
      isMySQL(config.type) ||
      isPostgres(config.type) ||
      isSqlServer(config.type)
    ) {
      await pool.query("SELECT 1");
    } else if (isSQLite(config.type)) {
      pool.prepare("SELECT 1").get();
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
    }
    // dameng 无需测试
  }

  async testConnection(config: DbConfig): Promise<boolean> {
    const pool = await this.createPool(config);
    try {
      // 执行真实查询验证连接有效性
      if (isMySQL(config.type)) {
        const [rows] = await pool.query("SELECT 1 AS result");
        if (!rows || rows.length === 0) throw new Error("無返回結果");
      } else if (isPostgres(config.type)) {
        const result = await pool.query("SELECT 1 AS result");
        if (!result.rows || result.rows.length === 0)
          throw new Error("無返回結果");
      } else if (isSQLite(config.type)) {
        const row = pool.prepare("SELECT 1 AS result").get();
        if (!row) throw new Error("無返回結果");
      } else if (isSqlServer(config.type)) {
        const result = await pool.request().query("SELECT 1 AS result");
        if (!result.recordset || result.recordset.length === 0)
          throw new Error("無返回結果");
      } else if (isOracle(config.type)) {
        const conn = await pool.getConnection();
        try {
          const result = await conn.execute(
            "SELECT 1 AS result FROM DUAL",
            [],
            {
              outFormat: oracledb.OUT_FORMAT_OBJECT,
            },
          );
          if (!result.rows || result.rows.length === 0)
            throw new Error("無返回結果");
        } finally {
          await conn.close();
        }
      }
      // dameng createPool 已实际建立连接，无需额外测试
      return true;
    } finally {
      await this.closePool(pool, config);
    }
  }

  async fetchDatabases(config: DbConfig): Promise<string[]> {
    const pool = await this.createPool(config);
    try {
      if (isMySQL(config.type)) {
        const result = await this.execQuery(pool, "SHOW DATABASES", config);
        const dbs: string[] = result.rows.map(
          (r: any) => Object.values(r)[0] as string,
        );
        return dbs;
      } else if (isPostgres(config.type)) {
        const result = await this.execQuery(
          pool,
          "SELECT datname AS database FROM pg_database WHERE datistemplate = false ORDER BY datname",
          config,
        );
        const dbs: string[] = result.rows.map(
          (r: any) => r.database || r.datname,
        );
        return dbs;
      } else if (isSqlServer(config.type)) {
        const result = await this.execQuery(
          pool,
          "SELECT name AS database FROM sys.databases ORDER BY name",
          config,
        );
        const dbs: string[] = result.rows.map((r: any) => r.database || r.name);
        return dbs;
      } else {
        throw new Error("当前数据库类型不支援列出資料庫清單");
      }
    } catch (err: any) {
      console.error("🔍 fetchDatabases 异常:", err.message);
      throw err;
    } finally {
      await this.closePool(pool, config);
    }
  }

  async testConnectionByName(connName: string): Promise<boolean> {
    const { pool, config } = await this.getPool(connName);
    await this.testPool(pool, config);
    return true;
  }

  async executeQuery(
    connName: string,
    sql: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    return this.execQuery(pool, sql, config);
  }

  private async execQuery(
    pool: any,
    sql: string,
    config: DbConfig,
  ): Promise<QueryResult> {
    const upper = sql.trim().toUpperCase();
    const isSelect =
      upper.startsWith("SELECT") ||
      upper.startsWith("WITH") ||
      upper.startsWith("PRAGMA") ||
      upper.startsWith("SHOW") ||
      upper.startsWith("DESCRIBE");

    if (isMySQL(config.type)) {
      const [rows] = await pool.query(sql);
      return { rows, isSelect };
    }

    if (isPostgres(config.type)) {
      const result = await pool.query(sql);
      return { rows: result.rows, isSelect, fields: result.fields };
    }

    if (isSQLite(config.type)) {
      const stmt = pool.prepare(sql);
      if (isSelect) return { rows: stmt.all(), isSelect };
      const info = stmt.run();
      return {
        rows: [
          {
            affectedRows: info.changes,
            lastInsertRowid: info.lastInsertRowid,
          },
        ],
        isSelect,
        affectedRows: info.changes,
      };
    }

    if (isDameng(config.type)) {
      const result = await pool.execute(sql, [], {
        outFormat: dmdb.OUT_FORMAT_OBJECT,
      });
      if (result.rows?.length > 0) return { rows: result.rows, isSelect: true };
      if (result.rowsAffected !== undefined)
        return {
          rows: [{ affectedRows: result.rowsAffected }],
          isSelect: false,
          affectedRows: result.rowsAffected,
        };
      return { rows: result.rows || [], isSelect: true };
    }

    if (isSqlServer(config.type)) {
      const request = pool.request();
      const result = await request.query(sql);
      // recordset 为 undefined 表示非查询语句（INSERT/UPDATE/DELETE），为空数组表示查询无结果
      if (result.recordset !== undefined)
        return { rows: result.recordset || [], isSelect: true };
      if (result.rowsAffected?.[0] !== undefined)
        return {
          rows: [{ affectedRows: result.rowsAffected[0] }],
          isSelect: false,
          affectedRows: result.rowsAffected[0],
        };
      return { rows: [], isSelect: false };
    }

    if (isOracle(config.type)) {
      const oraclePool = pool as oracledb.Pool;
      const conn = await oraclePool.getConnection();
      try {
        const result = await conn.execute(sql, [], {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        });
        if (result.rows && result.rows.length > 0) {
          const rows = result.rows.map((r: any) => {
            const normalized: any = {};
            for (const key of Object.keys(r)) {
              normalized[key.toLowerCase()] = r[key];
            }
            return normalized;
          });
          return { rows, isSelect: true };
        }
        if (result.rowsAffected !== undefined)
          return {
            rows: [{ affectedRows: result.rowsAffected }],
            isSelect: false,
            affectedRows: result.rowsAffected,
          };
        return { rows: [], isSelect: false };
      } finally {
        await conn.close();
      }
    }

    throw new Error(`不支援的資料庫類型: ${config.type}`);
  }

  async listTables(
    connName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    if (isMySQL(config.type)) {
      const schema = schemaName || config.database;
      return this.execQuery(
        pool,
        `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment, ENGINE AS engine, TABLE_ROWS AS rowCount, CREATE_TIME AS createTime, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${schema}' ORDER BY TABLE_NAME`,
        config,
      );
    }

    if (isPostgres(config.type)) {
      const schemaFilter = schemaName
        ? `WHERE schemaname = '${schemaName.replace(/'/g, "''")}'`
        : `WHERE schemaname NOT IN ('pg_catalog','information_schema')`;
      return this.execQuery(
        pool,
        `SELECT tablename AS name, schemaname, 'TABLE' AS type FROM pg_catalog.pg_tables ${schemaFilter} UNION ALL SELECT viewname AS name, schemaname, 'VIEW' AS type FROM pg_catalog.pg_views ${schemaFilter} ORDER BY name`,
        config,
      );
    }

    if (isSQLite(config.type)) {
      return this.execQuery(
        pool,
        `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        config,
      );
    }

    if (isDameng(config.type)) {
      const ownerFilter = schemaName
        ? `AND OWNER = '${schemaName.replace(/'/g, "''")}'`
        : `AND OWNER NOT IN ('SYS','SYSDBA','SYSAUDITOR','CTISYS')`;
      return this.execQuery(
        pool,
        `SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM ALL_TABLES WHERE 1=1 ${ownerFilter} ORDER BY TABLE_NAME`,
        config,
      );
    }

    if (isSqlServer(config.type)) {
      const schemaFilter = schemaName
        ? `WHERE TABLE_SCHEMA = '${schemaName.replace(/'/g, "''")}'`
        : "";
      return this.execQuery(
        pool,
        `SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES ${schemaFilter} ORDER BY TABLE_NAME`,
        config,
      );
    }

    if (isOracle(config.type)) {
      const ownerFilter = schemaName
        ? `AND OWNER = '${schemaName.replace(/'/g, "''")}'`
        : `AND OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')`;
      return this.execQuery(
        pool,
        `SELECT TABLE_NAME AS name, 'TABLE' AS type FROM ALL_TABLES WHERE 1=1 ${ownerFilter}
         UNION ALL
         SELECT VIEW_NAME AS name, 'VIEW' AS type FROM ALL_VIEWS WHERE 1=1 ${ownerFilter}
         ORDER BY name`,
        config,
      );
    }

    throw new Error(`不支援的資料庫類型: ${config.type}`);
  }

  async describeTable(
    connName: string,
    tableName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');
    if (isMySQL(config.type)) {
      const fullName = dbName ? `\`${dbName}\`.\`${safeName}\`` : `\`${safeName}\``;
      return this.execQuery(pool, `DESCRIBE ${fullName}`, config);
    }

    if (isPostgres(config.type)) {
      const schemaFilter = schemaName
        ? ` AND table_schema = '${schemaName.replace(/'/g, "''")}'`
        : "";
      return this.execQuery(
        pool,
        `SELECT column_name AS "Field", data_type AS "Type", is_nullable AS "Null", column_default AS "Default" FROM information_schema.columns WHERE table_name = '${safeName}'${schemaFilter} ORDER BY ordinal_position`,
        config,
      );
    }

    if (isSQLite(config.type)) {
      return this.execQuery(pool, `PRAGMA table_info('${safeName}')`, config);
    }

    if (isDameng(config.type)) {
      return this.execQuery(
        pool,
        `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type", NULLABLE AS "Null", DATA_DEFAULT AS "Default" FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = '${safeName}' ORDER BY COLUMN_ID`,
        config,
      );
    }

    if (isSqlServer(config.type)) {
      return this.execQuery(
        pool,
        `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type", IS_NULLABLE AS "Null", COLUMN_DEFAULT AS "Default" FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${safeName}' ORDER BY ORDINAL_POSITION`,
        config,
      );
    }

    if (isOracle(config.type)) {
      return this.execQuery(
        pool,
        `SELECT COLUMN_NAME AS "Field", DATA_TYPE AS "Type", NULLABLE AS "Null", DATA_DEFAULT AS "Default" FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = '${safeName}' ORDER BY COLUMN_ID`,
        config,
      );
    }

    throw new Error(`不支援的資料庫類型: ${config.type}`);
  }

  async listDatabases(connName: string): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName);
    if (isMySQL(config.type))
      return this.execQuery(pool, "SHOW DATABASES", config);
    if (isPostgres(config.type))
      return this.execQuery(
        pool,
        `SELECT datname AS name,
          pg_size_pretty(pg_database_size(datname)) AS size
        FROM pg_database
        WHERE datistemplate = false
        ORDER BY datname`,
        config,
      );
    if (isSqlServer(config.type))
      return this.execQuery(
        pool,
        `SELECT name FROM sys.databases ORDER BY name`,
        config,
      );
    throw new Error("当前数据库类型不支援列出資料庫");
  }

  // ── 用户/角色列表（PG/DM） ─────────────────────────────

  async listUsers(connName: string): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName);
    if (isPostgres(config.type)) {
      return this.execQuery(
        pool,
        `SELECT rolname AS name FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname <> 'public' ORDER BY rolname`,
        config,
      );
    }
    if (isDameng(config.type)) {
      return this.execQuery(
        pool,
        `SELECT DISTINCT OWNER AS name FROM ALL_TABLES
        WHERE OWNER NOT IN ('SYS','SYSDBA','SYSAUDITOR','CTISYS')
        ORDER BY name`,
        config,
      );
    }
    if (isSqlServer(config.type)) {
      return this.execQuery(
        pool,
        `SELECT name FROM sys.schemas ORDER BY name`,
        config,
      );
    }
    if (isOracle(config.type)) {
      return this.execQuery(
        pool,
        `SELECT DISTINCT OWNER AS name FROM ALL_TABLES
        WHERE OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
        ORDER BY name`,
        config,
      );
    }
    return { rows: [], isSelect: true };
  }

  // ── 架构/数据库列表（含大小） ──────────────────────────

  async listSchemas(connName: string, userName?: string): Promise<QueryResult> {
    // Oracle 的 userName 是 schema 名，不是数据库名，不能传给 getPool 改变 database
    const rawConfig = this.connectionManager.getConnectionRaw(connName);
    const dbName = isOracle(rawConfig?.type) ? undefined : userName;
    const { pool, config } = await this.getPool(connName, dbName);
    if (isPostgres(config.type)) {
      return this.execQuery(
        pool,
        `SELECT
          nspname AS name,
          pg_size_pretty(COALESCE(
            (SELECT SUM(pg_total_relation_size(quote_ident(nspname) || '.' || quote_ident(relname)))
             FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r','v','m')), 0
          )) AS size,
          (SELECT COUNT(*) FROM pg_class c
           WHERE c.relnamespace = n.oid AND c.relkind IN ('r','v','m'))::int AS count
        FROM pg_namespace n
        WHERE nspname NOT LIKE 'pg_%'
          AND nspname NOT IN ('information_schema')
        ORDER BY nspname`,
        config,
      );
    }
    if (isMySQL(config.type)) {
      return this.execQuery(
        pool,
        `SELECT TABLE_SCHEMA AS name,
          CASE
            WHEN total_bytes >= 1099511627776 THEN CONCAT(ROUND(total_bytes / 1099511627776, 2), ' TB')
            WHEN total_bytes >= 1073741824 THEN CONCAT(ROUND(total_bytes / 1073741824, 2), ' GB')
            WHEN total_bytes >= 1048576 THEN CONCAT(ROUND(total_bytes / 1048576, 2), ' MB')
            ELSE CONCAT(ROUND(total_bytes / 1024), ' KB')
          END AS size
        FROM (
          SELECT TABLE_SCHEMA, SUM(data_length + index_length) AS total_bytes
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA NOT IN ('performance_schema','sys')
          GROUP BY TABLE_SCHEMA
        ) AS db_sizes
        ORDER BY TABLE_SCHEMA`,
        config,
      );
    }
    if (isDameng(config.type)) {
      const ownerFilter = userName
        ? `AND OWNER = '${userName.replace(/'/g, "''")}'`
        : `AND OWNER NOT IN ('SYS','SYSDBA','SYSAUDITOR','CTISYS')`;
      return this.execQuery(
        pool,
        `SELECT DISTINCT OWNER AS name FROM ALL_TABLES
        WHERE 1=1 ${ownerFilter}
        ORDER BY name`,
        config,
      );
    }
    if (isSqlServer(config.type)) {
      return this.execQuery(
        pool,
        `SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA
        WHERE SCHEMA_NAME NOT IN ('sys','INFORMATION_SCHEMA','guest','db_accessadmin','db_backupoperator','db_datareader','db_datawriter','db_ddladmin','db_denydatareader','db_denydatawriter','db_owner','db_securityadmin')
        ORDER BY SCHEMA_NAME`,
        config,
      );
    }
    if (isOracle(config.type)) {
      const ownerFilter = userName
        ? `AND OWNER = '${userName.replace(/'/g, "''")}'`
        : `AND OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')`;
      return this.execQuery(
        pool,
        `SELECT DISTINCT OWNER AS name FROM ALL_TABLES WHERE 1=1 ${ownerFilter} ORDER BY name`,
        config,
      );
    }
    // SQLite 无 schema 层级
    return { rows: [], isSelect: true };
  }

  // ── 存储过程/函数列表 ──────────────────────────────────

  async listProcedures(
    connName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    const safeSchema = schemaName
      ? `'${schemaName.replace(/'/g, "''")}'`
      : null;

    if (isPostgres(config.type)) {
      const schemaWhere = safeSchema
        ? ` AND n.nspname = ${safeSchema}`
        : ` AND n.nspname NOT IN ('pg_catalog','information_schema')`;
      return this.execQuery(
        pool,
        `SELECT proname AS name, n.nspname AS schemaname,
          CASE WHEN prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS type
        FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE 1=1${schemaWhere}
        ORDER BY proname`,
        config,
      );
    }
    if (isMySQL(config.type)) {
      const schemaFilter = safeSchema
        ? `WHERE ROUTINE_SCHEMA = ${safeSchema}`
        : "";
      return this.execQuery(
        pool,
        `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM information_schema.ROUTINES ${schemaFilter} ORDER BY ROUTINE_NAME`,
        config,
      );
    }
    if (isDameng(config.type)) {
      const ownerFilter = safeSchema
        ? `AND OWNER = ${safeSchema}`
        : `AND OWNER NOT IN ('SYS','SYSDBA')`;
      return this.execQuery(
        pool,
        `SELECT OBJECT_NAME AS name, OBJECT_TYPE AS type FROM ALL_OBJECTS
        WHERE OBJECT_TYPE IN ('PROCEDURE','FUNCTION') ${ownerFilter}
        ORDER BY OBJECT_NAME`,
        config,
      );
    }
    if (isSqlServer(config.type)) {
      const schemaFilter = safeSchema
        ? `WHERE ROUTINE_SCHEMA = ${safeSchema}`
        : "";
      return this.execQuery(
        pool,
        `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM INFORMATION_SCHEMA.ROUTINES ${schemaFilter} ORDER BY ROUTINE_NAME`,
        config,
      );
    }
    if (isOracle(config.type)) {
      const ownerFilter = safeSchema
        ? `AND OWNER = ${safeSchema}`
        : `AND OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')`;
      return this.execQuery(
        pool,
        `SELECT OBJECT_NAME AS name, OBJECT_TYPE AS type FROM ALL_OBJECTS
        WHERE OBJECT_TYPE IN ('PROCEDURE','FUNCTION') ${ownerFilter}
        ORDER BY OBJECT_NAME`,
        config,
      );
    }
    return { rows: [], isSelect: true };
  }

  // ── 主键 ────────────────────────────────────────────────

  async getPrimaryKeys(
    connName: string,
    tableName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');
    const safeSchema = schemaName
      ? `'${schemaName.replace(/'/g, "''")}'`
      : null;

    if (isPostgres(config.type)) {
      const schemaFilter = safeSchema
        ? `AND tc.table_schema = ${safeSchema}`
        : "";
      return this.execQuery(
        pool,
        `SELECT kcu.column_name AS "columnName", tc.constraint_name AS "constraintName"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_name = '${safeName}' ${schemaFilter}
        ORDER BY kcu.ordinal_position`,
        config,
      );
    }
    if (isMySQL(config.type)) {
      return this.execQuery(
        pool,
        `SELECT COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_NAME = '${safeName}' AND TABLE_SCHEMA = '${config.database || ""}'
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION`,
        config,
      );
    }
    if (isDameng(config.type)) {
      return this.execQuery(
        pool,
        `SELECT COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName
        FROM ALL_CONS_COLUMNS
        WHERE CONSTRAINT_NAME IN (
          SELECT CONSTRAINT_NAME FROM ALL_CONSTRAINTS
          WHERE CONSTRAINT_TYPE = 'P' AND TABLE_NAME = '${safeName}'
        ) ORDER BY POSITION`,
        config,
      );
    }
    if (isSQLite(config.type)) {
      const r = await this.execQuery(
        pool,
        `PRAGMA table_info('${safeName}')`,
        config,
      );
      const pkCols = r.rows.filter((col: any) => col.pk > 0);
      return {
        rows: pkCols.map((col: any) => ({
          columnName: col.name,
          constraintName: "PRIMARY",
        })),
        isSelect: true,
      };
    }
    if (isSqlServer(config.type)) {
      return this.execQuery(
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
      return this.execQuery(
        pool,
        `SELECT COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName
        FROM ALL_CONS_COLUMNS
        WHERE CONSTRAINT_NAME IN (
          SELECT CONSTRAINT_NAME FROM ALL_CONSTRAINTS
          WHERE CONSTRAINT_TYPE = 'P' AND TABLE_NAME = '${safeName}'
        ) ORDER BY POSITION`,
        config,
      );
    }
    return { rows: [], isSelect: true };
  }

  // ── 外键 ────────────────────────────────────────────────

  async getForeignKeys(
    connName: string,
    tableName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');
    const safeSchema = schemaName
      ? `'${schemaName.replace(/'/g, "''")}'`
      : null;

    if (isPostgres(config.type)) {
      const schemaFilter = safeSchema
        ? `AND tc.table_schema = ${safeSchema}`
        : "";
      return this.execQuery(
        pool,
        `SELECT kcu.column_name AS "columnName",
          ccu.table_name AS "refTable",
          ccu.column_name AS "refColumn",
          tc.constraint_name AS "constraintName"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = '${safeName}' ${schemaFilter}`,
        config,
      );
    }
    if (isMySQL(config.type)) {
      return this.execQuery(
        pool,
        `SELECT COLUMN_NAME AS columnName,
          REFERENCED_TABLE_NAME AS refTable,
          REFERENCED_COLUMN_NAME AS refColumn
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_NAME = '${safeName}' AND TABLE_SCHEMA = '${config.database || ""}'
          AND REFERENCED_TABLE_NAME IS NOT NULL`,
        config,
      );
    }
    if (isDameng(config.type)) {
      return this.execQuery(
        pool,
        `SELECT cc.COLUMN_NAME AS columnName,
          c.TABLE_NAME AS refTable,
          (SELECT COLUMN_NAME FROM ALL_CONS_COLUMNS
           WHERE CONSTRAINT_NAME = c.R_CONSTRAINT_NAME AND ROWNUM = 1) AS refColumn
        FROM ALL_CONSTRAINTS c
        JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE c.CONSTRAINT_TYPE = 'R' AND c.TABLE_NAME = '${safeName}'`,
        config,
      );
    }
    if (isSQLite(config.type)) {
      return this.execQuery(
        pool,
        `PRAGMA foreign_key_list('${safeName}')`,
        config,
      );
    }
    if (isSqlServer(config.type)) {
      return this.execQuery(
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
      return this.execQuery(
        pool,
        `SELECT cc.COLUMN_NAME AS columnName,
          c.TABLE_NAME AS refTable,
          (SELECT COLUMN_NAME FROM ALL_CONS_COLUMNS
           WHERE CONSTRAINT_NAME = c.R_CONSTRAINT_NAME AND ROWNUM = 1) AS refColumn
        FROM ALL_CONSTRAINTS c
        JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE c.CONSTRAINT_TYPE = 'R' AND c.TABLE_NAME = '${safeName}'`,
        config,
      );
    }
    return { rows: [], isSelect: true };
  }

  // ── 索引 ────────────────────────────────────────────────

  async getIndexes(
    connName: string,
    tableName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');

    if (isPostgres(config.type)) {
      const schemaFilter = schemaName
        ? `AND schemaname = '${schemaName.replace(/'/g, "''")}'`
        : "";
      return this.execQuery(
        pool,
        `SELECT indexname AS "indexName", indexdef AS "indexDefinition"
        FROM pg_indexes
        WHERE tablename = '${safeName}' ${schemaFilter}
        ORDER BY indexname`,
        config,
      );
    }
    if (isMySQL(config.type)) {
      return this.execQuery(pool, `SHOW INDEX FROM \`${safeName}\``, config);
    }
    if (isDameng(config.type)) {
      return this.execQuery(
        pool,
        `SELECT INDEX_NAME AS "indexName", COLUMN_NAME AS "columnName"
        FROM ALL_IND_COLUMNS
        WHERE TABLE_NAME = '${safeName}'
        ORDER BY INDEX_NAME, COLUMN_POSITION`,
        config,
      );
    }
    if (isSQLite(config.type)) {
      // PRAGMA index_list 只返回索引名，需再查 index_info 获取列
      const idxList = (
        await this.execQuery(pool, `PRAGMA index_list('${safeName}')`, config)
      ).rows;
      const rows: any[] = [];
      for (const idx of idxList) {
        const idxName = idx.name || "";
        const colResult = await this.execQuery(
          pool,
          `PRAGMA index_info('${idxName.replace(/'/g, "''")}')`,
          config,
        );
        const cols = (colResult.rows || [])
          .map((r: any) => r.name || "")
          .filter(Boolean);
        rows.push({
          indexName: idxName,
          columnName: cols.join(", "),
          unique: idx.unique ? 1 : 0,
        });
      }
      return { rows, isSelect: true };
    }
    if (isSqlServer(config.type)) {
      return this.execQuery(
        pool,
        `SELECT i.name AS "indexName",
          COL_NAME(ic.object_id, ic.column_id) AS "columnName"
        FROM sys.indexes i
        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        WHERE i.object_id = OBJECT_ID('${safeName}')
        ORDER BY i.name, ic.index_column_id`,
        config,
      );
    }
    if (isOracle(config.type)) {
      return this.execQuery(
        pool,
        `SELECT INDEX_NAME AS "indexName", COLUMN_NAME AS "columnName"
        FROM ALL_IND_COLUMNS
        WHERE TABLE_NAME = '${safeName}'
        ORDER BY INDEX_NAME, COLUMN_POSITION`,
        config,
      );
    }
    return { rows: [], isSelect: true };
  }

  // ── 触发器 ──────────────────────────────────────────────

  async getTriggers(
    connName: string,
    tableName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    const safeName = tableName.replace(/`/g, "``").replace(/"/g, '""');

    if (isPostgres(config.type)) {
      const schemaFilter = schemaName
        ? `AND n.nspname = '${schemaName.replace(/'/g, "''")}'`
        : "";
      return this.execQuery(
        pool,
        `SELECT tgname AS "triggerName",
          pg_get_triggerdef(t.oid) AS "triggerDefinition"
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = '${safeName}' ${schemaFilter}
          AND NOT tgisinternal
        ORDER BY tgname`,
        config,
      );
    }
    if (isMySQL(config.type)) {
      return this.execQuery(
        pool,
        `SELECT TRIGGER_NAME AS "triggerName",
          ACTION_TIMING AS "timing",
          EVENT_MANIPULATION AS "event"
        FROM information_schema.TRIGGERS
        WHERE EVENT_OBJECT_TABLE = '${safeName}'
          AND EVENT_OBJECT_SCHEMA = '${config.database || ""}'
        ORDER BY TRIGGER_NAME`,
        config,
      );
    }
    if (isSqlServer(config.type)) {
      return this.execQuery(
        pool,
        `SELECT name AS "triggerName",
          OBJECT_DEFINITION(object_id) AS "triggerDefinition"
        FROM sys.triggers
        WHERE parent_id = OBJECT_ID('${safeName}')
        ORDER BY name`,
        config,
      );
    }
    if (isOracle(config.type)) {
      return this.execQuery(
        pool,
        `SELECT TRIGGER_NAME AS "triggerName",
          TRIGGER_BODY AS "triggerDefinition"
        FROM ALL_TRIGGERS
        WHERE TABLE_NAME = '${safeName}'
        ORDER BY TRIGGER_NAME`,
        config,
      );
    }
    return { rows: [], isSelect: true };
  }

  // ── 存储过程参数 ────────────────────────────────────────

  async getProcedureParameters(
    connName: string,
    procName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<QueryResult> {
    const { pool, config } = await this.getPool(connName, dbName);
    const safeName = procName.replace(/'/g, "''");

    if (isPostgres(config.type)) {
      // pg_get_function_arguments 返回参数声明字符串
      // 格式: [argmode] [argname] argtype (例: "IN id integer, OUT result boolean")
      const schemaFilter = schemaName
        ? `AND n.nspname = '${schemaName}'`
        : `AND n.nspname NOT IN ('pg_catalog','information_schema')`;
      return this.execQuery(
        pool,
        `SELECT p.proname AS "procedureName",
          pg_get_function_arguments(p.oid) AS "arguments"
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.proname = '${safeName}' ${schemaFilter}
        LIMIT 1`,
        config,
      );
    }
    if (isMySQL(config.type)) {
      const dbFilter = config.database
        ? `AND SPECIFIC_SCHEMA = '${config.database}'`
        : "";
      return this.execQuery(
        pool,
        `SELECT PARAMETER_NAME AS "paramName",
          PARAMETER_MODE AS "paramMode",
          DATA_TYPE AS "dataType"
        FROM information_schema.PARAMETERS
        WHERE SPECIFIC_NAME = '${safeName}' ${dbFilter}
        ORDER BY ORDINAL_POSITION`,
        config,
      );
    }
    if (isSqlServer(config.type)) {
      // SQL Server: OBJECT_ID 必须带 schema 前缀才能找到非 dbo 下的存储过程
      const objectId = schemaName
        ? `OBJECT_ID('${schemaName}.${safeName}')`
        : `OBJECT_ID('${safeName}')`;

      return this.execQuery(
        pool,
        `SELECT p.name,
          t.name AS type,
          p.max_length,
          p.is_output
        FROM sys.parameters p
        JOIN sys.types t ON p.system_type_id = t.system_type_id
        WHERE p.object_id = ${objectId}
        ORDER BY p.parameter_id`,
        config,
      );
    }
    if (isOracle(config.type)) {
      return this.execQuery(
        pool,
        `SELECT ARGUMENT_NAME AS "paramName",
          DATA_TYPE AS "dataType",
          IN_OUT AS "paramMode"
        FROM ALL_ARGUMENTS
        WHERE OBJECT_NAME = '${safeName}'
          AND OWNER NOT IN ('SYSTEM','OUTLN','DBSNMP','XDB','APPQOSSYS','WMSYS','EXFSYS','CTXSYS','ORDSYS','ORDDATA','MDSYS','OLAPSYS')
        ORDER BY POSITION`,
        config,
      );
    }
    return { rows: [], isSelect: true };
  }

  private async closePool(pool: any, config: DbConfig): Promise<void> {
    if (isMySQL(config.type) || isPostgres(config.type)) {
      await pool.end();
    } else if (isSQLite(config.type)) {
      pool.close();
    } else if (isSqlServer(config.type)) {
      await pool.close();
    } else if (isOracle(config.type)) {
      await (pool as oracledb.Pool).close();
    }
    // dameng 无需手动关闭
  }

  async closeAll(): Promise<void> {
    for (const [name, pool] of Object.entries(this.pools)) {
      try {
        const config = this.connectionManager.getConnectionRaw(name);
        if (config) await this.closePool(pool, config);
      } catch (err: any) {
        console.error(`關閉連線 "${name}" 失敗:`, err.message);
      }
    }
    this.pools = {};
  }

  async closeConnection(connName: string): Promise<void> {
    const pool = this.pools[connName];
    if (pool) {
      try {
        const config = this.connectionManager.getConnectionRaw(connName);
        if (config) await this.closePool(pool, config);
      } catch (err: any) {
        console.error(`關閉連線 "${connName}" 失敗:`, err.message);
      }
      delete this.pools[connName];
    }
  }
}
