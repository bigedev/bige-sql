/**
 * BigeSQL - 添加/编辑连接 Webview 脚本
 * 通过 VS Code Webview API 与扩展通信
 */
(function () {
  const vscode = acquireVsCodeApi();

  // 診斷：頁面載入完成
  const L = window.LOCALE || {};
  const resultDiv = document.getElementById("testResult");
  if (resultDiv) {
    resultDiv.textContent = L.jsLoaded || "✅ JS loaded";
    resultDiv.style.display = "block";
  }

  // ─── 数据库类型切换 ──────────────────────────────

  // 各数据库类型的默认端口
  const DEFAULT_PORTS = {
    mysql: 3306,
    postgresql: 5432,
    sqlserver: 1433,
    oracle: 1521,
    dameng: 5236,
  };

  // 各数据库类型的默认用户
  const DEFAULT_USERS = {
    mysql: "root",
    postgresql: "postgres",
    sqlserver: "sa",
    oracle: "scott",
    dameng: "SYSDBA",
  };

  // 各数据库类型的默认主机
  const DEFAULT_HOSTS = {
    mysql: "127.0.0.1",
    postgresql: "127.0.0.1",
    sqlserver: "127.0.0.1",
    oracle: "127.0.0.1",
    dameng: "127.0.0.1",
  };

  // 数据库类型对应的标签文本（使用本地化字符串）
  const DB_LABELS = {
    mysql: L.labelDbName || "Database Name",
    postgresql: L.labelDbName || "Database Name",
    sqlserver: L.labelDbName || "Database Name",
    oracle: L.labelSid || "SID / Service Name",
    dameng: L.labelSchema || "Schema Name",
  };

  const DB_PLACEHOLDERS = {
    mysql: L.placeholderDbOptional || "mydb (optional)",
    postgresql: L.placeholderDbOptional || "mydb (optional)",
    sqlserver: L.placeholderDbOptional || "mydb (optional)",
    oracle: L.placeholderOracle || "ORCL or pdbname",
    dameng: L.placeholderSchema || "schema name (optional)",
  };

  document.getElementById("connType").addEventListener("change", function () {
    const type = this.value;
    const isSqlite = type === "sqlite";
    const isOracle = type === "oracle";

    document.getElementById("tcpFields").style.display = isSqlite
      ? "none"
      : "block";
    document.getElementById("sqliteField").style.display = isSqlite
      ? "block"
      : "none";

    // 数据库名字段：仅 Oracle 显示（SID/服务名），其他类型隐藏
    var dbGroup = document.getElementById("dbGroup");
    if (dbGroup) {
      dbGroup.style.display = isOracle ? "block" : "none";
    }

    // 更新标签和占位符
    var dbLabel = document.getElementById("dbLabel");
    var dbInput = document.getElementById("connDatabase");
    if (isOracle) {
      dbLabel.textContent = DB_LABELS.oracle;
      if (!dbInput._userModified) {
        dbInput.placeholder = DB_PLACEHOLDERS.oracle;
      }
    }

    // 自动填充默认值（未手动修改过时）
    if (!isSqlite && DEFAULT_PORTS[type]) {
      var portInput = document.getElementById("connPort");
      if (!portInput._userModified) {
        portInput.placeholder = String(DEFAULT_PORTS[type]);
      }
      var userInput = document.getElementById("connUser");
      if (!userInput._userModified && DEFAULT_USERS[type]) {
        userInput.placeholder = DEFAULT_USERS[type];
      }
      var hostInput = document.getElementById("connHost");
      if (!hostInput._userModified && DEFAULT_HOSTS[type]) {
        hostInput.placeholder = DEFAULT_HOSTS[type];
      }
    }
  });

  // 标记用户已修改的字段，避免切换类型时覆盖
  function markModified(evt) {
    evt.target._userModified = true;
  }
  document.getElementById("connPort").addEventListener("input", markModified);
  document.getElementById("connUser").addEventListener("input", markModified);
  document.getElementById("connHost").addEventListener("input", markModified);
  document.getElementById("connDatabase").addEventListener("input", markModified);

  // ─── 获取表单配置 ────────────────────────────────

  function getConfig() {
    var type = document.getElementById("connType").value;
    if (type === "sqlite") {
      return {
        type: "sqlite",
        path: document.getElementById("connPath").value,
      };
    }
    return {
      type: type,
      host: document.getElementById("connHost").value || "127.0.0.1",
      port:
        parseInt(document.getElementById("connPort").value) ||
        (type === "postgresql"
          ? 5432
          : type === "sqlserver" || type === "mssql"
            ? 1433
            : type === "oracle"
              ? 1521
              : 3306),
      user: document.getElementById("connUser").value || "root",
      password: document.getElementById("connPassword").value || "",
      database: document.getElementById("connDatabase").value || "",
    };
  }

  // ─── 保存 ─────────────────────────────────────────

  window.saveConn = function () {
    var name = document.getElementById("connName").value.trim();
    if (!name) {
      alert(L.nameRequired || "Please enter a connection name");
      return;
    }
    vscode.postMessage({
      command: "saveConnection",
      name: name,
      config: getConfig(),
    });
  };

  // ─── 测试连接 ─────────────────────────────────────

  window.testConn = function () {
    var name = document.getElementById("connName").value.trim();
    var rd = document.getElementById("testResult");
    rd.textContent = L.testing || "⏳ Testing…";
    rd.className = "";
    rd.style.display = "block";
    vscode.postMessage({
      command: "testConnection",
      name: name || "test",
      config: getConfig(),
    });
  };

  // ─── 浏览 SQLite 文件 ────────────────────────────

  window.browseSqlitePath = function () {
    vscode.postMessage({
      command: "browseFile",
    });
  };

  // ─── 接收扩展消息 ─────────────────────────────────

  window.addEventListener("message", function (event) {
    var msg = event.data;

    if (msg.command === "testResult") {
      var rd = document.getElementById("testResult");
      rd.textContent = msg.message;
      rd.className = msg.success ? "test-success" : "test-error";
      rd.style.display = "block";
    }

    if (msg.command === "fileSelected") {
      var pathInput = document.getElementById("connPath");
      if (pathInput) {
        pathInput.value = msg.path;
      }
    }
  });
})();
