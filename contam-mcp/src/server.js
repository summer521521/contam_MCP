import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, copyFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..");

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_LIST_RESULTS = 500;
const BRIDGE_PROTOCOL_VERSION = 10;
const BRIDGE_HEADER_LENGTH = 20;
const BRIDGE_HEADER_LABEL = "ACATMSG";
const BRIDGE_HOST = "127.0.0.1";
const DEFAULT_CASE_EXTENSIONS = [
  ".prj",
  ".sim",
  ".ach",
  ".abw",
  ".zaa",
  ".zbw",
  ".cbw",
  ".cex",
  ".cso",
  ".ebw",
  ".eeb",
  ".wth",
  ".ctm",
  ".log",
  ".txt"
];

const OUTDOOR_ZONE_ALIASES = new Set([
  "0",
  "outdoor",
  "outdoors",
  "outside",
  "ambient",
  "exterior",
  "室外",
  "室外空气",
  "室外环境"
]);

const projectReferenceDescriptors = [
  { key: "weatherFile", commentLabel: "weather file" },
  { key: "contaminantFile", commentLabel: "contaminant file" },
  { key: "continuousValuesFile", commentLabel: "continuous values file" },
  { key: "discreteValuesFile", commentLabel: "discrete values file" },
  { key: "wpcFile", commentLabel: "wpc file" },
  { key: "ewcFile", commentLabel: "ewc file" }
];

const bridgeMessageTypes = {
  CX_READY: 0,
  BLDG_INFO: 1,
  SIMPARM_INFO: 2,
  AGENT_INFO: 3,
  ELEMENT_INFO: 4,
  INPUT_CTRL_INFO: 5,
  OUTPUT_CTRL_INFO: 6,
  AHSP_INFO: 7,
  ZONE_INFO: 8,
  PATH_INFO: 9,
  JCT_INFO: 10,
  TERM_INFO: 11,
  LEAK_INFO: 12,
  DUCT_INFO: 13,
  AHS_INFO: 14,
  CX_ADVANCE: 20,
  ADJ_ZONE_CONC: 30,
  ADJ_ZONE_TEMP: 40,
  ADJ_JCT_TEMP: 50,
  ADJ_ELEMENT: 60,
  ADJ_CONTROL_NODE: 70,
  ADJ_WTH: 80,
  ADJ_WPC: 90,
  ADJ_AHSP_FLOWS: 100,
  ADJ_AHS_POA: 110,
  CONC_UPDATE: 120,
  PATH_FLOW_UPDATE: 130,
  TERM_FLOW_UPDATE: 140,
  AHSP_FLOW_UPDATE: 150,
  DUCT_FLOW_UPDATE: 160,
  LEAK_FLOW_UPDATE: 170,
  CTRL_NODE_UPDATE: 180,
  ADJ_ZONE_HR: 190,
  CX_ERROR: 200
};

const bridgeSessions = new Map();

const programDefinitions = {
  contamx: {
    exe: "contamx3.exe",
    envVar: "CONTAMX_PATH",
    helpArgs: ["-h"],
    versionArgs: ["-v"]
  },
  contamw: {
    exe: "contamw3.exe",
    envVar: "CONTAMW_PATH",
    helpArgs: [],
    versionArgs: []
  },
  prjup: {
    exe: "prjup.exe",
    envVar: "PRJUP_PATH",
    helpArgs: ["-h"],
    versionArgs: ["-v"]
  },
  simread: {
    exe: "simread.exe",
    envVar: "SIMREAD_PATH",
    helpArgs: [],
    versionArgs: []
  },
  simcomp: {
    exe: "simcomp.exe",
    envVar: "SIMCOMP_PATH",
    helpArgs: [],
    versionArgs: []
  }
};

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

function asAbsolutePath(inputPath, baseDirectory = process.cwd()) {
  return path.normalize(path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDirectory, inputPath));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function resolveContamHome() {
  const envHome = process.env.CONTAM_HOME ? asAbsolutePath(process.env.CONTAM_HOME) : null;
  const candidates = unique([envHome, workspaceRoot, process.cwd()]);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (await fileExists(path.join(candidate, "contamx3.exe"))) {
      return candidate;
    }
  }

  return envHome ?? workspaceRoot;
}

async function resolveExecutable(programKey) {
  const definition = programDefinitions[programKey];
  if (!definition) {
    throw new Error(`Unknown program '${programKey}'.`);
  }

  const override = process.env[definition.envVar];
  if (override) {
    const overridePath = asAbsolutePath(override);
    if (await fileExists(overridePath)) {
      return overridePath;
    }
    throw new Error(`Environment variable ${definition.envVar} points to a missing file: ${overridePath}`);
  }

  const contamHome = await resolveContamHome();
  const candidates = unique([
    path.join(contamHome, definition.exe),
    path.join(workspaceRoot, definition.exe),
    path.join(process.cwd(), definition.exe)
  ]);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find ${definition.exe}. Set ${definition.envVar} or CONTAM_HOME to the directory containing the CONTAM executables.`
  );
}

function toolResponse(summary, payload) {
  return {
    content: [
      {
        type: "text",
        text: `${summary}\n\n${JSON.stringify(payload, null, 2)}`
      }
    ],
    structuredContent: {
      summary,
      ...payload
    }
  };
}

async function runProcess(executablePath, args, options = {}) {
  const timeoutMs = Math.max(1, options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  const cwd = options.cwd ?? path.dirname(executablePath);
  const stdinText = options.stdinText ?? null;

  return await new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: "pipe"
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode: exitCode ?? -1,
        signal: signal ?? null,
        timedOut,
        stdout: normalizeText(stdout),
        stderr: normalizeText(stderr)
      });
    });

    if (stdinText !== null) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}

async function snapshotDirectory(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const snapshot = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolutePath = path.join(directoryPath, entry.name);
    const info = await stat(absolutePath);
    snapshot.set(entry.name, `${info.size}:${info.mtimeMs}`);
  }

  return snapshot;
}

function diffSnapshots(before, after) {
  const created = [];
  const modified = [];
  const deleted = [];

  for (const [name, signature] of after.entries()) {
    if (!before.has(name)) {
      created.push(name);
      continue;
    }
    if (before.get(name) !== signature) {
      modified.push(name);
    }
  }

  for (const name of before.keys()) {
    if (!after.has(name)) {
      deleted.push(name);
    }
  }

  return {
    created: created.sort(),
    modified: modified.sort(),
    deleted: deleted.sort()
  };
}

async function collectProjectArtifacts(projectPath) {
  const projectDirectory = path.dirname(projectPath);
  const projectBaseName = path.parse(projectPath).name;
  const entries = await readdir(projectDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => {
      if (!entry.isFile()) {
        return false;
      }
      const entryName = entry.name.toLowerCase();
      const projectName = projectBaseName.toLowerCase();
      return (
        entryName === `${projectName}.prj` ||
        entryName === `${projectName}.sim` ||
        entryName.startsWith(`${projectName}_`) ||
        path.parse(entryName).name === projectName
      );
    })
    .map((entry) => path.join(projectDirectory, entry.name))
    .sort();
}

async function readProjectLines(projectPath) {
  const text = await readFile(projectPath, { encoding: "utf8" });
  return text.replace(/\r\n/g, "\n").split("\n");
}

function splitCommentLine(line) {
  const commentIndex = line.indexOf("!");
  if (commentIndex === -1) {
    return {
      valuePart: line.trim(),
      commentPart: ""
    };
  }

  return {
    valuePart: line.slice(0, commentIndex).trim(),
    commentPart: line.slice(commentIndex + 1).trim()
  };
}

function parseSectionCount(lines, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^(\\d+)\\s+!\\s*${escapedLabel}:\\s*$`, "i");

  for (const line of lines) {
    const match = line.trim().match(matcher);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function parseDateRange(lines) {
  const index = lines.findIndex((line) => line.includes("!date_st"));
  if (index === -1 || !lines[index + 1]) {
    return null;
  }

  const tokens = lines[index + 1].trim().split(/\s+/);
  if (tokens.length < 8) {
    return null;
  }

  return {
    dateStart: tokens[0],
    timeStart: tokens[1],
    zeroDate: tokens[2],
    zeroTime: tokens[3],
    endDate: tokens[4],
    endTime: tokens[5],
    timeStep: tokens[6],
    listInterval: tokens[7],
    screenInterval: tokens[8] ?? null
  };
}

function inspectContamProjectLines(lines) {
  const references = {};

  for (const descriptor of projectReferenceDescriptors) {
    references[descriptor.key] = {
      value: null,
      comment: null,
      lineNumber: null
    };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const { valuePart, commentPart } = splitCommentLine(line);
    const normalizedComment = commentPart.toLowerCase();

    for (const descriptor of projectReferenceDescriptors) {
      const expected = descriptor.commentLabel;
      if (
        normalizedComment === expected ||
        normalizedComment === `no ${expected}`
      ) {
        references[descriptor.key] = {
          value: valuePart && valuePart.toLowerCase() !== "null" ? valuePart : null,
          comment: commentPart,
          lineNumber: index + 1
        };
      }
    }
  }

  return {
    formatLine: lines[0]?.trim() || null,
    title: lines[1]?.trim() || null,
    totalLines: lines.length,
    references,
    dateRange: parseDateRange(lines),
    counts: {
      contaminants: parseSectionCount(lines, "contaminants"),
      species: parseSectionCount(lines, "species"),
      levels: parseSectionCount(lines, "levels plus icon data"),
      daySchedules: parseSectionCount(lines, "day-schedules"),
      weekSchedules: parseSectionCount(lines, "week-schedules"),
      windPressureProfiles: parseSectionCount(lines, "wind pressure profiles")
    },
    preview: lines.slice(0, 20)
  };
}

async function inspectContamProject(projectPath) {
  const lines = await readProjectLines(projectPath);
  return {
    projectPath,
    projectDirectory: path.dirname(projectPath),
    ...inspectContamProjectLines(lines)
  };
}

async function findFilesByBasename(rootDirectory, basename, maxMatches = 5) {
  const matches = [];
  const stack = [rootDirectory];
  const expected = basename.toLowerCase();

  while (stack.length > 0 && matches.length < maxMatches) {
    const currentDirectory = stack.pop();
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name.toLowerCase() === expected) {
        matches.push(absolutePath);
        if (matches.length >= maxMatches) {
          break;
        }
      }
    }
  }

  return matches.sort();
}

function buildReferenceLine(existingLine, commentPart, newValue) {
  const leadingWhitespace = existingLine.match(/^\s*/)?.[0] ?? "";
  const valueText = newValue ?? "null";
  return `${leadingWhitespace}${valueText} ! ${commentPart}`;
}

