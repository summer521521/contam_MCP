# CONTAM MCP

`CONTAM MCP` is a Windows-focused MCP server that exposes CONTAM command-line tools and ContamX bridge-mode controls to AI agents.

This project is built for public use. It is not a private Codex helper or a local-only experiment. The goal is to make CONTAM operations accessible through a standard MCP tool surface so an agent can inspect projects, run simulations, diagnose broken cases, and drive bridge sessions.

## Compatibility

This server is not limited to Codex.

It should work with any MCP host or agent runtime that can:

- launch a local `stdio` MCP server
- run `node`
- call MCP tools

Codex Desktop / Codex Windows App is one supported host. Other MCP-capable agent shells or desktop clients can also use this server if they support local `stdio` servers.

The server entry point is:

```text
<repo-root>\contam-mcp\src\server.js
```

## What It Can Do

- discover bundled CONTAM executables
- find `.prj`, `.sim`, `.wth`, `.ctm`, and related files
- inspect project metadata and external file references
- diagnose broken project references
- update `.prj` file references
- run `contamx3.exe`
- upgrade old `.prj` files with `prjup.exe`
- compare `.sim` files with `simcomp.exe`
- export `simread` text output
- start, inspect, advance, and close ContamX bridge sessions
- adjust zones, junctions, ambient targets, AHS settings, and control nodes by ID or by name

## Five-Minute Quickstart

1. Clone or download this repository on Windows.

2. Install the Node dependencies.

```powershell
cd contam-mcp
npm install
```

3. Optionally run the repository privacy check before you publish or share changes.

```powershell
npm run privacy:check
```

4. Point your MCP host at the server entry point.

For Codex, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.contam]
command = "node"
args = ["<repo-root>\\contam-mcp\\src\\server.js"]
tool_timeout_sec = 300
```

For other MCP hosts, use the same command and argument pair:

```text
command: node
args: <repo-root>\contam-mcp\src\server.js
```

5. Restart your MCP host or agent app.

6. Try one of these prompts:

- `Call discover_contam_installation and confirm CONTAM is available.`
- `List CONTAM case files in this folder.`
- `Inspect this PRJ file and summarize its references and date range.`
- `Run a test input only check for this PRJ.`
- `Run this PRJ and list the generated outputs.`
- `Start a CONTAM bridge session for this project.`
- `List the zones in the active bridge session.`
- `Advance the active bridge session by 300 seconds and return path flow updates.`
- `Close the active bridge session.`

## Repository Layout

- `contam-mcp/`: server source, developer guide, and regression scripts
- `.github/workflows/`: GitHub Actions workflows
- repository root: bundled CONTAM executables and supporting DLLs

## Privacy and CI

This repository includes a privacy check that scans tracked files for personal filesystem paths before public sharing.

Run it locally with:

```powershell
cd contam-mcp
npm run privacy:check
```

GitHub Actions also runs this check automatically.

## Developer Documentation

If you want to extend the server, review the bridge protocol coverage, or run the official regression suite, see:

- `contam-mcp/README.md`
