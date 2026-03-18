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
const defaultProjectPath = path.resolve(projectRoot, "tmp", "nist-cases", "medium-office", "MediumOffice.prj");
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
  const client = new Client({ name: "contam-regression-medium-office", version: "1.0.0" }, { capabilities: {} });
  let sessionId = null;

  try {
    await client.connect(transport);

    const started = await client.callTool({
      name: "start_contam_bridge_session",
      arguments: {
        projectPath,
        timeoutSeconds: 90
      }
    });
    assertCondition(!started.isError, "Failed to start the medium office bridge session.");
    sessionId = started.structuredContent.sessionId;

    const listed = await client.callTool({
      name: "list_contam_bridge_entities",
      arguments: {
        sessionId
      }
    });
    assertCondition(!listed.isError, "Failed to list bridge entities.");

    const entities = listed.structuredContent.entities;
    assertCondition(entities.zones.length === 39, `Expected 39 zones, got ${entities.zones.length}.`);
    assertCondition(entities.junctions.length === 6, `Expected 6 junctions, got ${entities.junctions.length}.`);
    assertCondition(entities.ambientTargets.length === 105, `Expected 105 ambient targets, got ${entities.ambientTargets.length}.`);
    assertCondition(entities.ahsSystems.length === 3, `Expected 3 AHS systems, got ${entities.ahsSystems.length}.`);
    assertCondition(
      entities.inputControlNodes.length === 3,
      `Expected 3 input control nodes, got ${entities.inputControlNodes.length}.`
    );
    assertCondition(
      entities.outputControlNodes.length === 4,
      `Expected 4 output control nodes, got ${entities.outputControlNodes.length}.`
    );
    const ambiguousOutdoorPlenumPath = entities.paths.find((item) => item.label === "Outdoor -> Plenum");
    assertCondition(!!ambiguousOutdoorPlenumPath?.selectorLabel, "Expected an ambiguous Outdoor -> Plenum path selector.");

    const firstAdvance = await client.callTool({
      name: "advance_contam_bridge_session",
      arguments: {
        sessionId,
        advanceBySeconds: 300,
        requestPathFlows: true,
        requestOutputControlValues: true,
        namedControlNodeAdjustments: [{ controlNodeName: "AHS1_FlowCntrl", value: 0.6 }],
        namedAhsPoaAdjustments: { names: ["1stFloor"], values: [0.3] },
        namedElementAdjustments: [
          {
            pathSelectorLabel: ambiguousOutdoorPlenumPath.selectorLabel,
            elementIndex: ambiguousOutdoorPlenumPath.elementIndex
          }
        ],
        namedJunctionTemperatureAdjustments: { junctionNames: ["Terminal 1"], values: [294.15] }
      }
    });
    assertCondition(!firstAdvance.isError, "First medium office advance failed.");
    assertCondition(
      firstAdvance.structuredContent.readyTimeSeconds === 300,
      `Expected first ready time to be 300, got ${firstAdvance.structuredContent.readyTimeSeconds}.`
    );
    assertCondition(
      firstAdvance.structuredContent.updates.some((item) => item.type === 130),
      "Expected PATH_FLOW_UPDATE during the first medium office advance."
    );
    assertCondition(
      firstAdvance.structuredContent.updates.some((item) => item.type === 180),
      "Expected CTRL_NODE_UPDATE during the first medium office advance."
    );

    const secondAdvance = await client.callTool({
      name: "advance_contam_bridge_session",
      arguments: {
        sessionId,
        advanceBySeconds: 300,
        requestPathFlows: true,
        namedAmbientPressureAdjustment: {
          ambientTargetNames: ["Ambient 103: terminal:1", "Ambient 1: Outdoor -> Plenum"],
          values: [5.0, 12.0],
          fillValue: 0
        }
      }
    });
    assertCondition(!secondAdvance.isError, "namedAmbientPressureAdjustment failed on the medium office case.");
    assertCondition(
      secondAdvance.structuredContent.readyTimeSeconds === 600,
      `Expected second ready time to be 600, got ${secondAdvance.structuredContent.readyTimeSeconds}.`
    );
    assertCondition(
      secondAdvance.structuredContent.updates.some((item) => item.type === 130),
      "Expected PATH_FLOW_UPDATE after medium office ambient pressure adjustment."
    );

    const thirdAdvance = await client.callTool({
      name: "advance_contam_bridge_session",
      arguments: {
        sessionId,
        advanceBySeconds: 300,
        requestConcentrations: true,
        namedAmbientConcentrationAdjustments: [
          {
            agentName: "CO2",
            ambientTargetNames: ["Ambient 103: terminal:1", "Ambient 1: Outdoor -> Plenum"],
            values: [0.0008, 0.0006],
            fillValue: 0.0004
          }
        ]
      }
    });
    assertCondition(!thirdAdvance.isError, "namedAmbientConcentrationAdjustments failed on the medium office case.");
    assertCondition(
      thirdAdvance.structuredContent.readyTimeSeconds === 900,
      `Expected third ready time to be 900, got ${thirdAdvance.structuredContent.readyTimeSeconds}.`
    );
    assertCondition(
      thirdAdvance.structuredContent.updates.some((item) => item.type === 120),
      "Expected CONC_UPDATE after medium office ambient concentration adjustment."
    );

    return {
      projectPath,
      sessionId,
      zoneCount: entities.zones.length,
      junctionCount: entities.junctions.length,
      ambientTargetCount: entities.ambientTargets.length,
      ahsCount: entities.ahsSystems.length,
      firstReadyTimeSeconds: firstAdvance.structuredContent.readyTimeSeconds,
      secondReadyTimeSeconds: secondAdvance.structuredContent.readyTimeSeconds,
      thirdReadyTimeSeconds: thirdAdvance.structuredContent.readyTimeSeconds,
      firstUpdateTypes: firstAdvance.structuredContent.updates.map((item) => item.type),
      secondUpdateTypes: secondAdvance.structuredContent.updates.map((item) => item.type),
      thirdUpdateTypes: thirdAdvance.structuredContent.updates.map((item) => item.type)
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