function buildIndexedFloatAdjustment(ids, values) {
  if (!Array.isArray(ids) || !Array.isArray(values) || ids.length !== values.length) {
    throw new Error("Adjustment message requires matching ids[] and values[] arrays.");
  }

  return Buffer.concat([
    writeIntArray([ids.length]),
    writeIntArray(ids),
    writeFloatArray(values)
  ]);
}

function buildAmbientTargets(metadata) {
  const targets = [];

  for (const pathInfo of metadata.paths ?? []) {
    if ((pathInfo.ambientIndex ?? 0) > 0) {
      targets.push({
        ambientIndex: pathInfo.ambientIndex,
        kind: "path",
        id: pathInfo.id
      });
    }
  }

  for (const ahspInfo of metadata.ahspPaths ?? []) {
    if ((ahspInfo.ambientIndex ?? 0) > 0) {
      targets.push({
        ambientIndex: ahspInfo.ambientIndex,
        kind: "ahsp",
        id: ahspInfo.id
      });
    }
  }

  for (const terminalInfo of metadata.terminals ?? []) {
    if ((terminalInfo.ambientIndex ?? 0) > 0) {
      targets.push({
        ambientIndex: terminalInfo.ambientIndex,
        kind: "terminal",
        id: terminalInfo.id
      });
    }
  }

  return targets.sort((a, b) => a.ambientIndex - b.ambientIndex);
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

function formatAvailableNames(collection, getName, maxItems = 8) {
  const names = collection
    .map((item) => getName(item))
    .filter((item) => item && String(item).trim().length > 0)
    .slice(0, maxItems);

  return names.join(", ");
}

function buildLookupEntries(collection, getName, getDebugLabel) {
  return collection
    .map((item) => {
      const displayName = String(getName(item) ?? "");
      return {
        item,
        displayName,
        normalizedName: normalizeLookupText(displayName),
        debugLabel: String(getDebugLabel ? getDebugLabel(item) : displayName)
      };
    })
    .filter((entry) => entry.normalizedName.length > 0);
}

function formatLookupMatches(entries, maxItems = 5) {
  return entries
    .slice(0, maxItems)
    .map((entry) => entry.debugLabel)
    .join(", ");
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function findLookupSuggestions(entries, normalizedTarget) {
  const tokens = normalizedTarget.split(" ").filter(Boolean);

  return entries
    .map((entry) => {
      let score = 0;

      if (entry.normalizedName.startsWith(normalizedTarget)) {
        score += 60;
      }
      if (entry.normalizedName.includes(normalizedTarget)) {
        score += 45;
      }
      if (normalizedTarget.includes(entry.normalizedName)) {
        score += 20;
      }

      if (tokens.length > 0) {
        const tokenHits = tokens.filter((token) => entry.normalizedName.includes(token)).length;
        score += tokenHits * 12;
        if (tokenHits === tokens.length) {
          score += 18;
        }
      }

      const distance = levenshteinDistance(normalizedTarget, entry.normalizedName);
      score += Math.max(0, 12 - distance);

      if (score <= 0) {
        return null;
      }

      return {
        ...entry,
        score
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.debugLabel.localeCompare(right.debugLabel));
}

function resolveEntityByName(collection, targetName, getName, entityLabel, getDebugLabel = null) {
  const normalizedTarget = normalizeLookupText(targetName);
  if (!normalizedTarget) {
    throw new Error(`Name lookup for ${entityLabel} cannot use an empty string.`);
  }

  const entries = buildLookupEntries(collection, getName, getDebugLabel);
  const exactMatches = entries.filter((entry) => entry.normalizedName === normalizedTarget);

  if (exactMatches.length === 1) {
    return exactMatches[0].item;
  }

  if (exactMatches.length > 1) {
    throw new Error(
      `Name '${targetName}' is ambiguous for ${entityLabel}. Matches: ${formatLookupMatches(exactMatches)}`
    );
  }

  const substringMatches = entries.filter(
    (entry) =>
      entry.normalizedName.includes(normalizedTarget) || normalizedTarget.includes(entry.normalizedName)
  );

  if (substringMatches.length === 1) {
    return substringMatches[0].item;
  }

  if (substringMatches.length > 1) {
    throw new Error(
      `Name '${targetName}' is ambiguous for ${entityLabel}. Close matches: ${formatLookupMatches(substringMatches)}`
    );
  }

  const suggestions = findLookupSuggestions(entries, normalizedTarget);
  const available = formatAvailableNames(collection, getName);
  throw new Error(
    `Could not find ${entityLabel} named '${targetName}'.${
      suggestions.length > 0 ? ` Suggestions: ${formatLookupMatches(suggestions)}.` : ""
    }${available ? ` Available examples: ${available}` : ""}`
  );
}

function getZoneDisplayName(zoneById, zoneId) {
  if (zoneId === 0) {
    return "Outdoor";
  }

  return zoneById.get(zoneId)?.name ?? String(zoneId);
}

function refreshDerivedBridgeMetadata(metadata) {
  const zoneById = new Map((metadata.zones ?? []).map((zone) => [zone.id, zone]));
  const terminalById = new Map((metadata.terminals ?? []).map((terminal) => [terminal.id, terminal]));
  const ahsById = new Map((metadata.ahsSystems ?? []).map((ahs) => [ahs.id, ahs]));
  const elementByIndex = new Map((metadata.elements ?? []).map((element) => [element.elementIndex, element]));

  metadata.paths = (metadata.paths ?? []).map((pathInfo) => {
    const fromZoneName = getZoneDisplayName(zoneById, pathInfo.fromZone);
    const toZoneName = getZoneDisplayName(zoneById, pathInfo.toZone);
    const label = `${fromZoneName} -> ${toZoneName}`;
    const elementName = elementByIndex.get(pathInfo.elementIndex)?.name ?? null;
    return {
      ...pathInfo,
      fromZoneName,
      toZoneName,
      elementName,
      label,
      selectorLabel: `Path ${pathInfo.id}: ${label}${elementName ? ` [${elementName}]` : ""}`
    };
  });

  metadata.junctions = (metadata.junctions ?? []).map((junction) => {
    const terminal = terminalById.get(junction.id);
    const kind = junction.kind ?? (junction.type === 1 ? "terminal" : "junction");
    return {
      ...junction,
      kind,
      ambientIndex: terminal?.ambientIndex ?? 0,
      x: terminal?.x ?? null,
      y: terminal?.y ?? null,
      z: terminal?.z ?? null,
      label: kind === "terminal" ? `Terminal ${junction.id}` : `Junction ${junction.id}`
    };
  });

  metadata.ambientTargets = buildAmbientTargets(metadata).map((target) => {
    if (target.kind === "path") {
      const pathInfo = (metadata.paths ?? []).find((item) => item.id === target.id);
      const label = pathInfo?.label ?? `path:${target.id}`;
      return {
        ...target,
        label,
        selectorLabel: `Ambient ${target.ambientIndex}: ${label}`
      };
    }

    if (target.kind === "ahsp") {
      const ahs = ahsById.get(target.id);
      const label = ahs?.name ? `AHS ${ahs.id}:${ahs.name}` : `ahsp:${target.id}`;
      return {
        ...target,
        label,
        selectorLabel: `Ambient ${target.ambientIndex}: ${label}`
      };
    }

    const label = `terminal:${target.id}`;
    return {
      ...target,
      label,
      selectorLabel: `Ambient ${target.ambientIndex}: ${label}`
    };
  });
}

function resolveZoneIdByName(metadata, zoneName) {
  return resolveEntityByName(
    metadata.zones ?? [],
    zoneName,
    (item) => item.name,
    "zone",
    (item) => `${item.id}:${item.name}`
  ).id;
}

function resolvePathZoneId(metadata, zoneName) {
  const normalizedName = normalizeLookupText(zoneName);
  if (OUTDOOR_ZONE_ALIASES.has(normalizedName)) {
    return 0;
  }

  return resolveZoneIdByName(metadata, zoneName);
}

function resolveJunctionIdByName(metadata, junctionName) {
  return resolveEntityByName(
    metadata.junctions ?? [],
    junctionName,
    (item) => item.label,
    "junction",
    (item) => `${item.id}:${item.label}`
  ).id;
}

function resolveAmbientTarget(metadata, targetName) {
  return resolveEntityByName(
    metadata.ambientTargets ?? [],
    targetName,
    (item) => item.selectorLabel ?? item.label,
    "ambient target",
    (item) => `${item.ambientIndex}:${item.selectorLabel ?? item.label}`
  );
}

function resolveAgentId(metadata, adjustment) {
  if (adjustment.agentId !== undefined) {
    return adjustment.agentId;
  }

  if (!adjustment.agentName) {
    throw new Error("Named zone concentration adjustments require either agentId or agentName.");
  }

  return resolveEntityByName(
    metadata.agents ?? [],
    adjustment.agentName,
    (item) => item.name,
    "agent",
    (item) => `${item.id}:${item.name}`
  ).id;
}

function resolveControlNodeAdjustments(metadata, rawAdjustments = [], namedAdjustments = []) {
  const resolvedNamed = (namedAdjustments ?? []).map((adjustment) => {
    const node = resolveEntityByName(
      metadata.inputControlNodes ?? [],
      adjustment.controlNodeName,
      (item) => item.name,
      "input control node",
      (item) => `${item.id}:${item.name}`
    );

    return {
      nodeId: node.id,
      value: adjustment.value
    };
  });

  return [...(rawAdjustments ?? []), ...resolvedNamed];
}

function mergeNamedZoneArrayAdjustment(metadata, rawAdjustment, namedAdjustment) {
  const zoneIds = [...(rawAdjustment?.zoneIds ?? [])];
  const values = [...(rawAdjustment?.values ?? [])];

  if (rawAdjustment && zoneIds.length !== values.length) {
    throw new Error("Zone adjustment requires matching zoneIds[] and values[] arrays.");
  }

  if (namedAdjustment) {
    if (namedAdjustment.zoneNames.length !== namedAdjustment.values.length) {
      throw new Error("Named zone adjustment requires matching zoneNames[] and values[] arrays.");
    }
    zoneIds.push(...namedAdjustment.zoneNames.map((zoneName) => resolveZoneIdByName(metadata, zoneName)));
    values.push(...namedAdjustment.values);
  }

  if (zoneIds.length === 0) {
    return undefined;
  }

  return { zoneIds, values };
}

function resolveZoneConcentrationAdjustments(metadata, rawAdjustments = [], namedAdjustments = []) {
  const resolvedNamed = (namedAdjustments ?? []).map((adjustment) => {
    if (adjustment.zoneNames.length !== adjustment.values.length) {
      throw new Error("Named zone concentration adjustment requires matching zoneNames[] and values[] arrays.");
    }

    return {
      option: adjustment.option,
      agentId: resolveAgentId(metadata, adjustment),
      zoneIds: adjustment.zoneNames.map((zoneName) => resolveZoneIdByName(metadata, zoneName)),
      values: adjustment.values
    };
  });

  return [...(rawAdjustments ?? []), ...resolvedNamed];
}

function resolvePathId(metadata, selector) {
  if (selector.pathId !== undefined) {
    return selector.pathId;
  }

  if (selector.pathSelectorLabel) {
    return resolveEntityByName(
      metadata.paths ?? [],
      selector.pathSelectorLabel,
      (item) => item.selectorLabel ?? item.label,
      "path",
      (item) => `${item.id}:${item.selectorLabel ?? item.label}`
    ).id;
  }

  if (!selector.fromZoneName || !selector.toZoneName) {
    throw new Error(
      "Named element adjustments require pathId, pathSelectorLabel, or both fromZoneName and toZoneName."
    );
  }

  const fromZoneId = resolvePathZoneId(metadata, selector.fromZoneName);
  const toZoneId = resolvePathZoneId(metadata, selector.toZoneName);
  const matches = (metadata.paths ?? []).filter(
    (pathInfo) => pathInfo.fromZone === fromZoneId && pathInfo.toZone === toZoneId
  );

  if (matches.length === 1) {
    return matches[0].id;
  }

  if (matches.length > 1) {
    throw new Error(
      `Path selector '${selector.fromZoneName} -> ${selector.toZoneName}' is ambiguous. Matching path ids: ${matches
        .map((item) => item.id)
        .join(", ")}`
    );
  }

  throw new Error(`Could not find path '${selector.fromZoneName} -> ${selector.toZoneName}'.`);
}

function resolveElementIndex(metadata, selector) {
  if (selector.elementIndex !== undefined) {
    return selector.elementIndex;
  }

  if (!selector.elementName) {
    throw new Error("Named element adjustments require either elementIndex or elementName.");
  }

  return resolveEntityByName(
    metadata.elements ?? [],
    selector.elementName,
    (item) => item.name,
    "airflow element",
    (item) => `${item.elementIndex}:${item.name}`
  ).elementIndex;
}

function resolveElementAdjustments(metadata, rawAdjustments = [], namedAdjustments = []) {
  const resolvedNamed = (namedAdjustments ?? []).map((adjustment) => ({
    pathId: resolvePathId(metadata, adjustment),
    elementIndex: resolveElementIndex(metadata, adjustment)
  }));

  return [...(rawAdjustments ?? []), ...resolvedNamed];
}

function mergeNamedJunctionArrayAdjustment(metadata, rawAdjustment, namedAdjustment) {
  const junctionIds = [...(rawAdjustment?.junctionIds ?? [])];
  const values = [...(rawAdjustment?.values ?? [])];

  if (rawAdjustment && junctionIds.length !== values.length) {
    throw new Error("Junction adjustment requires matching junctionIds[] and values[] arrays.");
  }

  if (namedAdjustment) {
    if (namedAdjustment.junctionNames.length !== namedAdjustment.values.length) {
      throw new Error("Named junction adjustment requires matching junctionNames[] and values[] arrays.");
    }
    junctionIds.push(
      ...namedAdjustment.junctionNames.map((junctionName) => resolveJunctionIdByName(metadata, junctionName))
    );
    values.push(...namedAdjustment.values);
  }

  if (junctionIds.length === 0) {
    return undefined;
  }

  return { junctionIds, values };
}

function buildNamedAmbientPressureAdjustment(metadata, namedAdjustment) {
  if (!namedAdjustment) {
    return undefined;
  }

  const ambientTargets = metadata.ambientTargets ?? [];
  if (ambientTargets.length === 0) {
    throw new Error("The active bridge session does not expose any ambient targets for ADJ_WPC pressure control.");
  }

  const resolvedValues = buildResolvedAmbientTargetValues(
    metadata,
    namedAdjustment,
    "Named ambient pressure adjustment"
  );

  return {
    timeSeconds: namedAdjustment.timeSeconds ?? 0,
    agentIds: [],
    values: resolvedValues
  };
}

function buildResolvedAmbientTargetValues(metadata, namedAdjustment, adjustmentLabel) {
  const ambientTargets = metadata.ambientTargets ?? [];

  if (namedAdjustment.ambientTargetNames.length !== namedAdjustment.values.length) {
    throw new Error(`${adjustmentLabel} requires matching ambientTargetNames[] and values[] arrays.`);
  }

  const fillValue = namedAdjustment.fillValue ?? 0;
  const resolvedValues = ambientTargets.map(() => fillValue);
  const indexByAmbient = new Map(ambientTargets.map((target, index) => [target.ambientIndex, index]));
  const seenAmbientIndexes = new Set();

  namedAdjustment.ambientTargetNames.forEach((targetName, index) => {
    const target = resolveAmbientTarget(metadata, targetName);
    const targetIndex = indexByAmbient.get(target.ambientIndex);

    if (targetIndex === undefined) {
      throw new Error(`Ambient target '${targetName}' could not be mapped into the current ambient target order.`);
    }

    if (seenAmbientIndexes.has(target.ambientIndex)) {
      throw new Error(`Ambient target '${targetName}' was specified more than once.`);
    }

    seenAmbientIndexes.add(target.ambientIndex);
    resolvedValues[targetIndex] = namedAdjustment.values[index];
  });

  return resolvedValues;
}

function buildNamedAmbientConcentrationAdjustments(metadata, namedAdjustments = []) {
  const ambientTargets = metadata.ambientTargets ?? [];
  if ((namedAdjustments?.length ?? 0) === 0) {
    return [];
  }

  if (ambientTargets.length === 0) {
    throw new Error("The active bridge session does not expose any ambient targets for ADJ_WPC concentration control.");
  }

  return namedAdjustments.map((adjustment) => ({
    timeSeconds: adjustment.timeSeconds ?? 0,
    agentIds: [resolveAgentId(metadata, adjustment)],
    values: buildResolvedAmbientTargetValues(metadata, adjustment, "Named ambient concentration adjustment")
  }));
}

function mergeNamedIdArrayAdjustment(rawAdjustment, namedAdjustment, idsKey, valuesKey, resolveId) {
  const ids = [...(rawAdjustment?.[idsKey] ?? [])];
  const values = [...(rawAdjustment?.[valuesKey] ?? [])];

  if (rawAdjustment && ids.length !== values.length) {
    throw new Error(`Adjustment requires matching ${idsKey}[] and ${valuesKey}[] arrays.`);
  }

  if (namedAdjustment) {
    if (namedAdjustment.names.length !== namedAdjustment.values.length) {
      throw new Error("Named adjustment requires matching names[] and values[] arrays.");
    }
    ids.push(...namedAdjustment.names.map((name) => resolveId(name)));
    values.push(...namedAdjustment.values);
  }

  if (ids.length === 0) {
    return undefined;
  }

  return {
    [idsKey]: ids,
    [valuesKey]: values
  };
}

function writeIntArray(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeInt32BE(value, index * 4));
  return buffer;
}

function writeFloatArray(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function readIntArray(payload, offset, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    values.push(payload.readInt32BE(offset + index * 4));
  }
  return {
    values,
    nextOffset: offset + count * 4
  };
}

function readFloatArray(payload, offset, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    values.push(payload.readFloatLE(offset + index * 4));
  }
  return {
    values,
    nextOffset: offset + count * 4
  };
}

function readNullTerminatedStrings(payload, offset, count) {
  const values = [];
  let cursor = offset;

  for (let index = 0; index < count; index += 1) {
    let end = cursor;
    while (end < payload.length && payload[end] !== 0) {
      end += 1;
    }
    values.push(payload.toString("utf8", cursor, end));
    cursor = end + 1;
  }

  return {
    values,
    nextOffset: cursor
  };
}

function buildBridgeHeader(messageType, payloadLength) {
  const buffer = Buffer.alloc(BRIDGE_HEADER_LENGTH);
  buffer.write(BRIDGE_HEADER_LABEL, 0, "ascii");
  buffer.writeInt32BE(BRIDGE_HEADER_LENGTH + payloadLength, 8);
  buffer.writeInt32BE(messageType, 12);
  buffer.writeInt32BE(BRIDGE_PROTOCOL_VERSION, 16);
  return buffer;
}

function createBridgeMessage(messageType, payload = Buffer.alloc(0)) {
  return Buffer.concat([buildBridgeHeader(messageType, payload.length), payload]);
}

function parseBridgeMessage(buffer, session) {
  const signature = buffer.toString("ascii", 0, BRIDGE_HEADER_LABEL.length);
  if (signature !== BRIDGE_HEADER_LABEL) {
    throw new Error(`Unexpected bridge message signature: '${signature}'`);
  }

  const totalLength = buffer.readInt32BE(8);
  const messageType = buffer.readInt32BE(12);
  const version = buffer.readInt32BE(16);
  const payload = buffer.subarray(BRIDGE_HEADER_LENGTH, totalLength);
  const metadata = session?.bridgeMetadata ?? {};

  const parsed = {
    type: messageType,
    version,
    totalLength,
    payloadLength: payload.length,
    payload: {}
  };

  switch (messageType) {
    case bridgeMessageTypes.CX_READY:
      parsed.payload = {
        timeSeconds: payload.readInt32BE(0)
      };
      break;
    case bridgeMessageTypes.CX_ERROR:
      parsed.payload = {
        errorType: payload.readUInt8(0)
      };
      break;
    case bridgeMessageTypes.BLDG_INFO:
      parsed.payload = {
        buildingName: payload.toString("utf8").replace(/\0+$/g, "")
      };
      break;
    case bridgeMessageTypes.SIMPARM_INFO:
      parsed.payload = {
        startDateCode: payload.readInt32BE(0),
        endDateCode: payload.readInt32BE(4),
        startTimeSeconds: payload.readInt32BE(8),
        endTimeSeconds: payload.readInt32BE(12),
        timeStepSeconds: payload.readInt32BE(16)
      };
      break;
    case bridgeMessageTypes.AGENT_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      const names = readNullTerminatedStrings(payload, ids.nextOffset, count);
      parsed.payload = {
        count,
        ids: ids.values,
        names: names.values
      };
      break;
    }
    case bridgeMessageTypes.ELEMENT_INFO: {
      const count = payload.readInt32BE(0);
      const names = readNullTerminatedStrings(payload, 4, count);
      parsed.payload = {
        count,
        names: names.values
      };
      break;
    }
    case bridgeMessageTypes.INPUT_CTRL_INFO:
    case bridgeMessageTypes.OUTPUT_CTRL_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      const values = readFloatArray(payload, ids.nextOffset, count);
      const names = readNullTerminatedStrings(payload, values.nextOffset, count);
      parsed.payload = {
        count,
        ids: ids.values,
        values: values.values,
        names: names.values
      };
      break;
    }
    case bridgeMessageTypes.AHSP_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      const ambientIndexes = readIntArray(payload, ids.nextOffset, count);
      const x = readFloatArray(payload, ambientIndexes.nextOffset, count);
      const y = readFloatArray(payload, x.nextOffset, count);
      const z = readFloatArray(payload, y.nextOffset, count);
      parsed.payload = {
        count,
        ids: ids.values,
        ambientIndexes: ambientIndexes.values,
        coordinates: ids.values.map((id, index) => ({
          id,
          ambientIndex: ambientIndexes.values[index],
          x: x.values[index],
          y: y.values[index],
          z: z.values[index]
        }))
      };
      break;
    }
    case bridgeMessageTypes.ZONE_INFO: {
      const count = payload.readInt32BE(0);
      const levels = readIntArray(payload, 4, count);
      const ahs = readIntArray(payload, levels.nextOffset, count);
      const volumes = readFloatArray(payload, ahs.nextOffset, count);
      const names = readNullTerminatedStrings(payload, volumes.nextOffset, count);
      parsed.payload = {
        count,
        levels: levels.values,
        ahsFlags: ahs.values,
        volumes: volumes.values,
        names: names.values
      };
      break;
    }
    case bridgeMessageTypes.PATH_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      const ambient = readIntArray(payload, ids.nextOffset, count);
      const elements = readIntArray(payload, ambient.nextOffset, count);
      const fromZones = readIntArray(payload, elements.nextOffset, count);
      const toZones = readIntArray(payload, fromZones.nextOffset, count);
      const x = readFloatArray(payload, toZones.nextOffset, count);
      const y = readFloatArray(payload, x.nextOffset, count);
      const z = readFloatArray(payload, y.nextOffset, count);
      parsed.payload = {
        count,
        ids: ids.values,
        ambientIndexes: ambient.values,
        elementIndexes: elements.values,
        fromZones: fromZones.values,
        toZones: toZones.values,
        coordinates: ids.values.map((id, index) => ({
          id,
          x: x.values[index],
          y: y.values[index],
          z: z.values[index]
        }))
      };
      break;
    }
    case bridgeMessageTypes.JCT_INFO: {
      const count = payload.readInt32BE(0);
      const types = readIntArray(payload, 4, count);
      parsed.payload = {
        count,
        types: types.values
      };
      break;
    }
    case bridgeMessageTypes.TERM_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      const ambientIndexes = readIntArray(payload, ids.nextOffset, count);
      const x = readFloatArray(payload, ambientIndexes.nextOffset, count);
      const y = readFloatArray(payload, x.nextOffset, count);
      const z = readFloatArray(payload, y.nextOffset, count);
      parsed.payload = {
        count,
        ids: ids.values,
        ambientIndexes: ambientIndexes.values,
        coordinates: ids.values.map((id, index) => ({
          id,
          ambientIndex: ambientIndexes.values[index],
          x: x.values[index],
          y: y.values[index],
          z: z.values[index]
        }))
      };
      break;
    }
    case bridgeMessageTypes.LEAK_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      parsed.payload = {
        count,
        ids: ids.values
      };
      break;
    }
    case bridgeMessageTypes.DUCT_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      parsed.payload = {
        count,
        ids: ids.values
      };
      break;
    }
    case bridgeMessageTypes.AHS_INFO: {
      const count = payload.readInt32BE(0);
      const ids = readIntArray(payload, 4, count);
      const names = readNullTerminatedStrings(payload, ids.nextOffset, count);
      parsed.payload = {
        count,
        ids: ids.values,
        names: names.values
      };
      break;
    }
    case bridgeMessageTypes.CONC_UPDATE: {
      const timeSeconds = payload.readInt32BE(0);
      const agentId = payload.readInt32BE(4);
      const values = readFloatArray(payload, 8, metadata.zoneCount ?? 0);
      parsed.payload = {
        timeSeconds,
        agentId,
        concentrations: values.values
      };
      break;
    }
    case bridgeMessageTypes.PATH_FLOW_UPDATE: {
      const timeSeconds = payload.readInt32BE(0);
      const values = readFloatArray(payload, 4, (metadata.pathCount ?? 0) * 2);
      parsed.payload = {
        timeSeconds,
        massFlows: values.values
      };
      break;
    }
    case bridgeMessageTypes.TERM_FLOW_UPDATE: {
      const timeSeconds = payload.readInt32BE(0);
      const values = readFloatArray(payload, 4, metadata.termCount ?? 0);
      parsed.payload = {
        timeSeconds,
        massFlows: values.values
      };
      break;
    }
    case bridgeMessageTypes.AHSP_FLOW_UPDATE: {
      const timeSeconds = payload.readInt32BE(0);
      const values = readFloatArray(payload, 4, metadata.ahspCount ?? 0);
      parsed.payload = {
        timeSeconds,
        massFlows: values.values
      };
      break;
    }
    case bridgeMessageTypes.DUCT_FLOW_UPDATE: {
      const timeSeconds = payload.readInt32BE(0);
      const values = readFloatArray(payload, 4, metadata.ductCount ?? 0);
      parsed.payload = {
        timeSeconds,
        massFlows: values.values
      };
      break;
    }
    case bridgeMessageTypes.LEAK_FLOW_UPDATE: {
      const timeSeconds = payload.readInt32BE(0);
      const values = readFloatArray(payload, 4, metadata.leakCount ?? 0);
      parsed.payload = {
        timeSeconds,
        massFlows: values.values
      };
      break;
    }
    case bridgeMessageTypes.CTRL_NODE_UPDATE: {
      const timeSeconds = payload.readInt32BE(0);
      const values = readFloatArray(payload, 4, metadata.outputControlCount ?? 0);
      parsed.payload = {
        timeSeconds,
        values: values.values
      };
      break;
    }
    default:
      parsed.payload = {
        rawBytes: payload.toString("base64")
      };
      break;
  }

  return parsed;
}

