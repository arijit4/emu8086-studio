import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packagePath = new URL("package.json", root);
const lockPath = new URL("package-lock.json", root);
const tauriPath = new URL("src-tauri/tauri.conf.json", root);

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const packageJson = await readJson(packagePath);
const version = packageJson.version;

const lockJson = await readJson(lockPath);
lockJson.version = version;
if (lockJson.packages?.[""]) lockJson.packages[""].version = version;

const tauriJson = await readJson(tauriPath);
tauriJson.version = version;

await Promise.all([writeJson(lockPath, lockJson), writeJson(tauriPath, tauriJson)]);
