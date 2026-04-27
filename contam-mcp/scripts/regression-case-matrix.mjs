import path from "node:path";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const serverPath = path.resolve(projectRoot, "contam-mcp", "src", "server.js");
const defaultProjectPath = path.resolve(projectRoot, "tmp", "nist-cases", "cottage", "cottage-dcv.prj");
const projectPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultProjectPath;
const outputDirectory = path.resolve(projectRoot, "tmp", "mcp-case-matrix-regression");
const projectBaseName = path.parse(projectPath).name;

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function writeReport(payload) {
  const configuredPath = process.env.CONTAM_REGRESSION_REPORT_PATH?.trim();
  if (!configuredPath) {
    return;
  }

  const reportPath = path.resolve(configuredPath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    cwd: projectRoot,
    stderr: "pipe"
  });
  const client = new Client({ name: "contam-regression-case-matrix", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);

    const matrix = await client.callTool({
      name: "run_contam_case_matrix",
      arguments: {
        baseProjectPath: projectPath,
        outputDirectory,
        overwrite: true,
        runSimulation: true,
        testInputOnly: true,
        timeoutSeconds: 60,
        cases: [
          { name: "baseline" },
          { name: "reference_check", runSimulation: false }
        ]
      }
    });
    assertCondition(!matrix.isError, "run_contam_case_matrix failed.");
    assertCondition(matrix.structuredContent.caseCount === 2, "Expected two generated cases.");
    assertCondition(matrix.structuredContent.ranSimulationCount === 1, "Expected one simulation run.");

    const baseline = matrix.structuredContent.results.find((item) => item.name === "baseline");
    assertCondition(baseline?.simulation?.exitCode === 0, "Expected baseline input-check run to exit 0.");
    assertCondition(
      baseline.simulation.fileChanges.modified.includes(`${projectBaseName}.xlog`) ||
        baseline.simulation.fileChanges.created.includes(`${projectBaseName}.xlog`),
      "Expected the baseline xlog to be created or modified."
    );

    const xlogPath = path.join(outputDirectory, "baseline", `${projectBaseName}.xlog`);
    const analysis = await client.callTool({
      name: "analyze_contam_text_results",
      arguments: {
        textPath: xlogPath,
        maxPreviewLines: 10
      }
    });
    assertCondition(!analysis.isError, "analyze_contam_text_results failed.");
    assertCondition(analysis.structuredContent.lineCount > 0, "Expected non-empty text analysis.");

    return {
      projectPath,
      outputDirectory,
      caseCount: matrix.structuredContent.caseCount,
      ranSimulationCount: matrix.structuredContent.ranSimulationCount,
      baselineExitCode: baseline.simulation.exitCode,
      baselineFileChanges: baseline.simulation.fileChanges,
      xlogLineCount: analysis.structuredContent.lineCount,
      xlogPreview: analysis.structuredContent.preview.slice(0, 5)
    };
  } finally {
    await client.close().catch(() => {});
  }
}

main()
  .then(async (summary) => {
    await writeReport({ ok: true, ...summary });
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch(async (error) => {
    const message = error.stack || error.message || String(error);
    await writeReport({
      ok: false,
      projectPath,
      outputDirectory,
      error: message
    }).catch(() => {});
    console.error(message);
    process.exitCode = 1;
  });