function applyProjectInfoToBridgeMetadata(session, message) {
  const metadata = session.bridgeMetadata;

  switch (message.type) {
    case bridgeMessageTypes.BLDG_INFO:
      metadata.buildingName = message.payload.buildingName;
      break;
    case bridgeMessageTypes.SIMPARM_INFO:
      metadata.simulation = message.payload;
      break;
    case bridgeMessageTypes.AGENT_INFO:
      metadata.agentCount = message.payload.count;
      metadata.agents = message.payload.ids.map((id, index) => ({
        id,
        name: message.payload.names[index]
      }));
      break;
    case bridgeMessageTypes.ELEMENT_INFO:
      metadata.elementCount = message.payload.count;
      metadata.elements = message.payload.names.map((name, index) => ({
        elementIndex: index + 1,
        name
      }));
      refreshDerivedBridgeMetadata(metadata);
      break;
    case bridgeMessageTypes.INPUT_CTRL_INFO:
      metadata.inputControlCount = message.payload.count;
      metadata.inputControlNodes = message.payload.ids.map((id, index) => ({
        id,
        name: message.payload.names[index],
        initialValue: message.payload.values[index]
      }));
      break;
    case bridgeMessageTypes.OUTPUT_CTRL_INFO:
      metadata.outputControlCount = message.payload.count;
      metadata.outputControlNodes = message.payload.ids.map((id, index) => ({
        id,
        name: message.payload.names[index],
        initialValue: message.payload.values[index]
      }));
      break;
    case bridgeMessageTypes.AHSP_INFO:
      metadata.ahspCount = message.payload.count;
      metadata.ahspPaths = message.payload.coordinates;
      refreshDerivedBridgeMetadata(metadata);
      break;
    case bridgeMessageTypes.ZONE_INFO:
      metadata.zoneCount = message.payload.count;
      metadata.zones = message.payload.names.map((name, index) => ({
        id: index + 1,
        name,
        level: message.payload.levels[index],
        volume: message.payload.volumes[index]
      }));
      refreshDerivedBridgeMetadata(metadata);
      break;
    case bridgeMessageTypes.PATH_INFO:
      metadata.pathCount = message.payload.count;
      metadata.paths = message.payload.ids.map((id, index) => ({
        id,
        fromZone: message.payload.fromZones[index],
        toZone: message.payload.toZones[index],
        ambientIndex: message.payload.ambientIndexes[index],
        elementIndex: message.payload.elementIndexes[index]
      }));
      refreshDerivedBridgeMetadata(metadata);
      break;
    case bridgeMessageTypes.JCT_INFO:
      metadata.jctCount = message.payload.count;
      metadata.junctions = message.payload.types.map((type, index) => ({
        id: index + 1,
        type,
        kind: type === 1 ? "terminal" : "junction"
      }));
      refreshDerivedBridgeMetadata(metadata);
      break;
    case bridgeMessageTypes.TERM_INFO:
      metadata.termCount = message.payload.count;
      metadata.terminals = message.payload.ids.map((id, index) => ({
        id,
        ambientIndex: message.payload.ambientIndexes[index],
        x: message.payload.coordinates[index]?.x ?? null,
        y: message.payload.coordinates[index]?.y ?? null,
        z: message.payload.coordinates[index]?.z ?? null
      }));
      refreshDerivedBridgeMetadata(metadata);
      break;
    case bridgeMessageTypes.LEAK_INFO:
      metadata.leakCount = message.payload.count;
      metadata.leakIds = message.payload.ids;
      break;
    case bridgeMessageTypes.DUCT_INFO:
      metadata.ductCount = message.payload.count;
      metadata.ductIds = message.payload.ids;
      break;
    case bridgeMessageTypes.AHS_INFO:
      metadata.ahsCount = message.payload.count;
      metadata.ahsSystems = message.payload.ids.map((id, index) => ({
        id,
        name: message.payload.names[index]
      }));
      refreshDerivedBridgeMetadata(metadata);
      break;
    default:
      break;
  }
}

