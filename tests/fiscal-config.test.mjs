import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIssuerConfig,saveIssuerConfig,enableProduction} from '../electron/fiscal/config.mjs';
import {runPreflight} from '../electron/fiscal/preflight.mjs';
import {validateCustomerFiscal,validatePaymentPlan} from '../electron/fiscal/preflight.mjs';
import {getCapabilities,resolveEndpoint,validateEmissionDate,validateProtocolFormat} from '../electron/fiscal/policies.mjs';
import {Store} from '../electron/store.mjs';
const issuer={id:'synthetic',productionEnabled:false,configuration:{cnpj:'11222333000181',ie:'123456789',crt:3,razao:'Empresa Sintetica',logradouro:'Rua Teste',numero:'1',bairro:'Centro',municipio:'Tatui',municipioIBGE:'3554003',uf:'SP',cep:'18270000',telefone:'15999999999',thumbprint:'A'.repeat(40)}};
test('configuração fiscal carrega, valida e grava sem liberar produção',()=>{
 assert.equal(validateIssuerConfig(issuer.configuration).valid,true);
 let saved;saveIssuerConfig({saveIssuer(x){saved=x;return x;}},issuer.configuration);
 assert.match(saved.id,/^[0-9a-f-]{36}$/);assert.equal(saved.productionEnabled,0);
 assert.doesNotThrow(()=>validateIssuerConfig({...issuer.configuration,cnpj:123}));
 assert.equal(validateIssuerConfig({...issuer.configuration,crt:1}).valid,false);
});
test('produção não é liberada por uma confirmação sem critérios implementados',()=>{
 let touched=false;assert.throws(()=>enableProduction({getIssuer(){touched=true;}},'id',{confirmed:true}),/indisponível/);assert.equal(touched,false);
});
test('preflight 55 não é bloqueado por credenciamento 65 pendente e nunca reserva número',()=>{
 let reservations=0;
 const store={fiscal:{listIssuers:()=>[issuer],getDocumentByOrder:()=>null,getCustomerDetails:()=>({payload:{docType:'cpf',doc:'12345678909',nome:'Teste',logradouro:'Rua Teste',numero:'1',bairro:'Centro',municipio:'Tatui',municipioIBGE:'3554003',uf:'SP',cep:'18270000'}}),getActiveProfile:()=>null,reserveDocument(){reservations++;}},getOrder:()=>({customer_id:1,total_cents:100,status:'novo',items:[]})};
 const result=runPreflight({store,orderId:1,model:55,environment:'homologacao',paymentPlan:[{method:'01',amountCents:100}],emissionDate:'2026-10-24T12:00:00-03:00'});
 assert.equal(result.issues.some(x=>x.code==='C08_CAPABILITY_BLOCKED'&&x.severity==='error'),false);assert.equal(reservations,0);
 const prod=runPreflight({store,orderId:1,model:55,environment:'producao'});assert.equal(prod.ok,false);assert.ok(prod.issues.some(x=>x.code==='PROD_BLOCKED'));
});

test('CPF, CNPJ alfanumérico e endereço fiscal são verificados antes da nota',()=>{
 const address={docType:'cpf',doc:'12345678909',nome:'Cliente Teste',logradouro:'Rua Teste',numero:'1',bairro:'Centro',municipio:'Tatui',municipioIBGE:'3554003',uf:'SP',cep:'18270000'};
 assert.deepEqual(validateCustomerFiscal(address,55),[]);
 assert.ok(validateCustomerFiscal({...address,doc:'12345678900'},55).some(x=>x.code==='C03_CUSTOMER_CPF_INVALID'));
 assert.ok(validateCustomerFiscal({...address,numero:''},55).some(x=>x.code==='C05_CUSTOMER_ADDRESS_INCOMPLETE'));
 assert.deepEqual(validateCustomerFiscal({...address,docType:'cnpj',doc:'12ABC34501DE35',indIEDest:9},55),[]);
 assert.ok(validateCustomerFiscal({...address,docType:'cnpj',doc:'12ABC34501DE36',indIEDest:9},55).some(x=>x.code==='C04_CUSTOMER_CNPJ_INVALID'));
 assert.ok(validateCustomerFiscal('texto livre',65).some(x=>x.code==='C01_CUSTOMER_FISCAL_INVALID'));
});

