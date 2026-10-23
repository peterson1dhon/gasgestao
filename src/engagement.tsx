import { useEffect, useState, type FormEvent } from "react";
import { api, dateText, contains, type State, type Replenishment } from "./api";
import { Dialog, Field, SearchBox } from "./components";
import type { Perform } from "./forms";
type Props = {
  data: State;
  busy: boolean;
  error: string;
  close: () => void;
  perform: Perform;
};
const key = (r: Replenishment) => `${r.customer_id}:${r.product_id}`;
const dayLabel = (day: string) =>
  day ? day.split("-").reverse().join("/") : "";
export function RemindersDialog({ data, ...p }: Props) {
  const [showAll, setShowAll] = useState(false),
    [selectedKey, setSelectedKey] = useState(""),
    [message, setMessage] = useState(""),
    [days, setDays] = useState("3"),
    [feedback, setFeedback] = useState("");
  const rows = data.reminders.filter((r) => showAll || r.actionable);
  const selected = rows.find((r) => key(r) === selectedKey) || rows[0];
  useEffect(() => {
    setMessage(selected?.contact_message || selected?.message || "");
    setFeedback("");
  }, [selected?.customer_id, selected?.product_id, selected?.last_order_id,selected?.contact_message]);
  const input = selected
    ? {
        customer_id: selected.customer_id,
        product_id: selected.product_id,
        last_order_id: selected.last_order_id,
        message,
      }
    : {};
  const blocked =
    !selected ||
    !selected.enabled ||
    selected.contacted ||
    selected.snoozed ||
    selected.pending_order;
  async function openWhatsApp() {
    const result = (await p.perform(
      () => api.openReminderWhatsApp(input),
      "",
      false,
    )) as { opened: boolean; test?: boolean } | undefined;
    if (result)
      setFeedback(
        result.opened
          ? "Link aberto com o texto preparado. Revise e envie no WhatsApp."
          : "Modo de teste: nenhum navegador ou conversa foi aberto.",
      );
  }
  return (
    <Dialog
      title="Lembretes de recompra"
      description="Estimativas por cliente e produto, baseadas em compras concluídas."
      onClose={p.close}
      wide
      busy={p.busy}
    >
      <div className="modal-body">
        {p.error && (
          <p className="inline-error" role="alert">
            {p.error}
          </p>
        )}
        <div className="listing-toolbar">
          <strong>
            {data.reminders.filter((r) => r.actionable).length} lembrete(s) para
            revisar
          </strong>
          <label className="check-field">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Mostrar próximos e já tratados
          </label>
        </div>
        <div
          className="table-wrap"
          style={{ maxHeight: 180, overflow: "auto" }}
        >
          <table>
            <thead>
              <tr>
                <th>Cliente / produto</th>
                <th>Última compra</th>
                <th>Média</th>
                <th>Previsão</th>
                <th>Situação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={key(r)}>
                  <td>
                    <strong>{r.customer_name}</strong>
                    <small className="cell-small">{r.product_name}</small>
                  </td>
                  <td>{dayLabel(r.last_purchase)}</td>
                  <td>{r.average_days.toLocaleString("pt-BR")} dias/un.</td>
                  <td>{dayLabel(r.due_date)}</td>
                  <td>
                    {!r.enabled
                      ? "Desativado"
                      : r.pending_order
                        ? "Pedido em andamento"
                        : r.contacted
                          ? "Contato registrado"
                          : r.snoozed
                            ? `Adiado até ${dayLabel(r.snooze_until)}`
                            : r.days_until > 0
                              ? `Em ${r.days_until} dia(s)`
                              : "Revisar contato"}
                  </td>
                  <td>
                    <button
                      className="button secondary small"
                      type="button"
                      aria-pressed={selected && key(selected) === key(r)}
                      aria-label={`Preparar mensagem para ${r.customer_name}: ${r.product_name}`}
                      onClick={() => setSelectedKey(key(r))}
                    >
                      Selecionar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="body-note">
            Nenhum lembrete para revisar. É preciso ter pelo menos três compras
            concluídas do mesmo produto em dias diferentes. Você pode mostrar as
            próximas previsões acima.
          </p>
        )}
        {selected && (
          <>
            <div className="form-block-title spaced">
              Mensagem para {selected.customer_name} · {selected.product_name}
            </div>
            <p className="field-hint">
              Base: {selected.purchases} compras recentes; última quantidade:{" "}
              {selected.last_quantity}. Previsão de {selected.expected_days}{" "}
              dias para essa quantidade. É uma estimativa; confirme a
              necessidade com o cliente.
            </p>
            <Field label="Mensagem do lembrete" wide>
              <textarea
                rows={4}
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
            <p className="field-hint">
              Telefone: {selected.phone || "não cadastrado"}. O envio é
              confirmado por você no WhatsApp. Registrar o contato abaixo evita
              repetir o lembrete neste ciclo.
            </p>
            {selected.contacted_at && (
              <p className="field-hint">
                Contato registrado em {dateText(selected.contacted_at, true)}. O
                texto usado fica preservado neste ciclo.
              </p>
            )}
            {selected.last_opened_at && (
              <p className="field-hint">
                Link do WhatsApp aberto em{" "}
                {dateText(selected.last_opened_at, true)}; isso não confirma o
                envio.
              </p>
            )}
            <div
              className="modal-actions"
              style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
            >
              <button
                type="button"
                className="button primary"
                disabled={
                  p.busy || blocked || !message.trim() || !selected.phone
                }
                onClick={() => void openWhatsApp()}
              >
                Abrir WhatsApp com mensagem
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={p.busy || !message.trim()}
                onClick={() =>
                  void p.perform(
                    () => api.copyReminder(input),
                    "Mensagem copiada.",
                    false,
                  )
                }
              >
                Copiar mensagem
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={p.busy || selected.contacted}
                onClick={() =>
                  void p.perform(
                    () => api.reminderAction({ ...input, kind: "contato" }),
                    "Contato registrado para este ciclo.",
                    false,
                  )
                }
              >
                Registrar contato realizado
              </button>
            </div>
            {feedback && (
              <p className="body-note" role="status">
                {feedback}
              </p>
            )}
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Adiar lembrete (dias)">
                <select value={days} onChange={(e) => setDays(e.target.value)}>
                  {[1, 3, 5, 7, 15, 30].map((d) => (
                    <option key={d} value={d}>
                      {d} dia(s)
                    </option>
                  ))}
                </select>
              </Field>
              <div style={{ display: "flex", alignItems: "end", gap: 5 }}>
                <button
                  type="button"
                  className="button secondary"
                  disabled={p.busy || selected.contacted}
                  onClick={() =>
                    void p.perform(
                      () =>
                        api.reminderAction({
                          ...input,
                          kind: "adiado",
                          days: Number(days),
                        }),
                      "Lembrete adiado.",
                      false,
                    )
                  }
                >
                  Adiar lembrete
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={p.busy}
                  onClick={() =>
                    void p.perform(
                      () =>
                        api.reminderPreference({
                          customer_id: selected.customer_id,
                          enabled: !selected.enabled,
                        }),
                      selected.enabled
                        ? "Lembretes deste cliente desativados."
                        : "Lembretes deste cliente reativados.",
                      false,
                    )
                  }
                >
                  {selected.enabled
                    ? "Desativar lembretes do cliente"
                    : "Reativar lembretes do cliente"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <footer className="modal-footer">
        <span>
          Gás e água são calculados separadamente. Não há envio automático.
        </span>
        <button className="button secondary" type="button" onClick={p.close}>
          Fechar
        </button>
      </footer>
    </Dialog>
  );
}
export function ContainersDialog({ data, ...p }: Props) {
  const [tab, setTab] = useState("balances"),
    [search, setSearch] = useState("");
  const balances = data.containers.balances.filter((r) =>
    contains(`${r.customer_name} ${r.product_name}`, search),
  );
  const moves = data.containers.moves.filter((r) =>
    contains(`${r.customer_name} ${r.product_name} ${r.note}`, search),
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.addContainerMove({
          customer_id: Number(f.get("customer")),
          product_id: Number(f.get("product")),
          kind: String(f.get("kind")),
          quantity: Number(f.get("quantity")),
          note: String(f.get("note")),
        }),
      "Movimentação de vasilhames registrada.",
      false,
    );
  }
  return (
    <Dialog
      title="Vasilhames emprestados"
      description="Entrega e devolução de cascos e galões por cliente."
      onClose={p.close}
      wide
      busy={p.busy}
    >
      <div className="modal-body">
        {p.error && (
          <p className="inline-error" role="alert">
            {p.error}
          </p>
        )}
        <div className="listing-toolbar">
          <div>
            <button
              className={`button ${tab === "balances" ? "primary" : "secondary"} small`}
              onClick={() => setTab("balances")}
            >
              Saldos emprestados
            </button>{" "}
            <button
              className={`button ${tab === "moves" ? "primary" : "secondary"} small`}
              onClick={() => setTab("moves")}
            >
              Histórico de vasilhames
            </button>
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar cliente ou vasilhame"
          />
        </div>
        <div
          className="table-wrap"
          style={{ maxHeight: 220, overflow: "auto" }}
        >
          {tab === "balances" ? (
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Vasilhame / produto</th>
                  <th>Quantidade emprestada</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((r) => (
                  <tr key={`${r.customer_id}:${r.product_id}`}>
                    <td>{r.customer_name}</td>
                    <td>{r.product_name}</td>
                    <td>{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Vasilhame / produto</th>
                  <th>Movimento</th>
                  <th>Quantidade</th>
                  <th>Referência</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((r) => (
                  <tr key={r.id}>
                    <td>{dateText(r.created_at, true)}</td>
                    <td>{r.customer_name}</td>
                    <td>{r.product_name}</td>
                    <td>
                      {r.kind === "emprestimo" ? "Empréstimo" : "Devolução"}
                    </td>
                    <td>{Math.abs(r.delta)}</td>
                    <td>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {tab === "balances" && !balances.length && (
          <p className="body-note">Nenhum vasilhame emprestado encontrado.</p>
        )}
        <div className="form-block-title spaced">Registrar movimentação</div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Cliente do vasilhame">
              <select name="customer" required defaultValue="">
                <option value="">Selecione o cliente</option>
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.active ? " (inativo)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tipo de vasilhame / produto">
              <select name="product" required defaultValue="">
                <option value="">Selecione o produto</option>
                {data.products.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.active ? " (inativo)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Movimentação de vasilhame">
              <select name="kind">
                <option value="emprestimo">Emprestar vasilhame</option>
                <option value="devolucao">Receber devolução</option>
              </select>
            </Field>
            <Field
              label="Quantidade de vasilhames"
              name="quantity"
              type="number"
              min="1"
              max="10000"
              step="1"
              defaultValue="1"
              required
            />
            <Field
              label="Motivo ou referência do vasilhame"
              name="note"
              maxLength={300}
              placeholder="Ex.: galão deixado com o cliente no pedido #123"
              wide
              required
            />
          </div>
          <p className="field-hint">
            Este controle registra os recipientes emprestados. As vendas e o
            estoque de produtos continuam registrados pelos pedidos; não há
            cobrança automática de caução.
          </p>
          <button className="button primary" type="submit" disabled={p.busy}>
            Registrar vasilhames
          </button>
        </form>
      </div>
      <footer className="modal-footer">
        <span>
          Histórico recente: até 500 movimentos. Saldos consideram todo o
          histórico.
        </span>
        <button className="button secondary" type="button" onClick={p.close}>
          Fechar
        </button>
      </footer>
    </Dialog>
  );
}
