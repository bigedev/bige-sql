/**
 * BigeSQL - 数据库连接管理器
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface DbConfig {
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
  /** Oracle 权限: 2=SYSDBA, 4=SYSOPER, 等（传入 oracledb.SYSDBA 等常量值） */
  oraclePrivilege?: number;
  /** Oracle 连接字符串中使用 SID 格式（host:port:sid）而非服务名（host:port/service） */
  oracleUseSid?: boolean;
}

export class ConnectionManager {
  private connections: Record<string, DbConfig> = {};
  private connectionsPath: string;

  constructor(private context: vscode.ExtensionContext) {
    this.connectionsPath = this.resolveConnectionsPath();
    this.load();
  }

  private resolveConnectionsPath(): string {
    const customPath = vscode.workspace
      .getConfiguration("bigeSql")
      .get<string>("connectionsFilePath");
    if (customPath) return customPath;
    return path.join(this.context.extensionPath, "connections.json");
  }

  private load(): void {
    try {
      if (fs.existsSync(this.connectionsPath)) {
        const raw = fs.readFileSync(this.connectionsPath, "utf-8");
        const config = JSON.parse(raw);
        this.connections = config.connections || {};
      } else {
        this.connections = {};
      }
    } catch (err: any) {
      console.error("加载 connections.json 失败:", err.message);
      this.connections = {};
    }
  }

  reload(): void {
    this.load();
  }

  save(): void {
    try {
      const dir = path.dirname(this.connectionsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.connectionsPath,
        JSON.stringify({ connections: this.connections }, null, 2),
        "utf-8",
      );
    } catch (err: any) {
      throw new Error(`保存连接配置失败: ${err.message}`);
    }
  }

  listConnections(): string[] {
    return Object.keys(this.connections);
  }

  getConnection(name: string): DbConfig | null {
    return this.connections[name] ? { ...this.connections[name] } : null;
  }

  getConnectionRaw(name: string): DbConfig | undefined {
    return this.connections[name];
  }

  addConnection(name: string, config: DbConfig): void {
    if (!name || !name.trim()) throw new Error("连接名称不能为空");
    if (!config || !config.type) throw new Error("数据库类型不能为空");
    this.connections[name.trim()] = { ...config };
  }

  removeConnection(name: string): void {
    delete this.connections[name];
  }

  getDefaultConnection(): string | null {
    const names = this.listConnections();
    return names.length > 0 ? names[0] : null;
  }

  getCount(): number {
    return this.listConnections().length;
  }
}
