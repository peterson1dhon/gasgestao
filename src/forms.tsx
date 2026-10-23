import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Plus,
  Trash2,
  MapPin,
  UserRound,
  Package,
  Truck,
  Printer,
  CreditCard,
  ArrowRight,
  Ban,
  AlertTriangle,
} from "lucide-react";
import {
  api,
  currency,
  phoneText,
  dateText,
  amount,
  moneyInput,
  paymentLabels,
  statusLabels,
  type State,
  type RepeatDraft,
  type PostalAddress,
  type Result,
  type Order,
  type Customer,
  type Product,
  type Driver,
  type Status,
} from "./api";
import { Badge, Dialog, Field, FormFooter } from "./components";
export type Perform = (
  fn: () => Promise<Result<unknown>>,
  message: string,
  close?: boolean,
) => Promise<unknown>;
type Common = {
  close: () => void;
  busy: boolean;
  perform: Perform;
  error: string;
};
const get = (f: FormData, key: string) => String(f.get(key) ?? "");
const number = (f: FormData, key: string) => Number(get(f, key));
function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="inline-error" role="alert">
      <AlertTriangle size={16} />
      {error}
    </div>
  ) : null;
}
export function CustomerForm({ item, ...p }: Common & { item?: Customer }) {
  const [cep, setCep] = useState(item?.postal_code || "");
  const [address, setAddress] = useState(item?.address || "");
  const [city, setCity] = useState(item?.city || "");
  const [neighborhood, setNeighborhood] = useState(item?.neighborhood || "");
  const [uf, setUf] = useState(item?.uf || "");
  const [postalMessage, setPostalMessage] = useState("");
  const [matches, setMatches] = useState<PostalAddress[]>([]);
  const [chosen, setChosen] = useState("");
  const [lookupTick, setLookupTick] = useState(0);
  const current = useRef({ address, city, neighborhood, uf });
  current.current = { address, city, neighborhood, uf };
  function applyPostal(value: PostalAddress) {
    setAddress(value.street);
    setNeighborhood(value.neighborhood);
    setCity(value.city);
    setUf(value.uf);
  }
  useEffect(() => {
    let cancelled = false;
    setMatches([]);
    setChosen("");
    setPostalMessage("");
    if (!/^\d{5}-?\d{3}$/.test(cep.trim())) return;
    if (!lookupTick && cep === item?.postal_code) return;
    const timer = setTimeout(async () => {
      setPostalMessage("Consultando CEP na base offline…");
      const before = { ...current.current };
      try {
        const result = await api.lookupPostal(cep);
        if (cancelled) return;
        if (!result.ok) {
          setPostalMessage(result.error);
          return;
        }
        setMatches(result.data.addresses);
        if (!result.data.addresses.length) {
          setPostalMessage(
            "CEP não encontrado na base local. Preencha o endereço manualmente.",
          );
          return;
        }
        if (result.data.addresses.length === 1) {
          const found = result.data.addresses[0];
          setAddress((value) =>
            value === before.address ? found.street : value,
          );
          setNeighborhood((value) =>
            value === before.neighborhood ? found.neighborhood : value,
          );
          setCity((value) => (value === before.city ? found.city : value));
          setUf((value) => (value === before.uf ? found.uf : value));
          setPostalMessage(
            "CEP localizado offline. Confira o endereço e acrescente o número e complemento.",
          );
        } else
          setPostalMessage(
            "Este CEP possui mais de um endereço. Escolha abaixo.",
          );
      } catch {
        if (!cancelled)
          setPostalMessage(
            "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
          );
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cep, lookupTick, item?.postal_code]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.saveCustomer({
          id: item?.id,
          name: get(f, "name"),
          phone: get(f, "phone"),
          cnpj: get(f, "cnpj"),
          postal_code: cep,
          uf,
          address: get(f, "address"),
          neighborhood: get(f, "neighborhood"),
          city: get(f, "city"),
          notes: get(f, "notes"),
          active: f.has("active"),
        }),
      "Cliente salvo.",
    );
  };
  return (
    <Dialog
      title={item ? "Editar cliente" : "Novo cliente"}
      description="Os dados que você precisa para atender bem."
      onClose={p.close}
      busy={p.busy}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <ErrorText error={p.error} />
          <div className="form-grid">
            <Field
              label="Nome do cliente"
              name="name"
              defaultValue={item?.name}
              maxLength={160}
              required
              wide
              placeholder="Nome completo ou razão social"
            />
            <Field
              label="Telefone com DDD"
              name="phone"
              defaultValue={item?.phone}
              placeholder="(15) 90000-0000"
            />
            <Field
              label="CNPJ (opcional)"
              name="cnpj"
              defaultValue={item?.cnpj}
              maxLength={18}
              placeholder="Numérico ou alfanumérico"
            />
            <div className="postal-lookup wide">
              <Field
                label="CEP"
                name="postal_code"
                value={cep}
                onChange={(e) => setCep(e.target.value)}
                maxLength={9}
                inputMode="numeric"
                placeholder="00000-000"
              />
              <button
                className="button secondary"
                type="button"
                disabled={p.busy || !/^\d{5}-?\d{3}$/.test(cep.trim())}
                onClick={() => setLookupTick((t) => t + 1)}
              >
                Buscar CEP
              </button>
              <Field
                label="UF"
                name="uf"
                value={uf}
                onChange={(e) => setUf(e.target.value.toUpperCase())}
                maxLength={2}
              />
              {postalMessage && (
                <p className="postal-message" role="status">
                  {postalMessage}
                </p>
              )}
              {matches.length > 1 && (
                <Field label="Endereços encontrados" wide>
                  <select
                    value={chosen}
                    onChange={(e) => {
                      setChosen(e.target.value);
                      const found =
                        e.target.value === ""
                          ? undefined
                          : matches[Number(e.target.value)];
                      if (found) applyPostal(found);
                    }}
                  >
                    <option value="">Selecione o endereço</option>
                    {matches.map((m, i) => (
                      <option key={i} value={i}>
                        {[m.street, m.neighborhood, m.city, m.uf]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <Field
              label="Cidade"
              name="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Sua cidade"
            />
            <Field
              label="Endereço"
              name="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rua, número e complemento"
              wide
            />
            <Field
              label="Bairro"
              name="neighborhood"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              wide
            />
            <Field label="Observações" wide>
              <textarea
                name="notes"
                defaultValue={item?.notes}
                rows={3}
                maxLength={1000}
                placeholder="Referência, preferência de atendimento…"
              />
            </Field>
            <label className="check-field wide">
              <input
                type="checkbox"
                name="active"
                defaultChecked={item ? !!item.active : true}
              />
              Cliente ativo
            </label>
          </div>
        </div>
        <FormFooter onClose={p.close} busy={p.busy} />
      </form>
    </Dialog>
  );
}
export function ProductForm({ item, ...p }: Common & { item?: Product }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.saveProduct({
          id: item?.id,
          name: get(f, "name"),
          category: get(f, "category"),
          unit: get(f, "unit"),
          price_cents: amount(get(f, "price")),
          cost_cents: amount(get(f, "cost")),
          stock: number(f, "stock"),
          min_stock: number(f, "min_stock"),
          active: f.has("active"),
        }),
      "Produto salvo.",
    );
  };
  return (
    <Dialog
      title={item ? "Editar produto" : "Novo produto"}
      description="Preços e estoque organizados, sem complicação."
      onClose={p.close}
      busy={p.busy}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <ErrorText error={p.error} />
          <div className="form-grid">
            <Field
              label="Nome do produto"
              name="name"
              defaultValue={item?.name}
              required
              wide
              placeholder="Ex.: Gás GLP P13"
            />
            <Field
              label="Categoria"
              name="category"
              defaultValue={item?.category}
              placeholder="Gás, água, acessórios…"
            />
            <Field
              label="Unidade"
              name="unit"
              defaultValue={item?.unit || "un"}
              required
            />
            <Field
              label="Preço de venda (R$)"
              name="price"
              defaultValue={moneyInput(item?.price_cents || 0)}
              inputMode="decimal"
              required
            />
            <Field
              label="Custo unitário (R$)"
              name="cost"
              defaultValue={moneyInput(item?.cost_cents || 0)}
              inputMode="decimal"
              required
            />
            {!item && (
              <Field
                label="Estoque inicial"
                name="stock"
                type="number"
                defaultValue="0"
                min="0"
                step="1"
                required
              />
            )}
            <Field
              label="Estoque mínimo"
              name="min_stock"
              type="number"
              defaultValue={item?.min_stock || 0}
              min="0"
              step="1"
              required
            />
            {item && (
              <p className="field-hint wide">
                Saldo atual: {item.stock} {item.unit}. Para registrar entradas e
                saídas, use a página Estoque.
              </p>
            )}
            <label className="check-field wide">
              <input
                type="checkbox"
                name="active"
                defaultChecked={item ? !!item.active : true}
              />
              Produto ativo
            </label>
          </div>
        </div>
        <FormFooter onClose={p.close} busy={p.busy} />
      </form>
    </Dialog>
  );
}
export function DriverForm({ item, ...p }: Common & { item?: Driver }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.saveDriver({
          id: item?.id,
          name: get(f, "name"),
          phone: get(f, "phone"),
          active: f.has("active"),
        }),
      "Entregador salvo.",
    );
  };
  return (
    <Dialog
      title={item ? "Editar entregador" : "Novo entregador"}
      onClose={p.close}
      busy={p.busy}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <ErrorText error={p.error} />
          <div className="form-grid">
            <Field
              label="Nome do entregador"
              name="name"
              defaultValue={item?.name}
              required
              wide
            />
            <Field
              label="Telefone com DDD"
              name="phone"
              defaultValue={item?.phone}
              wide
            />
            <label className="check-field wide">
              <input
                name="active"
                type="checkbox"
                defaultChecked={item ? !!item.active : true}
              />
              Entregador ativo
            </label>
          </div>
        </div>
        <FormFooter onClose={p.close} busy={p.busy} />
      </form>
    </Dialog>
  );
}
export function StockForm({
  data,
  productId,
  ...p
}: Common & { data: State; productId?: number }) {
  const [selected, setSelected] = useState(
    productId || data.products[0]?.id || 0,
  );
  const product = data.products.find((i) => i.id === selected);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.adjustStock({
          product_id: selected,
          delta: number(f, "quantity") * (get(f, "flow") === "saida" ? -1 : 1),
          note: get(f, "note"),
        }),
      "Movimentação de estoque registrada.",
    );
  };
  return (
    <Dialog
      title="Movimentar estoque"
      description="Toda entrada ou saída fica no histórico."
      onClose={p.close}
      busy={p.busy}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <ErrorText error={p.error} />
          <div className="form-grid">
            <Field label="Produto" wide>
              <select
                aria-label="Produto"
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
                required
              >
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="context-strip wide">
              <Package size={18} />
              <span>Estoque disponível</span>
              <strong>
                {product?.stock || 0} {product?.unit}
              </strong>
            </div>
            <Field label="Tipo de movimentação">
              <select name="flow" defaultValue="entrada">
                <option value="entrada">Entrada / reposição</option>
                <option value="saida">Saída / ajuste</option>
              </select>
            </Field>
            <Field
              label="Quantidade"
              name="quantity"
              type="number"
              min="1"
              max="1000000"
              step="1"
              defaultValue="1"
              required
            />
            <Field label="Motivo" wide>
              <textarea
                name="note"
                rows={3}
                required
                maxLength={300}
                placeholder="Ex.: Compra de reposição, perda, inventário…"
              />
            </Field>
          </div>
        </div>
        <FormFooter
          onClose={p.close}
          busy={p.busy}
          label="Registrar movimentação"
        />
      </form>
    </Dialog>
  );
}
export function CashForm(p: Common) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.addCashEntry({
          flow: get(f, "flow"),
          amount_cents: amount(get(f, "amount")),
          method: get(f, "method"),
          description: get(f, "description"),
        }),
      "Lançamento registrado.",
    );
  };
  return (
    <Dialog
      title="Lançamento de caixa"
      description="Use o próprio pedido para registrar recebimentos de vendas."
      onClose={p.close}
      busy={p.busy}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <ErrorText error={p.error} />
          <div className="form-grid">
            <Field label="Tipo">
              <select name="flow">
                <option value="saida">Saída / despesa</option>
                <option value="entrada">Entrada / reforço</option>
              </select>
            </Field>
            <Field
              label="Valor (R$)"
              name="amount"
              inputMode="decimal"
              required
              placeholder="0,00"
            />
            <Field label="Forma de pagamento" wide>
              <PaymentSelect name="method" />
            </Field>
            <Field
              label="Descrição"
              wide
              name="description"
              required
              placeholder="Ex.: Combustível, reforço de caixa…"
              maxLength={300}
            />
          </div>
        </div>
        <FormFooter
          onClose={p.close}
          busy={p.busy}
          label="Registrar lançamento"
        />
      </form>
    </Dialog>
  );
}
function PaymentSelect({
  allowCredit = false,
  ...props
}: {
  allowCredit?: boolean;
  name?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  defaultValue?: string;
}) {
  return (
    <select {...props}>
      {Object.entries(paymentLabels)
        .filter(([k]) => allowCredit || k !== "fiado")
        .map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
    </select>
  );
}
export function ReceiveForm({ order, ...p }: Common & { order: Order }) {
  const remaining = order.total_cents - order.paid_cents;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.receivePayment({
          order_id: order.id,
          amount_cents: amount(get(f, "amount")),
          method: get(f, "method"),
        }),
      "Recebimento registrado.",
    );
  };
  return (
    <Dialog
      title={`Receber pedido #${order.id}`}
      description={order.customer_name}
      onClose={p.close}
      busy={p.busy}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <ErrorText error={p.error} />
          <div className="payment-summary">
            <span>Valor em aberto</span>
            <strong>{currency(remaining)}</strong>
          </div>
          <div className="form-grid">
            <Field
              label="Receber agora (R$)"
              name="amount"
              inputMode="decimal"
              defaultValue={moneyInput(remaining)}
              required
            />
            <Field label="Forma de pagamento">
              <PaymentSelect
                name="method"
                defaultValue={
                  order.payment_method === "fiado"
                    ? "pix"
                    : order.payment_method
                }
              />
            </Field>
          </div>
          <p className="field-hint">
            Você pode receber uma parte agora e registrar o restante depois.
          </p>
        </div>
        <FormFooter
          onClose={p.close}
          busy={p.busy}
          label="Confirmar recebimento"
        />
      </form>
    </Dialog>
  );
}
export function OrderForm({
  data,
  draft,
  ...p
}: Common & { data: State; draft?: RepeatDraft }) {
  const [customer, setCustomer] = useState(draft?.customer_id || 0),
    [address, setAddress] = useState(draft?.delivery_address || ""),
    [delivery, setDelivery] = useState(draft?.delivery_type || "entrega");
  const [productId, setProductId] = useState(0),
    [cart, setCart] = useState<{ product_id: number; quantity: number }[]>(
      draft?.items || [],
    );
  const [fee, setFee] = useState(
      draft ? moneyInput(draft.delivery_fee_cents) : "0,00",
    ),
    [discount, setDiscount] = useState("0,00"),
    [payment, setPayment] = useState("pix"),
    [received, setReceived] = useState("nao");
  const preview = (s: string) => {
    try {
      return amount(s);
    } catch {
      return 0;
    }
  };
  const subtotal = cart.reduce(
    (sum, i) =>
      sum +
      (data.products.find((p) => p.id === i.product_id)?.price_cents || 0) *
        i.quantity,
    0,
  );
  const total = subtotal + preview(fee) - preview(discount);
  const add = () => {
    if (!productId) return;
    setCart((old) =>
      old.some((i) => i.product_id === productId)
        ? old.map((i) =>
            i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i,
          )
        : [...old, { product_id: productId, quantity: 1 }],
    );
    setProductId(0);
  };
  const selectedCustomer = data.customers.find((c) => c.id === customer);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void p.perform(
      () =>
        api.createOrder({
          customer_id: customer,
          driver_id: number(f, "driver") || null,
          delivery_type: delivery,
          delivery_address: address,
          payment_method: payment,
          items: cart,
          delivery_fee_cents: amount(fee),
          discount_cents: amount(discount),
          paid_cents:
            received === "total"
              ? total
              : received === "parcial"
                ? amount(get(f, "received_amount"))
                : 0,
          notes: get(f, "notes"),
        }),
      "Pedido criado. Estoque reservado.",
    );
  };
  return (
    <Dialog
      title="Novo pedido"
      description="Lançamento de pedido"
      onClose={p.close}
      wide
      busy={p.busy}
    >
      <form onSubmit={submit} className="classic-order-form">
        <div className="classic-form-toolbar">
          <button type="submit" className="button primary" disabled={p.busy}>
            Salvar pedido (F2)
          </button>
          <button type="button" className="button secondary" onClick={p.close}>
            Cancelar (Esc)
          </button>
          <span>Lançamento de Pedido</span>
        </div>
        <div className="modal-body">
          <ErrorText error={p.error} />
          {draft && (
            <p className="body-note">
              Baseado no pedido #{draft.source_id}, com os preços atuais.
              Confira endereço, taxa, desconto e pagamento antes de criar.
            </p>
          )}
          {draft?.warnings.map((w) => (
            <p className="inline-error" key={w}>
              {w}
            </p>
          ))}
          <div className="order-form-layout">
            <div className="order-form-main">
              <div className="form-block-title">
                <UserRound size={17} />
                Cliente e entrega
              </div>
              <div className="form-grid">
                <Field label="Cliente" wide>
                  <select
                    aria-label="Cliente"
                    value={customer}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setCustomer(value);
                      const c = data.customers.find((c) => c.id === value);
                      setAddress(
                        c
                          ? [c.address, c.neighborhood, c.city]
                              .filter(Boolean)
                              .join(" • ")
                          : "",
                      );
                    }}
                    required
                  >
                    <option value="0">Selecione o cliente</option>
                    {data.customers
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.phone ? ` · ${phoneText(c.phone)}` : ""}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Atendimento">
                  <select
                    value={delivery}
                    onChange={(e) => setDelivery(e.target.value)}
                  >
                    <option value="entrega">Entrega no endereço</option>
                    <option value="retirada">Retirada no balcão</option>
                  </select>
                </Field>
                <Field label="Entregador">
                  <select name="driver" defaultValue="">
                    <option value="">Atribuir depois</option>
                    {data.drivers
                      .filter((d) => d.active)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </Field>
                {delivery === "entrega" && (
                  <Field
                    label="Endereço de entrega"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                    wide
                    placeholder="Rua, número, bairro e referência"
                  />
                )}
                {selectedCustomer?.notes && (
                  <p className="customer-note wide">{selectedCustomer.notes}</p>
                )}
              </div>
              <div className="form-block-title spaced">
                <Package size={17} />
                Produtos do pedido
              </div>
              <div className="classic-cart-head">
                <span>Cód.</span>
                <span>Descrição do produto</span>
                <span>Qtde.</span>
                <span>Valor total</span>
                <span />
              </div>
              <div className="cart-list">
                {cart.length ? (
                  cart.map((item) => {
                    const product = data.products.find(
                      (p) => p.id === item.product_id,
                    )!;
                    return (
                      <div className="cart-row" key={item.product_id}>
                        <div className="product-mini">{product.id}</div>
                        <div className="cart-name">
                          <strong>{product.name}</strong>
                          <small>
                            {currency(product.price_cents)} / {product.unit} ·{" "}
                            {product.stock} disponíveis
                          </small>
                        </div>
                        <input
                          aria-label={`Quantidade de ${product.name}`}
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity}
                          onChange={(e) =>
                            setCart((old) =>
                              old.map((i) =>
                                i.product_id === item.product_id
                                  ? {
                                      ...i,
                                      quantity: Number(e.target.value) || 1,
                                    }
                                  : i,
                              ),
                            )
                          }
                        />
                        <strong className="money">
                          {currency(product.price_cents * item.quantity)}
                        </strong>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remover ${product.name}`}
                          onClick={() =>
                            setCart((old) =>
                              old.filter(
                                (i) => i.product_id !== item.product_id,
                              ),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="cart-empty">
                    <Package size={24} />
                    <span>Adicione os produtos deste pedido.</span>
                  </div>
                )}
              </div>
              <div className="add-product">
                <select
                  aria-label="Adicionar produto"
                  value={productId}
                  onChange={(e) => setProductId(Number(e.target.value))}
                >
                  <option value="0">Escolha um produto…</option>
                  {data.products
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {currency(p.price_cents)} · {p.stock} em
                        estoque
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="button secondary"
                  onClick={add}
                  disabled={!productId}
                >
                  <Plus size={17} />
                  Adicionar
                </button>
              </div>
              <Field label="Observações do pedido" wide>
                <textarea
                  name="notes"
                  rows={2}
                  maxLength={1000}
                  placeholder="Referência de entrega, troco, instruções…"
                />
              </Field>
            </div>
            <aside className="order-summary">
              <div className="form-block-title">Fechamento do Pedido</div>
              <div className="summary-line">
                <span>Produtos</span>
                <strong>{currency(subtotal)}</strong>
              </div>
              <Field
                label="Taxa de entrega (R$)"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                required
              />
              <Field
                label="Desconto (R$)"
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                required
              />
              <div className="summary-total">
                <span>Total</span>
                <strong>{currency(total)}</strong>
              </div>
              <Field label="Forma de pagamento">
                <PaymentSelect
                  value={payment}
                  allowCredit
                  onChange={(e) => {
                    setPayment(e.target.value);
                    if (e.target.value === "fiado") setReceived("nao");
                  }}
                />
              </Field>
              <Field label="Recebimento">
                <select
                  value={received}
                  disabled={payment === "fiado"}
                  onChange={(e) => setReceived(e.target.value)}
                >
                  <option value="nao">Ainda não recebido</option>
                  <option value="total">Recebido integralmente</option>
                  <option value="parcial">Recebido parcialmente</option>
                </select>
              </Field>
              {received === "parcial" && (
                <Field
                  label="Recebido agora (R$)"
                  name="received_amount"
                  inputMode="decimal"
                  required
                  placeholder="0,00"
                />
              )}
              <div className="summary-note">
                <Package size={16} />
                <span>O estoque é reservado ao criar o pedido.</span>
              </div>
            </aside>
          </div>
        </div>
        <FormFooter onClose={p.close} busy={p.busy} label="Criar pedido" />
      </form>
    </Dialog>
  );
}
export function OrderDetails({
  order,
  data,
  onReceive,
  onCancel,
  onRepeat,
  ...p
}: Common & {
  order: Order;
  data: State;
  onReceive: () => void;
  onCancel: () => void;
  onRepeat: () => void;
}) {
  const finished = ["cancelado", "entregue"].includes(order.status);
  const next: Partial<Record<Status, Status>> = {
    novo: "preparando",
    preparando: order.delivery_type === "retirada" ? "entregue" : "em_rota",
    em_rota: "entregue",
  };
  const nextLabel: Partial<Record<Status, string>> = {
    novo: "Iniciar preparo",
    preparando:
      order.delivery_type === "retirada"
        ? "Concluir retirada"
        : "Enviar para entrega",
    em_rota: "Confirmar entrega",
  };
  return (
    <Dialog
      title={`Pedido #${String(order.id).padStart(4, "0")}`}
      description={dateText(order.created_at, true)}
      onClose={p.close}
      wide
      busy={p.busy}
    >
      <div className="modal-body">
        <ErrorText error={p.error} />
        <div className="detail-top">
          <button
            className="button secondary small"
            onClick={onRepeat}
            disabled={p.busy || order.status === "cancelado"}
          >
            Repetir pedido
          </button>
          <Badge status={order.status} />
          <span>
            {order.delivery_type === "entrega"
              ? "Entrega no endereço"
              : "Retirada no balcão"}
          </span>
          <button
            className="button secondary small"
            onClick={() =>
              void p.perform(() => api.printOrder(order.id), "", false)
            }
            disabled={p.busy}
          >
            <Printer size={16} />
            Imprimir comprovante
          </button>
        </div>
        <div className="detail-grid">
          <div className="detail-box">
            <UserRound size={19} />
            <div>
              <small>CLIENTE</small>
              <strong>{order.customer_name}</strong>
              <span>{phoneText(order.customer_phone)}</span>
            </div>
          </div>
          <div className="detail-box">
            <MapPin size={19} />
            <div>
              <small>ENDEREÇO</small>
              <span>{order.delivery_address || "Retirada na revenda"}</span>
            </div>
          </div>
          <div className="detail-box wide">
            <Truck size={19} />
            <div className="grow">
              <small>ENTREGADOR</small>
              {!finished ? (
                <select
                  aria-label="Entregador do pedido"
                  value={order.driver_id || ""}
                  disabled={p.busy}
                  onChange={(e) =>
                    void p.perform(
                      () =>
                        api.assignDriver({
                          order_id: order.id,
                          driver_id: Number(e.target.value) || null,
                        }),
                      "Entregador atualizado.",
                      false,
                    )
                  }
                >
                  <option value="">Não atribuído</option>
                  {data.drivers
                    .filter((d) => d.active || d.id === order.driver_id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              ) : (
                <span>{order.driver_name || "Não atribuído"}</span>
              )}
            </div>
          </div>
        </div>
        <div className="table-wrap detail-items">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Quantidade</th>
                <th>Unitário</th>
                <th className="align-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.name}</strong>
                  </td>
                  <td>{i.quantity}</td>
                  <td>{currency(i.unit_price_cents)}</td>
                  <td className="align-right money">
                    {currency(i.total_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail-bottom">
          <div>
            {order.notes && (
              <div className="notes-box">
                <small>OBSERVAÇÕES</small>
                <p>{order.notes}</p>
              </div>
            )}
            <div className="payment-tag">
              <CreditCard size={17} />
              {paymentLabels[order.payment_method]}
              <span
                className={`badge ${order.status === "cancelado" ? "neutral" : order.paid_cents === order.total_cents ? "paid" : "pending"}`}
              >
                {order.status === "cancelado"
                  ? "Estornado"
                  : order.paid_cents === order.total_cents
                    ? "Pago"
                    : order.paid_cents
                      ? "Parcial"
                      : "A receber"}
              </span>
            </div>
          </div>
          <div className="detail-totals">
            <div>
              <span>Produtos</span>
              <span>{currency(order.subtotal_cents)}</span>
            </div>
            <div>
              <span>Entrega</span>
              <span>{currency(order.delivery_fee_cents)}</span>
            </div>
            <div>
              <span>Desconto</span>
              <span>− {currency(order.discount_cents)}</span>
            </div>
            <div className="detail-grand">
              <span>Total</span>
              <strong>{currency(order.total_cents)}</strong>
            </div>
            <div>
              <span>Recebido</span>
              <span>{currency(order.paid_cents)}</span>
            </div>
            {order.status !== "cancelado" && (
              <div>
                <strong>A receber</strong>
                <strong>
                  {currency(order.total_cents - order.paid_cents)}
                </strong>
              </div>
            )}
          </div>
        </div>
      </div>
      <footer className="modal-footer detail-footer">
        <div>
          {order.status !== "cancelado" && (
            <button
              className="button danger-ghost"
              disabled={p.busy}
              onClick={onCancel}
            >
              <Ban size={16} />
              Cancelar pedido
            </button>
          )}
        </div>
        <div>
          {order.status !== "cancelado" &&
            order.paid_cents < order.total_cents && (
              <button
                className="button secondary"
                onClick={onReceive}
                disabled={p.busy}
              >
                <CreditCard size={17} />
                Registrar recebimento
              </button>
            )}
          {next[order.status] && (
            <button
              className="button primary"
              disabled={p.busy}
              onClick={() =>
                void p.perform(
                  () =>
                    api.changeOrderStatus({
                      order_id: order.id,
                      status: next[order.status],
                    }),
                  "Situação atualizada.",
                  false,
                )
              }
            >
              {nextLabel[order.status]}
              <ArrowRight size={17} />
            </button>
          )}
          {order.status === "cancelado" && (
            <button className="button secondary" onClick={p.close}>
              Fechar
            </button>
          )}
        </div>
      </footer>
    </Dialog>
  );
}
export function CancelOrder({ order, ...p }: Common & { order: Order }) {
  return (
    <Dialog
      title={`Cancelar pedido #${order.id}?`}
      onClose={p.close}
      busy={p.busy}
    >
      <div className="modal-body">
        <ErrorText error={p.error} />
        <div className="warning-card">
          <AlertTriangle size={22} />
          <div>
            <strong>Estoque e caixa serão atualizados</strong>
            <p>
              Os produtos voltarão ao estoque. Os {currency(order.paid_cents)}{" "}
              já recebidos serão registrados como estorno no caixa.
            </p>
          </div>
        </div>
        <p className="body-note">
          Confirme apenas se o pedido deve ser cancelado e a devolução dos
          produtos e valores será realizada.
        </p>
      </div>
      <footer className="modal-footer">
        <button
          className="button secondary"
          onClick={p.close}
          disabled={p.busy}
        >
          Manter pedido
        </button>
        <button
          className="button danger"
          disabled={p.busy}
          onClick={() =>
            void p.perform(
              () =>
                api.changeOrderStatus({
                  order_id: order.id,
                  status: "cancelado",
                }),
              "Pedido cancelado. Estoque e caixa atualizados.",
            )
          }
        >
          {p.busy ? "Cancelando…" : "Confirmar cancelamento"}
        </button>
      </footer>
    </Dialog>
  );
}
