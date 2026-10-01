/* Interface do simulador: vincula o menu lateral ao estado, chama o motor de
 * cálculo (Calc) e desenha resultados, gráficos, memórias de cálculo e a proposta em PDF. */
(function () {
  'use strict';

  const C = window.Calc;
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

  const salvo = ler(CHAVE_ATUAL);
  let estado = null; // definido na inicialização (exemplo ilustrativo na primeira visita)
  const abertos = new Set();
  const revelados = new Set(); // lances e tabelas de venda exibidos ao cliente (começam ocultos)
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
  const SERIE = { sorteio: 1, embutido: 1, fixo: 1, livre: 1 };
  // Ícones de traço no estilo Lucide (grade 24×24, traço 1,7, nunca preenchidos)
  const ICONES = {
    sorteio: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8.5 8.5h.01"/><path d="M15.5 8.5h.01"/><path d="M12 12h.01"/><path d="M8.5 15.5h.01"/><path d="M15.5 15.5h.01"/>',
    embutido: '<path d="M12 3.5 3 8l9 4.5L21 8z"/><path d="m3 12.5 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
    fixo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    livre: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    fidelidade: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    mecanismo: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-4"/><path d="M13 17V9"/><path d="M18 17V5"/>'
  };
  const SVG_SOL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/></svg>';
  const SVG_LUA = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  // Tema claro/escuro do CRM: segue o sistema até a pessoa escolher (preferência guardada só neste navegador)
  const CHAVE_TEMA = 'simconsorcio.tema';
  function temaAtual() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function definirTema(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(CHAVE_TEMA, t); } catch (e) { /* sem armazenamento */ }
  }
  try { const t = localStorage.getItem(CHAVE_TEMA); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* sem armazenamento */ }
  function seletorTema() {
    const t = temaAtual();
    const b = (v, ico, rot) => '<button type="button" data-tema="' + v + '" aria-pressed="' + (t === v) + '">' + ico + rot + '</button>';
    return '<div class="tema" role="group" aria-label="Tema">' + b('light', SVG_SOL, 'Claro') + b('dark', SVG_LUA, 'Escuro') + '</div>';
  }
  const icone = (mod) => '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">' + ICONES[mod] + '</svg>';

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

  const nomeArquivo = (t) => (String(t || 'sem_nome').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'sem_nome');

  // ---------------------------------------------------------------------------
  // Menu lateral: preenchimento, leitura e visibilidade
  // ---------------------------------------------------------------------------

  // Planos cadastrados: vêm do CRM (CONFIG_SIMULADOR.planosUrl) ou da lista em js/config.js
  let planos = [];
  function definirPlanos(lista) {
    planos = (Array.isArray(lista) ? lista : []).map(C.normalizarPlano).filter(Boolean);
  }
  const planoPorId = (id) => planos.find((x) => x.id === String(id)) || null;

  function preencherSelects() {
    $$('.sel-indice').forEach((s) => { s.innerHTML = Object.entries(C.INDICES).map(([k, v]) => '<option value="' + k + '">' + esc(v.nome) + '</option>').join(''); });
    const adms = C.ADMINISTRADORAS.concat(planos.map((x) => x.administradora).filter((a) => !C.ADMINISTRADORAS.includes(a)));
    const atual = estado && estado.plano.administradora;
    if (atual && !adms.includes(atual)) adms.push(atual);
    $$('.sel-administradora').forEach((s) => { s.innerHTML = '<option value="">Selecione</option>' + adms.map((a) => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join(''); });
    preencherPlanos();
  }

  /** Lista os planos da administradora selecionada. */
  function preencherPlanos() {
    const sel = $('#f-plano');
    if (!sel) return;
    const adm = estado ? estado.plano.administradora : '';
    const daAdm = planos.filter((x) => x.administradora === adm);
    let ops;
    if (!adm) ops = '<option value="">Selecione a administradora</option>';
    else if (!daAdm.length) ops = '<option value="">Nenhum plano cadastrado</option>';
    else ops = '<option value="">Selecione o plano</option>' + daAdm.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.nome + (x.categoria ? ' · ' + C.CATEGORIAS[x.categoria].nome : '') + (x.exemplo ? ' (exemplo)' : '')) + '</option>').join('');
    sel.innerHTML = ops;
    sel.disabled = !daAdm.length;
    sel.value = estado && daAdm.some((x) => x.id === estado.plano.planoId) ? estado.plano.planoId : '';
    notaPlano();
  }

  function notaPlano() {
    const nota = $('#nota-plano');
    if (!nota) return;
    const pl = estado && planoPorId(estado.plano.planoId);
    nota.hidden = !pl;
    if (!pl) return;
    const partes = [];
    if (C.isNum(pl.creditoMinimo)) partes.push('Crédito mínimo ' + C.fmtBRL(pl.creditoMinimo));
    if (C.isNum(pl.embutidoPct)) partes.push('Embutido ' + C.fmtNum(pl.embutidoPct, Number.isInteger(pl.embutidoPct) ? 0 : 2) + '%');
    if (C.isNum(pl.fixoPct)) partes.push('Fixo ' + C.fmtNum(pl.fixoPct, Number.isInteger(pl.fixoPct) ? 0 : 2) + '%');
    if (pl.indice) partes.push(C.INDICES[pl.indice].nome);
    nota.textContent = 'Plano aplicado: ' + partes.join(' · ') + '.';
  }

  async function carregarPlanosCrm() {
    const url = (window.CONFIG_SIMULADOR || {}).planosUrl;
    if (!url) return false;
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const dados = await resp.json();
      definirPlanos(Array.isArray(dados) ? dados : dados && dados.planos);
      return true;
    } catch (e) {
      avisar('Não foi possível buscar os planos no CRM; usando os planos do js/config.js.');
      return false;
    }
  }

  function selecionarPlano(id) {
    const pl = planoPorId(id);
    if (!pl) { estado.plano.planoId = ''; estado.plano.creditoMinimo = null; return false; }
    C.aplicarPlanoCadastrado(estado, pl);
    return true;
  }

  function escreverCampos() {
    $$('[data-k]').forEach((el) => {
      const v = obter(el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === String(v);
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
    if (el.hasAttribute('data-telefone')) {
      el.value = formatarTelefone(el.value);
      return el.value;
    }
    if (el.type === 'number') return el.value === '' ? null : Number(el.value);
    return el.value;
  }

  /** Formata o telefone como (11) 98765-4321 enquanto é digitado. */
  function formatarTelefone(txt) {
    const d = String(txt || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  function avaliarCondicao(expr) {
    if (expr.includes('&')) return expr.split('&').every(avaliarCondicao);
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
      if (el.type === 'radio' && !el.checked) return;
      if (el.hasAttribute('data-moeda') && ev.type === 'change') return;
      definir(el.dataset.k, lerCampo(el));
      if (el.dataset.k === 'plano.categoria') {
        // Valores fixos da categoria (crédito, prazo, taxas e índice); podem ser editados em seguida
        C.aplicarCategoria(estado.plano, estado.plano.categoria);
        Object.assign(estado.plano, { planoId: '', creditoMinimo: null });
        escreverCampos();
        preencherPlanos();
      } else if (el.dataset.k === 'plano.administradora') {
        // Troca de administradora: o plano cadastrado anterior deixa de valer
        const pl = planoPorId(estado.plano.planoId);
        if (pl && pl.administradora !== estado.plano.administradora) Object.assign(estado.plano, { planoId: '', creditoMinimo: null });
        preencherPlanos();
      } else if (el.dataset.k === 'plano.planoId') {
        // Plano cadastrado: crédito mínimo, prazo, taxas, lances e índice preenchidos automaticamente
        if (selecionarPlano(estado.plano.planoId)) avisar('Plano aplicado: crédito, prazo, taxas, lances e índice atualizados.');
        escreverCampos();
        preencherPlanos();
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
    document.addEventListener('toggle', (ev) => {
      const d = ev.target;
      if (d.matches && d.matches('details[data-id]')) { if (d.open) abertos.add(d.dataset.id); else abertos.delete(d.dataset.id); }
    }, true);
    const pr = $('#principal');
    $('#botaoMenu').addEventListener('click', () => alternarMenu());
    pr.addEventListener('click', (ev) => {
      const tema = ev.target.closest('[data-tema]');
      if (tema) { definirTema(tema.dataset.tema); atualizar(); return; }
      const olho = ev.target.closest('[data-olho]');
      if (!olho) return;
      const id = olho.dataset.olho;
      if (revelados.has(id)) revelados.delete(id); else revelados.add(id);
      atualizar();
    });
    pr.addEventListener('pointermove', moverCursor);
    pr.addEventListener('pointerleave', esconderCursor, true);
  }

  function alternarMenu(forcar) {
    const oculto = forcar != null ? forcar : !document.body.classList.contains('menu-oculto');
    document.body.classList.toggle('menu-oculto', oculto);
    const b = $('#botaoMenu');
    const rotulo = oculto ? 'Mostrar menu' : 'Ocultar menu';
    b.setAttribute('aria-label', rotulo);
    b.title = rotulo;
    b.setAttribute('aria-expanded', String(!oculto));
    try { localStorage.setItem('simconsorcio.menuOculto', oculto ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
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
    // Parcela integral e sem seguro: a parcela inicial mostra só fundo comum + taxa adm. + fundo de reserva
    Object.assign(s.plano, { lead: 'Exemplo ilustrativo', mesContemplacao: 12, indiceTaxa: 5 });
    Object.assign(s.lances, { embutidoAtivo: true, fixoAtivo: true, fixoUsarEmbutido: true, livreAtivo: true, livrePct: 35, livreUsarEmbutido: true });
    s.projecoes = { parcelas: true, credito: true, rentabilidade: true };
    return s;
  }

  const acoes = {
    nova() {
      confirmar('Iniciar uma nova proposta? Os campos voltarão aos valores iniciais.', 'Nova proposta', () => {
        estado = C.estadoPadrao();
        revelados.clear();
        escreverCampos(); atualizar();
        $('#f-lead').focus();
      });
    },
    salvar() {
      const json = JSON.stringify({ versao: 2, gerado: new Date().toISOString(), estado }, null, 2);
      if (!window.MODO_ARTIFACT) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'proposta_' + nomeArquivo(estado.plano.lead) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        avisar('Proposta salva.');
        return;
      }
      janela('<h2>Salvar proposta</h2><p class="nota">Copie o conteúdo e guarde em um arquivo .json.</p><textarea id="jsonExportado" readonly>' + esc(json) + '</textarea>', [
        { texto: 'Fechar' },
        { texto: 'Copiar', primario: true, acao: (j) => {
          const ta = j.querySelector('textarea');
          const selecionar = () => { ta.focus(); ta.select(); avisar('Texto selecionado: use Ctrl+C para copiar.'); };
          try { navigator.clipboard.writeText(json).then(() => avisar('Proposta copiada.'), selecionar); } catch (e) { selecionar(); }
          return false;
        } }
      ], true);
    },
    pdf: gerarPdf
  };

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
    let ymin = opts.ymin != null ? opts.ymin : Math.min(0, ...todos.map((p) => p.y)), ymax = opts.ymax != null ? opts.ymax : Math.max(...todos.map((p) => p.y));
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

  /** Pequenos múltiplos: um gráfico por modalidade, na mesma escala. */
  function multiplos(prefixo, titulo, subtitulo, series, opts, pdf) {
    const vals = series.flatMap((s) => s.pontos.map((p) => p.y).filter(C.isNum));
    if (!vals.length) return '<div class="grafico"><h3>' + esc(titulo) + '</h3><p class="nc">Não calculado: complete os dados do plano.</p></div>';
    const yt = ticks(Math.min(0, ...vals), Math.max(...vals), 4);
    const o = Object.assign({}, opts, { ymin: yt[0], ymax: yt[yt.length - 1] });
    return '<div class="multiplos-bloco"><h3>' + esc(titulo) + '</h3><p class="g-sub">' + esc(subtitulo) + '</p><div class="multiplos">' +
      series.map((s) => graficoLinhas(prefixo + '-' + s.mod, s.nome, '', [s], o, pdf)).join('') + '</div></div>';
  }

  function secProjecoes(r, pdf) {
    const p = r.projecoes;
    const partes = [];
    const pre = pdf ? 'p' : '';
    const mesC = C.num(estado.plano.mesContemplacao);
    if (p.parcelas) partes.push(multiplos(pre + 'g-parcelas', 'Parcelas mês a mês', 'Parcela total (plano, adesão e seguro) em cada forma de contemplação. Após a contemplação, a parcela reflete a recomposição do redutor e o abatimento do lance.', p.parcelas, { marcaX: mesC, marcaRotulo: 'contemplação' }, pdf));
    if (p.credito) partes.push(graficoColunas(pre + 'g-credito', 'Crédito atualizado por ano', 'Crédito contratado reajustado anualmente pelo índice ' + C.nomeIndice(estado.plano) + (C.indiceEstimado(estado.plano) ? ' (taxa estimada)' : '') + '.', p.credito, pdf));
    if (p.rentabilidade) partes.push(multiplos(pre + 'g-rentab', 'Rentabilidade da venda conforme o mês de contemplação', 'Lucro estimado se a carta for contemplada no mês indicado e vendida por ' + C.REGRAS.vendaPct + '% do crédito disponível. No detalhe, entre parênteses: lucro ÷ aporte.', p.rentabilidade, { marcaX: mesC, marcaRotulo: 'projeção', rotuloX: (x) => 'Contemplação no mês ' + x }, pdf));
    if (!partes.length) return '';
    return partes.join('') + '<p class="aviso-inline">Projeções estimadas, sem garantia de contemplação, venda ou rentabilidade.</p>';
  }

  // ---------------------------------------------------------------------------
  // Área de resultados
  // ---------------------------------------------------------------------------

  const AVISO = 'Esta simulação depende dos dados do grupo, do contrato, das regras da administradora e das premissas inseridas. Os valores são estimativas e não constituem valores contratuais. Não há garantia de contemplação, venda, lucro, valorização ou rentabilidade.';

  const OLHO = {
    aberto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    fechado: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.3 6.8C3.9 8.5 2.5 12 2.5 12S6 18.5 12 18.5a9.7 9.7 0 0 0 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
  };

  /** Botão de olho: mostra ou oculta dados ao cliente. */
  function botaoOlho(id, rotulo) {
    const vis = revelados.has(id);
    return '<button type="button" class="olho' + (vis ? ' ativo' : '') + '" data-olho="' + id + '" aria-pressed="' + vis + '" aria-label="' + (vis ? 'Ocultar ' : 'Mostrar ') + esc(rotulo) + '" title="' + (vis ? 'Ocultar' : 'Mostrar') + '">' + (vis ? OLHO.aberto : OLHO.fechado) + '</button>';
  }

  function tituloSecao(a, b, eyebrow) {
    return (eyebrow ? '<p class="eyebrow">' + esc(eyebrow) + '</p>' : '') + '<h2 class="titulo-vitrine">' + (a ? esc(a) + ' ' : '') + '<span class="acento">' + esc(b) + '</span></h2>';
  }

  function secResumo(s, r) {
    const R = r.resumo;
    const kpi = (rot, val, formato, cls, sufixo) => '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kpi-rot">' + rot + '</div><div class="kpi-val">' + fmt(val, formato) + (sufixo && val && val.v != null ? '<small class="kpi-suf"> ' + sufixo + '</small>' : '') + '</div></div>';
    return '<section class="bloco-res vitrine">' + tituloSecao('Resumo da', 'Proposta', 'Visão geral') + '<div class="kpis">' +
      kpi('Crédito', R.credito, 'brl', 'kpi-destaque') +
      kpi('Parcela inicial', R.parcelaInicial, 'brl', 'kpi-destaque') +
      kpi('Total de taxas', R.taxaAno, 'pct', '', 'a.a.') +
      kpi('Prazo', R.prazo, 'meses') +
      '</div></section>';
  }

  function secCaracteristicas(s, r) {
    const p = s.plano;
    const t = C.taxaIndice(p);
    const lista = [
      ['Tipo do plano', C.CATEGORIAS[p.categoria].nome],
      ['Administradora', p.administradora || 'Não selecionada'],
      ['Taxa administrativa', C.isNum(C.num(p.taxaAdm)) ? C.fmtPct(C.num(p.taxaAdm)) : '—'],
      ['Fundo de reserva', C.isNum(C.num(p.fundoReserva)) ? C.fmtPct(C.num(p.fundoReserva)) : '—'],
      ['Fator redutor', s.parcela.modalidade === 'integral' ? 'Não' : 'Sim / ' + C.fmtPct(r.redutorPct, 0)],
      ['Indexador de reajuste', C.nomeIndice(p) + (C.isNum(t) ? ' (' + C.fmtPct(t) + ' a.a.)' : '')],
      ['Seguro prestamista', p.seguroAtivo ? 'Sim (' + C.fmtPct(C.num(p.seguroPct), 3) + ' a.m.)' : 'Não'],
      ['Adesão', p.adesaoAtiva ? 'Sim (' + C.fmtPct(C.num(p.adesaoPct)) + ' em ' + (p.adesaoMeses || '—') + ' meses)' : 'Não'],
      ['Abatimento do lance', p.abatimento === 'prazo' ? 'Prazo' : 'Parcela'],
      ['Projeção de contemplação', String(p.mesContemplacao || '—')]
    ];
    return '<section class="bloco-res vitrine">' + tituloSecao('Características do', 'Plano', 'Condições') +
      '<dl class="lista-info">' + lista.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl></section>';
  }

  function cartaoForma(s, cen, pdf) {
    const n = cen.nucleo;
    const id = cen.id || 'forma-' + cen.mod;
    const oculto = cen.mod !== 'sorteio' && !revelados.has(id);
    let h = '<article class="forma"><header class="forma-topo"><span class="forma-icone">' + icone(cen.mod) + '</span><h3>' + esc(cen.nome) + (cen.sub ? '<small class="forma-sub">' + esc(cen.sub) + '</small>' : '') + '</h3>' +
      (cen.mod !== 'sorteio' && !pdf ? botaoOlho(id, 'valores do ' + cen.nome.toLowerCase()) : '') + '</header>';
    if (!n.ok) return h + '<p class="nc forma-msg">' + esc(cen.motivo) + '</p></article>';
    const base = n.credBruto;
    const pct = (v) => (C.isNum(v) && C.isNum(base) && base > 0 ? '(' + C.fmtNum((v / base) * 100, 0) + '%) ' : '');
    const v = (x) => (C.isNum(x) ? C.fmtBRL(x) : '<span class="nc">Não calculado</span>');
    const linha = (rot, val, cls) => '<div class="forma-linha' + (cls ? ' ' + cls : '') + '"><span>' + rot + '</span><b>' + val + '</b></div>';
    h += '<div class="forma-dados' + (oculto ? ' borrado' : '') + '"' + (oculto ? ' aria-hidden="true"' : '') + '>';
    h += linha('Crédito contratado', v(base), 'forte');
    h += linha('Lance embutido', pct(n.embutido) + v(n.embutido));
    h += linha('Lance recursos próprios', pct(n.proprios) + v(n.proprios));
    h += linha('Crédito disponível', v(n.credLiquido), 'realce');
    h += linha('Prazo remanescente', n.prazoRestante + ' meses');
    h += linha('Parcela pós-contemplação', v(n.parcelaPosAtual), 'acento-valor');
    h += linha('Saldo devedor', v(n.saldoDevedor));
    return h + '</div></article>';
  }

  function secFormas(s, r, pdf) {
    const cens = pdf ? r.cenarios.filter((c) => c.mod === 'sorteio' || revelados.has('forma-' + c.mod)) : r.cenarios;
    return '<section class="bloco-res vitrine">' + tituloSecao('Formas de', 'Contemplação', 'Comparativo') +
      '<p class="g-sub">Comparação de Estratégias de Contemplação</p>' +
      '<div class="formas">' + cens.map((c) => cartaoForma(s, c, pdf)).join('') + '</div></section>';
  }

  /** Bônus de Fidelidade: cartões no mesmo formato do Lance Embutido. */
  function secFidelidade(s, r) {
    if (!r.fidelidade.length) return '';
    const cards = r.fidelidade.map((f) => cartaoForma(s, {
      mod: 'fidelidade', id: 'fidelidade-' + f.i, nome: f.nome,
      sub: 'A partir da ' + (C.isNum(f.parcela) ? f.parcela + 'ª' : '—') + ' parcela · ' + (C.isNum(f.pct) ? C.fmtNum(f.pct, Number.isInteger(f.pct) ? 0 : 2) + '%' : '—') + ' de embutido',
      nucleo: f.nucleo, motivo: 'Não calculado: ' + f.nucleo.pend.join('; ') + '.'
    }, false));
    return '<section class="bloco-res vitrine">' + tituloSecao('Bônus', 'Fidelidade', 'Extra · Lance Fidelidade') +
      '<p class="g-sub">Lance 100% embutido liberado a partir da parcela de cada opção</p>' +
      '<div class="formas">' + cards.join('') + '</div></section>';
  }

  function tabelaAlavancagem(a, pdf) {
    const id = 'venda-' + a.mod;
    const oculto = !revelados.has(id);
    const f = (x) => (C.isNum(x) ? C.fmtBRL(x) : '<span class="nc">n/c</span>');
    const cor = (x) => (C.isNum(x) ? (x >= 0 ? 'positivo' : 'negativo') : '');
    return '<div class="alav"><h3 class="alav-titulo">Alavancagem via <span class="acento">' + esc(a.nome) + '</span>' + (pdf ? '' : botaoOlho(id, 'cenário de venda via ' + a.nome.toLowerCase())) + '</h3>' +
      '<div class="rolagem-x' + (oculto ? ' borrado' : '') + '"' + (oculto ? ' aria-hidden="true"' : '') + '><table class="tab-alav"><thead><tr><th>Mês</th><th>Crédito</th><th>Parcela atual</th><th>Aporte</th><th>Vl. venda</th><th>Lucro (R$)</th><th>Rentab. a.m.</th></tr></thead><tbody>' +
      a.linhas.map((l) => '<tr><td>' + l.m + '</td><td>' + f(l.credito) + '</td><td>' + f(l.parcela) + '</td><td>' + f(l.aporte) + '</td><td>' + f(l.venda) + '</td><td class="' + cor(l.lucro) + '">' + f(l.lucro) + '</td><td class="' + cor(l.rentabilidade) + '">' + (C.isNum(l.rentabilidade) ? C.fmtPct(l.rentabilidade, 2) : '—') + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function secAlavancagem(r, pdf) {
    const tabs = pdf ? r.alavancagem.filter((a) => revelados.has('venda-' + a.mod)) : r.alavancagem;
    if (!tabs.length) return '';
    return '<section class="bloco-res vitrine">' + tituloSecao('Simulação de', 'Alavancagem', 'Cenários de venda') +
      tabs.map((a) => tabelaAlavancagem(a, pdf)).join('') + '</section>';
  }

  /** Mecanismo de Alavancagem: reaplicação da venda (ou do lucro) da carta em novas cartas. */
  function secMecanismo(r) {
    const M = r.mecanismo;
    if (!M) return '';
    let h = '<section class="bloco-res vitrine">' + tituloSecao('Mecanismo de', 'Alavancagem', 'Extra · Reaplicação em novas cartas');
    if (!M.ok) return h + '<p class="nc">Não calculado: ' + esc((M.pend || []).join('; ') || 'dados incompletos') + '.</p></section>';
    const v = (x) => (C.isNum(x) ? C.fmtBRL(x) : '—');
    const rotBase = M.base === 'lucro' ? 'Lucro' : 'Valor de venda';
    h += '<p class="g-sub">' + rotBase + ' da carta via ' + esc(M.nomeOrigem) + ' no mês ' + M.mesOrigem + ' reaplicado em novas cartas do mesmo plano, contempladas e vendidas no mês ' + M.mesNovas + '.</p>';
    h += '<div class="mec-capital"><div><span>Capital para reaplicar</span><b>' + v(M.capital) + '</b><small>' + rotBase + ' · mês ' + M.mesOrigem + '</small></div>' +
      '<div><span>Por nova carta</span><b>' + v(M.carta.credito) + '</b><small>Parcela inicial ' + v(M.carta.parcela) + ' · venda no mês ' + M.mesNovas + ' ' + v(M.carta.venda) + '</small></div></div>';
    if (!M.cenarios.length) return h + '<p class="nc">Informe a quantidade de cartas em pelo menos um cenário.</p></section>';
    const linha = (rot, val, cls) => '<div class="forma-linha' + (cls ? ' ' + cls : '') + '"><span>' + rot + '</span><b>' + val + '</b></div>';
    h += '<div class="formas">' + M.cenarios.map((c) => {
      const id = 'mecanismo-' + c.i;
      const oculto = !revelados.has(id);
      let k = '<article class="forma"><header class="forma-topo"><span class="forma-icone">' + icone('mecanismo') + '</span><h3>Cenário ' + c.i +
        '<small class="forma-sub">' + c.q + (c.q === 1 ? ' nova carta' : ' novas cartas') + '</small></h3>' + botaoOlho(id, 'valores do cenário ' + c.i) + '</header>';
      k += '<div class="forma-dados' + (oculto ? ' borrado' : '') + '"' + (oculto ? ' aria-hidden="true"' : '') + '>';
      k += linha('Crédito total', v(c.credito), 'forte');
      k += linha('Parcela inicial total', v(c.parcelaInicial));
      k += linha('Aporte até o mês ' + M.mesNovas, v(c.aporte));
      k += linha('Pago com o capital', v(c.coberto) + ' · ' + c.mesesCobertos + (c.mesesCobertos === 1 ? ' mês' : ' meses'));
      k += c.adicional > 0.005 ? linha('Aporte adicional do cliente', v(c.adicional), 'negativo-valor') : linha('Sobra do capital', v(c.sobra));
      k += linha('Venda no mês ' + M.mesNovas, v(c.venda), 'realce');
      k += linha('Lucro das novas cartas', v(c.lucro), 'acento-valor');
      k += linha('Patrimônio projetado', v(c.patrimonio), 'forte');
      return k + '</div></article>';
    }).join('') + '</div>';
    return h + '<p class="nota mec-nota">Patrimônio projetado = venda das novas cartas + sobra do capital. Venda estimada em ' + C.REGRAS.vendaPct + '% do crédito disponível, sem garantia.</p></section>';
  }

  function cartaoAquisicao(a) {
    let h = '<article class="forma aquisicao"><header class="forma-topo"><span class="forma-icone">' + icone(a.mod) + '</span><h3>' + esc(a.nome) + '</h3></header>';
    if (!a.ok) return h + '<p class="nc forma-msg">Não calculado: ' + esc((a.pend || []).join('; ') || 'dados incompletos') + '.</p></article>';
    const v = (x) => (C.isNum(x) ? C.fmtBRL(x) : '—');
    const linha = (rot, val, cls) => '<div class="forma-linha' + (cls ? ' ' + cls : '') + '"><span>' + rot + '</span><b>' + val + '</b></div>';
    h += '<div class="cet"><span>CET</span><b>' + (C.isNum(a.cetAno) ? C.fmtPct(a.cetAno, 2) + ' a.a.' : '—') + '</b><small>' + (C.isNum(a.cetMes) ? C.fmtPct(a.cetMes, 3) + ' a.m.' : '') + '</small></div>';
    h += linha('Crédito para aquisição', v(a.credito), 'forte');
    h += linha('Parcela atual pós-contemplação', v(a.parcelaPos), 'acento-valor');
    h += linha('Retorno mensal de locação (' + C.fmtNum(C.REGRAS.locacaoPct, 1) + '%)', v(a.locacao));
    h += linha('Total desembolsado', v(a.desembolso), 'realce');
    h += linha('Custo da aquisição', v(a.custo) + (C.isNum(a.custoPct) ? ' (' + C.fmtPct(a.custoPct, 1) + ')' : ''));
    h += linha('Prazo total', a.prazoEfetivo + ' meses');
    return h + '</article>';
  }

  function secAquisicao(r) {
    if (!r.aquisicao.length) return '';
    return '<section class="bloco-res vitrine">' + tituloSecao('Simulação de', 'Aquisição', 'Cenário de aquisição') +
      '<p class="g-sub">Uso da carta para comprar o imóvel: custo efetivo total (CET) com os reajustes das parcelas até o fim do plano.</p>' +
      '<div class="formas">' + r.aquisicao.map(cartaoAquisicao).join('') + '</div></section>';
  }

  function cabecalho(s, pdf) {
    const ident = [C.CATEGORIAS[s.plano.categoria].nome, s.plano.administradora].filter(Boolean).map(esc).join(' · ');
    return '<header class="topo' + (pdf ? ' p-topo' : '') + '"><div class="topo-texto"><h1 class="titulo-proposta">Proposta de <span class="acento">Consórcio</span></h1>' +
      '<p class="cliente">' + (s.plano.lead ? esc(s.plano.lead) : '<span class="mudo">Nome do cliente</span>') + '</p>' +
      '<p class="sub-topo">' + ident + (pdf ? ' · Emitida em ' + new Date().toLocaleDateString('pt-BR') : '') + '</p></div>' +
      (pdf ? '' : seletorTema()) + '</header>';
  }

  function desenhar(r) {
    const s = estado;
    graficos.clear();
    let h = cabecalho(s, false);
    h += secResumo(s, r);
    h += secCaracteristicas(s, r);
    h += secFormas(s, r, false);
    h += secFidelidade(s, r);
    h += secAlavancagem(r, false);
    h += secMecanismo(r);
    h += secAquisicao(r);
    const proj = secProjecoes(r, false);
    if (proj) h += '<section class="bloco-res vitrine">' + tituloSecao('Cenários', 'futuros', 'Projeções') + proj + '</section>';
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

  // ---------------------------------------------------------------------------
  // Proposta em PDF: 3 páginas A4 com layout próprio
  // ---------------------------------------------------------------------------

  function numeroWhatsapp(txt) {
    let d = String(txt || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length <= 11) d = '55' + d;
    return d;
  }

  function pdfLinhas(pares) {
    return '<div class="pdf-linhas">' + pares.map(([rot, val, cls]) => '<div class="pdf-linha' + (cls ? ' ' + cls : '') + '"><span>' + rot + '</span><b>' + val + '</b></div>').join('') + '</div>';
  }

  function pdfTitulo(a, b) {
    return '<h2 class="pdf-h2">' + esc(a) + ' <span class="acento">' + esc(b) + '</span></h2>';
  }

  function pdfPagina(n, total, s, corpo) {
    return '<section class="pdf-pagina"><div class="pdf-corpo">' + corpo + '</div>' +
      '<footer class="pdf-rodape"><span>' + esc(s.plano.lead) + '</span><span>' + n + ' / ' + total + '</span></footer></section>';
  }

  function pdfCartaoForma(n, mod, nome, sub) {
    const v = (x) => (C.isNum(x) ? C.fmtBRL(x) : '—');
    const base = n.credBruto;
    const pct = (x) => (C.isNum(x) && C.isNum(base) && base > 0 ? '(' + C.fmtNum((x / base) * 100, 0) + '%) ' : '');
    let h = '<article class="pdf-cartao"><header><span class="forma-icone">' + icone(mod) + '</span><h3>' + esc(nome || C.NOMES_MOD[mod]) + (sub ? '<small class="pdf-sub">' + esc(sub) + '</small>' : '') + '</h3></header>';
    if (!n.ok) return h + '<p class="nc">Não calculado</p></article>';
    return h + pdfLinhas([
      ['Crédito contratado', v(base), 'forte'],
      ['Lance embutido', pct(n.embutido) + v(n.embutido)],
    ].concat([
      ['Recursos próprios', pct(n.proprios) + v(n.proprios)],
      ['Crédito disponível', v(n.credLiquido), 'realce'],
      ['Prazo remanescente', n.prazoRestante + ' meses'],
      ['Parcela pós-contemplação', v(n.parcelaPosAtual), 'acento-valor'],
      ['Saldo devedor', v(n.saldoDevedor)]
    ])) + '</article>';
  }

  function montarProposta(s, r) {
    const data = new Date().toLocaleDateString('pt-BR');
    const p = s.plano;
    const R = r.resumo;
    const t = C.taxaIndice(p);
    const fid = r.fidelidade || [];
    const total = 3;
    const nucleo = (mod) => { const c = r.cenarios.find((x) => x.mod === mod); return c ? c.nucleo : null; };

    // Página 1: dados da proposta, características e formas de contemplação
    const kpi = (rot, val, formato, cls, suf) => '<div class="pdf-kpi' + (cls ? ' ' + cls : '') + '"><span>' + rot + '</span><b>' + fmt(val, formato) + (suf && val && val.v != null ? '<small> ' + suf + '</small>' : '') + '</b></div>';
    const ident = [C.CATEGORIAS[p.categoria].nome, p.administradora].filter(Boolean).map(esc).join(' · ');
    let p1 = '<header class="pdf-topo"><p class="eyebrow">Emitida em ' + data + '</p><h1>Proposta de <span class="acento">Consórcio</span></h1>' +
      '<p class="pdf-cliente">' + esc(p.lead) + '</p><p class="pdf-ident">' + ident + '</p></header>';
    p1 += '<div class="pdf-kpis">' + kpi('Crédito', R.credito, 'brl', 'destaque') + kpi('Parcela inicial', R.parcelaInicial, 'brl', 'destaque') + kpi('Total de taxas', R.taxaAno, 'pct', '', 'a.a.') + kpi('Prazo', R.prazo, 'meses') + '</div>';
    const carac = [
      ['Tipo do plano', C.CATEGORIAS[p.categoria].nome],
      ['Administradora', p.administradora || '—'],
      ['Taxa administrativa', C.isNum(C.num(p.taxaAdm)) ? C.fmtPct(C.num(p.taxaAdm)) : '—'],
      ['Fundo de reserva', C.isNum(C.num(p.fundoReserva)) ? C.fmtPct(C.num(p.fundoReserva)) : '—'],
      ['Fator redutor', s.parcela.modalidade === 'integral' ? 'Não' : 'Sim / ' + C.fmtPct(r.redutorPct, 0)],
      ['Indexador de reajuste', C.nomeIndice(p) + (C.isNum(t) ? ' (' + C.fmtPct(t) + ' a.a.)' : '')],
      ['Seguro prestamista', p.seguroAtivo ? 'Sim (' + C.fmtPct(C.num(p.seguroPct), 3) + ' a.m.)' : 'Não'],
      ['Adesão', p.adesaoAtiva ? 'Sim (' + C.fmtPct(C.num(p.adesaoPct)) + ' em ' + (p.adesaoMeses || '—') + ' meses)' : 'Não'],
      ['Abatimento do lance', p.abatimento === 'prazo' ? 'Prazo' : 'Parcela'],
      ['Projeção de contemplação', String(p.mesContemplacao || '—')]
    ];
    p1 += '<div class="pdf-bloco">' + pdfTitulo('Características do', 'Plano') + '<dl class="pdf-carac">' + carac.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl></div>';
    const mods1 = ['sorteio', 'embutido', 'fixo'].filter((m) => nucleo(m));
    p1 += '<div class="pdf-bloco">' + pdfTitulo('Formas de', 'Contemplação') + '<div class="pdf-grade c' + mods1.length + '">' + mods1.map((m) => pdfCartaoForma(nucleo(m), m)).join('') + '</div></div>';

    // Página 2: panorama de venda e alavancagem
    const f = (x) => (C.isNum(x) ? C.fmtBRL(x) : '—');
    const cor = (x) => (C.isNum(x) ? (x >= 0 ? 'positivo' : 'negativo') : '');
    let p2 = '<header class="pdf-topo menor"><p class="eyebrow">Cenários de venda</p><h1>Panorama de <span class="acento">Alavancagem</span></h1>' +
      '<p class="pdf-ident">Venda da carta contemplada estimada em ' + C.REGRAS.vendaPct + '% do crédito disponível. Aporte: parcelas pagas até o mês.</p></header>';
    r.alavancagem.forEach((a) => {
      p2 += '<div class="pdf-bloco">' + pdfTitulo('Alavancagem via', a.nome) +
        '<table class="pdf-tab"><thead><tr><th>Mês</th><th>Crédito</th><th>Parcela atual</th><th>Aporte</th><th>Vl. venda</th><th>Lucro (R$)</th><th>Rentab. a.m.</th></tr></thead><tbody>' +
        a.linhas.map((l) => '<tr><td>' + l.m + '</td><td>' + f(l.credito) + '</td><td>' + f(l.parcela) + '</td><td>' + f(l.aporte) + '</td><td>' + f(l.venda) + '</td><td class="' + cor(l.lucro) + '">' + f(l.lucro) + '</td><td class="' + cor(l.rentabilidade) + '">' + (C.isNum(l.rentabilidade) ? C.fmtPct(l.rentabilidade, 2) : '—') + '</td></tr>').join('') +
        '</tbody></table></div>';
    });
    if (!r.alavancagem.length) p2 += '<p class="nc">Não calculado: complete os dados do plano.</p>';

    // Página 3: aquisição, contato e avisos
    let p3 = '<header class="pdf-topo menor"><p class="eyebrow">Cenário de aquisição</p><h1>Simulação de <span class="acento">Aquisição</span></h1>' +
      '<p class="pdf-ident">Uso da carta para comprar o ' + (p.categoria === 'veiculo' ? 'veículo' : 'imóvel') + ': custo efetivo total (CET) com os reajustes das parcelas até o fim do plano.</p></header>';
    const aq = r.aquisicao;
    p3 += '<div class="pdf-grade c' + Math.max(1, aq.length) + '">' + aq.map((a) => {
      let h = '<article class="pdf-cartao"><header><span class="forma-icone">' + icone(a.mod) + '</span><h3>' + esc(a.nome) + '</h3></header>';
      if (!a.ok) return h + '<p class="nc">Não calculado</p></article>';
      h += '<div class="pdf-cet"><span>CET</span><b>' + (C.isNum(a.cetAno) ? C.fmtPct(a.cetAno, 2) : '—') + '<small> a.a.</small></b><em>' + (C.isNum(a.cetMes) ? C.fmtPct(a.cetMes, 3) + ' a.m.' : '') + '</em></div>';
      return h + pdfLinhas([
        ['Crédito para aquisição', f(a.credito), 'forte'],
        ['Parcela atual pós-contemplação', f(a.parcelaPos), 'acento-valor'],
        ['Retorno mensal de locação (' + C.fmtNum(C.REGRAS.locacaoPct, 1) + '%)', f(a.locacao)],
        ['Total desembolsado', f(a.desembolso), 'realce'],
        ['Custo da aquisição', f(a.custo)],
        ['Prazo total', a.prazoEfetivo + ' meses']
      ]) + '</article>';
    }).join('') + '</div>';
    // Bônus Fidelidade (quando habilitado): abaixo da aquisição e antes do contato com o especialista
    if (fid.length) {
      p3 += '<div class="pdf-bloco pdf-fid">' + pdfTitulo('Bônus', 'Fidelidade') +
        '<p class="pdf-ident">Extra · Lance 100% embutido liberado a partir da parcela de cada opção, sem recursos próprios; percentual sobre o crédito atualizado no mês da contemplação.</p>' +
        '<div class="pdf-grade c' + fid.length + '">' + fid.map((x) => pdfCartaoForma(x.nucleo, 'fidelidade', x.nome,
        'A partir da ' + (C.isNum(x.parcela) ? x.parcela + 'ª' : '—') + ' parcela · ' + (C.isNum(x.pct) ? C.fmtNum(x.pct, Number.isInteger(x.pct) ? 0 : 2) + '%' : '—') + ' de embutido')).join('') + '</div></div>';
    }
    const wa = numeroWhatsapp((window.CONFIG_SIMULADOR || {}).whatsappEspecialista);
    const msg = encodeURIComponent('Olá! Recebi a proposta de consórcio' + (p.lead ? ' de ' + p.lead : '') + ' e gostaria de conversar.');
    p3 += '<div class="pdf-cta"><div><h3>Vamos dar o próximo passo?</h3><p>Fale com o especialista para tirar dúvidas e seguir com a proposta.</p></div>' +
      (wa ? '<a class="pdf-botao" href="https://wa.me/' + wa + '?text=' + msg + '">Falar no WhatsApp</a>' : '<span class="pdf-botao inativo">Falar no WhatsApp</span>') + '</div>';
    p3 += '<div class="pdf-disclaimer"><b>Importante</b><p>' + esc(AVISO) + ' Mês de contemplação projetado, sem garantia de ocorrência. Valores de venda e CET são estimativas baseadas nas premissas informadas e no índice de reajuste estimado.</p></div>';

    const html = [p1, p2, p3].map((c, i) => pdfPagina(i + 1, total, s, c)).join('');
    return { html, data, semWhatsapp: !wa };
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
    if (!lead) { avisar('Informe o nome completo do cliente antes de gerar a proposta.'); $('#f-lead').focus(); return; }
    const foneCliente = numeroWhatsapp(s.contato && s.contato.cliente);
    if (foneCliente.length < 12) { avisar('Informe o contato (WhatsApp) do cliente com DDD antes de gerar a proposta.'); $('#f-contato').focus(); return; }
    const erros = r.validacoes.filter((v) => v.nivel === 'erro');
    const prop = montarProposta(s, r);
    $('#proposta').innerHTML = prop.html;
    const nota = (erros.length ? '<p class="aviso">Há ' + erros.length + ' erro(s) de preenchimento. Os itens afetados aparecem como "Não calculado".</p>' : '') +
      (prop.semWhatsapp ? '<p class="aviso">O botão "Falar no WhatsApp" da página 3 está sem número: informe o WhatsApp do especialista em js/config.js.</p>' : '');
    const envio = '<div class="envio"><div><b>Enviar ao cliente</b><p>Clique em <b>Gerar proposta</b>: o PDF é baixado e a mensagem para o WhatsApp de ' + esc(s.contato.cliente) + ' fica pronta para copiar.</p></div>' +
      '<button type="button" class="botao-whats" data-gerar-proposta>Gerar proposta</button></div>' +
      '<div class="mensagem-envio" hidden><div class="mensagem-topo"><b>Mensagem para o WhatsApp</b><button type="button" class="botao-copiar" data-copiar-msg>Copiar mensagem</button></div>' +
      '<textarea readonly rows="12" aria-label="Mensagem para o WhatsApp">' + esc(mensagemWhatsapp(s, r)) + '</textarea></div>';
    const fundo = janela('<h2>Prévia da proposta</h2>' + nota + envio + '<div class="previa">' + prop.html + '</div>', [{ texto: 'Fechar' }], true);
    const botao = fundo.querySelector('[data-gerar-proposta]');
    const caixa = fundo.querySelector('.mensagem-envio');
    const texto = caixa.querySelector('textarea');
    fundo.querySelector('[data-copiar-msg]').addEventListener('click', () => copiarMensagem(texto));
    botao.addEventListener('click', async () => {
      caixa.hidden = false;
      botao.disabled = true;
      botao.textContent = 'Gerando PDF…';
      try {
        const blob = await gerarPdfArquivo(prop.html);
        await baixarArquivo(blob, 'Proposta_' + nomeArquivo(lead) + '_' + prop.data.replace(/\//g, '-') + '.pdf');
        avisar('PDF gerado. Copie a mensagem e envie ao cliente com o arquivo.');
      } catch (e) {
        if (e && e.code === 'declined') avisar('Download cancelado.');
        else if (!window.MODO_ARTIFACT) { avisar('Não foi possível gerar o arquivo automaticamente; use "Salvar em PDF" na impressão.'); imprimir(lead, prop.data); }
        else avisar('Não foi possível baixar o PDF nesta versão on-line. Use o arquivo index.html do simulador.');
      }
      botao.disabled = false;
      botao.textContent = 'Gerar proposta';
      copiarMensagem(texto, true);
    });
  }

  /** Mensagem curta para o WhatsApp: primeiro nome em negrito, dados do plano em destaque e reforço do Lance Fidelidade. */
  function mensagemWhatsapp(s, r) {
    const p = s.plano;
    const R = r.resumo;
    const primeiro = String(p.lead || '').trim().split(/\s+/)[0] || '';
    const v = (x) => (C.isNum(x) ? C.fmtBRL(x) : '—');
    const linhas = [
      'Olá, *' + primeiro + '*! Tudo bem?',
      '',
      'Conforme conversamos, segue abaixo o PDF da proposta apresentada em reunião. Os destaques:',
      '',
      '🏷️ *Consórcio de ' + C.CATEGORIAS[p.categoria].nome + '*',
      '💰 Crédito: *' + v(R.credito.v) + '*',
      '📅 Prazo: *' + (C.isNum(R.prazo.v) ? R.prazo.v + ' meses' : '—') + '*',
      '🏢 Administradora: *' + (p.administradora || '—') + '*',
      '💳 Parcela inicial: *' + v(R.parcelaInicial.v) + '*'
    ];
    const fid = (r.fidelidade || []).filter((f) => f.nucleo.ok);
    if (fid.length) {
      linhas.push('', '⭐ *Bônus Fidelidade* (lance 100% embutido, com o próprio crédito):');
      fid.forEach((f) => linhas.push('• ' + f.parcela + 'ª parcela: *' + v(f.nucleo.embutido) + '* (' + C.fmtNum(f.pct, Number.isInteger(f.pct) ? 0 : 2) + '%)'));
    }
    linhas.push('', 'Qualquer dúvida, estou à disposição! 😉');
    return linhas.join('\n');
  }

  function copiarMensagem(texto, silencioso) {
    const ok = () => { if (!silencioso) avisar('Mensagem copiada. É só colar no WhatsApp.'); };
    const manual = () => { texto.focus(); texto.select(); if (!silencioso) avisar('Selecione e copie a mensagem (Ctrl+C).'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto.value).then(ok, manual);
      else { texto.select(); if (document.execCommand('copy')) ok(); else manual(); }
    } catch (e) { manual(); }
  }

  // Geração do arquivo PDF no navegador (html2canvas + jsPDF, carregados sob demanda)
  // Cópias locais em js/vendor (funciona sem internet); a versão on-line usa o CDN
  const LIBS_PDF = [
    { global: 'html2canvas', local: 'js/vendor/html2canvas.min.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' },
    { global: 'jspdf', local: 'js/vendor/jspdf.umd.min.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' }
  ];
  function carregarScript(src) {
    return new Promise((ok, erro) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = ok;
      el.onerror = () => { el.remove(); erro(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(el);
    });
  }
  async function carregarLib(lib) {
    if (window[lib.global]) return;
    if (!window.MODO_ARTIFACT) { try { await carregarScript(lib.local); if (window[lib.global]) return; } catch (e) { /* tenta o CDN */ } }
    await carregarScript(lib.cdn);
  }

  async function gerarPdfArquivo(html) {
    for (const lib of LIBS_PDF) await carregarLib(lib);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const area = document.createElement('div');
    area.className = 'pdf-render';
    area.innerHTML = html;
    document.body.appendChild(area);
    try {
      const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      const paginas = area.querySelectorAll('.pdf-pagina');
      // As páginas são montadas em escala ampliada (--k no CSS) e capturadas reduzidas: mesma resolução final
      const k = parseFloat(getComputedStyle(area).getPropertyValue('--k')) || 1;
      for (let i = 0; i < paginas.length; i++) {
        const pg = paginas[i];
        const canvas = await window.html2canvas(pg, { scale: 2 / k, backgroundColor: '#0D1B2A', logging: false, useCORS: true });
        if (i) doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
        // Mantém os links (botão do WhatsApp) clicáveis no PDF
        const base = pg.getBoundingClientRect();
        const kx = 210 / base.width, ky = 297 / base.height;
        pg.querySelectorAll('a[href]').forEach((a) => {
          const q = a.getBoundingClientRect();
          doc.link((q.left - base.left) * kx, (q.top - base.top) * ky, q.width * kx, q.height * ky, { url: a.href });
        });
      }
      return doc.output('blob');
    } finally {
      area.remove();
    }
  }

  async function baixarArquivo(blob, nome) {
    if (window.MODO_ARTIFACT) {
      const downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (!downloads) throw { code: 'unavailable' };
      await downloads.save({ filename: nome, data: blob });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
  // Dados enviados pelo CRM no botão "Gerar proposta" (?nome=...&contato=..., também aceitos depois do #).
  // Preenche apenas o nome completo e o contato do cliente; os demais campos continuam como estavam.
  let planoCrm = '';
  definirPlanos((window.CONFIG_SIMULADOR || {}).planos);
  const doCrm = (function () {
    const ler = (txt) => { try { return new URLSearchParams(String(txt || '').replace(/^[?#]/, '')); } catch (e) { return new URLSearchParams(); } };
    const fontes = [ler(location.search), ler(location.hash)];
    const pegar = (k) => { for (const f of fontes) { const v = f.get(k); if (v && v.trim()) return v.trim(); } return ''; };
    const nome = pegar('nome');
    planoCrm = pegar('plano');
    let fone = pegar('contato').replace(/\D/g, '');
    if (fone.length > 11 && fone.startsWith('55')) fone = fone.slice(2);
    if (nome) estado.plano.lead = nome.slice(0, 80);
    if (fone) estado.contato.cliente = formatarTelefone(fone);
    return !!(nome || fone || planoCrm);
  })();
  try { if (localStorage.getItem('simconsorcio.menuOculto') === '1') document.body.classList.add('menu-oculto'); } catch (e) { /* sem armazenamento */ }
  try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => atualizar()); } catch (e) { /* navegador antigo */ }
  const aplicarPlanoCrm = (avisarFalta) => {
    if (!planoCrm) return false;
    if (selecionarPlano(planoCrm)) return true;
    if (avisarFalta) avisar('Plano "' + planoCrm + '" enviado pelo CRM não foi encontrado nos planos cadastrados.');
    return false;
  };
  const comUrlCrm = !!(window.CONFIG_SIMULADOR || {}).planosUrl;
  preencherSelects();
  let planoAplicado = aplicarPlanoCrm(!comUrlCrm);
  ligarMenu();
  escreverCampos();
  preencherSelects();
  atualizar();
  if (doCrm) avisar(planoAplicado ? 'Cliente e plano preenchidos pelo CRM.' : 'Nome e contato do cliente preenchidos pelo CRM.');
  // Planos do CRM (quando configurado): atualiza a lista e reaplica o plano pedido no link
  carregarPlanosCrm().then((ok) => {
    if (!ok) { if (comUrlCrm && !planoAplicado) aplicarPlanoCrm(true); return; }
    if (!planoAplicado && planoCrm) { planoAplicado = aplicarPlanoCrm(true); if (planoAplicado) avisar('Plano preenchido pelo CRM.'); }
    preencherSelects();
    escreverCampos();
    atualizar();
  });
})();
