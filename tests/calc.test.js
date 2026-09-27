'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, (msg || '') + ` esperado ${b}, obtido ${a}`);

function base() {
  const s = Calc.estadoPadrao();
  Object.assign(s.plano, { lead: 'Teste', credito: 100000, prazo: 100, taxaAdm: 20, frTipo: 'pct', frValor: 2, mesInicial: '2026-10' });
  s.reajuste.credito.indice = 'sem';
  s.reajuste.parcela.indice = 'sem';
  return s;
}

test('parcela integral segue a fórmula informada', () => {
  const s = base();
  near(Calc.parcelaFormula(s, 0), 1220);
  const r = Calc.simular(s);
  near(r.resumo.parcelaIntegral.v, 1220);
  near(r.resumo.parcelaInicial.v, 1220);
  near(r.resumo.totalPago.v, 122000, 'total no prazo');
});

test('parcela com redutor de 50% reduz apenas o fundo comum', () => {
  const s = base();
  s.parcela.modalidade = 'r50';
  near(Calc.parcelaFormula(s, 50), 500 + 200 + 20);
});

test('redutor sem regra de recomposição deixa meses posteriores pendentes', () => {
  const s = base();
  Object.assign(s.parcela, { modalidade: 'r50', redIni: 1, redFim: 12 });
  const r = Calc.simular(s);
  near(r.cronograma.linhas[11].parcela, 720);
  assert.equal(r.cronograma.linhas[12].parcela, null);
  assert.equal(r.resumo.totalPago.v, null);
  assert.ok(r.resumo.totalPago.pend.some((p) => /recomposto/.test(p)));
});

test('recomposição por diluição integraliza 100% do fundo comum', () => {
  const s = base();
  Object.assign(s.parcela, { modalidade: 'r50', redIni: 1, redFim: 12, recomposicao: 'diluir' });
  const cr = Calc.cronograma(s, null);
  const fc = cr.linhas.reduce((a, l) => a + l.fundoComum, 0);
  near(fc, 100000, 'fundo comum total');
});

test('reajuste pré-fixado 5% ao ano recalcula parcela a partir do mês 13', () => {
  const s = base();
  s.reajuste.credito.indice = 'pre5';
  s.reajuste.parcela.indice = 'pre5';
  const cr = Calc.cronograma(s, null);
  near(cr.linhas[11].parcela, 1220);
  near(cr.linhas[12].parcela, 1281);
  near(cr.linhas[24].credAtual, 110250);
});

test('índice IPCA sem taxa projetada não é calculado', () => {
  const s = base();
  s.reajuste.parcela.indice = 'ipca';
  const cr = Calc.cronograma(s, null);
  near(cr.linhas[11].parcela, 1220);
  assert.equal(cr.linhas[12].parcela, null);
  assert.ok(Calc.validar(s).some((v) => /sem premissa de projeção/.test(v.msg)));
});

function comLance() {
  const s = base();
  Object.assign(s.recursos, {
    fgtsDisponivel: 8000, fgtsPermitido: true, fgtsUsar: 5000, fgtsEmLivre: true,
    embutidoTipo: 'pct', embutidoValor: 20, embutidoEmLivre: true, embutidoLimitePct: 25,
    baseCalculo: 'contratado', embutidoTratamento: 'descontar'
  });
  Object.assign(s.contemplacao.livre, { tipo: 'pct', valor: 30, mes: 12, premissa: 'Hipótese do consultor' });
  Object.assign(s.contemplacao.sorteio, { mes: 24, premissa: 'Hipótese do consultor' });
  Object.assign(s.venda, { ativa: true, base: 'pct_liquido', pct: 25, comissaoPct: 10, custosFixos: 0 });
  return s;
}

test('cenário de lance separa recursos próprios, FGTS e embutido sem dupla contagem', () => {
  const r = Calc.simular(comLance());
  const L = r.cenarioB.linhas;
  near(L.lance.v, 30000);
  near(L.embutido.v, 20000);
  near(L.fgts.v, 5000);
  near(L.proprios.v, 5000);
  near(L.credLiquido.v, 80000);
  near(L.totalParcelas.v, 14640);
  near(L.totalAportado.v, 14640 + 5000 + 5000, 'embutido não entra no aporte');
  near(L.vendaBruta.v, 20000);
  near(L.vendaLiquida.v, 18000);
  near(L.resultado.v, 18000 - 14640 - 5000 - 5000);
});

test('FGTS pode ser apenas informativo no resultado', () => {
  const s = comLance();
  s.resultado.fgtsTratamento = 'informativo';
  near(Calc.simular(s).cenarioB.linhas.resultado.v, 18000 - 14640 - 5000);
});

test('FGTS não confirmado não é usado', () => {
  const s = comLance();
  s.recursos.fgtsPermitido = false;
  const L = Calc.simular(s).cenarioB.linhas;
  assert.equal(L.fgts.v, 0);
  near(L.proprios.v, 10000);
});

test('embutido sem regra impede crédito líquido', () => {
  const s = comLance();
  s.recursos.embutidoTratamento = 'definir';
  const L = Calc.simular(s).cenarioB.linhas;
  assert.equal(L.credLiquido.v, null);
  assert.ok(L.credLiquido.pend.includes(Calc.MSG.embutidoSemRegra));
});

test('sorteio não desconta embutido', () => {
  const L = Calc.simular(comLance()).cenarioA.linhas;
  assert.equal(L.embutido.v, 0);
  near(L.credLiquido.v, 100000);
  near(L.totalParcelas.v, 24 * 1220);
});

test('embutido acima do limite gera erro', () => {
  const s = comLance();
  s.recursos.embutidoLimitePct = 10;
  assert.ok(Calc.simular(s).validacoes.some((v) => v.nivel === 'erro' && /superior ao limite/.test(v.msg)));
});

test('soma manual de recursos diferente do total gera erro', () => {
  const s = comLance();
  s.recursos.recursosAuto = false;
  s.recursos.recursosProprios = 1000;
  assert.ok(Calc.simular(s).validacoes.some((v) => /diferente do total ofertado/.test(v.msg)));
});

test('base de lance a definir deixa percentual pendente', () => {
  const s = comLance();
  s.recursos.baseCalculo = 'definir';
  const L = Calc.simular(s).cenarioB.linhas;
  assert.equal(L.lance.v, null);
  assert.equal(L.resultado.v, null);
});

test('mês de contemplação ausente não é calculado', () => {
  const s = base();
  const r = Calc.simular(s);
  assert.equal(r.cenarioA.ok, false);
  assert.match(r.cenarioA.motivo, /Não calculado/);
});

test('validações de campos obrigatórios', () => {
  const v = Calc.validar(Calc.estadoPadrao());
  for (const c of ['plano.lead', 'plano.credito', 'plano.prazo', 'plano.taxaAdm', 'plano.frValor']) {
    assert.ok(v.some((x) => x.campo === c && x.nivel === 'erro'), c);
  }
});