function encodeAdvancePayload({ timeSeconds, optionFlags = 0 }) {
  const payload = Buffer.alloc(8);
  payload.writeInt32BE(optionFlags, 0);
  payload.writeInt32BE(timeSeconds, 4);
  return payload;
}

function encodeControlNodeAdjustment({ nodeId, value }) {
  const payload = Buffer.alloc(8);
  payload.writeInt32BE(nodeId, 0);
  payload.writeFloatLE(value, 4);
  return payload;
}

function encodeZoneConcentrationAdjustment({ option, agentId, zoneIds, values }) {
  if (!Array.isArray(zoneIds) || !Array.isArray(values) || zoneIds.length !== values.length) {
    throw new Error("zoneConcentrationAdjustments require matching zoneIds[] and values[] arrays.");
  }

  return Buffer.concat([
    writeIntArray([option, zoneIds.length, agentId]),
    writeIntArray(zoneIds),
    writeFloatArray(values)
  ]);
}

function encodeElementAdjustment({ pathId, elementIndex }) {
  return writeIntArray([pathId, elementIndex]);
}

function encodeWeatherAdjustment({ temperatureK, pressurePa, windSpeed, windDirection, humidityRatio = 0 }) {
  return writeFloatArray([temperatureK, pressurePa, windSpeed, windDirection, humidityRatio]);
}

