# Especificação funcional — Simulador de Cartas de Consórcio Primárias

Versão 1.0 · Implementação de referência: `index.html`, `js/calc.js` (motor de cálculo) e `js/app.js` (interface).

> **Observação obrigatória:** a simulação depende dos dados do grupo, do contrato, das regras da administradora e das premissas inseridas. Nenhum valor é contratual. Não há garantia de contemplação, venda, lucro, valorização ou rentabilidade.

---

## 1. Estrutura e navegação

| Área | Conteúdo |
|---|---|
| **Barra de ferramentas** (topo do menu) | Gerar proposta (PDF) · Nova simulação · Salvar como padrão · Carregar exemplo (valores fictícios) · Exportar/Importar JSON · Restaurar padrão de fábrica |
| **Menu lateral (esquerda)**, seções recolhíveis | 1. Dados do plano · 2. Modalidade de pagamento · 3. Reajuste · 4. Recursos para lance · 5. Estratégias de contemplação · 6. Premissas de venda · 7. Fórmula do resultado · 8. Horizonte da projeção |
| **Área de resultados (direita)** | Aviso geral e legenda → Alertas (erros, regras a definir, informações) → Resumo (cartões) → Resumo geral da proposta + projeção anual + premissas → Modalidades de contemplação → Tabelas A e B → Demonstrativo mensal → Regras pendentes |
| **Proposta em PDF** | Gerada pela impressão do navegador ("Salvar como PDF"). O nome do arquivo sugerido é `Proposta_<Lead>_<data>`. Contém só o nome do lead e os dados da proposta, sem outros dados pessoais. |

Comportamento:
- Os resultados são recalculados a cada alteração de campo.
- **Nova simulação** volta à configuração padrão salva (ou à de fábrica) e limpa o nome do lead. **Salvar como padrão** grava a configuração atual, sem o nome do lead, no navegador.
- A simulação em andamento fica salva no navegador, só por conveniência. Para guardar ou compartilhar, use **Exportar JSON**.
- Todo valor exibido tem uma etiqueta de tipo (**Informado**, **Calculado**, **Estimado**, **Pendente**, **Não aplicável**) e uma **memória de cálculo** expansível com fórmula, valores, origem, observações e dependências.

Legenda de status dos campos: **Definido** (regra fornecida no escopo) · **Configurável** (premissa editável pelo consultor) · **Regra a definir** (depende da administradora/grupo; sem ela, o valor dependente não é calculado).

---

## 2–3. Campos do menu lateral e regras de negócio

### 2.1 Dados do plano

| Nome | Tipo de entrada | Unidade | Obrig. | Padrão | Regra de negócio | Efeito nos cálculos | Validações | Status |
|---|---|---|---|---|---|---|---|---|
| Nome do lead / identificação | Texto (até 80) | — | Sim | vazio | Identifica a proposta e o PDF | Nenhum cálculo; título e nome do arquivo | Obrigatório; exigido para gerar o PDF | Definido |
| Administradora | Texto | — | Não | vazio | Apenas identificação | Nenhum | — | Definido |
| Grupo | Texto | — | Não | vazio | Apenas identificação | Nenhum | — | Definido |
| Valor do crédito desejado | Número | R$ | Sim | vazio | Crédito contratado na data-base | Base de parcela, taxa, fundo de reserva, lance e venda | Obrigatório; > 0 | Definido |
| Prazo total | Inteiro | meses | Sim | vazio | Número de parcelas do plano | Divisor da fórmula da parcela; horizonte máximo | Obrigatório; inteiro ≥ 1; alerta > 420 | Definido |
| Mês inicial | Mês/ano | — | Não | vazio | Mês 1 da simulação | Apenas rótulos (ex.: "Mês 13 (out/2027)") | Informativo se ausente | Definido |
| Taxa de administração total | Número | % | Sim | vazio | Taxa total = % × crédito, diluída no prazo | Componente "Taxa adm. ÷ Prazo" da parcela | Obrigatório; 0–100% | Definido (fórmula informada) |
| Fundo de reserva — forma | Lista (% / R$) | — | Sim | % | Percentual sobre o crédito ou valor total | Define como o fundo de reserva total é obtido | — | Configurável |
| Fundo de reserva | Número | % ou R$ | Sim | vazio | Fundo total ÷ prazo por parcela | Componente da parcela | Obrigatório (0 se não houver); ≥ 0; ≤ 100 se % | Definido |
| Seguro contratado | Sim/Não | — | Não | Não | Se "Sim", exige regra de cobrança | Soma ao valor mensal pago | — | Configurável |
| Forma de cobrança do seguro | Lista | — | Se seguro | **Regra a definir** | Opções: % ao mês sobre o crédito atualizado; valor fixo mensal | Sem regra: parcela total e totais ficam "Não calculado" | Alerta se seguro ativo sem regra; erro se sem valor | **Regra a definir** |
| Valor do seguro | Número | % a.m. ou R$/mês | Se regra ≠ a definir | vazio | Conforme a forma escolhida | Seguro mensal | ≥ 0 | Configurável |
| Outros custos (lista) | Descrição, forma (a definir / único / mensal), valor, mês | R$ | Não | nenhum | Custos adicionais cobrados do participante | Somados ao total pago e deduzidos no resultado (se marcado) | Valor ≥ 0; mês dentro do prazo; alerta se forma a definir | Configurável / **Regra a definir** |

