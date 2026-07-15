/**
 * BigeSQL - MCP Server 状态树视图提供者
 * 在侧边栏展示 MCP 服务运行状态、HTTP 访问信息和启停控制
 */
import * as vscode from "vscode";

/** MCP HTTP 默认端口 */
export const MCP_DEFAULT_PORT = 5237;

export class McpServerTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: "status" | "url" | "port" | "action",
    extra?: Partial<McpServerTreeItem>,
  ) {
    super(label, collapsibleState);
    if (extra) Object.assign(this, extra);
  }
}

export class McpServerTreeProvider implements vscode.TreeDataProvider<McpServerTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    McpServerTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private getIsRunning: () => boolean,
    private getPort: () => number,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: McpServerTreeItem): McpServerTreeItem {
    return element;
  }

  getChildren(): McpServerTreeItem[] {
    const isRunning = this.getIsRunning();
    const port = this.getPort();
    const items: McpServerTreeItem[] = [];

    // ── 状态 ──
    if (isRunning) {
      items.push(
        new McpServerTreeItem(
          vscode.l10n.t("Status: Running"),
          vscode.TreeItemCollapsibleState.None,
          "status",
          {
            command: {
              command: "bigeSql.stopMcpServer",
              title: vscode.l10n.t("Stop MCP Server"),
            },
            tooltip: vscode.l10n.t("Click to stop MCP Server"),
            contextValue: "running",
          },
        ),
      );
    } else {
      items.push(
        new McpServerTreeItem(
          vscode.l10n.t("Status: Stopped"),
          vscode.TreeItemCollapsibleState.None,
          "status",
          {
            command: {
              command: "bigeSql.startMcpServer",
              title: vscode.l10n.t("Start MCP Server"),
            },
            tooltip: vscode.l10n.t("Click to start MCP Server"),
            contextValue: "stopped",
          },
        ),
      );
    }

    // ── HTTP 端点 ──
    const url = `http://127.0.0.1:${port}/mcp`;
    items.push(
      new McpServerTreeItem(
        vscode.l10n.t("HTTP: {0}", url),
        vscode.TreeItemCollapsibleState.None,
        "url",
        {
          tooltip: vscode.l10n.t("Click to copy HTTP endpoint URL"),
          contextValue: "url",
          command: {
            command: "bigeSql.copyMcpUrl",
            title: vscode.l10n.t("Copy MCP URL"),
          },
        },
      ),
    );

    // ── 端口配置 ──
    items.push(
      new McpServerTreeItem(
        vscode.l10n.t("Port: {0}", port),
        vscode.TreeItemCollapsibleState.None,
        "port",
        {
          tooltip: vscode.l10n.t("Click to modify MCP Server port"),
          contextValue: "port",
          command: {
            command: "bigeSql.configureMcpPort",
            title: vscode.l10n.t("Configure MCP Port"),
          },
        },
      ),
    );

    // ── 启停按钮 ──
    if (isRunning) {
      items.push(
        new McpServerTreeItem(
          vscode.l10n.t("Stop Service"),
          vscode.TreeItemCollapsibleState.None,
          "action",
          {
            command: {
              command: "bigeSql.stopMcpServer",
              title: vscode.l10n.t("Stop MCP Server"),
            },
            tooltip: vscode.l10n.t("Stop MCP Server"),
          },
        ),
      );
    } else {
      items.push(
        new McpServerTreeItem(
          vscode.l10n.t("Start Service"),
          vscode.TreeItemCollapsibleState.None,
          "action",
          {
            command: {
              command: "bigeSql.startMcpServer",
              title: vscode.l10n.t("Start MCP Server"),
            },
            tooltip: vscode.l10n.t("Start MCP Server"),
          },
        ),
      );
    }

    return items;
  }
}
