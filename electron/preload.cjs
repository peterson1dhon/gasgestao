const { contextBridge, ipcRenderer } = require("electron");
const call =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld(
  "gasgestao",
  Object.freeze({
    fiscalSummary: call("fiscal:summary"),
    fiscalCertificates: call("fiscal:certificates"),
    fiscalStatus: call("fiscal:status"),
    repeatOrderDraft: call("order:repeat-draft"),
    addContainerMove: call("container:move"),
    reminderAction: call("reminder:action"),
    reminderPreference: call("reminder:preference"),
    copyReminder: call("reminder:copy"),
    openReminderWhatsApp: call("reminder:whatsapp"),
    lookupPostal: call("postal:lookup"),
    bootstrap: call("app:bootstrap"),
    saveCustomer: call("customer:save"),
    saveProduct: call("product:save"),
    saveDriver: call("driver:save"),
    createOrder: call("order:create"),
    changeOrderStatus: call("order:status"),
    assignDriver: call("order:driver"),
    receivePayment: call("order:payment"),
    adjustStock: call("stock:adjust"),
    addCashEntry: call("cash:add"),
    saveSettings: call("settings:save"),
    report: call("report:period"),
    backup: call("app:backup"),
    exportData: call("app:export"),
    printOrder: call("order:print"),
    seedDemo: call("app:demo"),
  }),
);
