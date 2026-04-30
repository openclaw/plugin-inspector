import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeArtifacts(artifacts, options = {}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new TypeError("writeArtifacts requires at least one artifact");
  }

  const written = {};
  for (const artifact of artifacts) {
    const artifactPath = artifact.path;
    if (!artifactPath) {
      throw new TypeError("artifact.path is required");
    }

    const content = renderArtifactContent(artifact);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, content, "utf8");

    if (options.check || artifact.check) {
      await assertFileMatches(artifactPath, content);
    }

    if (artifact.name) {
      written[artifact.name] = artifactPath;
    }
  }

  return written;
}

export async function writeJsonMarkdownArtifacts({ jsonPath, markdownPath, json, markdown, check = false }) {
  await writeArtifacts(
    [
      { name: "jsonPath", path: jsonPath, json },
      { name: "markdownPath", path: markdownPath, markdown },
    ],
    { check },
  );
  return { jsonPath, markdownPath };
}

export function renderArtifactContent(artifact) {
  if ("content" in artifact) {
    return String(artifact.content);
  }
  if ("json" in artifact) {
    return `${JSON.stringify(artifact.json, null, 2)}\n`;
  }
  if ("markdown" in artifact) {
    return `${artifact.markdown}\n`;
  }
  throw new TypeError("artifact must provide content, json, or markdown");
}

export function renderMarkdownTable(rows, headers, options = {}) {
  if (rows.length === 0 && options.empty != null) {
    return options.empty;
  }

  const nullValue = options.nullValue ?? "";
  const escape = options.escape !== false;
  const normalizedRows = [headers, ...rows].map((row) =>
    row.map((cell) => {
      const value = String(cell ?? nullValue);
      return escape ? escapeMarkdownTableCell(value) : value;
    }),
  );

  if (options.padding) {
    const widths = headers.map((_, columnIndex) =>
      Math.max(...normalizedRows.map((row) => row[columnIndex].length)),
    );
    const renderRow = (row) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
    return [
      renderRow(normalizedRows[0]),
      renderRow(widths.map((width) => "-".repeat(width))),
      ...normalizedRows.slice(1).map(renderRow),
    ].join("\n");
  }

  const separator = headers.map(() => options.separator ?? "---");
  return [normalizedRows[0], separator, ...normalizedRows.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

export function renderPaddedMarkdownTable(rows, headers, options = {}) {
  return renderMarkdownTable(rows, headers, {
    empty: "_none_",
    escape: false,
    padding: true,
    ...options,
  });
}

export function escapeMarkdownTableCell(value) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

async function assertFileMatches(filePath, expected) {
  try {
    const actual = await readFile(filePath, "utf8");
    if (actual !== expected) {
      throw new Error(`${filePath} is not up to date`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${filePath} is missing`);
    }
    throw error;
  }
}
