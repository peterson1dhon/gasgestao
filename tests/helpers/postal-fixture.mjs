import { DatabaseSync } from "node:sqlite";
export function createPostalFixture(filename) {
  const db = new DatabaseSync(filename);
  db.exec(
    "CREATE TABLE addresses(cep TEXT,street TEXT,neighborhood TEXT,city TEXT,uf TEXT); CREATE INDEX addresses_cep ON addresses(cep);",
  );
  const insert = db.prepare("INSERT INTO addresses VALUES(?,?,?,?,?)");
  insert.run(
    "12345678",
    "Rua de Teste Offline",
    "Bairro Teste",
    "Cidade Teste",
    "SP",
  );
  insert.run("12345000", "Rua Alternativa A", "Bairro A", "Cidade Teste", "SP");
  insert.run("12345000", "Rua Alternativa B", "Bairro B", "Cidade Teste", "SP");
  db.close();
}
