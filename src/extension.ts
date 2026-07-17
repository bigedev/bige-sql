/**
 * BigeSQL - VS Code Extension 主入口 (TypeScript)
 * 提供图形界面管理数据库连接和执行 SQL 查询
 */
import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import { ConnectionManager } from "./connectionManager";
import { DatabaseService } from "./databaseService";
import { QueryEditorProvider } from "./queryEditorProvider";
import { ConnectionTreeProvider } from "./connectionTreeProvider";
import { McpServerTreeProvider, MCP_DEFAULT_PORT } from "./mcpServerProvider";
import {
  DbType,
  quoteName,
  isSqlServer,
  isOracle,
} from "./dbTypes";

let connectionManager: ConnectionManager;
let databaseService: DatabaseService;
let connectionTreeProvider: ConnectionTreeProvider;
let extensionUri: vscode.Uri;
let mcpServerProcess: ChildProcess | undefined;
let mcpStatusBarItem: vscode.StatusBarItem | undefined;
let mcpServerPort: number = MCP_DEFAULT_PORT;
let mcpTreeProvider: McpServerTreeProvider | undefined;
let extensionContext: vscode.ExtensionContext;

/** MCP 状态持久化 Key */
const MCP_WAS_RUNNING_KEY = "bigeSql.mcpServer.wasRunning";

/**
 * 扩展激活入口
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("🚀 BigeSQL 扩展已激活");
  extensionUri = context.extensionUri;
  extensionContext = context;

  connectionManager = new ConnectionManager(context);
  databaseService = new DatabaseService(connectionManager);

  connectionTreeProvider = new ConnectionTreeProvider(
    context,
    connectionManager,
    databaseService,
  );
  const treeView = vscode.window.createTreeView("bigeSql.connections", {
    treeDataProvider: connectionTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.commands.registerCommand("bigeSql.addConnection", () =>
      addConnection(),
    ),
    vscode.commands.registerCommand("bigeSql.refreshConnections", () =>
      refreshConnections(),
    ),
    vscode.commands.registerCommand("bigeSql.openQueryEditor", (item) =>
      openQueryEditor(item),
    ),
    vscode.commands.registerCommand("bigeSql.editConnection", (item) =>
      editConnection(item),
    ),
    vscode.commands.registerCommand("bigeSql.deleteConnection", (item) =>
      deleteConnection(item),
    ),
    vscode.commands.registerCommand("bigeSql.testConnection", (item) =>
      testConnection(item),
    ),
    vscode.commands.registerCommand("bigeSql.refreshTable", (item) =>
      refreshTable(item),
    ),
    vscode.commands.registerCommand("bigeSql.selectTop100", (item) =>
      selectTop100(item),
    ),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "bigeSql.queryResult",
      new QueryResultProvider(databaseService),
    ),
  );

  // ── MCP Server 管理 ──
  mcpStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  mcpStatusBarItem.text = "$(plug) BigeSQL MCP";
  mcpStatusBarItem.command = "bigeSql.startMcpServer";
  mcpStatusBarItem.tooltip = vscode.l10n.t("Click to start MCP Server");
  context.subscriptions.push(mcpStatusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("bigeSql.startMcpServer", () =>
      startMcpServer(),
    ),
    vscode.commands.registerCommand("bigeSql.stopMcpServer", () =>
      stopMcpServer(),
    ),
    vscode.commands.registerCommand("bigeSql.copyMcpUrl", () => copyMcpUrl()),
    vscode.commands.registerCommand("bigeSql.configureMcpPort", () =>
      configureMcpPort(),
    ),
  );

  // ── MCP Server 树视图 ──
  mcpTreeProvider = new McpServerTreeProvider(
    () => !!mcpServerProcess,
    () => mcpServerPort,
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "bigeSql.mcpServer",
      mcpTreeProvider,
    ),
  );

  // 更新状态栏
  updateMcpStatusBar();

  // ── 读取端口配置 ──
  const configuredPort = vscode.workspace
    .getConfiguration("bigeSql.mcpServer")
    .get<number>("port");
  if (configuredPort && configuredPort >= 1024 && configuredPort <= 65535) {
    mcpServerPort = configuredPort;
  }

  // ── 自动启动 MCP Server ──
  const autoStart = vscode.workspace
    .getConfiguration("bigeSql.mcpServer")
    .get<boolean>("autoStart", false);
  const wasRunning = context.globalState.get<boolean>(
    MCP_WAS_RUNNING_KEY,
    false,
  );

  if (autoStart || wasRunning) {
    // 延迟启动，等待扩展完全就绪
    setTimeout(() => {
      startMcpServer();
    }, 1500);
  }
}

/**
 * 扩展停用
 * 注意：不调用 stopMcpServer()，避免清除持久化的运行状态，
 * 以便下次启动时可自动恢复 MCP 服务。
 */
