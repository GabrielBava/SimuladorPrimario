# Simulador de Cartas de Consórcio Primárias

Simulador para montar propostas de consórcio e apresentá-las a leads: condições do plano, evolução do crédito e das parcelas, modalidades de contemplação, cenários hipotéticos de sorteio e de lance, e resultado financeiro estimado com memória de cálculo. Gera uma **proposta em PDF** com o nome do lead.

> A simulação depende dos dados do grupo, do contrato, das regras da administradora e das premissas inseridas. Não há garantia de contemplação, venda, lucro, valorização ou rentabilidade.

## Como usar

1. Abra `index.html` no navegador. Não há instalação nem servidor; funciona também offline.
2. Preencha as seções do menu lateral. Os resultados são atualizados automaticamente.
3. Clique em **Gerar proposta (PDF)** e confira a prévia. Na prévia, **Gerar proposta** baixa o PDF (`Proposta_<Nome>_<data>.pdf`) e prepara a mensagem para colar no WhatsApp do cliente.

Na primeira abertura aparece um exemplo com valores fictícios. **Nova proposta** limpa os campos e **Salvar proposta** baixa a proposta em arquivo .json.

## Versão on-line

`npm run build:online` gera `dist/simulador.html`, uma página única com CSS e JS embutidos, para publicação. Nessa versão o download do PDF pede confirmação do navegador, e o JSON da proposta é exibido para copiar.

## Identidade visual

O simulador segue o manual de identidade do CRM Consórcios (v1.0): paleta azul-noite, tema escuro e claro (botão **Claro | Escuro** no topo da proposta), Famels/Manrope em títulos e números, Poppins nos textos, ícones de traço e o monograma provisório "CC". Os tokens oficiais ficam em `css/tokens.css`; para usar a Famels licenciada, coloque os arquivos em `css/fonts/` (sem eles, a Manrope assume automaticamente).

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Tela: menu lateral (configuração) e área de resultados |
| `css/tokens.css` | Tokens oficiais do CRM Consórcios (cores, tipografia, forma, sombras; temas escuro e claro) |
| `css/style.css` | Componentes do simulador e layout das páginas do PDF |
| `js/config.js` | Número do especialista e planos cadastrados (ou endereço do CRM) |
| `js/vendor/` | html2canvas e jsPDF, usados para gerar o arquivo PDF |
| `js/calc.js` | Motor de cálculo puro (sem interface), com fórmulas, validações e memórias |
| `js/app.js` | Interface: vínculo dos campos, desenho dos resultados, ações e PDF |
| `tests/calc.test.js` | Testes do motor de cálculo |
| `docs/ESPECIFICACAO.md` | Especificação funcional completa (campos, regras, fórmulas, pendências) |

## Testes

```bash
npm test
```

Requer Node.js 18 ou superior. Não há dependências externas.
