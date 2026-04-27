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
  const client = new Client({ name: "contam-regression-contamxpy", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);

    const discovered = await client.callTool({
      name: "discover_contam_api_stack",
      arguments: {}
    });
    assertCondition(!discovered.isError, "discover_contam_api_stack failed.");
    assertCondition(discovered.structuredContent.contamxpy.available, "Expected contamxpy to be available.");

    const inspected = await client.callTool({
      name: "inspect_contamxpy_project",
      arguments: {
        projectPath,
        maxEntities: 5,
        timeoutSeconds: 60
      }
    });
    assertCondition(!inspected.isError, "inspect_contamxpy_project failed.");
    assertCondition(inspected.structuredContent.counts.zones === 7, "Expected 7 zones in the cottage case.");
    assertCondition(inspected.structuredContent.counts.paths === 89, "Expected 89 paths in the cottage case.");

    const cosim = await client.callTool({
      name: "run_contamxpy_cosimulation",
      arguments: {
        projectPath,
        maxSteps: 2,
        sampleEverySteps: 1,
        zoneMassFractionRequests: [{ zoneNumber: 2, contaminantNumber: 1 }],
        pathFlowRequests: [1],
        outputControlValueRequests: [1],
        timeoutSeconds: 60
      }
    });
    assertCondition(!cosim.isError, "run_contamxpy_cosimulation failed.");
    assertCondition(cosim.structuredContent.samples.length >= 2, "Expected at least two samples.");
    assertCondition(
      cosim.structuredContent.samples.some((sample) => Array.isArray(sample.zoneMassFractions)),
      "Expected zone mass fraction samples."
    );

    return {
      projectPath,
      contamxpy: discovered.structuredContent.contamxpy.details,
      counts: inspected.structuredContent.counts,
      sampleCount: cosim.structuredContent.samples.length,
      firstSample: cosim.structuredContent.samples[0],
      final: cosim.structuredContent.final
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
      error: message
    }).catch(() => {});
    console.error(message);
    process.exitCode = 1;
  });