function encodeWpcAdjustment({ timeSeconds = 0, agentIds = [], values }) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("wpcAdjustment.values must be a non-empty array.");
  }

  const numAgents = agentIds.length;
  const header = writeIntArray([timeSeconds, numAgents, values.length]);

  if (numAgents > 0) {
    return Buffer.concat([
      header,
      writeIntArray(agentIds),
      writeFloatArray(values)
    ]);
  }

  return Buffer.concat([header, writeFloatArray(values)]);
}

class ContamBridgeSession {
  constructor({ executablePath, projectPath, workingDirectory, windFromBridge, volumeFlowBridge, host, port }) {
    this.id = randomUUID();
    this.executablePath = executablePath;
    this.projectPath = projectPath;
    this.workingDirectory = workingDirectory;
    this.windFromBridge = windFromBridge;
    this.volumeFlowBridge = volumeFlowBridge;
    this.host = host;
    this.port = port;
    this.server = null;
    this.socket = null;
    this.process = null;
    this.stdout = "";
    this.stderr = "";
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
    this.readyTimeSeconds = null;
    this.bridgeMetadata = {
      buildingName: null,
      simulation: null,
      agents: [],
      inputControlNodes: [],
      outputControlNodes: [],
      zones: [],
      paths: [],
      junctions: [],
      terminals: [],
      ahspPaths: [],
      ambientTargets: [],
      leakIds: [],
      ductIds: []
    };
    this.lastAdvance = null;
  }

  async start(timeoutSeconds = 30) {
    await this.listen();
    const connectionPromise = this.waitForConnection(timeoutSeconds);
    await this.spawnContam();
    this.socket = await connectionPromise;
    const handshake = await this.readUntilReady(timeoutSeconds);
    return handshake;
  }

