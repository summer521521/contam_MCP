# Codex Windows App Setup

This guide shows how to add `CONTAM MCP` through the Codex Windows App MCP server UI.

## Recommended Setup

Use the GitHub-backed `npx` launcher.

Fill the form like this:

- **Server name**: `Contam MCP`
- **Launch command**: `npx`
- **Arguments**:
  - `-y`
  - `--package`
  - `github:summer521521/contam_MCP`
  - `contam-mcp`
- **Environment variables**: leave empty unless you want to point to another CONTAM installation
- **Pass-through environment variables**: leave empty
- **Working directory**: any stable local folder is fine; if you are unsure, use your normal code workspace

## Why This Is the Recommended Option

This setup:

- avoids hard-coding a local `server.js` path
- avoids asking users to manually clone the repository first
- keeps the connection flow close to a one-click install experience

## Optional Local Clone Setup

If you prefer to clone the repository and launch the server directly, fill the form like this:

- **Launch command**: `node`
- **Arguments**:
  - `<repo-root>\contam-mcp\src\server.js`
- **Environment variables**: optional
- **Pass-through environment variables**: leave empty
- **Working directory**: `<repo-root>`

## Optional CONTAM Environment Variables

If you want the server to use a different CONTAM installation instead of the bundled binaries, you can add one or more of these:

- `CONTAM_HOME`
- `CONTAMX_PATH`
- `CONTAMW_PATH`
- `PRJUP_PATH`
- `SIMREAD_PATH`
- `SIMCOMP_PATH`

## First Test Prompts

After saving the MCP server and restarting Codex, try:

- `Call discover_contam_installation and confirm CONTAM is available.`
- `List CONTAM case files in this folder.`
- `Inspect this PRJ file and summarize its references and date range.`
- `Run a test input only check for this PRJ.`

## Troubleshooting

- If `npx` is not found, install Node.js and confirm `npx --version` works in a terminal.
- If the server starts but cannot find CONTAM tools, keep the default repository layout or set explicit CONTAM environment variables.
- If you use the local clone setup, make sure the working directory points to the repository root rather than a generic folder.
