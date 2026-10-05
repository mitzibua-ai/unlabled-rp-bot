const fs = require("fs");
const { spawnSync } = require("child_process");

const env = fs.readFileSync(".env", "utf8");
let n = 0;

for (const raw of env.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i <= 0) continue;
  const key = line.slice(0, i).trim();
  let val = line.slice(i + 1);
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (!key) continue;
  if (!val) {
    console.log("Skip empty", key);
    continue;
  }
  const railwayJs =
    "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@railway\\cli\\bin\\railway.js";
  let r;
  for (let attempt = 1; attempt <= 6; attempt++) {
    r = spawnSync(
      process.execPath,
      [
        railwayJs,
        "variable",
        "--service",
        "bot",
        "set",
        `${key}=${val}`,
        "--skip-deploys",
      ],
      { encoding: "utf8", windowsHide: true }
    );
    if (r.status === 0) break;
    const err = String(r.stderr || r.stdout || "");
    if (attempt === 6) {
      console.error("FAILED", key, err.replace(val, "[redacted]").slice(0, 400));
      process.exit(1);
    }
    const wait = attempt * 2000;
    console.log("Retry", key, "in", wait, "ms");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  }
  console.log("Set", key);
  n++;
}

const r2 = spawnSync(
  process.execPath,
  [
    "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@railway\\cli\\bin\\railway.js",
    "variable",
    "--service",
    "bot",
    "set",
    "NODE_ENV=production",
    "--skip-deploys",
  ],
  { encoding: "utf8", windowsHide: true }
);
if (r2.status !== 0) {
  console.error("FAILED NODE_ENV");
  process.exit(1);
}
console.log("Set NODE_ENV");
console.log("Imported", n + 1, "keys");
