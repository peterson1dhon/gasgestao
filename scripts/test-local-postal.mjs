// Verificação opcional da base local autorizada, sem gravar clientes.
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const artifacts=join(root,'.test-artifacts');await mkdir(artifacts,{recursive:true});
const dataDir=await mkdtemp(join(artifacts,'local-postal-'));
const packaged=process.argv.includes('--packaged');
const env={...process.env,GASGESTAO_DATA_DIR:dataDir,GASGESTAO_TEST:'1'};
// Sem GASGESTAO_CEP_DB: valida o caminho de produção neste computador.
delete env.GASGESTAO_CEP_DB;delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:packaged?join(root,'release','win-unpacked','GasGestao.exe'):electronPath,args:packaged?[]:[root],env});
try {
 const page=await app.firstWindow();await page.getByTestId('classic-shell').waitFor();
 await page.context().setOffline(true);
 await page.getByRole('navigation',{name:'Menu principal'}).getByRole('button',{name:'Clientes',exact:true}).click();
 await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('CEP',{exact:true}).fill('18270-001');
 await page.waitForFunction(()=>document.querySelector('input[name="address"]')?.value==='Rua Onze de Agosto');
 assert.equal(await dialog.getByLabel('Cidade',{exact:true}).inputValue(),'Tatuí');
 assert.equal(await dialog.getByLabel('UF',{exact:true}).inputValue(),'SP');
 await mkdir(join(artifacts,'screenshots'),{recursive:true});
 await page.screenshot({path:join(artifacts,'screenshots','consulta-cep.png'),fullPage:true});
 const result={ok:true,packaged,networkOffline:true,cep:'18270001',street:await dialog.getByLabel('Endereço',{exact:true}).inputValue(),neighborhood:await dialog.getByLabel('Bairro',{exact:true}).inputValue(),city:'Tatuí',uf:'SP',savedCustomers:0,finished:new Date().toISOString()};
 const state=await page.evaluate(()=>window.gasgestao.bootstrap());assert.equal(state.data.customers.length,0);
 await writeFile(join(artifacts,'local-postal-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await app.close();}