  async listen() {
    this.server = net.createServer();
    this.server.on("connection", (socket) => {
      socket.setNoDelay(true);
      this.socket = socket;
      socket.on("data", (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.drainWaiters();
      });
      socket.on("close", () => {
        this.closed = true;
        this.drainWaiters();
      });
      socket.on("error", (error) => {
        this.stderr += `\n[bridge-socket] ${error.message}`;
        this.drainWaiters(error);
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, this.host, () => {
        this.port = this.server.address().port;
        this.server.removeListener("error", reject);
        resolve();
      });
    });
  }

  waitForConnection(timeoutSeconds) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ContamX to connect on ${this.host}:${this.port}`));
      }, timeoutSeconds * 1000);

      const onConnection = (socket) => {
        clearTimeout(timer);
        this.server.removeListener("connection", onConnection);
        resolve(socket);
      };

      if (this.socket) {
        clearTimeout(timer);
        resolve(this.socket);
        return;
      }

      this.server.on("connection", onConnection);
    });
  }

  async spawnContam() {
    const args = [this.projectPath, `--Bridge=${this.host}:${this.port}`];
    if (this.windFromBridge) {
      args.push("-w");
    }
    if (this.volumeFlowBridge) {
      args.push("-f");
    }

    this.process = spawn(this.executablePath, args, {
      cwd: this.workingDirectory,
      env: process.env,
      windowsHide: true,
      stdio: "pipe"
    });

    this.process.stdout.on("data", (chunk) => {
      this.stdout += chunk.toString();
    });
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    this.process.on("exit", () => {
      this.closed = true;
      this.drainWaiters();
    });
    this.process.on("error", (error) => {
      this.stderr += `\n[bridge-process] ${error.message}`;
      this.drainWaiters(error);
    });
  }

  drainWaiters(error = null) {
    while (this.waiters.length > 0) {
      const nextMessage = !error ? this.tryParseNextMessage() : null;
      if (!error && !nextMessage) {
        return;
      }
      const waiter = this.waiters.shift();
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(nextMessage);
      }
    }
  }

  tryParseNextMessage() {
    if (this.buffer.length < BRIDGE_HEADER_LENGTH) {
      return null;
    }

    const totalLength = this.buffer.readInt32BE(8);
    if (this.buffer.length < totalLength) {
      return null;
    }

    const messageBuffer = this.buffer.subarray(0, totalLength);
    this.buffer = this.buffer.subarray(totalLength);
    return parseBridgeMessage(messageBuffer, this);
  }

  async readMessage(timeoutSeconds = 30) {
    const nextMessage = this.tryParseNextMessage();
    if (nextMessage) {
      return nextMessage;
    }

    if (this.closed) {
      throw new Error("Bridge session closed before another message was received.");
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        reject(new Error("Timed out waiting for a ContamX bridge message."));
      }, timeoutSeconds * 1000);

      const waiter = {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      };

      this.waiters.push(waiter);
      this.drainWaiters();
    });
  }

  async readUntilReady(timeoutSeconds = 30) {
    const messages = [];

    while (true) {
      const message = await this.readMessage(timeoutSeconds);
      messages.push(message);

      if (message.type >= bridgeMessageTypes.BLDG_INFO && message.type <= bridgeMessageTypes.AHS_INFO) {
        applyProjectInfoToBridgeMetadata(this, message);
      }

      if (message.type === bridgeMessageTypes.CX_READY) {
        this.readyTimeSeconds = message.payload.timeSeconds;
        return {
          ready: message,
          messages
        };
      }

      if (message.type === bridgeMessageTypes.CX_ERROR) {
        throw new Error(`ContamX bridge reported CX_ERROR with type ${message.payload.errorType}. stderr=${normalizeText(this.stderr)}`);
      }
    }
  }

  async sendMessage(messageType, payloadBuffer = Buffer.alloc(0)) {
    if (!this.socket || this.closed) {
      throw new Error("Bridge session is not connected.");
    }

    await new Promise((resolve, reject) => {
      this.socket.write(createBridgeMessage(messageType, payloadBuffer), (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async applyAdjustments({
    controlNodeAdjustments,
    weatherAdjustment,
    zoneConcentrationAdjustments,
    zoneTemperatureAdjustments,
    junctionTemperatureAdjustments,
    zoneHumidityRatioAdjustments,
    elementAdjustments,
    ahspFlowAdjustments,
    ahsPoaAdjustments,
    wpcAdjustments
  }) {
    if (Array.isArray(zoneConcentrationAdjustments)) {
      for (const adjustment of zoneConcentrationAdjustments) {
        await this.sendMessage(
          bridgeMessageTypes.ADJ_ZONE_CONC,
          encodeZoneConcentrationAdjustment(adjustment)
        );
      }
    }

    if (zoneTemperatureAdjustments) {
      await this.sendMessage(
        bridgeMessageTypes.ADJ_ZONE_TEMP,
        buildIndexedFloatAdjustment(zoneTemperatureAdjustments.zoneIds, zoneTemperatureAdjustments.values)
      );
    }

    if (junctionTemperatureAdjustments) {
      await this.sendMessage(
        bridgeMessageTypes.ADJ_JCT_TEMP,
        buildIndexedFloatAdjustment(junctionTemperatureAdjustments.junctionIds, junctionTemperatureAdjustments.values)
      );
    }

    if (zoneHumidityRatioAdjustments) {
      await this.sendMessage(
        bridgeMessageTypes.ADJ_ZONE_HR,
        buildIndexedFloatAdjustment(zoneHumidityRatioAdjustments.zoneIds, zoneHumidityRatioAdjustments.values)
      );
    }

    if (Array.isArray(elementAdjustments)) {
      for (const adjustment of elementAdjustments) {
        await this.sendMessage(
          bridgeMessageTypes.ADJ_ELEMENT,
          encodeElementAdjustment(adjustment)
        );
      }
    }

    if (Array.isArray(controlNodeAdjustments)) {
      for (const adjustment of controlNodeAdjustments) {
        await this.sendMessage(
          bridgeMessageTypes.ADJ_CONTROL_NODE,
          encodeControlNodeAdjustment(adjustment)
        );
      }
    }

    if (ahspFlowAdjustments) {
      await this.sendMessage(
        bridgeMessageTypes.ADJ_AHSP_FLOWS,
        buildIndexedFloatAdjustment(ahspFlowAdjustments.pathIds, ahspFlowAdjustments.values)
      );
    }

    if (ahsPoaAdjustments) {
      await this.sendMessage(
        bridgeMessageTypes.ADJ_AHS_POA,
        buildIndexedFloatAdjustment(ahsPoaAdjustments.ahsIds, ahsPoaAdjustments.values)
      );
    }

    if (weatherAdjustment) {
      await this.sendMessage(
        bridgeMessageTypes.ADJ_WTH,
        encodeWeatherAdjustment(weatherAdjustment)
      );
    }

    if (Array.isArray(wpcAdjustments)) {
      for (const adjustment of wpcAdjustments) {
        await this.sendMessage(
          bridgeMessageTypes.ADJ_WPC,
          encodeWpcAdjustment(adjustment)
        );
      }
    }
  }

  async advance({
    targetTimeSeconds,
    optionFlags = 0,
    controlNodeAdjustments,
    weatherAdjustment,
    zoneConcentrationAdjustments,
    zoneTemperatureAdjustments,
    junctionTemperatureAdjustments,
    zoneHumidityRatioAdjustments,
    elementAdjustments,
    ahspFlowAdjustments,
    ahsPoaAdjustments,
    wpcAdjustments,
    timeoutSeconds = 30
  }) {
    if (targetTimeSeconds === undefined || targetTimeSeconds === null) {
      throw new Error("targetTimeSeconds is required when advancing a bridge session.");
    }

    await this.applyAdjustments({
      controlNodeAdjustments,
      weatherAdjustment,
      zoneConcentrationAdjustments,
      zoneTemperatureAdjustments,
      junctionTemperatureAdjustments,
      zoneHumidityRatioAdjustments,
      elementAdjustments,
      ahspFlowAdjustments,
      ahsPoaAdjustments,
      wpcAdjustments
    });
    await this.sendMessage(
      bridgeMessageTypes.CX_ADVANCE,
      encodeAdvancePayload({ timeSeconds: targetTimeSeconds, optionFlags })
    );
    const cycle = await this.readUntilReady(timeoutSeconds);
    this.lastAdvance = {
      targetTimeSeconds,
      optionFlags,
      updates: cycle.messages.filter((message) => message.type >= bridgeMessageTypes.CONC_UPDATE)
    };
    return cycle;
  }

  getSummary() {
    return {
      sessionId: this.id,
      projectPath: this.projectPath,
      workingDirectory: this.workingDirectory,
      host: this.host,
      port: this.port,
      windFromBridge: this.windFromBridge,
      volumeFlowBridge: this.volumeFlowBridge,
      readyTimeSeconds: this.readyTimeSeconds,
      metadata: this.bridgeMetadata,
      lastAdvance: this.lastAdvance,
      stderr: normalizeText(this.stderr),
      stdout: normalizeText(this.stdout)
    };
  }

  async close() {
    this.closed = true;

    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }

    if (this.server) {
      await new Promise((resolve) => this.server.close(() => resolve()));
    }

    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }
}

function normalizeExtensions(extensions) {
  const normalized = (extensions?.length ? extensions : DEFAULT_CASE_EXTENSIONS).map((extension) =>
    extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  );

  return unique(normalized);
}

async function walkDirectory(rootDirectory, recursive, extensions, maxResults) {
  const matches = [];
  const stack = [rootDirectory];

  while (stack.length > 0 && matches.length < maxResults) {
    const currentDirectory = stack.pop();
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!extensions.includes(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const info = await stat(absolutePath);
      matches.push({
        path: absolutePath,
        size: info.size,
        modifiedAt: new Date(info.mtimeMs).toISOString()
      });

      if (matches.length >= maxResults) {
        break;
      }
    }
  }

  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

const server = new McpServer({
  name: "contam-mcp",
  version: "0.1.0"
});

server.tool(
  "discover_contam_installation",
  "Use this when you need to confirm where CONTAM is installed and which executables this MCP server can access.",
  {},
  async () => {
    const contamHome = await resolveContamHome();
    const executables = {};

    for (const [programKey, definition] of Object.entries(programDefinitions)) {
      const executablePath = await resolveExecutable(programKey).catch(() => null);
      if (!executablePath) {
        executables[programKey] = {
          exe: definition.exe,
          found: false
        };
        continue;
      }

      const versionResult =
        definition.versionArgs.length > 0
          ? await runProcess(executablePath, definition.versionArgs, {
              cwd: path.dirname(executablePath),
              timeoutSeconds: 15
            })
          : null;

      executables[programKey] = {
        exe: definition.exe,
        found: true,
        path: executablePath,
        version: versionResult?.stdout || versionResult?.stderr || null
      };
    }

    return toolResponse("Resolved CONTAM installation details.", {
      contamHome,
      workspaceRoot,
      executables
    });
  }
);

server.tool(
  "list_contam_case_files",
  "Use this when you want to find CONTAM project files, result files, or weather files in a directory tree before running a simulation.",
  {
    directory: z.string().optional(),
    recursive: z.boolean().optional(),
    extensions: z.array(z.string()).optional(),
    maxResults: z.number().int().min(1).max(MAX_LIST_RESULTS).optional()
  },
  async ({ directory, recursive, extensions, maxResults }) => {
    const resolvedDirectory = asAbsolutePath(directory ?? (await resolveContamHome()));
    const caseFiles = await walkDirectory(
      resolvedDirectory,
      recursive ?? true,
      normalizeExtensions(extensions),
      maxResults ?? 200
    );

    return toolResponse(`Found ${caseFiles.length} matching CONTAM-related files.`, {
      directory: resolvedDirectory,
      recursive: recursive ?? true,
      extensions: normalizeExtensions(extensions),
      files: caseFiles
    });
  }
);

server.tool(
  "get_contam_program_help",
  "Use this when you want the built-in command-line usage text for a CONTAM executable before deciding which tool or arguments to use.",
  {
    program: z.enum(["contamx", "prjup", "simread", "simcomp"])
  },
  async ({ program }) => {
    const definition = programDefinitions[program];
    const executablePath = await resolveExecutable(program);
    const helpResult = await runProcess(executablePath, definition.helpArgs, {
      cwd: path.dirname(executablePath),
      timeoutSeconds: 15
    });

    return toolResponse(`Fetched help text for ${program}.`, {
      program,
      executablePath,
      helpText: helpResult.stdout || helpResult.stderr,
      exitCode: helpResult.exitCode
    });
  }
);

server.tool(
  "inspect_contam_project",
  "Use this when you want a quick structural summary of a CONTAM .prj file before editing or running it.",
  {
    projectPath: z.string()
  },
  async ({ projectPath }) => {
    const resolvedProjectPath = asAbsolutePath(projectPath);
    if (!(await fileExists(resolvedProjectPath))) {
      throw new Error(`Project file not found: ${resolvedProjectPath}`);
    }

    const inspection = await inspectContamProject(resolvedProjectPath);
    return toolResponse("Parsed CONTAM project metadata.", inspection);
  }
);

server.tool(
  "diagnose_contam_project",
  "Use this when a CONTAM project fails to run and you want to inspect referenced support files and nearby candidate matches.",
  {
    projectPath: z.string(),
    workingDirectory: z.string().optional(),
    searchRecursively: z.boolean().optional(),
    maxMatchesPerReference: z.number().int().min(1).max(20).optional()
  },
  async ({ projectPath, workingDirectory, searchRecursively, maxMatchesPerReference }) => {
    const resolvedProjectPath = asAbsolutePath(projectPath);
    if (!(await fileExists(resolvedProjectPath))) {
      throw new Error(`Project file not found: ${resolvedProjectPath}`);
    }

    const inspection = await inspectContamProject(resolvedProjectPath);
    const projectDirectory = path.dirname(resolvedProjectPath);
    const resolvedWorkingDirectory = asAbsolutePath(workingDirectory ?? projectDirectory);
    const recursiveSearch = searchRecursively ?? true;
    const referenceDiagnostics = {};

    for (const descriptor of projectReferenceDescriptors) {
      const reference = inspection.references[descriptor.key];
      if (!reference || reference.value === null) {
        referenceDiagnostics[descriptor.key] = {
          label: descriptor.commentLabel,
          status: "unset",
          configuredValue: null,
          directMatches: [],
          nearbyMatches: [],
          suggestedValue: null
        };
        continue;
      }

      const directCandidates = unique([
        asAbsolutePath(reference.value, resolvedWorkingDirectory),
        asAbsolutePath(reference.value, projectDirectory)
      ]);
      const directMatches = [];

      for (const candidate of directCandidates) {
        if (await fileExists(candidate)) {
          directMatches.push(candidate);
        }
      }

      const nearbyMatches =
        recursiveSearch && directMatches.length === 0
          ? await findFilesByBasename(
              projectDirectory,
              path.basename(reference.value),
              maxMatchesPerReference ?? 5
            )
          : [];

      const bestMatch = directMatches[0] ?? nearbyMatches[0] ?? null;
      const suggestedValue = bestMatch
        ? path.relative(projectDirectory, bestMatch) || path.basename(bestMatch)
        : null;

      referenceDiagnostics[descriptor.key] = {
        label: descriptor.commentLabel,
        status:
          directMatches.length > 0 ? "resolved" : nearbyMatches.length > 0 ? "found-nearby" : "missing",
        configuredValue: reference.value,
        directMatches,
        nearbyMatches,
        suggestedValue
      };
    }

    return toolResponse("Diagnosed CONTAM project dependencies.", {
      projectPath: resolvedProjectPath,
      workingDirectory: resolvedWorkingDirectory,
      recursiveSearch,
      inspection,
      references: referenceDiagnostics
    });
  }
);

server.tool(
  "update_contam_project_references",
  "Use this when you need to edit the referenced weather, contaminant, or library files inside a CONTAM .prj file.",
  {
    projectPath: z.string(),
    weatherFile: z.string().nullable().optional(),
    contaminantFile: z.string().nullable().optional(),
    continuousValuesFile: z.string().nullable().optional(),
    discreteValuesFile: z.string().nullable().optional(),
    wpcFile: z.string().nullable().optional(),
    ewcFile: z.string().nullable().optional(),
    createBackup: z.boolean().optional()
  },
  async ({
    projectPath,
    weatherFile,
    contaminantFile,
    continuousValuesFile,
    discreteValuesFile,
    wpcFile,
    ewcFile,
    createBackup
  }) => {
    const resolvedProjectPath = asAbsolutePath(projectPath);
    if (!(await fileExists(resolvedProjectPath))) {
      throw new Error(`Project file not found: ${resolvedProjectPath}`);
    }

    const requestedUpdates = {
      weatherFile,
      contaminantFile,
      continuousValuesFile,
      discreteValuesFile,
      wpcFile,
      ewcFile
    };
    const keysToUpdate = Object.keys(requestedUpdates).filter(
      (key) => Object.prototype.hasOwnProperty.call(requestedUpdates, key) && requestedUpdates[key] !== undefined
    );

    if (keysToUpdate.length === 0) {
      throw new Error("No reference updates were provided.");
    }

    const lines = await readProjectLines(resolvedProjectPath);
    const inspectionBefore = inspectContamProjectLines(lines);

    for (const key of keysToUpdate) {
      const descriptor = projectReferenceDescriptors.find((item) => item.key === key);
      const reference = inspectionBefore.references[key];

      if (!descriptor || !reference || reference.lineNumber === null) {
        throw new Error(`Could not find a '${key}' line inside ${resolvedProjectPath}.`);
      }

      const lineIndex = reference.lineNumber - 1;
      lines[lineIndex] = buildReferenceLine(lines[lineIndex], reference.comment, requestedUpdates[key]);
    }

    if (createBackup !== false) {
      const backupPath = `${resolvedProjectPath}.mcp.bak`;
      if (!(await fileExists(backupPath))) {
        await copyFile(resolvedProjectPath, backupPath);
      }
    }

    await writeFile(resolvedProjectPath, `${lines.join("\r\n")}\r\n`, { encoding: "utf8" });
    const inspectionAfter = await inspectContamProject(resolvedProjectPath);

    return toolResponse("Updated CONTAM project references.", {
      projectPath: resolvedProjectPath,
      backupCreated: createBackup !== false,
      requestedUpdates,
      before: inspectionBefore.references,
      after: inspectionAfter.references
    });
  }
);

server.tool(
  "start_contam_bridge_session",
  "Use this when you want to launch ContamX in bridge mode and keep an interactive socket session open across multiple MCP calls.",
  {
    projectPath: z.string(),
    workingDirectory: z.string().optional(),
    windFromBridge: z.boolean().optional(),
    volumeFlowBridge: z.boolean().optional(),
    timeoutSeconds: z.number().int().min(1).max(300).optional()
  },
  async ({ projectPath, workingDirectory, windFromBridge, volumeFlowBridge, timeoutSeconds }) => {
    const executablePath = await resolveExecutable("contamx");
    const resolvedProjectPath = asAbsolutePath(projectPath);
    if (!(await fileExists(resolvedProjectPath))) {
      throw new Error(`Project file not found: ${resolvedProjectPath}`);
    }

    const session = new ContamBridgeSession({
      executablePath,
      projectPath: resolvedProjectPath,
      workingDirectory: asAbsolutePath(workingDirectory ?? path.dirname(resolvedProjectPath)),
      windFromBridge: windFromBridge ?? false,
      volumeFlowBridge: volumeFlowBridge ?? false,
      host: BRIDGE_HOST,
      port: 0
    });

    try {
      const handshake = await session.start(timeoutSeconds ?? 30);
      bridgeSessions.set(session.id, session);

      return toolResponse("Started a ContamX bridge session.", {
        sessionId: session.id,
        readyTimeSeconds: session.readyTimeSeconds,
        initialMessageTypes: handshake.messages.map((message) => message.type),
        summary: session.getSummary()
      });
    } catch (error) {
      await session.close().catch(() => {});
      throw error;
    }
  }
);

server.tool(
  "get_contam_bridge_session",
  "Use this when you want to inspect the metadata or last-known state of an active ContamX bridge session.",
  {
    sessionId: z.string()
  },
  async ({ sessionId }) => {
    const session = bridgeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Bridge session not found: ${sessionId}`);
    }

    return toolResponse("Fetched ContamX bridge session state.", session.getSummary());
  }
);

