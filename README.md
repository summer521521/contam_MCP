# CONTAM MCP

一个面向 Windows 的 MCP server，让 Codex Desktop / Codex Windows App 可以直接调用 CONTAM。

这个仓库的目标不是自动点 `contamw3.exe` 的界面，而是把更稳定、可自动化的 CONTAM 能力封装成 MCP 工具，包括：

- 查找 CONTAM 安装和案例文件
- 检查、诊断、修复 `.prj` 引用
- 运行 `contamx3.exe` 模拟
- 升级旧版项目
- 比较 `.sim` 结果
- 导出 `simread` 文本结果
- 启动 ContamX bridge session，按时间步推进并调整 zone、junction、ambient、AHS、control node 等对象

## 适合谁

- 想在 Codex 里直接操作 CONTAM 的研究者
- 想批量跑案例、做参数扫描、做自动化联调的使用者
- 想把 CONTAM 接入 AI 工作流或 MCP 工具链的开发者

## 快速开始

1. 克隆或下载这个仓库
2. 进入 `contam-mcp` 目录并安装依赖

```powershell
cd contam-mcp
npm install
```

3. 把下面这段加到 Codex 配置文件 `~/.codex/config.toml`

```toml
[mcp_servers.contam]
command = "node"
args = ["<repo-root>\\contam-mcp\\src\\server.js"]
tool_timeout_sec = 300
```

4. 重启 Codex Desktop / Codex Windows App

## 上手示例

把 server 接好后，可以直接在 Codex 里说这些话：

- `调用 discover_contam_installation，看一下 CONTAM 有没有接好`
- `列出当前目录里的 CONTAM 案例文件`
- `检查这个 prj 的项目结构`
- `对这个 prj 做 test input only 检查`
- `运行这个 prj`
- `启动一个 CONTAM bridge session`
- `列出这个 session 里的 zones`
- `把这个 session 推进 300 秒，并返回 path flow updates`
- `关闭这个 bridge session`

## 仓库结构

- `contam-mcp/`: MCP server 源码、开发文档和回归脚本
- `.github/workflows/`: GitHub Actions
- 仓库根目录：CONTAM 可执行文件和依赖 DLL

## 隐私与公开仓库

这个仓库带了隐私检查脚本，公开推送前可以先运行：

```powershell
cd contam-mcp
npm run privacy:check
```

GitHub Actions 也会自动执行这一步，用来拦截误提交的本机绝对路径和用户目录信息。

## 开发与维护

如果你是要修改 server、跑官方回归、看 bridge 协议细节或维护 CI，请看：

- `contam-mcp/README.md`
