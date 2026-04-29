# Host Setup Guide

This guide shows how to connect `CONTAM_plugin` to common MCP hosts.

There are two supported connection styles:

1. `npx` launch from the GitHub repository
2. direct local path launch from a cloned repository

For most users, the `npx` option is the easiest.

## Recommended Public Setup: npx

Use this command shape:

```text
command: npx
args: -y --package github:summer521521/CONTAM_plugin contam-mcp
```

This tells the host to fetch the package from GitHub, install dependencies in the background, and launch the `contam-mcp` MCP server entry point.

## Codex Desktop / Codex Windows App

Recommended `npx` setup:

```toml
[mcp_servers.contam]
command = "npx"
args = ["-y", "--package", "github:summer521521/CONTAM_plugin", "contam-mcp"]
tool_timeout_sec = 300
```

For a UI-oriented walkthrough, see [Codex Windows App Setup](CODEX_WINDOWS_APP.md).

If you prefer a local clone, use:

```toml
[mcp_servers.contam]
command = "powershell.exe"
args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "<repo-root>\\scripts\\start-contam-plugin-mcp.ps1"]
tool_timeout_sec = 300
```

## Claude Code

Recommended `npx` setup:

```powershell
claude mcp add --transport stdio contam -- npx -y --package github:summer521521/CONTAM_plugin contam-mcp
```

On native Windows, Anthropic documents that `npx`-based local MCP servers may require `cmd /c`. If direct `npx` launch fails, use:

```powershell
claude mcp add --transport stdio contam -- cmd /c npx -y --package github:summer521521/CONTAM_plugin contam-mcp
```

Useful follow-up commands:

```powershell
claude mcp list
claude mcp get contam
```

## Claude Desktop

Recommended `npx` setup:

```json
{
  "mcpServers": {
    "contam": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--package", "github:summer521521/CONTAM_plugin", "contam-mcp"],
      "env": {}
    }
  }
}
```

If the host environment needs an explicit shell wrapper on Windows, use:

```json
{
  "mcpServers": {
    "contam": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package", "github:summer521521/CONTAM_plugin", "contam-mcp"],
      "env": {}
    }
  }
}
```

## Cursor

Recommended `npx` setup:

```json
{
  "mcpServers": {
    "contam": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--package", "github:summer521521/CONTAM_plugin", "contam-mcp"]
    }
  }
}
```

If you prefer a local clone instead:

```json
{
  "mcpServers": {
    "contam": {
      "type": "stdio",
      "command": "powershell.exe",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\path\\to\\CONTAM_plugin\\scripts\\start-contam-plugin-mcp.ps1"]
    }
  }
}
```

## Environment Variables

In the default repository layout, the packaged CLI can find the bundled CONTAM executables automatically.

If you want to point the server at another CONTAM installation, these variables are useful:

- `CONTAM_HOME`
- `CONTAM_CHINESE_HOME`
- `CONTAMX_PATH`
- `CONTAMW_PATH`
- `PRJUP_PATH`
- `SIMREAD_PATH`
- `SIMCOMP_PATH`

`CONTAM_CHINESE_HOME` should point to an extracted `contam_chinese` release folder that contains `contamw3.exe`, `contamx3.exe`, `prjup.exe`, `simread.exe`, `simcomp.exe`, and `olch2d32.dll`.

## Notes

- This repository is Windows-first because it bundles Windows CONTAM executables.
- The server does not depend on Codex-specific APIs.
- Hosts that do not support MCP, or cannot launch local `stdio` processes, will need an adapter layer before they can use this server.
- If this project is later published to npm, the command can become even shorter, for example `npx -y contam-plugin`.

## References

- [Anthropic Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp)
- [Cursor MCP Documentation](https://docs.cursor.com/en/advanced/model-context-protocol)
