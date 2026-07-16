/**
 * BigeSQL - esbuild 构建脚本
 *
 * 将 TypeScript 源文件和 JS 依赖打包成单个 JS 文件，
 * 原生模块（better-sqlite3, dmdb, oracledb 等）标记为 external。
 */
import * as esbuild from "esbuild";

/** 原生模块列表 — 这些不能/不需要被 esbuild 打包 */
const NATIVE_EXTERNALS = [
  "better-sqlite3",
  "dmdb",
  "oracledb",
  "mssql",
  "mysql2",
  "pg",
  "pg-native",
  "pg-cloudflare",
];

/** VS Code API 始终 external */
const VSCODE_EXTERNAL = ["vscode"];

const sharedConfig = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  external: [...NATIVE_EXTERNALS, ...VSCODE_EXTERNAL],
};

async function main() {
  // ── 1. Extension 入口 ──
  await esbuild.build({
    ...sharedConfig,
    entryPoints: ["src/extension.ts"],
    outfile: "out/src/extension.js",
    banner: {
      js: "",
    },
  });
  console.log("✅ out/src/extension.js");

  // ── 2. MCP Server 入口 ──
  await esbuild.build({
    ...sharedConfig,
    entryPoints: ["src/server.ts"],
    outfile: "out/src/server.js",
    banner: {
      js: "#!/usr/bin/env node",
    },
  });
  console.log("✅ out/src/server.js");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