### 2.2 Modalidade de pagamento das parcelas

| Nome | Tipo | Unidade | Obrig. | Padrão | Regra de negócio | Efeito | Validações | Status |
|---|---|---|---|---|---|---|---|---|
| Modalidade | Lista: integral, redutor 50%, redutor 25%, outro % | — | Sim | Integral | Percentual de redução aplicado **somente ao fundo comum** | Fórmula da parcela | — | Definido |
| Percentual de redução (outro) | Número | % | Se "outro" | vazio | Redutor personalizado | Idem | > 0 e < 100 | Configurável |
| Redutor do mês / até o mês | Inteiros | mês | Se redutor | 1 / vazio | Período em que o redutor se aplica (inclusive) | Meses com parcela reduzida | Fim obrigatório (salvo "encerrar na contemplação"); fim ≥ início; alerta se cobre todo o prazo | Configurável |
| Encerrar na contemplação | Sim/Não | — | Não | Não | Se a contemplação ocorrer antes do fim, o último mês com redutor é o da contemplação | Muda o cronograma de cada cenário | — | Configurável |
| Momento de volta ao integral | Derivado | mês | — | — | Mês seguinte ao último mês com redutor | Início da recomposição | — | Definido |
| Regra de recomposição | Lista | — | Se redutor | **Regra a definir** | Opções: (a) diluir o percentual não pago nas parcelas restantes; (b) informar manualmente a parcela após o redutor | Sem regra: parcelas após o redutor ficam "Não calculado" | Alerta "Regra a definir: informe como o redutor é recomposto." | **Regra a definir** |
| Parcela após o redutor (manual) | Número | R$ (data-base, sem seguro) | Se manual | vazio | Valor informado, reajustado pelo índice da parcela | Parcelas pós-redutor | Obrigatório se manual | Configurável |

### 2.3 Reajuste

| Nome | Tipo | Unidade | Obrig. | Padrão | Regra de negócio | Efeito | Validações | Status |
|---|---|---|---|---|---|---|---|---|
| Índice de reajuste do crédito | Lista: Pré-fixado 5%, Pré-fixado 6%, IPCA, INCC, INPC, Outro, Sem reajuste | — | Sim | **Regra a definir** | Crédito atualizado = crédito × fator | Crédito bruto na contemplação, seguro % e bases de lance/venda | Alerta se a definir; erro se índice sem taxa | **Regra a definir** até escolha |
| Índice de reajuste da parcela | Mesma lista | — | Sim | **Regra a definir** | Reajuste sobre o crédito contratado; fundo comum, taxa adm. e fundo de reserva recalculados | Parcelas após o 1º reajuste | Idem | **Regra a definir** até escolha |
| Taxa estimada por reajuste | Número | % por reajuste | Se IPCA/INCC/INPC/Outro | vazio (sem taxa padrão) | Premissa de projeção do consultor | Fator de reajuste | Erro "sem premissa de projeção" se vazio | Configurável (estimativa) |
| Nome do índice (Outro) | Texto | — | Não | vazio | Rótulo | — | — | Configurável |
| Periodicidade | Inteiro | meses | Sim | 12 | Intervalo entre reajustes | Nº de reajustes | ≥ 1 | Configurável (confirmar com a administradora) |
| 1º reajuste no mês | Inteiro | mês | Sim | 13 | Primeiro mês com valores reajustados | Idem | ≥ 1 | Configurável (confirmar com a administradora) |

