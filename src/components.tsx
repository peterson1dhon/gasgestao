import {
  useEffect,
  useLayoutEffect,
  useRef,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type InputHTMLAttributes,
} from "react";
import {
  X,
  PackageOpen,
  Search,
  ArrowUpRight,
  Monitor,
  Save,
  type LucideIcon,
} from "lucide-react";
import { currency, statusLabels, type Status } from "./api";
export function Field({
  label,
  children,
  wide = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  children?: ReactNode;
  wide?: boolean;
}) {
  const generated = useId();
  const fieldId = props.id || generated;
  const child = isValidElement<{ id?: string; "aria-label"?: string }>(children)
    ? cloneElement(children, {
        id: children.props.id || fieldId,
        "aria-label": children.props["aria-label"] || label,
      })
    : children;
  return (
    <label className={`field ${wide ? "wide" : ""}`} htmlFor={fieldId}>
      <span>
        {label}
        {props.required && <em> *</em>}
      </span>
      {child || <input {...props} id={fieldId} aria-label={label} />}
    </label>
  );
}
export function Dialog({
  title,
  description,
  children,
  onClose,
  wide = false,
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    const editable = ref.current?.querySelector(
      "input:not([readonly]),select,textarea",
    ) as HTMLElement | null;
    (editable || ref.current?.querySelector("button"))?.focus();
    return () => old?.focus();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if (!busy && (e.key === "F2" || (e.ctrlKey && e.key === "Enter"))) {
        const form = ref.current?.querySelector("form");
        if (form) {
          e.preventDefault();
          form.requestSubmit();
        }
      }
      if (e.key === "Tab") {
        const nodes = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
          ),
        ].filter((n) => n.offsetParent !== null);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
    };
  }, [onClose, busy]);
  return (
    <div className="modal-overlay">
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="classic-dialog-caption">
          <span className="classic-window-orb" />
          <strong>{title}</strong>
          <button
            type="button"
            className="classic-dialog-close"
            aria-label="Fechar janela"
            onClick={onClose}
            disabled={busy}
          >
            <X size={14} />
          </button>
        </div>
        <header className="modal-header">
          <Monitor size={27} />
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
  icon: Icon = PackageOpen,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Buscar…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          className="icon-button tiny"
          aria-label="Limpar busca"
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status}`}>
      <i />
      {statusLabels[status]}
    </span>
  );
}
export function Metric({
  label,
  value,
  description,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
  accent?: boolean;
}) {
  return (
    <article className={`metric ${accent ? "metric-accent" : ""}`}>
      <div className="metric-top">
        <span>{label}</span>
        <div className="metric-icon">
          <Icon size={19} />
        </div>
      </div>
      <strong>{value}</strong>
      <p>{description}</p>
    </article>
  );
}
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="section-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Value({ value }: { value: number }) {
  return <span className="money">{currency(value)}</span>;
}
export function ViewLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function FormFooter({
  onClose,
  busy,
  label = "Salvar",
}: {
  onClose: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <footer className="modal-footer">
      <span className="form-required">* Campos obrigatórios</span>
      <div>
        <button
          type="button"
          className="button secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancelar
        </button>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Salvando…" : label}
        </button>
      </div>
    </footer>
  );
}
