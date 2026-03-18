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
  const client = new Client({ name: "contam-regression-cottage", version: "1.0.0" }, { capabilities: {} });
  let sessionId = null;

  try {
    await client.connect(transport);

    const started = await client.callTool({
      name: "start_contam_bridge_session",
      arguments: {
        projectPath,
        timeoutSeconds: 60
      }
    });
    assertCondition(!started.isError, "Failed to start the cottage bridge session.");
    sessionId = started.structuredContent.sessionId;

    const listed = await client.callTool({
      name: "list_contam_bridge_entities",
      arguments: {
        sessionId
      }
    });
    assertCondition(!listed.isError, "Failed to list bridge entities.");

    const entities = listed.structuredContent.entities;
    assertCondition(Array.isArray(entities.junctions) && entities.junctions.length > 0, "Expected non-empty junctions.");
    assertCondition(
      Array.isArray(entities.ambientTargets) && entities.ambientTargets.length > 0,
      "Expected non-empty ambient targets."
    );
    const ambiguousOutdoorKitPath = entities.paths.find((item) => item.label === "Outdoor -> kit");
    assertCondition(!!ambiguousOutdoorKitPath?.selectorLabel, "Expected an ambiguous Outdoor -> kit path selector.");

    const junctionAdvance = await client.callTool({
      name: "advance_contam_bridge_session",
      arguments: {
        sessionId,
        advanceBySeconds: 180,
        requestPathFlows: true,
        requestTermFlows: true,
        namedElementAdjustments: [
          {
            pathSelectorLabel: ambiguousOutdoorKitPath.selectorLabel,
            elementIndex: ambiguousOutdoorKitPath.elementIndex
          }
        ],
        namedJunctionTemperatureAdjustments: {
          junctionNames: ["Terminal 1", "Junction 4"],
          values: [294.15, 295.15]
        }
      }
    });
    assertCondition(!junctionAdvance.isError, "namedJunctionTemperatureAdjustments failed on the cottage case.");
    assertCondition(
      junctionAdvance.structuredContent.readyTimeSeconds === 180,
      `Expected first ready time to be 180, got ${junctionAdvance.structuredContent.readyTimeSeconds}.`
    );
    assertCondition(
      junctionAdvance.structuredContent.updates.some((item) => item.type === 140),
      "Expected TERM_FLOW_UPDATE after junction temperature adjustment."
    );

    const ambientAdvance = await client.callTool({
      name: "advance_contam_bridge_session",
      arguments: {
        sessionId,
        advanceBySeconds: 180,
        requestPathFlows: true,
        namedAmbientPressureAdjustment: {
          ambientTargetNames: ["Ambient 70: terminal:1", "Ambient 2: Outdoor -> attic"],
          values: [5.0, 12.0],
          fillValue: 0
        }
      }
    });
    assertCondition(!ambientAdvance.isError, "namedAmbientPressureAdjustment failed on the cottage case.");
    assertCondition(
      ambientAdvance.structuredContent.readyTimeSeconds === 360,
      `Expected second ready time to be 360, got ${ambientAdvance.structuredContent.readyTimeSeconds}.`
    );
    assertCondition(
      ambientAdvance.structuredContent.updates.some((item) => item.type === 130),
      "Expected PATH_FLOW_UPDATE after ambient pressure adjustment."
    );

    const concentrationAdvance = await client.callTool({
      name: "advance_contam_bridge_session",
      arguments: {
        sessionId,
        advanceBySeconds: 180,
        requestConcentrations: true,
        namedAmbientConcentrationAdjustments: [
          {
            agentName: "CO2",
            ambientTargetNames: ["Ambient 70: terminal:1", "Ambient 2: Outdoor -> attic"],
            values: [0.0008, 0.0006],
            fillValue: 0.0004
          }
        ]
      }
    });
    assertCondition(!concentrationAdvance.isError, "namedAmbientConcentrationAdjustments failed on the cottage case.");
    assertCondition(
      concentrationAdvance.structuredContent.readyTimeSeconds === 540,
      `Expected third ready time to be 540, got ${concentrationAdvance.structuredContent.readyTimeSeconds}.`
    );
    assertCondition(
      concentrationAdvance.structuredContent.updates.some((item) => item.type === 120),
      "Expected CONC_UPDATE after ambient concentration adjustment."
    );

    return {
      projectPath,
      sessionId,
      junctionCount: entities.junctions.length,
      ambientTargetCount: entities.ambientTargets.length,
      firstReadyTimeSeconds: junctionAdvance.structuredContent.readyTimeSeconds,
      secondReadyTimeSeconds: ambientAdvance.structuredContent.readyTimeSeconds,
      thirdReadyTimeSeconds: concentrationAdvance.structuredContent.readyTimeSeconds,
      junctionUpdateTypes: junctionAdvance.structuredContent.updates.map((item) => item.type),
      ambientUpdateTypes: ambientAdvance.structuredContent.updates.map((item) => item.type),
      concentrationUpdateTypes: concentrationAdvance.structuredContent.updates.map((item) => item.type)
    };
  } finally {
    if (sessionId) {
      await client.callTool({
        name: "close_contam_bridge_session",
        arguments: {
          sessionId
        }
      }).catch(() => {});
    }

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
