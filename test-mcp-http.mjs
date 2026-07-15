/**
 * MCP HTTP 连接测试脚本
 * 用于诊断外部客户端连接 MCP 服务的问题
 *
 * 使用方式: node test-mcp-http.mjs
 */
const BASE = "http://127.0.0.1:5237/mcp";
let sessionId;

async function mcpRequest(body) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  console.log(`→ Status: ${res.status}`);
  console.log(`→ Headers:`, Object.fromEntries(res.headers.entries()));

  // 检查响应头中的 session ID
  const returnedSession = res.headers.get("mcp-session-id");
  if (returnedSession && !sessionId) {
    sessionId = returnedSession;
    console.log(`→ Got session: ${sessionId}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  console.log("=== MCP HTTP Test ===\n");

  // 1. Initialize
  console.log("--- 1. Initialize ---");
  const initResult = await mcpRequest({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
    id: 1,
  });
  console.log("Result:", JSON.stringify(initResult, null, 2), "\n");

  // 2. Initialized notification
  console.log("--- 2. Send initialized notification ---");
  await mcpRequest({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  // 3. List tools
  console.log("--- 3. List Tools ---");
  const toolsResult = await mcpRequest({
    jsonrpc: "2.0",
    method: "tools/list",
    id: 2,
  });
  console.log("Result:", JSON.stringify(toolsResult, null, 2), "\n");

  if (toolsResult?.result?.tools) {
    console.log(`✅ 成功获取 ${toolsResult.result.tools.length} 个工具:`);
    toolsResult.result.tools.forEach((t) => console.log(`   - ${t.name}`));
  } else if (toolsResult?.error) {
    console.log(
      `❌ 错误: ${toolsResult.error.message} (code: ${toolsResult.error.code})`,
    );
  }
}

main().catch(console.error);
