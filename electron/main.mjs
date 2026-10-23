import {
  FiscalDiagnostics,
  STATUS_ENDPOINTS,
  validateStatusInput,
} from "./fiscal/status.mjs";
import { Engagement } from "./engagement.mjs";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  clipboard,
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Store, ValidationError, localDate } from "./store.mjs";
import { lookupPostal } from "./postal.mjs";
import { receiptHtml } from "./receipt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
app.setName("GasGestao");
if (process.env.GASGESTAO_DATA_DIR) {
  mkdirSync(process.env.GASGESTAO_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.GASGESTAO_DATA_DIR);
}
let store, engagement, fiscal, window;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox(
        "Não foi possível iniciar o GasGestão",
        error.message,
      );
      app.quit();
    });
}

async function backup() {
  const result = await dialog.showSaveDialog(window, {
    title: "Salvar backup do GasGestão",
    defaultPath: `GasGestao-backup-${localDate()}.sqlite`,
    filters: [{ name: "Backup GasGestão", extensions: ["sqlite"] }],
  });
  if (result.canceled || !result.filePath) return null;
  return store.backupTo(result.filePath);
}
function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
async function exportData(kind) {
  const state = store.getState();
  const definitions = {
    clientes: {
      headers: [
        "Código",
        "Nome",
        "Telefone",
        "Endereço",
        "Bairro",
        "Cidade",
        "CEP",
        "UF",
        "CNPJ",
        "Ativo",
      ],
      rows: state.customers.map((c) => [
        c.id,
        c.name,
        c.phone,
        c.address,
        c.neighborhood,
        c.city,
        c.postal_code,
        c.uf,
        c.cnpj,
        c.active ? "Sim" : "Não",
      ]),
    },
    produtos: {
      headers: [
        "Código",
        "Produto",
        "Categoria",
        "Preço (R$)",
        "Estoque",
        "Estoque mínimo",
        "Ativo",
      ],
      rows: state.products.map((p) => [
        p.id,
        p.name,
        p.category,
        (p.price_cents / 100).toFixed(2).replace(".", ","),
        p.stock,
        p.min_stock,
        p.active ? "Sim" : "Não",
      ]),
    },
    pedidos: {
      headers: [
        "Pedido",
        "Data",
        "Cliente",
        "Situação",
        "Total (R$)",
        "Recebido (R$)",
        "Forma",
        "Entregador",
      ],
      rows: state.orders.map((o) => [
        o.id,
        new Date(o.created_at).toLocaleString("pt-BR"),
        o.customer_name,
        o.status,
        (o.total_cents / 100).toFixed(2).replace(".", ","),
        (o.paid_cents / 100).toFixed(2).replace(".", ","),
        o.payment_method,
        o.driver_name,
      ]),
    },
    caixa: {
      headers: ["Data", "Descrição", "Tipo", "Valor (R$)", "Forma", "Pedido"],
      rows: state.cashEntries.map((c) => [
        new Date(c.created_at).toLocaleString("pt-BR"),
        c.description,
        c.flow,
        (c.amount_cents / 100).toFixed(2).replace(".", ","),
        c.method,
        c.order_id,
      ]),
    },
  };
  if (!Object.hasOwn(definitions, kind))
    throw new ValidationError("Exportação inválida.");
  // Exports include the complete history, independently of UI paging.
  if (kind === "pedidos") {
    const rows = store.db
      .prepare(
        "SELECT o.*,c.name AS customer_name,d.name AS driver_name FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN drivers d ON d.id=o.driver_id ORDER BY o.id DESC",
      )
      .all();
    definitions.pedidos.rows = rows.map((o) => [
      o.id,
      new Date(o.created_at).toLocaleString("pt-BR"),
      o.customer_name,
      o.status,
      (o.total_cents / 100).toFixed(2).replace(".", ","),
      (o.paid_cents / 100).toFixed(2).replace(".", ","),
      o.payment_method,
      o.driver_name,
    ]);
  }
  if (kind === "caixa")
    definitions.caixa.rows = store.db
      .prepare("SELECT * FROM cash_entries ORDER BY id DESC")
      .all()
      .map((c) => [
        new Date(c.created_at).toLocaleString("pt-BR"),
        c.description,
        c.flow,
        (c.amount_cents / 100).toFixed(2).replace(".", ","),
        c.method,
        c.order_id,
      ]);
  const result = await dialog.showSaveDialog(window, {
    title: "Exportar para planilha",
    defaultPath: `GasGestao-${kind}-${localDate()}.csv`,
    filters: [{ name: "Planilha CSV", extensions: ["csv"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const d = definitions[kind];
  const output = [d.headers, ...d.rows]
    .map((row) => row.map(csvCell).join(";"))
    .join("\r\n");
  writeFileSync(result.filePath, `\ufeff${output}`, "utf8");
  return result.filePath;
}
async function printOrder(orderId) {
  const receipt = new BrowserWindow({
    show: false,
    width: 500,
    height: 750,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  receipt.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await receipt.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(store.getOrder(orderId), store.settings()))}`,
    );
    return await new Promise((resolve, reject) =>
      receipt.webContents.print(
        { silent: false, printBackground: true },
        (success, reason) => {
          if (success || /cancel/i.test(reason)) resolve(success);
          else
            reject(
              new Error("Não foi possível imprimir. Verifique a impressora."),
            );
        },
      ),
    );
  } finally {
    receipt.destroy();
  }
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      return { ok: false, error: "Origem da solicitação inválida." };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      if (!(error instanceof ValidationError))
        console.error(`[${channel}]`, error.message);
      return {
        ok: false,
        error:
          error instanceof ValidationError
            ? error.message
            : "Não foi possível concluir. Verifique os dados e tente novamente.",
      };
    }
  });
}
async function start() {
  const dataPath = app.getPath("userData");
  const databasePath = join(dataPath, "gasgestao.sqlite");
  const hadDatabase = existsSync(databasePath);
  store = new Store(databasePath);
  engagement = new Engagement(store);
  fiscal = new FiscalDiagnostics(join(dataPath, "fiscal-status.json"));
  if (hadDatabase) {
    const auto = join(dataPath, "backups", `automatico-${localDate()}.sqlite`);
    if (!existsSync(auto)) {
      try {
        store.backupTo(auto);
      } catch (error) {
        console.error("Backup automático indisponível:", error.message);
      }
    }
  }
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 720,
    backgroundColor: "#e9e9e9",
    title: "GasGestão",
    icon: join(here, "../assets/icon.png"),
    show: false,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      offscreen: process.env.GASGESTAO_TEST === "1",
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  handle("app:bootstrap", () => {
    const state = store.getState();
    return {
      ...state,
      reminders: engagement.reminders(),
      containers: engagement.containerState(),
      meta: { ...state.meta, version: app.getVersion(), databasePath },
    };
  });
  handle("fiscal:summary", () => fiscal.summary());
  const fiscalMock =
    process.env.GASGESTAO_TEST === "1" &&
    process.env.GASGESTAO_FISCAL_LIVE_TEST !== "1";
  handle("fiscal:certificates", () =>
    fiscalMock
      ? [
          {
            thumbprint: "A".repeat(40),
            label: "Empresa fictícia — certificado de teste",
            cnpjSuffix: "0000",
            hasCompanyId: true,
            validFrom: "2026-01-01",
            validUntil: "2027-12-31",
            hasPrivateKey: true,
            validNow: true,
            store: "CurrentUser/My",
          },
        ]
      : fiscal.list(),
  );
  handle("fiscal:status", (input) => {
    if (fiscalMock) {
      const safe = validateStatusInput(input);
      return {
        ok: true,
        model: safe.model,
        environment: "homologacao",
        tpAmb: 2,
        state: "SP",
        cUF: 35,
        endpoint: STATUS_ENDPOINTS[safe.model],
        cStat: "107",
        reason: "Resposta simulada para testes de interface",
        checkedAt: new Date().toISOString(),
        validUntil: "2027-12-31",
        privateKeyExported: false,
        chainValidated: true,
        operation: "STATUS",
        live: false,
      };
    }
    return fiscal.check(input);
  });
  handle("order:repeat-draft", (input) => engagement.repeatDraft(input));
  handle("container:move", (input) => engagement.containerMove(input));
  handle("reminder:action", (input) => engagement.reminderAction(input));
  handle("reminder:preference", (input) =>
    engagement.setReminderPreference(input),
  );
  handle("reminder:copy", (input) => {
    const message = engagement.copyMessage(input);
    if (process.env.GASGESTAO_TEST === "1")
      return { copied: false, test: true };
    clipboard.writeText(message);
    return { copied: true };
  });
  handle("reminder:whatsapp", async (input) => {
    const { url } = engagement.prepareWhatsApp(input);
    if (process.env.GASGESTAO_TEST === "1")
      return { url, opened: false, test: true };
    await shell.openExternal(url);
    engagement.recordWhatsAppOpened(input);
    return { url, opened: true };
  });
  handle("postal:lookup", (cep) =>
    lookupPostal(
      process.env.GASGESTAO_CEP_DB ||
        join(
          process.env.LOCALAPPDATA || dataPath,
          "GasGestao-Referencias",
          "cep.sqlite",
        ),
      cep,
    ),
  );
  handle("customer:save", (input) => store.saveCustomer(input));
  handle("product:save", (input) => store.saveProduct(input));
  handle("driver:save", (input) => store.saveDriver(input));
  handle("order:create", (input) => store.createOrder(input));
  handle("order:status", (input) => store.changeOrderStatus(input));
  handle("order:driver", (input) => store.assignDriver(input));
  handle("order:payment", (input) => store.receivePayment(input));
  handle("stock:adjust", (input) => store.adjustStock(input));
  handle("cash:add", (input) => store.addCashEntry(input));
  handle("settings:save", (input) => store.saveSettings(input));
  handle("report:period", (from, to) => store.report(from, to));
  handle("app:backup", backup);
  handle("app:export", exportData);
  handle("order:print", printOrder);
  handle("app:demo", () => store.seedDemo());
  Menu.setApplicationMenu(null);
  const dev = process.env.GASGESTAO_DEV_URL;
  if (dev) {
    if (dev !== "http://127.0.0.1:5173")
      throw new Error("Endereço de desenvolvimento inválido.");
    await window.loadURL(dev);
  } else await window.loadFile(join(here, "../dist/index.html"));
  if (process.env.GASGESTAO_TEST !== "1") window.show();
}
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  if (store) store.close();
});
