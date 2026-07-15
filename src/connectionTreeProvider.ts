/**
 * BigeSQL - 数据库连接树视图提供者
 *
 * 树结构（按数据库类型区分）：
 *
 * PostgreSQL / Dameng DM8:
 *   Connection
 *   ├── � User: postgres
 *   │   ├── 📦 Schema: public (含大小)
 *   │   │   ├── 📋 Tables (n)
 *   │   │   │   └── tableName [点击: 查看数据]
 *   │   │   │       ├── 📄 Columns
 *   │   │       ├── 🔑 Primary Keys
 *   │   │       ├── 🔗 Foreign Keys
 *   │   │       ├── 📇 Indexes
 *   │   │       └── ⚡ Triggers
 *   │   ├── 👁️ Views (n)
 *   │   │   └── viewName [点击: 查看数据]
 *   │   │       └── 📄 Columns
 *   │   └── ⚙️ Procedures (n)
 *   │       └── procName
 *   │           └── 📥 Parameters
 *   └── 📦 Schema: app
 *
 * MySQL / MariaDB:
 *   Connection
 *   ├── 📦 Database: mydb (含大小)
 *   │   ├── 📋 Tables (n)
 *   │   └── ...
 *   └── 📦 Database: otherdb
 *
 * SQLite:
 *   Connection
 *   ├── 📋 Tables (n)
 *   └── 👁️ Views (n)
 */
import * as vscode from "vscode";
import { ConnectionManager, DbConfig } from "./connectionManager";
import { DatabaseService } from "./databaseService";
import { DbType, isMySQL, isPostgres, isSQLite } from "./dbTypes";

/** PNG 图标文件名映射 */
const DB_ICON_FILES: Record<string, string> = {
  [DbType.MYSQL]: "db-mysql.png",
  [DbType.MARIADB]: "db-mysql.png",
  [DbType.POSTGRESQL]: "db-postgres.png",
  [DbType.POSTGRES]: "db-postgres.png",
  [DbType.SQLITE]: "db-sqlite.png",
  [DbType.DAMENG]: "db-dameng.png",
  [DbType.DM8]: "db-dameng.png",
};

/**
 * 获取数据库类型的 PNG 图标 URI（用于 TreeView iconPath）
 */
function getDbIconPath(
  extensionUri: vscode.Uri,
  type: string | null | undefined,
): vscode.Uri | undefined {
  const filename = type && DB_ICON_FILES[type];
  if (!filename) return undefined;
  return vscode.Uri.joinPath(extensionUri, "media", filename);
}

/** 树节点上下文类型常量 */
const CTX = {
  CONNECTION: "connection",
  DATABASE: "database",
  USER: "user",
  SCHEMA: "schema",
  TABLES_GROUP: "tables-group",
  VIEWS_GROUP: "views-group",
  PROCS_GROUP: "procedures-group",
  TABLE: "table",
  VIEW: "view",
  PROCEDURE: "procedure",
  COLUMNS_GROUP: "columns-group",
  PK_GROUP: "pk-group",
  FK_GROUP: "fk-group",
  INDEXES_GROUP: "indexes-group",
  TRIGGERS_GROUP: "triggers-group",
  PARAMS_GROUP: "params-group",
  COLUMN: "column",
  PK: "pk",
  FK: "fk",
  INDEX: "index",
  TRIGGER: "trigger",
  PARAM: "param",
  ERROR: "error",
  EMPTY: "empty",
} as const;

