/**
 * BigeSQL - 添加/编辑连接 Webview 脚本
 * 通过 VS Code Webview API 与扩展通信
 */
(function () {
  const vscode = acquireVsCodeApi();
  let dbListCache = [];

  // 診斷：頁面載入完成
  const L = window.LOCALE || {};
  const resultDiv = document.getElementById("testResult");
  if (resultDiv) {
    resultDiv.textContent = L.jsLoaded || "✅ JS loaded";
    resultDiv.style.display = "block";
  }

  // ─── 数据库类型切换 ──────────────────────────────

  document.getElementById("connType").addEventListener("change", function () {
    const isSqlite = this.value === "sqlite";
    document.getElementById("tcpFields").style.display = isSqlite
      ? "none"
      : "block";
    document.getElementById("sqliteField").style.display = isSqlite
      ? "block"
      : "none";
  });

  // 输入过滤下拉
  document
    .getElementById("connDatabase")
    .addEventListener("input", function () {
      const dropdown = document.getElementById("dbDropdown");
      if (!dropdown.classList.contains("open")) return;
      renderDropdown(dropdown, this.value);
    });

  // 聚焦时显示下拉
  document
    .getElementById("connDatabase")
    .addEventListener("focus", function () {
      const dropdown = document.getElementById("dbDropdown");
      if (dbListCache.length > 0) {
        renderDropdown(dropdown, this.value);
        dropdown.classList.add("open");
      }
    });

  // 点击外部关闭下拉
  document.addEventListener("click", function (e) {
    const wrapper = document.querySelector(".db-combo-wrapper");
    if (wrapper && !wrapper.contains(e.target)) {
      document.getElementById("dbDropdown").classList.remove("open");
    }
  });

  // 键盘导航
  document
    .getElementById("connDatabase")
    .addEventListener("keydown", function (e) {
      const dropdown = document.getElementById("dbDropdown");
      if (!dropdown.classList.contains("open")) return;
      const items = dropdown.querySelectorAll(
        ".db-item:not(.db-empty):not(.db-search-info)",
      );
      const selected = dropdown.querySelector(".db-item.selected");
      let idx = -1;
      if (selected) idx = Array.from(items).indexOf(selected);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(idx + 1, items.length - 1);
        items.forEach(function (i) {
          i.classList.remove("selected");
        });
        if (next >= 0) items[next].classList.add("selected");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(idx - 1, 0);
        items.forEach(function (i) {
          i.classList.remove("selected");
        });
        if (items.length > 0) items[prev].classList.add("selected");
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selected) {
          this.value = selected.dataset.db;
          dropdown.classList.remove("open");
        }
      } else if (e.key === "Escape") {
        dropdown.classList.remove("open");
      }
    });

  // ─── 下拉菜单 ────────────────────────────────────

  window.toggleDropdown = function () {
    const dropdown = document.getElementById("dbDropdown");
    if (dbListCache.length === 0) {
      refreshDatabases();
      return;
    }
    dropdown.classList.toggle("open");
    if (dropdown.classList.contains("open")) {
      renderDropdown(dropdown, document.getElementById("connDatabase").value);
    }
  };

  function renderDropdown(dropdown, filterText) {
    var filtered = filterText
      ? dbListCache.filter(function (db) {
          return db.toLowerCase().includes(filterText.toLowerCase());
        })
      : dbListCache;

    var html =
      '<div class="db-search-info">' +
      (filterText
        ? (L.dbSearchInfoFiltered || "Total {0} databases, filtered {1}")
            .replace("{0}", dbListCache.length)
            .replace("{1}", filtered.length)
        : (L.dbSearchInfo || "Total {0} databases").replace(
            "{0}",
            dbListCache.length,
          )) +
      "</div>";
    if (filtered.length === 0) {
      html +=
        '<div class="db-empty">' +
        (L.noMatchingDatabases || "No matching databases") +
        "</div>";
    } else {
      for (var i = 0; i < filtered.length; i++) {
        var db = filtered[i];
        var selected =
          db === document.getElementById("connDatabase").value
            ? " selected"
            : "";
        html +=
          '<div class="db-item' +
          selected +
          '" data-db="' +
          db.replace(/"/g, "&quot;") +
          '" onclick="selectDb(\'' +
          db.replace(/'/g, "\\'") +
          "')\">🗄️ " +
          db +
          "</div>";
      }
    }
    dropdown.innerHTML = html;
  }

  window.selectDb = function (db) {
    document.getElementById("connDatabase").value = db;
    document.getElementById("dbDropdown").classList.remove("open");
  };

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
        (type === "postgresql" ? 5432 : 3306),
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

  // ─── 刷新数据库列表 ──────────────────────────────

  window.refreshDatabases = function () {
    try {
      var type = document.getElementById("connType").value;
      if (type === "sqlite") {
        showToast(
          L.sqliteNoDatabases || "SQLite does not support listing databases",
        );
        return;
      }
      var btn = document.getElementById("refreshDbBtn");
      if (!btn) return;
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>';
      var config = getConfig();
      vscode.postMessage({
        command: "refreshDatabases",
        config: config,
      });
    } catch (err) {
      var rd = document.getElementById("testResult");
      if (rd) {
        rd.textContent = "❌ " + (L.error || "Error") + ": " + err.message;
        rd.className = "test-error";
        rd.style.display = "block";
      }
    }
  };

  // ─── Toast ─────────────────────────────────────────

  function showToast(msg) {
    var rd = document.getElementById("testResult");
    if (rd) {
      rd.textContent = msg;
      rd.className = "";
      rd.style.display = "block";
    }
  }

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

    if (msg.command === "databasesList") {
      var btn = document.getElementById("refreshDbBtn");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = "↻";
      }
      var rd = document.getElementById("testResult");
      if (msg.error) {
        rd.textContent =
          "❌ " +
          (L.listDatabasesFailed || "Failed to list databases") +
          ": " +
          msg.error;
        rd.className = "test-error";
        rd.style.display = "block";
        return;
      }
      dbListCache = msg.databases || [];
      rd.textContent =
        "✅ " +
        (L.databasesLoaded || "Loaded {0} databases").replace(
          "{0}",
          dbListCache.length,
        );
      rd.className = "test-success";
      rd.style.display = "block";
      // 自动弹出下拉
      var dropdown = document.getElementById("dbDropdown");
      renderDropdown(dropdown, "");
      dropdown.classList.add("open");
      var input = document.getElementById("connDatabase");
      if (!input.value && dbListCache.length > 0) {
        input.value = dbListCache[0];
      }
    }
  });
})();
