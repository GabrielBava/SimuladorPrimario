/*
 * Motor de cálculo do Simulador de Cartas de Consórcio Primárias.
 *
 * Funções puras, sem dependência de interface (DOM). Pode ser usado no
 * navegador (window.Calc) e no Node.js (require('./calc')) para testes.
 *
 * Convenções:
 * - Todo valor apresentado é um objeto "Valor": { v, tipo, formula, origem, nota, pend }
 *     tipo: 'informado' | 'calculado' | 'estimado' | 'pendente' | 'na'
 *     v === null significa "Não calculado" e pend lista os motivos.
 * - Meses são numerados de 1 até o prazo (mês 1 = mês inicial da simulação).
 * - Nenhuma regra de administradora/grupo é presumida: quando não informada,
 *   o valor dependente fica pendente ("Regra a definir").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Catálogos
  // ---------------------------------------------------------------------------

  const INDICES = {
    definir: { nome: 'Regra a definir' },
    pre5: { nome: 'Pré-fixado (5%)', taxaFixa: 5 },
    pre6: { nome: 'Pré-fixado (6%)', taxaFixa: 6 },
    ipca: { nome: 'IPCA' },
    incc: { nome: 'INCC' },
    inpc: { nome: 'INPC' },
    outro: { nome: 'Outro índice' },
    sem: { nome: 'Sem reajuste (valores nominais)', taxaFixa: 0 }
  };

  const MODALIDADES_PARCELA = {
    integral: { nome: 'Parcela integral', pct: 0 },
    r50: { nome: 'Redutor de 50%', pct: 50 },
    r25: { nome: 'Redutor de 25%', pct: 25 },
    outro: { nome: 'Redutor com outro percentual', pct: null }
  };

  const MSG = {
    pendRegra: 'Não calculado: depende de regra a definir',
    estimado: 'Resultado estimado: depende das premissas informadas.',
    mesHipotetico: 'Mês de contemplação hipotético, sem garantia de ocorrência.',
    taxaEstimada: 'A projeção usa uma taxa estimada para o índice selecionado.',
    embutidoSemRegra: 'Não foi possível calcular o crédito líquido sem a regra do lance embutido.',
    recomposicao: 'Regra a definir: informe como o redutor é recomposto.'
  };

  // ---------------------------------------------------------------------------
  // Estado padrão (configuração de fábrica). Campos sem regra informada
  // começam vazios ou como 'definir'.
  // ---------------------------------------------------------------------------

  function estadoPadrao() {
    return {
      plano: {
        lead: '',
        administradora: '',
        grupo: '',
        credito: null,
        prazo: null,
        mesInicial: '',
        taxaAdm: null,
        frTipo: 'pct', // 'pct' | 'valor'
        frValor: null,
        seguroAtivo: false,
        seguroTipo: 'definir', // 'definir' | 'pct_credito' | 'fixo'
        seguroValor: null,
        outrosCustos: [] // { desc, tipo: 'definir'|'unico'|'mensal', valor, mes }
      },
      parcela: {
        modalidade: 'integral',
        redutorOutro: null,
        redIni: 1,
        redFim: null,
        encerrarNaContemplacao: false,
        recomposicao: 'definir', // 'definir' | 'diluir' | 'manual'
        parcelaManual: null
      },
      reajuste: {
        credito: { indice: 'definir', taxa: null, nome: '' },
        parcela: { indice: 'definir', taxa: null, nome: '' },
        periodicidade: 12,
        primeiroMes: 13
      },
      recursos: {
        fgtsDisponivel: null,
        fgtsPermitido: false,
        fgtsUsar: null,
        fgtsEmFixo: false,
        fgtsEmLivre: false,
        embutidoTipo: 'pct', // 'pct' | 'valor'
        embutidoValor: null,
        embutidoEmFixo: false,
        embutidoEmLivre: false,
        embutidoLimitePct: null,
        lanceLimitePct: null,
        baseCalculo: 'definir', // 'definir' | 'contratado' | 'atualizado'
        embutidoTratamento: 'definir', // 'definir' | 'descontar'
        recursosAuto: true,
        recursosProprios: null,
        regrasGrupo: ''
      },
      contemplacao: {
        sorteio: { disponivel: true, mes: null, premissa: '', obs: '' },
        fixo: { disponivel: false, pct: null, mes: null, premissa: '', obs: '' },
        livre: { disponivel: true, tipo: 'pct', valor: null, mes: null, premissa: '', obs: '' },
        cenarioB: 'livre', // 'livre' | 'fixo'
        abatimento: 'definir' // 'definir' | 'nominal'
      },
      venda: {
        ativa: false,
        base: 'pct_liquido', // 'pct_liquido' | 'pct_bruto' | 'valor'
        pct: null,
        valor: null,
        comissaoPct: null,
        custosFixos: null,
        obs: ''
      },
      resultado: {
        incluirParcelas: true,
        incluirSeguro: true,
        incluirOutros: true,
        incluirProprios: true,
        fgtsTratamento: 'deduzir', // 'deduzir' | 'informativo'
        fluxos: [] // { desc, valor } (positivo = entrada, negativo = saída)
      },
      horizonte: { tipo: 'prazo', mes: null } // 'prazo' | 'mes' | 'sorteio' | 'lance'
    };
  }

  // ---------------------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------------------

  const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const r2 = (x) => (isNum(x) ? Math.round(x * 100) / 100 : x);

  function V(v, tipo, formula, origem, extra) {
    const o = { v: isNum(v) || typeof v === 'string' ? v : v === 0 ? 0 : null, tipo, formula: formula || '', origem: origem || '', nota: '', pend: [] };
    if (o.v === null && tipo !== 'na') o.tipo = 'pendente';
    return Object.assign(o, extra || {});
  }
  function P(motivos, formula, origem) {
    const lista = Array.isArray(motivos) ? motivos : [motivos];
    return { v: null, tipo: 'pendente', formula: formula || '', origem: origem || '', nota: '', pend: lista.filter(Boolean) };
  }

  const fmtBRL = (x) =>
    isNum(x) ? x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtPct = (x, d) => (isNum(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 4 : d }) + '%' : '—');
  const fmtNum = (x, d) => (isNum(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 6 : d }) : '—');

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function rotuloMes(mesInicial, m) {
    if (!/^\d{4}-\d{2}$/.test(mesInicial || '')) return 'Mês ' + m;
    const [a, mm] = mesInicial.split('-').map(Number);
    const idx = mm - 1 + (m - 1);
    const ano = a + Math.floor(idx / 12);
    return 'Mês ' + m + ' (' + MESES[idx % 12] + '/' + ano + ')';
  }

  // ---------------------------------------------------------------------------
  // Reajuste
  // ---------------------------------------------------------------------------

  function taxaIndice(cfg) {
    const def = INDICES[cfg.indice] || INDICES.definir;
    if (cfg.indice === 'definir') return null;
    if (isNum(def.taxaFixa)) return def.taxaFixa;
    return num(cfg.taxa);
  }

  function nomeIndice(cfg) {
    if (cfg.indice === 'outro') return 'Outro índice' + (cfg.nome ? ' (' + cfg.nome + ')' : '');
    return (INDICES[cfg.indice] || INDICES.definir).nome;
  }

  /** Quantidade de reajustes aplicados até o mês m (inclusive). */
  function qtdReajustes(m, periodicidade, primeiroMes) {
    const per = num(periodicidade);
    const pri = num(primeiroMes);
    if (!isNum(per) || per < 1 || !isNum(pri) || pri < 1) return null;
    return m >= pri ? Math.floor((m - pri) / per) + 1 : 0;
  }

  /** Fator acumulado de reajuste no mês m. null = não calculável. */
  function fatorReajuste(cfg, reaj, m) {
    const k = qtdReajustes(m, reaj.periodicidade, reaj.primeiroMes);
    if (k === null) return null;
    if (k === 0) return 1;
    const t = taxaIndice(cfg);
    if (!isNum(t)) return null;
    return Math.pow(1 + t / 100, k);
  }

  function motivoIndice(cfg, rotulo) {
    if (cfg.indice === 'definir') return 'Índice de reajuste ' + rotulo + ': regra a definir';
    return 'Índice de reajuste ' + rotulo + ' (' + nomeIndice(cfg) + ') sem taxa projetada informada';
  }

  // ---------------------------------------------------------------------------
  // Parcela
  // ---------------------------------------------------------------------------

  function redutorPct(p) {
    const mod = MODALIDADES_PARCELA[p.modalidade] || MODALIDADES_PARCELA.integral;
    return mod.pct === null ? num(p.redutorOutro) : mod.pct;
  }

  /** Componentes de taxa e fundo de reserva sobre um crédito de referência. */
  function componentesTaxas(s, crefP, fp) {
    const N = num(s.plano.prazo);
    const ta = num(s.plano.taxaAdm);
    const fr = num(s.plano.frValor);
    const taxa = isNum(ta) && isNum(crefP) ? (ta / 100) * crefP / N : null;
    let fundo = null;
    if (isNum(fr)) {
      if (s.plano.frTipo === 'valor') fundo = isNum(fp) ? (fr * fp) / N : null;
      else fundo = isNum(crefP) ? ((fr / 100) * crefP) / N : null;
    }
    return { taxa, fundo };
  }

  /**
   * Parcela pela regra informada:
   * Parcela = [(Crédito ÷ Prazo) × (1 − Redutor)] + (Taxa adm. total ÷ Prazo) + (Fundo de reserva total ÷ Prazo)
   */
  function parcelaFormula(s, redutor) {
    const C = num(s.plano.credito);
    const N = num(s.plano.prazo);
    if (!isNum(C) || !isNum(N) || N <= 0) return null;
    const { taxa, fundo } = componentesTaxas(s, C, 1);
    if (!isNum(taxa) || !isNum(fundo) || !isNum(redutor)) return null;
    return (C / N) * (1 - redutor / 100) + taxa + fundo;
  }

  // ---------------------------------------------------------------------------
  // Cronograma mensal (demonstrativo)
  // ---------------------------------------------------------------------------

  /**
   * Monta o demonstrativo mês a mês.
   * @param {object} s estado
   * @param {number|null} mesC mês de contemplação do cenário (afeta o fim do redutor quando configurado)
   */
  function cronograma(s, mesC) {
    const C = num(s.plano.credito);
    const N = num(s.plano.prazo);
    if (!isNum(C) || !isNum(N) || N < 1 || C <= 0) return { linhas: [], fimRed: null, nRed: 0, nRest: 0 };
    const pr = s.parcela;
    const r = redutorPct(pr);
    const temRed = pr.modalidade !== 'integral';
    const redIni = num(pr.redIni) || 1;
    let fimRed = temRed ? num(pr.redFim) : null;
    if (temRed && pr.encerrarNaContemplacao && isNum(mesC)) fimRed = isNum(fimRed) ? Math.min(fimRed, mesC) : mesC;
    const nRed = temRed && isNum(fimRed) ? Math.max(0, Math.min(fimRed, N) - redIni + 1) : 0;
    const nRest = temRed && isNum(fimRed) ? Math.max(0, N - Math.min(fimRed, N)) : 0;

    const linhas = [];
    for (let m = 1; m <= N; m++) {
      const pend = [];
      const fp = fatorReajuste(s.reajuste.parcela, s.reajuste, m);
      const fc = fatorReajuste(s.reajuste.credito, s.reajuste, m);
      if (fp === null) pend.push(motivoIndice(s.reajuste.parcela, 'da parcela'));
      const credAtual = isNum(fc) ? C * fc : null;
      const crefP = isNum(fp) ? C * fp : null;

      let reduzido = false;
      let posRed = false;
      let fundoComum = null;
      let manual = null;
      if (!temRed) {
        fundoComum = isNum(crefP) ? crefP / N : null;
      } else if (!isNum(r) || r < 0 || r >= 100) {
        pend.push('Percentual do redutor não informado ou inválido');
      } else if (m < redIni) {
        fundoComum = isNum(crefP) ? crefP / N : null;
      } else if (!isNum(fimRed)) {
        pend.push('Período do redutor não informado');
      } else if (m <= fimRed) {
        reduzido = true;
        fundoComum = isNum(crefP) ? (crefP / N) * (1 - r / 100) : null;
      } else {
        posRed = true;
        if (pr.recomposicao === 'diluir') {
          fundoComum = isNum(crefP) && nRest > 0 ? crefP * (1 / N + (r / 100) * nRed / (N * nRest)) : null;
        } else if (pr.recomposicao === 'manual') {
          const pm = num(pr.parcelaManual);
          if (!isNum(pm)) pend.push('Valor da parcela após o redutor não informado');
          else manual = isNum(fp) ? pm * fp : null;
        } else {
          pend.push(MSG.recomposicao);
        }
      }

      const { taxa, fundo } = componentesTaxas(s, crefP, fp);
      if (!isNum(num(s.plano.taxaAdm))) pend.push('Taxa de administração não informada');
      if (!isNum(num(s.plano.frValor))) pend.push('Fundo de reserva não informado');

      let parcela = null;
      if (manual !== null) {
        parcela = manual;
        fundoComum = isNum(taxa) && isNum(fundo) ? manual - taxa - fundo : null;
      } else if (isNum(fundoComum) && isNum(taxa) && isNum(fundo)) {
        parcela = fundoComum + taxa + fundo;
      }

      // Seguro
      let seguro = 0;
      if (s.plano.seguroAtivo) {
        const sv = num(s.plano.seguroValor);
        if (s.plano.seguroTipo === 'pct_credito') {
          if (!isNum(sv)) { seguro = null; pend.push('Seguro: percentual não informado'); }
          else if (!isNum(credAtual)) { seguro = null; pend.push(motivoIndice(s.reajuste.credito, 'do crédito')); }
          else seguro = (sv / 100) * credAtual;
        } else if (s.plano.seguroTipo === 'fixo') {
          if (!isNum(sv)) { seguro = null; pend.push('Seguro: valor mensal não informado'); }
          else seguro = sv;
        } else {
          seguro = null;
          pend.push('Seguro: regra de cobrança a definir');
        }
      }

      // Outros custos
      let outros = 0;
      for (const oc of s.plano.outrosCustos || []) {
        if (!oc || (!oc.desc && !isNum(num(oc.valor)))) continue;
        const val = num(oc.valor);
        if (oc.tipo === 'mensal') {
          if (!isNum(val)) { outros = null; pend.push('Outro custo "' + (oc.desc || 'sem descrição') + '": valor não informado'); }
          else if (outros !== null) outros += val;
        } else if (oc.tipo === 'unico') {
          const mo = num(oc.mes);
          if (!isNum(val) || !isNum(mo)) { outros = null; pend.push('Outro custo "' + (oc.desc || 'sem descrição') + '": valor ou mês não informado'); }
          else if (mo === m && outros !== null) outros += val;
        } else {
          outros = null;
          pend.push('Outro custo "' + (oc.desc || 'sem descrição') + '": forma de cobrança a definir');
        }
      }

      const parcelaTotal = isNum(parcela) && isNum(seguro) ? parcela + seguro : null;
      const totalMes = isNum(parcelaTotal) && isNum(outros) ? parcelaTotal + outros : null;
      linhas.push({
        m, rotulo: rotuloMes(s.plano.mesInicial, m), fp, fc, credAtual, crefP, reduzido, posRed,
        fundoComum, taxa, fundo, parcela, seguro, parcelaTotal, outros, totalMes,
        pend: Array.from(new Set(pend))
      });
    }
    return { linhas, fimRed, nRed, nRest, redIni };
  }

  /** Soma um campo do cronograma entre os meses de..ate (inclusive). */
  function somar(linhas, de, ate, campo) {
    let v = 0;
    const pend = new Set();
    for (const l of linhas) {
      if (l.m < de || l.m > ate) continue;
      if (!isNum(l[campo])) { v = null; l.pend.forEach((p) => pend.add(p)); }
      else if (v !== null) v += l[campo];
    }
    return { v, pend: Array.from(pend) };
  }

  // ---------------------------------------------------------------------------
  // Lance
  // ---------------------------------------------------------------------------

  function calcularLance(s, mod, mesC, credBruto) {
    const C = num(s.plano.credito);
    const rc = s.recursos;
    const cfg = s.contemplacao[mod];
    const out = { mod, nomeMod: mod === 'fixo' ? 'Lance fixo' : 'Lance livre', alertas: [] };
    const base = rc.baseCalculo === 'contratado' ? C : rc.baseCalculo === 'atualizado' ? credBruto : null;
    const nomeBase = rc.baseCalculo === 'contratado' ? 'crédito contratado' : rc.baseCalculo === 'atualizado' ? 'crédito atualizado no mês da contemplação' : 'base a definir';
    const motivoBase = 'Base de cálculo percentual do lance: regra a definir';

    // Total ofertado
    if (mod === 'fixo') {
      const pct = num(cfg.pct);
      if (!isNum(pct)) out.total = P('Percentual do lance fixo (regra do grupo) a definir', 'Lance fixo = % do lance fixo × base');
      else if (!isNum(base)) out.total = P(rc.baseCalculo === 'definir' ? motivoBase : 'Crédito na contemplação não calculado', 'Lance fixo = % × base');
      else out.total = V(pct / 100 * base, 'estimado', 'Lance fixo = ' + fmtPct(pct) + ' × ' + fmtBRL(base) + ' (' + nomeBase + ')', 'Regra do grupo informada pelo consultor');
    } else {
      const val = num(cfg.valor);
      if (!isNum(val)) out.total = P('Valor ou percentual do lance livre não informado', 'Lance livre = valor informado');
      else if (cfg.tipo === 'valor') out.total = V(val, 'informado', 'Lance livre = valor informado', 'Informado pelo consultor');
      else if (!isNum(base)) out.total = P(rc.baseCalculo === 'definir' ? motivoBase : 'Crédito na contemplação não calculado', 'Lance livre = % × base');
      else out.total = V(val / 100 * base, 'estimado', 'Lance livre = ' + fmtPct(val) + ' × ' + fmtBRL(base) + ' (' + nomeBase + ')', 'Premissa do consultor');
    }

    // Lance embutido
    const usaEmb = mod === 'fixo' ? rc.embutidoEmFixo : rc.embutidoEmLivre;
    if (!usaEmb) out.embutido = V(0, 'informado', 'Lance embutido não utilizado nesta modalidade', 'Configuração do consultor');
    else {
      const ev = num(rc.embutidoValor);
      if (!isNum(ev)) out.embutido = P('Lance embutido: percentual ou valor não informado');
      else if (rc.embutidoTipo === 'valor') out.embutido = V(ev, 'informado', 'Lance embutido = valor informado', 'Informado pelo consultor');
      else if (!isNum(base)) out.embutido = P(rc.baseCalculo === 'definir' ? motivoBase : 'Crédito na contemplação não calculado', 'Embutido = % × base');
      else out.embutido = V(ev / 100 * base, 'estimado', 'Lance embutido = ' + fmtPct(ev) + ' × ' + fmtBRL(base) + ' (' + nomeBase + ')', 'Regra do grupo / premissa');
    }

    // FGTS
    const usaFgts = mod === 'fixo' ? rc.fgtsEmFixo : rc.fgtsEmLivre;
    const fu = num(rc.fgtsUsar);
    if (!usaFgts || !isNum(fu) || fu === 0) out.fgts = V(0, 'informado', 'FGTS não utilizado nesta modalidade', 'Configuração do consultor');
    else if (!rc.fgtsPermitido) {
      out.fgts = V(0, 'calculado', 'FGTS não considerado: uso não confirmado pela regra do grupo/contrato', 'Validação');
      out.alertas.push({ nivel: 'alerta', msg: out.nomeMod + ': FGTS informado, mas o uso não foi confirmado como permitido. O FGTS não foi considerado no lance.' });
    } else out.fgts = V(fu, 'informado', 'FGTS = valor informado para uso no lance', 'Informado pelo consultor (uso confirmado)');

    // Recursos próprios (dinheiro)
    const t = out.total.v, e = out.embutido.v, f = out.fgts.v;
    if (rc.recursosAuto) {
      if (isNum(t) && isNum(e) && isNum(f)) {
        const rp = t - e - f;
        if (rp < -0.005) {
          out.proprios = V(0, 'calculado', 'Recursos próprios = Total − Embutido − FGTS = ' + fmtBRL(rp) + ' (negativo, ajustado para R$ 0,00)', 'Cálculo');
          out.alertas.push({ nivel: 'erro', msg: out.nomeMod + ': lance embutido + FGTS (' + fmtBRL(e + f) + ') superam o total ofertado (' + fmtBRL(t) + ').' });
        } else out.proprios = V(Math.max(0, rp), 'calculado', 'Recursos próprios = Total ofertado − Embutido − FGTS = ' + fmtBRL(t) + ' − ' + fmtBRL(e) + ' − ' + fmtBRL(f), 'Cálculo automático pela diferença');
      } else out.proprios = P([].concat(out.total.pend, out.embutido.pend, out.fgts.pend), 'Recursos próprios = Total − Embutido − FGTS');
    } else {
      const rp = num(rc.recursosProprios);
      out.proprios = isNum(rp) ? V(rp, 'informado', 'Recursos próprios = valor informado', 'Informado pelo consultor') : P('Recursos próprios não informados');
    }

    // Composição
    const soma = [out.proprios.v, out.fgts.v, out.embutido.v].every(isNum) ? out.proprios.v + out.fgts.v + out.embutido.v : null;
    out.composicao = soma === null ? P('Composição incompleta') : V(soma, 'calculado', 'Recursos próprios + FGTS + Embutido = ' + fmtBRL(out.proprios.v) + ' + ' + fmtBRL(out.fgts.v) + ' + ' + fmtBRL(out.embutido.v), 'Cálculo');
    if (isNum(soma) && isNum(t) && Math.abs(soma - t) > 0.005) {
      out.alertas.push({ nivel: 'erro', msg: out.nomeMod + ': soma dos recursos (' + fmtBRL(soma) + ') diferente do total ofertado (' + fmtBRL(t) + ').' });
    }

    // Limites
    if (isNum(e) && e > 0) {
      const lim = num(rc.embutidoLimitePct);
      if (!isNum(lim)) out.alertas.push({ nivel: 'alerta', msg: out.nomeMod + ': limite máximo do lance embutido não informado (regra do grupo a definir).' });
      else if (isNum(base) && e > (lim / 100) * base + 0.005) out.alertas.push({ nivel: 'erro', msg: out.nomeMod + ': lance embutido (' + fmtBRL(e) + ') superior ao limite permitido de ' + fmtPct(lim) + ' (' + fmtBRL(lim / 100 * base) + ').' });
      else if (!isNum(base)) out.alertas.push({ nivel: 'alerta', msg: out.nomeMod + ': não foi possível verificar o limite do embutido sem a base de cálculo.' });
    }
    const limL = num(rc.lanceLimitePct);
    if (isNum(limL) && isNum(t) && isNum(base) && t > (limL / 100) * base + 0.005) {
      out.alertas.push({ nivel: 'erro', msg: out.nomeMod + ': lance total (' + fmtBRL(t) + ') superior ao limite informado de ' + fmtPct(limL) + ' (' + fmtBRL(limL / 100 * base) + ').' });
    }
    const fd = num(rc.fgtsDisponivel);
    if (isNum(f) && f > 0 && isNum(fd) && f > fd + 0.005) out.alertas.push({ nivel: 'erro', msg: out.nomeMod + ': FGTS utilizado (' + fmtBRL(f) + ') maior que o FGTS disponível (' + fmtBRL(fd) + ').' });
    if (isNum(f) && f > 0 && !isNum(fd)) out.alertas.push({ nivel: 'alerta', msg: out.nomeMod + ': FGTS disponível não informado.' });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Cenários (Tabela A — sorteio, Tabela B — lance)
  // ---------------------------------------------------------------------------

  function cenario(s, tipo) {
    const C = num(s.plano.credito);
    const N = num(s.plano.prazo);
    const ehLance = tipo === 'lance';
    const mod = ehLance ? s.contemplacao.cenarioB : 'sorteio';
    const cfg = s.contemplacao[mod];
    const mesC = num(cfg.mes);
    const res = { tipo, mod, titulo: ehLance ? 'Tabela B — Cenário hipotético de contemplação por lance' : 'Tabela A — Cenário hipotético de contemplação por sorteio', linhas: {}, alertas: [], ok: true };
    const L = res.linhas;
    const nomeMod = mod === 'sorteio' ? 'Sorteio' : mod === 'fixo' ? 'Lance fixo' : 'Lance livre';
    res.nomeMod = nomeMod;

    if (!cfg.disponivel) res.alertas.push({ nivel: 'alerta', msg: nomeMod + ' marcado como não disponível no grupo. Cenário apresentado apenas como hipótese.' });
    if (!isNum(C) || !isNum(N) || N < 1) { res.ok = false; res.motivo = 'Informe crédito e prazo.'; return res; }
    if (!isNum(mesC) || mesC < 1 || mesC > N) {
      res.ok = false;
      res.motivo = 'Não calculado: informe um mês hipotético de contemplação (' + nomeMod.toLowerCase() + ') entre 1 e ' + N + '.';
      return res;
    }
    if (!String(cfg.premissa || '').trim()) res.alertas.push({ nivel: 'alerta', msg: nomeMod + ': contemplação estimada sem premissa informada.' });

    const cr = cronograma(s, mesC);
    res.cronograma = cr;
    const lm = cr.linhas[mesC - 1];

    L.mes = V(lm.rotulo, 'estimado', 'Mês informado como hipótese pelo consultor', 'Premissa: ' + (cfg.premissa || 'não informada'), { nota: MSG.mesHipotetico });
    L.credito = V(C, 'informado', 'Crédito contratado', 'Informado pelo consultor');
    L.credBruto = isNum(lm.credAtual)
      ? V(lm.credAtual, lm.fc === 1 ? 'calculado' : 'estimado', 'Crédito bruto = Crédito contratado × fator de reajuste do crédito = ' + fmtBRL(C) + ' × ' + fmtNum(lm.fc, 6), 'Índice: ' + nomeIndice(s.reajuste.credito), { nota: lm.fc === 1 ? '' : MSG.taxaEstimada })
      : P(motivoIndice(s.reajuste.credito, 'do crédito'), 'Crédito bruto = Crédito × fator de reajuste');

    let lance = null;
    if (ehLance) {
      lance = calcularLance(s, mod, mesC, L.credBruto.v);
      res.lance = lance;
      res.alertas.push(...lance.alertas);
      L.embutido = lance.embutido;
      L.lance = lance.total;
      L.proprios = lance.proprios;
      L.fgts = lance.fgts;
    } else {
      const zero = (f) => V(0, 'informado', f, 'Cenário de sorteio: sem lance');
      L.embutido = zero('Sem lance embutido no cenário de sorteio');
      L.lance = zero('Sem lance no cenário de sorteio');
      L.proprios = zero('Sem recursos próprios de lance no cenário de sorteio');
      L.fgts = zero('Sem FGTS no cenário de sorteio');
    }
    L.embutidoUsado = Object.assign({}, L.embutido);

    // Crédito líquido
    const e = L.embutido.v;
    if (!isNum(L.credBruto.v)) L.credLiquido = P(L.credBruto.pend, 'Crédito líquido = Crédito bruto − Lance embutido');
    else if (!isNum(e)) L.credLiquido = P(L.embutido.pend, 'Crédito líquido = Crédito bruto − Lance embutido');
    else if (e === 0) L.credLiquido = V(L.credBruto.v, L.credBruto.tipo, 'Crédito líquido = Crédito bruto (sem lance embutido)', 'Cálculo');
    else if (s.recursos.embutidoTratamento === 'descontar') L.credLiquido = V(L.credBruto.v - e, 'estimado', 'Crédito líquido = Crédito bruto − Lance embutido = ' + fmtBRL(L.credBruto.v) + ' − ' + fmtBRL(e), 'Regra configurada: embutido descontado do crédito na contemplação');
    else L.credLiquido = P(MSG.embutidoSemRegra, 'Crédito líquido = depende da regra do lance embutido');

    // Parcelas
    L.parcelaMes = isNum(lm.parcelaTotal)
      ? V(lm.parcelaTotal, 'estimado', 'Parcela do mês ' + mesC + ' = Fundo comum ' + fmtBRL(lm.fundoComum) + ' + Taxa adm. ' + fmtBRL(lm.taxa) + ' + Fundo de reserva ' + fmtBRL(lm.fundo) + ' + Seguro ' + fmtBRL(lm.seguro), (lm.reduzido ? 'Com redutor. ' : lm.posRed ? 'Após o redutor (recomposição). ' : '') + 'Índice da parcela: ' + nomeIndice(s.reajuste.parcela))
      : P(lm.pend, 'Parcela = Fundo comum + Taxa adm. + Fundo de reserva + Seguro');
    L.qtdParcelas = V(mesC, 'estimado', 'Parcelas pagas do mês 1 ao mês ' + mesC + ' (a parcela do mês da contemplação é considerada paga)', 'Premissa de cálculo');
    const sp = somar(cr.linhas, 1, mesC, 'parcela');
    const ss = somar(cr.linhas, 1, mesC, 'seguro');
    const so = somar(cr.linhas, 1, mesC, 'outros');
    L.parcelasSemSeguro = sp.v === null ? P(sp.pend, 'Σ parcelas (sem seguro) meses 1..' + mesC) : V(sp.v, 'estimado', 'Σ parcelas (fundo comum + taxa adm. + fundo de reserva) dos meses 1 a ' + mesC, 'Demonstrativo mensal');
    L.seguroPago = ss.v === null ? P(ss.pend, 'Σ seguro meses 1..' + mesC) : V(ss.v, 'estimado', 'Σ seguro dos meses 1 a ' + mesC, 'Demonstrativo mensal');
    L.totalParcelas = sp.v === null || ss.v === null ? P([].concat(sp.pend, ss.pend), 'Σ parcelas + Σ seguro') : V(sp.v + ss.v, 'estimado', 'Total de parcelas = Σ parcelas ' + fmtBRL(sp.v) + ' + Σ seguro ' + fmtBRL(ss.v), 'Demonstrativo mensal');
    L.outrosPagos = so.v === null ? P(so.pend, 'Σ outros custos meses 1..' + mesC) : V(so.v, 'estimado', 'Σ outros custos dos meses 1 a ' + mesC, 'Outros custos configurados');

    // Total aportado (dinheiro + FGTS). O embutido NÃO é aporte: sai do crédito.
    const comp = [L.totalParcelas, L.outrosPagos, L.proprios, L.fgts];
    if (comp.every((x) => isNum(x.v))) {
      const tot = L.totalParcelas.v + L.outrosPagos.v + L.proprios.v + L.fgts.v;
      L.totalAportado = V(tot, 'estimado', 'Total aportado = Parcelas ' + fmtBRL(L.totalParcelas.v) + ' + Outros custos ' + fmtBRL(L.outrosPagos.v) + ' + Recursos próprios ' + fmtBRL(L.proprios.v) + ' + FGTS ' + fmtBRL(L.fgts.v), 'O lance embutido não é somado: é descontado do crédito, não sai do participante.');
      L.desembolsoDinheiro = V(tot - L.fgts.v, 'estimado', 'Desembolso em dinheiro = Total aportado − FGTS', 'Cálculo');
    } else {
      const pend = comp.reduce((a, x) => a.concat(x.pend || []), []);
      L.totalAportado = P(pend, 'Parcelas + Outros custos + Recursos próprios + FGTS');
      L.desembolsoDinheiro = P(pend, 'Total aportado − FGTS');
    }

    // Venda
    const vd = s.venda;
    if (!vd.ativa) {
      L.vendaBruta = V(null, 'na', 'Venda não simulada', '', { nota: 'Venda simulada desativada' });
      L.vendaCustos = V(null, 'na', 'Venda não simulada', '');
      L.vendaLiquida = V(null, 'na', 'Venda não simulada', '');
    } else {
      if (vd.base === 'valor') {
        const vv = num(vd.valor);
        L.vendaBruta = isNum(vv) ? V(vv, 'estimado', 'Valor de venda = valor informado (hipótese)', 'Premissa do consultor') : P('Venda simulada sem premissa de preço');
      } else {
        const pct = num(vd.pct);
        const baseV = vd.base === 'pct_bruto' ? L.credBruto : L.credLiquido;
        const nomeB = vd.base === 'pct_bruto' ? 'crédito bruto' : 'crédito líquido';
        if (!isNum(pct)) L.vendaBruta = P('Venda simulada sem premissa de preço');
        else if (!isNum(baseV.v)) L.vendaBruta = P(baseV.pend, 'Valor de venda = % × ' + nomeB);
        else L.vendaBruta = V(pct / 100 * baseV.v, 'estimado', 'Valor de venda = ' + fmtPct(pct) + ' × ' + nomeB + ' ' + fmtBRL(baseV.v), 'Premissa do consultor (hipótese, sem garantia de liquidez)');
      }
      const com = num(vd.comissaoPct);
      const fix = num(vd.custosFixos);
      if (!isNum(com) && !isNum(fix)) {
        L.vendaCustos = P('Venda simulada sem premissa de custos (informe 0 se não houver)');
      } else if (!isNum(L.vendaBruta.v)) {
        L.vendaCustos = P(L.vendaBruta.pend, 'Custos = % comissão/taxas × valor de venda + custos fixos');
      } else {
        const c = (isNum(com) ? com / 100 * L.vendaBruta.v : 0) + (isNum(fix) ? fix : 0);
        L.vendaCustos = V(c, 'estimado', 'Custos = ' + fmtPct(com || 0) + ' × ' + fmtBRL(L.vendaBruta.v) + ' + ' + fmtBRL(fix || 0), 'Premissa do consultor');
      }
      L.vendaLiquida = isNum(L.vendaBruta.v) && isNum(L.vendaCustos.v)
        ? V(L.vendaBruta.v - L.vendaCustos.v, 'estimado', 'Valor líquido = Valor de venda − Custos = ' + fmtBRL(L.vendaBruta.v) + ' − ' + fmtBRL(L.vendaCustos.v), 'Cálculo sobre premissas')
        : P([].concat(L.vendaBruta.pend || [], L.vendaCustos.pend || []), 'Valor de venda − Custos');
    }

    // Resultado financeiro estimado (fórmula editável por componentes)
    const rs = s.resultado;
    const componentes = [];
    if (vd.ativa) componentes.push({ nome: 'Valor líquido recebido na venda', sinal: +1, val: L.vendaLiquida });
    if (rs.incluirParcelas) componentes.push({ nome: 'Parcelas pagas até a contemplação (sem seguro)', sinal: -1, val: L.parcelasSemSeguro });
    if (rs.incluirSeguro) componentes.push({ nome: 'Seguro pago até a contemplação', sinal: -1, val: L.seguroPago });
    if (rs.incluirOutros) componentes.push({ nome: 'Outros custos pagos pelo participante', sinal: -1, val: L.outrosPagos });
    if (rs.incluirProprios) componentes.push({ nome: 'Recursos próprios usados no lance', sinal: -1, val: L.proprios });
    if (rs.fgtsTratamento === 'deduzir') componentes.push({ nome: 'FGTS usado no lance (tratado como patrimônio do participante)', sinal: -1, val: L.fgts });
    for (const fl of rs.fluxos || []) {
      const fv = num(fl.valor);
      if (!fl.desc && !isNum(fv)) continue;
      componentes.push({ nome: 'Fluxo: ' + (fl.desc || 'sem descrição'), sinal: +1, val: isNum(fv) ? V(fv, 'informado', 'Valor informado', 'Consultor') : P('Fluxo sem valor') });
    }
    res.componentes = componentes;
    if (!vd.ativa) {
      L.resultado = V(null, 'na', 'Resultado não calculado: venda da carta não simulada', '', { nota: 'Ative a venda simulada para estimar o resultado.' });
    } else if (componentes.every((c) => isNum(c.val.v))) {
      const tot = componentes.reduce((a, c) => a + c.sinal * c.val.v, 0);
      L.resultado = V(tot, 'estimado', componentes.map((c) => (c.sinal > 0 ? '+ ' : '− ') + c.nome + ' ' + fmtBRL(c.val.v)).join('\n'), 'Fórmula configurável', { nota: MSG.estimado });
    } else {
      L.resultado = P(componentes.reduce((a, c) => a.concat(c.val.pend || []), []), 'Resultado = Σ componentes configurados');
    }

    // Obrigações futuras (parcelas após a contemplação)
    const of = somar(cr.linhas, mesC + 1, N, 'parcelaTotal');
    if (mesC >= N) L.obrigacoes = V(0, 'estimado', 'Sem parcelas após o mês da contemplação', 'Demonstrativo');
    else if (of.v === null) L.obrigacoes = P(of.pend, 'Σ parcelas dos meses ' + (mesC + 1) + ' a ' + N);
    else if (ehLance && isNum(L.lance.v) && L.lance.v > 0) {
      if (s.contemplacao.abatimento === 'nominal') {
        L.obrigacoes = V(Math.max(0, of.v - L.lance.v), 'estimado', 'Obrigações = Σ parcelas meses ' + (mesC + 1) + '–' + N + ' ' + fmtBRL(of.v) + ' − Lance ' + fmtBRL(L.lance.v) + ' (abatimento nominal)', 'Aproximação configurada pelo consultor', { nota: 'Aproximação: a forma real de amortização do lance depende da administradora.' });
      } else {
        L.obrigacoes = V(of.v, 'estimado', 'Σ parcelas projetadas dos meses ' + (mesC + 1) + ' a ' + N + ', SEM abatimento do lance', 'Demonstrativo mensal', { nota: 'Regra a definir: a forma de amortização do saldo pelo lance (redução de prazo ou de parcela) depende da administradora.' });
      }
    } else {
      L.obrigacoes = V(of.v, 'estimado', 'Σ parcelas projetadas dos meses ' + (mesC + 1) + ' a ' + N, 'Demonstrativo mensal', { nota: 'Em caso de venda, a transferência das obrigações ao comprador depende da administradora e do contrato.' });
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // Validações gerais
  // ---------------------------------------------------------------------------

  function validar(s) {
    const a = [];
    const add = (nivel, campo, msg) => a.push({ nivel, campo, msg });
    const p = s.plano;
    const C = num(p.credito), N = num(p.prazo);
    if (!String(p.lead || '').trim()) add('erro', 'plano.lead', 'Campo obrigatório: nome do lead ou identificação da simulação.');
    if (!isNum(C)) add('erro', 'plano.credito', 'Campo obrigatório: valor do crédito.');
    else if (C <= 0) add('erro', 'plano.credito', 'O valor do crédito deve ser maior que zero.');
    if (!isNum(N)) add('erro', 'plano.prazo', 'Campo obrigatório: prazo total do plano.');
    else if (N < 1 || !Number.isInteger(N)) add('erro', 'plano.prazo', 'Prazo inválido: informe um número inteiro de meses maior que zero.');
    else if (N > 420) add('alerta', 'plano.prazo', 'Prazo acima de 420 meses: confirme com a administradora.');
    if (!p.mesInicial) add('info', 'plano.mesInicial', 'Mês inicial não informado: os meses serão exibidos apenas pela numeração.');
    const ta = num(p.taxaAdm);
    if (!isNum(ta)) add('erro', 'plano.taxaAdm', 'Campo obrigatório: taxa de administração total (%).');
    else if (ta < 0 || ta > 100) add('erro', 'plano.taxaAdm', 'Percentual inválido na taxa de administração (0 a 100%).');
    const fr = num(p.frValor);
    if (!isNum(fr)) add('erro', 'plano.frValor', 'Campo obrigatório: fundo de reserva (informe 0 se não houver).');
    else if (fr < 0) add('erro', 'plano.frValor', 'Fundo de reserva não pode ser negativo.');
    else if (p.frTipo === 'pct' && fr > 100) add('erro', 'plano.frValor', 'Percentual inválido no fundo de reserva.');
    if (p.seguroAtivo) {
      if (p.seguroTipo === 'definir') add('alerta', 'plano.seguroTipo', 'Seguro ativado sem regra: informe a forma de cobrança (Regra a definir).');
      else if (!isNum(num(p.seguroValor))) add('erro', 'plano.seguroValor', 'Seguro ativado sem valor.');
      else if (num(p.seguroValor) < 0) add('erro', 'plano.seguroValor', 'Valor do seguro não pode ser negativo.');
    }
    (p.outrosCustos || []).forEach((oc, i) => {
      if (!oc.desc && !isNum(num(oc.valor))) return;
      if (oc.tipo === 'definir') add('alerta', 'plano.outrosCustos', 'Outro custo "' + (oc.desc || '#' + (i + 1)) + '": forma de cobrança a definir.');
      if (isNum(num(oc.valor)) && num(oc.valor) < 0) add('erro', 'plano.outrosCustos', 'Outro custo "' + (oc.desc || '#' + (i + 1)) + '": valor negativo.');
      if (oc.tipo === 'unico' && isNum(N) && (!isNum(num(oc.mes)) || num(oc.mes) < 1 || num(oc.mes) > N)) add('erro', 'plano.outrosCustos', 'Outro custo "' + (oc.desc || '#' + (i + 1)) + '": mês de cobrança inválido.');
    });

    // Redutor
    const pr = s.parcela;
    if (pr.modalidade !== 'integral') {
      const r = redutorPct(pr);
      if (!isNum(r) || r <= 0 || r >= 100) add('erro', 'parcela.redutorOutro', 'Percentual de redução inválido (deve ser maior que 0% e menor que 100%).');
      const ini = num(pr.redIni), fim = num(pr.redFim);
      if (!isNum(fim) && !pr.encerrarNaContemplacao) add('erro', 'parcela.redFim', 'Redutor ativado sem período: informe o último mês com redutor.');
      if (isNum(ini) && isNum(fim) && fim < ini) add('erro', 'parcela.redFim', 'O último mês do redutor deve ser maior ou igual ao mês inicial.');
      if (isNum(fim) && isNum(N) && fim >= N) add('alerta', 'parcela.redFim', 'O redutor cobre todo o prazo: o fundo comum não seria integralizado nesta projeção.');
      if (pr.recomposicao === 'definir') add('alerta', 'parcela.recomposicao', MSG.recomposicao + ' A projeção após o redutor não será calculada.');
      if (pr.recomposicao === 'manual' && !isNum(num(pr.parcelaManual))) add('erro', 'parcela.parcelaManual', 'Informe o valor da parcela após o redutor.');
    }

    // Reajuste
    const rj = s.reajuste;
    for (const [k, rot] of [['credito', 'do crédito'], ['parcela', 'da parcela']]) {
      const c = rj[k];
      if (c.indice === 'definir') add('alerta', 'reajuste.' + k, 'Índice de reajuste ' + rot + ': regra a definir. Valores após o primeiro reajuste não serão calculados.');
      else if (!isNum(taxaIndice(c))) add('erro', 'reajuste.' + k, 'Índice ' + nomeIndice(c) + ' selecionado para reajuste ' + rot + ' sem premissa de projeção (informe a taxa estimada por período).');
      else if (['ipca', 'incc', 'inpc', 'outro'].includes(c.indice)) add('info', 'reajuste.' + k, 'Reajuste ' + rot + ': ' + MSG.taxaEstimada);
    }
    if (!isNum(num(rj.periodicidade)) || num(rj.periodicidade) < 1) add('erro', 'reajuste.periodicidade', 'Periodicidade do reajuste inválida.');
    if (!isNum(num(rj.primeiroMes)) || num(rj.primeiroMes) < 1) add('erro', 'reajuste.primeiroMes', 'Mês do primeiro reajuste inválido.');
    if (rj.credito.indice !== rj.parcela.indice && rj.credito.indice !== 'definir' && rj.parcela.indice !== 'definir') add('info', 'reajuste', 'Índices diferentes para crédito e parcela: a relação entre crédito e parcelas se altera ao longo do prazo.');

    // Recursos
    const rc = s.recursos;
    for (const [campo, rot] of [['fgtsDisponivel', 'FGTS disponível'], ['fgtsUsar', 'FGTS a utilizar'], ['embutidoValor', 'lance embutido'], ['recursosProprios', 'recursos próprios']]) {
      if (isNum(num(rc[campo])) && num(rc[campo]) < 0) add('erro', 'recursos.' + campo, 'Valor negativo em ' + rot + '.');
    }
    if (rc.embutidoTipo === 'pct' && isNum(num(rc.embutidoValor)) && num(rc.embutidoValor) > 100) add('erro', 'recursos.embutidoValor', 'Percentual inválido no lance embutido.');
    if ((rc.fgtsEmFixo || rc.fgtsEmLivre) && !rc.fgtsPermitido && isNum(num(rc.fgtsUsar)) && num(rc.fgtsUsar) > 0) add('alerta', 'recursos.fgtsPermitido', 'FGTS informado sem confirmação de que o uso é permitido: não será considerado.');
    if ((rc.embutidoEmFixo || rc.embutidoEmLivre) && rc.embutidoTratamento === 'definir') add('alerta', 'recursos.embutidoTratamento', MSG.embutidoSemRegra);
    if (rc.baseCalculo === 'definir' && (rc.embutidoTipo === 'pct' || s.contemplacao.livre.tipo === 'pct' || s.contemplacao.cenarioB === 'fixo')) add('alerta', 'recursos.baseCalculo', 'Base de cálculo dos percentuais de lance: regra a definir.');

    // Contemplação
    const ct = s.contemplacao;
    for (const [k, rot] of [['sorteio', 'sorteio'], ['fixo', 'lance fixo'], ['livre', 'lance livre']]) {
      const m = num(ct[k].mes);
      if (isNum(m) && (m < 1 || (isNum(N) && m > N) || !Number.isInteger(m))) add('erro', 'contemplacao.' + k + '.mes', 'Mês hipotético de contemplação (' + rot + ') fora do prazo.');
    }
    if (ct.cenarioB === 'fixo' && !isNum(num(ct.fixo.pct))) add('alerta', 'contemplacao.fixo.pct', 'Regra do lance fixo a definir (percentual do grupo).');
    if (isNum(num(ct.fixo.pct)) && (num(ct.fixo.pct) < 0 || num(ct.fixo.pct) > 100)) add('erro', 'contemplacao.fixo.pct', 'Percentual inválido no lance fixo.');
    if (ct.livre.tipo === 'pct' && isNum(num(ct.livre.valor)) && (num(ct.livre.valor) < 0 || num(ct.livre.valor) > 100)) add('erro', 'contemplacao.livre.valor', 'Percentual inválido no lance livre.');

    // Venda
    const vd = s.venda;
    if (vd.ativa) {
      if ((vd.base === 'valor' && !isNum(num(vd.valor))) || (vd.base !== 'valor' && !isNum(num(vd.pct)))) add('erro', 'venda.pct', 'Venda simulada sem premissa de preço.');
      if (!isNum(num(vd.comissaoPct)) && !isNum(num(vd.custosFixos))) add('alerta', 'venda.comissaoPct', 'Venda simulada sem premissa de custos (informe 0 se não houver).');
      if (isNum(num(vd.comissaoPct)) && (num(vd.comissaoPct) < 0 || num(vd.comissaoPct) > 100)) add('erro', 'venda.comissaoPct', 'Percentual inválido nos custos de venda.');
    }

    // Horizonte
    if (s.horizonte.tipo === 'mes') {
      const hm = num(s.horizonte.mes);
      if (!isNum(hm) || hm < 1 || (isNum(N) && hm > N)) add('erro', 'horizonte.mes', 'Horizonte da projeção: informe um mês entre 1 e o prazo.');
    }
    return a;
  }

  // ---------------------------------------------------------------------------
  // Regras pendentes e premissas (listas para exibição)
  // ---------------------------------------------------------------------------

  function regrasPendentes(s) {
    const l = [];
    const rc = s.recursos;
    if (s.parcela.modalidade !== 'integral' && s.parcela.recomposicao === 'definir') l.push('Recomposição do saldo/parcelas após o redutor');
    if (s.reajuste.credito.indice === 'definir') l.push('Índice de reajuste do crédito');
    if (s.reajuste.parcela.indice === 'definir') l.push('Índice de reajuste da parcela');
    if (s.plano.seguroAtivo && s.plano.seguroTipo === 'definir') l.push('Forma de cobrança do seguro');
    (s.plano.outrosCustos || []).forEach((oc) => { if ((oc.desc || isNum(num(oc.valor))) && oc.tipo === 'definir') l.push('Forma de cobrança do custo "' + (oc.desc || 'sem descrição') + '"'); });
    if (rc.baseCalculo === 'definir') l.push('Base de cálculo dos percentuais de lance (crédito contratado ou atualizado)');
    if (rc.embutidoTratamento === 'definir') l.push('Tratamento do lance embutido no crédito');
    if (!isNum(num(rc.embutidoLimitePct))) l.push('Limite máximo do lance embutido no grupo');
    if (!isNum(num(rc.lanceLimitePct))) l.push('Limite máximo do lance no grupo (se houver)');
    if (!isNum(num(s.contemplacao.fixo.pct))) l.push('Percentual do lance fixo do grupo');
    if (s.contemplacao.abatimento === 'definir') l.push('Forma de amortização do saldo devedor pelo lance');
    if (!rc.fgtsPermitido) l.push('Permissão e condições de uso do FGTS');
    l.push('Periodicidade e data-base do reajuste (premissa configurável: confirmar com a administradora)');
    l.push('Transferência de obrigações futuras em caso de venda da carta');
    return l;
  }

  function premissas(s) {
    const l = [];
    const rj = s.reajuste;
    const ptx = (c) => { const t = taxaIndice(c); return isNum(t) ? fmtPct(t) + ' por reajuste' : 'taxa não informada'; };
    l.push('Parcela = [(Crédito ÷ Prazo) × (1 − Redutor)] + (Taxa de administração total ÷ Prazo) + (Fundo de reserva total ÷ Prazo).');
    l.push('Reajuste do crédito: ' + nomeIndice(rj.credito) + (rj.credito.indice !== 'definir' ? ' — ' + ptx(rj.credito) : '') + '.');
    l.push('Reajuste da parcela: ' + nomeIndice(rj.parcela) + (rj.parcela.indice !== 'definir' ? ' — ' + ptx(rj.parcela) : '') + '. Parcelas recalculadas sobre o crédito de referência reajustado (fundo comum, taxa de administração e fundo de reserva).');
    l.push('Reajuste a cada ' + (num(rj.periodicidade) || '—') + ' meses, a partir do mês ' + (num(rj.primeiroMes) || '—') + '.');
    if (s.parcela.modalidade !== 'integral') {
      const rec = { definir: 'regra a definir', diluir: 'diluição do percentual não pago nas parcelas restantes após o redutor', manual: 'valor de parcela informado manualmente' }[s.parcela.recomposicao];
      l.push('Redutor de ' + fmtPct(redutorPct(s.parcela), 0) + ' do mês ' + (s.parcela.redIni || 1) + ' ao mês ' + (s.parcela.redFim || '—') + (s.parcela.encerrarNaContemplacao ? ' (ou até a contemplação, se anterior)' : '') + '; recomposição: ' + rec + '.');
    }
    l.push('A parcela do mês da contemplação é considerada paga no total aportado até a contemplação.');
    l.push('O lance embutido não é tratado como aporte do participante: é descontado do crédito conforme a regra configurada.');
    l.push('FGTS: ' + (s.resultado.fgtsTratamento === 'deduzir' ? 'deduzido do resultado como patrimônio do participante' : 'apresentado apenas como informação, sem dedução no resultado') + '.');
    if (s.contemplacao.sorteio.premissa) l.push('Mês hipotético de sorteio: ' + s.contemplacao.sorteio.premissa);
    const mb = s.contemplacao[s.contemplacao.cenarioB];
    if (mb.premissa) l.push('Mês hipotético de lance: ' + mb.premissa);
    if (s.venda.ativa) l.push('Venda da carta: hipótese informada pelo consultor, sem garantia de liquidez ou preço. ' + (s.venda.obs || ''));
    return l;
  }

  // ---------------------------------------------------------------------------
  // Resumo, projeção anual e horizonte
  // ---------------------------------------------------------------------------

  function horizonte(s, cenA, cenB) {
    const N = num(s.plano.prazo);
    const h = s.horizonte;
    if (h.tipo === 'mes') return { ate: num(h.mes), mesC: null, rotulo: 'até o mês ' + (h.mes || '—') };
    if (h.tipo === 'sorteio') return { ate: num(s.contemplacao.sorteio.mes), mesC: num(s.contemplacao.sorteio.mes), rotulo: 'até o mês hipotético de contemplação por sorteio' };
    if (h.tipo === 'lance') { const m = num(s.contemplacao[s.contemplacao.cenarioB].mes); return { ate: m, mesC: m, rotulo: 'até o mês hipotético de contemplação por lance' }; }
    return { ate: N, mesC: null, rotulo: 'prazo total do plano' };
  }

  function projecaoAnual(s, linhas) {
    const C = num(s.plano.credito);
    const anos = [];
    let acum = 0, acumOk = true;
    for (let i = 0; i < linhas.length; i += 12) {
      const bloco = linhas.slice(i, i + 12);
      const ult = bloco[bloco.length - 1];
      const parc = bloco.map((l) => l.parcelaTotal);
      const ok = parc.every(isNum) && bloco.every((l) => isNum(l.totalMes));
      const total = ok ? bloco.reduce((a, l) => a + l.totalMes, 0) : null;
      if (!ok) acumOk = false;
      if (acumOk) acum += total;
      anos.push({
        ano: i / 12 + 1,
        meses: bloco[0].m + '–' + ult.m,
        credito: ult.credAtual,
        parcMin: parc.every(isNum) ? Math.min(...parc) : null,
        parcMax: parc.every(isNum) ? Math.max(...parc) : null,
        total,
        acum: acumOk ? acum : null,
        pctCredito: acumOk && isNum(C) && C > 0 ? (acum / C) * 100 : null
      });
    }
    return anos;
  }

  function resumo(s, crBase, hz) {
    const C = num(s.plano.credito), N = num(s.plano.prazo);
    const R = {};
    const l1 = crBase.linhas[0];
    const r = redutorPct(s.parcela);
    const temRed = s.parcela.modalidade !== 'integral';
    const fr = num(s.plano.frValor), ta = num(s.plano.taxaAdm);

    R.credito = isNum(C) ? V(C, 'informado', 'Valor do crédito desejado', 'Informado pelo consultor') : P('Crédito não informado');
    R.prazo = isNum(N) ? V(N, 'informado', 'Prazo total em meses', 'Informado pelo consultor') : P('Prazo não informado');
    R.taxaAdm = isNum(ta) && isNum(C) ? V(ta / 100 * C, 'calculado', 'Taxa adm. total = ' + fmtPct(ta) + ' × ' + fmtBRL(C), 'Percentual informado; incidência sobre o crédito conforme fórmula da parcela', { pct: ta }) : P('Taxa de administração ou crédito não informados');
    R.fundoReserva = isNum(fr) && isNum(C)
      ? (s.plano.frTipo === 'valor' ? V(fr, 'informado', 'Fundo de reserva total informado em R$', 'Consultor', { pct: C > 0 ? fr / C * 100 : null }) : V(fr / 100 * C, 'calculado', 'Fundo de reserva total = ' + fmtPct(fr) + ' × ' + fmtBRL(C), 'Percentual informado', { pct: fr }))
      : P('Fundo de reserva ou crédito não informados');

    const pInt = parcelaFormula(s, 0);
    R.parcelaIntegral = isNum(pInt)
      ? V(pInt, 'calculado', 'Parcela integral = (' + fmtBRL(C) + ' ÷ ' + N + ') + (' + fmtBRL(R.taxaAdm.v) + ' ÷ ' + N + ') + (' + fmtBRL(R.fundoReserva.v) + ' ÷ ' + N + ')', 'Fórmula informada; valores na data-base, sem seguro e sem reajuste')
      : P('Crédito, prazo, taxa de administração e fundo de reserva são necessários');
    if (temRed) {
      const pRed = isNum(r) ? parcelaFormula(s, r) : null;
      R.parcelaRedutor = isNum(pRed)
        ? V(pRed, 'calculado', 'Parcela com redutor = (' + fmtBRL(C) + ' ÷ ' + N + ') × (1 − ' + fmtPct(r, 0) + ') + (' + fmtBRL(R.taxaAdm.v) + ' ÷ ' + N + ') + (' + fmtBRL(R.fundoReserva.v) + ' ÷ ' + N + ')', 'Fórmula informada; data-base, sem seguro')
        : P('Percentual do redutor e dados do plano são necessários');
      const pos = crBase.linhas.find((l) => l.posRed);
      if (!pos) R.parcelaPosRedutor = isNum(num(s.parcela.redFim)) ? V(null, 'na', 'Sem meses após o redutor no prazo', '') : P('Período do redutor não informado');
      else if (isNum(pos.parcela)) R.parcelaPosRedutor = V(pos.parcela / (pos.fp || 1), 'calculado', s.parcela.recomposicao === 'diluir'
        ? 'Parcela após o redutor = Crédito × [1/Prazo + Redutor × meses com redutor ÷ (Prazo × meses restantes)] + Taxa adm./Prazo + Fundo de reserva/Prazo (valores na data-base)'
        : 'Valor informado manualmente pelo consultor (data-base)', 'Regra de recomposição configurada; ' + pos.rotulo + ' em diante')
      else R.parcelaPosRedutor = P(pos.pend, 'Depende da regra de recomposição');
    }

    R.parcelaInicial = l1 && isNum(l1.parcelaTotal)
      ? V(l1.parcelaTotal, 'calculado', 'Parcela do mês 1 = Fundo comum ' + fmtBRL(l1.fundoComum) + ' + Taxa adm. ' + fmtBRL(l1.taxa) + ' + Fundo de reserva ' + fmtBRL(l1.fundo) + ' + Seguro ' + fmtBRL(l1.seguro), 'Demonstrativo mensal (mês 1)')
      : P(l1 ? l1.pend : ['Dados do plano incompletos'], 'Parcela do mês 1');

    const s1 = l1 ? l1.seguro : null;
    R.seguro = !s.plano.seguroAtivo ? V(0, 'informado', 'Seguro não contratado na simulação', 'Consultor')
      : isNum(s1) ? V(s1, s.plano.seguroTipo === 'fixo' ? 'informado' : 'calculado', s.plano.seguroTipo === 'fixo' ? 'Seguro mensal = valor fixo informado' : 'Seguro mensal = ' + fmtPct(num(s.plano.seguroValor)) + ' × crédito atualizado', 'Regra configurada pelo consultor')
      : P(l1 ? l1.pend.filter((x) => /Seguro/.test(x)) : [], 'Seguro');

    const ate = hz.ate;
    if (!isNum(ate) || ate < 1 || !isNum(N) || ate > N) R.totalPago = P('Horizonte da projeção não definido ou inválido (' + hz.rotulo + ')');
    else {
      const sm = somar(crBase.linhas, 1, ate, 'totalMes');
      R.totalPago = sm.v === null ? P(sm.pend, 'Σ (parcela + seguro + outros custos) meses 1..' + ate)
        : V(sm.v, 'estimado', 'Σ (parcela + seguro + outros custos) dos meses 1 a ' + ate + ' (' + hz.rotulo + ')', 'Demonstrativo mensal', { nota: MSG.estimado });
    }
    const so = isNum(ate) && ate >= 1 && isNum(N) && ate <= N ? somar(crBase.linhas, 1, ate, 'outros') : { v: null, pend: [] };
    R.outrosCustos = so.v === null ? P(so.pend.length ? so.pend : ['Horizonte inválido'], 'Σ outros custos') : V(so.v, 'estimado', 'Σ outros custos dos meses 1 a ' + ate, 'Outros custos configurados');
    return R;
  }

  // ---------------------------------------------------------------------------
  // Função principal
  // ---------------------------------------------------------------------------

  function simular(s) {
    const validacoes = validar(s);
    const cenA = cenario(s, 'sorteio');
    const cenB = cenario(s, 'lance');
    const hz = horizonte(s, cenA, cenB);
    const crBase = cronograma(s, hz.mesC);
    const res = resumo(s, crBase, hz);
    const alertas = validacoes.concat(cenA.alertas.map((x) => Object.assign({ campo: 'cenarioA' }, x)), cenB.alertas.map((x) => Object.assign({ campo: 'cenarioB' }, x)));
    return {
      validacoes: alertas,
      resumo: res,
      horizonte: hz,
      cronograma: crBase,
      anual: projecaoAnual(s, crBase.linhas),
      cenarioA: cenA,
      cenarioB: cenB,
      pendentes: regrasPendentes(s),
      premissas: premissas(s),
      redutorPct: redutorPct(s.parcela)
    };
  }

  return {
    INDICES, MODALIDADES_PARCELA, MSG,
    estadoPadrao, simular, cronograma, cenario, calcularLance, validar, fatorReajuste, qtdReajustes,
    parcelaFormula, redutorPct, somar, nomeIndice, taxaIndice, rotuloMes,
    fmtBRL, fmtPct, fmtNum, num, isNum, r2
  };
});
