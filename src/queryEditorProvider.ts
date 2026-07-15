/**
 * BigeSQL - SQL 查询编辑器 Webview
 */
import * as vscode from "vscode";
import { ConnectionManager } from "./connectionManager";
import { DatabaseService } from "./databaseService";

export class QueryEditorProvider {
  private static panels = new Map<string, vscode.WebviewPanel>();

  static createOrShow(
    extensionUri: vscode.Uri,
    connName: string,
    tableName?: string,
    connectionManager?: ConnectionManager,
    databaseService?: DatabaseService,
    initialSql?: string,
    dbName?: string,
  ): vscode.WebviewPanel | undefined {
    const panelId = `bigeSql.query.${connName}`;
    let panel = QueryEditorProvider.panels.get(panelId);
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside);
      // 一次性更新 SQL 和数据库上下文
      panel.webview.postMessage({
        command: "setSql",
        sql: initialSql || "",
        dbName: dbName || "",
      });
      if (tableName)
        panel.title = vscode.l10n.t(
          "SQL Query - {0}{1} / {2}",
          connName,
          dbName ? ` @${dbName}` : "",
          tableName,
        );
      return panel;
    }

    panel = vscode.window.createWebviewPanel(
      "bigeSql.queryEditor",
      vscode.l10n.t(
        "SQL Query - {0}{1}{2}",
        connName,
        dbName ? ` @${dbName}` : "",
        tableName ? ` / ${tableName}` : "",
      ),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    QueryEditorProvider.panels.set(panelId, panel);
    panel.onDidDispose(() => QueryEditorProvider.panels.delete(panelId));

    const allConnections =
      connectionManager?.listConnections().map((n) => ({
        name: n,
        config: connectionManager.getConnection(n),
      })) || [];

    panel.webview.html = QueryEditorProvider.getHtml(
      panel.webview,
      extensionUri,
      {
        connName,
        tableName,
        initialSql,
        allConnections,
        dbName,
      },
    );

    if (databaseService) {
      panel.webview.onDidReceiveMessage(async (message: any) => {
        switch (message.command) {
          case "executeQuery": {
            const { sql, connection, dbName } = message;
            if (!sql?.trim()) {
              panel?.webview.postMessage({
                command: "queryResult",
                error: vscode.l10n.t("Please enter an SQL statement"),
              });
              return;
            }
            try {
              const result = await databaseService.executeQuery(
                connection,
                sql,
                dbName,
              );
              panel?.webview.postMessage({
                command: "queryResult",
                data: result,
              });
            } catch (err: any) {
              panel?.webview.postMessage({
                command: "queryResult",
                error: err.message,
              });
            }
            break;
          }
          case "listTables": {
            const { connection, dbName } = message;
            try {
              const result = await databaseService.listTables(
                connection,
                undefined,
                dbName,
              );
              panel?.webview.postMessage({
                command: "tablesList",
                tables: result.rows || [],
              });
            } catch (err: any) {
              panel?.webview.postMessage({
                command: "tablesList",
                error: err.message,
                tables: [],
              });
            }
            break;
          }
          case "describeTable": {
            const { connection, tableName: tName } = message;
            try {
              const result = await databaseService.describeTable(
                connection,
                tName,
              );
              panel?.webview.postMessage({
                command: "tableInfo",
                tableName: tName,
                columns: result.rows || [],
              });
            } catch (err: any) {
              panel?.webview.postMessage({
                command: "tableInfo",
                error: err.message,
              });
            }
            break;
          }
          case "changeConnection": {
            if (panel)
              panel.title = vscode.l10n.t(
                "SQL Query - {0}",
                message.connection,
              );
            break;
          }
        }
      });
    }

    return panel;
  }

  private static getHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    state: any,
  ): string {
    const { connName, tableName, initialSql, allConnections, dbName } = state;
    const lang = vscode.env.language;

    // Build localized strings for webview inline JS
    const locale = {
      running: vscode.l10n.t("Running\u2026"),
      executing: vscode.l10n.t("Executing query\u2026"),
      ready: vscode.l10n.t("Ready"),
      queryFailed: vscode.l10n.t("Query failed"),
      queryCompleted: vscode.l10n.t("Query completed"),
      executed: vscode.l10n.t("Executed"),
      noTables: vscode.l10n.t("No tables"),
      resultCount: (n: number) => vscode.l10n.t("{0} rows", n),
      affectedRows: (n: number) => vscode.l10n.t("Affected rows: {0}", n),
      emptyResult: vscode.l10n.t("Query result is empty (0 rows)"),
      executeHint: vscode.l10n.t("Click ▶ Run to execute SQL query"),
      sqlPlaceholder: vscode.l10n.t("Enter SQL statement here\u2026"),
      sqlExample: "SELECT * FROM users LIMIT 10",
    };

    return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${vscode.l10n.t("BigeSQL Query Editor")}</title>
<style>
:root{--bg:#1e1e1e;--bg2:#252526;--bg3:#2d2d2d;--fg:#d4d4d4;--fg2:#969696;--border:#3c3c3c;--primary:#007acc;--error:#f14c4c;--success:#4ec9b0;--warning:#cca700;--font-mono:'Cascadia Code','JetBrains Mono','Fira Code','Consolas',monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--fg);height:100vh;display:flex;flex-direction:column;overflow:hidden}
.toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg2);border-bottom:1px solid var(--border);flex-shrink:0}
.toolbar select{background:var(--bg3);color:var(--fg);border:1px solid var(--border);padding:4px 8px;border-radius:3px;font-size:12px}
.toolbar button{background:var(--primary);color:#fff;border:none;padding:5px 14px;border-radius:3px;cursor:pointer;font-size:12px;font-weight:500}
.toolbar button:hover{background:#0098ff}
.toolbar .btn-secondary{background:var(--bg3);color:var(--fg);border:1px solid var(--border)}
.toolbar .btn-secondary:hover{background:#3a3a3a}
.toolbar .label{font-size:12px;color:var(--fg2)}
.toolbar .spacer{flex:1}
.editor-area{flex:1;display:flex;flex-direction:column;min-height:0}
.sql-editor{flex:1;min-height:120px;resize:vertical;overflow:auto}
.sql-editor textarea{width:100%;height:100%;background:var(--bg);color:var(--fg);border:none;border-bottom:1px solid var(--border);padding:12px 16px;font-family:var(--font-mono);font-size:13px;line-height:1.6;resize:none;outline:none;tab-size:2}
.result-area{flex:2;display:flex;flex-direction:column;overflow:hidden}
.result-tabs{display:flex;background:var(--bg2);border-bottom:1px solid var(--border);padding:0 8px;flex-shrink:0}
.result-tab{padding:6px 14px;font-size:12px;cursor:pointer;color:var(--fg2);border-bottom:2px solid transparent}
.result-tab.active{color:var(--fg);border-bottom-color:var(--primary)}
.result-content{flex:1;overflow:auto;padding:0}
.result-table{width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12px}
.result-table th{background:var(--bg2);color:var(--primary);padding:6px 10px;text-align:left;font-weight:600;position:sticky;top:0;z-index:1;border-bottom:2px solid var(--border);white-space:nowrap}
.result-table td{padding:4px 10px;border-bottom:1px solid var(--border);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.result-table tr:hover td{background:var(--bg3)}
.result-table .null-value{color:var(--fg2);font-style:italic}
.status-bar{display:flex;align-items:center;gap:16px;padding:4px 12px;background:var(--primary);color:#fff;font-size:11px;flex-shrink:0}
.status-bar.error{background:var(--error)}
.status-bar .spacer{flex:1}
.sidebar-panel{position:fixed;right:0;top:0;bottom:0;width:320px;background:var(--bg2);border-left:1px solid var(--border);z-index:100;display:none;flex-direction:column;box-shadow:-4px 0 12px rgba(0,0,0,0.3)}
.sidebar-panel.open{display:flex}
.sidebar-header{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);font-weight:500}
.sidebar-header .spacer{flex:1}
.sidebar-header button{background:none;border:none;color:var(--fg2);cursor:pointer;font-size:18px}
.sidebar-body{flex:1;overflow:auto;padding:8px}
.table-item{padding:6px 10px;cursor:pointer;border-radius:3px;font-size:13px;display:flex;align-items:center;gap:6px}
.table-item:hover{background:var(--bg3)}
.table-item .type-badge{font-size:10px;background:var(--bg3);padding:1px 5px;border-radius:3px;color:var(--fg2);margin-left:auto}
.loading{display:flex;align-items:center;justify-content:center;padding:40px;color:var(--fg2);gap:8px}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.error-detail{padding:16px;color:var(--error);font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;background:#2d1a1a;margin:8px;border-radius:4px;border:1px solid #4a1a1a}
</style>
</head>
<body>
<div class="toolbar">
<span class="label">${vscode.l10n.t("Connection:")}</span>
<select id="connectionSelect">${allConnections.map((c: any) => `<option value="${c.name}" ${c.name === connName ? "selected" : ""}>${c.name} (${c.config?.type || ""})</option>`).join("")}</select>
<span class="label" id="dbLabel" style="margin-left:4px">${dbName ? `📁 ${dbName}` : ""}</span>
<div class="spacer"></div>
<button class="btn-secondary" onclick="toggleSidebar()">📋 ${vscode.l10n.t("Table List")}</button>
<button onclick="formatSql()">${vscode.l10n.t("Format SQL")}</button>
<button onclick="executeSql()" style="background:#4ec9b0;color:#1e1e1e">▶ ${vscode.l10n.t("Run")}</button>
</div>
<div class="editor-area">
<div class="sql-editor"><textarea id="sqlEditor" placeholder="${locale.sqlPlaceholder}&#10;&#10;${vscode.l10n.t("e.g.")}: ${locale.sqlExample}" spellcheck="false">${initialSql || ""}</textarea></div>
<div class="result-area">
<div class="result-tabs"><div class="result-tab active" onclick="switchTab('results')">📊 ${vscode.l10n.t("Result")}</div><div class="result-tab" onclick="switchTab('messages')">📝 ${vscode.l10n.t("Message")}</div></div>
<div class="result-content" id="resultContent"><div style="padding:20px;color:var(--fg2);text-align:center">${locale.executeHint}</div></div>
</div></div>
<div class="status-bar" id="statusBar"><span>${locale.ready}</span><span class="spacer"></span><span id="rowCount"></span></div>
<div class="sidebar-panel" id="sidebarPanel"><div class="sidebar-header"><span>📋 ${vscode.l10n.t("Tables / Views")}</span><div class="spacer"></div><button onclick="toggleSidebar()">✕</button></div><div class="sidebar-body" id="sidebarBody"><div class="loading"><div class="spinner"></div> ${vscode.l10n.t("Loading\u2026")}</div></div></div>
<script>
const L=${JSON.stringify(locale)};const vscode=acquireVsCodeApi();let currentConnection='${connName}',currentDbName='${dbName || ""}',sidebarOpen=false,currentTab='results';
document.getElementById('sqlEditor').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();executeSql()}});
document.getElementById('connectionSelect').addEventListener('change',e=>{currentConnection=e.target.value;currentDbName='';document.getElementById('dbLabel').textContent='';vscode.postMessage({command:'changeConnection',connection:currentConnection});vscode.postMessage({command:'listTables',connection:currentConnection,dbName:currentDbName})});
function executeSql(){const sql=document.getElementById('sqlEditor').value.trim();if(!sql)return;setStatus(L.running,'');document.getElementById('resultContent').innerHTML='<div class="loading"><div class="spinner"></div> '+L.executing+'</div>';vscode.postMessage({command:'executeQuery',sql:sql,connection:currentConnection,dbName:currentDbName})}
function formatSql(){const e=document.getElementById('sqlEditor');let s=e.value.trim();if(!s)return;const kw=['SELECT','FROM','WHERE','AND','OR','ORDER BY','GROUP BY','HAVING','LIMIT','OFFSET','JOIN','LEFT JOIN','RIGHT JOIN','INNER JOIN','OUTER JOIN','ON','IN','NOT IN','EXISTS','NOT EXISTS','BETWEEN','LIKE','IS NULL','IS NOT NULL','AS','DISTINCT','UNION','ALL','INSERT INTO','VALUES','UPDATE','SET','DELETE FROM','CREATE TABLE','ALTER TABLE','DROP TABLE','INDEX','CREATE INDEX'];for(const k of kw){const r=new RegExp('\\\\b'+k.replace(/ /g,'\\\\s+')+'\\\\b','gi');s=s.replace(r,m=>{const p=m.substring(0,m.search(/\\S/));return p+'\\n'+m.trim().toUpperCase()})}s=s.replace(/\\n\\n/g,'\\n');e.value=s.trim()}
function toggleSidebar(){sidebarOpen=!sidebarOpen;const p=document.getElementById('sidebarPanel');p.classList.toggle('open',sidebarOpen);if(sidebarOpen){vscode.postMessage({command:'listTables',connection:currentConnection,dbName:currentDbName})}}
function switchTab(tab){currentTab=tab;document.querySelectorAll('.result-tab').forEach((t,i)=>t.classList.toggle('active',(tab==='results'?i===0:i===1)))}
function setStatus(txt,type){const b=document.getElementById('statusBar');b.className='status-bar'+(type?' '+type:'');b.querySelector('span:first-child').textContent=txt}
function showToast(m){const t=document.getElementById('toast');if(t){t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}}
window.addEventListener('message',event=>{const msg=event.data;
if(msg.command==='queryResult'){if(msg.error){document.getElementById('resultContent').innerHTML='<div class="error-detail">❌ '+escapeHtml(msg.error)+'</div>';setStatus(L.queryFailed,'error');return}renderResult(msg.data)}
if(msg.command==='tablesList'){const sb=document.getElementById('sidebarBody');if(msg.error){sb.innerHTML='<div class="error-detail">❌ '+escapeHtml(msg.error)+'</div>';return}const tbls=msg.tables||[];if(!tbls.length){sb.innerHTML='<div style="padding:12px;color:var(--fg2)">'+L.noTables+'</div>';return}sb.innerHTML=tbls.map(t=>'<div class="table-item" onclick="insertTableName(\\''+escapeHtml(t.name)+'\\')"><span>'+(t.type.toUpperCase()==='VIEW'?'👁️':'📋')+'</span><span>'+escapeHtml(t.name)+'</span><span class="type-badge">'+(t.type.toUpperCase()==='VIEW'?'VIEW':'TABLE')+'</span></div>').join('')}
if(msg.command==='setSql'){if(msg.dbName!==undefined){currentDbName=msg.dbName;const lbl=document.getElementById('dbLabel');if(lbl)lbl.textContent=currentDbName?'📁 '+currentDbName:''}document.getElementById('sqlEditor').value=msg.sql||'';executeSql();vscode.postMessage({command:'listTables',connection:currentConnection,dbName:currentDbName})}});
function insertTableName(n){const e=document.getElementById('sqlEditor'),p=e.selectionStart;e.value=e.value.substring(0,p)+n+e.value.substring(e.selectionEnd);e.focus();e.selectionStart=e.selectionEnd=p+n.length}
function renderResult(data){const rows=data.rows||[],isSelect=data.isSelect;const fn=function(n,s){return typeof s==='string'?s.replace('{0}',n):s};if(!isSelect){const a=data.affectedRows||rows[0]?.affectedRows||0;document.getElementById('resultContent').innerHTML='<div style="padding:20px;color:var(--success)">✅ '+fn(a,L.affectedRows)+'</div>';setStatus(L.executed);document.getElementById('rowCount').textContent=fn(a,L.affectedRows);return}if(!rows.length){document.getElementById('resultContent').innerHTML='<div style="padding:20px;color:var(--fg2)">'+L.emptyResult+'</div>';setStatus(L.queryCompleted);document.getElementById('rowCount').textContent=fn(0,L.resultCount);return}const cols=Object.keys(rows[0]);let h='<table class="result-table"><thead><tr>';for(const c of cols)h+='<th>'+escapeHtml(c)+'</th>';h+='</tr></thead><tbody>';for(const r of rows){h+='<tr>';for(const c of cols){const v=r[c];if(v===null||v===undefined)h+='<td><span class="null-value">NULL</span></td>';else if(typeof v==='object')h+='<td>'+escapeHtml(JSON.stringify(v))+'</td>';else h+='<td>'+escapeHtml(String(v))+'</td>'}h+='</tr>'}h+='</tbody></table>';document.getElementById('resultContent').innerHTML=h;setStatus(L.queryCompleted);document.getElementById('rowCount').textContent=fn(rows.length,L.resultCount)}
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
document.addEventListener('click',function(e){const p=document.getElementById('sidebarPanel');if(sidebarOpen&&p&&!p.contains(e.target)&&!e.target.closest('[onclick*=\"toggleSidebar\"]')){sidebarOpen=false;p.classList.remove('open')}});
vscode.postMessage({command:'listTables',connection:currentConnection,dbName:currentDbName});
${initialSql ? "setTimeout(executeSql,300);" : ""}
</script>
</body></html>`;
  }
}
