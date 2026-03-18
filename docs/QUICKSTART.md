# Five-Minute Quickstart

This tutorial gets `CONTAM MCP` running with a local MCP host and walks through a minimal first session.

## 1. Install the Node dependencies

```powershell
cd contam-mcp
npm install
```

## 2. Optional: run the privacy check

```powershell
npm run privacy:check
```

## 3. Connect the server to your MCP host

Use:

```text
command: node
args: <repo-root>\contam-mcp\src\server.js
```

If you need host-specific examples, see `docs/HOSTS.md`.

## 4. Restart the MCP host

After the host reloads its MCP configuration, open a new session.

## 5. Try a minimal workflow

Start with installation discovery:

```text
Call discover_contam_installation and confirm CONTAM is available.
```

List example project files:

```text
List CONTAM case files under tmp/nist-cases.
```

Inspect one project:

```text
Inspect tmp/nist-cases/cottage/cottage-dcv.prj and summarize its references and date range.
```

Run a fast validation:

```text
Run a test input only check for tmp/nist-cases/cottage/cottage-dcv.prj.
```

Run the project:

```text
Run tmp/nist-cases/cottage/cottage-dcv.prj and list the generated outputs.
```

Start bridge mode:

```text
Start a CONTAM bridge session for tmp/nist-cases/cottage/cottage-dcv.prj.
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

## 6. Run the official regression suite

If you want to verify the full repository setup:

```powershell
npm run regression:official
```

## Common First Problems

- `node` not found: install Node.js and confirm `node --version` works.
- MCP host cannot start the server: check the path to `src/server.js`.
- CONTAM executables not found: keep the default repository layout or set the explicit CONTAM environment variables.
- A project fails before simulation: run `test input only` or use `diagnose_contam_project` first.
