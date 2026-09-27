/* Interface do simulador: vincula o menu lateral ao estado, chama o motor de
 * cálculo (Calc) e desenha resultados, gráficos, memórias de cálculo e a proposta em PDF. */
(function () {
  'use strict';

  const C = window.Calc;
  const CHAVE_PADRAO = 'simconsorcio.v2.padrao';
  const CHAVE_ATUAL = 'simconsorcio.v2.atual';
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
  const salvo = ler(CHAVE_ATUAL) || ler(CHAVE_PADRAO);
  let estado = null; // definido na inicialização (exemplo ilustrativo na primeira visita)
  const abertos = new Set();
  const graficos = new Map(); // dados dos gráficos exibidos, para o tooltip

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
  const SERIE = { sorteio: 1, fixo: 2, livre: 3 };

  function fmt(val, formato) {
    if (val == null || val.v == null) {
      if (val && val.tipo === 'na') return '<span class="na">' + esc(val.nota || val.formula || '—') + '</span>';
      return '<span class="nc">Não calculado</span>';
    }
    if (formato === 'txt') return esc(val.v);
    if (formato === 'int') return C.fmtNum(val.v, 0);
    if (formato === 'pct') return C.fmtPct(val.v, 2);
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

  function linhaTabela(rotulo, val, formato, id, pdf, classe) {
    return '<tr' + (classe ? ' class="' + classe + '"' : '') + '><th scope="row">' + rotulo + '</th><td class="num">' + fmt(val, formato) + '</td><td>' + tag(val ? val.tipo : 'pendente') + '</td><td class="col-memo">' + memoria(val, id, pdf) + '</td></tr>';
  }

  const nomeArquivo = (t) => (String(t || 'sem_nome').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'sem_nome');

  // ---------------------------------------------------------------------------
  // Menu lateral: preenchimento, leitura e visibilidade
  // ---------------------------------------------------------------------------

  function preencherSelects() {
    $$('.sel-indice').forEach((s) => { s.innerHTML = Object.entries(C.INDICES).map(([k, v]) => '<option value="' + k + '">' + esc(v.nome) + '</option>').join(''); });
    $$('.sel-administradora').forEach((s) => { s.innerHTML = '<option value="">Selecione</option>' + C.ADMINISTRADORAS.map((a) => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join(''); });
  }

  function escreverCampos() {
    $$('[data-k]').forEach((el) => {
      const v = obter(el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.hasAttribute('data-moeda')) el.value = C.isNum(v) ? C.fmtBRL(v) : '';
      else el.value = v == null ? '' : v;
    });
    aplicarVisibilidade();
  }

  function lerCampo(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.hasAttribute('data-moeda')) {
      const dig = el.value.replace(/\D/g, '');
      const v = dig ? Number(dig) / 100 : null;
      el.value = v === null ? '' : C.fmtBRL(v);
      return v;
    }
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

  function ligarMenu() {
    const sb = $('#sidebar');
    const aoAlterar = (ev) => {
      const el = ev.target;
      if (!el.dataset.k) return;
      if (el.hasAttribute('data-moeda') && ev.type === 'change') return;
      definir(el.dataset.k, lerCampo(el));
      if (el.dataset.k === 'plano.categoria') {
        // Sugestão de índice por categoria (pode ser alterada em seguida)
        estado.plano.indice = C.CATEGORIAS[estado.plano.categoria].indice;
        $('#f-indice').value = estado.plano.indice;
      }
      aplicarVisibilidade();
      atualizar();
    };
    sb.addEventListener('input', aoAlterar);
    sb.addEventListener('change', aoAlterar);
    sb.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (b && b.dataset.acao) acoes[b.dataset.acao]();
    });
    $('#arquivoImportar').addEventListener('change', importarArquivo);
    document.addEventListener('toggle', (ev) => {
      const d = ev.target;
      if (d.matches && d.matches('details[data-id]')) { if (d.open) abertos.add(d.dataset.id); else abertos.delete(d.dataset.id); }
    }, true);
    const pr = $('#principal');
    pr.addEventListener('pointermove', moverCursor);
    pr.addEventListener('pointerleave', esconderCursor, true);
  }

  // ---------------------------------------------------------------------------
  // Janelas dentro da página (confirm/alert do navegador podem estar bloqueados)
  // ---------------------------------------------------------------------------

  function janela(conteudo, botoes, larga) {
    const fundo = document.createElement('div');
    fundo.className = 'sobreposicao';
    fundo.innerHTML = '<div class="janela' + (larga ? ' larga' : '') + '" role="dialog" aria-modal="true">' + conteudo + '<div class="janela-acoes"></div></div>';
    const barra = fundo.querySelector('.janela-acoes');
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', aoTeclar); };
    const aoTeclar = (ev) => { if (ev.key === 'Escape') fechar(); };
    botoes.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.texto;
      if (b.primario) el.className = 'primario';
      el.addEventListener('click', () => { if (b.acao && b.acao(fundo) === false) return; fechar(); });
      barra.appendChild(el);
    });
    document.addEventListener('keydown', aoTeclar);
    document.body.appendChild(fundo);
    const foco = barra.querySelector('.primario') || barra.querySelector('button');
    if (foco) foco.focus({ preventScroll: true });
    return fundo;
  }
  function confirmar(msg, textoOk, aoConfirmar) {
    janela('<p>' + esc(msg) + '</p>', [{ texto: 'Cancelar' }, { texto: textoOk, primario: true, acao: aoConfirmar }]);
  }
  function avisar(msg) {
    const t = document.createElement('div');
    t.className = 'aviso-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ---------------------------------------------------------------------------
  // Ações da barra de ferramentas
  // ---------------------------------------------------------------------------

  function exemplo() {
    // Valores fictícios, apenas para demonstrar o funcionamento.
    const s = C.estadoPadrao();
    Object.assign(s.plano, { lead: 'Exemplo ilustrativo', categoria: 'imovel', credito: 300000, prazo: 240, mesContemplacao: 12, taxaAdm: 18, fundoReserva: 2, indice: 'incc', indiceTaxa: 5, seguroAtivo: true });
    s.parcela.modalidade = 'r50';
    Object.assign(s.lances, { embutidoAtivo: true, fixoAtivo: true, fixoUsarEmbutido: true, livreAtivo: true, livrePct: 35, livreUsarEmbutido: true });
    s.projecoes = { parcelas: true, credito: true, rentabilidade: true };
    return s;
  }

  const acoes = {
    nova() {
      confirmar('Iniciar uma nova simulação? Os campos voltarão às configurações padrão salvas.', 'Iniciar nova simulação', () => {
        estado = padraoSalvo();
        estado.plano.lead = '';
        escreverCampos(); atualizar();
        avisar('Nova simulação iniciada com a configuração padrão.');
      });
    },
    salvarPadrao() {
      const p = clone(estado);
      p.plano.lead = '';
      avisar(gravar(CHAVE_PADRAO, p) ? 'Configuração atual salva como padrão (sem o nome).' : 'Não foi possível salvar neste navegador.');
    },
    fabrica() {
      confirmar('Restaurar o padrão de fábrica? O padrão salvo será apagado e os campos voltarão aos valores iniciais.', 'Restaurar', () => {
        try { localStorage.removeItem(CHAVE_PADRAO); } catch (e) { /* sem armazenamento */ }
        estado = C.estadoPadrao();
        escreverCampos(); atualizar();
        avisar('Padrão de fábrica restaurado.');
      });
    },
    exemplo() {
      confirmar('Carregar um exemplo com valores fictícios? Os campos atuais serão substituídos.', 'Carregar exemplo', () => {
        estado = exemplo();
        escreverCampos(); atualizar();
      });
    },
    exportar() {
      const json = JSON.stringify({ versao: 2, gerado: new Date().toISOString(), estado }, null, 2);
      if (!window.MODO_ARTIFACT) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'simulacao_' + nomeArquivo(estado.plano.lead) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return;
      }
      janela('<h2>Dados da simulação (JSON)</h2><p class="nota">Copie o conteúdo e salve em um arquivo .json. Ele pode ser carregado depois em "Importar JSON".</p><textarea id="jsonExportado" readonly>' + esc(json) + '</textarea>', [
        { texto: 'Fechar' },
        { texto: 'Copiar', primario: true, acao: (j) => {
          const ta = j.querySelector('textarea');
          const selecionar = () => { ta.focus(); ta.select(); avisar('Texto selecionado: use Ctrl+C para copiar.'); };
          try { navigator.clipboard.writeText(json).then(() => avisar('JSON copiado.'), selecionar); } catch (e) { selecionar(); }
          return false;
        } }
      ], true);
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
      avisar('Simulação importada.');
    }).catch(() => avisar('Arquivo inválido: selecione um JSON exportado pelo simulador.')).finally(() => { ev.target.value = ''; });
  }

  // ---------------------------------------------------------------------------
  // Gráficos (SVG simples, com tooltip)
  // ---------------------------------------------------------------------------

  const GW = 720, GH = 260, ML = 84, MR = 16, MT = 14, MB = 34;
  const compacto = (v) => (C.isNum(v) ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }) : '—');

  function ticks(min, max, n) {
    if (min === max) { max = min + 1; }
    const passoBruto = (max - min) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(passoBruto)));
    const passo = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= passoBruto);
    const ini = Math.floor(min / passo) * passo;
    const out = [];
    for (let v = ini; v <= max + passo * 0.5; v += passo) out.push(Math.round(v * 100) / 100);
    return out;
  }

  function eixoY(yt, sy) {
    return yt.map((t) => '<line class="g-grade" x1="' + ML + '" x2="' + (GW - MR) + '" y1="' + sy(t) + '" y2="' + sy(t) + '"/>' +
      '<text class="g-rotulo" x="' + (ML - 8) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + esc(compacto(t)) + '</text>').join('');
  }

  function legenda(series) {
    if (series.length < 2) return '';
    return '<div class="g-legenda">' + series.map((s) => '<span><i class="g-chave s' + SERIE[s.mod] + '"></i>' + esc(s.nome) + '</span>').join('') + '</div>';
  }

  /** Gráfico de linhas por mês. series: [{mod, nome, pontos:[{x,y}]}] */
  function graficoLinhas(id, titulo, subtitulo, series, opts, pdf) {
    const todos = series.flatMap((s) => s.pontos.filter((p) => C.isNum(p.y)));
    if (!todos.length) return '<div class="grafico"><h3>' + esc(titulo) + '</h3><p class="nc">Não calculado: complete os dados do plano.</p></div>';
    const N = Math.max(...series.map((s) => s.pontos.length));
    let ymin = Math.min(0, ...todos.map((p) => p.y)), ymax = Math.max(...todos.map((p) => p.y));
    const yt = ticks(ymin, ymax, 4);
    ymin = Math.min(ymin, yt[0]); ymax = Math.max(ymax, yt[yt.length - 1]);
    const sx = (x) => ML + ((x - 1) / Math.max(1, N - 1)) * (GW - ML - MR);
    const sy = (y) => MT + (1 - (y - ymin) / (ymax - ymin)) * (GH - MT - MB);
    const passoX = N > 120 ? 24 : 12;
    let svg = eixoY(yt, sy);
    for (let m = passoX; m <= N; m += passoX) svg += '<text class="g-rotulo" x="' + sx(m) + '" y="' + (GH - 12) + '" text-anchor="middle">' + m + '</text>';
    svg += '<text class="g-rotulo" x="' + ML + '" y="' + (GH - 12) + '" text-anchor="start">mês 1</text>';
    if (ymin < 0) svg += '<line class="g-zero" x1="' + ML + '" x2="' + (GW - MR) + '" y1="' + sy(0) + '" y2="' + sy(0) + '"/>';
    if (C.isNum(opts.marcaX)) svg += '<line class="g-marca" x1="' + sx(opts.marcaX) + '" x2="' + sx(opts.marcaX) + '" y1="' + MT + '" y2="' + (GH - MB) + '"/><text class="g-rotulo" x="' + (sx(opts.marcaX) + 4) + '" y="' + (MT + 10) + '">' + esc(opts.marcaRotulo || '') + '</text>';
    series.forEach((s) => {
      let d = '', aberto = false;
      s.pontos.forEach((p) => {
        if (!C.isNum(p.y)) { aberto = false; return; }
        d += (aberto ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1);
        aberto = true;
      });
      svg += '<path class="g-linha s' + SERIE[s.mod] + '" d="' + d + '"/>';
      const ult = s.pontos.filter((p) => C.isNum(p.y)).pop();
      if (ult) svg += '<circle class="g-ponto s' + SERIE[s.mod] + '" cx="' + sx(ult.x) + '" cy="' + sy(ult.y) + '" r="4"/>';
    });
    if (!pdf) svg += '<g class="g-cursor" hidden><line x1="0" x2="0" y1="' + MT + '" y2="' + (GH - MB) + '"/></g><rect class="g-alvo" data-grafico="' + id + '" x="' + ML + '" y="' + MT + '" width="' + (GW - ML - MR) + '" height="' + (GH - MT - MB) + '"/>';
    graficos.set(id, { tipo: 'linhas', series, N, sx, fmt: opts.fmtValor || C.fmtBRL, rotuloX: opts.rotuloX || ((x) => 'Mês ' + x) });
    return '<div class="grafico" data-id="' + id + '"><h3>' + esc(titulo) + '</h3><p class="g-sub">' + esc(subtitulo) + '</p>' + legenda(series) +
      '<div class="g-area"><svg viewBox="0 0 ' + GW + ' ' + GH + '" role="img" aria-label="' + esc(titulo) + '">' + svg + '</svg>' + (pdf ? '' : '<div class="g-dica" hidden></div>') + '</div>' +
      (pdf ? '' : tabelaDados(id, series, opts)) + '</div>';
  }

  /** Colunas por ano (crédito atualizado). */
  function graficoColunas(id, titulo, subtitulo, pontos, pdf) {
    const vals = pontos.filter((p) => C.isNum(p.y));
    if (!vals.length) return '<div class="grafico"><h3>' + esc(titulo) + '</h3><p class="nc">Não calculado: complete os dados do plano.</p></div>';
    const yt = ticks(0, Math.max(...vals.map((p) => p.y)), 4);
    const ymax = yt[yt.length - 1];
    const sy = (y) => MT + (1 - y / ymax) * (GH - MT - MB);
    const banda = (GW - ML - MR) / pontos.length;
    const larg = Math.min(24, banda * 0.6);
    let svg = eixoY(yt, sy);
    const passo = pontos.length > 20 ? 4 : pontos.length > 10 ? 2 : 1;
    pontos.forEach((p, i) => {
      const cx = ML + banda * (i + 0.5);
      if ((i + 1) % passo === 0 || i === 0) svg += '<text class="g-rotulo" x="' + cx + '" y="' + (GH - 12) + '" text-anchor="middle">' + (i + 1) + '</text>';
      if (!C.isNum(p.y)) return;
      const x0 = cx - larg / 2, y0 = sy(p.y), yb = sy(0), rr = Math.min(4, (yb - y0) / 2);
      svg += '<path class="g-barra s1" d="M' + x0 + ' ' + yb + 'V' + (y0 + rr) + 'Q' + x0 + ' ' + y0 + ' ' + (x0 + rr) + ' ' + y0 + 'H' + (x0 + larg - rr) + 'Q' + (x0 + larg) + ' ' + y0 + ' ' + (x0 + larg) + ' ' + (y0 + rr) + 'V' + yb + 'Z"/>';
    });
    const ult = vals[vals.length - 1];
    svg += '<text class="g-valor" x="' + (ML + banda * (pontos.indexOf(ult) + 0.5)) + '" y="' + (sy(ult.y) - 6) + '" text-anchor="end">' + esc(compacto(ult.y)) + '</text>';
    svg += '<text class="g-rotulo" x="' + ML + '" y="' + (GH - 1) + '">ano</text>';
    if (!pdf) svg += '<g class="g-cursor" hidden><line x1="0" x2="0" y1="' + MT + '" y2="' + (GH - MB) + '"/></g><rect class="g-alvo" data-grafico="' + id + '" x="' + ML + '" y="' + MT + '" width="' + (GW - ML - MR) + '" height="' + (GH - MT - MB) + '"/>';
    const series = [{ mod: 'sorteio', nome: 'Crédito atualizado', pontos }];
    graficos.set(id, { tipo: 'colunas', series, N: pontos.length, sx: (x) => ML + banda * (x - 0.5), banda, fmt: C.fmtBRL, rotuloX: (x) => 'Ano ' + x + ' (meses ' + ((x - 1) * 12 + 1) + '–' + (x * 12) + ')' });
    return '<div class="grafico" data-id="' + id + '"><h3>' + esc(titulo) + '</h3><p class="g-sub">' + esc(subtitulo) + '</p>' +
      '<div class="g-area"><svg viewBox="0 0 ' + GW + ' ' + GH + '" role="img" aria-label="' + esc(titulo) + '">' + svg + '</svg>' + (pdf ? '' : '<div class="g-dica" hidden></div>') + '</div>' +
      (pdf ? '' : tabelaDados(id, series, { anual: true })) + '</div>';
  }

  function tabelaDados(id, series, opts) {
    const N = Math.max(...series.map((s) => s.pontos.length));
    const xs = [];
    if (opts.anual) for (let x = 1; x <= N; x++) xs.push(x);
    else { xs.push(1); for (let x = 12; x <= N; x += 12) xs.push(x); if (xs[xs.length - 1] !== N) xs.push(N); }
    const f = opts.fmtValor || C.fmtBRL;
    return '<details class="memo" data-id="dados-' + id + '"' + (abertos.has('dados-' + id) ? ' open' : '') + '><summary>ver dados</summary><div class="rolagem"><table class="tab tab-num"><thead><tr><th>' + (opts.anual ? 'Ano' : 'Mês') + '</th>' +
      series.map((s) => '<th>' + esc(s.nome) + '</th>').join('') + '</tr></thead><tbody>' +
      xs.map((x) => '<tr><td>' + x + '</td>' + series.map((s) => { const p = s.pontos[x - 1]; return '<td>' + (p && C.isNum(p.y) ? f(p.y) + (C.isNum(p.pct) ? ' (' + C.fmtPct(p.pct, 1) + ')' : '') : '—') + '</td>'; }).join('') + '</tr>').join('') +
      '</tbody></table></div></details>';
  }

  function moverCursor(ev) {
    const alvo = ev.target.closest && ev.target.closest('.g-alvo');
    if (!alvo) return;
    const g = graficos.get(alvo.dataset.grafico);
    const caixa = alvo.closest('.grafico');
    if (!g || !caixa) return;
    const svg = alvo.ownerSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    let x;
    if (g.tipo === 'colunas') x = Math.min(g.N, Math.max(1, Math.floor((loc.x - ML) / g.banda) + 1));
    else x = Math.min(g.N, Math.max(1, Math.round(1 + ((loc.x - ML) / (GW - ML - MR)) * (g.N - 1))));
    const cursor = $('.g-cursor', caixa);
    cursor.hidden = false;
    cursor.setAttribute('transform', 'translate(' + g.sx(x) + ',0)');
    const dica = $('.g-dica', caixa);
    dica.innerHTML = '<b>' + esc(g.rotuloX(x)) + '</b>' + g.series.map((s) => {
      const p = s.pontos[x - 1];
      return '<div>' + (g.series.length > 1 ? '<i class="g-chave s' + SERIE[s.mod] + '"></i>' + esc(s.nome) + ': ' : '') + (p && C.isNum(p.y) ? esc(g.fmt(p.y)) + (C.isNum(p.pct) ? ' (' + C.fmtPct(p.pct, 1) + ')' : '') : 'encerrado / n/c') + '</div>';
    }).join('');
    dica.hidden = false;
    const area = $('.g-area', caixa).getBoundingClientRect();
    const px = ev.clientX - area.left;
    dica.style.left = Math.min(Math.max(8, px + 12), area.width - dica.offsetWidth - 8) + 'px';
  }
  function esconderCursor(ev) {
    if (!ev.target.classList || !ev.target.classList.contains('g-alvo')) return;
    const caixa = ev.target.closest('.grafico');
    if (!caixa) return;
    $('.g-cursor', caixa).hidden = true;
    $('.g-dica', caixa).hidden = true;
  }

  function secProjecoes(r, pdf) {
    const p = r.projecoes;
    const partes = [];
    const mesC = C.num(estado.plano.mesContemplacao);
    if (p.parcelas) partes.push(graficoLinhas((pdf ? 'p' : '') + 'g-parcelas', 'Parcelas mês a mês', 'Parcela total (plano, adesão e seguro) em cada cenário. Após a contemplação, a parcela reflete a recomposição do redutor e o abatimento do lance.', p.parcelas, { marcaX: mesC, marcaRotulo: 'contemplação' }, pdf));
    if (p.credito) partes.push(graficoColunas((pdf ? 'p' : '') + 'g-credito', 'Crédito atualizado por ano', 'Crédito contratado reajustado anualmente pelo índice ' + C.nomeIndice(estado.plano) + (C.indiceEstimado(estado.plano) ? ' (taxa estimada)' : '') + '.', p.credito, pdf));
    if (p.rentabilidade) partes.push(graficoLinhas((pdf ? 'p' : '') + 'g-rentab', 'Rentabilidade da venda conforme o mês de contemplação', 'Resultado estimado se a carta for contemplada no mês indicado e vendida por ' + C.REGRAS.vendaPct + '% do crédito líquido. Entre parênteses no detalhe: resultado ÷ total aportado.', p.rentabilidade, { marcaX: mesC, marcaRotulo: 'projeção', rotuloX: (x) => 'Contemplação no mês ' + x }, pdf));
    if (!partes.length) return '';
    return partes.join('') + '<p class="aviso-inline">Projeções estimadas, sem garantia de contemplação, venda ou rentabilidade.</p>';
  }

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
    const h = bloco('erro', 'Corrija para calcular') + bloco('alerta', 'Alertas') + bloco('info', 'Informações');
    return h ? '<section class="bloco-res">' + h + '</section>' : '';
  }

  function cartao(rotulo, val, formato, id, extra) {
    return '<div class="cartao"><div class="c-rot">' + rotulo + '</div><div class="c-val">' + fmt(val, formato) + '</div><div class="c-rod">' + tag(val ? val.tipo : 'pendente') + (extra || '') + '</div>' + memoria(val, id) + '</div>';
  }

  function textoIndice(p) {
    const t = C.taxaIndice(p);
    return C.nomeIndice(p) + (C.isNum(t) ? ' — ' + C.fmtPct(t) + ' ao ano' + (C.indiceEstimado(p) ? ' (estimado)' : '') : ' — taxa não informada');
  }

  function secResumo(s, r) {
    const R = r.resumo;
    const temRed = s.parcela.modalidade !== 'integral';
    const txt = (t, tipo) => ({ v: t, tipo: tipo || 'informado', formula: '', pend: [] });
    let h = '<section class="bloco-res"><h2>Resumo</h2><div class="cartoes">';
    h += cartao('Crédito contratado', R.credito, 'brl', 'r-cred');
    h += cartao('Prazo total', R.prazo, 'meses', 'r-prazo');
    h += cartao('Parcela inicial', R.parcelaInicial, 'brl', 'r-pini', ' <small>com adesão e seguro</small>');
    h += cartao('Parcela integral', R.parcelaIntegral, 'brl', 'r-pint', ' <small>sem adesão e seguro</small>');
    if (temRed) h += cartao('Parcela com redutor de ' + C.fmtPct(r.redutorPct, 0), R.parcelaRedutor, 'brl', 'r-pred', ' <small>até a contemplação</small>');
    h += cartao('Taxa de administração', R.taxaAdm, 'brl', 'r-ta', R.taxaAdm.pct != null ? ' <small>' + C.fmtPct(R.taxaAdm.pct) + '</small>' : '');
    h += cartao('Fundo de reserva', R.fundoReserva, 'brl', 'r-fr', R.fundoReserva.pct != null ? ' <small>' + C.fmtPct(R.fundoReserva.pct) + '</small>' : '');
    h += cartao('Adesão', R.adesao, 'brl', 'r-ad', R.adesao.mensal != null ? ' <small>' + C.fmtBRL(R.adesao.mensal) + '/mês</small>' : '');
    h += cartao('Seguro prestamista (mês 1)', R.seguro, 'brl', 'r-seg');
    h += cartao('Reajuste anual', txt(textoIndice(s.plano), C.isNum(C.taxaIndice(s.plano)) ? 'informado' : 'pendente'), 'txt', 'r-idx');
    h += cartao('Total estimado pago no plano', R.totalPago, 'brl', 'r-total', ' <small>sem lance</small>');
    h += '</div></section>';
    return h;
  }

  function tabelaResumoGeral(s, r, pdf) {
    const R = r.resumo;
    const txt = (t, tipo) => ({ v: t, tipo: tipo || 'informado', formula: '', pend: [] });
    const p = s.plano;
    const linhas = [
      ['Categoria', txt(C.CATEGORIAS[p.categoria].nome), 'txt'],
      ['Administradora', txt(p.administradora || 'Não selecionada', p.administradora ? 'informado' : 'na'), 'txt'],
      ['Valor do crédito', R.credito, 'brl'],
      ['Prazo', R.prazo, 'meses'],
      ['Projeção de contemplação', txt('Mês ' + (p.mesContemplacao || '—'), 'estimado'), 'txt'],
      ['Taxa de administração' + (R.taxaAdm.pct != null ? ' (' + C.fmtPct(R.taxaAdm.pct) + ')' : ''), R.taxaAdm, 'brl'],
      ['Fundo de reserva' + (R.fundoReserva.pct != null ? ' (' + C.fmtPct(R.fundoReserva.pct) + ')' : ''), R.fundoReserva, 'brl'],
      ['Adesão', R.adesao, 'brl'],
      ['Seguro prestamista' + (p.seguroAtivo ? ' (' + C.fmtPct(C.num(p.seguroPct), 3) + ' a.m.)' : ''), R.seguro, 'brl'],
      ['Modalidade de parcela', txt((C.MODALIDADES_PARCELA[s.parcela.modalidade] || {}).nome + (s.parcela.modalidade === 'outro' ? ' (' + C.fmtPct(r.redutorPct, 0) + ')' : '')), 'txt'],
      ['Abatimento do lance', txt(p.abatimento === 'prazo' ? 'Prazo' : 'Parcela'), 'txt'],
      ['Índice de reajuste', txt(textoIndice(p), C.isNum(C.taxaIndice(p)) ? 'informado' : 'pendente'), 'txt'],
      ['Parcela inicial', R.parcelaInicial, 'brl'],
      ['Parcela integral (sem adesão e seguro)', R.parcelaIntegral, 'brl']
    ];
    if (s.parcela.modalidade !== 'integral') linhas.push(['Parcela com redutor (sem adesão e seguro)', R.parcelaRedutor, 'brl']);
    linhas.push(['Total estimado pago no plano (sem lance)', R.totalPago, 'brl']);
    return '<div class="rolagem-x"><table class="tab"><thead><tr><th>Item</th><th>Valor</th><th>Tipo</th><th class="col-memo">Memória</th></tr></thead><tbody>' +
      linhas.map((l, i) => linhaTabela(l[0], l[1], l[2], 'rg-' + i, pdf)).join('') + '</tbody></table></div>';
  }

  function textoModalidades(s, r) {
    const l = s.lances;
    const v = r.valoresLance;
    const pctV = (pct, val) => (C.isNum(C.num(pct)) ? C.fmtPct(C.num(pct)) + ' — ' + C.fmtBRL(val) : 'percentual não informado');
    let h = '<div class="modalidades">';
    h += '<div class="modal"><h3>Sorteio</h3><p>Hipótese de contemplação por sorteio no mês projetado. Depende das assembleias e das regras do grupo; não há mês garantido.</p></div>';
    if (l.embutidoAtivo) h += '<div class="modal"><h3>Lance embutido</h3><p><b>' + pctV(l.embutidoPct, v.embutido) + '</b></p><p>Parte do lance paga com o próprio crédito. Reduz o crédito disponível e não sai do bolso do cliente.</p></div>';
    if (l.fixoAtivo) h += '<div class="modal"><h3>Lance fixo</h3><p><b>' + pctV(l.fixoPct, v.fixo) + '</b></p><p>Percentual definido pela administradora.' + (l.fixoUsarEmbutido && l.embutidoAtivo ? ' Usa o lance embutido; o restante é recurso próprio.' : ' Pago integralmente com recursos próprios.') + '</p></div>';
    if (l.livreAtivo) h += '<div class="modal"><h3>Lance livre</h3><p><b>' + pctV(l.livrePct, v.livre) + '</b></p><p>Oferta escolhida pelo cliente, que concorre com os demais lances do grupo. Nenhum valor ofertado assegura contemplação.' + (l.livreUsarEmbutido && l.embutidoAtivo ? ' Usa o lance embutido; o restante é recurso próprio.' : '') + '</p></div>';
    return h + '</div>';
  }

  const LINHAS_CEN = [
    ['mes', 'Mês da contemplação (projetado)', 'txt'],
    ['credito', 'Crédito contratado', 'brl'],
    ['credBruto', 'Crédito na contemplação', 'brl'],
    ['lance', 'Lance ofertado', 'brl'],
    ['embutido', 'Lance embutido (sai do crédito)', 'brl'],
    ['proprios', 'Recursos próprios do lance', 'brl'],
    ['credLiquido', 'Crédito líquido disponível', 'brl'],
    ['parcelaMes', 'Parcela no mês da contemplação', 'brl'],
    ['qtdParcelas', 'Parcelas pagas até a contemplação', 'int'],
    ['totalParcelas', 'Total pago em parcelas', 'brl'],
    ['totalAportado', 'Total aportado pelo cliente', 'brl'],
    ['venda', 'Valor estimado de venda (' + C.REGRAS.vendaPct + '%)', 'brl', 'destaque'],
    ['resultado', 'Resultado estimado da venda', 'brl', 'destaque'],
    ['rentabilidade', 'Rentabilidade sobre o aportado', 'pct', 'destaque'],
    ['parcelaPos', 'Parcela após a contemplação', 'brl'],
    ['prazoRestante', 'Parcelas restantes', 'int'],
    ['obrigacoes', 'Saldo de parcelas futuras', 'brl']
  ];

  function tabelaCenario(cen, id, pdf) {
    let h = '<div class="cenario"><h3><i class="g-chave s' + SERIE[cen.mod] + '"></i>' + esc(cen.titulo) + '</h3>';
    if (!cen.ok) return h + '<p class="nc">' + esc(cen.motivo) + '</p></div>';
    h += '<div class="rolagem-x"><table class="tab"><thead><tr><th>Item</th><th>Valor</th><th>Tipo</th><th class="col-memo">Memória</th></tr></thead><tbody>';
    h += LINHAS_CEN.map(([k, rot, f, cls]) => linhaTabela(cls ? '<b>' + rot + '</b>' : rot, cen.linhas[k], f, id + '-' + k, pdf, cls)).join('');
    h += '</tbody></table></div>';
    return h + '</div>';
  }

  function tabelaMensal(cen) {
    const n = cen.nucleo;
    if (!n.ok) return '<p class="nc">' + esc(cen.motivo) + '</p>';
    const f = (x) => (C.isNum(x) ? C.fmtBRL(x) : '<span class="nc">n/c</span>');
    return '<div class="rolagem"><table class="tab tab-num"><thead><tr><th>Mês</th><th>Crédito atualizado</th><th>Fundo comum</th><th>Taxa adm.</th><th>F. reserva</th><th>Adesão</th><th>Seguro</th><th>Parcela total</th><th>Situação</th></tr></thead><tbody>' +
      n.linhas.map((l) => '<tr><td>' + l.m + '</td><td>' + f(l.credAtual) + '</td><td>' + f(l.fundoComum) + '</td><td>' + f(l.taxa) + '</td><td>' + f(l.fundo) + '</td><td>' + f(l.adesao) + '</td><td>' + f(l.seguro) + '</td><td>' + f(l.total) + '</td><td class="sit">' +
        (l.encerrado ? 'Quitada pelo lance' : l.m === n.mesC ? 'Contemplação' : l.reduzido ? 'Redutor' : '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function desenhar(r) {
    const s = estado;
    graficos.clear();
    let h = '<header class="topo"><h1>Simulação de consórcio' + (s.plano.lead ? ' — ' + esc(s.plano.lead) : '') + '</h1>' +
      '<p class="sub-topo">' + esc(C.CATEGORIAS[s.plano.categoria].nome) + (s.plano.administradora ? ' · ' + esc(s.plano.administradora) : '') + '</p>' +
      '<p class="aviso">' + esc(AVISO) + '</p></header>';
    h += secAlertas(r);
    h += secResumo(s, r);
    const proj = secProjecoes(r, false);
    if (proj) h += '<section class="bloco-res"><h2>Projeções</h2>' + proj + '</section>';
    h += '<section class="bloco-res"><h2>Estratégias de contemplação</h2>' + textoModalidades(s, r) + '<div class="cenarios">' + r.cenarios.map((c, i) => tabelaCenario(c, 'c' + i, false)).join('') + '</div>' +
      '<p class="aviso-inline">' + esc(C.MSG.mesHipotetico) + ' ' + esc(C.MSG.estimado) + '</p></section>';
    h += '<section class="bloco-res"><h2>Resumo geral da proposta</h2>' + tabelaResumoGeral(s, r, false) +
      '<h3>Premissas usadas</h3><ul class="premissas">' + r.premissas.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' +
      '<h3>Confirmar com a administradora</h3><ul class="premissas">' + r.pontosConfirmar.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></section>';
    h += '<section class="bloco-res"><h2>Demonstrativo mensal</h2>' + r.cenarios.map((c, i) => '<details class="memo" data-id="mensal-' + i + '"' + (abertos.has('mensal-' + i) ? ' open' : '') + '><summary>' + esc(c.nome) + '</summary>' + tabelaMensal(c) + '</details>').join('') + '</section>';
    h += '<footer class="rodape"><p>' + esc(AVISO) + '</p></footer>';
    const principal = $('#principal');
    const rolagem = principal.scrollTop;
    principal.innerHTML = h;
    principal.scrollTop = rolagem;
  }

  function atualizarValoresTravados(r) {
    $$('[data-valor]').forEach((o) => {
      const v = r.valoresLance[o.dataset.valor];
      o.textContent = C.isNum(v) ? C.fmtBRL(v) : '—';
    });
  }

  // ---------------------------------------------------------------------------
  // Proposta em PDF (prévia → impressão do navegador → "Salvar como PDF")
  // ---------------------------------------------------------------------------

  function montarProposta(s, r, lead) {
    const data = new Date().toLocaleDateString('pt-BR');
    const ident = [C.CATEGORIAS[s.plano.categoria].nome, s.plano.administradora && 'Administradora: ' + esc(s.plano.administradora)].filter(Boolean).join(' · ');
    let h = '<header class="p-topo"><h1>Proposta de simulação — Consórcio</h1><p><b>Cliente:</b> ' + esc(lead) + '</p><p><b>Data de emissão:</b> ' + data + ' · ' + ident + '</p></header>';
    h += '<p class="aviso">' + esc(AVISO) + '</p>';
    h += '<h2>1. Condições do plano</h2>' + tabelaResumoGeral(s, r, true);
    h += '<h2>2. Estratégias de contemplação</h2>' + textoModalidades(s, r) + r.cenarios.map((c, i) => tabelaCenario(c, 'p' + i, true)).join('');
    let n = 3;
    const proj = secProjecoes(r, true);
    if (proj) h += '<h2>' + (n++) + '. Projeções</h2>' + proj;
    h += '<h2>' + (n++) + '. Premissas utilizadas</h2><ul>' + r.premissas.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>';
    h += '<footer class="p-rodape"><p>' + esc(AVISO) + '</p><p>Mês de contemplação projetado, sem garantia de ocorrência. O valor de venda é uma hipótese, sem garantia de liquidez ou preço de mercado.</p></footer>';
    return { html: h, data };
  }

  function imprimir(lead, data) {
    const tituloOriginal = document.title;
    document.title = 'Proposta_' + nomeArquivo(lead) + '_' + data.replace(/\//g, '-');
    const restaurar = () => { document.title = tituloOriginal; window.removeEventListener('afterprint', restaurar); };
    window.addEventListener('afterprint', restaurar);
    window.print();
  }

  function gerarPdf() {
    const s = estado;
    const r = C.simular(s);
    const lead = String(s.plano.lead || '').trim();
    if (!lead) { avisar('Informe o nome completo antes de gerar a proposta.'); $('#f-lead').focus(); return; }
    const erros = r.validacoes.filter((v) => v.nivel === 'erro');
    const prop = montarProposta(s, r, lead);
    $('#proposta').innerHTML = prop.html;
    const nota = erros.length ? '<p class="aviso">Há ' + erros.length + ' erro(s) de preenchimento. Os itens afetados aparecem como "Não calculado".</p>' : '';
    const notaArtifact = window.MODO_ARTIFACT ? '<p class="nota">Nesta versão on-line a impressão está bloqueada. Para salvar em PDF, abra o arquivo <b>index.html</b> do simulador no navegador e use "Salvar em PDF".</p>' : '';
    const botoes = [{ texto: 'Fechar' }];
    if (!window.MODO_ARTIFACT) botoes.push({ texto: 'Salvar em PDF', primario: true, acao: () => { imprimir(lead, prop.data); } });
    janela('<h2>Prévia da proposta</h2>' + nota + notaArtifact + '<div class="previa">' + prop.html + '</div>', botoes, true);
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
      atualizarValoresTravados(r);
      marcarCampos(r);
      gravar(CHAVE_ATUAL, estado);
    });
  }

  function marcarCampos(r) {
    $$('.campo-erro, .campo-alerta').forEach((el) => el.classList.remove('campo-erro', 'campo-alerta'));
    r.validacoes.forEach((v) => {
      if (!v.campo || v.nivel === 'info') return;
      $$('[data-k="' + v.campo + '"]').forEach((el) => el.classList.add(v.nivel === 'erro' ? 'campo-erro' : 'campo-alerta'));
    });
  }

  estado = salvo ? mesclar(C.estadoPadrao(), salvo) : exemplo();
  preencherSelects();
  ligarMenu();
  escreverCampos();
  atualizar();
})();