export function deactivate() {
  if (mcpServerProcess) {
    mcpServerProcess.kill("SIGTERM");
    mcpServerProcess = undefined;
  }
  databaseService?.closeAll();
}

// ─── 命令处理函数 ──────────────────────────────────────────────

interface DbConfig {
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
}

interface TreeItemData {
  connectionName?: string;
  tableName?: string;
  schemaName?: string;
  dbName?: string;
}

async function addConnection() {
  const panel = vscode.window.createWebviewPanel(
    "bigeSql.addConnection",
    vscode.l10n.t("Add Database Connection"),
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    },
  );

  panel.webview.html = getAddConnectionHtml(extensionUri, panel.webview);

  panel.webview.onDidReceiveMessage(async (message: any) => {
    switch (message.command) {
      case "saveConnection": {
        const { name, config } = message as { name: string; config: DbConfig };
        try {
          connectionManager.addConnection(name, config);
          connectionManager.save();
          // 清理同名残留连接池（如覆盖保存场景）
          databaseService.closeConnection(name);
          connectionTreeProvider.refresh();
          vscode.window.showInformationMessage(
            vscode.l10n.t('✅ Connection "{name}" added', { name }),
          );
          panel.dispose();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            vscode.l10n.t("Failed to add connection: {message}", {
              message: err.message,
            }),
          );
        }
        break;
      }
      case "testConnection": {
        const { config } = message as { config: DbConfig };
        try {
          await databaseService.testConnection(config);
          panel.webview.postMessage({
            command: "testResult",
            success: true,
            message: vscode.l10n.t("✅ Connection successful!"),
          });
        } catch (err: any) {
          panel.webview.postMessage({
            command: "testResult",
            success: false,
            message: vscode.l10n.t("❌ Connection failed: {0}", err.message),
          });
        }
        break;
      }
      case "refreshDatabases": {
        const { config: dbConfig } = message as { config: DbConfig };
        try {
          const databases = await databaseService.fetchDatabases(dbConfig);
          panel.webview.postMessage({ command: "databasesList", databases });
        } catch (err: any) {
          console.error("❌ refreshDatabases 失敗:", err.message);
          panel.webview.postMessage({
            command: "databasesList",
            error: err.message,
            databases: [],
          });
        }
        break;
      }
      case "browseFile": {
        const options: vscode.OpenDialogOptions = {
          canSelectMany: false,
          openLabel: vscode.l10n.t("Select SQLite Database"),
          filters: {
            "Database files": ["db", "sqlite", "sqlite3", "s3db"],
            "All files": ["*"],
          },
        };
        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri.length > 0) {
          panel.webview.postMessage({
            command: "fileSelected",
            path: fileUri[0].fsPath,
          });
        }
        break;
      }
    }
  });
}

