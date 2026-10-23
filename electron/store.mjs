import { normalizeCnpj, validCnpj } from "./cnpj.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class ValidationError extends Error {}
const fail = (message) => {
  throw new ValidationError(message);
};
const text = (value, label, max = 160, mandatory = true) => {
  if (typeof value !== "string")
    return mandatory ? fail(`Informe ${label}.`) : "";
  const v = value.trim();
  if (mandatory && !v) fail(`Informe ${label}.`);
  if (v.length > max) fail(`${label} pode ter até ${max} caracteres.`);
  return v;
};
const integer = (value, label, min = 0, max = 1000000000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} inválido.`);
  return value;
};
const id = (value) => integer(value, "Código", 1);
const phone = (value) => {
  const p = text(value, "telefone", 30, false).replace(/\D/g, "");
  if (p && (p.length < 10 || p.length > 13))
    fail("Informe um telefone com DDD.");
  return p;
};
export const PAYMENT_METHODS = [
  "dinheiro",
  "pix",
  "debito",
  "credito",
  "fiado",
];
const method = (value, allowCredit = true) => {
  if (!PAYMENT_METHODS.includes(value) || (!allowCredit && value === "fiado"))
    fail("Forma de pagamento inválida.");
  return value;
};
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export class Store {
  constructor(filename, { now = () => new Date() } = {}) {
    if (filename !== ":memory:")
      mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.now = now;
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;",
    );
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 4)
      throw new Error(
        "Este banco foi criado por uma versão mais recente do GasGestão.",
      );
    if (version === 0)
      this.transaction(() => {
        this.db.exec(`
        CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', neighborhood TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT 'un', price_cents INTEGER NOT NULL CHECK(price_cents>=0), cost_cents INTEGER NOT NULL CHECK(cost_cents>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), min_stock INTEGER NOT NULL DEFAULT 0 CHECK(min_stock>=0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
        CREATE TABLE drivers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
        CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id), driver_id INTEGER REFERENCES drivers(id), status TEXT NOT NULL CHECK(status IN ('novo','preparando','em_rota','entregue','cancelado')), delivery_type TEXT NOT NULL CHECK(delivery_type IN ('entrega','retirada')), delivery_address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', payment_method TEXT NOT NULL, subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>=0), delivery_fee_cents INTEGER NOT NULL CHECK(delivery_fee_cents>=0), discount_cents INTEGER NOT NULL CHECK(discount_cents>=0), total_cents INTEGER NOT NULL CHECK(total_cents>0), paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(paid_cents>=0 AND paid_cents<=total_cents), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT);
        CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0), unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0), total_cents INTEGER NOT NULL CHECK(total_cents>=0));
        CREATE TABLE stock_moves (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), order_id INTEGER REFERENCES orders(id), delta INTEGER NOT NULL CHECK(delta<>0), kind TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE cash_entries (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), flow TEXT NOT NULL CHECK(flow IN ('entrada','saida')), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), method TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX orders_date ON orders(created_at);
        CREATE INDEX orders_status ON orders(status);
        CREATE INDEX cash_date ON cash_entries(created_at);
        CREATE INDEX stock_product ON stock_moves(product_id);
        CREATE INDEX items_order ON order_items(order_id);
        PRAGMA user_version=1;
      `);
        this.db.prepare("INSERT INTO settings(id,value) VALUES(1,?)").run(
          JSON.stringify({
            name: "Minha revenda",
            phone: "",
            address: "",
            city: "",
          }),
        );
      });
    if (version < 2)
      this.transaction(() => {
        this.db.exec(
          "ALTER TABLE customers ADD COLUMN postal_code TEXT NOT NULL DEFAULT ''; ALTER TABLE customers ADD COLUMN uf TEXT NOT NULL DEFAULT ''; PRAGMA user_version=2;",
        );
      });
    if (version < 3)
      this.transaction(() => {
        this.db.exec(
          "ALTER TABLE customers ADD COLUMN cnpj TEXT NOT NULL DEFAULT ''; PRAGMA user_version=3;",
        );
      });
    if (version < 4)
      this.transaction(() => {
        this.db.exec(`
        CREATE TABLE container_moves(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),product_id INTEGER NOT NULL REFERENCES products(id),delta INTEGER NOT NULL CHECK(delta<>0),kind TEXT NOT NULL CHECK(kind IN ('emprestimo','devolucao')),note TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX containers_customer_product ON container_moves(customer_id,product_id);
        CREATE TABLE reminder_preferences(customer_id INTEGER PRIMARY KEY REFERENCES customers(id),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
        CREATE TABLE reminder_events(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),product_id INTEGER NOT NULL REFERENCES products(id),last_order_id INTEGER NOT NULL REFERENCES orders(id),kind TEXT NOT NULL CHECK(kind IN ('contato','adiado','whatsapp_aberto')),message TEXT NOT NULL DEFAULT '',until_date TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
        CREATE INDEX reminder_cycle ON reminder_events(customer_id,product_id,last_order_id);
        CREATE UNIQUE INDEX reminder_contact_once ON reminder_events(customer_id,product_id,last_order_id) WHERE kind='contato';
        CREATE INDEX items_customer_reminder ON order_items(product_id,order_id);
        PRAGMA user_version=4;
      `);
      });
  }
  timestamp() {
    return this.now().toISOString();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  getEntity(table, entityId, label, active = false) {
    if (!["customers", "products", "drivers", "orders"].includes(table))
      throw new Error("Tabela inválida");
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE id=?`)
      .get(id(entityId));
    if (!row || (active && !row.active))
      fail(`${label} não encontrado ou inativo.`);
    return row;
  }
  saveCustomer(input) {
    const rawCnpj = text(input.cnpj, "CNPJ", 18, false);
    if (rawCnpj && !validCnpj(rawCnpj))
      fail(
        "CNPJ inválido. Confira as letras, números e dígitos verificadores.",
      );
    const customerPhone = phone(input.phone);
    if (!customerPhone && this.settings().require_customer_phone)
      fail("Informe o telefone com DDD do cliente.");
    const cep = text(input.postal_code, "CEP", 9, false);
    if (cep && !/^\d{5}-?\d{3}$/.test(cep))
      fail("Informe um CEP com 8 dígitos.");
    const uf = text(input.uf, "UF", 2, false).toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) fail("Informe a UF com duas letras.");
    const values = [
      text(input.name, "o nome do cliente"),
      customerPhone,
      text(input.address, "endereço", 250, false),
      text(input.neighborhood, "bairro", 100, false),
      text(input.city, "cidade", 100, false),
      text(input.notes, "observações", 1000, false),
      input.active === false ? 0 : 1,
      cep.replace("-", ""),
      uf,
      normalizeCnpj(rawCnpj),
    ];
    if (input.id) {
      this.getEntity("customers", input.id, "Cliente");
      this.db
        .prepare(
          "UPDATE customers SET name=?,phone=?,address=?,neighborhood=?,city=?,notes=?,active=?,postal_code=?,uf=?,cnpj=? WHERE id=?",
        )
        .run(...values, id(input.id));
      return input.id;
    }
    return Number(
      this.db
        .prepare(
          "INSERT INTO customers(name,phone,address,neighborhood,city,notes,active,postal_code,uf,cnpj) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(...values).lastInsertRowid,
    );
  }
  saveDriver(input) {
    const values = [
      text(input.name, "o nome do entregador"),
      phone(input.phone),
      input.active === false ? 0 : 1,
    ];
    if (input.id) {
      this.getEntity("drivers", input.id, "Entregador");
      this.db
        .prepare("UPDATE drivers SET name=?,phone=?,active=? WHERE id=?")
        .run(...values, id(input.id));
      return input.id;
    }
    return Number(
      this.db
        .prepare("INSERT INTO drivers(name,phone,active) VALUES(?,?,?)")
        .run(...values).lastInsertRowid,
    );
  }
  saveProduct(input) {
    const values = [
      text(input.name, "o nome do produto"),
      text(input.category, "categoria", 60, false),
      text(input.unit || "un", "unidade", 15),
      integer(input.price_cents, "Preço"),
      integer(input.cost_cents, "Custo"),
      integer(input.min_stock, "Estoque mínimo", 0, 1000000),
      input.active === false ? 0 : 1,
    ];
    if (input.id) {
      this.getEntity("products", input.id, "Produto");
      this.db
        .prepare(
          "UPDATE products SET name=?,category=?,unit=?,price_cents=?,cost_cents=?,min_stock=?,active=? WHERE id=?",
        )
        .run(...values, id(input.id));
      return input.id;
    }
    const stock = integer(input.stock ?? 0, "Estoque inicial", 0, 1000000);
    return this.transaction(() => {
      const productId = Number(
        this.db
          .prepare(
            "INSERT INTO products(name,category,unit,price_cents,cost_cents,min_stock,active,stock) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(...values, stock).lastInsertRowid,
      );
      if (stock)
        this.db
          .prepare(
            "INSERT INTO stock_moves(product_id,delta,kind,note,created_at) VALUES(?,?,?,?,?)",
          )
          .run(
            productId,
            stock,
            "inicial",
            "Saldo inicial do cadastro",
            this.timestamp(),
          );
      return productId;
    });
  }
  createOrder(input) {
    return this.transaction(() => {
      const customer = this.getEntity(
        "customers",
        input.customer_id,
        "Cliente",
        true,
      );
      const driverId = input.driver_id
        ? this.getEntity("drivers", input.driver_id, "Entregador", true).id
        : null;
      if (!["entrega", "retirada"].includes(input.delivery_type))
        fail("Tipo de entrega inválido.");
      const deliveryAddress = text(
        input.delivery_address,
        "endereço de entrega",
        300,
        false,
      );
      if (input.delivery_type === "entrega" && !deliveryAddress)
        fail("Informe o endereço da entrega.");
      if (
        !Array.isArray(input.items) ||
        !input.items.length ||
        input.items.length > 100
      )
        fail("Adicione de 1 a 100 produtos ao pedido.");
      const quantities = new Map();
      for (const item of input.items)
        quantities.set(
          id(item.product_id),
          (quantities.get(item.product_id) || 0) +
            integer(item.quantity, "Quantidade", 1, 10000),
        );
      const items = [...quantities].map(([productId, quantity]) => {
        integer(quantity, "Quantidade", 1, 10000);
        const product = this.getEntity("products", productId, "Produto", true);
        if (product.stock < quantity)
          fail(
            `Estoque insuficiente para ${product.name}. Disponível: ${product.stock}.`,
          );
        const total = integer(product.price_cents * quantity, "Total do item");
        return { ...product, quantity, total };
      });
      const subtotal = integer(
        items.reduce((sum, item) => sum + item.total, 0),
        "Subtotal",
      );
      const fee = integer(input.delivery_fee_cents ?? 0, "Taxa de entrega");
      const discount = integer(input.discount_cents ?? 0, "Desconto");
      const total = integer(subtotal + fee - discount, "Total do pedido", 1);
      const paymentMethod = method(input.payment_method);
      const initialPayment = integer(
        input.paid_cents ?? 0,
        "Valor recebido",
        0,
        total,
      );
      if (paymentMethod === "fiado" && initialPayment)
        fail("Para receber agora, selecione uma forma de pagamento.");
      const ts = this.timestamp();
      const orderId = Number(
        this.db
          .prepare(
            "INSERT INTO orders(customer_id,driver_id,status,delivery_type,delivery_address,notes,payment_method,subtotal_cents,delivery_fee_cents,discount_cents,total_cents,created_at,updated_at) VALUES(?,?,'novo',?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            customer.id,
            driverId,
            input.delivery_type,
            deliveryAddress,
            text(input.notes, "observações", 1000, false),
            paymentMethod,
            subtotal,
            fee,
            discount,
            total,
            ts,
            ts,
          ).lastInsertRowid,
      );
      for (const item of items) {
        this.db
          .prepare(
            "INSERT INTO order_items(order_id,product_id,name,quantity,unit_price_cents,unit_cost_cents,total_cents) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            orderId,
            item.id,
            item.name,
            item.quantity,
            item.price_cents,
            item.cost_cents,
            item.total,
          );
        this.db
          .prepare("UPDATE products SET stock=stock-? WHERE id=?")
          .run(item.quantity, item.id);
        this.db
          .prepare(
            "INSERT INTO stock_moves(product_id,order_id,delta,kind,note,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            item.id,
            orderId,
            -item.quantity,
            "pedido",
            `Pedido #${orderId}`,
            ts,
          );
      }
      if (initialPayment)
        this.recordPayment(orderId, initialPayment, paymentMethod);
      return orderId;
    });
  }
  recordPayment(orderId, amount, paymentMethod) {
    const order = this.getEntity("orders", orderId, "Pedido");
    if (order.status === "cancelado")
      fail("Pedidos cancelados não podem receber pagamentos.");
    integer(amount, "Valor recebido", 1, order.total_cents - order.paid_cents);
    method(paymentMethod, false);
    this.db
      .prepare(
        "INSERT INTO cash_entries(order_id,flow,amount_cents,method,description,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        order.id,
        "entrada",
        amount,
        paymentMethod,
        `Recebimento do pedido #${order.id}`,
        this.timestamp(),
      );
    this.db
      .prepare(
        "UPDATE orders SET paid_cents=paid_cents+?,updated_at=? WHERE id=?",
      )
      .run(amount, this.timestamp(), order.id);
  }
  receivePayment(input) {
    return this.transaction(() =>
      this.recordPayment(input.order_id, input.amount_cents, input.method),
    );
  }
  assignDriver(input) {
    const order = this.getEntity("orders", input.order_id, "Pedido");
    if (["entregue", "cancelado"].includes(order.status))
      fail("Este pedido já foi finalizado.");
    const driver = input.driver_id
      ? this.getEntity("drivers", input.driver_id, "Entregador", true).id
      : null;
    if (!driver && order.status === "em_rota")
      fail("Mantenha um entregador no pedido em rota.");
    this.db
      .prepare("UPDATE orders SET driver_id=?,updated_at=? WHERE id=?")
      .run(driver, this.timestamp(), order.id);
  }
  changeOrderStatus(input) {
    return this.transaction(() => {
      const order = this.getEntity("orders", input.order_id, "Pedido");
      const next = input.status;
      if (order.status === "cancelado") fail("Este pedido já está cancelado.");
      const allowed = {
        novo: ["preparando", "cancelado"],
        preparando: ["em_rota", "entregue", "cancelado"],
        em_rota: ["entregue", "cancelado"],
        entregue: ["cancelado"],
      };
      if (!allowed[order.status]?.includes(next))
        fail("Essa mudança de situação não é permitida.");
      if (
        next === "em_rota" &&
        (order.delivery_type !== "entrega" || !order.driver_id)
      )
        fail("Selecione um entregador para iniciar a rota.");
      if (
        order.delivery_type === "entrega" &&
        order.status === "preparando" &&
        next === "entregue"
      )
        fail("Envie o pedido para a rota antes de concluir a entrega.");
      if (next === "cancelado") {
        const items = this.db
          .prepare("SELECT * FROM order_items WHERE order_id=?")
          .all(order.id);
        for (const item of items) {
          this.db
            .prepare("UPDATE products SET stock=stock+? WHERE id=?")
            .run(item.quantity, item.product_id);
          this.db
            .prepare(
              "INSERT INTO stock_moves(product_id,order_id,delta,kind,note,created_at) VALUES(?,?,?,?,?,?)",
            )
            .run(
              item.product_id,
              order.id,
              item.quantity,
              "cancelamento",
              `Cancelamento do pedido #${order.id}`,
              this.timestamp(),
            );
        }
        const received = this.db
          .prepare(
            "SELECT method,SUM(amount_cents) AS amount FROM cash_entries WHERE order_id=? AND flow='entrada' GROUP BY method",
          )
          .all(order.id);
        for (const entry of received)
          this.db
            .prepare(
              "INSERT INTO cash_entries(order_id,flow,amount_cents,method,description,created_at) VALUES(?,?,?,?,?,?)",
            )
            .run(
              order.id,
              "saida",
              entry.amount,
              entry.method,
              `Estorno do pedido #${order.id}`,
              this.timestamp(),
            );
        this.db
          .prepare("UPDATE orders SET paid_cents=0 WHERE id=?")
          .run(order.id);
      }
      this.db
        .prepare(
          "UPDATE orders SET status=?,updated_at=?,delivered_at=? WHERE id=?",
        )
        .run(
          next,
          this.timestamp(),
          next === "entregue" ? this.timestamp() : order.delivered_at,
          order.id,
        );
    });
  }
  adjustStock(input) {
    return this.transaction(() => {
      const product = this.getEntity("products", input.product_id, "Produto");
      const delta = integer(input.delta, "Movimentação", -1000000, 1000000);
      if (!delta) fail("A movimentação deve ser diferente de zero.");
      const note = text(input.note, "o motivo da movimentação", 300);
      if (product.stock + delta < 0)
        fail("A saída supera o estoque disponível.");
      integer(product.stock + delta, "Saldo de estoque", 0, 1000000);
      this.db
        .prepare("UPDATE products SET stock=stock+? WHERE id=?")
        .run(delta, product.id);
      this.db
        .prepare(
          "INSERT INTO stock_moves(product_id,delta,kind,note,created_at) VALUES(?,?,?,?,?)",
        )
        .run(product.id, delta, "ajuste", note, this.timestamp());
    });
  }
  addCashEntry(input) {
    if (!["entrada", "saida"].includes(input.flow))
      fail("Tipo de lançamento inválido.");
    this.db
      .prepare(
        "INSERT INTO cash_entries(flow,amount_cents,method,description,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        input.flow,
        integer(input.amount_cents, "Valor", 1),
        method(input.method, false),
        text(input.description, "a descrição", 300),
        this.timestamp(),
      );
  }
  saveSettings(input) {
    const setting = {
      name: text(input.name, "o nome da revenda"),
      phone: phone(input.phone),
      address: text(input.address, "endereço", 250, false),
      city: text(input.city, "cidade", 100, false),
      receipt_left_columns: integer(
        input.receipt_left_columns ?? this.settings().receipt_left_columns,
        "Margem esquerda",
        0,
        40,
      ),
      require_customer_phone:
        input.require_customer_phone === undefined
          ? this.settings().require_customer_phone
          : input.require_customer_phone === true,
    };
    this.db
      .prepare("UPDATE settings SET value=? WHERE id=1")
      .run(JSON.stringify(setting));
  }
  settings() {
    return {
      receipt_left_columns: 0,
      require_customer_phone: false,
      ...JSON.parse(
        this.db.prepare("SELECT value FROM settings WHERE id=1").get().value,
      ),
    };
  }
  getOrder(orderId) {
    const order = this.db
      .prepare(
        "SELECT o.*,c.name AS customer_name,c.phone AS customer_phone,c.cnpj AS customer_cnpj,d.name AS driver_name FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN drivers d ON d.id=o.driver_id WHERE o.id=?",
      )
      .get(id(orderId));
    if (!order) fail("Pedido não encontrado.");
    return {
      ...order,
      items: this.db
        .prepare("SELECT * FROM order_items WHERE order_id=?")
        .all(order.id),
    };
  }
  getState() {
    const today = localDate(this.now());
    const orders = this.db
      .prepare(
        "SELECT o.*,c.name AS customer_name,c.phone AS customer_phone,c.cnpj AS customer_cnpj,d.name AS driver_name FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN drivers d ON d.id=o.driver_id ORDER BY o.id DESC LIMIT 500",
      )
      .all();
    const allItems = this.db
      .prepare(
        "SELECT i.* FROM order_items i JOIN (SELECT id FROM orders ORDER BY id DESC LIMIT 500) o ON o.id=i.order_id",
      )
      .all();
    const groups = new Map();
    for (const item of allItems) {
      if (!groups.has(item.order_id)) groups.set(item.order_id, []);
      groups.get(item.order_id).push(item);
    }
    const cash = this.db
      .prepare("SELECT * FROM cash_entries ORDER BY id DESC LIMIT 1000")
      .all();
    const metrics = this.db
      .prepare(
        `SELECT (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE date(created_at,'localtime')=? AND status<>'cancelado') AS sales_today, (SELECT COUNT(*) FROM orders WHERE date(created_at,'localtime')=? AND status<>'cancelado') AS orders_today, (SELECT COUNT(*) FROM orders WHERE status NOT IN ('entregue','cancelado')) AS open_orders, (SELECT COALESCE(SUM(total_cents-paid_cents),0) FROM orders WHERE status<>'cancelado') AS receivables, (SELECT COUNT(*) FROM products WHERE active=1 AND stock<=min_stock) AS low_stock, (SELECT COALESCE(SUM(CASE WHEN flow='entrada' THEN amount_cents ELSE -amount_cents END),0) FROM cash_entries) AS cash_balance, (SELECT COALESCE(SUM(CASE WHEN flow='entrada' THEN amount_cents ELSE -amount_cents END),0) FROM cash_entries WHERE date(created_at,'localtime')=?) AS received_today`,
      )
      .get(today, today, today);
    const series = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(this.now());
      day.setDate(day.getDate() - i);
      const key = localDate(day);
      const row = this.db
        .prepare(
          "SELECT COALESCE(SUM(total_cents),0) AS total FROM orders WHERE date(created_at,'localtime')=? AND status<>'cancelado'",
        )
        .get(key);
      series.push({ date: key, total_cents: row.total });
    }
    return {
      customers: this.db
        .prepare("SELECT * FROM customers ORDER BY name COLLATE NOCASE")
        .all(),
      products: this.db
        .prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE")
        .all(),
      drivers: this.db
        .prepare("SELECT * FROM drivers ORDER BY name COLLATE NOCASE")
        .all(),
      orders: orders.map((o) => ({ ...o, items: groups.get(o.id) || [] })),
      stockMoves: this.db
        .prepare(
          "SELECT s.*,p.name AS product_name FROM stock_moves s JOIN products p ON p.id=s.product_id ORDER BY s.id DESC LIMIT 1000",
        )
        .all(),
      cashEntries: cash,
      settings: this.settings(),
      metrics,
      salesSeries: series,
      meta: {
        order_count: this.db
          .prepare("SELECT COUNT(*) AS count FROM orders")
          .get().count,
        cash_entry_count: this.db
          .prepare("SELECT COUNT(*) AS count FROM cash_entries")
          .get().count,
      },
    };
  }
  report(from, to) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to
    )
      fail("Período inválido.");
    const totals = this.db
      .prepare(
        "SELECT COUNT(*) AS orders,COALESCE(SUM(total_cents),0) AS sales,COALESCE(SUM(paid_cents),0) AS paid,COALESCE(SUM(total_cents-paid_cents),0) AS pending FROM orders WHERE date(created_at,'localtime') BETWEEN ? AND ? AND status<>'cancelado'",
      )
      .get(from, to);
    const products = this.db
      .prepare(
        "SELECT i.product_id,i.name,SUM(i.quantity) AS quantity,SUM(i.total_cents) AS revenue FROM order_items i JOIN orders o ON o.id=i.order_id WHERE date(o.created_at,'localtime') BETWEEN ? AND ? AND o.status<>'cancelado' GROUP BY i.product_id,i.name ORDER BY revenue DESC",
      )
      .all(from, to);
    return { ...totals, products, from, to };
  }
  backupTo(destination) {
    const target = resolve(destination);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    this.db.prepare("VACUUM INTO ?").run(tmp);
    const check = new DatabaseSync(tmp, { readOnly: true });
    try {
      if (
        check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw new Error("Falha ao verificar o backup.");
    } finally {
      check.close();
    }
    renameSync(tmp, target);
    return target;
  }
  seedDemo() {
    if (
      this.db.prepare("SELECT COUNT(*) AS count FROM customers").get().count ||
      this.db.prepare("SELECT COUNT(*) AS count FROM products").get().count ||
      this.db.prepare("SELECT COUNT(*) AS count FROM orders").get().count ||
      this.db.prepare("SELECT COUNT(*) AS count FROM cash_entries").get().count
    )
      fail("A demonstração só pode ser carregada em uma base vazia.");
    const customers = [
      "Ana — demonstração",
      "Bruno — demonstração",
      "Clara — demonstração",
      "Daniel — demonstração",
      "Elisa — demonstração",
      "Felipe — demonstração",
    ].map((name, i) =>
      this.saveCustomer({
        name,
        phone: `1190000000${i}`,
        address: `Rua Exemplo, ${100 + i * 20}`,
        neighborhood: ["Centro", "Jardim Exemplo", "Vila Modelo"][i % 3],
        city: "Cidade Exemplo",
        notes: "Cadastro fictício para demonstração",
      }),
    );
    const products = [
      {
        name: "Gás GLP P13",
        category: "Gás",
        unit: "un",
        price_cents: 11000,
        cost_cents: 8500,
        stock: 48,
        min_stock: 10,
      },
      {
        name: "Água mineral 20 L",
        category: "Água",
        unit: "un",
        price_cents: 1600,
        cost_cents: 900,
        stock: 70,
        min_stock: 15,
      },
      {
        name: "Gás GLP P45",
        category: "Gás",
        unit: "un",
        price_cents: 42000,
        cost_cents: 34000,
        stock: 6,
        min_stock: 3,
      },
      {
        name: "Água mineral 10 L",
        category: "Água",
        unit: "un",
        price_cents: 1200,
        cost_cents: 700,
        stock: 8,
        min_stock: 10,
      },
      {
        name: "Kit regulador e mangueira",
        category: "Acessórios",
        unit: "kit",
        price_cents: 5900,
        cost_cents: 3200,
        stock: 7,
        min_stock: 5,
      },
    ].map((p) => this.saveProduct(p));
    const drivers = ["Marcos — demonstração", "Rafael — demonstração"].map(
      (name) => this.saveDriver({ name, phone: "" }),
    );
    const realNow = this.now;
    try {
      for (let i = 0; i < 12; i++) {
        const day = new Date(realNow());
        if (i < 7) day.setDate(day.getDate() - (7 - i));
        day.setHours(8 + (i % 9), 15, 0, 0);
        this.now = () => day;
        const payment = ["pix", "dinheiro", "fiado"][i % 3];
        const orderId = this.createOrder({
          customer_id: customers[i % 6],
          driver_id: drivers[i % 2],
          delivery_type: "entrega",
          delivery_address: `Rua Exemplo, ${100 + (i % 6) * 20}`,
          payment_method: payment,
          items: [{ product_id: products[i % 2], quantity: 1 + (i % 2) }],
          delivery_fee_cents: 500,
          paid_cents: 0,
          notes: "Pedido fictício de demonstração",
        });
        if (i % 3 !== 2) {
          const o = this.getOrder(orderId);
          this.receivePayment({
            order_id: orderId,
            amount_cents: o.total_cents,
            method: payment,
          });
        }
        if (i < 9) {
          this.changeOrderStatus({ order_id: orderId, status: "preparando" });
          this.changeOrderStatus({ order_id: orderId, status: "em_rota" });
          if (i < 8)
            this.changeOrderStatus({ order_id: orderId, status: "entregue" });
        }
      }
    } finally {
      this.now = realNow;
    }
  }
}
