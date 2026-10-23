import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEventHandler,
} from "react";
import {
  UsersRound,
  Truck,
  Package,
  Boxes,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  ShoppingBag,
  Monitor,
  DatabaseBackup,
  Plus,
  X,
  Minus,
  Square,
  ChevronDown,
  Flame,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

export type Page =
  | "dashboard"
  | "orders"
  | "customers"
  | "products"
  | "drivers"
  | "stock"
  | "cash"
  | "reports"
  | "settings";
export const pageTitles: Record<Page, string> = {
  dashboard: "Área de Trabalho",
  orders: "Pedidos Realizados",
  customers: "Cadastro de Clientes",
  products: "Cadastro de Produtos",
  drivers: "Cadastro de Funcionários / Entregadores",
  stock: "Movimento de Estoque / Produtos",
  cash: "Fluxo de Caixa",
  reports: "Relatório de Vendas",
  settings: "Configurar Sistema",
};
const shortcuts: {
  page: Page;
  label: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { page: "customers", label: "Clientes", icon: UsersRound, color: "#b77811" },
  { page: "drivers", label: "Entregadores", icon: Truck, color: "#386482" },
  { page: "products", label: "Produtos", icon: Package, color: "#627e91" },
  { page: "stock", label: "Estoque", icon: Boxes, color: "#946326" },
  { page: "cash", label: "Caixa", icon: Wallet, color: "#a27210" },
  { page: "orders", label: "Pedidos", icon: ShoppingBag, color: "#297b9c" },
  {
    page: "reports",
    label: "Relatórios",
    icon: ChartNoAxesCombined,
    color: "#4c853e",
  },
  {
    page: "dashboard",
    label: "Visão geral",
    icon: LayoutDashboard,
    color: "#526d8a",
  },
];
export function ClassicTool({
  label,
  shortcut,
  icon: Icon,
  onClick,
  disabled = false,
  title,
  ariaLabel,
  color = "#357baf",
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      className="classic-tool"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={ariaLabel || label}
    >
      <Icon size={23} style={{ color }} aria-hidden="true" />
      <span>
        {label}
        {shortcut && <kbd aria-hidden="true"> ({shortcut})</kbd>}
      </span>
    </button>
  );
}
export function ClassicShell({
  page,
  go,
  newOrder,
  backup,
  company,
  version,
  children,
  openReminders,
  openContainers,
  openFiscal,
  reminderCount,
}: {
  page: Page;
  go: (p: Page) => void;
  newOrder: () => void;
  backup: () => void;
  company: string;
  version: string;
  children: ReactNode;
  openReminders: () => void;
  openContainers: () => void;
  openFiscal: () => void;
  reminderCount: number;
}) {
  const [menu, setMenu] = useState<string | null>(null),
    [opened, setOpened] = useState<Page[]>([page]),
    [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpened((old) => (old.includes(page) ? old : [...old, page]));
    setMinimized(false);
  }, [page]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (
        document.querySelector('[role="dialog"]') ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      )
        return;
      if (e.key === "F9") {
        e.preventDefault();
        go("orders");
      }
      if (e.key === "F8") {
        e.preventDefault();
        newOrder();
      }
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [go, newOrder]);
  const select = (target: Page) => {
    setMenu(null);
    go(target);
  };
  const groups: {
    label: string;
    items: {
      label: string;
      target?: Page;
      action?: () => void;
      key?: string;
    }[];
  }[] = [
    {
      label: "Cadastros",
      items: [
        { label: "Clientes", target: "customers" },
        { label: "Funcionários / Entregadores", target: "drivers" },
        { label: "Produtos", target: "products" },
      ],
    },
    {
      label: "Movimentos",
      items: [
        { label: "Lançamento de Pedidos", action: newOrder, key: "F8" },
        { label: "Pedidos Realizados", target: "orders", key: "F9" },
        { label: "Movimento de Estoque / Produtos", target: "stock" },
        { label: "Vasilhames emprestados", action: openContainers },
      ],
    },
    {
      label: "Financeiro",
      items: [{ label: "Fluxo de Caixa", target: "cash" }],
    },
    {
      label: "Relatórios",
      items: [
        { label: "Relatório de Vendas", target: "reports" },
        { label: "Estoque Total", target: "stock" },
      ],
    },
    {
      label: "Utilitários",
      items: [
        {
          label: `Lembretes de recompra (${reminderCount})`,
          action: openReminders,
        },
        { label: "Configurar Sistema", target: "settings" },
        { label: "Diagnóstico fiscal SP", action: openFiscal },
        { label: "Realizar Backup", action: backup },
      ],
    },
    {
      label: "Ajuda",
      items: [
        { label: "Sobre o GasGestão", target: "settings" },
        { label: "Área de Trabalho", target: "dashboard" },
      ],
    },
  ];
  return (
    <div className="classic-shell" data-testid="classic-shell">
      <div
        className="classic-menubar"
        ref={menuRef}
        role="menubar"
        aria-label="Menus do sistema"
      >
        {groups.map((g) => (
          <div className="classic-menu-group" key={g.label}>
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={menu === g.label}
              className={menu === g.label ? "is-open" : ""}
              onClick={() => setMenu(menu === g.label ? null : g.label)}
              onMouseEnter={() => {
                if (menu) setMenu(g.label);
              }}
            >
              {g.label}
            </button>
            {menu === g.label && (
              <div
                className="classic-dropdown"
                role="menu"
                aria-label={g.label}
              >
                {g.items.map((item) => (
                  <button
                    key={item.label}
                    role="menuitem"
                    onClick={() => {
                      if (item.target) select(item.target);
                      else {
                        setMenu(null);
                        item.action?.();
                      }
                    }}
                  >
                    <span>{item.label}</span>
                    {item.key && <kbd>{item.key}</kbd>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <span className="classic-program-name">GasGestão {version}</span>
      </div>
      <nav className="classic-main-toolbar" aria-label="Menu principal">
        {shortcuts.map((s) => (
          <button
            key={s.page}
            className={`classic-shortcut ${page === s.page ? "active" : ""}`}
            aria-label={s.label}
            aria-current={page === s.page ? "page" : undefined}
            onClick={() => select(s.page)}
          >
            <s.icon size={25} style={{ color: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
          </button>
        ))}
        <div className="classic-toolbar-separator" />
        <button
          className="classic-shortcut"
          aria-label="Lançar pedido"
          onClick={newOrder}
        >
          <Plus size={25} style={{ color: "#38884b" }} aria-hidden="true" />
          <span>
            Lançar Pedido <kbd>F8</kbd>
          </span>
        </button>
        <button
          className={`classic-shortcut ${page === "settings" ? "active" : ""}`}
          aria-label="Configurações"
          onClick={() => select("settings")}
        >
          <Settings size={25} style={{ color: "#708293" }} aria-hidden="true" />
          <span>Configurações</span>
        </button>
        <button
          className="classic-shortcut"
          aria-label="Salvar backup"
          onClick={backup}
        >
          <DatabaseBackup
            size={25}
            style={{ color: "#687cac" }}
            aria-hidden="true"
          />
          <span>Backup</span>
        </button>
      </nav>
      <div
        className={`classic-desktop page-${page} ${maximized ? "window-maximized" : ""}`}
      >
        <div className="classic-desktop-watermark" aria-hidden="true">
          <Flame size={62} />
          <span>GASGESTÃO</span>
          <small>DESKTOP · GESTÃO DE REVENDAS E ENTREGAS</small>
        </div>
        {!minimized && (
          <section
            className={`classic-page-window module-${page}`}
            aria-label={pageTitles[page]}
          >
            <div className="classic-titlebar">
              <span className="classic-window-orb" />
              <strong>{pageTitles[page]}</strong>
              <div className="classic-window-controls">
                <button
                  aria-label="Minimizar janela interna"
                  title="Minimizar"
                  onClick={() => setMinimized(true)}
                >
                  <Minus size={12} />
                </button>
                <button
                  aria-label="Maximizar ou restaurar janela interna"
                  title="Maximizar / restaurar"
                  onClick={() => setMaximized(!maximized)}
                >
                  <Square size={10} />
                </button>
                <button
                  aria-label="Fechar módulo"
                  title="Fechar"
                  onClick={() => select("dashboard")}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="classic-window-content">{children}</div>
          </section>
        )}
      </div>
      <div className="classic-taskbar" aria-label="Janelas abertas">
        {opened.map((p) => (
          <button
            key={p}
            className={page === p && !minimized ? "active" : ""}
            onClick={() => {
              go(p);
              setMinimized(false);
            }}
          >
            <Monitor size={12} />
            {pageTitles[p]}
          </button>
        ))}
      </div>
      <footer className="classic-statusbar">
        <span>
          <i className="classic-status-led" /> {company}
        </span>
        <span>Banco local · offline</span>
        <span>{new Date().toLocaleDateString("pt-BR")}</span>
        <span>GasGestão v{version}</span>
      </footer>
    </div>
  );
}
