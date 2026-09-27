// Gera dist/simulador.html: página única (CSS e JS embutidos) para publicação on-line.
// Nesse modo (window.MODO_ARTIFACT) a proposta é exibida em prévia e o JSON é copiado,
// porque impressão e downloads podem estar bloqueados pelo ambiente de hospedagem.
'use strict';
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

const html = ler('index.html');
const titulo = html.match(/<title>[\s\S]*?<\/title>/)[0];
const corpo = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="js/calc.js">')).trim();
const semEntidade = (js) => js.replace(/<\/script/gi, '<\\/script');

const saida = [
  titulo,
  '<style>\n' + ler('css/style.css') + '\n</style>',
  corpo,
  '<script>window.MODO_ARTIFACT = true;</script>',
  '<script>\n' + semEntidade(ler('js/calc.js')) + '\n</script>',
  '<script>\n' + semEntidade(ler('js/app.js')) + '\n</script>',
  ''
].join('\n');

fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'dist', 'simulador.html'), saida);
console.log('dist/simulador.html gerado (' + Math.round(saida.length / 1024) + ' KB)');
