import { FiscalDialog } from "./fiscal";
import { RemindersDialog, ContainersDialog } from "./engagement";
import { ClassicShell, ClassicTool } from "./classic";
import {
  Children,
  cloneElement,
  isValidElement,
  Fragment,
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  UsersRound,
  Package,
  Truck,
  Boxes,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Download,
  ShieldCheck,
  Flame,
  ChevronRight,
  CircleCheck,
  X,
  Pencil,
  MapPin,
  Phone,
  DatabaseBackup,
  Monitor,
  Banknote,
  Clock3,
  TriangleAlert,
  PackageCheck,
  Sparkles,
  LoaderCircle,
  Store as StoreIcon,
} from "lucide-react";
import {
  api,
  request,
  currency,
  dateText,
  phoneText,
  localDate,
  contains,
  statusLabels,
  paymentLabels,
  type State,
  type RepeatDraft,
  type Order,
  type Status,
  type Report,
  type Result,
} from "./api";
import {
  Badge,
  Dialog,
  Empty,
  Field,
  Metric,
  SearchBox,
  SectionHeader,
  ViewLink,
} from "./components";
import {
  CustomerForm,
  ProductForm,
  DriverForm,
  StockForm,
  CashForm,
  OrderForm,
  OrderDetails,
  CancelOrder,
  ReceiveForm,
  type Perform,
} from "./forms";

type Page =
  | "dashboard"
  | "orders"
  | "customers"
  | "products"
  | "drivers"
  | "stock"
  | "cash"
  | "reports"
  | "settings";
type Modal =
  | {
      type:
        | "customer"
        | "product"
        | "driver"
        | "stock"
        | "details"
        | "cancel"
        | "receive";
      id?: number;
    }
  | { type: "order"; draft?: RepeatDraft }
  | { type: "cash" | "demo" | "reminders" | "containers" | "fiscal" }
  | null;
