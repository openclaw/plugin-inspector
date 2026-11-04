import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { x as extractTar } from "tar";

const registry = "https://registry.npmjs.org";

/**
 * Download one published npm package version, verify it against the registry's
 * dist.integrity, and unpack the entries `filter` accepts into `destination`.
 * Returns the unpacked package root (`destination/package`).
 */
export async function downloadNpmPackage(name, version, destination, { filter = () => true } = {}) {
  const metadataResponse = await fetch(`${registry}/${name.replace("/", "%2F")}/${encodeURIComponent(version)}`);
  if (!metadataResponse.ok) throw new Error(`${name}@${version}: npm metadata HTTP ${metadataResponse.status}`);
  const { dist } = await metadataResponse.json();
  const archiveResponse = await fetch(dist.tarball);
  if (!archiveResponse.ok) throw new Error(`${name}@${version}: npm tarball HTTP ${archiveResponse.status}`);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const [algorithm, expected] = String(dist.integrity ?? "").split("-");
  if (algorithm !== "sha512" || createHash("sha512").update(archive).digest("base64") !== expected) {
    throw new Error(`${name}@${version}: tarball failed integrity verification`);
  }
  await mkdir(destination, { recursive: true });
  const scratch = await mkdtemp(path.join(destination, ".download-"));
  try {
    const archivePath = path.join(scratch, "package.tgz");
    await writeFile(archivePath, archive);
    await extractTar({ file: archivePath, cwd: destination, filter: (entry) => filter(entry) });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return path.join(destination, "package");
}

/** Exactly the files a packed OpenClaw target surface reads (what ClawHub keeps). */
export function isPackedOpenClawSurfaceEntry(entry) {
  return entry === "package/package.json" || (entry.startsWith("package/dist/") && /\.d\.[cm]?ts$/.test(entry));
}
