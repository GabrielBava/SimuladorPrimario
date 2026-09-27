'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, (msg || '') + ` esperado ${b}, obtido ${a}`);

function base() {
  const s = Calc.estadoPadrao();
  Object.assign(s.plano, { lead: 'Teste', credito: 100000, prazo: 100, mesContemplacao: 12, taxaAdm: 20, fundoReserva: 2, indice: 'pre5' });
  return s;
}

test('padrões do plano', () => {
  const s = Calc.estadoPadrao();
  assert.equal(s.plano.prazo, 240);
  assert.equal(s.plano.mesContemplacao, 12);
  assert.equal(s.plano.seguroPct, 0.038);
  assert.equal(s.plano.indice, 'incc');
  assert.equal(s.lances.embutidoPct, 25);
  assert.equal(s.lances.fixoPct, 50);
});

test('parcela integral segue a fórmula informada', () => {
  const s = base();
  near(Calc.parcelaDataBase(s, 0), 1220);
  const n = Calc.nucleo(s, 'sorteio');
  near(n.linhas[0].total, 1220);
});

test('reajuste anual incide a partir do mês 13 sobre crédito e parcela', () => {
  const n = Calc.nucleo(base(), 'sorteio');
  near(n.linhas[11].total, 1220);
  near(n.linhas[12].total, 1281);
  near(n.linhas[24].credAtual, 110250);
});

test('índice estimado sem taxa não é calculado após o mês 12', () => {
  const s = base();
  s.plano.indice = 'ipca';
  const n = Calc.nucleo(s, 'sorteio');
  near(n.linhas[11].total, 1220);
  assert.equal(n.linhas[12].total, null);
  assert.ok(Calc.validar(s).some((v) => v.campo === 'plano.indiceTaxa' && v.nivel === 'erro'));
  s.plano.indiceTaxa = 4;
  near(Calc.nucleo(s, 'sorteio').linhas[12].total, 1220 * 1.04);
});

test('redutor vale até a contemplação e a diferença é diluída depois', () => {
  const s = base();
  s.parcela.modalidade = 'r50';
  const n = Calc.nucleo(s, 'sorteio');
  near(n.linhas[0].total, 720);
  near(n.linhas[11].total, 720);
  const fcBase = n.linhas.reduce((a, l) => a + l.fundoComum / l.f, 0);
  near(fcBase, 100000, 'fundo comum integralizado');
});

test('adesão diluída e seguro prestamista somados à parcela', () => {
  const s = base();
  Object.assign(s.plano, { adesaoAtiva: true, adesaoPct: 1, adesaoMeses: 5, seguroAtivo: true });
  const n = Calc.nucleo(s, 'sorteio');
  near(n.linhas[0].total, 1220 + 200 + 38);
  near(n.linhas[5].total, 1220 + 38);
});

function comLances(s) {
  Object.assign(s.lances, { embutidoAtivo: true, fixoAtivo: true, fixoUsarEmbutido: true });
  return s;
}

test('lance fixo com embutido: composição, venda e resultado', () => {
  const n = Calc.nucleo(comLances(base()), 'fixo');
  near(n.lance.total, 50000);
  near(n.embutido, 25000);
  near(n.proprios, 25000);
  near(n.credLiquido, 75000);
  near(n.totalParcelas, 14640);
  near(n.totalAportado, 39640, 'embutido não entra no aporte');
  near(n.venda, 15000);
  near(n.resultado, 15000 - 39640);
});

test('sorteio: venda de 20% sobre o crédito', () => {
  const n = Calc.nucleo(base(), 'sorteio');
  near(n.venda, 20000);
  near(n.resultado, 20000 - 14640);
});

test('abatimento por parcela reduz proporcionalmente as parcelas restantes', () => {
  const n = Calc.nucleo(comLances(base()), 'fixo');
  const k = 1 - 50000 / (88 * 1220);
  near(n.linhas[12].total, 1281 * k);
  assert.equal(n.prazoRestante, 88);
});

test('abatimento por prazo quita parcelas a partir do fim', () => {
  const s = comLances(base());
  s.plano.abatimento = 'prazo';
  const n = Calc.nucleo(s, 'fixo');
  assert.equal(n.prazoRestante, 48);
  near(n.linhas[12].total, 1281);
  assert.equal(n.linhas[99].encerrado, true);
});

test('usar embutido sem lance embutido ativo não desconta embutido', () => {
  const s = comLances(base());
  s.lances.embutidoAtivo = false;
  const n = Calc.nucleo(s, 'fixo');
  near(n.embutido, 0);
  near(n.proprios, 50000);
});

test('embutido maior que o lance é limitado ao lance', () => {
  const s = base();
  Object.assign(s.lances, { embutidoAtivo: true, livreAtivo: true, livrePct: 10, livreUsarEmbutido: true });
  const n = Calc.nucleo(s, 'livre');
  near(n.embutido, 10000);
  near(n.proprios, 0);
  assert.ok(Calc.simular(s).validacoes.some((v) => /limitado/.test(v.msg)));
});

test('projeções só são calculadas quando selecionadas', () => {
  const s = comLances(base());
  assert.deepEqual(Object.keys(Calc.simular(s).projecoes), []);
  s.projecoes = { parcelas: true, credito: true, rentabilidade: true };
  const p = Calc.simular(s).projecoes;
  assert.equal(p.parcelas.length, 2);
  assert.equal(p.credito.length, 9);
  near(p.rentabilidade[0].pontos[11].y, 20000 - 14640);
});

test('validações de campos obrigatórios', () => {
  const v = Calc.validar(Calc.estadoPadrao());
  for (const c of ['plano.lead', 'plano.credito', 'plano.taxaAdm', 'plano.fundoReserva']) {
    assert.ok(v.some((x) => x.campo === c && x.nivel === 'erro'), c);
  }
});