export default function App() {
  const [data, setData] = useState<State | null>(null),
    [page, setPage] = useState<Page>("orders"),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loadingError, setLoadingError] = useState("");
  const refresh = useCallback(
    async () => setData(await request(api.bootstrap())),
    [],
  );
  useEffect(() => {
    if (!api) {
      setLoadingError("Abra o GasGestão pelo aplicativo Windows.");
      return;
    }
    void refresh().catch((e) => setLoadingError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const reminderNoticeDay = useRef("");
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const count = data?.reminders.filter((r) => r.actionable).length || 0;
    const day = localDate();
    if (count && reminderNoticeDay.current !== day) {
      reminderNoticeDay.current = day;
      setToast(
        `${count} lembrete(s) de recompra para revisar em Utilitários → Lembretes de recompra.`,
      );
    }
  }, [data]);
  const close = useCallback(() => {
    setModal(null);
    setError("");
  }, []);
  const open = (value: Modal) => {
    setError("");
    setModal(value);
  };
  const go = (value: Page) => {
    setPage(value);
    setSearch("");
    setError("");
  };
  const perform: Perform = async (fn, message, closeModal = true) => {
    setBusy(true);
    setError("");
    try {
      const result = await request(fn());
      await refresh();
      if (message) setToast(message);
      if (closeModal) close();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };
  const fileAction = async (
    fn: () => Promise<Result<string | null>>,
    label: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      const path = await request(fn());
      if (path) setToast(`${label}: ${path}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const newOrder = () => {
    if (!data?.customers.some((c) => c.active)) {
      go("customers");
      open({ type: "customer" });
      setToast("Cadastre o primeiro cliente para começar.");
      return;
    }
    if (!data.products.some((p) => p.active)) {
      go("products");
      open({ type: "product" });
      setToast("Cadastre os produtos para montar um pedido.");
      return;
    }
    open({ type: "order" });
  };
  const repeatOrder = async (input: {
    order_id?: number;
    customer_id?: number;
  }) => {
    const draft = (await perform(
      () => api.repeatOrderDraft(input),
      "",
      false,
    )) as RepeatDraft | undefined;
    if (draft) open({ type: "order", draft });
  };
  if (!data)
    return (
      <div className="startup">
        <div className="brand-mark">
          <Flame size={30} />
        </div>
        <h1>GasGestão</h1>
        {loadingError ? (
          <>
            <p role="alert">{loadingError}</p>
            <button
              className="button primary"
              onClick={() => location.reload()}
            >
              Tentar novamente
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} />
            <p>Organizando sua operação…</p>
          </>
        )}
      </div>
    );
  const activeOrder =
    modal && "id" in modal
      ? data.orders.find((o) => o.id === modal.id)
      : undefined;
  const common = { close, busy, perform, error };
  return (
    <div className="app-shell">
      <ClassicShell
        page={page}
        go={go}
        newOrder={newOrder}
        backup={() => void fileAction(() => api.backup(), "Backup salvo")}
        company={data.settings.name}
        version={data.meta.version}
        reminderCount={data.reminders.filter((r) => r.actionable).length}
        openReminders={() => open({ type: "reminders" })}
        openContainers={() => open({ type: "containers" })}
        openFiscal={() => open({ type: "fiscal" })}
      >
        <main className="main-content">
          {error && !modal && (
            <div className="page-error" role="alert">
              <TriangleAlert size={18} />
              {error}
              <button
                className="icon-button"
                aria-label="Fechar aviso"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {page === "dashboard" && (
            <Dashboard data={data} newOrder={newOrder} go={go} open={open} />
          )}
          {page === "orders" && (
            <OrdersPage
              data={data}
              search={search}
              setSearch={setSearch}
              newOrder={newOrder}
              perform={perform}
              open={open}
              exportCsv={() =>
                void fileAction(
                  () => api.exportData("pedidos"),
                  "Pedidos exportados",
                )
              }
              busy={busy}
            />
          )}
          {page === "customers" && (
            <CustomersPage
              repeatLast={(customer_id) => void repeatOrder({ customer_id })}
              data={data}
              search={search}
              setSearch={setSearch}
              open={open}
              exportCsv={() =>
                void fileAction(
                  () => api.exportData("clientes"),
                  "Clientes exportados",
                )
              }
              busy={busy}
            />
          )}
          {page === "products" && (
            <ProductsPage
              data={data}
              search={search}
              setSearch={setSearch}
              open={open}
              exportCsv={() =>
                void fileAction(
                  () => api.exportData("produtos"),
                  "Produtos exportados",
                )
              }
              busy={busy}
            />
          )}
          {page === "drivers" && (
            <DriversPage
              data={data}
              search={search}
              setSearch={setSearch}
              open={open}
            />
          )}
          {page === "stock" && (
            <StockPage
              data={data}
              search={search}
              setSearch={setSearch}
              open={open}
            />
          )}
          {page === "cash" && (
            <CashPage
              data={data}
              search={search}
              setSearch={setSearch}
              open={open}
              exportCsv={() =>
                void fileAction(
                  () => api.exportData("caixa"),
                  "Caixa exportado",
                )
              }
              busy={busy}
            />
          )}
          {page === "reports" && <ReportsPage />}
          {page === "settings" && (
            <SettingsPage
              data={data}
              busy={busy}
              perform={perform}
              backup={() => void fileAction(() => api.backup(), "Backup salvo")}
            />
          )}
        </main>
      </ClassicShell>
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={20} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Fechar notificação"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal?.type === "customer" && (
        <CustomerForm
          {...common}
          item={data.customers.find((c) => c.id === modal.id)}
        />
      )}
      {modal?.type === "product" && (
        <ProductForm
          {...common}
          item={data.products.find((p) => p.id === modal.id)}
        />
      )}
      {modal?.type === "driver" && (
        <DriverForm
          {...common}
          item={data.drivers.find((d) => d.id === modal.id)}
        />
      )}
      {modal?.type === "stock" && (
        <StockForm {...common} data={data} productId={modal.id} />
      )}
      {modal?.type === "cash" && <CashForm {...common} />}
      {modal?.type === "order" && (
        <OrderForm {...common} data={data} draft={modal.draft} />
      )}
      {modal?.type === "reminders" && (
        <RemindersDialog {...common} data={data} />
      )}
      {modal?.type === "fiscal" && <FiscalDialog close={close} />}
      {modal?.type === "containers" && (
        <ContainersDialog {...common} data={data} />
      )}
      {modal?.type === "details" && activeOrder && (
        <OrderDetails
          {...common}
          data={data}
          order={activeOrder}
          onRepeat={() => void repeatOrder({ order_id: activeOrder.id })}
          onReceive={() => open({ type: "receive", id: activeOrder.id })}
          onCancel={() => open({ type: "cancel", id: activeOrder.id })}
        />
      )}
      {modal?.type === "receive" && activeOrder && (
        <ReceiveForm {...common} order={activeOrder} />
      )}
      {modal?.type === "cancel" && activeOrder && (
        <CancelOrder {...common} order={activeOrder} />
      )}
      {modal?.type === "demo" && (
        <Dialog
          title="Conheça o GasGestão na prática"
          description="Uma demonstração com dados totalmente fictícios."
          onClose={close}
          busy={busy}
        >
          <div className="modal-body">
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <div className="demo-illustration">
              <Sparkles size={36} />
            </div>
            <p className="body-note">
              Vamos cadastrar clientes, produtos, entregadores e 12 pedidos de
              exemplo para você explorar as telas. Esses dados ficarão nesta
              base; para uso real, comece em uma base vazia.
            </p>
            <p className="field-hint">
              A demonstração só pode ser carregada quando não existem cadastros
              nem movimentações.
            </p>
          </div>
          <footer className="modal-footer">
            <button className="button secondary" onClick={close}>
              Agora não
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void perform(
                  () => api.seedDemo(),
                  "Demonstração carregada. Todos os dados são fictícios.",
                )
              }
            >
              {busy ? "Preparando…" : "Carregar demonstração"}
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  const titles: Record<string, string> = {
    ATENDIMENTO: "Pedidos Realizados",
    RELACIONAMENTO: "Cadastro de Clientes",
    CATÁLOGO: "Cadastro de Produtos",
    "EQUIPE DE ENTREGA": "Cadastro de Funcionários / Entregadores",
    "CONTROLE DE PRODUTOS": "Movimento de Estoque / Produtos",
    "CONTROLE FINANCEIRO": "Fluxo de Caixa",
    RESULTADOS: "Relatório de Vendas",
    "DO SEU JEITO": "Configurar Sistema",
  };
  const icons: Record<string, typeof UsersRound> = {
    ATENDIMENTO: ShoppingBag,
    RELACIONAMENTO: UsersRound,
    CATÁLOGO: Package,
    "EQUIPE DE ENTREGA": Truck,
    "CONTROLE DE PRODUTOS": Boxes,
    "CONTROLE FINANCEIRO": Wallet,
    RESULTADOS: ChartNoAxesCombined,
    "DO SEU JEITO": Settings,
  };
  const Icon = icons[eyebrow] || Monitor;
  const tools = (children: ReactNode): ReactNode =>
    Children.map(children, (node) => {
      if (
        !isValidElement<{
          children?: ReactNode;
          className?: string;
          "aria-label"?: string;
          title?: string;
        }>(node)
      )
        return node;
      if (node.type === Fragment) return tools(node.props.children);
      if (node.type !== "button") return node;
      const parts = Children.toArray(node.props.children);
      const original = parts
        .filter((p) => typeof p === "string")
        .join("")
        .trim();
      const label = /^Nov[oa] /.test(original)
        ? "Incluir"
        : original === "Exportar CSV"
          ? "Exportar"
          : original;
      const artwork = parts.filter((p) => typeof p !== "string");
      return cloneElement(node, {
        className: `classic-action ${node.props.className || ""}`,
        "aria-label": node.props["aria-label"] || original,
        title: node.props.title || original,
        children: (
          <>
            {artwork}
            <span>{label}</span>
          </>
        ),
      });
    });
  return (
    <div className="page-heading">
      <div className="module-toolbar">{tools(actions)}</div>
      <div className="module-banner">
        <Icon size={30} />
        <h1>{titles[eyebrow] || title}</h1>
        <span aria-hidden="true">• • •</span>
      </div>
    </div>
  );
}
function Dashboard({
  data,
  newOrder,
  go,
  open,
}: {
  data: State;
  newOrder: () => void;
  go: (p: Page) => void;
  open: (m: Modal) => void;
}) {
  const empty = !data.customers.length && !data.products.length;
  return (
    <div className="classic-home">
      <div className="classic-home-box">
        <h1>Área de Trabalho</h1>
        <p>{data.settings.name} · GasGestão Desktop</p>
        <div className="classic-home-shortcuts">
          <button onClick={() => go("customers")}>
            <UsersRound />
            Cadastro de Clientes
          </button>
          <button onClick={newOrder}>
            <ShoppingBag />
            Lançamento de Pedidos
          </button>
          <button onClick={() => go("orders")}>
            <Truck />
            Pedidos Realizados
          </button>
          <button onClick={() => go("cash")}>
            <Wallet />
            Fluxo de Caixa
          </button>
        </div>
        {empty ? (
          <div className="classic-home-start">
            <p>Cadastre clientes e produtos para começar.</p>
            <button
              className="button secondary"
              onClick={() => open({ type: "demo" })}
            >
              Explorar demonstração
            </button>
          </div>
        ) : (
          <div className="classic-home-totals">
            <span>
              Vendas hoje: <b>{currency(data.metrics.sales_today)}</b>
            </span>
            <span>
              Em aberto: <b>{data.metrics.open_orders}</b>
            </span>
            <span>
              A receber: <b>{currency(data.metrics.receivables)}</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
function OrderTable({
  orders,
  customers,
  selectedId,
  onSelect,
  onOpen,
}: {
  orders: Order[];
  customers: State["customers"];
  selectedId?: number;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  return (
    <div className="table-wrap classic-grid">
      <table className="orders-table">
        <thead>
          <tr>
            <th>Nº Pedido</th>
            <th>Data / Saída</th>
            <th>Entrega</th>
            <th>Cód.</th>
            <th>Cliente</th>
            <th>Endereço</th>
            <th>Bairro</th>
            <th>Telefone</th>
            <th>Entregador</th>
            <th>Situação</th>
            <th className="align-right">Total</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const customer = customers.find((c) => c.id === o.customer_id);
            const rowClass =
              o.status === "cancelado"
                ? "order-cancelado"
                : o.payment_method === "fiado"
                  ? "order-aprazo"
                  : o.paid_cents === 0
                    ? "order-aberto"
                    : "order-avista";
            return (
              <tr
                key={o.id}
                tabIndex={0}
                aria-selected={o.id === selectedId}
                className={`${rowClass} ${o.id === selectedId ? "selected-row" : ""}`}
                onClick={() => onSelect(o.id)}
                onDoubleClick={() => onOpen(o.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget)
                    onOpen(o.id);
                }}
              >
                <td>
                  <button className="order-id" onClick={() => onOpen(o.id)}>
                    #{String(o.id).padStart(4, "0")}
                  </button>
                </td>
                <td>{dateText(o.created_at, true)}</td>
                <td>
                  {o.delivered_at
                    ? new Date(o.delivered_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </td>
                <td>{o.customer_id}</td>
                <td>
                  <strong>{o.customer_name}</strong>
                </td>
                <td className="address-cell" title={o.delivery_address}>
                  {o.delivery_type === "retirada"
                    ? "Retirada no balcão"
                    : o.delivery_address}
                </td>
                <td>{customer?.neighborhood || "—"}</td>
                <td>{phoneText(o.customer_phone)}</td>
                <td>{o.driver_name || "A atribuir"}</td>
                <td>
                  <Badge status={o.status} />
                  {o.status !== "cancelado" && (
                    <small className="cell-small">
                      {o.total_cents === o.paid_cents
                        ? "Pago"
                        : `A receber: ${currency(o.total_cents - o.paid_cents)}`}
                    </small>
                  )}
                </td>
                <td className="align-right money">{currency(o.total_cents)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Abrir pedido ${o.id}`}
                    onClick={() => onOpen(o.id)}
                  >
                    <ArrowUpRight size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
type Listing = {
  data: State;
  search: string;
  setSearch: (s: string) => void;
  open: (m: Modal) => void;
};
type ExportListing = Listing & { exportCsv: () => void; busy: boolean };
function OrdersPage({
  data,
  search,
  setSearch,
  newOrder,
  open,
  exportCsv,
  busy,
  perform,
}: ExportListing & { newOrder: () => void; perform: Perform }) {
  const [group, setGroup] = useState("todos"),
    [day, setDay] = useState(localDate()),
    [status, setStatus] = useState("todos");
  const [delivered, setDelivered] = useState(true),
    [notDelivered, setNotDelivered] = useState(true),
    [selectedId, setSelectedId] = useState<number>();
  const rows = data.orders.filter((o) => {
    const category =
      group === "todos" ||
      (group === "aberto" && !["entregue", "cancelado"].includes(o.status)) ||
      (group === "avista" &&
        o.payment_method !== "fiado" &&
        o.status !== "cancelado") ||
      (group === "aprazo" &&
        o.payment_method === "fiado" &&
        o.status !== "cancelado") ||
      (group === "cancelado" && o.status === "cancelado");
    const delivery =
      o.status === "cancelado" ||
      (o.status === "entregue" ? delivered : notDelivered);
    return (
      category &&
      delivery &&
      (!day || localDate(new Date(o.created_at)) === day) &&
      (status === "todos" ||
        (status === "a_receber"
          ? o.status !== "cancelado" && o.paid_cents < o.total_cents
          : o.status === status)) &&
      contains(
        `${o.id} ${o.customer_name} ${o.customer_phone} ${o.driver_name || ""} ${o.delivery_address}`,
        search,
      )
    );
  });
  const selected = rows.find((o) => o.id === selectedId) || rows[0];
  const showSelected = () => {
    if (selected) open({ type: "details", id: selected.id });
  };
  const cancelSelected = () => {
    if (selected && selected.status !== "cancelado")
      open({ type: "cancel", id: selected.id });
  };
  const receiveSelected = () => {
    if (selected && selected.status !== "cancelado")
      open({
        type:
          selected.paid_cents < selected.total_cents ? "receive" : "details",
        id: selected.id,
      });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        document.querySelector('[role="dialog"]') ||
        busy ||
        e.altKey ||
        e.metaKey
      )
        return;
      const actions: Record<string, () => void> = {
        F1: cancelSelected,
        F2: showSelected,
        F4: () => {
          if (selected)
            void perform(() => api.printOrder(selected.id), "", false);
        },
        F6: showSelected,
        F7: receiveSelected,
      };
      if (actions[e.key]) {
        e.preventDefault();
        actions[e.key]();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selected, busy, perform]);
  const changeDay = (delta: number) => {
    const date = new Date(`${day || localDate()}T12:00:00`);
    date.setDate(date.getDate() + delta);
    setDay(localDate(date));
  };
  return (
    <>
      <PageHeading
        eyebrow="ATENDIMENTO"
        title="Pedidos Realizados"
        description="Consulta dos pedidos"
        actions={
          <>
            <ClassicTool
              label="Cancelar Pedido"
              shortcut="F1"
              icon={X}
              color="#dc653e"
              disabled={!selected || selected.status === "cancelado" || busy}
              onClick={cancelSelected}
            />
            <ClassicTool
              label="Consultar"
              shortcut="F2"
              icon={Pencil}
              disabled={!selected || busy}
              onClick={showSelected}
            />
            <ClassicTool
              label="Imprimir"
              shortcut="F4"
              icon={Download}
              disabled={!selected || busy}
              onClick={() => {
                if (selected)
                  void perform(() => api.printOrder(selected.id), "", false);
              }}
            />
            <ClassicTool
              label="Confirmar"
              shortcut="F6"
              icon={CircleCheck}
              disabled={!selected || selected.status === "cancelado" || busy}
              onClick={showSelected}
            />
            <ClassicTool
              label="Fechar Pedido"
              shortcut="F7"
              icon={Wallet}
              color="#4b8f30"
              disabled={!selected || selected.status === "cancelado" || busy}
              onClick={receiveSelected}
            />
            <ClassicTool
              label="Exportar"
              icon={Download}
              onClick={exportCsv}
              disabled={busy}
            />
            <ClassicTool
              label="Lançar Pedido"
              ariaLabel="Novo pedido"
              shortcut="F8"
              icon={Plus}
              color="#379449"
              onClick={newOrder}
            />
          </>
        }
      />
      <section className="panel orders-panel">
        <div className="classic-querybar">
          <label>
            Data dos pedidos{" "}
            <input
              type="date"
              aria-label="Data dos pedidos"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <button
            className="button secondary small"
            aria-label="Dia anterior"
            onClick={() => changeDay(-1)}
          >
            ◀
          </button>
          <button
            className="button secondary small"
            aria-label="Próximo dia"
            onClick={() => changeDay(1)}
          >
            ▶
          </button>
          <button
            className="button secondary small"
            onClick={() => setDay(localDate())}
          >
            Hoje
          </button>
          <button className="button secondary small" onClick={() => setDay("")}>
            Todas as datas
          </button>
          <div className="classic-query-spacer" />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar cliente, pedido ou telefone"
          />
        </div>
        <div className="classic-order-filters">
          <div
            className="classic-order-legend"
            role="group"
            aria-label="Filtrar pedidos"
          >
            {[
              { id: "aberto", text: "Em Aberto" },
              { id: "avista", text: "C/Pgto à vista" },
              { id: "aprazo", text: "C/Pgto a prazo" },
              { id: "cancelado", text: "Cancelado" },
              { id: "todos", text: "Todos os Pedidos" },
            ].map((g) => (
              <label key={g.id} className={`legend-${g.id}`}>
                <input
                  type="radio"
                  name="order-group"
                  value={g.id}
                  checked={group === g.id}
                  onChange={() => setGroup(g.id)}
                />
                <span>{g.text}</span>
              </label>
            ))}
          </div>
          <div className="classic-delivery-checks">
            <label>
              <input
                type="checkbox"
                checked={delivered}
                onChange={(e) => setDelivered(e.target.checked)}
              />
              Entregue
            </label>
            <label>
              <input
                type="checkbox"
                checked={notDelivered}
                onChange={(e) => setNotDelivered(e.target.checked)}
              />
              Não Entregue
            </label>
          </div>
          <label className="classic-status-filter">
            Situação{" "}
            <select
              aria-label="Situação do pedido"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="todos">Todas</option>
              <option value="a_receber">Pagamento pendente</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <OrderTable
          orders={rows}
          customers={data.customers}
          selectedId={selected?.id}
          onSelect={setSelectedId}
          onOpen={(id) => open({ type: "details", id })}
        />
        {!rows.length && (
          <div className="classic-grid-empty">
            <span>Nenhum pedido encontrado para esta consulta.</span>
            <button className="button secondary small" onClick={newOrder}>
              Criar primeiro pedido
            </button>
          </div>
        )}
        <div className="table-footer">
          <span className="record-count">
            {rows.length} registros encontrados.
          </span>
          <span>
            {data.meta.order_count > 500
              ? "Últimos 500 pedidos · CSV contém o histórico completo."
              : "Clique para selecionar. Duplo clique ou Enter para consultar."}
          </span>
        </div>
      </section>
    </>
  );
}

function CustomersPage({
  data,
  repeatLast,
  search,
  setSearch,
  open,
  exportCsv,
  busy,
}: ExportListing & { repeatLast: (id: number) => void }) {
  const rows = data.customers.filter((c) =>
    contains(
      `${c.name} ${c.phone} ${c.address} ${c.neighborhood} ${c.city} ${c.postal_code} ${c.cnpj}`,
      search,
    ),
  );
  return (
    <>
      <PageHeading
        eyebrow="RELACIONAMENTO"
        title="Clientes que estão por perto."
        description="Todos os contatos, endereços e detalhes em um só lugar."
        actions={
          <>
            <button
              className="button secondary"
              disabled={busy}
              onClick={exportCsv}
            >
              <Download size={16} />
              Exportar CSV
            </button>
            <button
              className="button primary"
              onClick={() => open({ type: "customer" })}
            >
              <Plus size={18} />
              Novo cliente
            </button>
          </>
        }
      />
      <section className="panel">
        <div className="listing-toolbar">
          <div className="toolbar-description">
            <strong>{data.customers.length}</strong> clientes cadastrados
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar nome, telefone ou endereço"
          />
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Telefone</th>
                  <th>Endereço</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="person-cell">
                        <div className="person-avatar">
                          {c.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <strong>{c.name}</strong>
                          <small>Cliente #{c.id}</small>
                        </div>
                      </div>
                    </td>
                    <td>{phoneText(c.phone)}</td>
                    <td>
                      <strong className="cell-title">
                        {c.address || "Não informado"}
                      </strong>
                      <small className="cell-small">
                        {[c.neighborhood, c.city].filter(Boolean).join(" · ") ||
                          "—"}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`badge ${c.active ? "paid" : "neutral"}`}
                      >
                        {c.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Editar cliente ${c.name}`}
                        onClick={() => open({ type: "customer", id: c.id })}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={busy || !c.active}
                        title="Repetir último pedido"
                        aria-label={`Repetir último pedido de ${c.name}`}
                        onClick={() => repeatLast(c.id)}
                      >
                        <ShoppingBag size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              search
                ? "Nenhum cliente encontrado"
                : "Quem é o seu primeiro cliente?"
            }
            description="Cadastre nome, telefone e endereço para agilizar o atendimento."
            icon={UsersRound}
            action={
              <button
                className="button secondary small"
                onClick={() => open({ type: "customer" })}
              >
                <Plus size={16} />
                Cadastrar cliente
              </button>
            }
          />
        )}
        <div className="table-footer">
          {rows.length} clientes exibidos
          <span>Cadastros inativos permanecem no histórico</span>
        </div>
      </section>
    </>
  );
}
function ProductsPage({
  data,
  search,
  setSearch,
  open,
  exportCsv,
  busy,
}: ExportListing) {
  const rows = data.products.filter((p) =>
    contains(`${p.name} ${p.category}`, search),
  );
  return (
    <>
      <PageHeading
        eyebrow="CATÁLOGO"
        title="Tudo o que a sua revenda entrega."
        description="Mantenha seus produtos e preços sempre organizados."
        actions={
          <>
            <button
              className="button secondary"
              disabled={busy}
              onClick={exportCsv}
            >
              <Download size={16} />
              Exportar CSV
            </button>
            <button
              className="button primary"
              onClick={() => open({ type: "product" })}
            >
              <Plus size={18} />
              Novo produto
            </button>
          </>
        }
      />
      <section className="panel">
        <div className="listing-toolbar">
          <div className="toolbar-description">
            <strong>{data.products.length}</strong> produtos cadastrados
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar produto ou categoria"
          />
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Preço de venda</th>
                  <th>Custo</th>
                  <th>Disponível</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="person-cell">
                        <div className="product-mini">
                          <Package size={20} />
                        </div>
                        <div>
                          <strong>{p.name}</strong>
                          <small>Por {p.unit}</small>
                        </div>
                      </div>
                    </td>
                    <td>{p.category || "—"}</td>
                    <td className="money">{currency(p.price_cents)}</td>
                    <td>{currency(p.cost_cents)}</td>
                    <td>
                      <span
                        className={
                          p.stock <= p.min_stock ? "stock-low" : "stock-normal"
                        }
                      >
                        {p.stock} {p.unit}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${p.active ? "paid" : "neutral"}`}
                      >
                        {p.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Editar produto ${p.name}`}
                        onClick={() => open({ type: "product", id: p.id })}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              search ? "Nenhum produto encontrado" : "Seu catálogo começa aqui"
            }
            description="Cadastre gás, água e os outros produtos da sua revenda."
            action={
              <button
                className="button secondary small"
                onClick={() => open({ type: "product" })}
              >
                <Plus size={16} />
                Cadastrar produto
              </button>
            }
          />
        )}
        <div className="table-footer">
          {rows.length} produtos exibidos
          <span>O preço do pedido é preservado no histórico</span>
        </div>
      </section>
    </>
  );
}
function DriversPage({ data, search, setSearch, open }: Listing) {
  const rows = data.drivers.filter((d) =>
    contains(`${d.name} ${d.phone}`, search),
  );
  return (
    <>
      <PageHeading
        eyebrow="EQUIPE DE ENTREGA"
        title="Quem faz a entrega acontecer."
        description="Cadastre sua equipe e acompanhe os pedidos em andamento."
        actions={
          <button
            className="button primary"
            onClick={() => open({ type: "driver" })}
          >
            <Plus size={18} />
            Novo entregador
          </button>
        }
      />
      <div className="standalone-toolbar">
        <span>
          {data.drivers.filter((d) => d.active).length} entregadores ativos
        </span>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar entregador ou telefone"
        />
      </div>
      {rows.length ? (
        <div className="drivers-grid">
          {rows.map((d) => {
            const current = data.orders.filter(
              (o) =>
                o.driver_id === d.id &&
                !["cancelado", "entregue"].includes(o.status),
            );
            return (
              <article className="driver-card panel" key={d.id}>
                <div className="driver-top">
                  <div className="driver-avatar">
                    <Truck size={28} />
                  </div>
                  <span className={`badge ${d.active ? "paid" : "neutral"}`}>
                    {d.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <h3>{d.name}</h3>
                <p>
                  <Phone size={14} />
                  {phoneText(d.phone)}
                </p>
                <div className="driver-stats">
                  <div>
                    <strong>{current.length}</strong>
                    <span>pedidos ativos exibidos</span>
                  </div>
                  <div>
                    <strong>
                      {current.filter((o) => o.status === "em_rota").length}
                    </strong>
                    <span>em rota</span>
                  </div>
                </div>
                <button
                  className="button secondary"
                  onClick={() => open({ type: "driver", id: d.id })}
                >
                  <Pencil size={15} />
                  Editar cadastro
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title="Sua equipe de entrega"
            description="Cadastre os entregadores para organizar as rotas dos pedidos."
            icon={Truck}
            action={
              <button
                className="button secondary small"
                onClick={() => open({ type: "driver" })}
              >
                Cadastrar entregador
              </button>
            }
          />
        </section>
      )}
    </>
  );
}
function StockPage({ data, search, setSearch, open }: Listing) {
  const [view, setView] = useState("saldo");
  const rows = data.products.filter((p) =>
    contains(`${p.name} ${p.category}`, search),
  );
  const moves = data.stockMoves.filter((m) =>
    contains(`${m.product_name} ${m.note}`, search),
  );
  return (
    <>
      <PageHeading
        eyebrow="CONTROLE DE PRODUTOS"
        title="Estoque certo, entrega garantida."
        description="Acompanhe saldos, reposições e todas as movimentações."
        actions={
          <button
            className="button primary"
            disabled={!data.products.length}
            onClick={() => open({ type: "stock" })}
          >
            <Plus size={18} />
            Movimentar estoque
          </button>
        }
      />
      <div className="stock-overview">
        <div>
          <div className="stock-overview-icon">
            <Boxes size={22} />
          </div>
          <span>
            Produtos ativos
            <strong>{data.products.filter((p) => p.active).length}</strong>
          </span>
        </div>
        <div>
          <div className="stock-overview-icon amber">
            <TriangleAlert size={22} />
          </div>
          <span>
            No mínimo ou abaixo<strong>{data.metrics.low_stock}</strong>
          </span>
        </div>
        <div>
          <div className="stock-overview-icon gray">
            <PackageCheck size={22} />
          </div>
          <span>
            Unidades disponíveis
            <strong>
              {data.products
                .filter((p) => p.active)
                .reduce((sum, p) => sum + p.stock, 0)}
            </strong>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="listing-toolbar">
          <div className="tabs">
            <button
              className={view === "saldo" ? "selected" : ""}
              onClick={() => setView("saldo")}
            >
              Saldos
            </button>
            <button
              className={view === "historico" ? "selected" : ""}
              onClick={() => setView("historico")}
            >
              Movimentações
            </button>
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar produto ou movimentação"
          />
        </div>
        {view === "saldo" ? (
          rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Disponível</th>
                    <th>Mínimo</th>
                    <th>Nível</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong className="cell-title">{p.name}</strong>
                        <small className="cell-small">
                          {p.category || "Sem categoria"}
                          {!p.active ? " · Inativo" : ""}
                        </small>
                      </td>
                      <td className="stock-count">
                        {p.stock} <small>{p.unit}</small>
                      </td>
                      <td>
                        {p.min_stock} {p.unit}
                      </td>
                      <td>
                        <span
                          className={`badge ${p.stock <= p.min_stock ? "pending" : "paid"}`}
                        >
                          {p.stock === 0
                            ? "Sem estoque"
                            : p.stock <= p.min_stock
                              ? "Repor estoque"
                              : "Em dia"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="button secondary small"
                          onClick={() => open({ type: "stock", id: p.id })}
                        >
                          Movimentar
                          <ArrowUpRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Nenhum produto cadastrado"
              description="Cadastre os produtos e registre seus saldos iniciais."
            />
          )
        ) : moves.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Produto</th>
                  <th>Movimentação</th>
                  <th>Motivo</th>
                  <th>Pedido</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{dateText(m.created_at, true)}</td>
                    <td>
                      <strong>{m.product_name}</strong>
                    </td>
                    <td className={m.delta > 0 ? "text-green" : "text-red"}>
                      <strong>
                        {m.delta > 0 ? "+" : ""}
                        {m.delta}
                      </strong>
                    </td>
                    <td>{m.note}</td>
                    <td>
                      {m.order_id ? (
                        <button
                          className="order-id"
                          onClick={() =>
                            open({ type: "details", id: m.order_id! })
                          }
                        >
                          #{m.order_id}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Nenhuma movimentação encontrada"
            description="Entradas, saídas e reservas de pedidos aparecerão aqui."
          />
        )}
        <div className="table-footer">
          {view === "saldo"
            ? "Disponível já desconta os pedidos reservados"
            : "Últimas 1.000 movimentações"}
          <span>Cancelamentos devolvem os produtos ao estoque</span>
        </div>
      </section>
    </>
  );
}
function CashPage({
  data,
  search,
  setSearch,
  open,
  exportCsv,
  busy,
}: ExportListing) {
  const [period, setPeriod] = useState("hoje");
  const today = localDate();
  const rows = data.cashEntries.filter(
    (c) =>
      (period === "todos" || localDate(new Date(c.created_at)) === today) &&
      contains(`${c.description} ${paymentLabels[c.method]}`, search),
  );
  const incoming = rows
      .filter((c) => c.flow === "entrada")
      .reduce((sum, c) => sum + c.amount_cents, 0),
    outgoing = rows
      .filter((c) => c.flow === "saida")
      .reduce((sum, c) => sum + c.amount_cents, 0);
  return (
    <>
      <PageHeading
        eyebrow="CONTROLE FINANCEIRO"
        title="Seu caixa, com clareza."
        description="Recebimentos, despesas e estornos registrados no mesmo lugar."
        actions={
          <>
            <button
              className="button secondary"
              disabled={busy}
              onClick={exportCsv}
            >
              <Download size={16} />
              Exportar CSV
            </button>
            <button
              className="button primary"
              onClick={() => open({ type: "cash" })}
            >
              <Plus size={18} />
              Novo lançamento
            </button>
          </>
        }
      />
      <div className="metrics-grid three">
        <Metric
          label="Saldo registrado"
          value={currency(data.metrics.cash_balance)}
          description="Todas as formas e todo o histórico"
          icon={Wallet}
          accent
        />
        <Metric
          label="Entradas exibidas"
          value={currency(incoming)}
          description="Somente os lançamentos filtrados abaixo"
          icon={ArrowUpRight}
        />
        <Metric
          label="Saídas exibidas"
          value={currency(outgoing)}
          description="Despesas e estornos do filtro atual"
          icon={ArrowRight}
        />
      </div>
      <section className="panel">
        <div className="listing-toolbar">
          <div className="tabs">
            <button
              className={period === "hoje" ? "selected" : ""}
              onClick={() => setPeriod("hoje")}
            >
              Hoje
            </button>
            <button
              className={period === "todos" ? "selected" : ""}
              onClick={() => setPeriod("todos")}
            >
              Histórico recente
            </button>
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar lançamento ou pagamento"
          />
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Forma</th>
                  <th>Tipo</th>
                  <th className="align-right">Valor</th>
                  <th>Pedido</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>{dateText(c.created_at, true)}</td>
                    <td>
                      <strong>{c.description}</strong>
                    </td>
                    <td>{paymentLabels[c.method]}</td>
                    <td>
                      <span
                        className={`badge ${c.flow === "entrada" ? "paid" : "outgoing"}`}
                      >
                        {c.flow === "entrada" ? "Entrada" : "Saída"}
                      </span>
                    </td>
                    <td
                      className={`align-right money ${c.flow === "entrada" ? "text-green" : "text-red"}`}
                    >
                      {c.flow === "entrada" ? "+" : "−"}{" "}
                      {currency(c.amount_cents)}
                    </td>
                    <td>
                      {c.order_id ? (
                        <button
                          className="order-id"
                          onClick={() =>
                            open({ type: "details", id: c.order_id! })
                          }
                        >
                          #{c.order_id}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Nenhum lançamento encontrado"
            description="Receba os pagamentos pelos pedidos ou registre uma movimentação avulsa."
            icon={Wallet}
          />
        )}
        <div className="table-footer">
          {rows.length} lançamentos exibidos · até 1.000 no histórico recente
          <span>Exportação CSV inclui o histórico completo</span>
        </div>
      </section>
    </>
  );
}
function ReportsPage() {
  const [from, setFrom] = useState(() => {
      const d = new Date();
      d.setDate(1);
      return localDate(d);
    }),
    [to, setTo] = useState(localDate()),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setReport(await request(api.report(from, to)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PageHeading
        eyebrow="RESULTADOS"
        title="Decisões com mais informação."
        description="Valores atualizados dos pedidos criados no período, excluindo cancelamentos."
      />
      <section className="panel period-filter">
        <div>
          <ChartNoAxesCombined size={21} />
          <strong>Período de criação dos pedidos</strong>
        </div>
        <Field
          label="Data inicial"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          label="Data final"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "Atualizando…" : "Atualizar"}
        </button>
      </section>
      {error && (
        <div className="page-error" role="alert">
          {error}
        </div>
      )}
      {report && (
        <>
          <div className="metrics-grid">
            <Metric
              label="Vendas no período"
              value={currency(report.sales)}
              description={`${report.orders} pedidos não cancelados`}
              icon={Banknote}
              accent
            />
            <Metric
              label="Ticket médio"
              value={currency(
                report.orders ? Math.round(report.sales / report.orders) : 0,
              )}
              description="Total dividido pelos pedidos"
              icon={ShoppingBag}
            />
            <Metric
              label="Recebido nesses pedidos"
              value={currency(report.paid)}
              description="Posição atual dos recebimentos"
              icon={Wallet}
            />
            <Metric
              label="A receber nesses pedidos"
              value={currency(report.pending)}
              description="Valores ainda pendentes"
              icon={Clock3}
            />
          </div>
          <section className="panel">
            <SectionHeader
              title="Produtos mais vendidos"
              description="Receita de produtos, sem taxas de entrega e descontos gerais"
            />
            {report.products.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Posição</th>
                      <th>Produto</th>
                      <th>Quantidade</th>
                      <th>Participação</th>
                      <th className="align-right">Receita dos itens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.products.map((p, i) => (
                      <tr key={`${p.product_id}-${p.name}`}>
                        <td>
                          <span className="ranking">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        </td>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td>{p.quantity}</td>
                        <td>
                          <div className="report-bar">
                            <span
                              style={{
                                width: `${(p.revenue / Math.max(...report.products.map((v) => v.revenue), 1)) * 100}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="align-right money">
                          {currency(p.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Sem vendas neste período"
                description="Escolha outro período ou registre seus primeiros pedidos."
                icon={ChartNoAxesCombined}
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
function SettingsPage({
  data,
  busy,
  perform,
  backup,
}: {
  data: State;
  busy: boolean;
  perform: Perform;
  backup: () => void;
}) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void perform(
      () =>
        api.saveSettings({
          name: String(f.get("name")),
          phone: String(f.get("phone")),
          address: String(f.get("address")),
          city: String(f.get("city")),
          receipt_left_columns: Number(f.get("receipt_left_columns")),
          require_customer_phone: f.has("require_customer_phone"),
        }),
      "Configurações salvas.",
      false,
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="DO SEU JEITO"
        title="A sua revenda no GasGestão."
        description="Personalize os comprovantes e cuide dos seus dados."
      />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <SectionHeader
            title="Dados da revenda"
            description="Essas informações aparecem nos comprovantes de pedido."
          />
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field
                label="Nome da revenda"
                name="name"
                defaultValue={data.settings.name}
                required
                wide
              />
              <Field
                label="Telefone com DDD"
                name="phone"
                defaultValue={data.settings.phone}
              />
              <Field
                label="Cidade"
                name="city"
                defaultValue={data.settings.city}
              />
              <Field
                label="Endereço"
                name="address"
                defaultValue={data.settings.address}
                wide
              />
            </div>
            <details>
              <summary>Opções de cadastro e impressão</summary>
              <Field
                label="Margem esquerda do recibo (colunas)"
                name="receipt_left_columns"
                type="number"
                min="0"
                max="40"
                step="1"
                defaultValue={data.settings.receipt_left_columns}
              />
              <label className="check-field">
                <input
                  type="checkbox"
                  name="require_customer_phone"
                  defaultChecked={data.settings.require_customer_phone}
                />
                Exigir telefone no cadastro de clientes
              </label>
            </details>
            <div className="settings-save">
              <button className="button primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar configurações"}
              </button>
            </div>
          </form>
        </section>
        <div className="settings-stack">
          <section className="panel backup-card">
            <div className="backup-icon">
              <DatabaseBackup size={27} />
            </div>
            <h3>Seus dados, protegidos.</h3>
            <p>
              Salve uma cópia completa e guarde em outro disco ou em um local de
              sua confiança.
            </p>
            <button className="button primary" onClick={backup} disabled={busy}>
              <Download size={17} />
              Salvar backup agora
            </button>
            <small>
              Uma cópia automática também é criada na primeira abertura de cada
              dia, quando já há um banco.
            </small>
          </section>
          <section className="panel about-card">
            <Monitor size={23} />
            <div>
              <h3>GasGestão Desktop</h3>
              <p>Versão {data.meta.version} · Windows</p>
              <span className="badge paid">Funcionamento local e offline</span>
            </div>
          </section>
        </div>
        <section className="panel limits-card">
          <SectionHeader title="O que já funciona nesta versão" />
          <p>
            Clientes, produtos, entregadores, pedidos, reserva de estoque,
            pagamentos parciais, cancelamentos com estorno, caixa, relatórios,
            comprovantes, exportação CSV, repetição de pedidos, vasilhames e
            lembretes com mensagem preparada para abertura manual no WhatsApp.
          </p>
          <p className="muted">
            Envio automático de WhatsApp, Bina e emissão fiscal, importação do
            GasExpert, restauração pelo aplicativo e uso simultâneo em rede
            ainda estão no roteiro de desenvolvimento.
          </p>
          <details>
            <summary>Onde os dados ficam salvos?</summary>
            <p className="data-path">{data.meta.databasePath}</p>
            <p>
              Os arquivos de backup ficam na subpasta backups do mesmo local.
              Faça uma cópia antes de qualquer manutenção manual.
            </p>
          </details>
        </section>
      </div>
    </>
  );
}
