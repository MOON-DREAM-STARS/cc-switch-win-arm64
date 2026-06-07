import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const env = { ...process.env };

function hasLibclang(dir) {
  return Boolean(dir) && existsSync(join(dir, "libclang.dll"));
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

function collectVisualStudioLlvmDirs() {
  const archPreference =
    process.arch === "arm64" ? ["ARM64", "x64"] : ["x64", "ARM64"];
  const roots = [
    "C:\\Program Files\\Microsoft Visual Studio",
    "D:\\Program Files\\Microsoft Visual Studio",
  ];

  const dirs = [];

  for (const root of roots) {
    for (const versionDir of listDirs(root)) {
      for (const editionDir of listDirs(versionDir)) {
        for (const arch of archPreference) {
          dirs.push(join(editionDir, "VC", "Tools", "Llvm", arch, "bin"));
        }
      }
    }
  }

  return dirs;
}

function findLibclangPath() {
  if (hasLibclang(env.LIBCLANG_PATH)) {
    return env.LIBCLANG_PATH;
  }

  const pathDirs = (env.Path || env.PATH || "")
    .split(delimiter)
    .filter(Boolean);
  const candidates = [...pathDirs, ...collectVisualStudioLlvmDirs()];

  return candidates.find(hasLibclang);
}

if (process.platform === "win32") {
  const libclangPath = findLibclangPath();
  if (libclangPath) {
    env.LIBCLANG_PATH = libclangPath;
    env.Path = [libclangPath, env.Path || env.PATH || ""]
      .filter(Boolean)
      .join(delimiter);
    console.log(`[tauri-env] LIBCLANG_PATH=${libclangPath}`);
  } else {
    console.warn(
      "[tauri-env] libclang.dll was not found. rquickjs bindgen may fail unless LIBCLANG_PATH is set.",
    );
  }
}

const localTauri = join(
  process.cwd(),
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const tauriBin = existsSync(localTauri) ? localTauri : "tauri";

const child =
  tauriBin === localTauri
    ? spawn(process.execPath, [tauriBin, ...args], {
        stdio: "inherit",
        env,
        shell: false,
      })
    : spawn(tauriBin, args, {
        stdio: "inherit",
        env,
        shell: process.platform === "win32",
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});