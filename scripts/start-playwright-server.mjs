import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const portIndex = process.argv.indexOf("--port");
const port = portIndex >= 0 ? process.argv[portIndex + 1] : "4173";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("A valid --port value is required.");
}

const usePreview = process.env.PLAYWRIGHT_USE_PREVIEW !== "false" && existsSync("dist/index.html");
const viteCli = resolve("node_modules/vite/bin/vite.js");
const viteArgs = [viteCli, ...(usePreview ? ["preview"] : []), "--host", "127.0.0.1", "--port", port];
const child = spawn(process.execPath, viteArgs, {
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

let shuttingDown = false;
const stopChild = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.killed) child.kill(signal);
};

process.once("SIGINT", () => stopChild("SIGINT"));
process.once("SIGTERM", () => stopChild("SIGTERM"));
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal && !shuttingDown) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