export class ConnectionTreeItem extends vscode.TreeItem {
  connectionName?: string;
  tableName?: string;
  schemaName?: string;
  procName?: string;
  dbName?: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    extra?: Partial<ConnectionTreeItem>,
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    if (extra) Object.assign(this, extra);
  }
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ConnectionTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private cache = new Map<string, ConnectionTreeItem[]>();

  constructor(
    private context: vscode.ExtensionContext,
    private connectionManager: ConnectionManager,
    private databaseService: DatabaseService,
  ) {}

  refresh(): void {
    this.cache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshConnection(connName: string): void {
    // 清除该连接相关的所有缓存
    for (const key of this.cache.keys()) {
      if (key.startsWith(connName)) this.cache.delete(key);
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ConnectionTreeItem): ConnectionTreeItem {
    return element;
  }

  async getChildren(
    element?: ConnectionTreeItem,
  ): Promise<ConnectionTreeItem[]> {
    if (!element) return this.getConnectionItems();

    const conn = element.connectionName;
    if (!conn) return [];

    switch (element.contextValue) {
      // 连接 → 按数据库类型分派
      case CTX.CONNECTION:
        return this.getConnectionChildren(conn);

      // 用户（DM）→ 架构列表
      case CTX.USER:
        return this.getSchemaItems(conn, element.schemaName);

      // 数据库（PG）→ 架构列表
      case CTX.DATABASE:
        return this.getSchemaItems(conn, element.schemaName);

      // 架构 → [Tables, Views, Procedures] 分组
      case CTX.SCHEMA:
        return this.getObjectGroupItems(
          conn,
          element.schemaName,
          element.dbName,
        );

      // 分组 → 具体对象列表
      case CTX.TABLES_GROUP:
        return this.getObjectListItems(
          conn,
          element.schemaName,
          "table",
          element.dbName,
        );
      case CTX.VIEWS_GROUP:
        return this.getObjectListItems(
          conn,
          element.schemaName,
          "view",
          element.dbName,
        );
      case CTX.PROCS_GROUP:
        return this.getObjectListItems(
          conn,
          element.schemaName,
          "procedure",
          element.dbName,
        );

      // 表 → 分类子节点
      case CTX.TABLE:
        return this.getTableCategoryItems(
          conn,
          element.schemaName,
          element.tableName!,
          element.dbName,
        );

      // 视图 → Columns
      case CTX.VIEW:
        return this.getViewCategoryItems(
          conn,
          element.schemaName,
          element.tableName!,
          element.dbName,
        );

      // 存储过程 → Parameters
      case CTX.PROCEDURE:
        return this.getProcedureCategoryItems(
          conn,
          element.schemaName,
          element.procName!,
          element.dbName,
        );

      // 各分类 → 具体条目
      case CTX.COLUMNS_GROUP:
        return this.getColumnItems(
          conn,
          element.schemaName,
          element.tableName!,
          element.dbName,
        );
      case CTX.PK_GROUP:
        return this.getPkItems(
          conn,
          element.schemaName,
          element.tableName!,
          element.dbName,
        );
      case CTX.FK_GROUP:
        return this.getFkItems(
          conn,
          element.schemaName,
          element.tableName!,
          element.dbName,
        );
      case CTX.INDEXES_GROUP:
        return this.getIndexItems(
          conn,
          element.schemaName,
          element.tableName!,
          element.dbName,
        );
      case CTX.TRIGGERS_GROUP:
        return this.getTriggerItems(
          conn,
          element.schemaName,
          element.tableName!,
          element.dbName,
        );
      case CTX.PARAMS_GROUP:
        return this.getParamItems(conn, element.schemaName, element.procName!);

      default:
        return [];
    }
  }

  // ═══ 一级：连接列表 ═══════════════════════════════════════

  private getConnectionItems(): ConnectionTreeItem[] {
    const names = this.connectionManager.listConnections();
    if (names.length === 0) {
      return [
        new ConnectionTreeItem(
          vscode.l10n.t("No connections, click + to add"),
          vscode.TreeItemCollapsibleState.None,
          CTX.EMPTY,
        ),
      ];
    }
    return names.map((name) => {
      const config = this.connectionManager.getConnection(name);
      return new ConnectionTreeItem(
        name,
        vscode.TreeItemCollapsibleState.Collapsed,
        CTX.CONNECTION,
        {
          connectionName: name,
          description: config?.type || "",
          tooltip: this.formatTooltip(name, config),
          iconPath: getDbIconPath(this.context.extensionUri, config?.type),
        },
      );
    });
  }

  // ═══ 二级：架构/数据库列表 ════════════════════════════════

  /** 连接展开的下一级：按数据库类型分派 */
  private async getConnectionChildren(
    connName: string,
  ): Promise<ConnectionTreeItem[]> {
    const config = this.connectionManager.getConnectionRaw(connName);
    if (!config) return [];

    // SQLite：没有层级，直接显示对象分组
    if (isSQLite(config.type)) {
      return this.getObjectGroupItems(connName, undefined);
    }

    // MySQL：listSchemas 返回所有数据库（直接作为第二级）
    if (isMySQL(config.type)) {
      return this.getSchemaItems(connName);
    }

    // PostgreSQL：listDatabases 返回所有数据库（第二级）
    if (isPostgres(config.type)) {
      return this.getDatabaseItems(connName);
    }

    // Dameng：listUsers 返回所有用户/所有者（第二级）
    return this.getUserItems(connName);
  }

  /** 返回数据库列表（PG 第二级） */
  private async getDatabaseItems(
    connName: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-databases`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    try {
      const result = await this.databaseService.listDatabases(connName);
      const dbs = result.rows || [];
      if (dbs.length === 0) {
        const items = await this.getSchemaItems(connName);
        this.cache.set(key, items);
        return items;
      }
      const items = dbs.map((d: any) => {
        const name = d.name || d.database || "";
        return new ConnectionTreeItem(
          `${name}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          CTX.DATABASE,
          {
            connectionName: connName,
            schemaName: name,
            description: d.size || "",
            iconPath: new vscode.ThemeIcon("database"),
          },
        );
      });
      this.cache.set(key, items);
      return items;
    } catch {
      const items = await this.getSchemaItems(connName);
      this.cache.set(key, items);
      return items;
    }
  }

  /** 返回用户列表（DM 第二级） */
  private async getUserItems(connName: string): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-users`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    try {
      const result = await this.databaseService.listUsers(connName);
      const users = result.rows || [];
      if (users.length === 0) {
        // 没有用户数据时回退到架构层级
        const items = await this.getSchemaItems(connName);
        this.cache.set(key, items);
        return items;
      }
      const items = users.map((u: any) => {
        const name = u.name || "";
        return new ConnectionTreeItem(
          `👤 ${name}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          CTX.USER,
          {
            connectionName: connName,
            schemaName: name,
            iconPath: new vscode.ThemeIcon("account"),
          },
        );
      });
      this.cache.set(key, items);
      return items;
    } catch {
      // 出错时回退到架构层级
      const items = await this.getSchemaItems(connName);
      this.cache.set(key, items);
      return items;
    }
  }

  private async getSchemaItems(
    connName: string,
    userName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const cacheKey = userName
      ? `${connName}-${userName}-schemas`
      : `${connName}-schemas`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    const config = this.connectionManager.getConnectionRaw(connName);
    if (!config) return [];

    try {
      const result = await this.databaseService.listSchemas(connName, userName);
      const schemas = result.rows || [];

      if (schemas.length === 0) {
        // PG 跨库无法查看 schema，显示提示
        if (userName) {
          const note = [
            new ConnectionTreeItem(
              `⚠️ ${vscode.l10n.t("No schemas found in database: {0}", userName || "")}`,
              vscode.TreeItemCollapsibleState.None,
              CTX.EMPTY,
            ),
          ];
          this.cache.set(cacheKey, note);
          return note;
        }
        // 直接显示分组
        const items = await this.getObjectGroupItems(connName, undefined);
        this.cache.set(cacheKey, items);
        return items;
      }

      const items = schemas.map((s: any) => {
        const name = s.name || s.database || "";
        const desc = s.count !== undefined ? `${s.count}` : s.size || "";
        const tip = s.size ? `${s.size}` : undefined;
        return new ConnectionTreeItem(
          `${name}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          CTX.SCHEMA,
          {
            connectionName: connName,
            schemaName: name,
            dbName: userName,
            description: desc,
            tooltip: tip,
            iconPath: new vscode.ThemeIcon("repo"),
          },
        );
      });
      this.cache.set(cacheKey, items);
      return items;
    } catch {
      // 出错时直接显示分组（平铺模式）
      const items = await this.getObjectGroupItems(connName, undefined);
      this.cache.set(cacheKey, items);
      return items;
    }
  }

  // ═══ 三级：对象分组 [Tables (n), Views (n), Procedures (n)] ═══

  private async getObjectGroupItems(
    connName: string,
    schemaName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const config = this.connectionManager.getConnectionRaw(connName);
    if (!config) return [];

    const groups: ConnectionTreeItem[] = [];

    try {
      const tables = await this.databaseService.listTables(
        connName,
        schemaName,
        dbName,
      );
      const allRows = tables.rows || [];
      // 如果数据中有 schemaname 字段则按 schema 过滤，否则数据已服务端过滤
      const hasSchema = allRows.length > 0 && "schemaname" in allRows[0];
      const schemaRows =
        schemaName && hasSchema
          ? allRows.filter(
              (r: any) =>
                (r.schemaname || "").toLowerCase() === schemaName.toLowerCase(),
            )
          : allRows;
      const tableCount = schemaRows.filter(
        (r: any) => (r.type || "").toUpperCase() !== "VIEW",
      ).length;
      const viewCount = schemaRows.filter(
        (r: any) => (r.type || "").toUpperCase() === "VIEW",
      ).length;

      if (tableCount > 0) {
        groups.push(
          new ConnectionTreeItem(
            `${vscode.l10n.t("Tables")}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            CTX.TABLES_GROUP,
            {
              connectionName: connName,
              schemaName,
              dbName,
              description: `${tableCount}`,
              iconPath: new vscode.ThemeIcon("symbol-structure"),
            },
          ),
        );
      }
      if (viewCount > 0) {
        groups.push(
          new ConnectionTreeItem(
            `${vscode.l10n.t("Views")}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            CTX.VIEWS_GROUP,
            {
              connectionName: connName,
              schemaName,
              dbName,
              description: `${viewCount}`,
              iconPath: new vscode.ThemeIcon("preview"),
            },
          ),
        );
      }
    } catch {
      // 忽略表格查询错误
    }

    try {
      const procs = await this.databaseService.listProcedures(
        connName,
        schemaName,
        dbName,
      );
      const procCount = (procs.rows || []).length;
      if (procCount > 0) {
        groups.push(
          new ConnectionTreeItem(
            `${vscode.l10n.t("Procedures")}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            CTX.PROCS_GROUP,
            {
              connectionName: connName,
              schemaName,
              dbName,
              description: `${procCount}`,
              iconPath: new vscode.ThemeIcon("symbol-ruler"),
            },
          ),
        );
      }
    } catch {
      // 忽略存储过程查询错误
    }

    return groups;
  }

  // ═══ 四级：具体对象列表 ══════════════════════════════════

  private async getObjectListItems(
    connName: string,
    schemaName?: string,
    type?: "table" | "view" | "procedure",
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${dbName || ""}-${type}s`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    try {
      if (type === "procedure") {
        const result = await this.databaseService.listProcedures(
          connName,
          schemaName,
          dbName,
        );
        const items = (result.rows || []).map((p: any) => {
          const n = p.name || "";
          return new ConnectionTreeItem(
            `${n}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            CTX.PROCEDURE,
            {
              connectionName: connName,
              schemaName,
              procName: n,
              dbName,
              description: p.type || "",
              iconPath: new vscode.ThemeIcon("symbol-ruler"),
            },
          );
        });
        this.cache.set(key, items);
        return items;
      }

      const result = await this.databaseService.listTables(
        connName,
        schemaName,
        dbName,
      );
      const allRows = result.rows || [];
      const isView = type === "view";
      // 如果数据中有 schemaname 字段则按 schema 过滤，否则已服务端过滤
      const hasSchema = allRows.length > 0 && "schemaname" in allRows[0];
      const schemaRows =
        schemaName && hasSchema
          ? allRows.filter(
              (r: any) =>
                (r.schemaname || "").toLowerCase() === schemaName.toLowerCase(),
            )
          : allRows;
      const filtered = schemaRows.filter(
        (r: any) => ((r.type || "").toUpperCase() === "VIEW") === isView,
      );
      const items = filtered.map((t: any) => {
        return new ConnectionTreeItem(
          `${t.name}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          isView ? CTX.VIEW : CTX.TABLE,
          {
            connectionName: connName,
            tableName: t.name,
            schemaName,
            dbName,
            description: t.comment || "",
            tooltip: vscode.l10n.t(
              "{0}: {1}",
              isView ? "View" : "Table",
              t.name,
            ),
            iconPath: new vscode.ThemeIcon(
              isView ? "preview" : "symbol-structure",
            ),
            command: {
              command: "bigeSql.selectTop100",
              title: vscode.l10n.t("View Data"),
              arguments: [
                {
                  connectionName: connName,
                  tableName: t.name,
                  schemaName,
                  dbName,
                },
              ],
            },
          },
        );
      });
      this.cache.set(key, items);
      return items;
    } catch (err: any) {
      return [
        new ConnectionTreeItem(
          `❌ ${err.message}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.ERROR,
        ),
      ];
    }
  }

  // ═══ 五级A：表分类节点 [Columns, PKs, FKs, Indexes, Triggers] ══

  private async getTableCategoryItems(
    connName: string,
    schemaName?: string,
    tableName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${tableName}-${dbName || ""}-cats`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (!tableName) return [];

    // 并行查询各分类数量
    const [colResult, pkResult, fkResult, idxResult, trgResult] =
      await Promise.allSettled([
        this.databaseService.describeTable(
          connName,
          tableName,
          schemaName,
          dbName,
        ),
        this.databaseService.getPrimaryKeys(
          connName,
          tableName,
          schemaName,
          dbName,
        ),
        this.databaseService.getForeignKeys(
          connName,
          tableName,
          schemaName,
          dbName,
        ),
        this.databaseService.getIndexes(
          connName,
          tableName,
          schemaName,
          dbName,
        ),
        this.databaseService.getTriggers(
          connName,
          tableName,
          schemaName,
          dbName,
        ),
      ]);

    const colCount =
      colResult.status === "fulfilled"
        ? (colResult.value.rows || []).length
        : 0;
    console.log(
      `[BigeSQL] getTableCategoryItems(${connName}, table=${tableName}, schema=${schemaName}, db=${dbName}) => columns=${colCount}`,
    );
    const pkCount =
      pkResult.status === "fulfilled"
        ? new Set(
            (pkResult.value.rows || [])
              .map(
                (r: any) =>
                  r.constraintName ||
                  r.CONSTRAINT_NAME ||
                  r.constraint_name ||
                  "",
              )
              .filter(Boolean),
          ).size
        : 0;
    const fkCount =
      fkResult.status === "fulfilled"
        ? new Set(
            (fkResult.value.rows || [])
              .map(
                (r: any) =>
                  r.constraintName ||
                  r.CONSTRAINT_NAME ||
                  r.constraint_name ||
                  "",
              )
              .filter(Boolean),
          ).size
        : 0;
    const idxCount =
      idxResult.status === "fulfilled"
        ? new Set(
            (idxResult.value.rows || [])
              .map(
                (r: any) =>
                  r.indexName || r.INDEX_NAME || r.Key_name || r.name || "",
              )
              .filter(Boolean),
          ).size
        : 0;
    const trgCount =
      trgResult.status === "fulfilled"
        ? (trgResult.value.rows || []).length
        : 0;

    const items: ConnectionTreeItem[] = [];

    // Columns
    items.push(
      new ConnectionTreeItem(
        `${vscode.l10n.t("Columns")}`,
        vscode.TreeItemCollapsibleState.Collapsed,
        CTX.COLUMNS_GROUP,
        {
          connectionName: connName,
          schemaName,
          tableName,
          dbName,
          description: `${colCount}`,
          iconPath: new vscode.ThemeIcon("symbol-field"),
        },
      ),
    );

    // Primary Keys
    items.push(
      new ConnectionTreeItem(
        `${vscode.l10n.t("Primary Keys")}`,
        pkCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        CTX.PK_GROUP,
        {
          connectionName: connName,
          schemaName,
          tableName,
          dbName,
          description: `${pkCount}`,
          iconPath: new vscode.ThemeIcon("key"),
        },
      ),
    );

    // Foreign Keys
    items.push(
      new ConnectionTreeItem(
        `${vscode.l10n.t("Foreign Keys")}`,
        fkCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        CTX.FK_GROUP,
        {
          connectionName: connName,
          schemaName,
          tableName,
          dbName,
          description: `${fkCount}`,
          iconPath: new vscode.ThemeIcon("link"),
        },
      ),
    );

    // Indexes
    items.push(
      new ConnectionTreeItem(
        `${vscode.l10n.t("Indexes")}`,
        idxCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        CTX.INDEXES_GROUP,
        {
          connectionName: connName,
          schemaName,
          tableName,
          dbName,
          description: `${idxCount}`,
          iconPath: new vscode.ThemeIcon("symbol-array"),
        },
      ),
    );

    // Triggers
    items.push(
      new ConnectionTreeItem(
        `${vscode.l10n.t("Triggers")}`,
        trgCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        CTX.TRIGGERS_GROUP,
        {
          connectionName: connName,
          schemaName,
          tableName,
          dbName,
          description: `${trgCount}`,
          iconPath: new vscode.ThemeIcon("symbol-event"),
        },
      ),
    );

    this.cache.set(key, items);
    return items;
  }

  // ═══ 五级B：视图分类节点 [Columns] ══════════════════════

  private async getViewCategoryItems(
    connName: string,
    schemaName?: string,
    tableName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    let colCount = 0;
    if (tableName) {
      try {
        const result = await this.databaseService.describeTable(
          connName,
          tableName,
          schemaName,
          dbName,
        );
        colCount = (result.rows || []).length;
      } catch {}
    }
    return [
      new ConnectionTreeItem(
        `📄 ${vscode.l10n.t("Columns")}`,
        vscode.TreeItemCollapsibleState.Collapsed,
        CTX.COLUMNS_GROUP,
        {
          connectionName: connName,
          schemaName,
          tableName,
          dbName,
          description: `${colCount}`,
          iconPath: new vscode.ThemeIcon("symbol-field"),
        },
      ),
    ];
  }

  // ═══ 五级C：存储过程分类节点 [Parameters] ═══════════════

  private async getProcedureCategoryItems(
    connName: string,
    schemaName?: string,
    procName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    let paramCount = 0;
    if (procName) {
      try {
        const result = await this.databaseService.getProcedureParameters(
          connName,
          procName,
          schemaName,
          dbName,
        );
        const rows = result.rows || [];
        // PG 返回 arguments 字符串作为单行，算 1 个参数节点
        paramCount = rows.length > 0 && rows[0].arguments ? 1 : rows.length;
      } catch {}
    }
    return [
      new ConnectionTreeItem(
        `${vscode.l10n.t("Parameters")}`,
        paramCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        CTX.PARAMS_GROUP,
        {
          connectionName: connName,
          schemaName,
          procName,
          description: `${paramCount}`,
          iconPath: new vscode.ThemeIcon("symbol-parameter"),
        },
      ),
    ];
  }

  // ═══ 六级：具体条目 ══════════════════════════════════════

  /** 列列表 */
  private async getColumnItems(
    connName: string,
    schemaName?: string,
    tableName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${tableName}-${dbName || ""}-columns`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (!tableName) return [];
    try {
      const result = await this.databaseService.describeTable(
        connName,
        tableName,
        schemaName,
        dbName,
      );
      console.log(
        `[BigeSQL] getColumnItems(${connName}, table=${tableName}, schema=${schemaName}, db=${dbName}) => ${result.rows.length} rows`,
        result.rows.length > 0
          ? `first col: ${result.rows[0].Field || result.rows[0].field}`
          : "",
      );
      const columns = result.rows || [];
      const items = columns.map((col: any) => {
        const field = col.Field || col.name || col.field || "";
        const type = col.Type || col.type || "";
        const nullable =
          col.Null === "YES" ||
          col.Null === "yes" ||
          col.null === true ||
          col.notnull === 0;
        const defaultVal =
          col.Default !== undefined && col.Default !== null ? col.Default : "";
        const isPk = col.Key === "PRI" || col.pk > 0;
        const icon = isPk ? "🔑" : "📄";
        return new ConnectionTreeItem(
          `${icon} ${field}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.COLUMN,
          {
            description: type,
            tooltip: vscode.l10n.t(
              "Column: {0}\nType: {1}\nNullable: {2}\nDefault: {3}",
              field,
              type,
              nullable ? vscode.l10n.t("Yes") : vscode.l10n.t("No"),
              defaultVal || vscode.l10n.t("(none)"),
            ),
            iconPath: new vscode.ThemeIcon("symbol-field"),
          },
        );
      });
      if (items.length === 0) {
        items.push(
          new ConnectionTreeItem(
            vscode.l10n.t("No columns"),
            vscode.TreeItemCollapsibleState.None,
            CTX.EMPTY,
          ),
        );
      }
      this.cache.set(key, items);
      return items;
    } catch (err: any) {
      return [
        new ConnectionTreeItem(
          `❌ ${err.message}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.ERROR,
        ),
      ];
    }
  }

  /** 主键列表 */
  private async getPkItems(
    connName: string,
    schemaName?: string,
    tableName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${tableName}-${dbName || ""}-pks`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (!tableName) return [];
    try {
      const result = await this.databaseService.getPrimaryKeys(
        connName,
        tableName,
        schemaName,
        dbName,
      );
      const items = (result.rows || []).map((pk: any) => {
        const colName = pk.columnName || pk.column_name || "";
        const constraintName = pk.constraintName || "";
        return new ConnectionTreeItem(
          `${colName}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.PK,
          {
            description: constraintName || "",
            iconPath: new vscode.ThemeIcon("key"),
          },
        );
      });
      if (items.length === 0) {
        items.push(
          new ConnectionTreeItem(
            vscode.l10n.t("No primary keys"),
            vscode.TreeItemCollapsibleState.None,
            CTX.EMPTY,
          ),
        );
      }
      this.cache.set(key, items);
      return items;
    } catch (err: any) {
      return [
        new ConnectionTreeItem(
          `❌ ${err.message}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.ERROR,
        ),
      ];
    }
  }

  /** 外键列表 */
  private async getFkItems(
    connName: string,
    schemaName?: string,
    tableName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${tableName}-${dbName || ""}-fks`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (!tableName) return [];
    try {
      const result = await this.databaseService.getForeignKeys(
        connName,
        tableName,
        schemaName,
        dbName,
      );
      const items = (result.rows || []).map((fk: any) => {
        const colName = fk.columnName || fk.from || "";
        const refTable = fk.refTable || "";
        const refCol = fk.refColumn || fk.to || "";
        const constraintName = fk.constraintName || "";
        const refDesc = refTable ? `→ ${refTable}(${refCol})` : constraintName;
        return new ConnectionTreeItem(
          `${colName}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.FK,
          {
            description: refDesc,
            tooltip: constraintName,
            iconPath: new vscode.ThemeIcon("link"),
          },
        );
      });
      if (items.length === 0) {
        items.push(
          new ConnectionTreeItem(
            vscode.l10n.t("No foreign keys"),
            vscode.TreeItemCollapsibleState.None,
            CTX.EMPTY,
          ),
        );
      }
      this.cache.set(key, items);
      return items;
    } catch (err: any) {
      return [
        new ConnectionTreeItem(
          `❌ ${err.message}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.ERROR,
        ),
      ];
    }
  }

  /** 索引列表 */
  private async getIndexItems(
    connName: string,
    schemaName?: string,
    tableName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${tableName}-${dbName || ""}-indexes`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (!tableName) return [];
    try {
      const result = await this.databaseService.getIndexes(
        connName,
        tableName,
        schemaName,
        dbName,
      );
      const rows = result.rows || [];

      // 按索引名分组聚合列信息
      const indexMap = new Map<string, { cols: string[]; def?: string }>();
      for (const row of rows) {
        const idxName =
          row.indexName || row.INDEX_NAME || row.Key_name || row.name || "";
        if (!idxName) continue;

        if (row.indexDefinition) {
          // PostgreSQL: 直接使用完整定义
          indexMap.set(idxName, {
            cols: [],
            def: row.indexDefinition,
          });
        } else if (row.columnName || row.Column_name) {
          // SQLite/达梦: columnName 已拼接为 "col1, col2"；MySQL: Column_name 每列一行
          const colVal = row.columnName || "";
          if (colVal.includes(", ")) {
            // SQLite: 已拼接好的多列
            indexMap.set(idxName, { cols: colVal.split(", ") });
          } else {
            // MySQL: 逐行收集
            if (!indexMap.has(idxName)) {
              indexMap.set(idxName, { cols: [] });
            }
            indexMap.get(idxName)!.cols.push(row.Column_name || row.columnName);
          }
        } else {
          indexMap.set(idxName, { cols: [] });
        }
      }

      const items = Array.from(indexMap.entries()).map(([idxName, info]) => {
        const desc = info.def
          ? extractIndexColumns(info.def)
          : `(${info.cols.join(", ")})`;
        return new ConnectionTreeItem(
          `${idxName}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.INDEX,
          {
            description: desc,
            tooltip: info.def || undefined,
            iconPath: new vscode.ThemeIcon("symbol-array"),
          },
        );
      });

      if (items.length === 0) {
        items.push(
          new ConnectionTreeItem(
            vscode.l10n.t("No indexes"),
            vscode.TreeItemCollapsibleState.None,
            CTX.EMPTY,
          ),
        );
      }
      this.cache.set(key, items);
      return items;
    } catch (err: any) {
      return [
        new ConnectionTreeItem(
          `❌ ${err.message}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.ERROR,
        ),
      ];
    }
  }

  /** 触发器列表 */
  private async getTriggerItems(
    connName: string,
    schemaName?: string,
    tableName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${tableName}-${dbName || ""}-triggers`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (!tableName) return [];
    try {
      const result = await this.databaseService.getTriggers(
        connName,
        tableName,
        schemaName,
        dbName,
      );
      const items = (result.rows || []).map((trg: any) => {
        const trgName = trg.triggerName || trg.TRIGGER_NAME || "";
        const trgInfo =
          trg.timing && trg.event ? `${trg.timing} ${trg.event}` : "";
        return new ConnectionTreeItem(
          `${trgName}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.TRIGGER,
          {
            description: trgInfo,
            tooltip: trg.triggerDefinition || undefined,
            iconPath: new vscode.ThemeIcon("symbol-event"),
          },
        );
      });
      if (items.length === 0) {
        items.push(
          new ConnectionTreeItem(
            vscode.l10n.t("No triggers"),
            vscode.TreeItemCollapsibleState.None,
            CTX.EMPTY,
          ),
        );
      }
      this.cache.set(key, items);
      return items;
    } catch (err: any) {
      return [
        new ConnectionTreeItem(
          `❌ ${err.message}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.ERROR,
        ),
      ];
    }
  }

  /** 存储过程参数列表 */
  private async getParamItems(
    connName: string,
    schemaName?: string,
    procName?: string,
    dbName?: string,
  ): Promise<ConnectionTreeItem[]> {
    const key = `${connName}-${schemaName || ""}-${procName}-${dbName || ""}-params`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    if (!procName) return [];
    try {
      const result = await this.databaseService.getProcedureParameters(
        connName,
        procName,
        schemaName,
        dbName,
      );
      const rows = result.rows || [];

      if (rows.length === 0) {
        return [
          new ConnectionTreeItem(
            vscode.l10n.t("No parameters"),
            vscode.TreeItemCollapsibleState.None,
            CTX.EMPTY,
          ),
        ];
      }

      const items = rows.flatMap((row: any) => {
        // PG 返回 arguments 字符串，格式: [mode] [name] type (例: "IN id integer, OUT result boolean")
        if (row.arguments) {
          const args = row.arguments.split(",").map((a: string) => a.trim());
          if (args.length === 1 && args[0] === "") return [];
          return args.map((arg: string) => {
            const parts = arg.split(/\s+/);
            const mode =
              parts[0] === "IN" || parts[0] === "OUT" || parts[0] === "INOUT"
                ? parts.shift()!
                : "IN";
            // PG 格式: name type → name 在第一部分，type 在最后部分
            const name = parts.length > 1 ? parts[0] : "";
            const dataType =
              parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
            const modeIcon =
              mode === "IN" ? "📥" : mode === "OUT" ? "📤" : "📦";
            return new ConnectionTreeItem(
              `${name || `(${dataType})`}`,
              vscode.TreeItemCollapsibleState.None,
              CTX.PARAM,
              {
                description: `${mode} | ${dataType}`,
                iconPath: new vscode.ThemeIcon("symbol-parameter"),
              },
            );
          });
        }
        // MySQL 返回结构化的参数信息
        const paramName = row.paramName || row.PARAMETER_NAME || "";
        const paramMode = row.paramMode || row.PARAMETER_MODE || "";
        const dataType = row.dataType || row.DATA_TYPE || "";
        return [
          new ConnectionTreeItem(
            `${paramName}`,
            vscode.TreeItemCollapsibleState.None,
            CTX.PARAM,
            {
              description: `${paramMode} ${dataType}`.trim(),
              iconPath: new vscode.ThemeIcon("symbol-parameter"),
            },
          ),
        ];
      });
      this.cache.set(key, items);
      return items;
    } catch (err: any) {
      return [
        new ConnectionTreeItem(
          `❌ ${err.message}`,
          vscode.TreeItemCollapsibleState.None,
          CTX.ERROR,
        ),
      ];
    }
  }

  // ═══ 工具方法 ════════════════════════════════════════════════

  private formatTooltip(name: string, config: DbConfig | null): string {
    if (!config) return "";
    const lines = [
      vscode.l10n.t("Connection: {0}", name),
      vscode.l10n.t("Type: {0}", config.type),
    ];
    if (config.host)
      lines.push(
        vscode.l10n.t("Host: {0}:{1}", config.host, config.port || ""),
      );
    if (config.database)
      lines.push(vscode.l10n.t("Database: {0}", config.database));
    if (config.path) lines.push(vscode.l10n.t("Path: {0}", config.path));
    if (config.user) lines.push(vscode.l10n.t("User: {0}", config.user));
    return lines.join("\n");
  }
}

/** 从 PostgreSQL index definition 中提取列名 */
function extractIndexColumns(def: string): string {
  const m = def.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : "";
}