### 2.4 Recursos para lance

| Nome | Tipo | Unidade | Obrig. | Padrão | Regra de negócio | Efeito | Validações | Status |
|---|---|---|---|---|---|---|---|---|
| FGTS disponível | Número | R$ | Não | vazio | Saldo informado | Limite de uso | ≥ 0; alerta se uso > 0 sem disponível | Configurável |
| Uso do FGTS confirmado | Sim/Não | — | Não | **Não** | O FGTS **não** é considerado automaticamente | Sem confirmação, FGTS = 0 no lance | Alerta se informado sem confirmação | **Regra a definir** |
| FGTS a utilizar no lance | Número | R$ | Não | vazio | Parte dos recursos próprios | Composição do lance e resultado | ≤ disponível; ≥ 0 | Configurável |
| Usar FGTS em (fixo/livre) | Caixas | — | Não | desmarcadas | Modalidade em que o recurso entra | Composição por modalidade | — | Configurável |
| Lance embutido — forma e valor | Lista (%/R$) + número | % ou R$ | Não | % / vazio | Parte do lance paga com o próprio crédito | Reduz o crédito líquido; não é aporte | ≥ 0; ≤ 100 se % | Configurável |
| Usar embutido em (fixo/livre) | Caixas | — | Não | desmarcadas | Modalidade em que o embutido entra | Idem | — | Configurável |
| Tratamento do embutido no crédito | Lista | — | Se embutido | **Regra a definir** | Opção: descontado do crédito bruto na contemplação | Sem regra: "Não foi possível calcular o crédito líquido sem a regra do lance embutido." | Alerta | **Regra a definir** |
| Base dos percentuais de lance | Lista | — | Se houver % | **Regra a definir** | Crédito contratado ou crédito atualizado na contemplação | Lance fixo/livre e embutido em % | Alerta | **Regra a definir** |
| Limite do embutido | Número | % da base | Não | vazio | Regra do grupo | Validação | Erro se embutido > limite; alerta se limite ausente | **Regra a definir** |
| Limite do lance total | Número | % da base | Não | vazio | Regra do grupo | Validação | Erro se lance > limite | **Regra a definir** |
| Recursos próprios automáticos | Sim/Não | — | — | Sim | Recursos próprios = total − embutido − FGTS | Composição | Erro se embutido + FGTS > total | Configurável |
| Recursos próprios (manual) | Número | R$ | Se não automático | vazio | Dinheiro do participante | Composição | Erro se soma ≠ total ofertado | Configurável |
| Regras específicas do grupo | Texto | — | Não | vazio | Registro textual | Exibido nas modalidades | — | Configurável |

Composição exibida em linhas separadas: **Recursos próprios (dinheiro)** · **FGTS (recurso próprio)** · **Lance embutido** · **Total ofertado**.

### 2.5 Estratégias de contemplação

| Nome | Tipo | Unidade | Obrig. | Padrão | Regra de negócio | Efeito | Validações | Status |
|---|---|---|---|---|---|---|---|---|
| Sorteio / Lance fixo / Lance livre — disponível | Sim/Não | — | Não | Sorteio e livre: sim; fixo: não | Registro da regra do grupo | Alerta se o cenário usar modalidade indisponível | — | Configurável |
| % do lance fixo | Número | % | Se Tabela B = fixo | vazio | Regra do grupo | Total do lance fixo | 0–100; alerta se ausente | **Regra a definir** |
| Lance livre — forma e total ofertado | Lista + número | % ou R$ | Se Tabela B = livre | % / vazio | Oferta do participante (hipótese) | Total do lance livre | 0–100 se % | Configurável |
| Mês hipotético de contemplação (cada modalidade) | Inteiro | mês | Opcional | vazio | **Hipótese** do consultor; nunca calculado a partir do valor do lance | Todos os valores do cenário | 1 ≤ mês ≤ prazo; sem mês → "Não calculado" | Configurável |
| Premissa usada para o mês | Texto | — | Recomendado | vazio | Justificativa da hipótese | Exibida na memória e no PDF | Alerta "contemplação estimada sem premissa" | Configurável |
| Observações sobre a regra | Texto | — | Não | vazio | Registro | Exibido | — | Configurável |
| Modalidade da Tabela B | Lista (livre/fixo) | — | Sim | Livre | Escolhe o cenário de lance | Tabela B | — | Configurável |
| Amortização do saldo pelo lance | Lista | — | Não | **Regra a definir** | Opção: abater o valor nominal do lance das parcelas futuras (aproximação) | Obrigações futuras | Nota se a definir | **Regra a definir** |