server.tool(
  "list_contam_bridge_entities",
  "Use this when you want a concise list of the names and ids available inside an active ContamX bridge session.",
  {
    sessionId: z.string(),
    category: z
      .enum([
        "zones",
        "paths",
        "junctions",
        "elements",
        "inputControlNodes",
        "outputControlNodes",
        "ahsSystems",
        "ambientTargets"
      ])
      .optional()
  },
  async ({ sessionId, category }) => {
    const session = bridgeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Bridge session not found: ${sessionId}`);
    }

    const metadata = session.bridgeMetadata;
    const categories = {
      zones: metadata.zones ?? [],
      paths: metadata.paths ?? [],
      junctions: metadata.junctions ?? [],
      elements: metadata.elements ?? [],
      inputControlNodes: metadata.inputControlNodes ?? [],
      outputControlNodes: metadata.outputControlNodes ?? [],
      ahsSystems: metadata.ahsSystems ?? [],
      ambientTargets: metadata.ambientTargets ?? []
    };

    return toolResponse("Listed concise bridge entities.", {
      sessionId,
      category: category ?? "all",
      entities: category ? { [category]: categories[category] } : categories
    });
  }
);

server.tool(
  "advance_contam_bridge_session",
  "Use this when you want to send control/weather adjustments to a running bridge session and optionally advance ContamX to a new simulation time.",
  {
    sessionId: z.string(),
    targetTimeSeconds: z.number().int().min(0).optional(),
    advanceBySeconds: z.number().int().min(1).optional(),
    requestConcentrations: z.boolean().optional(),
    requestPathFlows: z.boolean().optional(),
    requestTermFlows: z.boolean().optional(),
    requestAhspFlows: z.boolean().optional(),
    requestDuctFlows: z.boolean().optional(),
    requestLeakFlows: z.boolean().optional(),
    requestOutputControlValues: z.boolean().optional(),
    controlNodeAdjustments: z
      .array(
        z.object({
          nodeId: z.number().int(),
          value: z.number()
        })
      )
      .optional(),
    namedControlNodeAdjustments: z
      .array(
        z.object({
          controlNodeName: z.string(),
          value: z.number()
        })
      )
      .optional(),
    zoneConcentrationAdjustments: z
      .array(
        z.object({
          option: z.union([z.literal(0), z.literal(1)]),
          agentId: z.number().int(),
          zoneIds: z.array(z.number().int()),
          values: z.array(z.number())
        })
      )
      .optional(),
    namedZoneConcentrationAdjustments: z
      .array(
        z.object({
          option: z.union([z.literal(0), z.literal(1)]),
          agentId: z.number().int().optional(),
          agentName: z.string().optional(),
          zoneNames: z.array(z.string()),
          values: z.array(z.number())
        })
      )
      .optional(),
    zoneTemperatureAdjustments: z
      .object({
        zoneIds: z.array(z.number().int()),
        values: z.array(z.number())
      })
      .optional(),
    namedZoneTemperatureAdjustments: z
      .object({
        zoneNames: z.array(z.string()),
        values: z.array(z.number())
      })
      .optional(),
    junctionTemperatureAdjustments: z
      .object({
        junctionIds: z.array(z.number().int()),
        values: z.array(z.number())
      })
      .optional(),
    namedJunctionTemperatureAdjustments: z
      .object({
        junctionNames: z.array(z.string()),
        values: z.array(z.number())
      })
      .optional(),
    zoneHumidityRatioAdjustments: z
      .object({
        zoneIds: z.array(z.number().int()),
        values: z.array(z.number())
      })
      .optional(),
    namedZoneHumidityRatioAdjustments: z
      .object({
        zoneNames: z.array(z.string()),
        values: z.array(z.number())
      })
      .optional(),
    elementAdjustments: z
      .array(
        z.object({
          pathId: z.number().int(),
          elementIndex: z.number().int()
        })
      )
      .optional(),
    namedElementAdjustments: z
      .array(
        z.object({
          pathId: z.number().int().optional(),
          pathSelectorLabel: z.string().optional(),
          fromZoneName: z.string().optional(),
          toZoneName: z.string().optional(),
          elementIndex: z.number().int().optional(),
          elementName: z.string().optional()
        })
      )
      .optional(),
    ahspFlowAdjustments: z
      .object({
        pathIds: z.array(z.number().int()),
        values: z.array(z.number())
      })
      .optional(),
    ahsPoaAdjustments: z
      .object({
        ahsIds: z.array(z.number().int()),
        values: z.array(z.number())
      })
      .optional(),
    namedAhsPoaAdjustments: z
      .object({
        names: z.array(z.string()),
        values: z.array(z.number())
      })
      .optional(),
    weatherAdjustment: z
      .object({
        temperatureK: z.number(),
        pressurePa: z.number(),
        windSpeed: z.number(),
        windDirection: z.number(),
        humidityRatio: z.number().optional()
      })
      .optional(),
    namedAmbientPressureAdjustment: z
      .object({
        timeSeconds: z.number().int().optional(),
        ambientTargetNames: z.array(z.string()),
        values: z.array(z.number()),
        fillValue: z.number().optional()
      })
      .optional(),
    namedAmbientConcentrationAdjustments: z
      .array(
        z.object({
          timeSeconds: z.number().int().optional(),
          agentId: z.number().int().optional(),
          agentName: z.string().optional(),
          ambientTargetNames: z.array(z.string()),
          values: z.array(z.number()),
          fillValue: z.number().optional()
        })
      )
      .optional(),
    wpcAdjustment: z
      .object({
        timeSeconds: z.number().int().optional(),
        agentIds: z.array(z.number().int()).optional(),
        values: z.array(z.number())
      })
      .optional(),
    timeoutSeconds: z.number().int().min(1).max(300).optional()
  },
  async ({
    sessionId,
    targetTimeSeconds,
    advanceBySeconds,
    requestConcentrations,
    requestPathFlows,
    requestTermFlows,
    requestAhspFlows,
    requestDuctFlows,
    requestLeakFlows,
    requestOutputControlValues,
    controlNodeAdjustments,
    namedControlNodeAdjustments,
    zoneConcentrationAdjustments,
    namedZoneConcentrationAdjustments,
    zoneTemperatureAdjustments,
    namedZoneTemperatureAdjustments,
    junctionTemperatureAdjustments,
    namedJunctionTemperatureAdjustments,
    zoneHumidityRatioAdjustments,
    namedZoneHumidityRatioAdjustments,
    elementAdjustments,
    namedElementAdjustments,
    ahspFlowAdjustments,
    ahsPoaAdjustments,
    namedAhsPoaAdjustments,
    weatherAdjustment,
    namedAmbientPressureAdjustment,
    namedAmbientConcentrationAdjustments,
    wpcAdjustment,
    timeoutSeconds
  }) => {
    const session = bridgeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Bridge session not found: ${sessionId}`);
    }

    const optionFlags =
      (requestConcentrations ? 2 : 0) +
      (requestPathFlows ? 4 : 0) +
      (requestAhspFlows ? 8 : 0) +
      (requestDuctFlows ? 16 : 0) +
      (requestTermFlows ? 32 : 0) +
      (requestLeakFlows ? 64 : 0) +
      (requestOutputControlValues ? 128 : 0);

    let resolvedTargetTime = targetTimeSeconds ?? null;
    if (resolvedTargetTime === null && advanceBySeconds !== undefined) {
      resolvedTargetTime = (session.readyTimeSeconds ?? 0) + advanceBySeconds;
    }

    const resolvedControlNodeAdjustments = resolveControlNodeAdjustments(
      session.bridgeMetadata,
      controlNodeAdjustments,
      namedControlNodeAdjustments
    );
    const resolvedZoneConcentrationAdjustments = resolveZoneConcentrationAdjustments(
      session.bridgeMetadata,
      zoneConcentrationAdjustments,
      namedZoneConcentrationAdjustments
    );
    const resolvedZoneTemperatureAdjustments = mergeNamedZoneArrayAdjustment(
      session.bridgeMetadata,
      zoneTemperatureAdjustments,
      namedZoneTemperatureAdjustments
    );
    const resolvedJunctionTemperatureAdjustments = mergeNamedJunctionArrayAdjustment(
      session.bridgeMetadata,
      junctionTemperatureAdjustments,
      namedJunctionTemperatureAdjustments
    );
    const resolvedZoneHumidityRatioAdjustments = mergeNamedZoneArrayAdjustment(
      session.bridgeMetadata,
      zoneHumidityRatioAdjustments,
      namedZoneHumidityRatioAdjustments
    );
    const resolvedElementAdjustments = resolveElementAdjustments(
      session.bridgeMetadata,
      elementAdjustments,
      namedElementAdjustments
    );
    const resolvedAhsPoaAdjustments = mergeNamedIdArrayAdjustment(
      ahsPoaAdjustments,
      namedAhsPoaAdjustments,
      "ahsIds",
      "values",
      (name) =>
        resolveEntityByName(
          session.bridgeMetadata.ahsSystems ?? [],
          name,
          (item) => item.name,
          "AHS",
          (item) => `${item.id}:${item.name}`
        ).id
    );
    if (
      wpcAdjustment &&
      ((namedAmbientConcentrationAdjustments?.length ?? 0) > 0 || namedAmbientPressureAdjustment)
    ) {
      throw new Error(
        "Provide either wpcAdjustment or the named ambient ADJ_WPC helpers, not both."
      );
    }
    if (namedAmbientPressureAdjustment && (namedAmbientConcentrationAdjustments?.length ?? 0) > 0) {
      throw new Error(
        "Provide either namedAmbientPressureAdjustment or namedAmbientConcentrationAdjustments in one call."
      );
    }
    const resolvedWpcAdjustments = wpcAdjustment
      ? [wpcAdjustment]
      : namedAmbientPressureAdjustment
        ? [buildNamedAmbientPressureAdjustment(session.bridgeMetadata, namedAmbientPressureAdjustment)]
        : buildNamedAmbientConcentrationAdjustments(
            session.bridgeMetadata,
            namedAmbientConcentrationAdjustments
          );

    if (resolvedTargetTime === null) {
      await session.applyAdjustments({
        controlNodeAdjustments: resolvedControlNodeAdjustments,
        weatherAdjustment,
        zoneConcentrationAdjustments: resolvedZoneConcentrationAdjustments,
        zoneTemperatureAdjustments: resolvedZoneTemperatureAdjustments,
        junctionTemperatureAdjustments: resolvedJunctionTemperatureAdjustments,
        zoneHumidityRatioAdjustments: resolvedZoneHumidityRatioAdjustments,
        elementAdjustments: resolvedElementAdjustments,
        ahspFlowAdjustments,
        ahsPoaAdjustments: resolvedAhsPoaAdjustments,
        wpcAdjustments: resolvedWpcAdjustments
      });
      return toolResponse("Applied bridge adjustments without advancing ContamX.", session.getSummary());
    }

    const cycle = await session.advance({
      targetTimeSeconds: resolvedTargetTime,
      optionFlags,
      controlNodeAdjustments: resolvedControlNodeAdjustments,
      weatherAdjustment,
      zoneConcentrationAdjustments: resolvedZoneConcentrationAdjustments,
      zoneTemperatureAdjustments: resolvedZoneTemperatureAdjustments,
      junctionTemperatureAdjustments: resolvedJunctionTemperatureAdjustments,
      zoneHumidityRatioAdjustments: resolvedZoneHumidityRatioAdjustments,
      elementAdjustments: resolvedElementAdjustments,
      ahspFlowAdjustments,
      ahsPoaAdjustments: resolvedAhsPoaAdjustments,
      wpcAdjustments: resolvedWpcAdjustments,
      timeoutSeconds: timeoutSeconds ?? 30
    });

    return toolResponse("Advanced the ContamX bridge session.", {
      sessionId,
      targetTimeSeconds: resolvedTargetTime,
      readyTimeSeconds: session.readyTimeSeconds,
      optionFlags,
      updates: cycle.messages.filter((message) => message.type >= bridgeMessageTypes.CONC_UPDATE),
      summary: session.getSummary()
    });
  }
);

