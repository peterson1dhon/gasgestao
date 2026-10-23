import { useEffect, useState } from "react";
import {
  api,
  request,
  dateText,
  type FiscalCertificate,
  type FiscalStatus,
} from "./api";
import { Dialog, Field } from "./components";
export function FiscalDialog({ close }: { close: () => void }) {
  const [certificates, setCertificates] = useState<FiscalCertificate[]>([]),
    [selected, setSelected] = useState(""),
    [results, setResults] = useState<FiscalStatus[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void Promise.all([
      request(api.fiscalCertificates()),
      request(api.fiscalSummary()),
    ])
      .then(([certs, summary]) => {
        if (!active) return;
        setCertificates(certs);
        setSelected(
          certs.find((c) => c.validNow && c.hasPrivateKey && c.hasCompanyId)
            ?.thumbprint || "",
        );
        setResults(summary.results);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function check(model: string) {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        api.fiscalStatus({ model, thumbprint: selected }),
      );
      setResults((old) => [...old.filter((r) => r.model !== model), result]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Diagnóstico fiscal SP"
      description="Primeira etapa da integração de NF-e e NFC-e — homologação."
      onClose={close}
      busy={busy}
      wide
    >
      <div className="modal-body">
        <div className="warning-card">
          <strong>
            Somente diagnóstico. A emissão de notas fiscais ainda não está
            habilitada.
          </strong>
        </div>
        <p className="body-note">
          Os testes consultam apenas o status dos serviços de São Paulo, no
          ambiente de homologação. Não emitem, cancelam ou inutilizam documentos
          e não acessam produção.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Lendo certificados instalados no Windows…</p>
        ) : (
          <>
            <Field label="Certificado da empresa no Windows" wide>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={busy}
              >
                <option value="">
                  Selecione um certificado válido da empresa
                </option>
                {certificates.map((c) => (
                  <option
                    key={c.thumbprint}
                    value={c.thumbprint}
                    disabled={
                      !c.validNow || !c.hasPrivateKey || !c.hasCompanyId
                    }
                  >
                    {c.label} · validade{" "}
                    {c.validUntil.split("-").reverse().join("/")}
                    {!c.validNow ? " · vencido/não válido" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {!certificates.some((c) => c.validNow && c.hasCompanyId) && (
              <p className="body-note">
                Não foi encontrado um certificado da empresa válido no usuário
                atual do Windows. O A1 precisa estar instalado no repositório
                pessoal do Windows. Não envie certificado ou senha pelo chat.
              </p>
            )}
            <p className="field-hint">
              A chave privada permanece no Windows. O diagnóstico não exporta o
              A1, não solicita senha e não grava certificado no banco de
              clientes.
            </p>
            <div style={{ display: "flex", gap: 6, margin: "12px 0" }}>
              <button
                className="button primary"
                disabled={busy || !selected}
                onClick={() => void check("55")}
              >
                Testar NF-e (55)
              </button>
              <button
                className="button secondary"
                disabled={busy || !selected}
                onClick={() => void check("65")}
              >
                Testar NFC-e (65)
              </button>
              {busy && <span role="status">Consultando a SEFAZ. Aguarde…</span>}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Ambiente</th>
                    <th>Resposta</th>
                    <th>Verificação</th>
                    <th>Momento</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.model}>
                      <td>{r.model === "55" ? "NF-e (55)" : "NFC-e (65)"}</td>
                      <td>Homologação · SP</td>
                      <td>
                        <strong>
                          {r.cStat} — {r.reason}
                        </strong>
                        {!r.live && (
                          <small className="cell-small">
                            SIMULAÇÃO — teste da interface, sem conexão externa
                          </small>
                        )}
                      </td>
                      <td>
                        {r.chainValidated
                          ? "Cadeia do certificado verificada"
                          : "Verificação pendente"}
                        <small className="cell-small">
                          Chave privada não exportada
                        </small>
                      </td>
                      <td>{dateText(r.checkedAt, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!results.length && (
              <p className="body-note">
                Nenhum diagnóstico registrado neste perfil.
              </p>
            )}
            <p className="body-note">
              O código 107 informa que o serviço da SEFAZ está operando e que
              esta consulta foi respondida. Ele não comprova credenciamento do
              CNPJ, emissão autorizada ou cálculo correto de tributos.
            </p>
          </>
        )}
      </div>
      <footer className="modal-footer">
        <span>
          Ambiente fixo: homologação · operação STATUS · intervalo mínimo de um
          minuto por modelo.
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={close}
        >
          Fechar
        </button>
      </footer>
    </Dialog>
  );
}
