# contam_chinese Linkage

`CONTAM_plugin` and [`contam_chinese`](https://github.com/summer521521/contam_chinese) are complementary projects.

- `CONTAM_plugin` provides MCP automation, Codex workflow guidance, project checks, scenario runs, bridge sessions, and result triage.
- `contam_chinese` provides an unofficial Chinese-localized CONTAM distribution and Chinese help package through GitHub Releases.

## When To Link Them

Link `contam_chinese` when you want:

- localized `contamw3.exe` for manual GUI work
- Chinese `ContamHelp.chm`
- the same localized executable folder to be used by agent-driven simulations

Keep `CONTAM_plugin` as the automation entry point.

## Setup

1. Download a release package from `contam_chinese`.
2. Extract it to a stable folder.
3. From a local `CONTAM_plugin` clone, run:

```powershell
.\scripts\link-contam-chinese.ps1 -Path "<extracted-contam-chinese-release>" -User
```

4. Restart the MCP host.

For a one-session setup, omit `-User`:

```powershell
.\scripts\link-contam-chinese.ps1 -Path "<extracted-contam-chinese-release>"
```

## Resolution Order

The launcher and guard scripts resolve executables in this order:

1. explicit tool overrides such as `CONTAMX_PATH`
2. `CONTAM_HOME`
3. `CONTAM_CHINESE_HOME`
4. executables bundled in `CONTAM_plugin`
5. `contamx3.exe` on `PATH`, for guard-only checks

## Notes

- Do not commit extracted release folders, logs, case outputs, or personal local paths.
- Keep case-specific inputs in case folders, not in either public repository.
- Use `contam_chinese` releases for the localized GUI package and `CONTAM_plugin` for automation workflows.