async function editConnection(item: TreeItemData) {
  const connName = item?.connectionName;
  if (!connName) return;

  const config = connectionManager.getConnection(connName);
  if (!config) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('Connection "{0}" does not exist', connName),
    );
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "bigeSql.editConnection",
    vscode.l10n.t("Edit Connection: {0}", connName),
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    },
  );

  panel.webview.html = getAddConnectionHtml(
    extensionUri,
    panel.webview,
    connName,
    config,
  );

  panel.webview.onDidReceiveMessage(async (message: any) => {
    switch (message.command) {
      case "saveConnection": {
        const { name, config: newConfig } = message as {
          name: string;
          config: DbConfig;
        };
        try {
          if (name !== connName) connectionManager.removeConnection(connName);
          connectionManager.addConnection(name, newConfig);
          connectionManager.save();
          // 关闭旧连接池，确保下次展开时用新配置重建连接
          databaseService.closeConnection(connName);
          connectionTreeProvider.refresh();
          vscode.window.showInformationMessage(
            vscode.l10n.t('✅ Connection "{name}" updated', { name }),
          );
          panel.dispose();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            vscode.l10n.t("Failed to update connection: {message}", {
              message: err.message,
            }),
          );
        }
        break;
      }
      case "testConnection": {
        const { config: testCfg } = message as { config: DbConfig };
        try {
          await databaseService.testConnection(testCfg);
          panel.webview.postMessage({
            command: "testResult",
            success: true,
            message: vscode.l10n.t("✅ Connection successful!"),
          });
        } catch (err: any) {
          panel.webview.postMessage({
            command: "testResult",
            success: false,
            message: vscode.l10n.t("❌ Connection failed: {0}", err.message),
          });
        }
        break;
      }
      case "refreshDatabases": {
        const { config: dbConfig } = message as { config: DbConfig };
        try {
          const databases = await databaseService.fetchDatabases(dbConfig);
          panel.webview.postMessage({ command: "databasesList", databases });
        } catch (err: any) {
          console.error("❌ refreshDatabases 失敗:", err.message);
          panel.webview.postMessage({
            command: "databasesList",
            error: err.message,
            databases: [],
          });
        }
        break;
      }
      case "browseFile": {
        const options: vscode.OpenDialogOptions = {
          canSelectMany: false,
          openLabel: vscode.l10n.t("Select SQLite Database"),
          filters: {
            "Database files": ["db", "sqlite", "sqlite3", "s3db"],
            "All files": ["*"],
          },
        };
        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri.length > 0) {
          panel.webview.postMessage({
            command: "fileSelected",
            path: fileUri[0].fsPath,
          });
        }
        break;
      }
    }
  });
}

async function deleteConnection(item: TreeItemData) {
  const connName = item?.connectionName;
  if (!connName) return;

  const confirm = await vscode.window.showWarningMessage(
    vscode.l10n.t('Are you sure you want to delete connection "{name}"?', {
      name: connName,
    }),
    { modal: true },
    vscode.l10n.t("Confirm Delete"),
  );

  if (confirm === vscode.l10n.t("Confirm Delete")) {
    connectionManager.removeConnection(connName);
    connectionManager.save();
    connectionTreeProvider.refresh();
    vscode.window.showInformationMessage(
      vscode.l10n.t('🗑️ Connection "{name}" deleted', { name: connName }),
    );
  }
}

function refreshConnections() {
  connectionManager.reload();
  connectionTreeProvider.refresh();
}

async function testConnection(item: TreeItemData) {
  const connName = item?.connectionName;
  if (!connName) return;
  try {
    await databaseService.testConnectionByName(connName);
    vscode.window.showInformationMessage(
      vscode.l10n.t('✅ Connection "{name}" test successful', {
        name: connName,
      }),
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('❌ Connection "{name}" test failed: {message}', {
        name: connName,
        message: err.message,
      }),
    );
  }
}

async function openQueryEditor(item: TreeItemData) {
  let connName = item?.connectionName || item?.tableName;
  const tableName = item?.tableName;
  if (tableName && item?.connectionName) connName = item.connectionName;

  if (!connName) {
    const connections = connectionManager.listConnections();
    if (connections.length === 0) {
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          "No available database connections, please add one first",
        ),
      );
      return;
    }
    if (connections.length === 1) {
      connName = connections[0];
    } else {
      connName = await vscode.window.showQuickPick(connections, {
        placeHolder: vscode.l10n.t("Select a database connection"),
      });
      if (!connName) return;
    }
  }

  QueryEditorProvider.createOrShow(
    extensionUri,
    connName,
    tableName,
    connectionManager,
    databaseService,
    undefined,
    item?.dbName,
    item?.schemaName,
  );
}

async function refreshTable(item: TreeItemData) {
  if (item?.connectionName)
    connectionTreeProvider.refreshConnection(item.connectionName);
  else connectionTreeProvider.refresh();
}

