# CONTAM MCP Developer Guide

This document is for maintainers and contributors.

If you only want to install and use the project, start with the [repository root README](../README.md). For host-specific setup, see the [Host Setup Guide](../docs/HOSTS.md). For a short first-run tutorial, see the [Five-Minute Quickstart](../docs/QUICKSTART.md). This file focuses on server internals, regression coverage, CI behavior, and the current tool surface.

The public `npx` entry point is defined by the repository root `package.json` and `bin/contam-mcp.js`. This subdirectory remains the main source and test area for the server implementation itself.

## Overview

This directory contains a local `stdio` MCP server that wraps the CONTAM executables bundled in the repository root.

Its implementation direction is aligned with the broader CONTAM API effort described by Dols, Shen, Polidoro, and coauthors, but this repository specifically packages a practical local MCP server around the currently usable CONTAM CLI and ContamX bridge surfaces.

The current server exposes stable, automation-friendly operations:

- `discover_contam_installation`
- `list_contam_case_files`
- `get_contam_program_help`
- `inspect_contam_project`
- `diagnose_contam_project`
- `update_contam_project_references`
- `start_contam_bridge_session`
- `get_contam_bridge_session`
- `list_contam_bridge_entities`
- `advance_contam_bridge_session`
- `close_contam_bridge_session`
- `run_contam_simulation`
- `upgrade_contam_project`
- `compare_contam_sim_results`
- `export_contam_sim_text`

## Design Choices

This server targets `ContamX`, `prjup`, `simcomp`, and `simread` rather than GUI automation for `contamw3.exe`.

That tradeoff is intentional:

- GUI automation is brittle.
- `contamx3.exe` and the related utilities already have stable command-line entry points.
- MCP calls to CLI tools are easier to reproduce, test, and debug than window-level automation.

The implementation is not Codex-specific. It is a standard `stdio` MCP server built on `@modelcontextprotocol/sdk`, so any MCP host that can launch a local Node process should be able to use it.

## Install

Run this inside `contam-mcp`:

```powershell
npm install
```

## Local Server Run

```powershell
node .\src\server.js
```

If startup succeeds, the process will wait for MCP traffic on `stdio`. It will not print an interactive menu.

## Regression Suite

The repository includes two real NIST regression cases:

```powershell
npm run regression:cottage
npm run regression:medium-office
```

Run both together with:

```powershell
npm run regression:official
```

The repository also includes a privacy check:

```powershell
npm run privacy:check
```

It scans tracked files for personal filesystem paths before public publication. GitHub Actions runs this check automatically.

## CI Workflow

The root workflow is:

- `.github/workflows/contam-mcp-regression.yml`

It currently does the following on Windows:

- verifies that the bundled CONTAM binaries exist
- installs `contam-mcp` dependencies
- runs the repository privacy check
- downloads the official NIST `cottage-dcv` and `MediumOffice` regression cases
- runs `npm run regression:official`
- uploads `tmp/ci-artifacts` with logs and JSON summaries

With the default repository layout, the official regressions use these relative paths:

- `tmp/nist-cases/cottage/cottage-dcv.prj`
- `tmp/nist-cases/medium-office/MediumOffice.prj`

The regressions verify these paths through the system:

- bridge sessions start successfully
- `junctions` and `ambientTargets` metadata are populated
- `namedJunctionTemperatureAdjustments` works on real duct terminals and junctions
- `namedAmbientPressureAdjustment` works on real ambient terminal and envelope targets
- `namedAmbientConcentrationAdjustments` works on real ambient target plus contaminant combinations
- advancing a session yields `PATH_FLOW_UPDATE` and `TERM_FLOW_UPDATE` responses

The `MediumOffice` regression adds coverage for:

- multiple input and output control nodes
- multiple AHS names
- a larger multi-zone, multi-contaminant model

