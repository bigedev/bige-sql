/**
 * Oracle C##CAISSAUSER.CAP_FORM_DEFINITION → PostgreSQL identify 同步
 *
 * 运行: node sync_cap_form.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import oracledb from "oracledb";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "connections.json");

const conns = JSON.parse(readFileSync(CONFIG_PATH, "utf8")).connections;
const oracleCfg = conns["Oracle"];
const pgCfg = conns["PostgreSQL"];

const ORACLE_OWNER = "C##CAISSAUSER";
const TABLE_NAME = "CAP_FORM_DEFINITION";
const PG_DB = "identify";
const PG_TABLE = "cap_form_definition";

// Oracle 到 PostgreSQL 类型映射
const TYPE_MAP = {
  NUMBER: "NUMERIC",
  VARCHAR2: "VARCHAR",
  VARCHAR: "VARCHAR",
  CHAR: "CHAR",
  CLOB: "TEXT",
  NCLOB: "TEXT",
  BLOB: "BYTEA",
  DATE: "TIMESTAMP",
  TIMESTAMP: "TIMESTAMP",
  FLOAT: "REAL",
  INTEGER: "INTEGER",
  BIGINT: "BIGINT",
  SMALLINT: "SMALLINT",
  BOOLEAN: "BOOLEAN",
};

function mapType(oracleType, dataLength, precision, scale) {
  const base = oracleType.toUpperCase().replace(/\(.*/, "").trim();
  const mapped = TYPE_MAP[base] || "TEXT";

  if (base === "VARCHAR2" || base === "VARCHAR") {
    if (dataLength && dataLength <= 10485760) return `VARCHAR(${dataLength})`;
    if (dataLength > 10485760) return "TEXT";
    return "VARCHAR(255)";
  }
  if (base === "CHAR") {
    return dataLength ? `CHAR(${dataLength})` : "CHAR(1)";
  }
  if ((base === "NUMBER" || base === "NUMERIC") && precision) {
    return scale ? `NUMERIC(${precision},${scale})` : `NUMERIC(${precision})`;
  }
  if (base === "NUMBER") return "NUMERIC";
  return mapped;
}

// ─── 连接 Oracle ───────────────────────────────────────────────

oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];

async function getOracleConn() {
  const cs = `${oracleCfg.host}:${oracleCfg.port}/${oracleCfg.database}`;
  const pool = await oracledb.createPool({
    user: oracleCfg.user,
    password: oracleCfg.password,
    connectString: cs,
    privilege: oracledb.SYSDBA,
    poolMin: 1, poolMax: 2,
  });
  const conn = await pool.getConnection();
  return { conn, pool };
}

async function queryOracle(conn, sql) {
  const r = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  if (r.rows) {
    return r.rows.map((row) => {
      const n = {};
      for (const k of Object.keys(row)) {
        let v = row[k];
        if (v instanceof Date) v = v;
        else if (Buffer.isBuffer(v)) v = v;
        else if (typeof v === "object" && v?.constructor?.name === "Lob") v = null;
        n[k.toLowerCase()] = v;
      }
      return n;
    });
  }
  return [];
}

// ─── 连接 PostgreSQL ───────────────────────────────────────────

async function getPgPool() {
  const pool = new pg.Pool({
    host: pgCfg.host, port: pgCfg.port,
    user: pgCfg.user, password: pgCfg.password,
    database: PG_DB, max: 5,
  });
  await pool.query("SELECT 1");
  return pool;
}

async function execPg(pool, sql) {
  return pool.query(sql);
}

// ─── 获取 Oracle 表结构 ───────────────────────────────────────

async function getOracleColumns(conn) {
  const sql = `
    SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE,
           NULLABLE, DATA_DEFAULT
    FROM ALL_TAB_COLUMNS
    WHERE OWNER = '${ORACLE_OWNER}' AND TABLE_NAME = '${TABLE_NAME}'
    ORDER BY COLUMN_ID
  `;
  return queryOracle(conn, sql);
}

// ─── 生成建表 SQL ─────────────────────────────────────────────