### 2.6 Premissas de venda

| Nome | Tipo | Unidade | Obrig. | Padrão | Regra de negócio | Efeito | Validações | Status |
|---|---|---|---|---|---|---|---|---|
| Simular venda | Sim/Não | — | Não | Não | Venda é **hipótese** | Sem venda, o resultado não é calculado | — | Configurável |
| Base do valor de venda | Lista | — | Se venda | % do crédito líquido | % do crédito líquido, % do crédito bruto ou valor em R$ | Valor bruto de venda | — | Configurável |
| % ou valor estimado de venda | Número | % ou R$ | Se venda | vazio | Premissa do consultor | Valor bruto de venda | Erro "venda simulada sem premissa de preço" | Configurável |
| Comissões/taxas | Número | % da venda | Se venda (ou custos fixos) | vazio | Deduções proporcionais | Custos da venda | 0–100; alerta se nenhum custo informado | Configurável |
| Custos fixos da venda | Número | R$ | Idem | vazio | Transferência, despesas etc. | Custos da venda | ≥ 0 | Configurável |
| Observações | Texto | — | Não | vazio | Registro | Premissas e PDF | — | Configurável |

### 2.7 Fórmula do resultado (editável) e 2.8 Horizonte

| Nome | Tipo | Padrão | Regra / Efeito | Status |
|---|---|---|---|---|
| Deduzir parcelas pagas | Sim/Não | Sim | − Σ parcelas (sem seguro) até a contemplação | Configurável |
| Deduzir seguro | Sim/Não | Sim | − Σ seguro até a contemplação | Configurável |
| Deduzir outros custos | Sim/Não | Sim | − Σ outros custos até a contemplação | Configurável |
| Deduzir recursos próprios | Sim/Não | Sim | − dinheiro próprio do lance | Configurável |
| Tratamento do FGTS | Lista | Deduzir | Deduzir (patrimônio do participante) ou apenas informativo | Configurável |
| Outros fluxos | Lista (descrição, ± R$) | nenhum | Somados com sinal | Configurável |
| Horizonte da projeção | Lista | Prazo total | Prazo total · até o mês X · até a contemplação (sorteio) · até a contemplação (lance) | Configurável |

---

## 4. Fórmulas de cálculo

Notação: C = crédito contratado; N = prazo; r = redutor (%); m = mês; TA% = taxa de administração; FR = fundo de reserva.

| Resultado | Fórmula |
|---|---|
| Nº de reajustes até o mês m | k(m) = 0 se m < 1º reajuste; senão ⌊(m − 1º reajuste) ÷ periodicidade⌋ + 1 |
| Fator de reajuste | F(m) = (1 + taxa ÷ 100)^k(m), com fatores separados para crédito (Fc) e parcela (Fp) |
| Crédito atualizado | C × Fc(m) |
| Crédito de referência da parcela | Cp(m) = C × Fp(m) |
| **Parcela (regra informada)** | [(Cp ÷ N) × (1 − r)] + (TA% × Cp ÷ N) + (FR total × Fp ÷ N) |
| Parcela integral | Mesma fórmula com r = 0 |
| Fundo comum após o redutor (diluição) | Cp × [1/N + r × (meses com redutor) ÷ (N × meses restantes)] |
| Parcela após o redutor (manual) | valor informado × Fp(m) |
| Seguro (% sobre crédito) | s% × C × Fc(m); (valor fixo) valor informado |
| Total do mês | Parcela + Seguro + Outros custos do mês |
| Total pago no horizonte | Σ Total do mês, do mês 1 ao fim do horizonte |
| Lance fixo | % fixo × base (contratado ou atualizado) |
| Lance livre | valor informado, ou % × base |
| Lance embutido | valor informado, ou % × base |
| Recursos próprios (automático) | Total ofertado − Embutido − FGTS |
| **Crédito líquido** | Crédito bruto (C × Fc(mês C)) − Embutido (se a regra "descontar" estiver definida) |
| **Total aportado** | Σ parcelas + Σ seguro + Σ outros custos + Recursos próprios + FGTS (o **embutido não entra**) |
| Desembolso em dinheiro | Total aportado − FGTS |
| Valor bruto de venda | % × crédito líquido (ou bruto), ou valor informado |
| Valor líquido de venda | Bruto − (comissão% × Bruto) − custos fixos |
| **Resultado estimado** | + Líquido da venda − parcelas − seguro − outros custos − recursos próprios − FGTS (se "deduzir") ± fluxos |
| Obrigações futuras | Σ (parcela + seguro) dos meses após a contemplação; opcionalmente − lance nominal |

