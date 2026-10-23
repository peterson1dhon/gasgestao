import { app, dialog } from "electron";
try {
  await import("./main.mjs");
} catch (error) {
  console.error("Falha na inicialização:", error.stack);
  if (process.env.GASGESTAO_TEST !== "1")
    dialog.showErrorBox("Não foi possível iniciar o GasGestão", error.message);
  app.exit(1);
}
