'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, (msg || '') + ` esperado ${b}, obtido ${a}`);

function base() {
  const s = Calc.estadoPadrao();
  Object.assign(s.lances, { embutidoAtivo: false, fixoAtivo: false, fixoUsarEmbutido: false });
  Object.assign(s.plano, { lead: 'Teste', credito: 100000, prazo: 100, mesContemplacao: 12, taxaAdm: 20, fundoReserva: 2, indice: 'pre5' });
  return s;
}

test('padrões do plano', () => {
  const s = Calc.estadoPadrao();
  assert.equal(s.plano.prazo, 240);
  assert.equal(s.plano.credito, 200000);
  assert.equal(s.plano.taxaAdm, 20);
  assert.equal(s.plano.fundoReserva, 2);
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
  assert.equal(p.parcelas.length, 3);
  assert.equal(p.credito.length, 9);
  near(p.rentabilidade[0].pontos[11].y, 20000 - 14640);
});

test('validações de campos obrigatórios', () => {
  const vazio = Calc.estadoPadrao();
  Object.assign(vazio.plano, { credito: null, taxaAdm: null, fundoReserva: null });
  const v = Calc.validar(vazio);
  for (const c of ['plano.lead', 'plano.credito', 'plano.taxaAdm', 'plano.fundoReserva']) {
    assert.ok(v.some((x) => x.campo === c && x.nivel === 'erro'), c);
  }
});

test('lance embutido: sem recursos próprios e saldo devedor abatido pelo lance', () => {
  const s = base();
  s.lances.embutidoAtivo = true;
  const sor = Calc.nucleo(s, 'sorteio');
  const emb = Calc.nucleo(s, 'embutido');
  near(emb.embutido, 25000);
  near(emb.proprios, 0);
  near(emb.credLiquido, 75000);
  near(sor.saldoDevedor, 88 * 1220);
  near(sor.saldoDevedor - emb.saldoDevedor, 25000);
  near(emb.parcelaPosAtual * 88, emb.saldoDevedor, 'parcela × prazo = saldo (sem seguro)');
});

test('total de taxas ao ano = (taxa de administração + fundo de reserva) ÷ anos do plano', () => {
  const s = base();
  s.plano.prazo = 240;
  near(Calc.simular(s).resumo.taxaAno.v, 1.1);
});

test('alavancagem: meses 1 a 12 e depois de 6 em 6 até 48', () => {
  const s = base();
  s.lances.embutidoAtivo = true;
  const a = Calc.simular(s).alavancagem;
  assert.deepEqual(a.map((x) => x.mod), ['sorteio', 'embutido']);
  assert.deepEqual(a[0].linhas.map((l) => l.m), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24, 30, 36, 42, 48]);
  // rentabilidade ao mês: (venda ÷ aporte)^(1/m) − 1
  const l12 = a[0].linhas[11];
  near(l12.rentabilidade, (Math.pow(l12.venda / l12.aporte, 1 / 12) - 1) * 100);
  const l1 = a[1].linhas[0];
  near(l1.credito, 75000);
  near(l1.aporte, 1220);
  near(l1.venda, 15000);
  near(l1.lucro, 15000 - 1220);
});

test('TIR mensal recupera a taxa de um fluxo conhecido', () => {
  // recebe 1000 no mês 1 e paga 12 parcelas de 100 nos meses 2..13
  const f = [0, 1000]; for (let t = 2; t <= 13; t++) f.push(-100);
  const i = Calc.tirMensal(f);
  near(Calc.vpl(f, i), 0);
  assert.ok(i > 0.02 && i < 0.04);
});

test('aquisição: CET com fluxos de parcelas, lance e crédito', () => {
  const s = base();
  s.reajuste = undefined;
  Object.assign(s.lances, { embutidoAtivo: true, fixoAtivo: true, fixoUsarEmbutido: true });
  const a = Calc.aquisicao(s, 'fixo');
  assert.ok(a.ok);
  near(a.credito, 75000);
  near(a.proprios, 25000);
  near(a.desembolso, a.totalParcelas + 25000);
  near(a.custo, a.desembolso - 75000);
  assert.ok(a.cetMes > 0 && a.cetAno > a.cetMes);
  const f = [0]; const n = Calc.nucleo(s, 'fixo');
  n.linhas.forEach((l) => f.push(-l.total)); f[12] += 75000 - 25000;
  near(Calc.vpl(f, a.cetMes / 100), 0);
  const sim = Calc.simular(s);
  assert.deepEqual(sim.aquisicao.map((x) => x.mod), ['sorteio', 'embutido']);
});