---

## 5. Resultados apresentados

- **Resumo (cartões):** crédito contratado, prazo, parcela inicial, parcela com redutor, parcela após o redutor, redutor e período, parcela integral, taxa de administração (R$ e %), fundo de reserva (R$ e %), seguro, outros custos, índices de reajuste, total pago no horizonte e premissas principais.
- **Resumo geral:** tabela Item × Valor × Tipo × Memória, projeção por ano (crédito atualizado, parcela mínima e máxima, total do ano, acumulado, % do crédito) e lista de premissas.
- **Modalidades de contemplação:** texto explicativo neutro e composição do lance fixo e do livre.
- **Tabelas A e B:** ver seção 6.
- **Demonstrativo mensal:** mês a mês, com crédito atualizado, fundo comum, taxa adm., fundo de reserva, parcela, seguro, outros custos, total e situação (redutor, pós-redutor, pendente).
- **Regras pendentes:** lista dinâmica.

Quando uma regra indefinida impede o cálculo, aparece **"Não calculado: depende de regra a definir"**. Quando falta um dado, aparece **"Não calculado: dado não informado"**.

## 6. Tabelas de alavancagem (mesma estrutura)

**Tabela A — cenário hipotético de sorteio** e **Tabela B — cenário hipotético de lance** (fixo ou livre), com as linhas:

Mês da contemplação (hipotético) · Crédito contratado · Crédito bruto na contemplação · Lance embutido · Crédito líquido · Parcela no mês da contemplação · Parcelas pagas (qtde.) · Total de parcelas aportadas · Lance ofertado · Recursos próprios · FGTS · Embutido utilizado · Outros custos pagos · Total aportado (com FGTS) · Desembolso em dinheiro · Valor bruto de venda · Custos da venda · Valor líquido da venda · **Resultado estimado** · Obrigações futuras · Memória de cálculo (por linha) · Composição do resultado.

Regras:
- No sorteio, lance, embutido, recursos próprios e FGTS valem zero. **Nenhum embutido é descontado.**
- A parcela do mês da contemplação é considerada paga.
- O embutido aparece em "Lance embutido" e "Embutido utilizado" apenas como redução do crédito. **Não** é somado ao total aportado nem deduzido no resultado. Assim, nada é contado duas vezes.
- O FGTS aparece em linha própria, e seu tratamento no resultado é configurável.

## 7. Validações e mensagens

| Situação | Nível | Mensagem |
|---|---|---|
| Campo obrigatório vazio (lead, crédito, prazo, taxa adm., fundo de reserva) | Erro | "Campo obrigatório: …" |
| Valor negativo / percentual fora de 0–100 | Erro | "Percentual inválido …" / "… não pode ser negativo" |
| Prazo zerado, não inteiro ou inválido | Erro | "Prazo inválido …" |
| Lance acima do limite / embutido acima do limite | Erro | "… superior ao limite …" |
| Embutido + FGTS maiores que o total; soma ≠ total | Erro | "Soma dos recursos … diferente do total ofertado" |
| FGTS acima do disponível / sem confirmação | Erro / Alerta | "FGTS informado sem confirmação … não será considerado" |
| Índice sem premissa de projeção | Erro | "Índice … sem premissa de projeção" |
| Índice estimado em uso | Info | "A projeção usa uma taxa estimada para o índice selecionado." |
| Seguro ativado sem regra ou valor | Alerta / Erro | "Seguro ativado sem regra …" |
| Redutor sem período ou sem recomposição | Erro / Alerta | "Regra a definir: informe como o redutor é recomposto." |
| Venda sem preço ou custos | Erro / Alerta | "Venda simulada sem premissa de preço" |
| Contemplação sem premissa | Alerta | "Contemplação estimada sem premissa informada" |
| Embutido sem regra | Alerta | "Não foi possível calcular o crédito líquido sem a regra do lance embutido." |
| Sempre nos cenários | Aviso | "Mês de contemplação hipotético, sem garantia de ocorrência." · "Resultado estimado: depende das premissas informadas." |

