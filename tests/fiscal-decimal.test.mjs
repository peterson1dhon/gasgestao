import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDecimal,formatDecimal,lineTotalCents,percentCents,adRemCents,allocateCents,allocateOrderAdjustments} from '../electron/fiscal/decimal.mjs';

test('decimal textual preserva escala e rejeita ponto flutuante',()=>{
 assert.equal(parseDecimal('13.0000',4),130000n);
 assert.equal(formatDecimal(130000n,4),'13.0000');
 assert.throws(()=>parseDecimal(13.1,4),/textual/);
 assert.throws(()=>parseDecimal('1.00001',4),/casas/);
 assert.throws(()=>parseDecimal('1e3',4),/textual/);
});

test('quantidade comercial e preço unitário de dez casas fecham os centavos',()=>{
 assert.equal(lineTotalCents('1.0000','100.0000000000'),10000);
 assert.equal(lineTotalCents('0.5000','0.0100000000'),1);
 assert.equal(lineTotalCents('20.0000','5.0000000000'),10000);
 assert.throws(()=>lineTotalCents('0.0000','1.0000000000'),/positiva/);
});

test('percentuais e ad rem sintéticos usam resultados independentes',()=>{
 assert.equal(percentCents(8200,'0.1000'),8);
 assert.equal(percentCents(8200,'0.9000'),74);
 assert.equal(percentCents(10000,'18.0000'),1800);
 assert.equal(adRemCents('13.0000','1.4700'),1911);
 assert.equal(adRemCents('0.5100','1.0000'),51);
});

test('rateio dos maiores restos é estável, exato e respeita itens sem base',()=>{
 const entries=[{id:'b',weightCents:100},{id:'a',weightCents:100},{id:'c',weightCents:100},{id:'zero',weightCents:0}];
 assert.deepEqual(allocateCents(1,entries),[{id:'b',cents:0},{id:'a',cents:1},{id:'c',cents:0},{id:'zero',cents:0}]);
 assert.deepEqual(allocateCents(1,[...entries].reverse()).sort((a,b)=>a.id.localeCompare(b.id)),allocateCents(1,entries).sort((a,b)=>a.id.localeCompare(b.id)));
 assert.equal(allocateCents(299,entries).reduce((s,x)=>s+x.cents,0),299);
 assert.throws(()=>allocateCents(1,[{id:'a',weightCents:0}]),/base positiva/);
 assert.throws(()=>allocateCents(1,[entries[0],entries[0]]),/repetidos/);
});

test('desconto e frete conciliam pedido sem alterar a base tributária implicitamente',()=>{
 const out=allocateOrderAdjustments([{id:'a',grossCents:100},{id:'b',grossCents:100},{id:'c',grossCents:100}],1,2);
 assert.deepEqual(out.map(x=>x.discountCents),[1,0,0]);
 assert.equal(out.reduce((s,x)=>s+x.freightCents,0),2);
 assert.equal(out.reduce((s,x)=>s+x.adjustedCents,0),301);
 assert.throws(()=>allocateOrderAdjustments([{id:'a',grossCents:100}],101,0),/Desconto maior/);
});