## Codex Configuration Example

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.contam]
command = "node"
args = ["<repo-root>\\contam-mcp\\src\\server.js"]
tool_timeout_sec = 300
```

Restart Codex after updating the config.

The server looks for CONTAM executables in:

- `CONTAM_HOME`
- the parent directory of the server location
- the current working directory

If you move the server elsewhere, these optional variables can be set explicitly:

- `CONTAM_HOME`
- `CONTAMX_PATH`
- `CONTAMW_PATH`
- `PRJUP_PATH`
- `SIMREAD_PATH`
- `SIMCOMP_PATH`

## Tool Reference

### `discover_contam_installation`

Resolves the CONTAM executable paths that the server can currently see, plus version information for `contamx3.exe` and `prjup.exe` when available.

### `list_contam_case_files`

Scans a directory tree and lists common CONTAM file types such as `.prj`, `.sim`, `.wth`, and `.ctm`.

### `get_contam_program_help`

Reads the built-in help text for a CONTAM CLI program.

### `inspect_contam_project`

Parses a `.prj` file and returns:

- format header
- project title
- simulation date range
- selected section counts
- referenced weather, contaminant, WPC, and EWC files

### `diagnose_contam_project`

Checks why a project fails to run by reporting:

- which dependencies are referenced in the `.prj`
- whether those files exist in the project or working directory
- nearby candidate matches if a dependency is missing
- suggested relative paths that can be written back into the `.prj`

### `update_contam_project_references`

Updates these `.prj` references directly:

- `weatherFile`
- `contaminantFile`
- `continuousValuesFile`
- `discreteValuesFile`
- `wpcFile`
- `ewcFile`

By default it writes a `.mcp.bak` backup next to the original project.

### `run_contam_simulation`

Runs `contamx3.exe` and supports:

- normal simulation runs
- test-input-only runs
- custom `workingDirectory`
- bridge address
- bridge wind
- bridge volume flow

The tool returns:

- effective command-line arguments
- exit code
- `stdout` and `stderr`
- file changes in the project directory
- output files that match the project basename

### `start_contam_bridge_session`

Starts a persistent ContamX bridge-mode session and returns:

- `sessionId`
- initial `readyTimeSeconds`
- project metadata
- message types received during the startup handshake

### `get_contam_bridge_session`

Reads the current state of an active bridge session, including:

- project path
- current ready time
- zone, path, AHS, and related metadata
- `ambientTargets` ordering
- the last advance result

### `list_contam_bridge_entities`

Returns a shorter entity list for agent consumption. Supported categories include:

- `zones`
- `paths`
- `junctions`
- `elements`
- `inputControlNodes`
- `outputControlNodes`
- `ahsSystems`
- `ambientTargets`

`ambientTargets` include both:

- `label`: a readable label
- `selectorLabel`: a unique selector that includes the ambient index

`paths` include both:

- `label`: a readable label that may repeat
- `selectorLabel`: a unique selector that includes the path ID and element name

### `advance_contam_bridge_session`

This tool can:

- send control or weather adjustments
- advance ContamX to a target time
- request update messages

Currently supported adjustment inputs:

- `controlNodeAdjustments`
- `namedControlNodeAdjustments`
- `zoneConcentrationAdjustments`
- `namedZoneConcentrationAdjustments`
- `zoneTemperatureAdjustments`
- `namedZoneTemperatureAdjustments`
- `junctionTemperatureAdjustments`
- `namedJunctionTemperatureAdjustments`
- `zoneHumidityRatioAdjustments`
- `namedZoneHumidityRatioAdjustments`
- `elementAdjustments`
- `namedElementAdjustments`
- `weatherAdjustment`
- `namedAmbientPressureAdjustment`
- `namedAmbientConcentrationAdjustments`
- `wpcAdjustment`
- `ahspFlowAdjustments`
- `ahsPoaAdjustments`
- `namedAhsPoaAdjustments`

Name-based lookup currently supports:

- zones via `zoneName`
- junctions via generated labels such as `Junction 1` and `Terminal 2`
- input control nodes via `controlNodeName`
- airflow elements via `elementName`
- AHS systems via `ahsName`
- paths via `fromZoneName` and `toZoneName`
- paths via `pathSelectorLabel`

Name resolution rules are:

- normalized exact match first
- then unique substring match
- otherwise an ambiguity error with candidates

For path selection, `fromZoneName` and `toZoneName` also accept these outdoor aliases:

- `Outdoor`
- `outside`
- `ambient`

For `ambientTargets`, prefer `selectorLabel` because labels such as `Outdoor -> Attic` may repeat while `Ambient 1: Outdoor -> Attic` is unique.

For ambient concentration writes, the high-level interface is organized as one message per contaminant. If multiple contaminants need different ambient boundary values, send a `namedAmbientConcentrationAdjustments` array with one object per `agentName` or `agentId`.

Representative inputs:

- `namedZoneTemperatureAdjustments: { zoneNames: ["Kitchen"], values: [295.15] }`
- `namedJunctionTemperatureAdjustments: { junctionNames: ["Terminal 2"], values: [294.15] }`
- `namedAmbientPressureAdjustment: { ambientTargetNames: ["Ambient 9: Outdoor -> Kitchen"], values: [12.0], fillValue: 0 }`
- `namedAmbientConcentrationAdjustments: [{ agentName: "CO2", ambientTargetNames: ["Ambient 70: terminal:1"], values: [0.0008], fillValue: 0.0004 }]`
- `namedElementAdjustments: [{ pathSelectorLabel: "Path 21: Outdoor -> Kitchen [WallExt]", elementIndex: 5 }]`
- `namedElementAdjustments: [{ fromZoneName: "LivingDining", toZoneName: "Kitchen", elementName: "WallInt" }]`
- `namedAhsPoaAdjustments: { names: ["main"], values: [0.25] }`

Currently supported update requests include:

- concentration updates
- path flow updates
- AHSP flow updates
- duct flow updates
- leak flow updates
- output control node updates

### `close_contam_bridge_session`

Closes the bridge session and releases the ContamX process plus local socket.

### `upgrade_contam_project`

Runs `prjup.exe` to upgrade older `.prj` files.

### `compare_contam_sim_results`

Runs `simcomp.exe` to compare two `.sim` files.

### `export_contam_sim_text`

Runs `simread.exe` and exports a `.sim` file to text.

`simread` is interactive by default, so MCP callers must provide either:

- `responsesText`
- `responsesFilePath`

Equivalent CLI pattern:

```powershell
simread mycase.sim < responses.txt
```

## Current Limitations

- `contamw3.exe` GUI automation is not implemented.
- `simread` response scripts still depend on CONTAM's own prompt flow.
- bridge mode does not yet cover every possible coupling message
- junctions do not carry original ContamW names, so junction control currently uses generated labels such as `Junction N` and `Terminal N`
- bridge metadata is optimized for practical use, not for a complete field-by-field mirror of the official protocol

## Good Next Steps

If you want to extend the server, the next high-value areas are:

1. more bridge-mode adjustment messages
2. reusable `simread` export templates
3. finer-grained `.prj` editing tools
4. project packaging and transfer utilities

## References

- [NIST CONTAM Documentation Page](https://www.nist.gov/el/beed/nist-multizone-modeling/software/contam/contam-documentation)
- [Dols, Shen, Polidoro, et al. "Development and Application of CONTAM APIs" (Building Simulation, 2026)](https://doi.org/10.1007/s12273-025-1376-x)
- [CONTAM User Guide and Program Documentation Version 3.4 (NIST TN 1887r1)](https://doi.org/10.6028/NIST.TN.1887r1)
