import { ValidationError, localDate } from "./store.mjs";
const fail = (message) => {
  throw new ValidationError(message);
};
const int = (value, label, min = 1, max = 1000000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} inválido.`);
  return value;
};
const note = (value, label, max = 2000) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`Informe ${label} (até ${max} caracteres).`);
  return value.trim();
};
const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / 86400000;
const dayFromNumber = (value) =>
  new Date(value * 86400000).toISOString().slice(0, 10);
export function whatsappUrl(phone, message) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  if (!/^55[1-9]\d{9,10}$/.test(digits))
    fail(
      "Informe um telefone brasileiro com DDD válido no cadastro do cliente.",
    );
  return `https://wa.me/${digits}?text=${encodeURIComponent(note(message, "a mensagem", 2000))}`;
}
export class Engagement {
  constructor(store) {
    this.store = store;
    this.db = store.db;
  }
  repeatDraft(input) {
    let source;
    if (input.order_id)
      source = this.store.getOrder(int(input.order_id, "Pedido"));
    else {
      const customer = this.store.getEntity(
        "customers",
        input.customer_id,
        "Cliente",
        true,
      );
      const row = this.db
        .prepare(
          "SELECT id FROM orders WHERE customer_id=? AND status<>'cancelado' ORDER BY created_at DESC,id DESC LIMIT 1",
        )
        .get(customer.id);
      if (!row) fail("Este cliente ainda não possui um pedido para repetir.");
      source = this.store.getOrder(row.id);
    }
    if (source.status === "cancelado")
      fail("Selecione um pedido não cancelado para repetir.");
    this.store.getEntity("customers", source.customer_id, "Cliente", true);
    const warnings = [];
    const items = source.items.map((item) => {
      const current = this.store.getEntity(
        "products",
        item.product_id,
        "Produto",
      );
      if (!current.active)
        warnings.push(
          `${current.name}: produto inativo; remova ou substitua antes de salvar.`,
        );
      else if (current.stock < item.quantity)
        warnings.push(
          `${current.name}: estoque atual ${current.stock}, quantidade sugerida ${item.quantity}.`,
        );
      return { product_id: current.id, quantity: item.quantity };
    });
    return {
      source_id: source.id,
      customer_id: source.customer_id,
      delivery_type: source.delivery_type,
      delivery_address: source.delivery_address,
      delivery_fee_cents: source.delivery_fee_cents,
      items,
      warnings,
    };
  }
  containerMove(input) {
    return this.store.transaction(() => {
      if (!["emprestimo", "devolucao"].includes(input.kind))
        fail("Tipo de movimentação de vasilhame inválido.");
      const loan = input.kind === "emprestimo";
      const customer = this.store.getEntity(
        "customers",
        input.customer_id,
        "Cliente",
        loan,
      );
      const product = this.store.getEntity(
        "products",
        input.product_id,
        "Produto",
        loan,
      );
      const quantity = int(input.quantity, "Quantidade", 1, 10000);
      const description = note(input.note, "o motivo ou a referência", 300);
      const balance = this.db
        .prepare(
          "SELECT COALESCE(SUM(delta),0) AS total FROM container_moves WHERE customer_id=? AND product_id=?",
        )
        .get(customer.id, product.id).total;
      if (!loan && quantity > balance)
        fail(`A devolução supera o saldo emprestado (${balance}).`);
      return Number(
        this.db
          .prepare(
            "INSERT INTO container_moves(customer_id,product_id,delta,kind,note,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            customer.id,
            product.id,
            loan ? quantity : -quantity,
            input.kind,
            description,
            this.store.timestamp(),
          ).lastInsertRowid,
      );
    });
  }
  containerState() {
    return {
      balances: this.db
        .prepare(
          "SELECT m.customer_id,m.product_id,c.name AS customer_name,p.name AS product_name,SUM(m.delta) AS quantity FROM container_moves m JOIN customers c ON c.id=m.customer_id JOIN products p ON p.id=m.product_id GROUP BY m.customer_id,m.product_id HAVING SUM(m.delta)>0 ORDER BY c.name,p.name",
        )
        .all(),
      moves: this.db
        .prepare(
          "SELECT m.*,c.name AS customer_name,p.name AS product_name FROM container_moves m JOIN customers c ON c.id=m.customer_id JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 500",
        )
        .all(),
    };
  }
  reminders() {
    const today = dayNumber(localDate(this.store.now()));
    const rows = this.db
      .prepare(
        `WITH purchases AS (
      SELECT o.customer_id,i.product_id,date(COALESCE(o.delivered_at,o.created_at),'localtime') AS day,SUM(i.quantity) AS quantity,MAX(o.id) AS last_order_id
      FROM orders o JOIN order_items i ON i.order_id=o.id JOIN customers c ON c.id=o.customer_id JOIN products p ON p.id=i.product_id
      WHERE o.status='entregue' AND c.active=1 AND p.active=1 GROUP BY o.customer_id,i.product_id,day
    ), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY customer_id,product_id ORDER BY day DESC) AS rn FROM purchases)
    SELECT * FROM ranked WHERE rn<=7 ORDER BY customer_id,product_id,day`,
      )
      .all();
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.customer_id}:${row.product_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const pending = new Set(
      this.db
        .prepare(
          "SELECT DISTINCT o.customer_id,i.product_id FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.status IN ('novo','preparando','em_rota')",
        )
        .all()
        .map((r) => `${r.customer_id}:${r.product_id}`),
    );
    const preferences = new Map(
      this.db
        .prepare("SELECT * FROM reminder_preferences")
        .all()
        .map((r) => [r.customer_id, r.enabled]),
    );
    const events = this.db
      .prepare("SELECT * FROM reminder_events ORDER BY id DESC")
      .all();
    const eventGroups = new Map();
    for (const event of events) {
      const key = `${event.customer_id}:${event.product_id}:${event.last_order_id}`;
      if (!eventGroups.has(key)) eventGroups.set(key, []);
      eventGroups.get(key).push(event);
    }
    const result = [];
    for (const [key, history] of groups) {
      if (history.length < 3) continue;
      const intervals = [];
      for (let i = 1; i < history.length; i++) {
        const days = dayNumber(history[i].day) - dayNumber(history[i - 1].day);
        if (days > 0) intervals.push(days / history[i - 1].quantity);
      }
      if (intervals.length < 2) continue;
      const average = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const last = history.at(-1),
        expected = Math.max(1, Math.round(average * last.quantity)),
        due = dayNumber(last.day) + expected;
      const customer = this.store.getEntity(
          "customers",
          last.customer_id,
          "Cliente",
        ),
        product = this.store.getEntity("products", last.product_id, "Produto");
      const cycleEvents = eventGroups.get(`${key}:${last.last_order_id}`) || [];
      const contact = cycleEvents.find((e) => e.kind === "contato");
      const contacted = !!contact;
      const lastOpened = cycleEvents.find((e) => e.kind === "whatsapp_aberto");
      const snooze = cycleEvents.find((e) => e.kind === "adiado");
      const snoozed = !!snooze && dayNumber(snooze.until_date) > today;
      const enabled = preferences.get(customer.id) !== 0;
      result.push({
        customer_id: customer.id,
        customer_name: customer.name,
        phone: customer.phone,
        product_id: product.id,
        product_name: product.name,
        last_order_id: last.last_order_id,
        last_purchase: last.day,
        last_quantity: last.quantity,
        purchases: history.length,
        average_days: Math.round(average * 10) / 10,
        expected_days: expected,
        due_date: dayFromNumber(due),
        days_until: due - today,
        contacted,
        contacted_at: contact?.created_at || "",
        contact_message: contact?.message || "",
        last_opened_at: lastOpened?.created_at || "",
        snoozed,
        snooze_until: snooze?.until_date || "",
        enabled,
        pending_order: pending.has(key),
        actionable:
          due <= today &&
          !contacted &&
          !snoozed &&
          enabled &&
          !pending.has(key),
        message: `Olá, ${customer.name}! Tudo bem? Aqui é da ${this.store.settings().name}. Está precisando repor ${product.name}? Se quiser, podemos combinar uma entrega no melhor horário para você.`,
      });
    }
    return result.sort(
      (a, b) =>
        a.days_until - b.days_until ||
        a.customer_name.localeCompare(b.customer_name),
    );
  }
  currentReminder(input) {
    const customerId = int(input.customer_id, "Cliente"),
      productId = int(input.product_id, "Produto"),
      lastOrder = int(input.last_order_id, "Pedido de referência");
    const row = this.reminders().find(
      (r) =>
        r.customer_id === customerId &&
        r.product_id === productId &&
        r.last_order_id === lastOrder,
    );
    if (!row)
      fail(
        "O histórico mudou. Atualize a lista de lembretes antes de continuar.",
      );
    return row;
  }
  reminderAction(input) {
    const row = this.currentReminder(input);
    if (!["contato", "adiado"].includes(input.kind))
      fail("Ação de lembrete inválida.");
    const until =
      input.kind === "adiado"
        ? dayFromNumber(
            dayNumber(localDate(this.store.now())) +
              int(input.days, "Dias para adiar", 1, 90),
          )
        : "";
    this.db
      .prepare(
        "INSERT OR IGNORE INTO reminder_events(customer_id,product_id,last_order_id,kind,message,until_date,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        row.customer_id,
        row.product_id,
        row.last_order_id,
        input.kind,
        typeof input.message === "string" ? input.message.slice(0, 2000) : "",
        until,
        this.store.timestamp(),
      );
  }
  setReminderPreference(input) {
    this.store.getEntity("customers", input.customer_id, "Cliente");
    if (typeof input.enabled !== "boolean")
      fail("Preferência de lembrete inválida.");
    this.db
      .prepare(
        "INSERT INTO reminder_preferences(customer_id,enabled) VALUES(?,?) ON CONFLICT(customer_id) DO UPDATE SET enabled=excluded.enabled",
      )
      .run(input.customer_id, input.enabled ? 1 : 0);
  }
  copyMessage(input) {
    this.currentReminder(input);
    return note(input.message, "a mensagem", 2000);
  }
  prepareWhatsApp(input) {
    const row = this.currentReminder(input);
    if (!row.enabled) fail("Os lembretes deste cliente estão desativados.");
    if (row.contacted || row.snoozed || row.pending_order)
      fail(
        "Este lembrete já foi tratado, adiado ou possui pedido em andamento. Atualize a lista.",
      );
    return { row, url: whatsappUrl(row.phone, input.message) };
  }
  recordWhatsAppOpened(input) {
    const row = this.currentReminder(input);
    this.db
      .prepare(
        "INSERT INTO reminder_events(customer_id,product_id,last_order_id,kind,message,until_date,created_at) VALUES(?,?,?,'whatsapp_aberto',?,'',?)",
      )
      .run(
        row.customer_id,
        row.product_id,
        row.last_order_id,
        note(input.message, "a mensagem"),
        this.store.timestamp(),
      );
  }
}