test('categoria aplica os valores fixos do plano', () => {
  const p = Calc.estadoPadrao().plano;
  Calc.aplicarCategoria(p, 'veiculo');
  assert.deepEqual([p.credito, p.prazo, p.taxaAdm, p.fundoReserva, p.indice], [80000, 100, 13, 2, 'ipca']);
  Calc.aplicarCategoria(p, 'imovel');
  assert.deepEqual([p.credito, p.prazo, p.taxaAdm, p.fundoReserva, p.indice], [200000, 240, 20, 2, 'incc']);
});

test('FGTS entra nos recursos próprios e o lance total recalcula as parcelas', () => {
  const s = base();
  Object.assign(s.lances, { embutidoAtivo: true, fixoAtivo: true, fixoUsarEmbutido: true });
  const sem = Calc.nucleo(s, 'fixo');
  Object.assign(s.lances, { fgtsAtivo: true, fgtsValor: 10000, fixoUsarFgts: true });
  const n = Calc.nucleo(s, 'fixo');
  near(n.lance.total, 50000);
  near(n.embutido, 25000);
  near(n.proprios, 25000, 'recursos próprios incluem o FGTS');
  near(n.fgts, 10000);
  near(n.lance.dinheiro, 15000);
  near(n.totalAportado, 14640 + 25000, 'FGTS não é contado duas vezes');
  // o lance total (embutido + próprios com FGTS) é o que abate o saldo
  near(n.linhas[12].total, sem.linhas[12].total);
  near(n.saldoDevedor, 88 * 1220 - 50000);
  s.lances.fgtsValor = 90000;
  near(Calc.nucleo(s, 'fixo').fgts, 25000, 'FGTS limitado aos recursos próprios');
});

test('Lance Fidelidade: desabilitado por padrão e 100% embutido a partir da parcela da opção', () => {
  assert.equal(Calc.estadoPadrao().fidelidade.ativo, false);
  const s = base();
  assert.deepEqual(Calc.simular(s).fidelidade, []);
  s.fidelidade.ativo = true;
  const f = Calc.simular(s).fidelidade;
  assert.deepEqual(f.map((x) => [x.parcela, x.pct]), [[6, 30], [12, 27], [18, 25]]);
  const n1 = f[0].nucleo;
  assert.equal(n1.mesC, 6);
  near(n1.embutido, 30000);
  near(n1.proprios, 0);
  near(n1.credLiquido, 70000);
  near(n1.saldoDevedor, 94 * 1220 - 30000);
  const n3 = f[2].nucleo;
  near(n3.embutido, 0.25 * 100000 * 1.05, 'percentual sobre o crédito reajustado no mês 18');
});

test('parcela: fundo comum, taxa adm. e fundo de reserva = (percentual ÷ prazo) × crédito contratado', () => {
  const s = Calc.estadoPadrao();
  s.plano.lead = 'Teste';
  const l = Calc.nucleo(s, 'sorteio').linhas[0];
  near(l.fundoComum, (1 / 240) * 200000); // R$ 833,33
  near(l.taxa, (0.20 / 240) * 200000); // R$ 166,67
  near(l.fundo, (0.02 / 240) * 200000); // R$ 16,67
  near(l.total, 1016.67 - 0.0033);
  near(Calc.simular(s).resumo.parcelaInicial.v, l.total);
});

test('HS: meia parcela divide fundo comum + taxa adm. + fundo de reserva; demais administradoras só o fundo comum', () => {
  const s = base(); // 100.000 / 100 meses / 20% / 2% → integral 1.220
  s.parcela.modalidade = 'r50';
  s.plano.administradora = 'Embracon';
  near(Calc.nucleo(s, 'sorteio').linhas[0].total, 500 + 200 + 20, 'redutor só no fundo comum');
  s.plano.administradora = 'HS';
  const n = Calc.nucleo(s, 'sorteio');
  near(n.linhas[0].total, 1220 / 2, 'HS: (FC + TA + FR) ÷ 2');
  near(n.linhas[11].total, 610);
  near(Calc.parcelaDataBase(s, 50), 610);
  // a diferença (inclusive de taxa e fundo) é recomposta depois da contemplação
  const somaBase = (c) => n.linhas.reduce((a, l) => a + l[c] / l.f, 0);
  near(somaBase('fundoComum'), 100000);
  near(somaBase('taxa'), 20000);
  near(somaBase('fundo'), 2000);
});
