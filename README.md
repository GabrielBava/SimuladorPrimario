# Simulador de Cartas de Consórcio Primárias

Simulador para montar propostas de consórcio e apresentá-las a leads: condições do plano, evolução do crédito e das parcelas, modalidades de contemplação, cenários hipotéticos de sorteio e de lance, e resultado financeiro estimado com memória de cálculo. Gera uma **proposta em PDF** com o nome do lead.

> A simulação depende dos dados do grupo, do contrato, das regras da administradora e das premissas inseridas. Não há garantia de contemplação, venda, lucro, valorização ou rentabilidade.

## Como usar

1. Abra `index.html` no navegador. Não há instalação nem servidor; funciona também offline.
2. Preencha as seções do menu lateral. Os resultados são atualizados automaticamente.
3. Clique em **Gerar proposta (PDF)** e, na janela de impressão, escolha **Salvar como PDF**. O arquivo é sugerido como `Proposta_<Lead>_<data>`.

Para ver o funcionamento, use **Carregar exemplo**. Os valores do exemplo são fictícios e não representam regras de nenhuma administradora.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Tela: menu lateral (configuração) e área de resultados |
| `css/style.css` | Estilo simples, com cores em variáveis, e layout de impressão da proposta |
| `js/calc.js` | Motor de cálculo puro (sem interface), com fórmulas, validações e memórias |
| `js/app.js` | Interface: vínculo dos campos, desenho dos resultados, ações e PDF |
| `tests/calc.test.js` | Testes do motor de cálculo |
| `docs/ESPECIFICACAO.md` | Especificação funcional completa (campos, regras, fórmulas, pendências) |

## Testes

```bash
npm test
```

Requer Node.js 18 ou superior. Não há dependências externas.
