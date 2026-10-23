export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value / 100,
  );
export function receiptHtml(order, settings) {
  const e = escapeHtml;
  const columns =
    Number.isSafeInteger(settings.receipt_left_columns) &&
    settings.receipt_left_columns >= 0 &&
    settings.receipt_left_columns <= 40
      ? settings.receipt_left_columns
      : 0;
  const pending =
    order.status !== "cancelado" && order.total_cents > order.paid_cents;
  const signature =
    order.payment_method === "fiado" && pending
      ? '<hr><p><b>VENDA A PRAZO</b></p><p>Assinatura do cliente:</p><p style="margin-top:32px;border-top:1px solid #555;padding-top:5px">' +
        e(order.customer_name) +
        "</p>"
      : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Pedido ${order.id}</title><style>body{font:13px Arial;color:#172c27;max-width:340px;margin:24px auto;padding:16px}h1{font-size:22px;margin:0 0 6px}p{margin:5px 0}hr{border:0;border-top:1px dashed #aaa;margin:16px 0}table{width:100%;border-collapse:collapse}td{padding:7px 0;vertical-align:top}td:last-child{text-align:right}.total{font-size:19px;font-weight:700}.muted{font-size:11px;color:#666}.notes{white-space:pre-wrap}@media print{body{margin:0;padding:16px;max-width:340px;${columns ? `margin-left:${columns}ch;font-family:monospace` : ""}}}</style></head><body><h1>${e(settings.name)}</h1><p>${e(settings.address)} ${e(settings.city)}</p><p>${e(settings.phone)}</p><hr><h2>Pedido #${order.id}</h2><p>${e(new Date(order.created_at).toLocaleString("pt-BR"))}</p><p><b>Cliente:</b> ${e(order.customer_name)}</p>${order.customer_cnpj ? `<p><b>CNPJ:</b> ${e(order.customer_cnpj)}</p>` : ""}<p><b>Telefone:</b> ${e(order.customer_phone)}</p><p><b>${order.delivery_type === "retirada" ? "Retirada" : "Entrega"}:</b> ${e(order.delivery_address)}</p><p><b>Entregador:</b> ${e(order.driver_name || "Não atribuído")}</p><hr><table>${order.items.map((i) => `<tr><td>${i.quantity} × ${e(i.name)}<br><span class="muted">${money(i.unit_price_cents)} / un.</span></td><td>${money(i.total_cents)}</td></tr>`).join("")}</table><hr><p>Produtos: ${money(order.subtotal_cents)}</p><p>Entrega: ${money(order.delivery_fee_cents)}</p><p>Desconto: ${money(order.discount_cents)}</p><p class="total">Total: ${money(order.total_cents)}</p><p>Recebido: ${money(order.paid_cents)}</p><p>A receber: ${money(order.status === "cancelado" ? 0 : order.total_cents - order.paid_cents)}</p><p>Pagamento: ${e(order.payment_method)}</p><p>Situação: ${e(order.status)}</p>${order.notes ? `<hr><p class="notes">${e(order.notes)}</p>` : ""}${signature}<hr><p class="muted">Comprovante de pedido • sem valor fiscal</p><p class="muted">Emitido pelo GasGestão</p></body></html>`;
}