test('pagamento positivo exige código, subtipo Pix e valor coerentes',()=>{
 assert.deepEqual(validatePaymentPlan([{method:'17',pixType:'dinamico',amountCents:100}],100),[]);
 assert.ok(validatePaymentPlan([{method:'17',pixType:'estatico',amountCents:100}],100).some(x=>x.code==='T13_PIX_TYPE_MISSING'));
 assert.ok(validatePaymentPlan([{method:'90',amountCents:0}],100).some(x=>x.code==='T13_PAYMENT_90_SALE'));
 assert.ok(validatePaymentPlan([{method:'01',amountCents:99}],100).some(x=>x.code==='T13_PAYMENT_SUM_MISMATCH'));
 assert.ok(validatePaymentPlan([null],100).some(x=>x.code==='T13_PAYMENT_ENTRY_INVALID'));
});

test('produção e exercício sem política continuam bloqueados',()=>{
 assert.equal(getCapabilities({...issuer,configuration:{...issuer.configuration,cnpj:'00000000000000'}}).can55,false);
 assert.equal(getCapabilities({...issuer,configuration:{...issuer.configuration,nfceCredentialed:true}}).can65,false);
 assert.throws(()=>resolveEndpoint({operation:'authorize',model:55,environment:'producao',issuer:{...issuer,productionEnabled:true}}),/não foi liberado/);
 assert.equal(validateEmissionDate('2026-02-31T12:00:00-03:00').valid,false);
 assert.equal(validateEmissionDate('2027-01-01T12:00:00-03:00').valid,false);
 assert.equal(validateProtocolFormat('1'.repeat(15)),true);
 assert.equal(validateProtocolFormat('1'.repeat(16)),false);
 assert.equal(validateProtocolFormat('1'.repeat(17)),true);
});

test('preflight lê o banco real em memória e não aceita perfil selecionado diferente',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const customer=store.saveCustomer({name:'Cliente sintético',phone:'11900000001',address:'Rua Teste, 1'});
 const product=store.saveProduct({name:'Água teste',price_cents:100,cost_cents:50,stock:10,min_stock:0});
 const order=store.createOrder({customer_id:customer,delivery_type:'retirada',payment_method:'dinheiro',items:[{product_id:product,quantity:1}]});
 saveIssuerConfig(store.fiscal,issuer.configuration);
 store.fiscal.saveCustomerDetails({customerId:customer,payload:{docType:'cpf',doc:'12345678909',nome:'Cliente Teste',logradouro:'Rua Teste',numero:'1',bairro:'Centro',municipio:'Tatui',municipioIBGE:'3554003',uf:'SP',cep:'18270000'}});
 const profile=store.fiscal.saveProfileDraft({productId:product,version:1,validFrom:'2026-01-01',payload:{ncm:'22011000',cfop:'5102',cstIcms:'00'}});
 store.fiscal.approveProfile({id:profile.id,approvedBy:'revisor sintético'});
 const base={store,orderId:order,model:55,environment:'homologacao',paymentPlan:[{method:'01',amountCents:100}],emissionDate:'2026-10-24T12:00:00-03:00'};
 const result=runPreflight(base);
 assert.equal(result.ok,false);
 assert.deepEqual(result.issues.filter(x=>x.severity==='error').map(x=>x.code),['F03_ENGINE_NOT_IMPLEMENTED']);
 assert.ok(runPreflight({...base,profileVersionIds:['perfil-antigo']}).issues.some(x=>x.code==='T09_PROFILE_SELECTION_STALE'));
 assert.equal(store.fiscal.listDocumentsForOrder(order).length,0);
 assert.equal(store.fiscal.getSequence({issuerId:store.fiscal.listIssuers()[0].id,environment:'homologacao',model:55,series:1}) == null,true);
});

test('identidade do emitente e vigência de perfis aprovados não podem colidir',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const first=saveIssuerConfig(store.fiscal,issuer.configuration);
 assert.throws(()=>store.fiscal.saveIssuer({id:first.id,identity:'00000000000000',configuration:{}}),/imutável/);
 assert.equal(store.fiscal.getIssuer(first.id).identity,issuer.configuration.cnpj);
 const product=store.saveProduct({name:'Produto sintético',price_cents:100,cost_cents:50,stock:1,min_stock:0});
 const one=store.fiscal.saveProfileDraft({productId:product,version:1,validFrom:'2026-01-01',payload:{ncm:'22011000'}});
 const two=store.fiscal.saveProfileDraft({productId:product,version:2,validFrom:'2026-10-01',payload:{ncm:'22011000'}});
 store.fiscal.approveProfile({id:one.id,approvedBy:'revisor sintético'});
 assert.throws(()=>store.fiscal.approveProfile({id:two.id,approvedBy:'revisor sintético'}),/sobreposta/);
 assert.equal(store.fiscal.getProfile(two.id).approvalState,'draft');
 store.fiscal.retireProfile({id:one.id,validUntil:'2026-09-30'});
 assert.equal(store.fiscal.approveProfile({id:two.id,approvedBy:'revisor sintético'}).approvalState,'approved');
});
