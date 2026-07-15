#!/usr/bin/env bash
# 使用 nvm 管理的 arm64 Node.js 编译 TypeScript
# VS Code 任务可能设置了 npm_config_prefix，与 nvm 冲突
unset npm_config_prefix
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null 2>&1
node ./node_modules/typescript/lib/tsc.js "$@"
