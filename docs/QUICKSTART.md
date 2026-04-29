# Five-Minute Quickstart

This tutorial gets `CONTAM_plugin` running in an MCP host with the recommended `npx` setup.

## 1. Configure the MCP host

Use:

```text
command: npx
args: -y --package github:summer521521/CONTAM_plugin contam-mcp
```

If you need host-specific examples, see [Host Setup Guide](HOSTS.md).

## 2. Restart the host

After the host reloads its MCP configuration, open a new session.

## 3. Try a minimal workflow

Start with installation discovery:

```text
Call discover_contam_installation and confirm CONTAM is available.
```

List case files:

```text
List CONTAM case files in this folder.
```

Inspect a project:

```text
Inspect this PRJ file and summarize its references and date range.
```

Run a fast validation:

```text
Run a test input only check for this PRJ.
```

Ask for a ContamW-safe handoff:

```text
Make this PRJ safe for ContamW Building Check and result review.
```

Run the project:

```text
Run this PRJ and list the generated outputs.
```

Start bridge mode:

```text
Start a CONTAM bridge session for this project.
```

List zones:

```text
List the zones in the active bridge session.
```

Advance the simulation:

```text
Advance the active bridge session by 300 seconds and return path flow updates.
```

Close the session:

```text
Close the active bridge session.
```

## Optional: Link contam_chinese

If you want the plugin to use the localized executable package from `contam_chinese`, extract a release and run:

```powershell
.\scripts\link-contam-chinese.ps1 -Path "<extracted-contam-chinese-release>" -User
```

Restart the MCP host after setting the user environment variable.

## Optional: Local Clone Mode

If you prefer not to launch from GitHub each time, clone the repository and point the MCP host at:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <repo-root>\scripts\start-contam-plugin-mcp.ps1
```

## Common First Problems

- `npx` not found: install Node.js and confirm `npx --version` works.
- MCP host cannot start the server: verify that the host supports local `stdio` MCP servers.
- CONTAM executables not found: keep the default packaged layout or set `CONTAM_HOME`, `CONTAM_CHINESE_HOME`, or explicit tool paths.
- A project fails before simulation: run `test input only`, use `diagnose_contam_project`, or run `Invoke-ContamProjectGuard.ps1`.