## 8. Premissas editáveis

Índices e taxas projetadas; periodicidade e mês do 1º reajuste; redutor (%, período, encerramento na contemplação, recomposição); forma e valor do seguro; outros custos; base de cálculo dos lances; tratamento e limite do embutido; limite do lance; uso de FGTS; recursos próprios (automático ou manual); meses hipotéticos e suas premissas; amortização pelo lance; premissas de venda; componentes do resultado; tratamento do FGTS; fluxos adicionais; horizonte.

## 9. Regras pendentes de definição (padrão)

1. Recomposição do saldo/parcelas após o redutor.
2. Índices de reajuste do crédito e da parcela, periodicidade e data-base.
3. Forma de cobrança do seguro (base de cálculo, reajuste, cobrança antes e depois da contemplação).
4. Forma de cobrança de outros custos (adesão, taxa antecipada etc.).
5. Base de cálculo dos percentuais de lance.
6. Tratamento e limite do lance embutido.
7. Limite do lance total e percentual do lance fixo.
8. Forma de amortização do saldo pelo lance (redução de prazo ou de parcela).
9. Permissão e condições de uso do FGTS.
10. Transferência de obrigações futuras em caso de venda.
11. Recálculo da parcela pela administradora com base em percentual amortizado. A fórmula informada divide sempre pelo prazo total.

## 10. Rastreabilidade e revisão (recomendações de implementação)

- O **motor de cálculo é puro e separado da interface** (`js/calc.js`): recebe o estado e devolve valores com tipo, fórmula, origem e pendências. Testes automatizados em `tests/calc.test.js` (`npm test`).
- Cada valor carrega sua **memória** (fórmula com os números usados, origem e dependências). Nenhum número é exibido sem ela.
- Valores dependentes de regra indefinida propagam `null` e mostram **"Não calculado"**, nunca um valor presumido.
- **Exportar JSON** registra todas as entradas da simulação, para auditoria ou para reproduzir o resultado depois.
- Novas regras de administradora devem entrar como **novas opções** das listas "Regra a definir", com teste correspondente.
- Revise os pontos de configuração de fábrica em `estadoPadrao()` (`js/calc.js`).

---

## Síntese final

### 1. Regras implementadas
Fórmula da parcela com redutor sobre o fundo comum; reajuste separado de crédito e parcela, sobre o crédito contratado, com periodicidade configurável; recomposição por diluição ou valor manual; seguro (% do crédito ou fixo); outros custos (único ou mensal); lance fixo e livre em % ou R$, com base configurável; composição em recursos próprios + FGTS + embutido; limites de embutido e de lance; crédito líquido com embutido descontado; total aportado sem dupla contagem; venda hipotética com custos; resultado por componentes configuráveis; obrigações futuras; horizonte de projeção; validações e alertas; proposta em PDF.

### 2. Campos que o consultor pode editar
Todos os campos das seções 1 a 8 do menu lateral (ver tabelas acima), além das listas de outros custos e de fluxos financeiros.

### 3. Regras que dependem de confirmação da administradora ou do grupo
As da seção 9: recomposição do redutor, índices e periodicidade, seguro, outros custos, base e limites de lance, lance fixo, embutido, amortização pelo lance, FGTS e transferência na venda.

### 4. Limitações das projeções
- Índices não pré-fixados usam **taxa estimada** informada pelo consultor.
- A fórmula divide o crédito reajustado pelo prazo total e não recalcula pelo percentual amortizado, que é o método usual de muitas administradoras.
- O mês de contemplação é hipótese e não é derivado do valor do lance.
- Valores de venda são hipóteses sem referência de mercado.
- As obrigações após a contemplação não consideram amortização pelo lance, salvo a aproximação nominal opcional.
- Não há valor presente nem custo de oportunidade: todos os valores são nominais.

### 5. Fórmulas principais
- **Aportes:** Total aportado = Σ parcelas + Σ seguro + Σ outros custos + Recursos próprios + FGTS. O desembolso em dinheiro exclui o FGTS. O embutido não entra.
- **Crédito líquido:** Crédito contratado × Fc(mês da contemplação) − Lance embutido (se a regra "descontar" estiver definida).
- **Resultado financeiro:** Valor líquido da venda − parcelas − seguro − outros custos − recursos próprios − FGTS (se "deduzir") ± fluxos cadastrados. Cada componente pode ser ligado ou desligado.
