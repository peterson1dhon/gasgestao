// Importação local autorizada; a base resultante fica fora do repositório.
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg)
  throw new Error("Uso: node scripts/import-cep.mjs origem.mdb destino.sqlite");
const source = resolve(sourceArg),
  target = resolve(targetArg);
if (existsSync(target))
  throw new Error(
    "O destino já existe. Escolha outro arquivo para preservar a base atual.",
  );
mkdirSync(dirname(target), { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "gasgestao-cep-"));
const partial = `${target}.partial`;
let db;
try {
  const output = join(temp, "enderecos.txt");
  const executable = join(
    process.env.SystemRoot || "C:\\Windows",
    "SysWOW64",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const result = spawnSync(
    executable,
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(dirname(fileURLToPath(import.meta.url)), "export-cep.ps1"),
      "-Source",
      source,
      "-Output",
      output,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 300000 },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      result.error?.message ||
        result.stderr ||
        "Falha na leitura da base de CEP.",
    );
  db = new DatabaseSync(partial);
  db.exec(
    "CREATE TABLE addresses(cep TEXT NOT NULL, street TEXT NOT NULL, neighborhood TEXT NOT NULL, city TEXT NOT NULL, uf TEXT NOT NULL); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); BEGIN;",
  );
  const insert = db.prepare("INSERT INTO addresses VALUES(?,?,?,?,?)");
  let imported = 0,
    skipped = 0;
  for (const row of readFileSync(output, "utf8").split("\x1e")) {
    if (!row) continue;
    const fields = row.split("\x1f").map((s) => s.trim());
    if (fields.length !== 6) {
      skipped++;
      continue;
    }
    const [cep, type, street, neighborhood, city, uf] = fields;
    if (!/^\d{8}$/.test(cep) || !city || !/^[A-Z]{2}$/.test(uf)) {
      skipped++;
      continue;
    }
    insert.run(
      cep,
      [type, street].filter(Boolean).join(" "),
      neighborhood,
      city,
      uf,
    );
    imported++;
  }
  if (!imported) throw new Error("Nenhum endereço válido foi encontrado.");
  db.exec("CREATE INDEX addresses_cep ON addresses(cep); COMMIT;");
  const meta = db.prepare("INSERT INTO metadata VALUES(?,?)");
  for (const [key, value] of Object.entries({
    source: "bdcep.mdb local",
    source_sha256: createHash("sha256")
      .update(readFileSync(source))
      .digest("hex"),
    imported_at: new Date().toISOString(),
    records: String(imported),
    skipped: String(skipped),
    freshness: "Data de atualização da origem não confirmada",
  }))
    meta.run(key, value);
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integrity !== "ok")
    throw new Error("Falha de integridade da base convertida.");
  db.close();
  db = null;
  renameSync(partial, target);
  console.log(
    JSON.stringify({ ok: true, imported, skipped, target, integrity }),
  );
} finally {
  db?.close();
  if (existsSync(partial)) rmSync(partial);
  rmSync(temp, { recursive: true, force: true });
}