function genCreateSQL(columns) {
  const cols = columns.map((c) => {
    const name = `"${c.column_name}"`;
    const type = mapType(c.data_type, c.data_length, c.data_precision, c.data_scale);
    const nullable = c.nullable === "Y" ? "NULL" : "NOT NULL";
    return `  ${name} ${type} ${nullable}`;
  });
  return `CREATE TABLE "${PG_TABLE}" (\n${cols.join(",\n")}\n)`;
}

// ─── 构建 INSERT SQL ──────────────────────────────────────────

function buildInsert(columns, rows) {
  if (rows.length === 0) return null;
  // 读取数据时 key 已转小写，所以用 lower(column_name) 来匹配
  const colNames = columns.map((c) => `"${c.column_name}"`).join(", ");
  const vals = rows.map((row) => {
    const vs = columns.map((c) => {
      const v = row[c.column_name.toLowerCase()];
      if (v === null || v === undefined) return "NULL";
      if (v instanceof Date) return `'${v.toISOString().replace("T", " ").replace("Z", "")}'::timestamp`;
      if (typeof v === "number") return v.toString();
      if (typeof v === "boolean") return v ? "true" : "false";
      const s = String(v).replace(/'/g, "''");
      return `'${s}'`;
    });
    return `(${vs.join(", ")})`;
  });
  return `INSERT INTO "${PG_TABLE}" (${colNames}) VALUES\n${vals.join(",\n")}`;
}

// ─── 主流程 ────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Oracle C##CAISSAUSER.CAP_FORM_DEFINITION → PostgreSQL identify");
  console.log("=".repeat(60));

  // 连接 Oracle
  console.log("\n📡 连接 Oracle...");
  const { conn, pool: oraPool } = await getOracleConn();
  console.log("✅ Oracle 连接成功");

  // 获取结构
  console.log("\n📋 获取 Oracle 表结构...");
  const columns = await getOracleColumns(conn);
  console.log(`   共 ${columns.length} 列`);

  // 获取数据
  console.log("\n📖 读取 Oracle 数据...");
  const rows = await queryOracle(conn,
    `SELECT * FROM "${ORACLE_OWNER}"."${TABLE_NAME}"`
  );
  console.log(`   ${rows.length} 行数据`);

  await conn.close();
  await oraPool.close();

  // 连接 PostgreSQL
  console.log("\n📡 连接 PostgreSQL...");
  const pgPool = await getPgPool();
  console.log("✅ PostgreSQL 连接成功");

  // 创建表
  console.log("\n🏗️  创建表...");
  const createSQL = genCreateSQL(columns);
  console.log(createSQL);
  try {
    // 先删除旧表（如果存在）
    await execPg(pgPool, `DROP TABLE IF EXISTS "${PG_TABLE}"`);
    await execPg(pgPool, createSQL);
    console.log("✅ 表创建成功");
  } catch (err) {
    console.log(`❌ 建表失败: ${err.message}`);
    await pgPool.end();
    return;
  }

  // 插入数据
  if (rows.length > 0) {
    console.log(`\n📤 插入 ${rows.length} 行数据...`);
    const insertSQL = buildInsert(columns, rows);
    try {
      await execPg(pgPool, insertSQL);
      console.log("✅ 数据插入成功");
    } catch (err) {
      console.log(`❌ 批量插入失败: ${err.message}`);
      console.log("🔄 尝试逐行插入...");
      let cnt = 0;
      for (const row of rows) {
        const sql = buildInsert(columns, [row]);
        try {
          await execPg(pgPool, sql);
          cnt++;
        } catch (e) {
          console.log(`   ❌ 行 ${cnt + 1} 失败: ${e.message}`);
        }
      }
      console.log(`   已插入 ${cnt}/${rows.length} 行`);
    }
  } else {
    console.log("\n📭 无数据需要插入");
  }

  // 验证
  const check = await execPg(pgPool, `SELECT COUNT(*) AS cnt FROM "${PG_TABLE}"`);
  console.log(`\n📊 PostgreSQL 中的行数: ${check.rows[0].cnt}`);

  await pgPool.end();
  console.log("\n✅ 同步完成!");
}

main().catch((err) => {
  console.error("\n❌ 错误:", err.message);
  process.exit(1);
});
