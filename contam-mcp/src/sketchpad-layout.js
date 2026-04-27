import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_WALL_ICON = {
  topLeft: 14,
  topRight: 15,
  bottomRight: 16,
  bottomLeft: 17
};
const ZONE_ICON = 5;
const AIRFLOW_PATH_ICON = 23;
const SOURCE_SINK_ICON = 133;

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

async function readProjectLines(projectPath) {
  const text = await readFile(projectPath, { encoding: "utf8" });
  return text.replace(/\r\n/g, "\n").split("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findCountSection(lines, label) {
  const matcher = new RegExp(`^\\s*(\\d+)\\s+!\\s*${escapeRegExp(label)}:\\s*$`, "i");
  const headerIndex = lines.findIndex((line) => matcher.test(line.trim()));

  if (headerIndex === -1) {
    return null;
  }

  const count = Number(lines[headerIndex].trim().match(matcher)[1]);
  let endIndex = headerIndex + 1;

  while (endIndex < lines.length && lines[endIndex].trim() !== "-999") {
    endIndex += 1;
  }

  if (endIndex >= lines.length) {
    throw new Error(`Could not find the -999 terminator for section '${label}'.`);
  }

  return {
    label,
    count,
    headerIndex,
    endIndex
  };
}

function parseNumericToken(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric value for ${fieldName}: ${value}`);
  }
  return number;
}

function parseProjectZones(lines) {
  const section = findCountSection(lines, "zones");
  const zones = [];

  if (!section) {
    return zones;
  }

  for (let index = section.headerIndex + 1; index < section.endIndex; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("!")) {
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 11) {
      continue;
    }

    const id = Number(tokens[0]);
    const level = Number(tokens[5]);
    if (!Number.isInteger(id) || !Number.isInteger(level)) {
      continue;
    }

    zones.push({
      id,
      level,
      name: tokens[10]
    });
  }

  return zones;
}

function parseProjectFlowPaths(lines) {
  const section = findCountSection(lines, "flow paths");
  const paths = [];

  if (!section) {
    return paths;
  }

  for (let index = section.headerIndex + 1; index < section.endIndex; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("!")) {
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 11) {
      continue;
    }

    const id = Number(tokens[0]);
    const fromZone = Number(tokens[2]);
    const toZone = Number(tokens[3]);
    const level = Number(tokens[10]);
    if (!Number.isInteger(id) || !Number.isInteger(level)) {
      continue;
    }

    paths.push({
      id,
      fromZone,
      toZone,
      level
    });
  }

  return paths;
}

function parseProjectSourceSinks(lines, zoneById) {
  const section = findCountSection(lines, "source/sinks");
  const sourceSinks = [];

  if (!section) {
    return sourceSinks;
  }

  for (let index = section.headerIndex + 1; index < section.endIndex; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("!")) {
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 2) {
      continue;
    }

    const id = Number(tokens[0]);
    const zoneId = Number(tokens[1]);
    if (!Number.isInteger(id)) {
      continue;
    }

    sourceSinks.push({
      id,
      zoneId,
      level: zoneById.get(zoneId)?.level ?? 1
    });
  }

  return sourceSinks;
}

function parseExistingLevels(lines) {
  const section = findCountSection(lines, "levels plus icon data");
  const levels = [];

  if (!section) {
    return {
      section: null,
      levels
    };
  }

  let index = section.headerIndex + 1;
  if (lines[index]?.trim().startsWith("!")) {
    index += 1;
  }

  while (index < section.endIndex) {
    const line = lines[index].trim();
    if (!line || line.startsWith("!")) {
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1]?.trim() ?? "";
    if (!nextLine.toLowerCase().startsWith("!icn")) {
      index += 1;
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 6) {
      index += 1;
      continue;
    }

    const id = Number(tokens[0]);
    const refHt = Number(tokens[1]);
    const delHt = Number(tokens[2]);
    const ni = Number(tokens[3]);
    const tail = tokens.slice(4).join(" ");
    const icons = [];
    index += 2;

    while (index < section.endIndex) {
      const iconLine = lines[index].trim();
      const maybeLevelTokens = iconLine.split(/\s+/);
      const maybeNextLine = lines[index + 1]?.trim() ?? "";
      if (maybeNextLine.toLowerCase().startsWith("!icn") && maybeLevelTokens.length >= 6) {
        break;
      }
      if (iconLine && !iconLine.startsWith("!")) {
        const iconTokens = iconLine.split(/\s+/);
        if (iconTokens.length >= 4) {
          icons.push({
            icon: Number(iconTokens[0]),
            col: Number(iconTokens[1]),
            row: Number(iconTokens[2]),
            number: Number(iconTokens[3])
          });
        }
      }
      index += 1;
    }

    levels.push({
      id,
      refHt,
      delHt,
      ni,
      tail,
      icons
    });
  }

  return {
    section,
    levels
  };
}

function normalizeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return number;
}

function normalizeRoom(room) {
  const normalized = {
    zoneId: normalizeInteger(room.zoneId, "room.zoneId"),
    level: normalizeInteger(room.level, "room.level"),
    left: normalizeInteger(room.left, "room.left"),
    top: normalizeInteger(room.top, "room.top"),
    right: normalizeInteger(room.right, "room.right"),
    bottom: normalizeInteger(room.bottom, "room.bottom")
  };

  if (normalized.left >= normalized.right || normalized.top >= normalized.bottom) {
    throw new Error(`Room for zone ${normalized.zoneId} must have left < right and top < bottom.`);
  }

  return normalized;
}

function normalizeIcon(icon, defaultIcon, fieldName) {
  return {
    icon: normalizeInteger(icon.icon ?? defaultIcon, `${fieldName}.icon`),
    col: normalizeInteger(icon.col, `${fieldName}.col`),
    row: normalizeInteger(icon.row, `${fieldName}.row`),
    number: normalizeInteger(icon.number ?? icon.id ?? 0, `${fieldName}.number`)
  };
}

function centerOfRoom(room) {
  return {
    col: Math.round((room.left + room.right) / 2),
    row: Math.round((room.top + room.bottom) / 2)
  };
}

function topEdgeOfRoom(room, ordinal = 0) {
  const width = Math.max(1, room.right - room.left);
  const col = Math.min(room.right - 1, room.left + 1 + (ordinal % Math.max(1, width - 1)));
  return {
    col,
    row: room.top
  };
}

function midpoint(left, right) {
  return {
    col: Math.round((left.col + right.col) / 2),
    row: Math.round((left.row + right.row) / 2)
  };
}

function iconKey(icon) {
  return `${icon.col}:${icon.row}`;
}

function findFreeCell(col, row, occupied) {
  const candidates = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1]
  ];

  for (const [dCol, dRow] of candidates) {
    const candidate = {
      col: Math.max(1, col + dCol),
      row: Math.max(1, row + dRow)
    };
    if (!occupied.has(`${candidate.col}:${candidate.row}`)) {
      return candidate;
    }
  }

  let radius = 3;
  while (radius < 50) {
    for (let dCol = -radius; dCol <= radius; dCol += 1) {
      for (let dRow = -radius; dRow <= radius; dRow += 1) {
        const candidate = {
          col: Math.max(1, col + dCol),
          row: Math.max(1, row + dRow)
        };
        if (!occupied.has(`${candidate.col}:${candidate.row}`)) {
          return candidate;
        }
      }
    }
    radius += 1;
  }

  return {
    col,
    row
  };
}

function addIcon(icons, occupied, icon) {
  const adjusted = findFreeCell(icon.col, icon.row, occupied);
  const finalIcon = {
    ...icon,
    col: adjusted.col,
    row: adjusted.row
  };
  icons.push(finalIcon);
  occupied.add(iconKey(finalIcon));
  return finalIcon;
}

function addWallIcon(icons, wallSet, icon) {
  const key = `${icon.icon}:${icon.col}:${icon.row}:${icon.number}`;
  if (wallSet.has(key)) {
    return;
  }
  wallSet.add(key);
  icons.push(icon);
}

function buildRoomWallIcons(room) {
  return [
    { icon: DEFAULT_WALL_ICON.topLeft, col: room.left, row: room.top, number: 0 },
    { icon: DEFAULT_WALL_ICON.topRight, col: room.right, row: room.top, number: 0 },
    { icon: DEFAULT_WALL_ICON.bottomLeft, col: room.left, row: room.bottom, number: 0 },
    { icon: DEFAULT_WALL_ICON.bottomRight, col: room.right, row: room.bottom, number: 0 }
  ];
}

function buildPalettePosition(index, layout) {
  const left = layout.paletteLeft ?? 8;
  const row = layout.paletteRow ?? Math.max(4, (layout.sketchpadRows ?? 58) - 6);
  const colStep = layout.paletteColStep ?? 5;
  const rowStep = layout.paletteRowStep ?? 3;
  const perRow = layout.palettePerRow ?? 12;

  return {
    col: left + (index % perRow) * colStep,
    row: row + Math.floor(index / perRow) * rowStep
  };
}

function normalizeRequestedLevels(layout, existingLevels, zones) {
  const levelsById = new Map(existingLevels.map((level) => [level.id, level]));

  for (const zone of zones) {
    if (!levelsById.has(zone.level)) {
      levelsById.set(zone.level, {
        id: zone.level,
        refHt: (zone.level - 1) * 3,
        delHt: 3,
        ni: 0,
        tail: `0 0 level_${zone.level}`,
        icons: []
      });
    }
  }

  for (const requested of layout.levels ?? []) {
    const id = normalizeInteger(requested.id, "level.id");
    const existing = levelsById.get(id);
    const name = requested.name ?? `level_${id}`;
    levelsById.set(id, {
      id,
      refHt: requested.refHt ?? existing?.refHt ?? (id - 1) * 3,
      delHt: requested.delHt ?? existing?.delHt ?? 3,
      ni: 0,
      tail: requested.tail ?? existing?.tail ?? `0 0 ${name}`,
      icons: []
    });
  }

  return [...levelsById.values()].sort((left, right) => left.id - right.id);
}

function updateSketchpadSize(lines, layout, generatedIcons) {
  const headerIndex = lines.findIndex((line) => line.includes("! rows cols"));
  if (headerIndex !== -1 && lines[headerIndex + 1]) {
    const tokens = lines[headerIndex + 1].trim().split(/\s+/);
    if (tokens.length >= 2) {
      const maxRow = generatedIcons.reduce((accumulator, icon) => Math.max(accumulator, icon.row), 0);
      const maxCol = generatedIcons.reduce((accumulator, icon) => Math.max(accumulator, icon.col), 0);
      tokens[0] = String(layout.sketchpadRows ?? Math.max(Number(tokens[0]) || 0, maxRow + 4, 30));
      tokens[1] = String(layout.sketchpadCols ?? Math.max(Number(tokens[1]) || 0, maxCol + 4, 30));
      lines[headerIndex + 1] = `    ${tokens.join(" ")}`;
    }
  }

  const scaleIndex = lines.findIndex((line) => line.includes("!  scale") || line.includes("! scale"));
  if (scaleIndex !== -1 && lines[scaleIndex + 1]) {
    const tokens = lines[scaleIndex + 1].trim().split(/\s+/);
    if (tokens.length >= 6) {
      if (layout.scale !== undefined) {
        tokens[0] = Number(layout.scale).toExponential(3);
      }
      if (layout.scaleUnit !== undefined) {
        tokens[1] = String(normalizeInteger(layout.scaleUnit, "layout.scaleUnit"));
      }
      if (layout.originRow !== undefined) {
        tokens[2] = String(normalizeInteger(layout.originRow, "layout.originRow"));
      }
      if (layout.originCol !== undefined) {
        tokens[3] = String(normalizeInteger(layout.originCol, "layout.originCol"));
      }
      if (layout.invertYAxis !== undefined) {
        tokens[4] = layout.invertYAxis ? "1" : "0";
      }
      if (layout.showGeometry !== undefined) {
        tokens[5] = layout.showGeometry ? "1" : "0";
      }
      lines[scaleIndex + 1] = `  ${tokens.join(" ")}`;
    }
  }
}

function formatLevelLine(level, iconCount) {
  const id = String(level.id).padStart(3, " ");
  const refHt = Number(level.refHt).toFixed(3).padStart(7, " ");
  const delHt = Number(level.delHt).toFixed(3).padStart(7, " ");
  return `${id} ${refHt} ${delHt} ${String(iconCount)} ${level.tail}`;
}

function formatIconLine(icon) {
  return `${String(icon.icon).padStart(4, " ")} ${String(icon.col).padStart(3, " ")} ${String(icon.row).padStart(3, " ")} ${String(icon.number).padStart(3, " ")}`;
}

function buildLevelsSection(levels, iconsByLevel) {
  const output = [
    `${levels.length} ! levels plus icon data:`,
    "! #  refHt   delHt  ni  u  name"
  ];

  for (const level of levels) {
    const icons = (iconsByLevel.get(level.id) ?? []).sort(
      (left, right) => left.row - right.row || left.col - right.col || left.icon - right.icon || left.number - right.number
    );
    output.push(formatLevelLine(level, icons.length));
    output.push("!icn col row  #");
    output.push(...icons.map((icon) => formatIconLine(icon)));
  }

  output.push("-999");
  return output;
}

function validateKnownIds({ rooms, manualZoneIcons, manualPathIcons, manualSourceIcons, zoneById, pathById, sourceById, allowUnknownIds }) {
  const warnings = [];

  for (const room of rooms) {
    if (!zoneById.has(room.zoneId)) {
      const message = `Zone ${room.zoneId} from rooms is not present in the PRJ zones section.`;
      if (!allowUnknownIds) {
        throw new Error(message);
      }
      warnings.push(message);
    }
  }

  for (const icon of manualZoneIcons) {
    if (!zoneById.has(icon.number)) {
      const message = `Zone icon ${icon.number} is not present in the PRJ zones section.`;
      if (!allowUnknownIds) {
        throw new Error(message);
      }
      warnings.push(message);
    }
  }

  for (const icon of manualPathIcons) {
    if (!pathById.has(icon.number)) {
      const message = `Airflow path icon ${icon.number} is not present in the PRJ flow paths section.`;
      if (!allowUnknownIds) {
        throw new Error(message);
      }
      warnings.push(message);
    }
  }

  for (const icon of manualSourceIcons) {
    if (!sourceById.has(icon.number)) {
      const message = `Source/sink icon ${icon.number} is not present in the PRJ source/sinks section.`;
      if (!allowUnknownIds) {
        throw new Error(message);
      }
      warnings.push(message);
    }
  }

  return warnings;
}

function collectLayoutInputs(layout) {
  const rooms = [];
  const manualZoneIcons = [];
  const manualPathIcons = [];
  const manualSourceIcons = [];
  const extraIcons = [];

  for (const level of layout.levels ?? []) {
    const levelId = normalizeInteger(level.id, "level.id");
    for (const room of level.rooms ?? []) {
      rooms.push(normalizeRoom({ ...room, level: room.level ?? levelId }));
    }
    for (const icon of level.zoneIcons ?? []) {
      manualZoneIcons.push({ level: levelId, ...normalizeIcon(icon, ZONE_ICON, "zoneIcon") });
    }
    for (const icon of level.pathIcons ?? []) {
      manualPathIcons.push({ level: levelId, ...normalizeIcon(icon, AIRFLOW_PATH_ICON, "pathIcon") });
    }
    for (const icon of level.sourceSinkIcons ?? []) {
      manualSourceIcons.push({ level: levelId, ...normalizeIcon(icon, SOURCE_SINK_ICON, "sourceSinkIcon") });
    }
    for (const icon of level.icons ?? []) {
      extraIcons.push({ level: levelId, ...normalizeIcon(icon, icon.icon, "icon") });
    }
  }

  return {
    rooms,
    manualZoneIcons,
    manualPathIcons,
    manualSourceIcons,
    extraIcons
  };
}

function buildSketchpadIcons({ layout, zones, paths, sourceSinks, inputs }) {
  const roomByZoneId = new Map(inputs.rooms.map((room) => [room.zoneId, room]));
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const explicitPathIds = new Set(inputs.manualPathIcons.map((icon) => icon.number));
  const explicitSourceIds = new Set(inputs.manualSourceIcons.map((icon) => icon.number));
  const iconsByLevel = new Map();
  const summariesByLevel = new Map();
  const unplacedPathMode = layout.unplacedPathMode ?? "betweenZones";

  function ensureLevel(levelId) {
    if (!iconsByLevel.has(levelId)) {
      iconsByLevel.set(levelId, []);
      summariesByLevel.set(levelId, {
        wallIcons: 0,
        zoneIcons: 0,
        pathIcons: 0,
        sourceSinkIcons: 0,
        extraIcons: 0
      });
    }
    return iconsByLevel.get(levelId);
  }

  function summary(levelId) {
    ensureLevel(levelId);
    return summariesByLevel.get(levelId);
  }

  const occupiedByLevel = new Map();
  const wallSetsByLevel = new Map();
  function occupied(levelId) {
    if (!occupiedByLevel.has(levelId)) {
      occupiedByLevel.set(levelId, new Set());
    }
    return occupiedByLevel.get(levelId);
  }
  function wallSet(levelId) {
    if (!wallSetsByLevel.has(levelId)) {
      wallSetsByLevel.set(levelId, new Set());
    }
    return wallSetsByLevel.get(levelId);
  }

  if (layout.includeRoomWalls !== false) {
    for (const room of inputs.rooms) {
      const icons = ensureLevel(room.level);
      for (const wallIcon of buildRoomWallIcons(room)) {
        addWallIcon(icons, wallSet(room.level), wallIcon);
        summary(room.level).wallIcons += 1;
      }
    }
  }

  if (layout.includeRoomZoneIcons !== false) {
    for (const room of inputs.rooms) {
      const icons = ensureLevel(room.level);
      const center = centerOfRoom(room);
      addIcon(icons, occupied(room.level), {
        icon: ZONE_ICON,
        col: center.col,
        row: center.row,
        number: room.zoneId
      });
      summary(room.level).zoneIcons += 1;
    }
  }

  for (const icon of inputs.manualZoneIcons) {
    const icons = ensureLevel(icon.level);
    addIcon(icons, occupied(icon.level), icon);
    summary(icon.level).zoneIcons += 1;
  }

  for (const icon of inputs.manualPathIcons) {
    const icons = ensureLevel(icon.level);
    addIcon(icons, occupied(icon.level), icon);
    summary(icon.level).pathIcons += 1;
  }

  for (const icon of inputs.manualSourceIcons) {
    const icons = ensureLevel(icon.level);
    addIcon(icons, occupied(icon.level), icon);
    summary(icon.level).sourceSinkIcons += 1;
  }

  for (const icon of inputs.extraIcons) {
    const icons = ensureLevel(icon.level);
    addIcon(icons, occupied(icon.level), icon);
    summary(icon.level).extraIcons += 1;
  }

  if (layout.includeUnplacedPathIcons !== false && unplacedPathMode !== "omit") {
    const paletteCountsByLevel = new Map();
    for (const pathInfo of paths) {
      if (explicitPathIds.has(pathInfo.id)) {
        continue;
      }

      const fromRoom = roomByZoneId.get(pathInfo.fromZone);
      const toRoom = roomByZoneId.get(pathInfo.toZone);
      const fallbackZone = zoneById.get(pathInfo.fromZone) ?? zoneById.get(pathInfo.toZone);
      const level = fromRoom?.level ?? toRoom?.level ?? fallbackZone?.level ?? pathInfo.level ?? 1;
      let position = null;

      if (unplacedPathMode === "betweenZones" && fromRoom && toRoom && fromRoom.level === toRoom.level) {
        position = midpoint(centerOfRoom(fromRoom), centerOfRoom(toRoom));
      } else if (unplacedPathMode === "betweenZones" && (fromRoom || toRoom)) {
        const room = fromRoom ?? toRoom;
        const ordinal = paletteCountsByLevel.get(level) ?? 0;
        position = topEdgeOfRoom(room, ordinal);
      } else {
        const ordinal = paletteCountsByLevel.get(level) ?? 0;
        position = buildPalettePosition(ordinal, layout);
      }

      paletteCountsByLevel.set(level, (paletteCountsByLevel.get(level) ?? 0) + 1);
      const icons = ensureLevel(level);
      addIcon(icons, occupied(level), {
        icon: AIRFLOW_PATH_ICON,
        col: position.col,
        row: position.row,
        number: pathInfo.id
      });
      summary(level).pathIcons += 1;
    }
  }

  if (layout.includeUnplacedSourceSinkIcons !== false) {
    const placedSourceIds = new Set(inputs.manualSourceIcons.map((icon) => icon.number));
    for (const sourceSink of sourceSinks) {
      if (placedSourceIds.has(sourceSink.id)) {
        continue;
      }

      const room = roomByZoneId.get(sourceSink.zoneId);
      const level = room?.level ?? sourceSink.level ?? 1;
      const position = room ? centerOfRoom(room) : buildPalettePosition(summary(level).sourceSinkIcons, layout);
      const icons = ensureLevel(level);
      addIcon(icons, occupied(level), {
        icon: SOURCE_SINK_ICON,
        col: position.col + 1,
        row: position.row + 1,
        number: sourceSink.id
      });
      summary(level).sourceSinkIcons += 1;
    }
  }

  return {
    iconsByLevel,
    summariesByLevel
  };
}

export async function applyContamSketchpadLayout({
  projectPath,
  outputPath,
  createBackup = true,
  overwrite = false,
  allowUnknownIds = false,
  layout
}) {
  const resolvedProjectPath = asAbsolutePath(projectPath);
  if (!(await fileExists(resolvedProjectPath))) {
    throw new Error(`Project file not found: ${resolvedProjectPath}`);
  }

  const resolvedOutputPath = outputPath ? asAbsolutePath(outputPath, path.dirname(resolvedProjectPath)) : resolvedProjectPath;
  if (resolvedOutputPath !== resolvedProjectPath && (await fileExists(resolvedOutputPath)) && !overwrite) {
    throw new Error(`Output project already exists: ${resolvedOutputPath}`);
  }

  const lines = await readProjectLines(resolvedProjectPath);
  const { section, levels: existingLevels } = parseExistingLevels(lines);
  if (!section) {
    throw new Error(`Could not find 'levels plus icon data' section in ${resolvedProjectPath}.`);
  }

  const zones = parseProjectZones(lines);
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const paths = parseProjectFlowPaths(lines);
  const pathById = new Map(paths.map((item) => [item.id, item]));
  const sourceSinks = parseProjectSourceSinks(lines, zoneById);
  const sourceById = new Map(sourceSinks.map((item) => [item.id, item]));
  const inputs = collectLayoutInputs(layout ?? {});
  const warnings = validateKnownIds({
    rooms: inputs.rooms,
    manualZoneIcons: inputs.manualZoneIcons,
    manualPathIcons: inputs.manualPathIcons,
    manualSourceIcons: inputs.manualSourceIcons,
    zoneById,
    pathById,
    sourceById,
    allowUnknownIds
  });

  const levels = normalizeRequestedLevels(layout ?? {}, existingLevels, zones);
  const { iconsByLevel, summariesByLevel } = buildSketchpadIcons({
    layout: layout ?? {},
    zones,
    paths,
    sourceSinks,
    inputs
  });
  const allGeneratedIcons = [...iconsByLevel.values()].flat();
  const replacement = buildLevelsSection(levels, iconsByLevel);

  lines.splice(section.headerIndex, section.endIndex - section.headerIndex + 1, ...replacement);
  updateSketchpadSize(lines, layout ?? {}, allGeneratedIcons);

  if (resolvedOutputPath === resolvedProjectPath && createBackup) {
    const backupPath = `${resolvedProjectPath}.sketchpad.bak`;
    if (!(await fileExists(backupPath))) {
      await copyFile(resolvedProjectPath, backupPath);
    }
  }

  await writeFile(resolvedOutputPath, `${lines.join("\r\n")}\r\n`, { encoding: "utf8" });

  return {
    projectPath: resolvedProjectPath,
    outputPath: resolvedOutputPath,
    backupCreated: resolvedOutputPath === resolvedProjectPath && createBackup,
    counts: {
      zones: zones.length,
      flowPaths: paths.length,
      sourceSinks: sourceSinks.length,
      levels: levels.length,
      generatedIcons: allGeneratedIcons.length
    },
    levelSummaries: [...summariesByLevel.entries()].map(([level, summary]) => ({
      level,
      ...summary,
      totalIcons: (iconsByLevel.get(level) ?? []).length
    })),
    warnings
  };
}
