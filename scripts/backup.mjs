import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = process.env.COURSEIT_DATA_DIR
  ? path.resolve(process.env.COURSEIT_DATA_DIR)
  : path.join(process.cwd(), "data");
const dbPath = process.env.COURSEIT_DB
  ? path.resolve(process.env.COURSEIT_DB)
  : path.join(dataDir, "courseit.db");
const backupDir = path.join(dataDir, "backups");

if (!fs.existsSync(dbPath)) {
  console.error(`No database found at ${dbPath}. Start the app once first.`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(backupDir, `courseit-${stamp}.db`);
fs.copyFileSync(dbPath, target);
db.close();

const files = fs
  .readdirSync(backupDir)
  .filter((file) => file.startsWith("courseit-") && file.endsWith(".db"))
  .sort();
while (files.length > 14) {
  const oldest = files.shift();
  if (oldest) fs.unlinkSync(path.join(backupDir, oldest));
}

console.log(`Backup written to ${target}`);
console.log(`Snapshots kept: ${Math.min(files.length, 14)} + this one`);
