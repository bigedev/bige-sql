/**
 * BigeSQL - SQL 查询编辑器 Webview
 */
import * as vscode from "vscode";
import { ConnectionManager } from "./connectionManager";
import { DatabaseService } from "./databaseService";
import { isOracle, isDameng, isPostgres, isMySQL, isSqlServer } from "./dbTypes";

export class QueryEditorProvider {
  private static panels = new Map<string, vscode.WebviewPanel>();

  private static panelCounter = 0;
  /** 已确定的具体列号（非 Beside），所有查询面板归入此列 */
  private static resolvedCol: vscode.ViewColumn | undefined;

  /** 查找已有查询面板所在的列号 — 多渠道综合判断 */
  private static resolveTargetColumn(): vscode.ViewColumn {
    // 1. 缓存值（最快路径）
    if (QueryEditorProvider.resolvedCol !== undefined) {
      return QueryEditorProvider.resolvedCol;
    }
    // 2. 已有面板的 viewColumn
    for (const p of QueryEditorProvider.panels.values()) {
      const c = p.viewColumn;
      if (c !== undefined) {
        QueryEditorProvider.resolvedCol = c;
        return c;
      }
    }
    // 3. 从 tabGroups 中查找 — instanceof 方式
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === "bigeSql.queryEditor") {
          QueryEditorProvider.resolvedCol = group.viewColumn;
          return group.viewColumn;
        }
      }
    }
    return vscode.ViewColumn.Beside;
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    connName: string,
    tableName?: string,
    connectionManager?: ConnectionManager,
    databaseService?: DatabaseService,
    initialSql?: string,
    dbName?: string,
    schemaName?: string,
  ): vscode.WebviewPanel | undefined {
    const panelId = `bigeSql.query.${connName}_${Date.now()}_${++QueryEditorProvider.panelCounter}`;

    const targetColumn = QueryEditorProvider.resolveTargetColumn();

    const panel = vscode.window.createWebviewPanel(
      "bigeSql.queryEditor",
      vscode.l10n.t(
        "SQL Query - {0}{1}{2}",
        connName,
        dbName ? ` @${dbName}` : "",
        tableName ? ` / ${tableName}` : "",
      ),
      targetColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    // 捕获实际列号，供后续面板复用
    if (QueryEditorProvider.resolvedCol === undefined) {
      // 优先用 viewColumn
      if (panel.viewColumn !== undefined) {
        QueryEditorProvider.resolvedCol = panel.viewColumn;
      } else {
        // 从 tabGroups 中查找刚创建的标签
        for (const group of vscode.window.tabGroups.all) {
          for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === "bigeSql.queryEditor") {
              QueryEditorProvider.resolvedCol = group.viewColumn;
              break;
            }
          }
          if (QueryEditorProvider.resolvedCol !== undefined) break;
        }
      }
      // 仍未获取到则监听状态变更
      if (QueryEditorProvider.resolvedCol === undefined) {
        const d = panel.onDidChangeViewState(() => {
          if (QueryEditorProvider.resolvedCol === undefined && panel.viewColumn !== undefined) {
            QueryEditorProvider.resolvedCol = panel.viewColumn;
          }
          d.dispose();
        });
      }
    }

    QueryEditorProvider.panels.set(panelId, panel);
    panel.onDidDispose(() => {
      QueryEditorProvider.panels.delete(panelId);
      if (QueryEditorProvider.panels.size === 0) {
        QueryEditorProvider.resolvedCol = undefined;
      }
    });

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
        schemaName,
      },
    );

    if (databaseService) {
      panel.webview.onDidReceiveMessage(async (message: any) => {
        switch (message.command) {
          case "executeQuery": {
            const { sql, connection, dbName, schemaName } = message;
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
                schemaName,
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
          case "describeTable": {
            const { connection, tableName: tName, schemaName, dbName } = message;
            try {
              const result = await databaseService.describeTable(
                connection,
                tName,
                schemaName || undefined,
                dbName,
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
          case "listDatabasesOrUsers": {
            const { connection } = message;
            try {
              const config = connectionManager?.getConnectionRaw(connection);
              if (!config) throw new Error("Connection not found");
              const type = config.type;
              let items: string[] = [];

              if (isOracle(type) || isDameng(type)) {
                const result = await databaseService!.listUsers(connection);
                items = result.rows.map((r: any) => r.name);
              } else if (isMySQL(type) || isPostgres(type) || isSqlServer(type)) {
                const result = await databaseService!.listDatabases(connection);
                items = result.rows.map((r: any) => r.name || Object.values(r)[0] as string);
              }

              panel?.webview.postMessage({
                command: "databasesOrUsersList",
                items,
                type: (isOracle(type) || isDameng(type)) ? "users" : "databases",
              });
            } catch (err: any) {
              panel?.webview.postMessage({
                command: "databasesOrUsersList",
                error: err.message,
                items: [],
                type: "databases",
              });
            }
            break;
          }
          case "listSchemas": {
            const { connection, dbName } = message;
            try {
              const config = connectionManager?.getConnectionRaw(connection);
              if (!config) throw new Error("Connection not found");
              const result = await databaseService!.listSchemas(connection, dbName);
              panel?.webview.postMessage({
                command: "schemasList",
                schemas: result.rows.map((r: any) => r.name),
              });
            } catch (err: any) {
              panel?.webview.postMessage({
                command: "schemasList",
                error: err.message,
                schemas: [],
              });
            }
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
    const { connName, tableName, initialSql, allConnections, dbName, schemaName } = state;
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
.loading{display:flex;align-items:center;justify-content:center;padding:40px;color:var(--fg2);gap:8px}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.error-detail{padding:16px;color:var(--error);font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;background:#2d1a1a;margin:8px;border-radius:4px;border:1px solid #4a1a1a}
</style>
</head>
<body>
<div class="toolbar">
<select id="connectionSelect" style="max-width:160px">${allConnections.map((c: any) => `<option value="${c.name}" data-type="${c.config?.type || ""}" ${c.name === connName ? "selected" : ""}>${c.name} (${c.config?.type || ""})</option>`).join("")}</select>
<select id="dbSelect" style="display:none;max-width:160px"></select>
<select id="schemaSelect" style="display:none;max-width:120px"></select>
<div class="spacer"></div>
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

<script>
const L=${JSON.stringify(locale)};const vscode=acquireVsCodeApi();
let currentConnection='${connName}',currentDbName='${dbName || ""}',currentSchema='${schemaName || ""}',dbType='',currentTab='results';
// 获取连接类型辅助函数
function getConnType(){const sel=document.getElementById('connectionSelect');const opt=sel.options[sel.selectedIndex];return opt?opt.getAttribute('data-type')||'':''}
// 判断是否有 schema 层级（PG / SQL Server）
function hasSchemaLevel(t){return t==='postgresql'||t==='postgres'||t==='sqlserver'||t==='mssql'}
// 初始化数据库/模式选择器
function initDbSchemaSelectors(){dbType=getConnType();const isMy=dbType==='mysql'||dbType==='mariadb';const isPg=dbType==='postgresql'||dbType==='postgres';const isOraDm=dbType==='oracle'||dbType==='dameng'||dbType==='dm8';const isSs=dbType==='sqlserver'||dbType==='mssql';const dbSel=document.getElementById('dbSelect'),schemaSel=document.getElementById('schemaSelect');
if(isMy||isPg||isSs){dbSel.style.display='';dbSel.innerHTML='';vscode.postMessage({command:'listDatabasesOrUsers',connection:currentConnection})}else if(isOraDm){dbSel.style.display='';dbSel.innerHTML='';vscode.postMessage({command:'listDatabasesOrUsers',connection:currentConnection})}else{dbSel.style.display='none';schemaSel.style.display='none'}
// 显示 schema 选择器（PG / SQL Server）
if(hasSchemaLevel(dbType)){schemaSel.style.display=''}else{schemaSel.style.display='none'}}
// 切换数据库时更新架构和表列表
function onDbChange(){const dbSel=document.getElementById('dbSelect');currentDbName=dbSel.value||'';const schemaSel=document.getElementById('schemaSelect');currentSchema=schemaSel.value||'';
if(hasSchemaLevel(dbType)){schemaSel.innerHTML='<option value="">${vscode.l10n.t("(default)")}</option>';vscode.postMessage({command:'listSchemas',connection:currentConnection,dbName:currentDbName||undefined})}}
// 切换架构时更新表列表
function onSchemaChange(){currentSchema=document.getElementById('schemaSelect').value||''}
document.getElementById('sqlEditor').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();executeSql()}});
document.getElementById('connectionSelect').addEventListener('change',e=>{currentConnection=e.target.value;currentDbName='';currentSchema='';initDbSchemaSelectors();vscode.postMessage({command:'changeConnection',connection:currentConnection})});
document.getElementById('dbSelect').addEventListener('change',onDbChange);
document.getElementById('schemaSelect').addEventListener('change',onSchemaChange);
function executeSql(){const sql=document.getElementById('sqlEditor').value.trim();if(!sql)return;setStatus(L.running,'');document.getElementById('resultContent').innerHTML='<div class="loading"><div class="spinner"></div> '+L.executing+'</div>';vscode.postMessage({command:'executeQuery',sql:sql,connection:currentConnection,dbName:currentDbName||undefined,schemaName:currentSchema||undefined})}
function formatSql(){const e=document.getElementById('sqlEditor');let s=e.value.trim();if(!s)return;const kw=['SELECT','FROM','WHERE','AND','OR','ORDER BY','GROUP BY','HAVING','LIMIT','OFFSET','JOIN','LEFT JOIN','RIGHT JOIN','INNER JOIN','OUTER JOIN','ON','IN','NOT IN','EXISTS','NOT EXISTS','BETWEEN','LIKE','IS NULL','IS NOT NULL','AS','DISTINCT','UNION','ALL','INSERT INTO','VALUES','UPDATE','SET','DELETE FROM','CREATE TABLE','ALTER TABLE','DROP TABLE','INDEX','CREATE INDEX'];for(const k of kw){const r=new RegExp('\\\\b'+k.replace(/ /g,'\\\\s+')+'\\\\b','gi');s=s.replace(r,m=>{const p=m.substring(0,m.search(/\\S/));return p+'\\n'+m.trim().toUpperCase()})}s=s.replace(/\\n\\n/g,'\\n');e.value=s.trim()}
function switchTab(tab){currentTab=tab;document.querySelectorAll('.result-tab').forEach((t,i)=>t.classList.toggle('active',(tab==='results'?i===0:i===1)))}
function setStatus(txt,type){const b=document.getElementById('statusBar');b.className='status-bar'+(type?' '+type:'');b.querySelector('span:first-child').textContent=txt}
function showToast(m){const t=document.getElementById('toast');if(t){t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}}
window.addEventListener('message',event=>{const msg=event.data;
if(msg.command==='queryResult'){if(msg.error){document.getElementById('resultContent').innerHTML='<div class="error-detail">❌ '+escapeHtml(msg.error)+'</div>';setStatus(L.queryFailed,'error');return}renderResult(msg.data)}
if(msg.command==='databasesOrUsersList'){const dbSel=document.getElementById('dbSelect');if(msg.error){dbSel.innerHTML='<option value="">'+L.error+': '+escapeHtml(msg.error)+'</option>';return}const isUsers=msg.type==='users';dbSel.innerHTML='';let matched=false;msg.items.forEach(function(db){const opt=document.createElement('option');opt.value=db;opt.textContent=db;const shouldSelect=db==='${dbName || ""}'||(isUsers&&db==='${schemaName || ""}');if(shouldSelect){opt.selected=true;matched=true}dbSel.appendChild(opt)});if(!matched&&msg.items.length>0){dbSel.selectedIndex=0;currentDbName=dbSel.value;if(isUsers)currentSchema=currentDbName;onDbChange()}else if(matched){currentDbName=dbSel.value;if(isUsers)currentSchema=currentDbName;onDbChange()}else if(currentDbName)onDbChange();else onDbChange()}
if(msg.command==='schemasList'){const schemaSel=document.getElementById('schemaSelect');if(msg.error){schemaSel.innerHTML='<option value="">'+L.error+': '+escapeHtml(msg.error)+'</option>';return}schemaSel.innerHTML='';let matched=false;msg.schemas.forEach(function(s){const opt=document.createElement('option');opt.value=s;opt.textContent=s;if(s.toLowerCase()==='public'&&!matched){opt.selected=true;matched=true}schemaSel.appendChild(opt)});currentSchema=schemaSel.value||''}
if(msg.command==='setSql'){if(msg.schemaName!==undefined){currentSchema=msg.schemaName}if(msg.dbName!==undefined){currentDbName=msg.dbName;const dbSel=document.getElementById('dbSelect');if(dbSel){for(let i=0;i<dbSel.options.length;i++){if(dbSel.options[i].value===msg.dbName){dbSel.selectedIndex=i;break}}}}if(msg.schemaName){const schemaSel=document.getElementById('schemaSelect');if(schemaSel){for(let i=0;i<schemaSel.options.length;i++){if(schemaSel.options[i].value===msg.schemaName){schemaSel.selectedIndex=i;break}}}// Oracle/Dameng：schema 显示在 dbSelect 中，同步选中
const t=getConnType();if(!hasSchemaLevel(t)&&(t==='oracle'||t==='dameng'||t==='dm8')){const dbSel=document.getElementById('dbSelect');if(dbSel&&!msg.dbName){for(let i=0;i<dbSel.options.length;i++){if(dbSel.options[i].value===msg.schemaName){dbSel.selectedIndex=i;currentDbName=msg.schemaName;break}}}}}document.getElementById('sqlEditor').value=msg.sql||'';executeSql()}});
function renderResult(data){const rows=data.rows||[],isSelect=data.isSelect;const fn=function(n,s){return typeof s==='string'?s.replace('{0}',n):s};if(!isSelect){const a=data.affectedRows||rows[0]?.affectedRows||0;document.getElementById('resultContent').innerHTML='<div style="padding:20px;color:var(--success)">✅ '+fn(a,L.affectedRows)+'</div>';setStatus(L.executed);document.getElementById('rowCount').textContent=fn(a,L.affectedRows);return}if(!rows.length){document.getElementById('resultContent').innerHTML='<div style="padding:20px;color:var(--fg2)">'+L.emptyResult+'</div>';setStatus(L.queryCompleted);document.getElementById('rowCount').textContent=fn(0,L.resultCount);return}const cols=Object.keys(rows[0]);let h='<table class="result-table"><thead><tr>';for(const c of cols)h+='<th>'+escapeHtml(c)+'</th>';h+='</tr></thead><tbody>';for(const r of rows){h+='<tr>';for(const c of cols){const v=r[c];const fullText=v===null?'NULL':typeof v==='object'?JSON.stringify(v):String(v);const escaped=escapeHtml(fullText);h+='<td data-fulltext="'+escapeAttr(fullText)+'" title="'+escapeAttr(fullText)+'">'+escaped+'</td>'}h+='</tr>'}h+='</tbody></table>';document.getElementById('resultContent').innerHTML=h;setStatus(L.queryCompleted);document.getElementById('rowCount').textContent=fn(rows.length,L.resultCount)}
function escapeAttr(s){return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
// 复制事件：如果单元格内无选区（未选中文本），则复制完整内容
document.addEventListener('copy',function(e){try{const sel=window.getSelection();if(!sel||!sel.rangeCount)return;if(sel.toString().trim())return/* 有选中文本，走默认复制 */;let node=sel.getRangeAt(0).startContainer;while(node&&node.nodeType===Node.TEXT_NODE)node=node.parentNode;if(!node||!node.closest)return;const td=node.closest('td');if(td&&td.dataset.fulltext!==undefined){e.clipboardData.setData('text/plain',td.dataset.fulltext);e.preventDefault()}}catch(ex){/* fallback to default copy */}});
// 初始化数据库/架构选择器
initDbSchemaSelectors();

${initialSql ? "setTimeout(executeSql,300);" : ""}
</script>
</body></html>`;
  }
}
