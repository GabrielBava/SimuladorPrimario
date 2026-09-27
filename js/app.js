/* Interface do simulador: vincula o menu lateral ao estado, chama o motor de
 * cálculo (Calc) e desenha resultados, memórias de cálculo e a proposta em PDF. */
(function () {
  'use strict';

  const C = window.Calc;
  const CHAVE_PADRAO = 'simconsorcio.padrao';
  const CHAVE_ATUAL = 'simconsorcio.atual';
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  // ---------------------------------------------------------------------------
  // Estado e persistência (localStorage apenas como conveniência local)
  // ---------------------------------------------------------------------------

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function mesclar(base, extra) {
    if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
    if (base && typeof base === 'object') {
      const out = {};
      for (const k of Object.keys(base)) out[k] = extra && k in extra ? mesclar(base[k], extra[k]) : base[k];
      return out;
    }
    return extra === undefined ? base : extra;
  }

  function ler(chave) {
    try { const t = localStorage.getItem(chave); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch (e) { return false; }
  }

  const padraoSalvo = () => mesclar(C.estadoPadrao(), ler(CHAVE_PADRAO) || {});
  let estado = mesclar(C.estadoPadrao(), ler(CHAVE_ATUAL) || ler(CHAVE_PADRAO) || {});
  const abertos = new Set(['memo-geral']);

  function obter(caminho) { return caminho.split('.').reduce((o, k) => (o == null ? o : o[k]), estado); }
  function definir(caminho, valor) {
    const ks = caminho.split('.');
    let o = estado;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = valor;
  }

  // ---------------------------------------------------------------------------
  // Utilitários de exibição
  // ---------------------------------------------------------------------------

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOMES_TIPO = { informado: 'Informado', calculado: 'Calculado', estimado: 'Estimado', pendente: 'Pendente', na: 'Não aplicável' };
  const tag = (tipo) => '<span class="tag t-' + tipo + '">' + (NOMES_TIPO[tipo] || tipo) + '</span>';

  function fmt(val, formato) {
    if (val == null || val.v == null) {
      if (val && val.tipo === 'na') return '<span class="na">' + esc(val.nota || val.formula || '—') + '</span>';
      const pend = (val && val.pend) || [];
      const regra = pend.some((p) => /definir|Regra/i.test(p));
      return '<span class="nc">Não calculado: ' + (regra ? 'depende de regra a definir' : 'dado não informado') + '</span>';
    }
    if (formato === 'txt') return esc(val.v);
    if (formato === 'int') return C.fmtNum(val.v, 0);
    if (formato === 'pct') return C.fmtPct(val.v);
    if (formato === 'meses') return C.fmtNum(val.v, 0) + ' meses';
    return C.fmtBRL(val.v);
  }

  function memoria(val, id, pdf) {
    if (!val) return '';
    const partes = [];
    if (val.formula) partes.push('<div><b>Fórmula / valores:</b> <span class="pre">' + esc(val.formula) + '</span></div>');
    if (val.origem) partes.push('<div><b>Origem:</b> ' + esc(val.origem) + '</div>');
    if (val.nota) partes.push('<div><b>Observação:</b> ' + esc(val.nota) + '</div>');
    if (val.pend && val.pend.length) partes.push('<div><b>Depende de:</b><ul>' + val.pend.slice(0, 6).map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></div>');
    if (!partes.length) return '';
    if (pdf) return '<div class="memo-pdf">' + partes.join('') + '</div>';
    return '<details class="memo" data-id="' + id + '"' + (abertos.has(id) ? ' open' : '') + '><summary>memória</summary>' + partes.join('') + '</details>';
  }

  function linhaTabela(rotulo, val, formato, id, pdf) {
    return '<tr><th scope="row">' + rotulo + '</th><td class="num">' + fmt(val, formato) + '</td><td>' + tag(val ? val.tipo : 'pendente') + '</td><td class="col-memo">' + memoria(val, id, pdf) + '</td></tr>';
  }

  // ---------------------------------------------------------------------------
  // Menu lateral: preenchimento, leitura, visibilidade e listas
  // ---------------------------------------------------------------------------

  function preencherIndices() {
    const opts = Object.entries(C.INDICES).map(([k, v]) => '<option value="' + k + '">' + esc(v.nome) + '</option>').join('');
    $$('.sel-indice').forEach((s) => { s.innerHTML = opts; });
  }

  function escreverCampos() {
    $$('[data-k]').forEach((el) => {
      const v = obter(el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v == null ? '' : v;
    });
    desenharListas();
    aplicarVisibilidade();
  }

  function lerCampo(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? null : Number(el.value);
    return el.value;
  }

  function avaliarCondicao(expr) {
    if (expr.startsWith('!')) return !obter(expr.slice(1));
    const m = expr.match(/^([\w.]+)(!=|=)(.+)$/);
    if (!m) return !!obter(expr);
    const val = String(obter(m[1]));
    const lista = m[3].split('|');
    return m[2] === '=' ? lista.includes(val) : !lista.includes(val);
  }

  function aplicarVisibilidade() {
    $$('[data-show]').forEach((el) => { el.hidden = !avaliarCondicao(el.dataset.show); });
  }

  const LISTAS = {
    'plano.outrosCustos': {
      novo: () => ({ desc: '', tipo: 'definir', valor: null, mes: null }),
      html: (it, i) =>
        '<div class="item-lista">' +
        '<input type="text" placeholder="Descrição" maxlength="60" data-li="' + i + '" data-f="desc" value="' + esc(it.desc) + '">' +
        '<select data-li="' + i + '" data-f="tipo">' +
        [['definir', 'Regra a definir'], ['unico', 'Único (em um mês)'], ['mensal', 'Mensal fixo']].map(([v, t]) => '<option value="' + v + '"' + (it.tipo === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select>' +
        '<input type="number" placeholder="R$" min="0" step="any" data-li="' + i + '" data-f="valor" value="' + (it.valor == null ? '' : it.valor) + '">' +
        (it.tipo === 'unico' ? '<input type="number" placeholder="Mês" min="1" step="1" data-li="' + i + '" data-f="mes" value="' + (it.mes == null ? '' : it.mes) + '">' : '') +
        '<button type="button" class="mini" data-del="' + i + '" aria-label="Remover">×</button></div>'
    },
    'resultado.fluxos': {
      novo: () => ({ desc: '', valor: null }),
      html: (it, i) =>
        '<div class="item-lista">' +
        '<input type="text" placeholder="Descrição" maxlength="60" data-li="' + i + '" data-f="desc" value="' + esc(it.desc) + '">' +
        '<input type="number" placeholder="R$ (+/−)" step="any" data-li="' + i + '" data-f="valor" value="' + (it.valor == null ? '' : it.valor) + '">' +
        '<button type="button" class="mini" data-del="' + i + '" aria-label="Remover">×</button></div>'
    }
  };

  function desenharListas() {
    $$('[data-lista]').forEach((cont) => {
      const cfg = LISTAS[cont.dataset.lista];
      const itens = obter(cont.dataset.lista) || [];
      cont.innerHTML = itens.length ? itens.map(cfg.html).join('') : '<small class="nota">Nenhum item cadastrado.</small>';
    });
  }

  function ligarMenu() {
    const sb = $('#sidebar');
    const aoAlterar = (ev) => {
      const el = ev.target;
      if (el.dataset.k) {
        definir(el.dataset.k, lerCampo(el));
        aplicarVisibilidade();
      } else if (el.dataset.li !== undefined) {
        const caminho = el.closest('[data-lista]').dataset.lista;
        const item = obter(caminho)[Number(el.dataset.li)];
        item[el.dataset.f] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
        if (el.dataset.f === 'tipo' && ev.type === 'change') desenharListas();
      } else return;
      atualizar();
    };
    sb.addEventListener('input', aoAlterar);
    sb.addEventListener('change', aoAlterar);
    sb.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.add) {
        obter(b.dataset.add).push(LISTAS[b.dataset.add].novo());
        desenharListas(); atualizar();
      } else if (b.dataset.del !== undefined) {
        const caminho = b.closest('[data-lista]').dataset.lista;
        obter(caminho).splice(Number(b.dataset.del), 1);
        desenharListas(); atualizar();
      } else if (b.dataset.acao) acoes[b.dataset.acao]();
    });
    $('#arquivoImportar').addEventListener('change', importarArquivo);
    document.addEventListener('toggle', (ev) => {
      const d = ev.target;
      if (d.matches && d.matches('details[data-id]')) { if (d.open) abertos.add(d.dataset.id); else abertos.delete(d.dataset.id); }
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Ações da barra de ferramentas
  // ---------------------------------------------------------------------------

  function exemplo() {
    // Valores fictícios, apenas para demonstrar o funcionamento. Não são regras de nenhuma administradora.
    const s = C.estadoPadrao();
    Object.assign(s.plano, { lead: 'Exemplo ilustrativo', administradora: '', grupo: '', credito: 300000, prazo: 200, mesInicial: '', taxaAdm: 18, frTipo: 'pct', frValor: 2 });
    Object.assign(s.parcela, { modalidade: 'r50', redIni: 1, redFim: 12, recomposicao: 'diluir' });
    s.reajuste.credito.indice = 'pre5';
    s.reajuste.parcela.indice = 'pre5';
    Object.assign(s.recursos, { embutidoTipo: 'pct', embutidoValor: 20, embutidoEmLivre: true, embutidoTratamento: 'descontar', baseCalculo: 'contratado', embutidoLimitePct: 25 });
    Object.assign(s.contemplacao.sorteio, { mes: 36, premissa: 'Hipótese ilustrativa escolhida pelo consultor' });
    Object.assign(s.contemplacao.livre, { tipo: 'pct', valor: 35, mes: 12, premissa: 'Hipótese ilustrativa escolhida pelo consultor' });
    Object.assign(s.venda, { ativa: true, base: 'pct_liquido', pct: 25, comissaoPct: 0, custosFixos: 0, obs: 'Percentual hipotético, sem referência de mercado.' });
    return s;
  }

  const acoes = {
    nova() {
      if (!confirm('Iniciar uma nova simulação? Os campos voltarão às configurações padrão salvas.')) return;
      estado = padraoSalvo();
      estado.plano.lead = '';
      escreverCampos(); atualizar();
    },
    salvarPadrao() {
      const p = clone(estado);
      p.plano.lead = '';
      alert(gravar(CHAVE_PADRAO, p) ? 'Configuração atual salva como padrão (sem o nome do lead).' : 'Não foi possível salvar neste navegador.');
    },
    fabrica() {
      if (!confirm('Restaurar o padrão de fábrica? O padrão salvo será apagado.')) return;
      try { localStorage.removeItem(CHAVE_PADRAO); } catch (e) { /* sem armazenamento */ }
      estado = C.estadoPadrao();
      escreverCampos(); atualizar();
    },
    exemplo() {
      if (!confirm('Carregar um exemplo com valores fictícios? Os campos atuais serão substituídos.')) return;
      estado = exemplo();
      escreverCampos(); atualizar();
    },
    exportar() {
      const blob = new Blob([JSON.stringify({ versao: 1, gerado: new Date().toISOString(), estado }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'simulacao_' + nomeArquivo(estado.plano.lead) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    importar() { $('#arquivoImportar').click(); },
    pdf: gerarPdf
  };

  function importarArquivo(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    f.text().then((t) => {
      const dados = JSON.parse(t);
      estado = mesclar(C.estadoPadrao(), dados.estado || dados);
      escreverCampos(); atualizar();
    }).catch(() => alert('Arquivo inválido.')).finally(() => { ev.target.value = ''; });
  }

  const nomeArquivo = (t) => (String(t || 'sem_nome').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'sem_nome');

  // ---------------------------------------------------------------------------
  // Área de resultados
  // ---------------------------------------------------------------------------

  const AVISO = 'Esta simulação depende dos dados do grupo, do contrato, das regras da administradora e das premissas inseridas. Os valores são estimativas e não constituem valores contratuais. Não há garantia de contemplação, venda, lucro, valorização ou rentabilidade.';

  function secAlertas(r) {
    const grupos = { erro: [], alerta: [], info: [] };
    r.validacoes.forEach((v) => grupos[v.nivel].push(v.msg));
    const bloco = (nivel, titulo) => grupos[nivel].length
      ? '<details class="alertas a-' + nivel + '" data-id="al-' + nivel + '"' + (nivel !== 'info' || abertos.has('al-' + nivel) ? ' open' : '') + '><summary>' + titulo + ' (' + grupos[nivel].length + ')</summary><ul>' + Array.from(new Set(grupos[nivel])).map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul></details>'
      : '';
    return '<section class="bloco-res">' + bloco('erro', 'Erros de preenchimento') + bloco('alerta', 'Alertas e regras a definir') + bloco('info', 'Informações') +
      (!r.validacoes.length ? '<p class="ok">Nenhuma pendência de validação.</p>' : '') + '</section>';
  }

  function cartao(rotulo, val, formato, id, extra) {
    return '<div class="cartao"><div class="c-rot">' + rotulo + '</div><div class="c-val">' + fmt(val, formato) + '</div><div class="c-rod">' + tag(val ? val.tipo : 'pendente') + (extra || '') + '</div>' + memoria(val, id) + '</div>';
  }

  function textoRedutor(s, r) {
    if (s.parcela.modalidade === 'integral') return 'Não aplicado (parcela integral)';
    const fim = s.parcela.redFim ? 'até o mês ' + s.parcela.redFim : 'fim não informado';
    return C.fmtPct(r.redutorPct, 0) + ' do mês ' + (s.parcela.redIni || 1) + ' ' + fim + (s.parcela.encerrarNaContemplacao ? ' (ou até a contemplação)' : '');
  }

  function textoIndice(cfg) {
    const t = C.taxaIndice(cfg);
    return C.nomeIndice(cfg) + (cfg.indice === 'definir' ? '' : C.isNum(t) ? ' — ' + C.fmtPct(t) + ' por reajuste' + (['ipca', 'incc', 'inpc', 'outro'].includes(cfg.indice) ? ' (estimado)' : '') : ' — taxa não informada');
  }

  function secResumo(s, r) {
    const R = r.resumo;
    const temRed = s.parcela.modalidade !== 'integral';
    const txt = (t, tipo) => ({ v: t, tipo: tipo || 'informado', formula: '', pend: [] });
    let h = '<section class="bloco-res"><h2>Resumo</h2><div class="cartoes">';
    h += cartao('Crédito contratado', R.credito, 'brl', 'r-cred');
    h += cartao('Prazo total', R.prazo, 'meses', 'r-prazo');
    h += cartao('Parcela inicial estimada', R.parcelaInicial, 'brl', 'r-pini', ' <small>com seguro</small>');
    if (temRed) {
      h += cartao('Parcela com redutor aplicado', R.parcelaRedutor, 'brl', 'r-pred', ' <small>data-base, sem seguro</small>');
      h += cartao('Parcela após o redutor', R.parcelaPosRedutor, 'brl', 'r-ppos', ' <small>data-base, sem seguro</small>');
    }
    h += cartao('Redutor e período', txt(textoRedutor(s, r), temRed ? 'informado' : 'na'), 'txt', 'r-redp');
    h += cartao('Parcela integral estimada', R.parcelaIntegral, 'brl', 'r-pint', ' <small>data-base, sem seguro</small>');
    h += cartao('Taxa de administração', R.taxaAdm, 'brl', 'r-ta', R.taxaAdm.pct != null ? ' <small>' + C.fmtPct(R.taxaAdm.pct) + '</small>' : '');
    h += cartao('Fundo de reserva', R.fundoReserva, 'brl', 'r-fr', R.fundoReserva.pct != null ? ' <small>' + C.fmtPct(R.fundoReserva.pct) + '</small>' : '');
    h += cartao('Seguro (mês 1)', R.seguro, 'brl', 'r-seg');
    h += cartao('Outros custos no horizonte', R.outrosCustos, 'brl', 'r-outros');
    h += cartao('Reajuste do crédito', txt(textoIndice(s.reajuste.credito), s.reajuste.credito.indice === 'definir' ? 'pendente' : 'informado'), 'txt', 'r-rc');
    h += cartao('Reajuste da parcela', txt(textoIndice(s.reajuste.parcela), s.reajuste.parcela.indice === 'definir' ? 'pendente' : 'informado'), 'txt', 'r-rp');
    h += cartao('Total estimado pago (' + esc(r.horizonte.rotulo) + ')', R.totalPago, 'brl', 'r-total');
    h += '</div>';
    h += '<details class="memo" data-id="r-prem"' + (abertos.has('r-prem') ? ' open' : '') + '><summary>Premissas principais utilizadas</summary><ul>' + r.premissas.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></details>';
    return h + '</section>';
  }

  function tabelaResumoGeral(s, r, pdf) {
    const R = r.resumo;
    const txt = (t, tipo) => ({ v: t, tipo: tipo || 'informado', formula: '', pend: [] });
    const outros = (s.plano.outrosCustos || []).filter((o) => o.desc || C.isNum(o.valor));
    const tipoOutro = { definir: 'regra a definir', unico: 'único', mensal: 'mensal' };
    const linhas = [
      ['Valor do crédito', R.credito, 'brl'],
      ['Prazo', R.prazo, 'meses'],
      ['Taxa de administração' + (R.taxaAdm.pct != null ? ' (' + C.fmtPct(R.taxaAdm.pct) + ')' : ''), R.taxaAdm, 'brl'],
      ['Fundo de reserva' + (R.fundoReserva.pct != null ? ' (' + C.fmtPct(R.fundoReserva.pct) + ')' : ''), R.fundoReserva, 'brl'],
      ['Seguro', s.plano.seguroAtivo ? R.seguro : txt('Não contratado'), s.plano.seguroAtivo ? 'brl' : 'txt'],
      ['Outros custos', txt(outros.length ? outros.map((o) => (o.desc || 'Sem descrição') + ': ' + C.fmtBRL(o.valor) + ' (' + tipoOutro[o.tipo] + (o.tipo === 'unico' ? ', mês ' + (o.mes || '—') : '') + ')').join('; ') : 'Nenhum informado'), 'txt'],
      ['Modalidade de parcela', txt((C.MODALIDADES_PARCELA[s.parcela.modalidade] || {}).nome), 'txt'],
      ['Redutor e período de aplicação', txt(textoRedutor(s, r), s.parcela.modalidade === 'integral' ? 'na' : 'informado'), 'txt'],
      ['Índice de reajuste do crédito', txt(textoIndice(s.reajuste.credito), s.reajuste.credito.indice === 'definir' ? 'pendente' : 'informado'), 'txt'],
      ['Índice de reajuste da parcela', txt(textoIndice(s.reajuste.parcela), s.reajuste.parcela.indice === 'definir' ? 'pendente' : 'informado'), 'txt'],
      ['Parcela inicial estimada', R.parcelaInicial, 'brl'],
      ['Parcela integral estimada (data-base)', R.parcelaIntegral, 'brl']
    ];
    if (s.parcela.modalidade !== 'integral') {
      linhas.push(['Parcela com redutor (data-base)', R.parcelaRedutor, 'brl']);
      linhas.push(['Parcela após o redutor (data-base)', R.parcelaPosRedutor, 'brl']);
    }
    linhas.push(['Total estimado de parcelas — ' + esc(r.horizonte.rotulo), R.totalPago, 'brl']);
    return '<table class="tab"><thead><tr><th>Item</th><th>Valor</th><th>Tipo</th><th class="col-memo">Memória</th></tr></thead><tbody>' +
      linhas.map((l, i) => linhaTabela(l[0], l[1], l[2], 'rg-' + i, pdf)).join('') + '</tbody></table>';
  }

  function tabelaAnual(r) {
    if (!r.anual.length) return '<p class="nc">Projeção anual não disponível: informe crédito e prazo.</p>';
    const f = (x) => (C.isNum(x) ? C.fmtBRL(x) : '<span class="nc">Não calculado</span>');
    return '<table class="tab tab-num"><thead><tr><th>Ano</th><th>Meses</th><th>Crédito atualizado (fim do ano)</th><th>Parcela mín.</th><th>Parcela máx.</th><th>Total pago no ano</th><th>Acumulado</th><th>% do crédito contratado</th></tr></thead><tbody>' +
      r.anual.map((a) => '<tr><td>' + a.ano + '</td><td>' + a.meses + '</td><td>' + f(a.credito) + '</td><td>' + f(a.parcMin) + '</td><td>' + f(a.parcMax) + '</td><td>' + f(a.total) + '</td><td>' + f(a.acum) + '</td><td>' + (C.isNum(a.pctCredito) ? C.fmtPct(a.pctCredito, 2) : '—') + '</td></tr>').join('') +
      '</tbody></table><small class="nota">Valores estimados: incluem parcela, seguro e outros custos; dependem das premissas de reajuste e das regras informadas.</small>';
  }

  function secResumoGeral(s, r) {
    return '<section class="bloco-res"><h2>Resumo geral da proposta</h2>' + tabelaResumoGeral(s, r, false) +
      '<h3>Projeção por ano</h3>' + tabelaAnual(r) +
      '<h3>Premissas usadas</h3><ul class="premissas">' + r.premissas.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></section>';
  }

  function composicaoLance(s, mod) {
    const st = clone(s);
    st.contemplacao.cenarioB = mod;
    const cen = C.cenario(st, 'lance');
    if (!cen.ok) return '<p class="nc">' + esc(cen.motivo) + '</p>';
    const L = cen.linhas;
    return '<table class="tab mini-tab"><tbody>' +
      linhaTabela('Recursos próprios (dinheiro)', L.proprios, 'brl', 'cl-' + mod + '-p') +
      linhaTabela('FGTS (recurso próprio)', L.fgts, 'brl', 'cl-' + mod + '-f') +
      linhaTabela('Lance embutido', L.embutido, 'brl', 'cl-' + mod + '-e') +
      linhaTabela('<b>Total ofertado</b>', L.lance, 'brl', 'cl-' + mod + '-t') +
      linhaTabela('Crédito bruto na contemplação', L.credBruto, 'brl', 'cl-' + mod + '-b') +
      linhaTabela('Crédito líquido após o embutido', L.credLiquido, 'brl', 'cl-' + mod + '-l') +
      '</tbody></table>';
  }

  function textoModalidades(s, pdf) {
    const ct = s.contemplacao;
    const disp = (d) => (d ? 'Disponível no grupo (informado)' : 'Não indicado como disponível');
    const obs = (o) => (o ? '<p><b>Observações:</b> ' + esc(o) + '</p>' : '');
    const livre = ct.livre;
    let h = '<div class="modalidades">';
    h += '<div class="modal"><h3>Sorteio</h3><p>' + disp(ct.sorteio.disponivel) + '.</p><p>O cenário de sorteio representa uma hipótese de contemplação. A ocorrência depende das regras do grupo e dos resultados efetivos das assembleias; não há mês garantido.</p>' +
      '<p><b>Mês hipotético:</b> ' + (ct.sorteio.mes || 'não informado') + ' — <b>Premissa:</b> ' + esc(ct.sorteio.premissa || 'não informada') + '</p>' + obs(ct.sorteio.obs) + '</div>';
    h += '<div class="modal"><h3>Lance fixo</h3><p>' + disp(ct.fixo.disponivel) + '.</p><p><b>Regra/percentual configurado:</b> ' + (C.isNum(ct.fixo.pct) ? C.fmtPct(ct.fixo.pct) : 'Regra a definir') +
      ' — <b>Base:</b> ' + ({ definir: 'regra a definir', contratado: 'crédito contratado', atualizado: 'crédito atualizado' })[s.recursos.baseCalculo] + '</p>' +
      (pdf ? '' : composicaoLance(s, 'fixo')) + '<p>O lance embutido, quando utilizado, reduz o crédito disponível conforme a regra configurada; ele não sai do bolso do participante.</p>' + obs(ct.fixo.obs) + '</div>';
    h += '<div class="modal"><h3>Lance livre</h3><p>' + disp(livre.disponivel) + '.</p><p><b>Valor/percentual ofertado:</b> ' + (C.isNum(livre.valor) ? (livre.tipo === 'pct' ? C.fmtPct(livre.valor) : C.fmtBRL(livre.valor)) : 'não informado') + '</p>' +
      (pdf ? '' : composicaoLance(s, 'livre')) +
      '<p><b>Premissa para o mês estimado:</b> ' + esc(livre.premissa || 'não informada') + '</p><p class="aviso-inline">O resultado depende das regras do grupo e dos demais lances ofertados. Nenhum valor ofertado assegura contemplação.</p>' + obs(livre.obs) + '</div>';
    if (s.recursos.regrasGrupo) h += '<div class="modal"><h3>Regras específicas do grupo</h3><p>' + esc(s.recursos.regrasGrupo) + '</p></div>';
    return h + '</div>';
  }

  const LINHAS_CEN = [
    ['mes', 'Mês da contemplação (hipotético)', 'txt'],
    ['credito', 'Valor do crédito contratado', 'brl'],
    ['credBruto', 'Crédito bruto na contemplação', 'brl'],
    ['embutido', 'Valor do lance embutido', 'brl'],
    ['credLiquido', 'Crédito líquido disponível', 'brl'],
    ['parcelaMes', 'Parcela estimada no mês da contemplação', 'brl'],
    ['qtdParcelas', 'Parcelas pagas até a contemplação (qtde.)', 'int'],
    ['totalParcelas', 'Total de parcelas aportadas até a contemplação', 'brl'],
    ['lance', 'Lance ofertado', 'brl'],
    ['proprios', 'Recursos próprios utilizados (dinheiro)', 'brl'],
    ['fgts', 'FGTS utilizado', 'brl'],
    ['embutidoUsado', 'Valor embutido utilizado (sai do crédito)', 'brl'],
    ['outrosPagos', 'Outros custos pagos até a contemplação', 'brl'],
    ['totalAportado', 'Total aportado pelo participante (inclui FGTS)', 'brl'],
    ['desembolsoDinheiro', '… dos quais em dinheiro (sem FGTS)', 'brl'],
    ['vendaBruta', 'Valor bruto estimado de venda da carta', 'brl'],
    ['vendaCustos', 'Custos ou descontos estimados na venda', 'brl'],
    ['vendaLiquida', 'Valor líquido estimado da venda', 'brl'],
    ['resultado', 'Resultado financeiro estimado', 'brl'],
    ['obrigacoes', 'Saldo / obrigações futuras estimadas', 'brl']
  ];

  function tabelaCenario(cen, id, pdf) {
    let h = '<div class="cenario"><h3>' + esc(cen.titulo) + (cen.tipo === 'lance' ? ' <small>(' + esc(cen.nomeMod) + ')</small>' : '') + '</h3>';
    if (!cen.ok) return h + '<p class="nc">' + esc(cen.motivo) + '</p></div>';
    h += '<table class="tab"><thead><tr><th>Item</th><th>Valor</th><th>Tipo</th><th class="col-memo">Memória</th></tr></thead><tbody>';
    h += LINHAS_CEN.map(([k, rot, f]) => {
      const destaque = k === 'resultado' ? ' class="destaque"' : '';
      return linhaTabela(destaque ? '<b>' + rot + '</b>' : rot, cen.linhas[k], f, id + '-' + k, pdf).replace('<tr>', '<tr' + destaque + '>');
    }).join('');
    h += '</tbody></table>';
    if (cen.componentes && cen.componentes.length) {
      h += '<div class="componentes"><b>Composição do resultado:</b><ul>' + cen.componentes.map((c) => '<li>' + (c.sinal > 0 ? '(+) ' : '(−) ') + esc(c.nome) + ': ' + (C.isNum(c.val.v) ? C.fmtBRL(c.val.v) : '<span class="nc">não calculado</span>') + '</li>').join('') + '</ul></div>';
    }
    h += '<p class="aviso-inline">' + esc(C.MSG.mesHipotetico) + ' ' + esc(C.MSG.estimado) + '</p>';
    if (cen.tipo === 'lance') h += '<p class="nota">Contabilização: recursos próprios e FGTS saem do participante e entram no total aportado; o lance embutido é descontado do crédito bruto (crédito líquido) e não é somado ao aporte, evitando dupla contagem.</p>';
    return h + '</div>';
  }

  function tabelaMensal(r) {
    const L = r.cronograma.linhas;
    if (!L.length) return '<p class="nc">Informe crédito e prazo.</p>';
    const f = (x) => (C.isNum(x) ? C.fmtBRL(x) : '<span class="nc">n/c</span>');
    return '<div class="rolagem"><table class="tab tab-num"><thead><tr><th>Mês</th><th>Crédito atualizado</th><th>Fundo comum</th><th>Taxa adm.</th><th>F. reserva</th><th>Parcela</th><th>Seguro</th><th>Outros</th><th>Total do mês</th><th>Situação</th></tr></thead><tbody>' +
      L.map((l) => '<tr><td>' + esc(l.rotulo) + '</td><td>' + f(l.credAtual) + '</td><td>' + f(l.fundoComum) + '</td><td>' + f(l.taxa) + '</td><td>' + f(l.fundo) + '</td><td>' + f(l.parcela) + '</td><td>' + f(l.seguro) + '</td><td>' + f(l.outros) + '</td><td>' + f(l.totalMes) + '</td><td class="sit">' +
        (l.reduzido ? 'Redutor' : l.posRed ? 'Após redutor' : '') + (l.pend.length ? ' <span class="nc" title="' + esc(l.pend.join(' | ')) + '">pendente</span>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function secPendentes(r) {
    return '<ul class="pendentes">' + r.pendentes.map((p) => '<li>' + tag('pendente') + ' ' + esc(p) + '</li>').join('') + '</ul>';
  }

  function desenhar(r) {
    const s = estado;
    let h = '<header class="topo"><h1>Simulação de consórcio' + (s.plano.lead ? ' — ' + esc(s.plano.lead) : '') + '</h1><p class="aviso">' + esc(AVISO) + '</p>' +
      '<p class="legenda">Legenda: ' + ['informado', 'calculado', 'estimado', 'pendente', 'na'].map(tag).join(' ') + '</p></header>';
    h += secAlertas(r);
    h += secResumo(s, r);
    h += secResumoGeral(s, r);
    h += '<section class="bloco-res"><h2>Modalidades de contemplação</h2>' + textoModalidades(s, false) + '</section>';
    h += '<section class="bloco-res"><h2>Tabelas de alavancagem financeira (cenários hipotéticos)</h2><div class="cenarios">' + tabelaCenario(r.cenarioA, 'ca', false) + tabelaCenario(r.cenarioB, 'cb', false) + '</div></section>';
    h += '<section class="bloco-res"><details class="memo-sec" data-id="mensal"' + (abertos.has('mensal') ? ' open' : '') + '><summary><h2>Demonstrativo mensal (memória detalhada)</h2></summary>' + tabelaMensal(r) + '</details></section>';
    h += '<section class="bloco-res"><h2>Regras pendentes de definição</h2>' + secPendentes(r) + '</section>';
    h += '<footer class="rodape"><p>' + esc(AVISO) + '</p></footer>';
    const principal = $('#principal');
    const rolagem = principal.scrollTop;
    principal.innerHTML = h;
    principal.scrollTop = rolagem;
  }

  // ---------------------------------------------------------------------------
  // Proposta em PDF (impressão do navegador → "Salvar como PDF")
  // ---------------------------------------------------------------------------

  function gerarPdf() {
    const s = estado;
    const r = C.simular(s);
    const lead = String(s.plano.lead || '').trim();
    if (!lead) { alert('Informe o nome do lead ou a identificação da simulação antes de gerar a proposta.'); return; }
    const erros = r.validacoes.filter((v) => v.nivel === 'erro');
    if (erros.length && !confirm('Há ' + erros.length + ' erro(s) de preenchimento. Os itens afetados aparecerão como "Não calculado". Gerar mesmo assim?')) return;
    const data = new Date().toLocaleDateString('pt-BR');
    const ident = [s.plano.administradora && 'Administradora: ' + esc(s.plano.administradora), s.plano.grupo && 'Grupo: ' + esc(s.plano.grupo)].filter(Boolean).join(' · ');
    let h = '<header class="p-topo"><h1>Proposta de simulação — Consórcio</h1><p><b>Preparada para:</b> ' + esc(lead) + '</p><p><b>Data de emissão:</b> ' + data + (ident ? ' · ' + ident : '') + '</p></header>';
    h += '<p class="aviso">' + esc(AVISO) + '</p>';
    h += '<p class="legenda">Legenda: ' + ['informado', 'calculado', 'estimado', 'pendente', 'na'].map(tag).join(' ') + '</p>';
    h += '<h2>1. Condições do plano</h2>' + tabelaResumoGeral(s, r, true);
    h += '<h2>2. Projeção por ano</h2>' + tabelaAnual(r);
    h += '<h2>3. Modalidades de contemplação</h2>' + textoModalidades(s, true);
    h += '<h2>4. Cenários hipotéticos</h2>' + tabelaCenario(r.cenarioA, 'pa', true) + tabelaCenario(r.cenarioB, 'pb', true);
    h += '<h2>5. Premissas utilizadas</h2><ul>' + r.premissas.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>';
    h += '<h2>6. Regras pendentes de confirmação com a administradora/grupo</h2>' + secPendentes(r);
    h += '<footer class="p-rodape"><p>' + esc(AVISO) + '</p><p>Mês de contemplação hipotético, sem garantia de ocorrência. Valores de venda são hipóteses, sem garantia de liquidez ou preço de mercado.</p></footer>';
    $('#proposta').innerHTML = h;
    const tituloOriginal = document.title;
    document.title = 'Proposta_' + nomeArquivo(lead) + '_' + data.replace(/\//g, '-');
    const restaurar = () => { document.title = tituloOriginal; window.removeEventListener('afterprint', restaurar); };
    window.addEventListener('afterprint', restaurar);
    window.print();
  }

  // ---------------------------------------------------------------------------
  // Ciclo de atualização
  // ---------------------------------------------------------------------------

  let agendado = null;
  function atualizar() {
    if (agendado) cancelAnimationFrame(agendado);
    agendado = requestAnimationFrame(() => {
      agendado = null;
      const r = C.simular(estado);
      desenhar(r);
      marcarCampos(r);
      gravar(CHAVE_ATUAL, estado);
    });
  }

  function marcarCampos(r) {
    $$('.campo-erro, .campo-alerta').forEach((el) => el.classList.remove('campo-erro', 'campo-alerta'));
    r.validacoes.forEach((v) => {
      if (!v.campo || v.nivel === 'info') return;
      $$('[data-k="' + v.campo + '"], [data-k^="' + v.campo + '."]').forEach((el) => el.classList.add(v.nivel === 'erro' ? 'campo-erro' : 'campo-alerta'));
    });
  }

  preencherIndices();
  ligarMenu();
  escreverCampos();
  atualizar();
})();
