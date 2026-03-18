# CONTAM MCP

`CONTAM MCP` is a Windows-first MCP server that exposes CONTAM command-line tools and ContamX bridge-mode controls to AI agents.

The project is designed for public use. It packages stable CONTAM automation workflows behind a standard MCP tool surface so an agent can inspect projects, diagnose broken inputs, run simulations, compare outputs, and drive bridge sessions over time.

The design is informed by the CONTAM API direction described in the Building Simulation paper "Development and Application of CONTAM APIs" and by the official ContamX documentation and bridge protocol materials from NIST.

## Why This Project Exists

CONTAM is powerful, but most automation workflows still start from desktop usage patterns or manual case handling. This repository turns the practical parts of the CONTAM toolchain into an MCP server so agents can:

- inspect `.prj` models before running them
- catch missing weather or support-file references
- run `contamx3.exe` and collect outputs
- compare `.sim` files
- export `simread` text
- control ContamX bridge-mode sessions step by step

## Host Compatibility

This server is not Codex-only.

Any host that can launch a local `stdio` MCP server should be able to use it. Confirmed target hosts documented in this repository include:

- Codex Desktop / Codex Windows App
- Claude Code
- Claude Desktop
- Cursor
- other MCP-capable local hosts

Host-specific setup examples are in:

- [Host Setup Guide](docs/HOSTS.md)

## Easiest Connection Option

For public users, the easiest setup is now an `npx`-launched local server sourced from this repository.

Use:

```text
command: npx
args: -y --package github:summer521521/contam_MCP contam-mcp
```

This avoids manually pointing a host at a local `server.js` path.

## Main Capabilities

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

1. Configure your MCP host to run `npx -y --package github:summer521521/contam_MCP contam-mcp`.
2. Restart the host.
3. Ask the host to inspect or run a sample `.prj`.

If you prefer a local clone, that path is still supported and documented in the host guide.

For the full step-by-step tutorial, see:

- [Five-Minute Quickstart](docs/QUICKSTART.md)

## Example Prompts

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

- `contam-mcp/`: MCP server source, developer guide, and regression scripts
- `docs/`: public quickstart and host setup guides
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

## References

- [NIST CONTAM Download Page](https://www.nist.gov/el/beed/nist-multizone-modeling/software/contam/download-contam)
- [NIST CONTAM Documentation Page](https://www.nist.gov/el/beed/nist-multizone-modeling/software/contam/contam-documentation)
- [Dols, Shen, Polidoro, et al. "Development and Application of CONTAM APIs" (Building Simulation, 2026)](https://doi.org/10.1007/s12273-025-1376-x)
- [CONTAM User Guide and Program Documentation Version 3.4 (NIST TN 1887r1)](https://doi.org/10.6028/NIST.TN.1887r1)
- [Host Setup Guide](docs/HOSTS.md)

## For Maintainers

If you want to extend the server, review bridge protocol coverage, or run the official regression suite, start here:

- [Developer Guide](contam-mcp/README.md)
