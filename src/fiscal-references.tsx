import { useEffect, useState } from "react";
import {
  api,
  request,
  amount,
  type FiscalReferenceCatalog,
  type FiscalReferencePreview,
  type Product,
} from "./api";
import { Field } from "./components";

export function FiscalReferencePanel() {
  const [catalog, setCatalog] = useState<FiscalReferenceCatalog | null>(null);
  const [selected, setSelected] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FiscalReferencePreview | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("1,00");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      request(api.fiscalReferences()),
      request(api.bootstrap()),
    ])
      .then(([data, state]) => {
        if (active) {
          setCatalog(data);
          setProducts(state.products.filter((p) => p.active));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const reference = catalog?.references.find((r) => r.id === selected);
  const value = (path: string) =>
    reference?.fields.find((f) => f.path === path)?.value || "";
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Referências fiscais gás e água">
      <p className="body-note">
        Importe XMLs já emitidos para consultar seus códigos e preparar
        parâmetros por produto. Importar ou vincular uma referência não habilita
        emissão nem altera pedidos, estoque ou caixa.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const result = await request(api.importFiscalReferences());
            if (result) {
              setCatalog(result);
              setNotice(`${result.added} referência(s) acrescentada(s).`);
              setPreview(null);
            }
          })
        }
      >
        Importar XMLs de referência
      </button>
      {!catalog ? (
        <p role="status">Lendo referências…</p>
      ) : (
        <>
          <p className="body-note">
            {catalog.references.length} item(ns) de referência. Códigos
            importados ficam no banco local e no backup; certificados e XMLs
            completos não são gravados nesse catálogo.
          </p>
          <Field label="Referência fiscal do produto">
            <select
              value={selected}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setPreview(null);
                setSearch("");
              }}
            >
              <option value="">Escolha um item para consultar</option>
              {catalog.references.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fields.find((f) => f.path === "prod/xProd")?.value} ·{" "}
                  {r.issuedAt.slice(0, 10)} · CFOP{" "}
                  {r.fields.find((f) => f.path === "prod/CFOP")?.value}
                </option>
              ))}
            </select>
          </Field>
          {reference && (
            <>
              <p className="body-note">
                NF-e/NFC-e {reference.model} ·{" "}
                {reference.environment === "1"
                  ? "XML de produção já emitido"
                  : "XML de homologação"}{" "}
                · CRT {reference.crt} · {reference.uf}. Assinatura matemática
                verificada; cadeia/revogação e situação atual não consultadas.
              </p>
              <div className="warning-card">
                {reference.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
              <Field label="Produto local — vínculo em revisão">
                <select
                  disabled={busy}
                  value={reference.productId ?? ""}
                  onChange={(e) => {
                    const productId = e.target.value
                      ? Number(e.target.value)
                      : null;
                    void action(async () => {
                      setCatalog(
                        await request(
                          api.linkFiscalReference({
                            id: reference.id,
                            productId,
                          }),
                        ),
                      );
                      setNotice(
                        "Vínculo salvo em revisão; emissão permanece indisponível.",
                      );
                    });
                  }}
                >
                  <option value="">Sem vínculo</option>
                  {products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="body-note">
                NCM {value("prod/NCM")} · CEST{" "}
                {value("prod/CEST") || "não informado"} · CFOP{" "}
                {value("prod/CFOP")} · {value("prod/uCom")} →{" "}
                {value("prod/uTrib")}
              </p>
              <Field
                label="Buscar campo fiscal"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ex.: ANP, CST, CFOP, IBS, ICMS"
              />
              <div
                className="table-wrap"
                style={{ maxHeight: 250, overflow: "auto" }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Campo do XML</th>
                      <th>Valor observado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reference.fields
                      .filter((f) =>
                        `${f.path} ${f.value}`
                          .toLocaleLowerCase()
                          .includes(search.toLocaleLowerCase()),
                      )
                      .map((f, i) => (
                        <tr key={`${f.path}-${i}`}>
                          <td>{f.path}</td>
                          <td
                            style={{
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {f.value}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Prévia de cálculo — sem emitir</summary>
                <p className="body-note">
                  Usa o fator e os códigos da referência escolhida, sem corrigir
                  divergências. Venda simples de 2026, sem desconto/frete. ICMS
                  00/60/61, PIS/COFINS sem cálculo e IBS/CBS 000/620006; outros
                  grupos somente consulta.
                </p>
                <Field
                  label="Quantidade da prévia"
                  type="number"
                  min="1"
                  max="10000"
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setPreview(null);
                  }}
                />
                <Field
                  label="Preço unitário da prévia"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPreview(null);
                  }}
                />
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      setPreview(
                        await request(
                          api.previewFiscalReference({
                            id: reference.id,
                            quantity: Number(quantity),
                            unitPriceCents: amount(price),
                          }),
                        ),
                      );
                    })
                  }
                >
                  Calcular prévia
                </button>
                {preview && (
                  <div aria-label="Resultado da prévia fiscal">
                    <p>
                      Total R$ {preview.total} · Quantidade tributável{" "}
                      {preview.tributaryQuantity} {preview.tributaryUnit}
                    </p>
                    <p>
                      ICMS próprio R$ {preview.icms} · ICMS retido anteriormente
                      R$ {preview.retainedIcms} · IBS R$ {preview.ibs} · CBS R${" "}
                      {preview.cbs}
                    </p>
                    <p className="body-note">{preview.note}</p>
                  </div>
                )}
              </details>
            </>
          )}
          <details>
            <summary>
              Operações de saída levantadas — {catalog.operations.length} opções
            </summary>
            <p className="body-note">
              Catálogo observado no RevGás. Não significa que todas as operações
              estejam implementadas ou se apliquem à revenda.
            </p>
            <p>{catalog.operations.join(" · ")}</p>
          </details>
        </>
      )}
    </section>
  );
}
