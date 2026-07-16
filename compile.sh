#!/usr/bin/env bash
# 使用 esbuild 打包 TypeScript 为单个 JS 文件
# VS Code 任务可能设置了 npm_config_prefix，与 nvm 冲突
unset npm_config_prefix
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null 2>&1
node ./build.mjs