async function selectTop100(item: TreeItemData) {
  if (!item?.connectionName || !item?.tableName) return;
  const config = connectionManager.getConnectionRaw(item.connectionName);
  const tableRef = item.schemaName
    ? `${quoteName(config?.type, item.schemaName)}.${quoteName(config?.type, item.tableName)}`
    : quoteName(config?.type, item.tableName);

  // 根据数据库类型使用不同的分页语法
  let limitSql: string;
  if (isSqlServer(config?.type)) {
    limitSql = `SELECT TOP 100 * FROM ${tableRef}`;
  } else if (isOracle(config?.type)) {
    limitSql = `SELECT * FROM ${tableRef} WHERE ROWNUM <= 100`;
  } else {
    limitSql = `SELECT * FROM ${tableRef} LIMIT 100`;
  }

  QueryEditorProvider.createOrShow(
    extensionUri,
    item.connectionName,
    item.tableName,
    connectionManager,
    databaseService,
    limitSql,
    item.dbName,
    item.schemaName,
  );
}

async function startMcpServer() {
  if (mcpServerProcess) {
    console.log("MCP Server already running");
    return;
  }

  const serverPath = vscode.Uri.joinPath(
    extensionUri,
    "out",
    "src",
    "server.js",
  ).fsPath;

  mcpServerProcess = spawn(
    process.execPath,
    [serverPath, "--http", "--port", String(mcpServerPort)],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  mcpServerProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[MCP stdout] ${msg}`);
  });

  mcpServerProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      console.log(`[MCP] ${msg}`);
      if (msg.includes("listening on http")) {
        const match = msg.match(/http:\/\/[^\s]+/);
        const url = match ? match[0] : `http://127.0.0.1:${mcpServerPort}/mcp`;
        // 持久化运行状态
        extensionContext?.globalState.update(MCP_WAS_RUNNING_KEY, true);
        updateMcpStatusBar();
        mcpTreeProvider?.refresh();
      }
    }
  });

  mcpServerProcess.on("close", (code) => {
    mcpServerProcess = undefined;
    updateMcpStatusBar();
    mcpTreeProvider?.refresh();
    // 进程意外退出时清除状态
    if (code && code > 0) {
      extensionContext?.globalState.update(MCP_WAS_RUNNING_KEY, false);
    }
  });

  mcpServerProcess.on("error", (err) => {
    mcpServerProcess = undefined;
    updateMcpStatusBar();
    mcpTreeProvider?.refresh();
  });
}

function stopMcpServer() {
  if (!mcpServerProcess) {
    return;
  }
  mcpServerProcess.kill("SIGTERM");
  mcpServerProcess = undefined;
  // 清除运行状态
  extensionContext?.globalState.update(MCP_WAS_RUNNING_KEY, false);
  updateMcpStatusBar();
  mcpTreeProvider?.refresh();
}

function updateMcpStatusBar() {
  if (!mcpStatusBarItem) return;
  if (mcpServerProcess) {
    mcpStatusBarItem.text =
      "$(debug-start) BigeSQL MCP • " + vscode.l10n.t("Running");
    mcpStatusBarItem.command = "bigeSql.stopMcpServer";
    mcpStatusBarItem.tooltip = vscode.l10n.t("Click to stop MCP Server");
    mcpStatusBarItem.backgroundColor = undefined;
  } else {
    mcpStatusBarItem.text = "$(plug) BigeSQL MCP";
    mcpStatusBarItem.command = "bigeSql.startMcpServer";
    mcpStatusBarItem.tooltip = vscode.l10n.t("Click to start MCP Server");
    mcpStatusBarItem.backgroundColor = undefined;
  }
  mcpStatusBarItem.show();
}

function copyMcpUrl(): void {
  const url = `http://127.0.0.1:${mcpServerPort}/mcp`;
  vscode.env.clipboard.writeText(url);
  vscode.window.showInformationMessage(
    vscode.l10n.t("📋 MCP URL copied: {url}", { url }),
  );
}

async function configureMcpPort(): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: vscode.l10n.t("Configure MCP Server HTTP Port"),
    value: String(mcpServerPort),
    prompt: vscode.l10n.t("Enter port number (1024-65535)"),
    validateInput: (v: string) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1024 || n > 65535)
        return vscode.l10n.t("Please enter a port between 1024-65535");
      return undefined;
    },
  });
  if (input) {
    mcpServerPort = parseInt(input, 10);
    if (mcpTreeProvider) mcpTreeProvider.refresh();
    vscode.window.showInformationMessage(
      vscode.l10n.t("🔌 MCP port set to {port}, restart to take effect", {
        port: String(mcpServerPort),
      }),
    );
  }
}

