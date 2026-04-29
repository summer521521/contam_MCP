# Codex Windows App Setup

This guide shows how to add `CONTAM_plugin` through the Codex Windows App MCP server UI.

## Recommended npx Setup

Add a local MCP server with:

- command: `npx`
- args:
  - `-y`
  - `--package`
  - `github:summer521521/CONTAM_plugin`
  - `contam-mcp`

Restart Codex after saving the MCP server.

## Local Clone Setup

If you cloned this repository, use:

- command: `powershell.exe`
- args:
  - `-NoProfile`
  - `-ExecutionPolicy`
  - `Bypass`
  - `-File`
  - `<repo-root>\scripts\start-contam-plugin-mcp.ps1`

## Optional contam_chinese Link

If you want Codex to use localized executables from `contam_chinese`, extract a release package and run:

```powershell
.\scripts\link-contam-chinese.ps1 -Path "<extracted-contam-chinese-release>" -User
```

Restart Codex after setting `CONTAM_CHINESE_HOME`.

## Smoke Test

In a new Codex session, ask:

```text
Call discover_contam_installation and confirm CONTAM is available.
```

Then try:

```text
Make this PRJ safe for ContamW Building Check and result review.
```

The second prompt should use the workflow skill and the project guard script when a PRJ path is provided.
