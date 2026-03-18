import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function getRepoRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

function getTrackedFiles(repoRoot) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function countLinesBefore(text, index) {
  let count = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      count += 1;
    }
  }
  return count;
}

function makeSnippet(text, index) {
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1);
  const lineEndIndex = text.indexOf("\n", index);
  const end = lineEndIndex === -1 ? text.length : lineEndIndex;
  return text.slice(start, end).trim();
}

const repoRoot = getRepoRoot();
const patterns = [
  {
    name: "Windows user profile path",
    regex: /[A-Za-z]:\\Users\\[^\\\r\n]+(?:\\[^\r\n]*)?/g,
  },
  {
    name: "POSIX home directory path",
    regex: /\/(?:Users|home)\/[^/\r\n]+(?:\/[^\r\n]*)?/g,
  },
];

const findings = [];

for (const relativePath of getTrackedFiles(repoRoot)) {
  const fullPath = path.join(repoRoot, relativePath);
  const content = readFileSync(fullPath).toString("latin1");

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const index = match.index ?? 0;
      findings.push({
        file: relativePath,
        line: countLinesBefore(content, index),
        type: pattern.name,
        snippet: makeSnippet(content, index),
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Repository privacy check failed. Found probable personal filesystem paths:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.type}] ${finding.snippet}`);
  }
  process.exit(1);
}

console.log("Repository privacy check passed. No personal filesystem paths found in tracked files.");
