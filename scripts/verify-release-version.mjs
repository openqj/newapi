import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag?.match(/^v\d+\.\d+\.\d+$/)) {
  throw new Error("Provide a release tag in the form vX.Y.Z.");
}

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargoMetadata = JSON.parse(execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
  cwd: "src-tauri",
  encoding: "utf8",
}));
const cargoVersion = cargoMetadata.packages.find((pkg) => pkg.name === "relayhub")?.version;
const expectedVersion = tag.slice(1);
const mismatches = [
  ["package.json", packageVersion],
  ["src-tauri/tauri.conf.json", tauriVersion],
  ["src-tauri/Cargo.toml", cargoVersion],
].filter(([, version]) => version !== expectedVersion);

if (mismatches.length) {
  throw new Error(`Release tag ${tag} does not match ${mismatches.map(([file, version]) => `${file} (${version})`).join(", ")}.`);
}

console.log(`Release version ${expectedVersion} is consistent across package manifests.`);