// ─── Webview HTML 生成 ──────────────────────────────────────────

function getAddConnectionHtml(
  extUri: vscode.Uri,
  webview: vscode.Webview,
  editName?: string,
  editConfig?: any,
) {
  const isEdit = !!editName;
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, "media", "addConnection.js"),
  );

  // Build localized strings for webview JS
  const locale = {
    jsLoaded: vscode.l10n.t("✅ JS loaded"),
    sqliteNoDatabases: vscode.l10n.t(
      "SQLite does not support listing databases",
    ),
    nameRequired: vscode.l10n.t("Please enter a connection name"),
    testing: vscode.l10n.t("⏳ Testing\u2026"),
    dbSearchInfo: vscode.l10n.t("Total {0} databases"),
    dbSearchInfoFiltered: vscode.l10n.t("Total {0} databases, filtered {1}"),
    noMatchingDatabases: vscode.l10n.t("No matching databases"),
    databasesLoaded: vscode.l10n.t("Loaded {0} databases"),
    listDatabasesFailed: vscode.l10n.t("Failed to list databases"),
    error: vscode.l10n.t("Error"),
  };

  return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root { --bg: #1e1e1e; --fg: #d4d4d4; --input-bg: #3c3c3c; --border: #555; --primary: #007acc; --error: #f14c4c; --success: #4ec9b0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--fg); padding: 16px; margin: 0; }
    h2 { margin-top: 0; color: #fff; font-weight: 400; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .form-group { margin-bottom: 12px; }
    label { display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; color: #999; }
    input, select { width: 100%; padding: 8px 10px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; box-sizing: border-box; font-size: 13px; }
    input:focus, select:focus { outline: none; border-color: var(--primary); }
    .row { display: flex; gap: 12px; }
    .row .form-group { flex: 1; }
    .btn { padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: #0098ff; }
    .btn-secondary { background: var(--input-bg); color: var(--fg); }
    .btn-secondary:hover { background: #4a4a4a; }
    .btn-icon { background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; padding: 6px 10px; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; min-width: 32px; min-height: 30px; }
    .btn-icon:hover { background: #4a4a4a; border-color: var(--primary); }
    .btn-icon:active { background: var(--primary); }
    .btn-icon .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.6s linear infinite; }
    .input-with-btn { display: flex; gap: 6px; align-items: center; }
    .input-with-btn input, .input-with-btn select { flex: 1; }
    .db-combo-wrapper { position: relative; flex: 1; }
    .db-combo-wrapper input { width: 100%; padding-right: 24px; }
    .db-combo-wrapper .dropdown-arrow { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: var(--fg2); font-size: 10px; cursor: pointer; pointer-events: auto; z-index: 2; }
    .db-combo-wrapper .dropdown-arrow:hover { color: var(--primary); }
    .db-dropdown { display: none; position: absolute; top: 100%; left: 0; right: 0; max-height: 260px; overflow-y: auto; background: #2a2a2a; border: 1px solid var(--border); border-radius: 4px; z-index: 1000; margin-top: 2px; box-shadow: 0 6px 16px rgba(0,0,0,0.4); }
    .db-dropdown.open { display: block; }
    .db-dropdown .db-item { padding: 8px 12px; cursor: pointer; font-size: 13px; color: var(--fg); border-bottom: 1px solid #333; display: flex; align-items: center; gap: 8px; }
    .db-dropdown .db-item:last-child { border-bottom: none; }
    .db-dropdown .db-item:hover { background: var(--primary); color: #fff; }
    .db-dropdown .db-item.selected { background: #005a9e; color: #fff; }
    .db-dropdown .db-empty { padding: 16px; text-align: center; color: var(--fg2); font-size: 12px; }
    .db-dropdown .db-search-info { padding: 6px 12px; font-size: 11px; color: var(--fg2); background: #222; border-bottom: 1px solid #333; position: sticky; top: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .actions { display: flex; gap: 8px; margin-top: 20px; justify-content: flex-end; }
    #testResult { margin-top: 12px; padding: 8px 12px; border-radius: 4px; font-size: 13px; display: none; }
    .test-success { background: #1a3a3a; color: var(--success); display: block !important; }
    .test-error { background: #3a1a1a; color: var(--error); display: block !important; }
  </style>
</head>
<body>
  <h2>${isEdit ? vscode.l10n.t("Edit Connection") : vscode.l10n.t("Add Database Connection")}</h2>
  <div class="form-group">
    <label>${vscode.l10n.t("Connection Name")}</label>
    <input id="connName" value="${isEdit ? editName : ""}" placeholder="my-database" />
  </div>
  <div class="form-group">
    <label>${vscode.l10n.t("Database Type")}</label>
    <select id="connType">
      <option value="${DbType.MYSQL}" ${editConfig?.type === DbType.MYSQL ? "selected" : ""}>MySQL / MariaDB</option>
      <option value="${DbType.POSTGRESQL}" ${editConfig?.type === DbType.POSTGRESQL || editConfig?.type === DbType.POSTGRES ? "selected" : ""}>PostgreSQL</option>
      <option value="${DbType.SQLSERVER}" ${editConfig?.type === DbType.SQLSERVER || editConfig?.type === DbType.MSSQL ? "selected" : ""}>SQL Server</option>
      <option value="${DbType.SQLITE}" ${editConfig?.type === DbType.SQLITE ? "selected" : ""}>SQLite</option>
      <option value="${DbType.ORACLE}" ${editConfig?.type === DbType.ORACLE ? "selected" : ""}>Oracle</option>
      <option value="${DbType.DAMENG}" ${editConfig?.type === DbType.DAMENG || editConfig?.type === DbType.DM8 ? "selected" : ""}>${vscode.l10n.t("Dameng DM8")}</option>
    </select>
  </div>
  <div id="tcpFields">
    <div class="row">
      <div class="form-group"><label>${vscode.l10n.t("Host")}</label><input id="connHost" value="${editConfig?.host || ""}" placeholder="127.0.0.1" /></div>
      <div class="form-group" style="max-width:120px"><label>${vscode.l10n.t("Port")}</label><input id="connPort" value="${editConfig?.port || ""}" placeholder="3306" /></div>
    </div>
    <div class="row">
      <div class="form-group"><label>${vscode.l10n.t("Username")}</label><input id="connUser" value="${editConfig?.user || ""}" placeholder="root" /></div>
      <div class="form-group"><label>${vscode.l10n.t("Password")}</label><input id="connPassword" type="password" value="${editConfig?.password || ""}" placeholder="password" /></div>
    </div>
    <div class="form-group">
      <label>${vscode.l10n.t("Database Name")}</label>
      <div class="input-with-btn">
        <div class="db-combo-wrapper">
          <input id="connDatabase" value="${editConfig?.database || ""}" placeholder="${vscode.l10n.t("mydb (not needed for SQLite)")}" autocomplete="off" />
          <span class="dropdown-arrow" id="dropdownArrow" onclick="toggleDropdown()">▼</span>
          <div class="db-dropdown" id="dbDropdown"></div>
        </div>
        <button class="btn-icon" id="refreshDbBtn" onclick="refreshDatabases()" title="${vscode.l10n.t("Refresh database list")}">↻</button>
      </div>
    </div>
  </div>
  <div id="sqliteField" style="display:${editConfig?.type === DbType.SQLITE ? "block" : "none"}">
    <div class="form-group"><label>${vscode.l10n.t("SQLite File Path")}</label><div class="input-with-btn"><input id="connPath" value="${editConfig?.path || ""}" placeholder="/path/to/database.db" /><button class="btn-icon" onclick="browseSqlitePath()" title="${vscode.l10n.t("Browse")}">📂</button></div></div>
  </div>
  <div id="testResult"></div>
  <div class="actions">
    <button class="btn btn-secondary" onclick="testConn()">${vscode.l10n.t("Test Connection")}</button>
    <button class="btn btn-primary" onclick="saveConn()">${isEdit ? vscode.l10n.t("Save Changes") : vscode.l10n.t("Add Connection")}</button>
  </div>
  <script>window.LOCALE = ${JSON.stringify(locale)};</script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

// ─── Query Result Provider ─────────────────────────────────────

class QueryResultProvider implements vscode.WebviewViewProvider {
  constructor(private databaseService: DatabaseService) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
    } as any;
    webviewView.webview.html = `<html><body><p>${vscode.l10n.t("Query results will be displayed here")}</p></body></html>`;
  }
}