server.tool(
  "close_contam_bridge_session",
  "Use this when you want to end an active ContamX bridge-mode session and release the spawned process and socket.",
  {
    sessionId: z.string()
  },
  async ({ sessionId }) => {
    const session = bridgeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Bridge session not found: ${sessionId}`);
    }

    const summary = session.getSummary();
    bridgeSessions.delete(sessionId);
    await session.close();

    return toolResponse("Closed the ContamX bridge session.", summary);
  }
);

server.tool(
  "run_contam_simulation",
  "Use this when you want to validate or run a CONTAM .prj model with ContamX and collect the generated files.",
  {
    projectPath: z.string(),
    workingDirectory: z.string().optional(),
    timeoutSeconds: z.number().int().min(1).max(3600).optional(),
    testInputOnly: z.boolean().optional(),
    bridgeAddress: z.string().optional(),
    windFromBridge: z.boolean().optional(),
    volumeFlowBridge: z.boolean().optional()
  },
  async ({
    projectPath,
    workingDirectory,
    timeoutSeconds,
    testInputOnly,
    bridgeAddress,
    windFromBridge,
    volumeFlowBridge
  }) => {
    const executablePath = await resolveExecutable("contamx");
    const resolvedProjectPath = asAbsolutePath(projectPath);

    if (!(await fileExists(resolvedProjectPath))) {
      throw new Error(`Project file not found: ${resolvedProjectPath}`);
    }

    const projectDirectory = path.dirname(resolvedProjectPath);
    const resolvedWorkingDirectory = asAbsolutePath(workingDirectory ?? projectDirectory);
    const args = [resolvedProjectPath];

    if (testInputOnly) {
      args.push("-t");
    }
    if (bridgeAddress) {
      args.push("-b", bridgeAddress);
    }
    if (windFromBridge) {
      args.push("-w");
    }
    if (volumeFlowBridge) {
      args.push("-f");
    }

    const before = await snapshotDirectory(projectDirectory);
    const result = await runProcess(executablePath, args, {
      cwd: resolvedWorkingDirectory,
      timeoutSeconds: timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    });
    const after = await snapshotDirectory(projectDirectory);

    return toolResponse(
      result.ok ? "ContamX completed successfully." : "ContamX finished with errors or a non-zero exit code.",
      {
        executablePath,
        projectPath: resolvedProjectPath,
        workingDirectory: resolvedWorkingDirectory,
        args,
        ...result,
        fileChanges: diffSnapshots(before, after),
        artifacts: await collectProjectArtifacts(resolvedProjectPath)
      }
    );
  }
);

server.tool(
  "upgrade_contam_project",
  "Use this when you need to upgrade an older .prj file to a newer CONTAM project format using prjup.",
  {
    projectPath: z.string(),
    targetVersion: z.string().optional(),
    createBackup: z.boolean().optional(),
    timeoutSeconds: z.number().int().min(1).max(600).optional()
  },
  async ({ projectPath, targetVersion, createBackup, timeoutSeconds }) => {
    const executablePath = await resolveExecutable("prjup");
    const resolvedProjectPath = asAbsolutePath(projectPath);

    if (!(await fileExists(resolvedProjectPath))) {
      throw new Error(`Project file not found: ${resolvedProjectPath}`);
    }

    const projectDirectory = path.dirname(resolvedProjectPath);
    const before = await snapshotDirectory(projectDirectory);
    const args = [resolvedProjectPath];

    if (createBackup === false) {
      args.push("-n");
    }
    if (targetVersion) {
      args.push(`--projectversion=${targetVersion}`);
    }

    const result = await runProcess(executablePath, args, {
      cwd: projectDirectory,
      timeoutSeconds: timeoutSeconds ?? 60
    });
    const after = await snapshotDirectory(projectDirectory);

    return toolResponse(
      result.ok ? "prjup completed successfully." : "prjup finished with errors or a non-zero exit code.",
      {
        executablePath,
        projectPath: resolvedProjectPath,
        args,
        ...result,
        fileChanges: diffSnapshots(before, after)
      }
    );
  }
);

server.tool(
  "compare_contam_sim_results",
  "Use this when you want to compare two CONTAM .sim result files with simcomp.",
  {
    firstSimPath: z.string(),
    secondSimPath: z.string(),
    verbosity: z.number().int().min(0).max(3).optional(),
    timeoutSeconds: z.number().int().min(1).max(600).optional()
  },
  async ({ firstSimPath, secondSimPath, verbosity, timeoutSeconds }) => {
    const executablePath = await resolveExecutable("simcomp");
    const resolvedFirstPath = asAbsolutePath(firstSimPath);
    const resolvedSecondPath = asAbsolutePath(secondSimPath);

    for (const filePath of [resolvedFirstPath, resolvedSecondPath]) {
      if (!(await fileExists(filePath))) {
        throw new Error(`SIM file not found: ${filePath}`);
      }
    }

    const args = [resolvedFirstPath, resolvedSecondPath, String(verbosity ?? 1)];
    const result = await runProcess(executablePath, args, {
      cwd: path.dirname(resolvedFirstPath),
      timeoutSeconds: timeoutSeconds ?? 60
    });

    return toolResponse(
      result.ok ? "simcomp completed successfully." : "simcomp finished with errors or a non-zero exit code.",
      {
        executablePath,
        firstSimPath: resolvedFirstPath,
        secondSimPath: resolvedSecondPath,
        args,
        ...result
      }
    );
  }
);

server.tool(
  "export_contam_sim_text",
  "Use this when you need to run simread on a .sim file and you already know the response-script text needed for the interactive prompts.",
  {
    simPath: z.string(),
    responsesText: z.string().optional(),
    responsesFilePath: z.string().optional(),
    timeoutSeconds: z.number().int().min(1).max(3600).optional()
  },
  async ({ simPath, responsesText, responsesFilePath, timeoutSeconds }) => {
    if (!responsesText && !responsesFilePath) {
      throw new Error("Provide either responsesText or responsesFilePath. simread is interactive, so MCP usage must supply a response script.");
    }

    const executablePath = await resolveExecutable("simread");
    const resolvedSimPath = asAbsolutePath(simPath);

    if (!(await fileExists(resolvedSimPath))) {
      throw new Error(`SIM file not found: ${resolvedSimPath}`);
    }

    const resolvedResponsesFilePath = responsesFilePath ? asAbsolutePath(responsesFilePath) : null;
    const inputText =
      responsesText ??
      normalizeText(await readFile(resolvedResponsesFilePath, { encoding: "utf8" })).concat("\n");

    const simDirectory = path.dirname(resolvedSimPath);
    const before = await snapshotDirectory(simDirectory);
    const result = await runProcess(executablePath, [resolvedSimPath], {
      cwd: simDirectory,
      timeoutSeconds: timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      stdinText: inputText.endsWith("\n") ? inputText : `${inputText}\n`
    });
    const after = await snapshotDirectory(simDirectory);

    return toolResponse(
      result.ok ? "simread completed successfully." : "simread finished with errors or a non-zero exit code.",
      {
        executablePath,
        simPath: resolvedSimPath,
        responsesSource: resolvedResponsesFilePath ?? "inline responsesText",
        ...result,
        fileChanges: diffSnapshots(before, after)
      }
    );
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
