/*
 * Motor de cálculo do Simulador de Cartas de Consórcio Primárias.
 *
 * Funções puras, sem dependência de interface (DOM). Pode ser usado no
 * navegador (window.Calc) e no Node.js (require('./calc')) para testes.
 *
 * Convenções:
 * - Valores apresentados são objetos "Valor": { v, tipo, formula, origem, nota, pend }
 *     tipo: 'informado' | 'calculado' | 'estimado' | 'pendente' | 'na'
 *     v === null significa "Não calculado" e pend lista os motivos.
 * - Meses são numerados de 1 até o prazo.
 * - O núcleo numérico (nucleo) não formata textos, para poder ser chamado
 *   muitas vezes (gráfico de rentabilidade por mês de contemplação).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Catálogos e regras fixas
  // ---------------------------------------------------------------------------

  const INDICES = {
    pre5: { nome: 'Pré-fixado (5%)', taxaFixa: 5 },
    pre6: { nome: 'Pré-fixado (6%)', taxaFixa: 6 },
    ipca: { nome: 'IPCA' },
    incc: { nome: 'INCC' },
    inpc: { nome: 'INPC' },
    outro: { nome: 'Outro índice' }
  };

  const CATEGORIAS = {
    imovel: { nome: 'Imóvel', indice: 'incc' },
    veiculo: { nome: 'Veículo', indice: 'ipca' }
  };

  const ADMINISTRADORAS = ['HS', 'Embracon', 'CNP', 'Itaú', 'Porto Seguro', 'Servopa', 'Banco do Brasil', 'Santander', 'Klubi'];

  const MODALIDADES_PARCELA = {
    integral: { nome: 'Parcela integral', pct: 0 },
    r50: { nome: 'Redutor de 50%', pct: 50 },
    r25: { nome: 'Redutor de 25%', pct: 25 },
    outro: { nome: 'Redutor com outro percentual', pct: null }
  };

  const REGRAS = {
    periodicidadeReajuste: 12, // reajuste a cada 12 meses (mês 13, 25, ...) até o fim do plano
    vendaPct: 20, // venda da carta contemplada: 20% sobre o crédito líquido disponível
    seguroPctPadrao: 0.038, // seguro prestamista: % ao mês sobre o crédito atualizado
    embutidoPctPadrao: 25,
    fixoPctPadrao: 50
  };

  const MSG = {
    estimado: 'Resultado estimado: depende das premissas informadas.',
    mesHipotetico: 'Mês de contemplação projetado, sem garantia de ocorrência.',
    taxaEstimada: 'A projeção usa uma taxa estimada para o índice selecionado.'
  };

  // ---------------------------------------------------------------------------
  // Estado padrão
  // ---------------------------------------------------------------------------

  function estadoPadrao() {
    return {
      plano: {
        lead: '',
        categoria: 'imovel',
        administradora: '',
        credito: null,
        prazo: 240,
        mesContemplacao: 12,
        taxaAdm: null,
        fundoReserva: null,
        adesaoAtiva: false,
        adesaoPct: null,
        adesaoMeses: null,
        seguroAtivo: false,
        seguroPct: REGRAS.seguroPctPadrao,
        abatimento: 'parcela', // 'parcela' | 'prazo'
        indice: CATEGORIAS.imovel.indice,
        indiceTaxa: null,
        indiceNome: ''
      },
      parcela: { modalidade: 'integral', redutorOutro: null },
      lances: {
        embutidoAtivo: true,
        embutidoPct: REGRAS.embutidoPctPadrao,
        fixoAtivo: true,
        fixoPct: REGRAS.fixoPctPadrao,
        fixoUsarEmbutido: true,
        livreAtivo: false,
        livrePct: null,
        livreUsarEmbutido: false
      },
      projecoes: { parcelas: false, credito: false, rentabilidade: false },
      contato: { whatsapp: '' }
    };
  }

  // ---------------------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------------------

  const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  function V(v, tipo, formula, origem, extra) {
    const o = { v: isNum(v) || typeof v === 'string' ? v : null, tipo, formula: formula || '', origem: origem || '', nota: '', pend: [] };
    if (o.v === null && tipo !== 'na') o.tipo = 'pendente';
    return Object.assign(o, extra || {});
  }
  function P(motivos, formula) {
    const lista = (Array.isArray(motivos) ? motivos : [motivos]).filter(Boolean);
    return { v: null, tipo: 'pendente', formula: formula || '', origem: '', nota: '', pend: Array.from(new Set(lista)) };
  }

  const fmtBRL = (x) =>
    isNum(x) ? x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtPct = (x, d) => (isNum(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 4 : d }) + '%' : '—');
  const fmtNum = (x, d) => (isNum(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 6 : d }) : '—');

  // ---------------------------------------------------------------------------
  // Regras de reajuste e redutor
  // ---------------------------------------------------------------------------

  function taxaIndice(p) {
    const def = INDICES[p.indice];
    if (!def) return null;
    if (isNum(def.taxaFixa)) return def.taxaFixa;
    return num(p.indiceTaxa);
  }

  function nomeIndice(p) {
    if (p.indice === 'outro') return 'Outro índice' + (p.indiceNome ? ' (' + p.indiceNome + ')' : '');
    return (INDICES[p.indice] || { nome: 'Não selecionado' }).nome;
  }

  const indiceEstimado = (p) => ['ipca', 'incc', 'inpc', 'outro'].includes(p.indice);

  /** Reajustes aplicados até o mês m: um a cada 12 meses (mês 13 = 1º reajuste). */
  const qtdReajustes = (m) => Math.floor((m - 1) / REGRAS.periodicidadeReajuste);

  /** Fator de reajuste no mês m (null quando a taxa do índice não foi informada). */
  function fator(p, m) {
    const k = qtdReajustes(m);
    if (k === 0) return 1;
    const t = taxaIndice(p);
    return isNum(t) ? Math.pow(1 + t / 100, k) : null;
  }

  function redutorPct(pr) {
    const mod = MODALIDADES_PARCELA[pr.modalidade] || MODALIDADES_PARCELA.integral;
    return mod.pct === null ? num(pr.redutorOutro) : mod.pct;
  }

  function motivoIndice(p) {
    return 'Índice de reajuste ' + nomeIndice(p) + ' sem taxa estimada informada (necessária a partir do mês 13)';
  }

  // ---------------------------------------------------------------------------
  // Dados básicos
  // ---------------------------------------------------------------------------

  function basicos(s) {
    const p = s.plano;
    const C = num(p.credito), N = num(p.prazo), ta = num(p.taxaAdm), fr = num(p.fundoReserva);
    const pend = [];
    if (!isNum(C) || C <= 0) pend.push('Valor do crédito não informado');
    if (!isNum(N) || N < 1 || !Number.isInteger(N)) pend.push('Prazo inválido');
    if (!isNum(ta)) pend.push('Taxa de administração não informada');
    if (!isNum(fr)) pend.push('Fundo de reserva não informado');
    const r = redutorPct(s.parcela);
    if (!isNum(r) || r < 0 || r >= 100) pend.push('Percentual do redutor inválido');
    return { ok: pend.length === 0, pend, C, N, ta, fr, r: isNum(r) ? r : 0 };
  }

  /**
   * Valores do lance de uma modalidade sobre uma base de crédito.
   * 'embutido': o lance é composto só pelo lance embutido (sem recursos próprios).
   * 'fixo' | 'livre': percentual da modalidade; com "Usar embutido", o embutido é descontado do total.
   */
  function lanceSobre(s, mod, base) {
    const l = s.lances;
    const pctE = num(l.embutidoPct);
    const pct = mod === 'embutido' ? pctE : num(mod === 'fixo' ? l.fixoPct : l.livrePct);
    const usar = mod === 'embutido' || ((mod === 'fixo' ? l.fixoUsarEmbutido : l.livreUsarEmbutido) && l.embutidoAtivo);
    const out = { pct, pctEmbutido: usar ? pctE : 0, usaEmbutido: usar, total: null, embutido: null, proprios: null, limitado: false };
    if (!isNum(pct) || !isNum(base)) return out;
    out.total = (pct / 100) * base;
    let e = usar && isNum(pctE) ? (pctE / 100) * base : 0;
    if (e > out.total) { e = out.total; out.limitado = true; }
    out.embutido = e;
    out.proprios = out.total - e;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Núcleo numérico de um cenário
  // ---------------------------------------------------------------------------

  /**
   * Calcula o cronograma e os totais de um cenário.
   * @param {object} s estado
   * @param {'sorteio'|'fixo'|'livre'} mod modalidade de contemplação
   * @param {number} [mesCOverride] mês de contemplação (padrão: projeção do plano)
   */
  function nucleo(s, mod, mesCOverride) {
    const b = basicos(s);
    const p = s.plano;
    const mesC = num(mesCOverride != null ? mesCOverride : p.mesContemplacao);
    const res = { ok: false, mod, mesC, pend: b.pend.slice(), linhas: [] };
    if (!b.ok) return res;
    const { C, N, ta, fr, r } = b;
    if (!isNum(mesC) || mesC < 1 || mesC > N || !Number.isInteger(mesC)) { res.pend.push('Projeção de contemplação inválida'); return res; }

    const pendIdx = motivoIndice(p);
    const F = [null];
    for (let m = 1; m <= N; m++) F.push(fator(p, m));

    // Adesão: % do crédito contratado, diluída em parcelas iguais (sem reajuste)
    let adesaoMes = 0, adesaoMeses = 0, adesaoTotal = 0;
    if (p.adesaoAtiva) {
      const ap = num(p.adesaoPct), am = num(p.adesaoMeses);
      if (!isNum(ap) || !isNum(am) || am < 1) res.pend.push('Adesão: percentual ou meses de diluição não informados');
      else { adesaoMeses = Math.min(Math.round(am), N); adesaoTotal = (ap / 100) * C; adesaoMes = adesaoTotal / adesaoMeses; }
    }
    const seguroPct = p.seguroAtivo ? num(p.seguroPct) : 0;
    if (p.seguroAtivo && !isNum(seguroPct)) res.pend.push('Seguro prestamista: percentual não informado');

    // Recomposição do redutor: o percentual não pago até a contemplação é diluído nas parcelas restantes
    const nRest = N - mesC;
    const extraFC = r > 0 && nRest > 0 ? (r / 100) * mesC / (N * nRest) : 0;

    const linhas = [];
    for (let m = 1; m <= N; m++) {
      const f = F[m];
      const l = { m, f, reduzido: r > 0 && m <= mesC, posContemplacao: m > mesC, encerrado: false };
      if (f === null) {
        Object.assign(l, { credAtual: null, fundoComum: null, taxa: null, fundo: null, plano: null, adesao: null, seguro: null, total: null, pend: [pendIdx] });
      } else {
        const cref = C * f;
        const fc = m <= mesC ? (cref / N) * (1 - r / 100) : cref * (1 / N + extraFC);
        l.credAtual = cref;
        l.fundoComum = fc;
        l.taxa = (ta / 100) * cref / N;
        l.fundo = (fr / 100) * cref / N;
        l.plano = l.fundoComum + l.taxa + l.fundo;
        l.adesao = m <= adesaoMeses ? adesaoMes : 0;
        l.seguro = isNum(seguroPct) ? (seguroPct / 100) * cref : null;
        l.pend = l.seguro === null ? ['Seguro prestamista: percentual não informado'] : [];
      }
      linhas.push(l);
    }

    // Saldo devedor na contemplação: parcelas restantes (fundo comum, taxa e fundo de reserva) a valores do mês da contemplação
    const credBruto = F[mesC] === null ? null : C * F[mesC];
    const fC = F[mesC];
    const posLinhas = linhas.slice(mesC);
    const saldoAntes = posLinhas.every((l) => isNum(l.plano)) && isNum(fC) ? posLinhas.reduce((a, l) => a + l.plano * fC / l.f, 0) : null;

    // Lance e abatimento
    let lance = null;
    if (mod !== 'sorteio') {
      lance = lanceSobre(s, mod, credBruto);
      if (!isNum(lance.pct)) res.pend.push('Percentual do ' + NOMES_MOD[mod].toLowerCase() + ' não informado');
      if (lance.usaEmbutido && !isNum(lance.pctEmbutido)) res.pend.push('Percentual do lance embutido não informado');
      const pos = linhas.slice(mesC);
      if (isNum(lance.total) && lance.total > 0 && pos.length && pos.every((l) => isNum(l.plano))) {
        const bases = pos.map((l) => l.plano * fC / l.f); // saldo a valores do mês da contemplação
        const saldo = bases.reduce((a, x) => a + x, 0);
        if (p.abatimento === 'prazo') {
          let resto = lance.total;
          for (let i = pos.length - 1; i >= 0 && resto > 1e-9; i--) {
            const l = pos[i];
            if (resto >= bases[i] - 1e-9) { resto -= bases[i]; escalar(l, 0); l.encerrado = true; l.seguro = 0; l.adesao = 0; }
            else { escalar(l, 1 - resto / bases[i]); resto = 0; }
          }
        } else {
          const k = Math.max(0, 1 - lance.total / saldo);
          pos.forEach((l) => escalar(l, k));
          if (k === 0) pos.forEach((l) => { l.encerrado = true; l.seguro = 0; l.adesao = 0; });
        }
        res.saldoNaContemplacao = saldo;
      }
    }
    linhas.forEach((l) => { l.total = [l.plano, l.adesao, l.seguro].every(isNum) ? l.plano + l.adesao + l.seguro : null; });

    // Totais
    const soma = (de, ate, campo) => {
      let v = 0;
      for (let m = de; m <= ate; m++) { const x = linhas[m - 1][campo]; if (!isNum(x)) return null; v += x; }
      return v;
    };
    res.linhas = linhas;
    res.C = C; res.N = N;
    res.credBruto = credBruto;
    res.lance = lance;
    res.embutido = lance && isNum(lance.embutido) ? lance.embutido : lance ? null : 0;
    res.credLiquido = isNum(credBruto) && isNum(res.embutido) ? credBruto - res.embutido : null;
    res.parcelaMes = linhas[mesC - 1].total;
    res.pagoPlano = soma(1, mesC, 'plano');
    res.pagoSeguro = soma(1, mesC, 'seguro');
    res.pagoAdesao = soma(1, mesC, 'adesao');
    res.totalParcelas = soma(1, mesC, 'total');
    res.proprios = lance ? lance.proprios : 0;
    res.lanceTotal = lance ? lance.total : 0;
    res.totalAportado = isNum(res.totalParcelas) && isNum(res.proprios) ? res.totalParcelas + res.proprios : null;
    res.venda = isNum(res.credLiquido) ? (REGRAS.vendaPct / 100) * res.credLiquido : null;
    res.resultado = isNum(res.venda) && isNum(res.totalAportado) ? res.venda - res.totalAportado : null;
    res.rentabilidade = isNum(res.resultado) && res.totalAportado > 0 ? (res.resultado / res.totalAportado) * 100 : null;
    const posAtivas = linhas.slice(mesC).filter((l) => !l.encerrado);
    res.parcelaPos = mesC < N ? (posAtivas.length ? posAtivas[0].total : 0) : null;
    res.prazoRestante = linhas.slice(mesC).filter((l) => !l.encerrado).length;
    res.obrigacoes = mesC < N ? soma(mesC + 1, N, 'total') : 0;
    // Valores pós-contemplação a preços do mês da contemplação (sem reajustes futuros)
    res.saldoDevedor = isNum(saldoAntes) ? Math.max(0, saldoAntes - (isNum(res.lanceTotal) ? res.lanceTotal : 0)) : null;
    const pa = posAtivas[0];
    res.parcelaPosAtual = mesC >= N ? null : !pa ? 0 : [pa.plano, pa.adesao, pa.seguro].every(isNum) && isNum(fC) ? pa.plano * fC / pa.f + pa.adesao + pa.seguro * fC / pa.f : null;
    res.totalPlano = soma(1, N, 'total');
    linhas.forEach((l) => l.pend.forEach((x) => res.pend.push(x)));
    res.pend = Array.from(new Set(res.pend));
    res.ok = true;
    return res;
  }

  function escalar(l, k) {
    ['fundoComum', 'taxa', 'fundo', 'plano'].forEach((c) => { if (isNum(l[c])) l[c] *= k; });
  }

  // ---------------------------------------------------------------------------
  // Cenário com memória de cálculo (tabelas de cenários)
  // ---------------------------------------------------------------------------

  const NOMES_MOD = { sorteio: 'Sorteio', embutido: 'Lance embutido', fixo: 'Lance fixo', livre: 'Lance livre' };
  const TITULOS = {
    sorteio: 'Contemplação por sorteio',
    embutido: 'Contemplação por lance embutido',
    fixo: 'Contemplação por lance fixo',
    livre: 'Contemplação por lance livre'
  };

  function cenario(s, mod) {
    const n = nucleo(s, mod);
    const res = { mod, nome: NOMES_MOD[mod], titulo: TITULOS[mod], ok: n.ok, nucleo: n, linhas: {}, alertas: [] };
    if (!n.ok) { res.motivo = 'Não calculado: ' + n.pend.join('; ') + '.'; return res; }
    const L = res.linhas;
    const p = s.plano;
    const mesC = n.mesC;
    const lm = n.linhas[mesC - 1];
    const val = (v, tipo, formula, origem, extra) => (isNum(v) ? V(v, tipo, formula, origem, extra) : P(n.pend.length ? n.pend : ['Dado não informado'], formula));

    L.mes = V('Mês ' + mesC, 'estimado', 'Projeção de contemplação informada no plano', 'Dados do plano', { nota: MSG.mesHipotetico });
    L.credito = V(n.C, 'informado', 'Crédito contratado', 'Informado pelo consultor');
    L.credBruto = isNum(n.credBruto)
      ? V(n.credBruto, lm.f === 1 ? 'calculado' : 'estimado', 'Crédito na contemplação = ' + fmtBRL(n.C) + ' × fator de reajuste ' + fmtNum(lm.f, 6) + ' (' + qtdReajustes(mesC) + ' reajuste(s) anual(is))', 'Índice: ' + nomeIndice(p), { nota: lm.f === 1 ? '' : MSG.taxaEstimada })
      : P([motivoIndice(p)], 'Crédito × fator de reajuste');

    if (mod === 'sorteio') {
      L.lance = V(0, 'na', 'Sem lance no cenário de sorteio', '');
      L.embutido = V(0, 'na', 'Sem lance embutido no cenário de sorteio', '');
      L.proprios = V(0, 'na', 'Sem recursos próprios de lance no cenário de sorteio', '');
    } else {
      const lc = n.lance;
      const base = fmtBRL(n.credBruto);
      L.lance = val(lc.total, 'estimado', 'Lance = ' + fmtPct(lc.pct) + ' × crédito na contemplação ' + base, mod === 'fixo' ? 'Percentual do lance fixo (administradora)' : mod === 'embutido' ? 'Lance composto só pelo embutido' : 'Percentual ofertado no lance livre');
      L.embutido = lc.usaEmbutido
        ? val(lc.embutido, 'estimado', 'Lance embutido = ' + fmtPct(lc.pctEmbutido) + ' × ' + base + (lc.limitado ? ' (limitado ao valor total do lance)' : ''), 'Percentual do lance embutido (administradora)')
        : V(0, 'calculado', '"Usar embutido" desmarcado para esta modalidade', 'Configuração');
      L.proprios = val(lc.proprios, 'estimado', 'Recursos próprios = Lance ' + fmtBRL(lc.total) + ' − Embutido ' + fmtBRL(lc.embutido), 'Cálculo');
      if (lc.limitado) res.alertas.push({ nivel: 'alerta', msg: res.nome + ': o lance embutido é maior que o lance total; foi limitado ao valor do lance.' });
    }
    L.credLiquido = val(n.credLiquido, n.embutido > 0 ? 'estimado' : L.credBruto.tipo, n.embutido > 0 ? 'Crédito líquido = ' + fmtBRL(n.credBruto) + ' − embutido ' + fmtBRL(n.embutido) : 'Crédito líquido = crédito na contemplação (sem embutido)', 'Cálculo');

    L.parcelaMes = isNum(lm.total)
      ? V(lm.total, 'estimado', 'Parcela do mês ' + mesC + ' = Fundo comum ' + fmtBRL(lm.fundoComum) + ' + Taxa adm. ' + fmtBRL(lm.taxa) + ' + Fundo de reserva ' + fmtBRL(lm.fundo) + ' + Adesão ' + fmtBRL(lm.adesao) + ' + Seguro ' + fmtBRL(lm.seguro), lm.reduzido ? 'Com redutor de ' + fmtPct(redutorPct(s.parcela), 0) : 'Parcela integral')
      : P(lm.pend.length ? lm.pend : n.pend, 'Parcela do mês');
    L.qtdParcelas = V(mesC, 'estimado', 'Parcelas pagas do mês 1 ao mês ' + mesC + ' (inclui a do mês da contemplação)', 'Projeção de contemplação');
    L.totalParcelas = val(n.totalParcelas, 'estimado', 'Σ parcelas meses 1–' + mesC + ' = Plano ' + fmtBRL(n.pagoPlano) + ' + Adesão ' + fmtBRL(n.pagoAdesao) + ' + Seguro ' + fmtBRL(n.pagoSeguro), 'Demonstrativo mensal');
    L.totalAportado = val(n.totalAportado, 'estimado', 'Total aportado = Parcelas pagas ' + fmtBRL(n.totalParcelas) + ' + Recursos próprios do lance ' + fmtBRL(n.proprios), 'O lance embutido não é somado: ele sai do crédito, não do cliente.');
    L.venda = val(n.venda, 'estimado', 'Venda = ' + REGRAS.vendaPct + '% × crédito líquido ' + fmtBRL(n.credLiquido), 'Premissa fixa do simulador (hipótese, sem garantia de venda)');
    L.resultado = val(n.resultado, 'estimado', 'Resultado = Venda ' + fmtBRL(n.venda) + ' − Total aportado ' + fmtBRL(n.totalAportado), 'Cálculo', { nota: MSG.estimado });
    L.rentabilidade = isNum(n.rentabilidade) ? V(n.rentabilidade, 'estimado', 'Rentabilidade = Resultado ÷ Total aportado = ' + fmtBRL(n.resultado) + ' ÷ ' + fmtBRL(n.totalAportado), 'Cálculo', { nota: MSG.estimado }) : P(n.pend.length ? n.pend : ['Total aportado não calculado'], 'Resultado ÷ Total aportado');

    const abat = p.abatimento === 'prazo' ? 'redução do prazo (parcelas quitadas a partir do fim do plano)' : 'redução proporcional do valor das parcelas restantes';
    if (mesC >= n.N) {
      L.parcelaPos = V(null, 'na', 'Contemplação no último mês: não há parcelas posteriores', '');
      L.prazoRestante = V(0, 'calculado', 'Sem parcelas após a contemplação', '');
    } else {
      const notaAbat = mod === 'sorteio' ? '' : 'Lance abatido por ' + abat + '.';
      L.parcelaPos = val(n.parcelaPos, 'estimado', 'Parcela do mês ' + (mesC + 1) + (s.parcela.modalidade !== 'integral' ? ', com a diferença do redutor diluída nas parcelas restantes' : '') + (mod !== 'sorteio' ? ', após o abatimento do lance' : ''), 'Demonstrativo mensal', { nota: notaAbat });
      L.prazoRestante = V(n.prazoRestante, 'estimado', 'Parcelas restantes após a contemplação' + (mod !== 'sorteio' && p.abatimento === 'prazo' ? ' (prazo reduzido pelo lance)' : ''), 'Demonstrativo mensal');
    }
    L.saldoDevedor = val(n.saldoDevedor, 'estimado', 'Saldo devedor = saldo das parcelas restantes a valores do mês da contemplação ' + fmtBRL(n.saldoDevedor + (n.lanceTotal || 0)) + ' − lance ' + fmtBRL(n.lanceTotal || 0), 'Sem reajustes futuros; exclui seguro');
    L.obrigacoes = val(n.obrigacoes, 'estimado', 'Σ parcelas projetadas após a contemplação', 'Demonstrativo mensal', { nota: 'Em caso de venda, as parcelas restantes passam ao comprador, conforme as regras da administradora.' });
    return res;
  }

  // ---------------------------------------------------------------------------
  // Validações
  // ---------------------------------------------------------------------------

  function validar(s) {
    const a = [];
    const add = (nivel, campo, msg) => a.push({ nivel, campo, msg });
    const p = s.plano;
    const C = num(p.credito), N = num(p.prazo);
    if (!String(p.lead || '').trim()) add('erro', 'plano.lead', 'Campo obrigatório: nome completo.');
    if (!p.administradora) add('info', 'plano.administradora', 'Administradora não selecionada.');
    if (!isNum(C)) add('erro', 'plano.credito', 'Campo obrigatório: valor do crédito.');
    else if (C <= 0) add('erro', 'plano.credito', 'O valor do crédito deve ser maior que zero.');
    if (!isNum(N)) add('erro', 'plano.prazo', 'Campo obrigatório: prazo total.');
    else if (N < 1 || !Number.isInteger(N)) add('erro', 'plano.prazo', 'Prazo inválido: informe um número inteiro de meses.');
    else if (N > 420) add('alerta', 'plano.prazo', 'Prazo acima de 420 meses: confirme com a administradora.');
    const mc = num(p.mesContemplacao);
    if (!isNum(mc)) add('erro', 'plano.mesContemplacao', 'Campo obrigatório: projeção de contemplação (mês).');
    else if (mc < 1 || !Number.isInteger(mc) || (isNum(N) && mc > N)) add('erro', 'plano.mesContemplacao', 'Projeção de contemplação deve ser um mês entre 1 e o prazo.');
    for (const [k, rot] of [['taxaAdm', 'taxa de administração'], ['fundoReserva', 'fundo de reserva']]) {
      const v = num(p[k]);
      if (!isNum(v)) add('erro', 'plano.' + k, 'Campo obrigatório: ' + rot + ' (%). Informe 0 se não houver.');
      else if (v < 0 || v > 100) add('erro', 'plano.' + k, 'Percentual inválido em ' + rot + ' (0 a 100%).');
    }
    if (p.adesaoAtiva) {
      const ap = num(p.adesaoPct), am = num(p.adesaoMeses);
      if (!isNum(ap)) add('erro', 'plano.adesaoPct', 'Adesão ativada: informe o percentual.');
      else if (ap < 0 || ap > 100) add('erro', 'plano.adesaoPct', 'Percentual de adesão inválido.');
      if (!isNum(am)) add('erro', 'plano.adesaoMeses', 'Adesão ativada: informe os meses de diluição.');
      else if (am < 1 || !Number.isInteger(am) || (isNum(N) && am > N)) add('erro', 'plano.adesaoMeses', 'Meses de diluição da adesão devem estar entre 1 e o prazo.');
    }
    if (p.seguroAtivo) {
      const sp = num(p.seguroPct);
      if (!isNum(sp)) add('erro', 'plano.seguroPct', 'Seguro prestamista ativado: informe o percentual.');
      else if (sp < 0 || sp > 100) add('erro', 'plano.seguroPct', 'Percentual do seguro prestamista inválido.');
    }
    if (!INDICES[p.indice]) add('erro', 'plano.indice', 'Selecione o índice de reajuste.');
    else if (!isNum(taxaIndice(p))) {
      if (!isNum(N) || N > 12) add('erro', 'plano.indiceTaxa', 'Índice ' + nomeIndice(p) + ' sem premissa de projeção: informe a taxa estimada ao ano.');
    } else if (indiceEstimado(p)) add('info', 'plano.indiceTaxa', MSG.taxaEstimada);

    if (s.parcela.modalidade === 'outro') {
      const r = num(s.parcela.redutorOutro);
      if (!isNum(r) || r <= 0 || r >= 100) add('erro', 'parcela.redutorOutro', 'Percentual de redução inválido (maior que 0% e menor que 100%).');
    }

    const l = s.lances;
    const pctOk = (campo, rot) => {
      const v = num(l[campo]);
      if (!isNum(v)) add('erro', 'lances.' + campo, rot + ': informe o percentual.');
      else if (v < 0 || v > 100) add('erro', 'lances.' + campo, rot + ': percentual inválido (0 a 100%).');
    };
    if (l.embutidoAtivo) pctOk('embutidoPct', 'Lance embutido');
    if (l.fixoAtivo) pctOk('fixoPct', 'Lance fixo');
    if (l.livreAtivo) pctOk('livrePct', 'Lance livre');
    if ((l.fixoAtivo && l.fixoUsarEmbutido) || (l.livreAtivo && l.livreUsarEmbutido)) {
      if (!l.embutidoAtivo) add('alerta', 'lances.embutidoAtivo', '"Usar embutido" marcado, mas o lance embutido está desativado: o embutido não será considerado.');
    }
    return a;
  }

  // ---------------------------------------------------------------------------
  // Premissas e pontos a confirmar
  // ---------------------------------------------------------------------------

  function premissas(s) {
    const p = s.plano;
    const t = taxaIndice(p);
    const l = [];
    l.push('Parcela = [(Crédito ÷ Prazo) × (1 − Redutor)] + (Taxa de administração ÷ Prazo) + (Fundo de reserva ÷ Prazo), com taxa de administração e fundo de reserva em % do crédito.');
    l.push('Reajuste anual pelo índice ' + nomeIndice(p) + (isNum(t) ? ' (' + fmtPct(t) + ' ao ano' + (indiceEstimado(p) ? ', taxa estimada' : '') + ')' : ' (taxa não informada)') + ', a cada 12 meses (meses 13, 25, 37...) até o fim do plano. O reajuste incide sobre o crédito e as parcelas são recalculadas sobre o crédito reajustado.');
    if (s.parcela.modalidade !== 'integral') l.push('Redutor de ' + fmtPct(redutorPct(s.parcela), 0) + ' aplicado da 1ª parcela até a contemplação. Depois, a diferença não paga é diluída nas parcelas restantes.');
    if (p.adesaoAtiva) l.push('Adesão de ' + fmtPct(num(p.adesaoPct)) + ' do crédito contratado, diluída em ' + (p.adesaoMeses || '—') + ' parcela(s) iguais, sem reajuste.');
    if (p.seguroAtivo) l.push('Seguro prestamista de ' + fmtPct(num(p.seguroPct), 3) + ' ao mês sobre o crédito atualizado, somado à parcela.');
    l.push('Lance abatido por ' + (p.abatimento === 'prazo' ? 'redução do prazo (quita parcelas a partir do fim do plano)' : 'redução proporcional do valor das parcelas restantes') + ', a valores do mês da contemplação.');
    l.push('Percentuais de lance calculados sobre o crédito atualizado no mês da contemplação. Recursos próprios = lance total − lance embutido.');
    l.push('Contemplação projetada no mês ' + (p.mesContemplacao || '—') + '. A parcela desse mês é considerada paga.');
    l.push('Venda da carta contemplada: ' + REGRAS.vendaPct + '% sobre o crédito líquido disponível (hipótese fixa, sem garantia de venda). Resultado = valor de venda − total aportado (parcelas pagas + recursos próprios do lance).');
    return l;
  }

  function pontosConfirmar(s) {
    const p = s.plano;
    const l = [];
    if (indiceEstimado(p)) l.push('Taxa projetada do índice ' + nomeIndice(p) + ' (estimativa informada pelo consultor)');
    l.push('Percentuais de taxa de administração, fundo de reserva, adesão e seguro praticados pela administradora' + (p.administradora ? ' ' + p.administradora : ''));
    l.push('Percentual máximo de lance embutido e percentual do lance fixo do grupo');
    l.push('Forma de recomposição do redutor e de amortização do lance adotada pela administradora');
    l.push('Transferência da carta e das parcelas restantes em caso de venda');
    return l;
  }

  // ---------------------------------------------------------------------------
  // Resumo
  // ---------------------------------------------------------------------------

  function parcelaDataBase(s, redutor) {
    const b = basicos(s);
    if (!isNum(b.C) || !isNum(b.N) || !isNum(b.ta) || !isNum(b.fr) || b.N < 1) return null;
    return (b.C / b.N) * (1 - redutor / 100) + (b.ta / 100) * b.C / b.N + (b.fr / 100) * b.C / b.N;
  }

  function resumo(s, nSorteio) {
    const p = s.plano;
    const b = basicos(s);
    const R = {};
    const C = b.C, N = b.N;
    R.credito = isNum(C) ? V(C, 'informado', 'Valor do crédito', 'Informado pelo consultor') : P('Crédito não informado');
    R.prazo = isNum(N) ? V(N, 'informado', 'Prazo total em meses', 'Informado pelo consultor') : P('Prazo não informado');
    R.taxaAdm = isNum(b.ta) && isNum(C) ? V((b.ta / 100) * C, 'calculado', 'Taxa adm. total = ' + fmtPct(b.ta) + ' × ' + fmtBRL(C), 'Percentual informado', { pct: b.ta }) : P('Taxa de administração ou crédito não informados');
    R.taxaAno = isNum(b.ta) && isNum(b.fr) && isNum(N) && N > 0 ? V((b.ta + b.fr) / (N / 12), 'calculado', 'Total de taxas ao ano = (taxa de administração ' + fmtPct(b.ta) + ' + fundo de reserva ' + fmtPct(b.fr) + ') ÷ (' + N + ' meses ÷ 12)', 'Taxas diluídas pelos anos do plano') : P('Taxa de administração, fundo de reserva ou prazo não informados');
    R.fundoReserva = isNum(b.fr) && isNum(C) ? V((b.fr / 100) * C, 'calculado', 'Fundo de reserva total = ' + fmtPct(b.fr) + ' × ' + fmtBRL(C), 'Percentual informado', { pct: b.fr }) : P('Fundo de reserva ou crédito não informados');
    if (p.adesaoAtiva) {
      const ap = num(p.adesaoPct), am = num(p.adesaoMeses);
      R.adesao = isNum(ap) && isNum(am) && isNum(C) && am >= 1 ? V((ap / 100) * C, 'calculado', 'Adesão = ' + fmtPct(ap) + ' × ' + fmtBRL(C) + ', em ' + am + ' parcela(s) de ' + fmtBRL((ap / 100) * C / am), 'Percentual informado', { mensal: (ap / 100) * C / am }) : P('Adesão: percentual ou meses não informados');
    } else R.adesao = V(null, 'na', 'Sem taxa de adesão', '', { nota: 'Sem adesão' });

    const r = redutorPct(s.parcela);
    const pInt = parcelaDataBase(s, 0);
    R.parcelaIntegral = isNum(pInt)
      ? V(pInt, 'calculado', 'Parcela integral = (' + fmtBRL(C) + ' ÷ ' + N + ') + (' + fmtBRL(R.taxaAdm.v) + ' ÷ ' + N + ') + (' + fmtBRL(R.fundoReserva.v) + ' ÷ ' + N + ')', 'Fórmula da parcela; sem adesão, seguro e reajuste')
      : P(b.pend, 'Parcela integral');
    if (s.parcela.modalidade !== 'integral') {
      const pr = isNum(r) ? parcelaDataBase(s, r) : null;
      R.parcelaRedutor = isNum(pr)
        ? V(pr, 'calculado', 'Parcela com redutor = (' + fmtBRL(C) + ' ÷ ' + N + ') × (1 − ' + fmtPct(r, 0) + ') + (' + fmtBRL(R.taxaAdm.v) + ' ÷ ' + N + ') + (' + fmtBRL(R.fundoReserva.v) + ' ÷ ' + N + ')', 'Fórmula da parcela; sem adesão, seguro e reajuste')
        : P(b.pend, 'Parcela com redutor');
    }
    const l1 = nSorteio.ok ? nSorteio.linhas[0] : null;
    R.parcelaInicial = l1 && isNum(l1.total)
      ? V(l1.total, 'calculado', 'Parcela do mês 1 = Fundo comum ' + fmtBRL(l1.fundoComum) + ' + Taxa adm. ' + fmtBRL(l1.taxa) + ' + Fundo de reserva ' + fmtBRL(l1.fundo) + ' + Adesão ' + fmtBRL(l1.adesao) + ' + Seguro ' + fmtBRL(l1.seguro), 'Demonstrativo mensal')
      : P(nSorteio.pend, 'Parcela do mês 1');
    R.seguro = !p.seguroAtivo ? V(null, 'na', 'Seguro prestamista não contratado', '', { nota: 'Não contratado' })
      : l1 && isNum(l1.seguro) ? V(l1.seguro, 'calculado', 'Seguro = ' + fmtPct(num(p.seguroPct), 3) + ' × crédito ' + fmtBRL(l1.credAtual), 'Percentual informado') : P('Seguro prestamista: percentual não informado');
    R.totalPago = nSorteio.ok && isNum(nSorteio.totalPlano)
      ? V(nSorteio.totalPlano, 'estimado', 'Σ parcelas dos meses 1 a ' + N + ' (cenário sem lance, contemplação no mês ' + nSorteio.mesC + ')', 'Demonstrativo mensal', { nota: MSG.estimado })
      : P(nSorteio.pend, 'Σ parcelas do plano');
    return R;
  }

  // ---------------------------------------------------------------------------
  // Projeções (dados dos gráficos)
  // ---------------------------------------------------------------------------

  function modsAtivas(s) {
    const l = ['sorteio'];
    if (s.lances.embutidoAtivo) l.push('embutido');
    if (s.lances.fixoAtivo) l.push('fixo');
    if (s.lances.livreAtivo) l.push('livre');
    return l;
  }

  function projecoes(s, nucleos) {
    const out = {};
    const b = basicos(s);
    if (!b.ok) return out;
    const pr = s.projecoes;
    const mods = modsAtivas(s);
    if (pr.parcelas) {
      out.parcelas = mods.map((mod) => ({ mod, nome: NOMES_MOD[mod], pontos: nucleos[mod].ok ? nucleos[mod].linhas.map((l) => ({ x: l.m, y: l.encerrado ? null : l.total })) : [] }));
    }
    if (pr.credito) {
      const pts = [];
      for (let ano = 1; ano <= Math.ceil(b.N / 12); ano++) {
        const m = (ano - 1) * 12 + 1;
        const f = fator(s.plano, m);
        pts.push({ x: ano, rotulo: 'Ano ' + ano, y: isNum(f) ? b.C * f : null });
      }
      out.credito = pts;
    }
    if (pr.rentabilidade) {
      out.rentabilidade = mods.map((mod) => {
        const pts = [];
        for (let m = 1; m <= b.N; m++) { const n = nucleo(s, mod, m); pts.push({ x: m, y: n.ok ? n.resultado : null, pct: n.ok ? n.rentabilidade : null }); }
        return { mod, nome: NOMES_MOD[mod], pontos: pts };
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Simulação de aquisição: CET do uso da carta para comprar o bem
  // ---------------------------------------------------------------------------

  /** Valor presente dos fluxos (índice 1 = mês 1) a uma taxa mensal. */
  function vpl(fluxos, i) {
    let v = 0;
    for (let t = 1; t < fluxos.length; t++) v += fluxos[t] / Math.pow(1 + i, t);
    return v;
  }

  /**
   * Taxa interna de retorno mensal do ponto de vista do cliente que usa o crédito.
   * Procura a menor taxa positiva em que o VPL muda de sinal e refina por bissecção.
   */
  function tirMensal(fluxos) {
    let a = 0, fa = vpl(fluxos, 0);
    if (Math.abs(fa) < 1e-6) return 0;
    for (let i = 0.0005; i <= 0.2 + 1e-12; i += 0.0005) {
      const fi = vpl(fluxos, i);
      if ((fa < 0 && fi >= 0) || (fa > 0 && fi <= 0)) {
        let lo = a, hi = i, flo = fa;
        for (let k = 0; k < 80; k++) {
          const mid = (lo + hi) / 2, fm = vpl(fluxos, mid);
          if ((flo < 0 && fm < 0) || (flo > 0 && fm > 0)) { lo = mid; flo = fm; } else hi = mid;
        }
        return (lo + hi) / 2;
      }
      a = i; fa = fi;
    }
    return null;
  }

  /**
   * Aquisição do bem com a carta: o cliente paga todas as parcelas (com reajustes até o fim do plano)
   * e os recursos próprios do lance, e recebe o crédito disponível no mês da contemplação.
   */
  function aquisicao(s, mod) {
    const n = nucleo(s, mod);
    const out = { mod, nome: NOMES_MOD[mod], ok: false, pend: n.pend };
    if (!n.ok || !isNum(n.totalPlano) || !isNum(n.credLiquido) || !isNum(n.proprios)) return out;
    const fluxos = [0];
    n.linhas.forEach((l) => fluxos.push(-(l.total || 0)));
    fluxos[n.mesC] += n.credLiquido - n.proprios;
    const i = tirMensal(fluxos);
    out.ok = true;
    out.mesC = n.mesC;
    out.credito = n.credLiquido;
    out.proprios = n.proprios;
    out.totalParcelas = n.totalPlano;
    out.prazoEfetivo = n.mesC + n.prazoRestante;
    out.desembolso = n.totalPlano + n.proprios;
    out.custo = out.desembolso - n.credLiquido;
    out.custoPct = n.credLiquido > 0 ? (out.custo / n.credLiquido) * 100 : null;
    out.cetMes = isNum(i) ? i * 100 : null;
    out.cetAno = isNum(i) ? (Math.pow(1 + i, 12) - 1) * 100 : null;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Simulação de alavancagem: contemplação e venda em meses sucessivos
  // ---------------------------------------------------------------------------

  const PASSO_ALAVANCAGEM = 6;
  const ATE_ALAVANCAGEM = 49;

  function alavancagem(s) {
    const b = basicos(s);
    if (!b.ok) return [];
    const mods = ['sorteio'];
    if (s.lances.embutidoAtivo) mods.push('embutido');
    const meses = [];
    for (let m = 1; m <= Math.min(ATE_ALAVANCAGEM, b.N); m += PASSO_ALAVANCAGEM) meses.push(m);
    return mods.map((mod) => ({
      mod,
      nome: NOMES_MOD[mod],
      linhas: meses.map((m) => {
        const n = nucleo(s, mod, m);
        return { m, credito: n.credLiquido, parcela: n.parcelaMes, aporte: n.totalAportado, venda: n.venda, lucro: n.resultado, rentabilidade: n.rentabilidade };
      })
    }));
  }

  // ---------------------------------------------------------------------------
  // Função principal
  // ---------------------------------------------------------------------------

  function simular(s) {
    const validacoes = validar(s);
    const mods = modsAtivas(s);
    const cenarios = mods.map((m) => cenario(s, m));
    const nucleos = {};
    cenarios.forEach((c) => { nucleos[c.mod] = c.nucleo; });
    cenarios.forEach((c) => c.alertas.forEach((x) => validacoes.push(Object.assign({ campo: 'lances' }, x))));
    const b = basicos(s);
    const baseLance = nucleos.sorteio && nucleos.sorteio.ok ? nucleos.sorteio.credBruto : null;
    const valor = (pct) => (isNum(baseLance) && isNum(num(pct)) ? (num(pct) / 100) * baseLance : null);
    return {
      validacoes,
      resumo: resumo(s, nucleos.sorteio),
      cenarios,
      valoresLance: { embutido: valor(s.lances.embutidoPct), fixo: valor(s.lances.fixoPct), livre: valor(s.lances.livrePct) },
      baseLance,
      projecoes: projecoes(s, nucleos),
      alavancagem: alavancagem(s),
      aquisicao: modsAtivas(s).filter((m) => m !== 'sorteio').map((m) => aquisicao(s, m)),
      premissas: premissas(s),
      pontosConfirmar: pontosConfirmar(s),
      redutorPct: redutorPct(s.parcela),
      prazo: b.N
    };
  }

  return {
    INDICES, CATEGORIAS, ADMINISTRADORAS, MODALIDADES_PARCELA, REGRAS, MSG, NOMES_MOD,
    estadoPadrao, simular, nucleo, aquisicao, tirMensal, vpl, cenario, validar, fator, qtdReajustes, parcelaDataBase, redutorPct,
    nomeIndice, taxaIndice, indiceEstimado, lanceSobre,
    fmtBRL, fmtPct, fmtNum, num, isNum
  };
});
