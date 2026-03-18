# Host Setup Guide

This guide shows how to connect `CONTAM MCP` to common MCP hosts.

The server itself is a local `stdio` MCP server:

- command: `node`
- args: `<repo-root>\contam-mcp\src\server.js`

As long as a host can launch a local `stdio` process and speak MCP, it can use this server.

## Codex Desktop / Codex Windows App

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.contam]
command = "node"
args = ["<repo-root>\\contam-mcp\\src\\server.js"]
tool_timeout_sec = 300
```

Restart Codex after saving the file.

## Claude Code

Claude Code supports local `stdio` MCP servers through the `claude mcp add` command.

Example:

```powershell
claude mcp add --transport stdio contam -- node C:\path\to\contam-mcp\src\server.js
```

Useful follow-up commands:

```powershell
claude mcp list
claude mcp get contam
```

If you want the configuration stored at a specific scope, use Claude Code's `--scope` option as documented by Anthropic.

## Claude Desktop

Claude Desktop can also launch local `stdio` MCP servers through `claude_desktop_config.json`.

Example:

```json
{
  "mcpServers": {
    "contam": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\contam-mcp\\src\\server.js"],
      "env": {}
    }
  }
}
```

Restart Claude Desktop after saving the config.

## Cursor

Cursor supports local MCP servers through `mcp.json`.

Example:

```json
{
  "mcpServers": {
    "contam": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\contam-mcp\\src\\server.js"]
    }
  }
}
```

Cursor's MCP documentation also supports optional `env` and `envFile` fields if you want to pass explicit executable paths or other settings.

## Generic MCP Hosts

If your MCP host supports local `stdio` servers, point it at:

```text
command: node
args: <repo-root>\contam-mcp\src\server.js
```

If your host supports environment variables, these are the useful ones:

- `CONTAM_HOME`
- `CONTAMX_PATH`
- `CONTAMW_PATH`
- `PRJUP_PATH`
- `SIMREAD_PATH`
- `SIMCOMP_PATH`

## Notes

- This repository is Windows-first because it bundles Windows CONTAM executables.
- The server does not depend on Codex-specific APIs.
- Hosts that do not support MCP, or cannot launch local `stdio` processes, will need an adapter layer before they can use this server.

## References

- [Anthropic Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp)
- [Cursor MCP Documentation](https://docs.cursor.com/en/advanced/model-context-protocol)
