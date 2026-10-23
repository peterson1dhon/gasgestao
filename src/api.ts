export type FiscalCertificate = {
  thumbprint: string;
  label: string;
  cnpjSuffix: string;
  hasCompanyId: boolean;
  validFrom: string;
  validUntil: string;
  hasPrivateKey: boolean;
  validNow: boolean;
  store: string;
};
export type FiscalStatus = {
  ok: true;
  model: string;
  environment: "homologacao";
  tpAmb: 2;
  state: "SP";
  cUF: 35;
  endpoint: string;
  cStat: string;
  reason: string;
  checkedAt: string;
  validUntil: string;
  privateKeyExported: false;
  chainValidated: true;
  operation: "STATUS";
  live: boolean;
};
export type FiscalSummary = {
  phase: "diagnostico";
  state: "SP";
  environment: "homologacao";
  canIssue: false;
  results: FiscalStatus[];
};
export type RepeatDraft = {
  source_id: number;
  customer_id: number;
  delivery_type: string;
  delivery_address: string;
  delivery_fee_cents: number;
  items: { product_id: number; quantity: number }[];
  warnings: string[];
};
export type Replenishment = {
  customer_id: number;
  customer_name: string;
  phone: string;
  product_id: number;
  product_name: string;
  last_order_id: number;
  last_purchase: string;
  last_quantity: number;
  purchases: number;
  average_days: number;
  expected_days: number;
  due_date: string;
  days_until: number;
  contacted: boolean;
  contacted_at: string;
  contact_message: string;
  last_opened_at: string;
  snoozed: boolean;
  snooze_until: string;
  enabled: boolean;
  pending_order: boolean;
  actionable: boolean;
  message: string;
};
export type ContainerBalance = {
  customer_id: number;
  product_id: number;
  customer_name: string;
  product_name: string;
  quantity: number;
};
export type ContainerMove = {
  id: number;
  customer_id: number;
  product_id: number;
  customer_name: string;
  product_name: string;
  delta: number;
  kind: string;
  note: string;
  created_at: string;
};
export type PostalAddress = {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  uf: string;
};
export type Customer = {
  cnpj: string;
  postal_code: string;
  uf: string;
  id: number;
  name: string;
  phone: string;
  address: string;
  neighborhood: string;
  city: string;
  notes: string;
  active: number;
};
export type Product = {
  id: number;
  name: string;
  category: string;
  unit: string;
  price_cents: number;
  cost_cents: number;
  stock: number;
  min_stock: number;
  active: number;
};
export type Driver = {
  id: number;
  name: string;
  phone: string;
  active: number;
};
export type Status =
  "novo" | "preparando" | "em_rota" | "entregue" | "cancelado";
export type OrderItem = {
  id: number;
  product_id: number;
  name: string;
  quantity: number;
  unit_price_cents: number;
  unit_cost_cents: number;
  total_cents: number;
};
export type Order = {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  customer_cnpj: string;
  driver_id: number | null;
  driver_name: string | null;
  status: Status;
  delivery_type: "entrega" | "retirada";
  delivery_address: string;
  notes: string;
  payment_method: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  paid_cents: number;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  items: OrderItem[];
};
export type CashEntry = {
  id: number;
  order_id: number | null;
  flow: "entrada" | "saida";
  amount_cents: number;
  method: string;
  description: string;
  created_at: string;
};
export type StockMove = {
  id: number;
  product_id: number;
  product_name: string;
  order_id: number | null;
  delta: number;
  kind: string;
  note: string;
  created_at: string;
};
export type Settings = {
  receipt_left_columns: number;
  require_customer_phone: boolean;
  name: string;
  phone: string;
  address: string;
  city: string;
};
export type State = {
  reminders: Replenishment[];
  containers: { balances: ContainerBalance[]; moves: ContainerMove[] };
  customers: Customer[];
  products: Product[];
  drivers: Driver[];
  orders: Order[];
  stockMoves: StockMove[];
  cashEntries: CashEntry[];
  settings: Settings;
  metrics: {
    sales_today: number;
    orders_today: number;
    open_orders: number;
    receivables: number;
    low_stock: number;
    cash_balance: number;
    received_today: number;
  };
  salesSeries: { date: string; total_cents: number }[];
  meta: {
    order_count: number;
    cash_entry_count: number;
    version: string;
    databasePath: string;
  };
};
export type Report = {
  orders: number;
  sales: number;
  paid: number;
  pending: number;
  products: {
    product_id: number;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  from: string;
  to: string;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type Input = Record<string, unknown>;
export type Bridge = {
  fiscalSummary: () => Promise<Result<FiscalSummary>>;
  fiscalCertificates: () => Promise<Result<FiscalCertificate[]>>;
  fiscalStatus: (input: Input) => Promise<Result<FiscalStatus>>;
  repeatOrderDraft: (input: Input) => Promise<Result<RepeatDraft>>;
  addContainerMove: (input: Input) => Promise<Result<number>>;
  reminderAction: (input: Input) => Promise<Result<void>>;
  reminderPreference: (input: Input) => Promise<Result<void>>;
  copyReminder: (input: Input) => Promise<Result<{ copied: boolean }>>;
  openReminderWhatsApp: (
    input: Input,
  ) => Promise<Result<{ url: string; opened: boolean; test?: boolean }>>;

  lookupPostal: (
    cep: string,
  ) => Promise<Result<{ addresses: PostalAddress[]; offline: boolean }>>;
  bootstrap: () => Promise<Result<State>>;
  saveCustomer: (input: Input) => Promise<Result<number>>;
  saveProduct: (input: Input) => Promise<Result<number>>;
  saveDriver: (input: Input) => Promise<Result<number>>;
  createOrder: (input: Input) => Promise<Result<number>>;
  changeOrderStatus: (input: Input) => Promise<Result<void>>;
  assignDriver: (input: Input) => Promise<Result<void>>;
  receivePayment: (input: Input) => Promise<Result<void>>;
  adjustStock: (input: Input) => Promise<Result<void>>;
  addCashEntry: (input: Input) => Promise<Result<void>>;
  saveSettings: (input: Input) => Promise<Result<void>>;
  report: (from: string, to: string) => Promise<Result<Report>>;
  backup: () => Promise<Result<string | null>>;
  exportData: (kind: string) => Promise<Result<string | null>>;
  printOrder: (id: number) => Promise<Result<boolean>>;
  seedDemo: () => Promise<Result<void>>;
};
declare global {
  interface Window {
    gasgestao: Bridge;
  }
}
export const api = window.gasgestao;
export async function request<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
export const currency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const dateText = (value: string, withTime = false) =>
  new Date(value).toLocaleString(
    "pt-BR",
    withTime
      ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "2-digit", year: "numeric" },
  );
export const phoneText = (s: string) =>
  s.length === 11
    ? `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`
    : s.length === 10
      ? `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`
      : s || "Sem telefone";
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const amount = (text: string) => {
  const s = text.trim().replace(/\s|R\$/g, "");
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Informe um valor válido, por exemplo 110,00.");
  return Math.round(Number(normalized) * 100);
};
export const moneyInput = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", ",");
export const statusLabels: Record<Status, string> = {
  novo: "Novo",
  preparando: "Em preparo",
  em_rota: "Em rota",
  entregue: "Entregue",
  cancelado: "Cancelado",
};
export const paymentLabels: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  debito: "Cartão de débito",
  credito: "Cartão de crédito",
  fiado: "A prazo / fiado",
};
export { contains } from "../shared/search.mjs";
