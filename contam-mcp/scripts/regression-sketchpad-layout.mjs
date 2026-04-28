import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const serverPath = path.resolve(projectRoot, "contam-mcp", "src", "server.js");
const sourceProjectPath = path.resolve(projectRoot, "tmp", "nist-cases", "cottage", "cottage-dcv.prj");
const workDirectory = path.resolve(projectRoot, "tmp", "mcp-sketchpad-layout-regression");
const projectPath = path.join(workDirectory, "cottage-dcv.prj");

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(workDirectory, { recursive: true });
  await copyFile(sourceProjectPath, projectPath);

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    cwd: projectRoot,
    stderr: "pipe"
  });
  const client = new Client({ name: "contam-regression-sketchpad-layout", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);

    const applied = await client.callTool({
      name: "apply_contam_sketchpad_layout",
      arguments: {
        projectPath,
        createBackup: true,
        layout: {
          sketchpadRows: 64,
          sketchpadCols: 96,
          scale: 0.25,
          originRow: 54,
          originCol: 7,
          cleanDisplay: true,
          levels: [
            {
              id: 1,
              name: "first",
              rooms: [
                { zoneId: 2, polygon: [{ col: 8, row: 10 }, { col: 24, row: 10 }, { col: 24, row: 28 }, { col: 8, row: 28 }] },
                { zoneId: 3, left: 24, top: 10, right: 46, bottom: 28 },
                { zoneId: 4, left: 8, top: 28, right: 24, bottom: 46 },
                { zoneId: 5, left: 24, top: 28, right: 46, bottom: 46 },
                { zoneId: 6, left: 48, top: 10, right: 56, bottom: 22 },
                { zoneId: 7, left: 48, top: 28, right: 56, bottom: 40 }
              ]
            },
            {
              id: 2,
              name: "attic",
              rooms: [
                { zoneId: 1, left: 8, top: 10, right: 56, bottom: 46 }
              ]
            }
          ]
        }
      }
    });
    assertCondition(!applied.isError, "apply_contam_sketchpad_layout returned an MCP error.");
    assertCondition(applied.structuredContent.counts.generatedIcons >= 100, "Expected generated SketchPad icons.");
    assertCondition(applied.structuredContent.backupCreated === true, "Expected an in-place backup to be created.");
    assertCondition(applied.structuredContent.displayOptions.cleanDisplay === true, "Expected clean display defaults.");
    assertCondition(applied.structuredContent.displayOptions.showGeometry === false, "Expected clean display to hide pseudo-geometry.");
    assertCondition(applied.structuredContent.displayOptions.unplacedPathMode === "palette", "Expected clean display to use a palette.");

    const inspected = await client.callTool({
      name: "inspect_contam_project",
      arguments: {
        projectPath
      }
    });
    assertCondition(!inspected.isError, "inspect_contam_project failed after applying layout.");
    assertCondition(inspected.structuredContent.counts.levels === 3, "Expected the cottage project to keep three levels.");

    const simulated = await client.callTool({
      name: "run_contam_simulation",
      arguments: {
        projectPath,
        workingDirectory: workDirectory,
        testInputOnly: true,
        timeoutSeconds: 60
      }
    });
    assertCondition(!simulated.isError, "run_contam_simulation returned an MCP error.");
    assertCondition(simulated.structuredContent.ok, "ContamX test-input-only run failed.");

    const projectText = await readFile(projectPath, "utf8");
    assertCondition(projectText.includes("!icn col row  #"), "Expected SketchPad icon comments in the rewritten PRJ.");
    assertCondition(projectText.includes("  23"), "Expected airflow path icons in the rewritten PRJ.");
    assertCondition(projectText.includes("2.500e-1 0 54 7 0 0"), "Expected pseudo-geometry to be hidden in the rewritten PRJ.");

    return {
      projectPath,
      generatedIcons: applied.structuredContent.counts.generatedIcons,
      levelSummaries: applied.structuredContent.levelSummaries,
      simulationExitCode: simulated.structuredContent.exitCode,
      generatedArtifacts: simulated.structuredContent.artifacts.map((item) => item.name)
    };
  } finally {
    await client.close().catch(() => {});
  }
}

main()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
