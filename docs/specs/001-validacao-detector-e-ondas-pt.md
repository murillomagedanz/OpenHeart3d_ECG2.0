# SDD 001 — Validação reprodutível do detector de QRS e detecção/visualização de ondas P e T

Status: implementado · Autor: Eng. Murillo Magedanz (idealização) · Decisões derivadas: D15 e D16 em [`docs/DECISOES.md`](../DECISOES.md)

## 1. Objetivo

1. **(A)** Tornar a validação do detector de QRS ampla, estratificada e reprodutível: mais registros públicos anotados, métricas completas e um relatório versionado que um teste reproduz bit a bit.
2. **(B)** Detectar e exibir ondas P e T (pico, início e fim) a partir do sinal já filtrado, pontuadas contra as anotações do LUDB, que traz P/QRS/T anotados por derivação.

## 2. Escopo

Dentro: registros LUDB adicionais (37, total 39) no repositório; extensão aditiva de `scoring.js`; relatório `web/data/reports/validation.{json,md}`; delineador `web/src/ecg/waves.js`; parser das anotações de delineação do LUDB; marcadores P/T **opcionais e apenas visuais** na tira de ritmo; documentação e decisões.

Esse escopo descreve a entrega inicial. Após a ampliação, o relatório QRS versionado inclui **87 LUDB + 14 MIT-BIH = 101 registros**; as contagens e métricas atuais são as de `web/data/reports/validation.json`, não as da entrega inicial.

Fora: diagnóstico ou inferência clínica; ML (etapa 4 segue congelada); alimentar o coração 3D ou os envelopes com P/T (D1: o sinal comanda o modelo, só por eventos de QRS); reamostragem ou imputação; escolha da licença do código (pendente, apenas mencionada).

## 3. Requisitos

- R1. Registros: 37 novos do LUDB, selecionados por estratificação de ritmo (sinusal, bradicardia, taquicardia, arritmia sinusal, FA, flutter, marcapasso) e versionados com `git add -f` (D6).
- R2. Divisão: **id par = ajuste (tuning), id ímpar = held-out**. Parâmetros do delineador só são ajustados nos pares; o desempenho divulgado como "real" é o dos ímpares.
- R3. O detector não é alterado na parte A; achados negativos (ex.: LBBB com extrassístoles, flutter) são reportados, não escondidos.
- R4. O relatório é determinístico (sem timestamps, ordem fixa) e um teste falha se o relatório regenerado diferir do commitado.
- R5. O delineador usa a mesma lógica em lote (relatório/testes) e em streaming (UI). Devolve `null` em vez de forçar valores; janelas com lacuna → `null`.
- R6. Pontuação de ondas com tolerância ±150 ms (como no artigo do LUDB), sensibilidade/VPP e erro (média ± DP) de início/pico/fim, por onda e derivação (primária: II). Só se contam detecções entre o primeiro e o último complexo anotados.
- R7. Marcadores P/T rotulados "estimado por algoritmo", desativados por padrão, sem efeito sobre o 3D.
- R8. Limiares de regressão de P/T definidos **depois** de medir, com folga abaixo do desempenho held-out; sem metas fixas como critério de aceite.

## 4. Design do delineador

Núcleo `delineatePair(x, x0, fs, rPrev, rCur, params)`: suavização zero-fase (~30 ms) para localizar picos; limites do QRS por fração da inclinação máxima; janela T = [QRSoff+~50 ms, min(rPrev+0,7·RR, rPrev+0,60 s)] limitada antes da P seguinte; janela P = [max(rCur−0,32 s, fim da T), QRSon−~20 ms]; linha de base linear entre bordas; pico = máximo |desvio| (T invertida permitida), interior; limiar = max(piso absoluto, 4 × ruído HF por MAD); início/fim por fração do pico, parando em mínimo local. Parâmetros em `DEFAULT_WAVE_PARAMS`. Ausência de P em FA/flutter é comportamento esperado (detecções viram FP informativos).

## 5. Critérios de aceite

- `npm test` passa em `web/` e no CI (Node 22) sem regressão do agregado de QRS.
- Relatório regenerável (`npm run report`) e coberto por teste de guarda.
- Testes sintéticos do delineador: P/T conhecidas, ruído, T invertida, ausência de P, lacuna.
- Resultados held-out de P/T publicados no relatório com limitações explícitas.
- READMEs, `docs/DECISOES.md` e roteiro atualizados.

## 6. Entrega

PR A (registros, métricas, relatório, D15) → PR B sobre A (P/T, UI, D16).

## 7. Riscos e limites

Registros LUDB têm 10 s: poucos ciclos por registro, então a estatística por registro é frágil (reportar agregados). Resultado em banco único não generaliza a outros equipamentos. O LUDB é de 500 Hz/50 Hz; MIT-BIH 105/203 permanecem opcionais (não versionados).

## 8. Diagnóstico observacional do QRS no MIT-BIH 228

Esta entrega não altera `detector.js`, filtros, pontuação ou parâmetros. `tests/qrs-trace.mjs` observa o mesmo `SignalPipeline`, preservando os eventos e o tratamento de lacunas. Executar em `web/`:

```powershell
node tests\qrs-trace.mjs mitdb/228 383.4 495.2 > trace-228.json
node tests\qrs-trace.mjs mitdb/228 513.2 628.2 > trace-228-second.json
node --test tests\qrs-trace.test.mjs
```

O JSON contém amostras brutas/filtradas, MWI (`feat`), limiar cheio e de abertura, níveis de sinal/ruído, RR médio, candidatas fechadas e emissões. O processamento começa no início do registro: recortar antes do detector destruiria o estado adaptativo. A janela informada limita apenas a observação. A análise por batimento usa de −150 a +300 ms e exclui batimentos nas margens sem janela completa; `detectedNearby` é proximidade, não um segundo pareamento oficial. O escore global continua usando `matchBeats`.

**Referência congelada:** agregado QRS 30.418 TP / 582 FP / 435 FN, sensibilidade 0,9859 e VPP 0,9812; registro 228: 1.700 TP / 9 FP / 352 FN. A derivação selecionada é **II ← MLII (canal bruto 0)**. O índice 1 de `FileSource.detectionLead` refere-se às derivações padronizadas, não ao canal bruto V1. A comparação anterior de inclinações em V1 não descrevia a entrada efetiva do detector e não sustenta a rejeição da hipótese de energia insuficiente.

| Janela observada (s) | N anotados | N perdidos | Sem candidata e abaixo do limiar de abertura no máximo MWI | Candidata fraca | V perdidos / anotados |
|---|---:|---:|---:|---:|---:|
| 383,4–495,2 | 89 | 88 | 86 | 2 | 0 / 41 |
| 513,2–628,2 | 108 | 101 | 76 | 25 | 1 / 25 |

Nos N perdidos, o máximo MWI é inferior ao limiar cheio (razão mediana 0,343 e 0,407 nas duas janelas); o máximo ocorre fora do refratário de 220 ms. No trecho 400–410 s, N têm MWI aproximadamente 0,019–0,027 contra limiar 0,087–0,090, enquanto V têm 0,254–0,340. O nível de sinal aprende os complexos de maior energia e não decai entre emissões; N abaixo do limiar de abertura não viram reserva. Nos N que geram candidata fraca, o search-back depende do RR já inflado pelos N omitidos; a emissão do V seguinte limpa a reserva. A candidata fraca do N anotado em 554,458 s é descartada na emissão em 555,197 s do V anotado em 555,097 s (pico estimado 555,089 s). Isso identifica o mecanismo de perda no detector atual, não uma solução clinicamente validada.

**Correção de interpretação:** concentração de FP do 207 em flutter ventricular é evidência de conflito de avaliabilidade, não prova de que todas as detecções estejam corretas. No 108, ruído anotado tampouco elimina FP automaticamente. Manter os escores brutos e só adicionar estratos de avaliabilidade após definir a semântica/intervalos das anotações; não excluir `!`, `x` ou `~` isoladamente para melhorar métricas.

## 9. Protocolo da próxima comparação

1. Preservar a referência acima e os relatórios brutos; tratar LUDB ímpar e MIT-BIH já inspecionados como regressão, não validação independente.
2. Comparar uma hipótese por vez: primeiro adaptação do nível de sinal entre emissões; depois abertura/reserva de candidatas; finalmente search-back sensível a alternância de energia. Não reduzir globalmente o limiar antes de medir os FP.
3. Usar os pares do LUDB para ajuste geral; o 228 é um caso de desenvolvimento já conhecido. Registrar parâmetros e resultados de cada experimento, inclusive falhas.
4. Fixar o filtro de promoção do piloto antes dos experimentos: 228 com FN ≤ 205 (sensibilidade ≥ 0,90) e FP ≤ 19; sensibilidade e VPP de cada banco sem perda superior a 0,005 absoluta frente à referência; publicar também resultados por registro para não esconder regressões.
5. Exigir testes sintéticos de alternância de energia, ruído e T proeminente, equivalência streaming/lote, lacunas, latência e custo. Os critérios do piloto não substituem validação clínica.
6. Reservar registros novos, não inspecionados, antes de escolher uma alternativa; congelar parâmetros antes dessa avaliação final. Não promover o piloto apenas por melhorar o 228.
7. Investigar P/T em etapa separada com R detectado versus anotado, sem alimentar o 3D. Só abrir a entrega de alteração do detector após evidência comparativa e CI verde; merge requer confirmação dos checks.

## 10. Experimento isolado: decaimento do nível de sinal

**Hipótese:** decair exponencialmente `signalLevel` em direção a `noiseLevel` entre candidatas reduz a disparidade de energia V/N na bigeminia do registro 228. A sonda fica em `tests/qrs-trace.mjs`, fora de `detector.js`; tau zero preserva o detector atual. Assim, nenhum comportamento de produto ou relatório é alterado.

Executar em `web/` para repetir em um registro ou em todos os registros versionados:

```powershell
node tests\qrs-decay-experiment.mjs 0.35 mitdb/228
node tests\qrs-decay-experiment.mjs 1 mitdb/228
node tests\qrs-decay-experiment.mjs 3
node --test tests\qrs-trace.test.mjs
```

As constantes foram comparadas mantendo todo o restante fixo:

| tau (s) | 228 TP | FP | FN | Sens. | VPP |
|---:|---:|---:|---:|---:|---:|
| Referência (sem decaimento) | 1.700 | 9 | 352 | 0,8285 | 0,9947 |
| 0,35 | 2.052 | 293 | 0 | 1,0000 | 0,8751 |
| 0,50 | 2.052 | 241 | 0 | 1,0000 | 0,8949 |
| 0,75 | 2.052 | 162 | 0 | 1,0000 | 0,9268 |
| 1,00 | 2.052 | 131 | 0 | 1,0000 | 0,9400 |
| 1,50 | 2.051 | 104 | 1 | 0,9995 | 0,9517 |
| 2,00 | 2.051 | 73 | 1 | 0,9995 | 0,9656 |
| 3,00 | 2.047 | 52 | 5 | 0,9976 | 0,9752 |

**Resultado:** rejeitar o decaimento simples como alteração do detector. Mesmo o tau 3 s, que mais se aproxima do VPP de referência entre os valores ensaiados, falha o critério piloto já fixado para 228 (FP ≤19). Aplicado aos 101 registros, muda o agregado de 30.418 TP / 582 FP / 435 FN (sens. 0,9859; VPP 0,9812) para 30.815 / 1.319 / 38 (sens. 0,9988; VPP 0,9590). Falha também o limite de regressão de 0,005 absoluto no VPP. Por banco, LUDB muda de 20 para 31 FP (VPP 0,9752 → 0,9623); MIT-BIH, de 562 para 1.288 FP (VPP 0,9814 → 0,9589). O 207 vai de 366 para 482 FP no tau 3 s, e o 108 de 164 para 569. Não adotar, promover nem ocultar essas detecções extras; os intervalos difíceis permanecem no resultado bruto.

Esta comparação rejeita apenas o decaimento exponencial global sem distinção de morfologia/estado, não a possibilidade de adaptação seletiva. A próxima hipótese deve separar candidatas de baixa energia plausíveis de ruído/flutter sem baixar o limiar indiscriminadamente; defini-la e testá-la contra os critérios congelados antes de mexer no caminho de produção.

## 11. Segunda hipótese: limitar a contribuição de complexos de alta energia

**Hipótese:** quando um complexo emitido tem energia maior que `cap × signalLevel`, limitar sua contribuição ao aprendizado do nível de sinal evita a dominância dos V sem decaimento contínuo. O teste altera apenas `maxFeat` usado na atualização em `_emit`; os filtros, abertura/fechamento de candidatas, refratário, search-back e anotação do pico seguem o código de produção. Não se classifica morfologia nem se usa a referência anotada para decidir detecções. A inicialização do detector também permanece intacta.

O piloto foi definido com cap 2, seguido de análise de sensibilidade limitada a 3, 4 e 6 no registro de desenvolvimento 228. Não se combinou essa regra com o decaimento rejeitado. `tests/qrs-capped-level.mjs` implementa a variante somente em testes. O executor compartilhado `tests/qrs-experiment.mjs` repete o controle sem alteração para cada registro e falha explicitamente se suas contagens divergirem do relatório congelado. Reporta todos os registros, latência das emissões pontuadas (não só TP) e critérios calculados sem arredondamento. Uma seleção parcial nunca aprova o piloto. Ambos os executores usam esse protocolo:

```powershell
node tests\qrs-cap-experiment.mjs 2
node tests\qrs-cap-experiment.mjs 3 mitdb/228
node tests\qrs-cap-experiment.mjs 4 mitdb/228
node tests\qrs-cap-experiment.mjs 6 mitdb/228
node tests\qrs-decay-experiment.mjs 3
node --test tests\qrs-cap.test.mjs tests\qrs-trace.test.mjs
```

| Regra | 228 TP | FP | FN | Critério 228 (FN ≤205; FP ≤19) |
|---|---:|---:|---:|---|
| Referência | 1.700 | 9 | 352 | Falha em FN |
| Cap 2 | 2.044 | 48 | 8 | Falha em FP |
| Cap 3 | 1.806 | 22 | 246 | Falha em ambos |
| Cap 4 | 1.765 | 14 | 287 | Falha em FN |
| Cap 6 | 1.699 | 11 | 353 | Falha em FN |

Cap 2 nos **101 registros**: 30.763 TP / 632 FP / 90 FN, sensibilidade **0,9971** e VPP **0,9799**, contra 30.418 / 582 / 435 (0,9859 / 0,9812). O LUDB mantém exatamente 788 / 20 / 8; MIT-BIH passa a 29.975 / 612 / 82 (0,9973 / 0,9800), dentro do limite agregado de perda de 0,005. No 108, FP sobem de 164 para 167; no 207, de 366 para 373. A latência p95 das emissões no 228 cai de 230,6 para 130,6 ms. Esses ganhos não dispensam o critério por registro: `databasePass=true`, mas `focusPass=false` e **`pilotPass=false`**.

**Conclusão:** rejeitar também esta variante como alteração de produção, preservando-a para comparação. Ela é mais seletiva que o decaimento, mas não é um discriminador de QRS versus T/ruído. Dos 48 FP no 228 (incluindo os preexistentes), 41 ocorrem até 400 ms após o batimento anotado anterior e 11 são emissões por search-back. Isso é uma localização temporal, não prova de que sejam T ou redetecção do QRS. A investigação seguinte deve comparar inclinação, duração e forma nesses FP com N recuperados antes de definir um discriminador; não estender o refratário cegamente, nem adicionar um terceiro ajuste sem evidência.

Nenhuma variante foi promovida ao produto, os escores brutos continuam intactos e não há avaliação independente em registros novos nesta entrega. Mesmo uma aprovação futura do piloto ainda exigirá congelamento dos parâmetros, validação final reservada e testes de streaming, lacunas e custo antes da promoção.

## 12. Investigação morfológica: FP versus N recuperados

`tests/qrs-morphology.mjs` repete controle e cap 2 desde o início dos registros, verifica o controle contra o relatório congelado e rotula os eventos com o mesmo pareamento temporal guloso. Um N recuperado é uma referência N pareada no piloto e não pareada no controle (341 no 228); os 344 TP líquidos extras não são todos N. A referência anotada rotula os grupos somente depois do processamento, nunca alimenta o detector.

```powershell
node tests\qrs-morphology.mjs mitdb/228 mitdb/108 mitdb/207
node tests\qrs-morphology.mjs --all
node --test tests\qrs-morphology.test.mjs
```

As medidas usam o passa-banda **interno** do detector, com janela ±80 ms centrada no pico estimado mais o atraso de grupo. Inclinação é o máximo da diferença sobre aproximadamente 10 ms, normalizada em mV/s. Largura é a extensão contígua acima de metade do máximo absoluto; **não é duração clínica de QRS**. Correlação de Pearson com a janela do evento anterior preserva o sinal/polaridade. Janelas incompletas ou com lacunas devolvem medidas ausentes; larguras que atingem a borda são explicitamente censuradas.

| Mediana no 228 | FP (48) | N recuperados (341) |
|---|---:|---:|
| Inclinação máxima (mV/s) | 12,405 | 22,513 |
| Razão de inclinação para evento anterior | 0,186 | 0,914 |
| Intervalo para evento anterior (s) | 0,250 | 0,919 |
| Correlação com evento anterior | −0,519 | 0,917 |
| Largura a meia amplitude (ms) | 63,9 | 33,3 |
| Larguras censuradas (contagem) | 38 | 20 |

**Achados:** muitos FP são precoces, de menor inclinação relativa e com polaridade/forma diferente do evento anterior. Há sobreposição: razões de inclinação dos N recuperados chegam a 0,185, e dos FP a 1,061; inclinação ou correlação isolada não separam todos os grupos. A censura de 38/48 larguras dos FP impede concluir que sejam ondas T apenas por serem largas. Não há anotações de T no MIT-BIH usadas nesta investigação, portanto a identidade T versus cauda/rebote do complexo continua não comprovada. No 207, FP têm correlação mediana 0,889 e razão de inclinação 1,012: o padrão de flutter não é o mesmo dos FP precoces no 228.

**Triagem observacional fixa:** intervalo para evento anterior ≤360 ms e razão de inclinação <0,5, medida antes de qualquer escolha de novo parâmetro. Ela sinaliza **36/48 FP e 0 TP no 228**, 2 FP e 0 TP no 108, 1 FP e 0 TP no 207. Nos **101 registros**, sinaliza **45 FP e 3 TP**; os três TP são do **210**. Nenhum N recuperado é sinalizado nesse conjunto. Isso favorece testar discriminação temporal/inclinação de maneira controlada, mas demonstra que a regra não é um classificador seguro de T: também atingiria batimentos reais.

Esta triagem **não remove eventos**, não altera níveis ou RR, não mede ganho de um detector modificado e não representa validação independente. A conta estática de 48−36=12 FP no 228 não pode ser tomada como resultado de streaming: rejeitar um evento muda reservas, RR, aprendizado e decisões subsequentes. Além disso, a janela morfológica observa até 80 ms depois do centro; uma implementação causal precisa aguardar essas amostras e contabilizar a latência, ou definir outra medida causal e avaliá-la separadamente.

**Próxima etapa delimitada:** formular um único discriminador causal de candidata pós-complexo, preservando explicitamente os TP do 210; comparar replay completo, e não pós-filtragem da lista. Manter cap 2 como hipótese não promovida, publicar efeito adicional versus cap 2 e versus referência original, e só considerar promoção após os critérios piloto e avaliação final independente. Nesta entrega não se executa uma terceira alteração do detector.

## 13. Auditoria causal e contraexemplos ventriculares

Antes de formular o terceiro experimento, a investigação foi estendida para medir a inclinação **no instante em que o pipeline emite o evento**, sem usar amostras futuras. O mesmo comando `node tests\qrs-morphology.mjs --all` agora inclui `causalScreen` por registro e os totais `causalFlaggedFp`, `causalFlaggedTp` e `causalFlaggedRecoveredN`. Os JSONs por registro incluem os valores por evento e os TP sinalizados como `counterexamples`.

**Procedimento:** o replay mede a inclinação no passa-banda já disponível, da borda esquerda da janela ±80 ms até o menor índice entre a borda direita e a amostra atual. Marca explicitamente quando a janela está incompleta. A razão usa a medida armazenada na emissão anterior, em ordem de emissão (não uma recomputação futura nem a ordem dos picos após ordenação para pontuação). Uma lacuna invalida a comparação com a emissão anterior. Rótulos FP/TP e símbolos são cruzados somente depois da medição. Testes de prefixo e mutação de amostras futuras comprovam que estas não influenciam a medida.

| Conjunto | FP sinalizados offline | FP sinalizados causalmente | TP sinalizados causalmente | N recuperados sinalizados |
|---|---:|---:|---:|---:|
| 228 | 36 | 36 | 0 | 0 |
| 108 | 2 | 2 | 0 | 0 |
| 207 | 1 | 1 | 0 | 0 |
| Todos os 101 registros | 45 | 44 | 3 | 0 |

A única diferença na contagem de FP é LUDB 192 (4 offline → 3 causal). Há 3.690 janelas incompletas no conjunto; nenhuma medida de inclinação ausente nesses registros. No 228, 246 janelas estão incompletas. Isso não impede medir a inclinação observada, mas ela não equivale necessariamente ao máximo da janela completa. As contagens de detecção e os controles permanecem idênticos aos da seção 12; a auditoria não rejeita eventos nem acrescenta latência ao detector.

Os **três TP do MIT-BIH 210 são V anotados** e já detectados na referência original:

| Pico estimado (s) | Emissão (s) | Intervalo para emissão anterior, medido entre picos (ms) | Razão causal de inclinação | Correlação offline | Janela causal |
|---:|---:|---:|---:|---:|---|
| 602,178 | 602,311 | 352,8 | 0,4707 | −0,7962 | Completa |
| 609,808 | 609,936 | 325,0 | 0,4952 | −0,7631 | Completa |
| 945,772 | 945,903 | 344,4 | 0,4929 | −0,8756 | Completa |

Logo, os contraexemplos não decorrem de falta de amostras ou uso de informação futura: são complexos ventriculares reais precoces, com menor inclinação relativa e correlação negativa, características compartilhadas com parte dos FP. Aumentar cegamente o refratário, rejeitar por inversão de polaridade ou simplesmente acrescentar correlação negativa à regra também pode suprimir esses V.

**Decisão de pesquisa:** não promover a triagem temporal/inclinação a discriminador. Não escolher um novo limiar apenas para ficar abaixo das razões dos três V conhecidos: isso seria ajuste retrospectivo no conjunto já inspecionado, não evidência de generalização. O caso 210 passa a ser contraexemplo explícito e coberto por teste. A hipótese de T/redetecção no 228 continua não confirmada por anotações de onda.

**Próxima investigação arquitetural:** comparar modelos que mantenham mais de uma morfologia/escala de energia plausível, em vez de um único nível adaptativo mais rejeição temporal universal. Antes de codificar outra correção, definir como uma candidata de baixa energia é reconhecida sem consultar anotações, como a confiança é adquirida/perdida em ruído e como V prematuros são preservados. Só então implementar um piloto causal isolado, com ablação contra cap 2, controle original, regressão 210 e custo/latência medidos. Registros já analisados continuam sendo desenvolvimento/regressão; a validação independente permanece pendente. Nenhuma alteração de produção foi realizada nesta auditoria.

## 14. Referencial teórico e limites de transferência

Revisão bibliográfica dirigida em **08/10/2026**, não revisão sistemática ou meta-análise. Pergunta: há fundamentos para adaptar energia/morfologia sem suprimir V prematuros ou aprender ruído como QRS? As buscas gerais retornaram erro HTTP 504; a pesquisa prosseguiu pelo índice Europe PMC, com títulos específicos e busca de QRS/template. Identificadores e resumos foram conferidos no índice biomédico; o texto completo de Christov foi lido no PMC. PubMed direto apresentou barreira de cookies. Não se contornou paywall, nem se consultaram dados privados. Para trabalhos sem texto completo acessível, as conclusões abaixo ficam limitadas ao resumo; ausência de resumo é indicada.

| Ref. | Trabalho e identificadores verificados | Evidência consultada e relação com a pesquisa |
|---|---|---|
| R1 | Pan J, Tompkins WJ. **A real-time QRS detection algorithm.** 1985. [PMID 3997178](https://pubmed.ncbi.nlm.nih.gov/3997178/); [DOI 10.1109/TBME.1985.325532](https://doi.org/10.1109/TBME.1985.325532). | Metadados confirmados; sem resumo no retorno consultado. Referência histórica da família do nosso detector, não comprovação de equivalência entre o artigo e a implementação simplificada. |
| R2 | Hamilton PS, Tompkins WJ. **Quantitative investigation of QRS detection rules using the MIT/BIH arrhythmia database.** 1986. [PMID 3817849](https://pubmed.ncbi.nlm.nih.gov/3817849/); [DOI 10.1109/TBME.1986.325695](https://doi.org/10.1109/TBME.1986.325695). | Metadados confirmados; sem resumo no retorno. Candidato para leitura integral futura sobre regras de decisão; não atribuímos ao artigo os limiares da nossa triagem sem verificar o método. |
| R3 | Christov II. **Real time electrocardiogram QRS detection using combined adaptive threshold.** 2004. [PMID 15333132](https://pubmed.ncbi.nlm.nih.gov/15333132/); [DOI 10.1186/1475-925X-3-28](https://doi.org/10.1186/1475-925X-3-28); [texto completo PMC516783](https://pmc.ncbi.nlm.nih.gov/articles/PMC516783/). | Evidência direta: limiar composto M+F+R para inclinação, alta frequência/ruído e expectativa de batimento; proteção contra aumentos abruptos provocados por PVC/artefato. Não é detector multi-template. |
| R4 | Afonso VX, Tompkins WJ, Nguyen TQ, Luo S. **ECG beat detection using filter banks.** 1999. [PMID 9932341](https://pubmed.ncbi.nlm.nih.gov/9932341/); [DOI 10.1109/10.740882](https://doi.org/10.1109/10.740882). | Resumo: subbandas, características tempo/frequência e fusão de decisões; detector descrito como de tempo real. Fundamenta combinar evidências, mas não valida nosso limiar nem uma memória de morfologias. |
| R5 | Nakai Y et al. **Noise tolerant QRS detection using template matching with short-term autocorrelation.** 2014, conferência EMBC. [PMID 25569890](https://pubmed.ncbi.nlm.nih.gov/25569890/); [DOI 10.1109/EMBC.2014.6943522](https://doi.org/10.1109/EMBC.2014.6943522). | Resumo: template gerado autonomamente por autocorrelação de curta duração para QRS em ruído; resultados de simulação. É evidência direta de uso de templates na detecção, mas causalidade, latência e preservação de PVC raros não foram confirmadas pela leitura integral. |
| R6 | de Chazal P, O'Dwyer M, Reilly RB. **Automatic classification of heartbeats using ECG morphology and heartbeat interval features.** 2004. [PMID 15248536](https://pubmed.ncbi.nlm.nih.gov/15248536/); [DOI 10.1109/TBME.2004.827359](https://doi.org/10.1109/TBME.2004.827359). | Resumo: classificação supervisionada de batimentos **manualmente detectados**, morfologia e intervalos, dois conjuntos de 22 registros não marcapassados. Apoia a utilidade de características e avaliação separada; não demonstra recuperação de QRS perdido ou algoritmo causal não supervisionado. |
| R7 | Clifford GD, Behar J, Li Q, Rezek I. **Signal quality indices and data fusion for determining clinical acceptability of electrocardiograms.** 2012. [PMID 22902749](https://pubmed.ncbi.nlm.nih.gov/22902749/); [DOI 10.1088/0967-3334/33/9/1419](https://doi.org/10.1088/0967-3334/33/9/1419). | Resumo: qualidade de ECGs de 5–10 s, energia espectral, momentos e concordância entre canais/algoritmos, classificadores supervisionados e treino/teste separados. Apoia investigar qualidade antes de atualizar modelos, não autoriza excluir trechos ruidosos da pontuação. |
| R8 | Rahul J, Sora M, Sharma LD. **A novel and lightweight P, QRS, and T peaks detector using adaptive thresholding and template waveform.** 2021, *Computers in Biology and Medicine* (Elsevier). [PMID 33765449](https://pubmed.ncbi.nlm.nih.gov/33765449/); [DOI 10.1016/j.compbiomed.2021.104307](https://doi.org/10.1016/j.compbiomed.2021.104307). | Resumo: QRS por limiares adaptativos e remoção de FP com curtose; clustering e template de segmentos S–Q usados para **P/T**. Não é evidência de que múltiplos templates QRS resolveriam nosso 228. |
| R9 | Friesen GM et al. **A comparison of the noise sensitivity of nine QRS detection algorithms.** 1990. [PMID 2303275](https://pubmed.ncbi.nlm.nih.gov/2303275/); [DOI 10.1109/10.43620](https://doi.org/10.1109/10.43620). | Resumo: ECG II normal sintetizado com cinco tipos de ruído; mede detecção, FP e atraso. Nenhum algoritmo detecta tudo sem FP no maior ruído. Justifica ensaios de estresse; não caracteriza morfologias patológicas reais. |

### 14.1. O que Christov acrescenta ao diagnóstico

No texto integral R3, o componente M guarda cinco valores de limiar de inclinação. Quando o novo valor excede 1,5 vezes o valor anterior de referência, é limitado a 1,1 vezes esse valor; M usa a média do buffer. Depois há redução **limitada no tempo** entre 200 e 1.200 ms, até 60% do valor atualizado, que permanece constante depois. F aumenta a proteção diante de componentes de alta frequência; R diminui o limiar conforme a expectativa RR para não perder batimentos de baixa amplitude. O artigo diferencia algoritmo no batimento corrente e variante pseudo-real-time com procura de batimento perdido.

Portanto, existe precedente teórico direto para proteger o aprendizado contra complexos de energia alta. Contudo, **cap 2 não é reprodução de Christov**: usa energia quadrática MWI, EMA e limitador com outra definição, sem os três componentes e sem buffer equivalente. Tampouco nosso decaimento exponencial global rejeitado corresponde à redução limitada do artigo. A falha desses pilotos não refuta R3 nem justifica copiar suas constantes em outra escala de sinal.

R3 também considera diversidade de morfologias e V prematuros próximos ao complexo anterior, incluindo R-sobre-T no AHA. Isso reforça preservar o contraexemplo 210 em vez de impor refratário maior. Suas métricas não são comparáveis diretamente às nossas: o texto inclui tratamento de erros deslocados SP/SN, revisão de diferenças acima de 60 ms e índices denominados Se/Sp, enquanto usamos pareamento guloso ±150 ms e VPP. Não transplantar os percentuais publicados para afirmar desempenho local.

### 14.2. Síntese e hipótese de arquitetura

**Sustentado:** adaptação seletiva de limiares, separação da resposta a ruído, combinação de evidências e uso de templates têm precedentes. **Não demonstrado:** que um banco causal de múltiplas morfologias não supervisionadas, conectado ao nosso detector, recuperará N do 228 preservando V raros do 210 e FP de 108/207. Esse resultado precisa de experimento próprio. Template matching não garante segurança: artefatos periódicos e ondas T recorrentes também podem criar clusters estáveis; um PVC novo pode não corresponder a template algum.

Alternativas a comparar conceitualmente antes de escolher o piloto:

| Alternativa | Benefício esperado | Risco principal | Evidência disponível |
|---|---|---|---|
| Componentes separados para sinal/ruído/expectativa | Evitar que uma única energia governe todas as decisões | RR errado realimenta expectativa; transferência de constantes entre filtros inválida | R3 integral |
| Banco limitado de morfologias com níveis próprios | Evitar dominância V/N sem veto por polaridade | Cold start, PVC raro, cluster de T/artefato; memória e alinhamento | R5 resumo para templates; R6 indireto para características |
| Evidência por subbandas ou segunda derivação | Acrescentar informação além de inclinação relativa | Ruído concordante, canais ausentes, custo, atraso | R4 resumo; R3 integral para múltiplas derivações |

**Protocolo proposto, ainda sem parâmetros escolhidos ou implementação:** primeiro uma sonda de memória morfológica em modo sombra, sem aceitar/rejeitar eventos. Definir previamente alinhamento causal, número máximo de templates, maturação, expiração, tratamento de lacunas e observação de qualidade. Aprender apenas de eventos emitidos até o instante corrente; anotações servem exclusivamente para avaliação posterior. Registrar o conflito fundamental: treinar apenas nos QRS já detectados pode jamais aprender os N perdidos, mas aprender de todas as candidatas pode contaminar o banco com T/ruído. Antes de reduzir limiares, a sonda deve mostrar como reconhece candidatos de baixa energia sem auto-confirmar esses erros.

Avaliar cobertura de morfologias raras, contaminação por FP, tempo para maturar, respostas às lacunas e ruído, CPU/memória e atraso; publicar bootstrap/cold start e falhas. Comparar controle original, cap 2 e sombra sem promoção; se houver evidência de separação, congelar uma regra e fazer ablação no replay completo. Manter os critérios da seção 9 e preservação dos três V do 210; reservar registros novos antes da seleção final. Não tratar o banco atual como teste independente nem usar classificações N/V online. A presente entrega é **revisão teórica e definição de riscos**, não implementação ou validação do banco de templates.

**Pendências bibliográficas:** leitura integral de R2, R4 e R5 antes de atribuir-lhes regras operacionais; verificar causalidade e janela de R5 e detalhes de clustering de R8 antes de usar seus métodos. Os resumos foram consultados via [API pública Europe PMC](https://www.ebi.ac.uk/europepmc/webservices/rest/search) (`resultType=core`, título ou PMID); essas limitações ficam explícitas para que metadados/resumos não sejam apresentados como estudo integral.

## 15. Diretriz de pesquisa e primeira memória em modo sombra

**Diretriz do usuário:** referências externas úteis devem ser citadas e documentadas como apoio, sem reorientar nossa linha de investigação. Concluir primeiro a sequência derivada dos achados locais (energia V/N, FP pós-complexo, contraexemplos ventriculares e memória morfológica), antes de considerar desvios. A bibliografia da seção 14 não substitui nossos critérios, nem transforma esta sonda numa reprodução dos artigos citados.

Foi implementada **somente em testes** a memória `tests/qrs-shadow-bank.mjs`, conectada à auditoria de morfologia durante o replay. Não recebe símbolos N/V, rótulos FP/TP ou tempos anotados, não consulta anotações para se atualizar e não modifica detecções, RR, limiares ou reservas. Executar:

```powershell
node tests\qrs-morphology.mjs mitdb/228 mitdb/210 mitdb/108 mitdb/207
node tests\qrs-morphology.mjs --all
node --test tests\qrs-shadow-bank.test.mjs tests\qrs-morphology.test.mjs
```

### 15.1. Protocolo fixado antes da primeira execução

- Até **4 templates** ativos, correlação assinada mínima **0,90**, atualização por peso **0,125**. Remover a média e normalizar a norma do vetor: escala de amplitude não define uma nova morfologia; inversão de polaridade pode defini-la. Não há realinhamento ou ajuste por anotações.
- Janela ±80 ms no passa-banda interno, alinhada ao pico emitido mais atraso de grupo. Só observar vetor completo e finito **já disponível na emissão**; janela incompleta, lacuna ou vetor sem variação → `unavailable`, sem aprendizado. Isso é uma guarda de integridade, **não um índice de qualidade que prove ausência de ruído**.
- Declarar correspondência com template maduro somente se ele teve **pelo menos 3 observações anteriores**. O evento corrente não cria retroativamente sua própria evidência de maturidade. Não há classe clínica ou probabilidade associada a essa contagem.
- Expirar após **30 s sem correspondência**, expulsar o menos recentemente observado quando atingir a capacidade, e zerar a memória no início de lacuna. IDs não são reutilizados. Aprender em ordem de emissão, incluindo o aquecimento; resumir os eventos na janela oficial de pontuação.
- Controle original e cap 2 recebem bancos independentes. Rótulos são cruzados depois, usando o pareamento guloso já verificado. Um evento que cria template, não corresponde ou está indisponível continua emitido normalmente.

São parâmetros de **sonda**, escolhidos para expor riscos, não otimização de desempenho ou reprodução da literatura. Não foram reajustados após observar os resultados.

### 15.2. Resultados observacionais

Nos 101 registros, o controle mantém **30.418 TP / 582 FP / 435 FN**, e cap 2 mantém **30.763 / 632 / 90**. Teste liga/desliga da sombra compara evento a evento e confirma ausência de mudança no 228, incluindo medições causais; todos os controles são novamente conferidos contra o relatório congelado.

| Sonda nos 101 registros | Controle original | Cap 2 |
|---|---:|---:|
| Emissões pontuadas | 31.000 | 31.395 |
| Vetor indisponível | 3.575 | 3.690 |
| TP correspondentes a template previamente maduro | 25.771 | 26.146 |
| FP correspondentes a template previamente maduro | 133 / 582 | 135 / 632 |
| V pareados correspondentes a template previamente maduro | 1.602 / 4.073 | 1.562 / 4.077 |
| Templates criados (soma por registro) | 776 | 725 |
| Templates expirados / expulsos | 335 / 307 | 347 / 243 |

Os denominadores de V acima são **V já pareados**, não todos os V anotados; não medem sensibilidade ventricular. Templates criados podem incluir eventos do aquecimento ou além do limite pontuado; contagens de TP/FP só incluem a janela oficial.

| Registro, cap 2 | FP com correspondência madura / FP | V com correspondência madura / V pareados | N recuperados com correspondência madura |
|---|---:|---:|---:|
| 228 | 1 / 48 | 110 / 362 | 240 / 341 |
| 210 | 1 / 3 | 56 / 181 | 0 (nenhum recuperado) |
| 108 | 79 / 167 | 2 / 17 | 0 (nenhum recuperado) |
| 207 | 52 / 373 | 30 / 97 | 0 (nenhum recuperado) |

No 210, o V em 602,178 s cria template novo (melhor similaridade anterior 0,8984); o V em 609,808 s corresponde a esse template com 0,9942, mas só há **uma observação anterior**. O V em 945,772 s cria outro template (similaridade anterior 0,8611). Os três estão **não maduros**. Exigir correspondência madura como condição de aceitação os colocaria em risco, justamente os contraexemplos que precisamos preservar.

### 15.3. Interpretação e continuidade sem desvio

A sonda confirma que morfologias repetidas dos N recuperados podem adquirir memória, mas não demonstra recuperação pelo detector original: os 240 N reconhecidos foram emitidos pelo **cap 2**, ainda não promovido. Treinar só em eventos originalmente detectados deixa sem observação os N originalmente perdidos. Não usar essas contagens como prova de detecção independente ou ganho clínico.

**Contaminação observada:** 135 FP no cap 2 já encontram template maduro. Essa medida não identifica pureza de cada cluster ou a identidade T/ruído de cada FP; demonstra que recorrência não equivale a QRS verdadeiro. No 108, ruído/ondas recorrentes podem reforçar memória; no 207, a avaliabilidade do flutter permanece separada da validade morfológica. Não excluir esses trechos nem chamar templates maduros de “confiáveis” sem outra evidência.

**Limites:** só observar janelas completas perde cobertura; não há ajuste de alinhamento, níveis de energia por cluster, decisão de qualidade, sondagem de N não emitidos ou recuperação ativa. O banco usa memória limitada de vetores, mas o executor de pesquisa ainda guarda o registro inteiro e faz medições offline; não é implementação streaming pronta para produto. CPU e bytes totais do executor não foram aferidos nesta entrega. A sombra não impõe espera adicional, porque vetores incompletos são omitidos, não completados no futuro.

**Próximo teste na mesma linha:** medir correspondência prévia para candidatas abaixo do limiar, em modo consulta **sem aprendizado por essas candidatas**. Comparar cobertura de N perdidos versus FP, usando template formado exclusivamente no passado; registrar separadamente banco do controle e banco cap 2. Essa ablação enfrenta o conflito de cold start sem permitir auto-confirmação. Eventos novos/imaturos não serão vetados, preservando o caminho dos V prematuros; qualidade e maturidade não terão poder de rejeição nesta fase. Só após essa evidência considerar níveis de energia por morfologia ou uma intervenção causal, mantendo os critérios originais e a avaliação independente pendente.

## 16. Consulta causal de oportunidades abaixo da abertura, sem aprendizado

O [plano e protocolo](../plans/2026-10-08-subthreshold-shadow-query.md) foram gravados **antes da execução de resultados**. Implementação somente em `web/tests`: `ShadowBank.query`, vetor causal reutilizado de `qrs-morphology.mjs` e executor `qrs-subthreshold-query.mjs`. O [JSON compacto persistente](../plans/2026-10-08-subthreshold-shadow-query-results.json) contém todos os **101 registros**, ambos os bancos, símbolos e todos os intervalos de 30 s do 108/207; não contém sinais ou dumps de eventos. Entrega persistida no PR #13, sem merge, promoção, alteração em `web/src`, reajuste de parâmetros ou pesquisa externa.

Reproduzir em `web`:

```powershell
node --test tests\qrs-shadow-bank.test.mjs tests\qrs-morphology.test.mjs tests\qrs-subthreshold-query.test.mjs
node tests\qrs-subthreshold-query.mjs --all --output ..\docs\plans\2026-10-08-subthreshold-shadow-query-results.json
node tests\qrs-subthreshold-query.mjs mitdb/228 mitdb/108 mitdb/207 mitdb/210
npm test
```

### 16.1. Oportunidade, alinhamento e relógio fixos

Não consultar apenas candidatas fracas fechadas: esse recorte deixaria fora os 162/189 N perdidos sem candidata nas janelas da seção 8. A oportunidade desta ablação é **máximo local positivo da MWI, após calibração inicial, abaixo ou igual ao limiar de abertura registrado antes de processar a amostra do máximo**. A confirmação usa `anterior < máximo >= seguinte`, selecionando a primeira amostra de um platô. Não há piso de amplitude, filtro de refratário, restrição por candidata ativa ou gatilho por anotação; isso admite muitos máximos de ruído e vizinhanças de eventos já emitidos. Candidatas fracas **acima** da abertura não são um segundo estrato desta execução; não se mede recuperação exaustiva.

Alinhar ao maior módulo do passa-banda no intervalo MWI **anterior e inclusivo** ao máximo, empate para a amostra mais antiga. Subtrair o atraso de grupo para o tempo estimado. Não otimizar alinhamento por correlação ou referência. Consultar na primeira amostra que já confirmou o máximo e completou o vetor ±80 ms; a confirmação e o lado direito do vetor são dados passados no instante da consulta. Oportunidade com vetor incompleto pode esperar essa disponibilidade, mas não se usa futuro além do instante da consulta, preenchimento no fim do registro ou sinal ainda não recebido. Essa espera é apenas da sonda; nenhuma emissão do detector espera por ela.

Manter integralmente `SHADOW_PROTOCOL`: **4 templates, correlação assinada ≥0,90, 3 observações prévias para maturidade, expiração 30 s, ±80 ms, EMA 0,125**. Consultas filtram idade e excluem observação no mesmo instante **sem modificar nada**: vetor, suporte, `lastSeen`, `lastTime`, IDs, contadores, expiração ou expulsão. Executar a consulta **antes do aprendizado da emissão do mesmo passo**. Apenas eventos emitidos ensinam; nenhuma oportunidade consultada é aprendida. Bancos original/cap2 separados. Lacunas zeram o banco e invalidam histórico de máximos/consultas pendentes; vetores que cruzam amostras inválidas ficam indisponíveis.

### 16.2. Denominadores e resultados dos 101 registros

Pontuar pós-replay na janela oficial de 1 s até última referência +150 ms, tolerância ±150 ms. Primeiro parear emissões de cada banco com referências pelo algoritmo guloso existente; **remover as referências já detectadas** da avaliação incremental. `rawReferenceNearby` conta consultas com alguma referência próxima (não beats únicos); incidências por símbolo podem incluir mais de uma referência por consulta. `uniqueMissedNearby` conta referências perdidas únicas próximas de qualquer consulta, mesmo sem correspondência morfológica. As coberturas únicas por status podem se sobrepor e **não somam** a cobertura total.

Para propostas com correspondência madura, fazer novo pareamento guloso um-a-um **apenas às referências perdidas do próprio banco**. `maturePairedMisses` é cobertura hipotética por proximidade, **não TP clínico nem emissão adicional**. `matureUnmatched` é carga de propostas não pareadas, **não FP clínico**; inclui duplicatas e vizinhanças de referências já detectadas. Não subtrair retrospectivamente as propostas ruins da sonda.

| Medida na janela oficial | Original | Cap 2 |
|---|---:|---:|
| Emissões TP / FP / FN, inalteradas | 30.418 / 582 / 435 | 30.763 / 632 / 90 |
| Consultas brutas | 358.799 | 357.680 |
| Cold start (sem template anterior vivo) | 1.288 | 1.249 |
| Correspondência imatura | 5.272 | 5.188 |
| Sem correspondência | 337.198 | 336.197 |
| Indisponível | 0 | 0 |
| Correspondência madura | 15.041 | 15.046 |
| Consultas próximas de alguma referência | 94.877 | 93.854 |
| Consultas próximas de alguma referência perdida | 2.464 | 481 |
| Referências perdidas únicas próximas de qualquer consulta | 434 / 435 | 90 / 90 |
| Referências perdidas pareadas a proposta madura | 92 / 435 | 23 / 90 |
| Propostas maduras não pareadas | 14.949 | 15.023 |
| Não pareadas: vizinhança de perdida já coberta / duplicata | 107 | 34 |
| Não pareadas: só vizinhança de já detectada | 4.924 | 4.940 |
| Não pareadas: sem qualquer referência próxima | 9.918 | 10.049 |

Símbolos das perdas pareadas a propostas maduras: original **N 78, V 7, F 1, a 3, E 1, L 2**; cap2 **N 11, V 5, F 1, a 3, E 1, L 2**. Denominadores de perdas por símbolo no original: N 375, V 39, F 8, R 1, E 2, a 7, L 2, A 1; cap2: N 34, V 35, F 8, R 1, E 2, a 7, L 2, A 1. A única perda sem oportunidade próxima no original é V do 228. Não confundir cobertura de consulta com reconhecimento: a maioria dos máximos não corresponde a template.

Escopo de execução integral, além da janela oficial: **360.694 / 359.575** oportunidades enumeradas (original/cap2), **360.613 / 359.494** consultadas e **81 / 81** pendentes no EOF, sem padding futuro. Não houve lacuna real nas entradas selecionadas, nem vetor indisponível entre consultas pontuadas; testes sintéticos/injeção de lacuna cobrem esses caminhos, mas os zeros do corpus não validam desempenho em dados com falhas. Estatísticas de templates treinados continuam exatamente as da seção 15, inclusive expirações/expulsões; consultas não refrescam memória.

### 16.3. Casos de desenvolvimento e intervalos difíceis, sem exclusão

| Registro / banco | Consultas | Perdas originais do banco | Cobertura única por qualquer consulta | Perdas pareadas a proposta madura | Maduras não pareadas |
|---|---:|---:|---:|---|---:|
| 228 original | 29.621 | 352 (N 349, V 3) | 351 (N 349, V 2) | 73 (N 72, V 1) | 1.363 |
| 228 cap2 | 28.621 | 8 N | 8 N | 5 N | 1.315 |
| 108 original | 30.154 | 5 N | 5 N | 1 N | 2.444 |
| 108 cap2 | 30.105 | 5 N | 5 N | 1 N | 2.486 |
| 207 original | 20.619 | 10 (V 8, R 1, E 1) | 10 | 3 V | 529 |
| 207 cap2 | 20.596 | 9 (V 7, R 1, E 1) | 9 | 2 V | 576 |
| 210 original | 21.399 | 28 | 28 | 6 (V 1, F 1, a 3, E 1) | 1.133 |
| 210 cap2 | 21.398 | 28 | 28 | 6 (V 1, F 1, a 3, E 1) | 1.148 |

No **228 original**, todos os 349 N perdidos têm pelo menos uma oportunidade próxima derivada do sinal, incluindo o problema sem candidata da seção 8. Somente **72/349** encontram proposta madura pareável, bem diferente dos **240/341** N recuperados já emitidos e ensinados pelo cap2 na seção 15. Entre os N perdidos do original, proximidade por status é cold start 2, imatura 37, sem correspondência 346 e madura 72; estes conjuntos se sobrepõem. Logo a memória formada apenas pelo original não resolve automaticamente o cold start nem a alternância de energia. No cap2, a comparação incremental só considera suas oito perdas, não reconta os 341 N que ele já recuperou.

No **108**, há 1.431 / 1.479 propostas maduras sem referência próxima (original/cap2). O intervalo **[690,720) s**, incluído, tem 500 consultas e **111 maduras não pareadas** em cada banco, 64 sem referência próxima, nenhuma perda pareada; **[540,570) s** tem 107 não pareadas, 48 sem referência próxima. No **207**, há 507 / 537 maduras sem referência próxima. Em **[210,240) s**, original/cap2 têm **81 não pareadas**, 79 sem referência próxima; somente o original pareia uma perda V nessa janela. Cap2 ainda tem **64 não pareadas sem referência próxima em [1560,1590) s**. Flutter/avaliabilidade e ruído continuam problemas separados: nada foi excluído ou automaticamente declarado batimento verdadeiro.

O JSON conserva **todos** os intervalos de 30 s do 108/207, não apenas os exemplos acima. São estratos descritivos meio-abertos pelo tempo estimado da consulta; referências perdidas são alocadas pelo próprio tempo, podendo haver efeito de margem ±150 ms. Os agregados oficiais usam o registro inteiro, sem margens internas, e não são obtidos somando esses pareamentos de intervalos.

No **210**, consultas não têm decisão/veto e as emissões são idênticas liga/desliga. Os V novos/imaturos em **602,178; 609,808; 945,772 s** permanecem no caminho normal; exigir maturidade ainda os colocaria em risco, como já demonstrado na seção 15.

### 16.4. Verificação, conclusão e próxima hipótese limitada

O executor compara **evento a evento** consulta ligada/desligada para original e cap2 em **todos os 101 registros** (202 pares de replays), e confere cada controle contra `validation.json` congelado. Testes cobrem imutabilidade profunda/erros, expiração só-leitura e limite de 30 s, polaridade, maturidade prévia, consulta antes da emissão corrente aprender, independência de anotações, prefixo/futuro perturbado, vetor completo, máximos/platôs, lacunas e duplicatas versus perdas únicas. Nenhuma alteração de limiar, promoção ou aprendizado a partir das consultas.

Verificação final: **20/20 testes direcionados**, **219/219 em `npm test`**, seguido pelos benches sintético e real (exit 0); `node --check` e `git diff --check` passam, `web/src` sem diff. Não ocorreu falha aleatória IV/gzip. Duas execuções de `--all` produziram JSON byte-a-byte idêntico (SHA256 registrado no plano).

**Conclusão:** oportunidades derivadas do sinal ampliam o alcance observacional para N que nem abriam candidata, mas o reconhecimento maduro cobre **92/435** perdas originais com **14.949** propostas maduras não pareadas, incluindo **9.918** sem referência próxima. Portanto recorrência/maturidade continua insuficiente para habilitar recuperação automática, mesmo com consulta estritamente causal. Não se pode chamar isso ganho de sensibilidade/VPP: o detector não mudou.

**Próxima hipótese justificável, ainda não executada:** uma ablação descritiva da **compatibilidade de energia por template**, calculada causalmente só de emissões anteriores, pode investigar se as 9.918 propostas maduras sem referência próxima e as 92 perdas pareadas ocupam faixas de energia diferentes dentro da mesma morfologia. Pré-declarar as medições/denominadores antes de executar; manter consultas sem aprendizado, correlação/alinhamento atuais, original/cap2 separados e nenhum veto aos V novos. Não escolher limiar de energia nem alterar detector a partir desta entrega.

Os 101 registros, incluindo LUDB ímpar e MIT-BIH já inspecionados, são **teste/desenvolvimento e regressão, não validação independente**. A correspondência temporal não demonstra identidade QRS, pureza de template ou mecanismo T/ruído. O alinhamento fixo trailing-MWI não é o mesmo alinhamento do pico emitido e não foi otimizado; máximos múltiplos geram propostas redundantes; correlacionar forma normalizada perde informação de escala. CPU, custo de memória global e integração streaming/produto ainda pendentes: o replay de pesquisa mantém arrays completos e compara múltiplas execuções. Critérios da seção 9 e registros inéditos permanecem necessários antes de qualquer promoção.

## 17. Compatibilidade causal de energia dentro do template (descritiva)

Plano congelado **antes** da execução: `docs/plans/2026-10-08-template-energy-shadow.md`. Relatório: `docs/plans/2026-10-08-template-energy-shadow-results.json`. Reprodução (de `web`): `node tests\qrs-template-energy.mjs --all --output ..\docs\plans\2026-10-08-template-energy-shadow-results.json`.

### 17.1. Medida

Energia de um vetor = variância populacional (quadrado médio do vetor centrado) da mesma janela bandpass ±80 ms que é normalizada para a forma; é invariante a polaridade e deslocamento, e escala por k² quando a amplitude escala por k. O template guarda EMA de energia (peso 0,125 igual ao da forma), mínimo e máximo das energias emitidas, criados e descartados com o template (lacuna, expiração, evicção). A consulta lê o estado **anterior** sem alterá-lo; a emissão lê o estado prévio e só depois atualiza. A razão consulta/prior só existe com ambas finitas e positivas; `L = log2(razão)`. O MWI da consulta nunca é comparado ao `maxFeat` emitido. Nenhuma energia entra em casamento, maturidade, expiração, evicção, status, eventos, veto ou limiar. População: apenas consultas `mature-match`, pareamento um-a-um e estratos idênticos ao da seção 16 (`classifyMature` foi extraído, não reimplementado). Quantis min/p10/p25/mediana/p75/p90/max, histograma em oitavas, AUC (empates 1/2), sobreposição p10–p90, AUC por template (peso n_par·n_outro, suporte mínimo 3 por grupo só para listas) e posição da energia frente ao intervalo prior min/max.

### 17.2. Verificação

Projeção do relatório salvo da seção 16 (SHA256 `83a373d0…7033`): **101/101 registros e protocolos idênticos** (contadores por registro, 101 controles congelados e cap2 inalterados); eventos ligado/desligado idênticos em 101 controle + 101 cap2. Duas execuções `--all` geraram JSON byte-a-byte idêntico (SHA256 `E42E9516BD924C7952B1208441438D9D70CB6C93F7AEBE6981D8F258F004F4AC`, 529.233 bytes). Testes: 8 novos (escala analítica k², polaridade/offset, prior pré-atualização, imutabilidade profunda, lacuna/expiração/evicção, guardas finitas/planas/não disponíveis, AUC/quantis/Simpson-like, equivalência de `classifyMature`, eventos 228 on/off e causalidade prefixo/futuro NaN); **227/227 em `npm test`** (219 + 8) com benches exit 0; `node --check` e `git diff --check` passam; `web/src` sem diff.

### 17.3. Resultados (L = log2 energia consulta/prior; negativo = consulta menos energética que o prior do template)

| Banco | Grupo | n | mediana | p10–p90 | abaixo/dentro/acima do intervalo prior |
|---|---|---|---|---|---|
| original | pareadas a perdas | 92 | −3,15 | −5,06…0,12 | 62/28/2 |
| original | não pareadas | 14.949 | −6,39 | −9,08…−2,65 | — |
| original | sem referência próxima | 9.918 | −7,12 | −9,48…−3,51 | 9866/47/5 |
| original | já detectada | 4.924 | −4,88 | −7,69…−0,09 | 4062/799/63 |
| original | vizinhança de perda duplicada | 107 | −2,39 | −5,11…0,05 | 63/44/0 |
| cap2 | pareadas | 23 | −3,30 | −5,66…−1,62 | 23/0/0 |
| cap2 | não pareadas | 15.023 | −6,38 | −9,10…−2,60 | — |

Nenhuma energia ficou indisponível entre as propostas maduras (razão presente em 15.041 originais e 15.046 cap2).

AUC P(L_pareada > L_outro), original (cap2): vs. não pareadas **0,81** (0,77) agregada, **0,90** (0,85) estratificada por template (19 templates com ambos; 193 só de não pareadas; 0 só de pareadas; 15 de 19 com AUC>0,5); vs. sem referência **0,87** (0,84) / 0,97 (0,93); vs. já detectada **0,70** (0,63) / 0,66 (0,69), templates 9 acima e 7 abaixo (cap2 5/7); vs. vizinhança de perda duplicada **0,48** (0,53) / 0,55 (0,45) — sem separação. Sobreposição: 34% das não pareadas caem em p10–p90 das pareadas (e 53% das pareadas no das não pareadas). Em nível de registro: 9 registros com pareadas, só 4 (3 em cap2) com ≥3 em ambos os grupos, todos com AUC>0,5.

Registros-chave (AUC agregada pareada vs. não pareada; estratificada): 228 original 73 pareadas/1.363 não pareadas, 0,88; 0,93 (7 templates); cap2 5/1.315, 0,85; 0,86. 210: 6/1.133, 0,97 (ambos bancos). 207: 3/529, 0,87 agregada mas 0,44 dentro de template. 108: 1/2.444, 0,49 (n=1, sem inferência). Os 72 N pareados de 228 são bimodais (mediana L −0,99; p25 −4,6). Nenhum registro ou intervalo foi excluído.

### 17.4. Interpretação e limites

As perdas pareadas ocupam, em geral, energia relativa **maior** que as propostas sem referência (diferença de ~3,5 oitavas na mediana, ou ~3,4× em amplitude), e o contraste persiste dentro de templates, portanto não é só mistura entre templates. Porém: (i) a diferença é principalmente contra o estrato sem referência, que já é "ruído abaixo do prior"; contra já detectadas e duplicadas a separação é fraca ou nula, e as próprias propostas já detectadas (batimentos reais) são de baixa energia, de modo que energia relativa não distingue "batimento perdido" de "batimento já detectado"; (ii) a sobreposição é grande (34%–53% nos intervalos p10–p90) e a maioria das pareadas (62/92) fica **abaixo** do mínimo prior emitido; (iii) 92 pareadas em 9 registros, dominadas por 228 (73), 4 registros com suporte para AUC por template; (iv) o prior é estado variável no tempo (inclui candidatas emitidas ruidosas), idade/suporte distintos entre grupos; (v) alinhamento trailing-MWI das consultas ≠ alinhamento da emissão. Nenhum limiar de energia foi escolhido, não há afirmação de separabilidade, de sensibilidade/VPP, nem de resolução do cold start; não se deve interpretar como VP/FP clínico.

**Conclusão:** evidência descritiva positiva e parcial, mas insuficiente para qualquer limiar ou intervenção. Uma próxima hipótese local limitada seria avaliar (sem tocar o detector) se combinar energia relativa com a maturidade/suporte e com a vizinhança de detecções emitidas (já detectada) reduz a sobreposição, pré-declarada e com validação em registros inéditos. Conjunto de 101 registros = desenvolvimento/regressão, não validação independente; CPU/memória do estado extra (3 floats por template) não medidos; validação de produção e registros inéditos pendentes.

## 18. Suporte prévio e distância de decisão emitida: estudo limitado de contexto

O [protocolo](../plans/2026-10-08-support-emission-context.md) foi congelado **antes do primeiro resultado**. O [relatório persistente](../plans/2026-10-08-support-emission-context-results.json) conserva os 101 registros, bancos separados, distribuições/denominadores, estratos condicionais, templates qualificados, diagnóstico sem 228 e todos os intervalos do 108/207. Implementação somente em `web/tests`, sem APIs externas, aprendizado de consultas, classificador, escore combinado, escolha de limiar ou ajuste após resultados. A hipótese da seção 17 é investigada aqui **descritivamente**, não como modelo multivariável validado.

### 18.1. Relógios, suporte e protocolo causal

`supportBefore` e `ageS` são exatamente os campos anteriores da consulta ao template; nenhuma emissão corrente aumenta retroativamente o suporte. Mantêm-se oportunidades, alinhamento, pareamento e pontuação, correlação 0,90, maturidade 3, quatro templates, expiração 30 s, janela ±80 ms e EMA 0,125. Apenas emissões ensinam.

O evento anterior é a última emissão válida **disponível em ordem de decisão, estritamente antes de `queriedAt`**. A consulta ocorre antes da emissão do passo corrente e não a usa, mesmo se seu `event.t` estimado for anterior à candidata. O replay não filtra aquecimento antes de construir esse estado; lacunas o zeram. Evento anterior com vetor não aprendível ainda é emissão anterior. Nunca se usa anotação nem proximidade bilateral de referência como atributo online.

**Relógio primário:** `elapsedDecisionS = queriedAt − previous.emittedAt`, positivo quando disponível. **Diagnóstico separado:** `signedEstimatedS = candidate.t − previous.event.t`, que pode ser negativo com oportunidade atrasada e **não é tempo refratário não negativo**. Ausência de emissão anterior é `missing`, sem imputação. Os bins de decisão são [0;0,22), [0,22;0,36), [0,36;1), [1;∞) e missing. 0,22 s vem do parâmetro refratário atual, 0,36 s do antigo screen descritivo, 1 s é apenas descritivo; o relógio de decisão não é o relógio estimado usado pelo detector. Nenhum bin aceita/rejeita propostas. Suporte: 3–5, 6–15, ≥16; também são descritas as 15 células conjuntas e contexto dentro das oitavas de energia previamente fixadas.

**Comparação primária:** maduras pareadas um-a-um a **perdas do próprio baseline** versus não pareadas **sem referência próxima**. Comparações com já detectadas, duplicadas e todas não pareadas são secundárias e distintas. Maior energia e maior distância de decisão são direções pré-declaradas; suporte não tem direção monotônica pressuposta. AUC, quantis, sobreposição p10–p90 e diferenças de proporções por bin são descrições, não validação causal ou desempenho incremental de combinação.

### 18.2. Denominadores oficiais e efeito da mistura

Mantêm-se 30.418 TP / 582 FP / 435 FN no original e 30.763 / 632 / 90 no cap2. São **38 registros com propostas maduras**, nove com perdas pareadas, em ambos os bancos; os outros 63 continuam no relatório, não são excluídos. As 92/23 pareadas e 14.949/15.023 não pareadas são as mesmas das seções 16–17. Os números abaixo não são novos TP/FP.

| Medida primária (pareadas / sem referência) | Original | Cap2 |
|---|---:|---:|
| Propostas | 92 / 9.918 | 23 / 10.049 |
| Energia e decisão prévia disponíveis | 92 / 9.918 | 23 / 10.049 |
| Mediana L | −3,154 / −7,120 | −3,298 / −7,077 |
| Suporte prévio mediano | 39 / 33 | 205 / 28 |
| Decisão anterior: mediana, s | 1,181 / 0,561 | 0,583 / 0,556 |
| Decisão anterior: p10–p90 pareadas, s | 0,439–7,108 | 0,286–1,686 |
| Decisão anterior: p10–p90 sem referência, s | 0,242–0,942 | 0,242–0,894 |
| AUC energia agregada / dentro de template | 0,8681 / 0,9702 | 0,8357 / 0,9287 |
| AUC decisão agregada / dentro de template | 0,8656 / 0,5846 | 0,6130 / 0,5522 |
| Sem referência dentro do p10–p90 de decisão pareada | 63,90% | 74,10% |
| Pareadas dentro do p10–p90 de decisão sem referência | 17,39% | 60,87% |
| Templates primários com ≥3 observações por grupo | 4 | 2 |

Sem 228, **apenas como diagnóstico**, restam original 19 pareadas / 8.714 sem referência e cap2 18 / 8.831. AUC energia original 0,8507 (dentro de template 0,9248), decisão **0,5570** (0,5308); cap2 0,8360 (0,9249), decisão **0,5564** (0,5312). A sobreposição de decisão sobe a 71,16% / 73,68% (sem referência dentro do intervalo pareado / vice-versa), original. Logo a associação marginal forte do tempo é sobretudo mistura/dominância do 228 (**73/92 pares**); não se mantém como separação robusta dentro de template ou sem esse registro.

Das 358.799 / 357.680 consultas pontuadas, **650 / 650** não têm emissão anterior; todas são cold start (dos 1.288 / 1.249 cold starts totais). Nenhuma proposta madura está sem prior. O diagnóstico do relógio estimado identifica **20 / 23 diferenças negativas**: original duas imaturas e 18 sem correspondência; cap2 23 sem correspondência. Entre maduras há zero negativas e **2 / 4 zeros**, todos sem referência próxima. Isso não autoriza redefinir o relógio assinado como não negativo; testes também cobrem seu caminho negativo. O corpus não tem lacunas reais; reset é verificado por injeção.

### 18.3. Estratos fixos, suporte e sobreposição secundária

| Estrato primário | Original: pareadas / sem referência; AUC energia | Cap2: pareadas / sem referência; AUC energia |
|---|---|---|
| Suporte 3–5 | 1 / 1.742; 0,4828 | 0 / 1.806; indisponível |
| Suporte 6–15 | 9 / 1.756; 0,8378 | 4 / 2.043; 0,9003 |
| Suporte ≥16 | 82 / 6.420; 0,8943 | 19 / 6.200; 0,8427 |
| Decisão [0;0,22) s | 1 / 314; 0,8057 | 1 / 360; 0,8028 |
| Decisão [0,22;0,36) s | 4 / 2.734; 0,8135 | 4 / 2.710; 0,8044 |
| Decisão [0,36;1) s | 18 / 6.083; 0,8888 | 10 / 6.479; 0,8544 |
| Decisão [1;∞) s | 69 / 787; 0,9374 | 8 / 500; 0,8440 |

Contagens agregadas não conferem elegibilidade por registro. No original, suporte 6–15 é elegível em 207/228, suporte ≥16 em 208/210/228; tempo [0,36;1) em 210/228 e ≥1 s **só no 228**. No cap2, tempo [0,36;1) é elegível apenas em 210 e ≥1 s apenas em 228. As outras células têm poucos pares por registro.

O suporte não sugere uma direção universal: mediana pareada/sem referência no original é **8/15 em 207**, **1.064/12 em 208**, **351/326 em 210**, **36/15 em 228**. No template primário qualificado de 210, suporte é **205/496** apesar de AUC energia 1,00: suporte alto não equivale a proposta correta. Os quatro templates qualificados originais são três do 228 e um do 210; no cap2, um de cada. Não se escolhe retrospectivamente uma direção de AUC de suporte.

Dentro da faixa energética L<−4, AUC de decisão é 0,9215 no original (38/8.293), mas só 208/228 têm ≥3 por grupo; em [−4;−2), cai a **0,5608** (16/1.485), elegível em 210/228. Cap2: **0,7612** (7/8.346) e **0,5138** (13/1.512), respectivamente; na segunda faixa apenas 210 é elegível. As demais oitavas têm comparadores/pares esparsos. Condicionar altera distribuições, mas não demonstra ganho incremental de predição.

Secundárias preservadas, AUC energia / decisão (original; cap2): já detectadas, n=4.924/4.940, **0,6997 / 0,8298; 0,6332 / 0,4789**; duplicadas, n=107/34, **0,4822 / 0,5380; 0,5275 / 0,4674**. Na comparação duplicada, 85,98% das originais e 91,18% das cap2 caem no p10–p90 de decisão pareada, e 76,09% / 73,91% das pareadas no intervalo das duplicadas. Portanto o tempo não elimina a carga duplicada. Contra já detectadas, AUC de decisão dentro de template é **0,2770 / 0,2626**, direção oposta ao agregado original. Não usar a separação contra sem referência para esconder esses estratos.

### 18.4. Fechamento pré-declarado, intervalos difíceis e continuidade

O critério exigia ≥3 registros **não-228** com ≥3 pares e ≥3 comparadores primários utilizáveis, direção de energia e decisão >0,5 em cada registro elegível, e pelo menos **uma mesma célula conjunta** suporte/tempo elegível em ≥3 registros não-228, também com energia >0,5 em cada registro elegível da célula. Cap2 não pode substituir o controle para passar o critério.

| Registro não-228 elegível, original | Pares / sem referência | AUC energia | AUC decisão |
|---|---:|---:|---:|
| 207 | 3 / 507 | 0,8817 | **0,4497** |
| 208 | 4 / 1.210 | **0,3593** | 0,8712 |
| 210 | 6 / 968 | 0,9974 | 0,6525 |

Há os três registros marginais requeridos, mas **zero células conjuntas qualificadas em três registros não-228**. Apenas 210 tem célula conjunta não-228 elegível: suporte ≥16 e decisão [0,36;1), 4/417, energia 0,9994 (cap2 4/462, 0,9995). Em cap2, só **dois** registros marginais elegíveis, 208/210, também zero células conjuntas replicadas. Além da esparsidade, as direções marginais discordam em 207 (tempo) e 208 (energia). O comparador primário aqui é sem referência, não todas não pareadas da seção 17.

**Fechamento: `inconclusive-sparse` em ambos os bancos**, segundo o protocolo. Não há consistência demonstrada além do 228; esparsidade não é refutação da hipótese, e os contraexemplos observados não devem ser ocultados. Nem mesmo eventual aprovação deste critério descritivo provaria desempenho incremental multivariável: não houve fit, pesos, escore, validação independente ou intervenção.

Todos os **61 intervalos de 30 s de cada registro 108 e 207, em cada banco**, permanecem no JSON. O resumo anterior de consultas é conservado, e o contexto é alocado pelo tempo estimado com **rótulos do pareamento global** (não refeito nas margens dos intervalos). 108 [690;720) tem 111 não pareadas, 64 sem referência e zero pares em ambos; [540;570) tem 107/48/0. 207 [210;240) tem 81 não pareadas/79 sem referência nos dois bancos, um par original e zero cap2; cap2 [1560;1590) conserva 64 sem referência e zero pares. Nenhum trecho de ruído/flutter foi removido.

**Próximo passo recomendado, não executado nem autorizado automaticamente:** encerrar esta sequência de adicionar covariáveis; fazer uma única reavaliação limitada do gargalo de cobertura/alinhamento já identificado (434/435 perdas originais próximas de oportunidades, mas só 92 pareáveis maduras), ou decidir a reserva de registros inéditos antes de qualquer nova hipótese. Pré-declarar eventual estudo separado; não reajustar os bins, escolher limiar ou ampliar indefinidamente atributos para tentar fazer o critério passar. Preservar a linha local e os gates da seção 9.

Limites: oportunidades correlacionadas, alinhamento trailing-MWI diferente da emissão, prior temporal variável e possivelmente contaminado, quantis de grupos muito pequenos, corpus de desenvolvimento/regressão, CPU/memória global e integração streaming não aferidos, nenhum ganho clínico demonstrado. As 650 consultas sem prior e os zeros de lacunas reais não validam detecção em inicialização/falhas.

### 18.5. Verificação e estado de entrega

Reprodução em `web`: `node tests\qrs-support-emission-context.mjs --all --output ..\docs\plans\2026-10-08-support-emission-context-results.json`. Projeções de **ambos** os relatórios anteriores: 101/101 registros, totais e protocolos exatamente idênticos; arquivos anteriores não reescritos. Controles congelados 101/101 e eventos on/off idênticos em 101 original + 101 cap2.

Relatório final **4.867.030 bytes**, duas regenerações byte-a-byte idênticas, SHA256 `D039D02E4EF4B8895506D89B84C1224481A2A116DEBF44A4082B6F1F53560DFF`; contém estatísticas, não sinais ou eventos brutos. **36/36 testes direcionados**, **235/235 `npm test`** (227 anteriores + oito novos), benches sintético/real exit 0. `node --check` nos quatro módulos alterados/novos, `git diff --check` limpo e `web/src` sem diff. Nenhuma falha aleatória IV/gzip nas execuções completas; nenhuma correção não relacionada.

Pesquisa concluída e verificada no worktree. A subtarefa entregou os artefatos sem commit; o coordenador revisou a evidência e publica plano, relatório, testes e esta seção juntos no PR #13. Sem merge ou promoção do detector.
## 19. Auditoria de cobertura/alinhamento (uma ablação de deslocamento)

Plano congelado antes da execução: `docs/plans/2026-10-08-coverage-alignment-audit.md`; resultados compactos: `docs/plans/2026-10-08-coverage-alignment-audit-results.json` (731.824 bytes, SHA256 `ACD10AA89B26B1DA2217881D0EE2DE1DC96C38E2DAEFAF14ABBFCFD76E0FDE02`, duas execuções byte-a-byte idênticas). Reprodução em `web`: `node tests\qrs-alignment-audit.mjs --all --output ..\docs\plans\2026-10-08-coverage-alignment-audit-results.json`.

**Protocolo.** Mesma consulta original, mesmo instante e mesmo banco-sombra anterior (imutável, sem aprendizado da consulta, sem alterar eventos). Compara-se o centro fixo (máximo absoluto do bp na MWI) com deslocamentos predeclarados de {-20, -10, 0, +10, +20} ms em amostras inteiras (360 Hz: -7/-4/0/+4/+7; 500 Hz: -10/-5/0/+5/+10). Deslocamentos que exigem amostra futura são *indisponíveis* (sem padding, sem atraso posterior). Seleção: maior similaridade com sinal entre deslocamentos disponíveis com moldes vivos; empate pelo menor |ms|. Primário só de forma (timestamp estimado e rótulos originais fixos); secundário usa t+s/fs com denominadores separados. O máximo sobre até 5 deslocamentos é otimista por multiplicidade; foi controlado pela conversão por estrato posthoc. Os 101 controles congelados, eventos on/off e projeções anteriores de energia/consulta/contexto ficaram idênticos (101/101).

**Resultados (banco original/controle).** 435 falhas únicas; 434 próximas de alguma oportunidade; 1 sem oportunidade próxima. Pareados maduros: base 92 → deslocado 105 (+13 ganhos, 0 perdas); não pareados 14.949 → 24.234 (Δ=+9.285; burden marginal 714,2 por ganho vs. referência 162,5; média 230,8). Ganhos em 5 registros: 228 (+6), 106 (+2), 207 (+2), 210 (+2), 232 (+1); fora de 228 são +7 e **nenhum** registro não-228 atinge ≥3. Cap2 (apenas descritivo): 23 → 32 (+9), Δ não pareados +9.352 (1.039 por ganho). O secundário (timestamp deslocado) dá os mesmos 105 pareados e 24.234 não pareados (estratos distintos: 151/9.930/14.153).

**Decomposição das 434 falhas próximas (hierarquia exclusiva, base → deslocado).** maturo pareado 92 → 105; moldes vivos sem correspondência 292 → 259; imaturo 40 → 60; sem molde vivo (cold) 10 → 10; sem oportunidade 1. Em 404/434 o banco tinha molde maduro vivo; a maior parte (272→239) é "banco maduro mas sem correspondência ≥0,9". Melhor similaridade base: ≥0,9 em 132 (incluindo 92 pareados), [0,8;0,9) 211, <0,8 81, sem consulta 11. Transições por consulta: melhoraram 14.158, regrediram 104, inalteradas 344.537; nas consultas próximas a falhas: 131 melhoram/0 pioram (56 viram maduro, 75 imaturo). Disponibilidade: -20/-10 sempre; +10 em 135.740/358.799 e +20 em 114.652. Lag escolhido nas consultas que viram maduras: 0 (13.043), -10 (7.451), -20 (3.525), +10 (249), +20 (71); nas conversões de falhas próximas: -10 (45), -20 (10), +20 (1). Conversão por estrato (não-maduro→maduro): falha próxima 56/2.265 (2,5%), só detectado próximo 6.012/87.411 (6,9%), sem referência 3.334/254.082 (1,3%) — o deslocamento converte mais fora do alvo que no alvo, portanto sem especificidade. Intervalos de 30 s para 108 (sem ganho) e 207 estão no JSON.

**Leitura.** A ablação de alinhamento testada acrescenta uma fração pequena: +13 de 342 falhas próximas ainda não pareadas, mas custa +9.285 propostas maduras não pareadas. A ausência de correspondência ≥0,9 dentro de ±20 ms testados **não** prova ausência de morfologia nem de alinhamento melhor fora da grade; os moldes são treinados em eventos emitidos, sem rótulos clínicos, e sua maturidade não prova identidade QRS ou pureza. Corpus de desenvolvimento/regressão, sem validação independente; sem alegações de CPU ou produto.

**Critério congelado: NÃO atendido** (`not-met-alignment-alone-insufficient-stop`): ganho ≥10 atendido (13), replicação não (0 registros não-228 com ≥3) e burden marginal pior que 162,5. Esta ablação de alinhamento é insuficiente; investigação limitada encerrada, sem novas variantes nem busca de parâmetros e **sem promoção**. A causa das correspondências ainda ausentes permanece não resolvida; este resultado não demonstra que ausência ou imaturidade de molde dominem.

**Verificação.** 46/46 testes direcionados (10 novos); `npm test` 245/245 (235 + 10) e benches exit 0; `node --check` nos quatro módulos; `git diff --check` limpo; `web/src` sem diff; só ganchos aditivos em `qrs-subthreshold-query.mjs` e `qrs-support-emission-context.mjs`. O coordenador publica os artefatos juntos no PR #13, sem merge.

## 20. Síntese e decisão de encerramento desta etapa

**Decisão em 2026-10-08:** encerrar a etapa exploratória das variantes e sondas das seções 10–19, incluindo memória morfológica, energia, contexto e alinhamento. Não promover nenhuma variante, não continuar a busca de constantes ou combinações neste corpus e não declarar o problema QRS resolvido. Este é um fechamento de pesquisa com resultados negativos e inconclusivos documentados, não uma aprovação de produto nem refutação geral de métodos adaptativos ou de templates.

### 20.1. Pergunta, evidência e estado

O objetivo continua sendo recuperar QRS de baixa energia sem aumentar indevidamente FP ou perder V verdadeiros. O mecanismo local no 228 está sustentado pelo replay de MLII: limiares aprendidos com complexos de maior energia impedem a abertura de muitos N; nas candidatas fracas, RR inflado e limpeza da reserva pelo V seguinte limitam o search-back. Isso não explica automaticamente todas as falhas dos 101 registros.

| Estudo | Evidência decisiva | Estado desta etapa |
|---|---|---|
| Decaimento global | Tau 3 s: agregado 30.815 TP / 1.319 FP / 38 FN; regressão de VPP e falha do teto FP no 228 | Variante rejeitada |
| Cap de aprendizado | Cap2 no 228: FN 352 → 8, FP 9 → 48; teto congelado 19 | Variante rejeitada, apesar do ganho de cobertura |
| Triagem morfológica causal | Sinaliza 44 FP e três V reais do 210 | Não segura como veto universal |
| Memória e consultas sem aprendizado | Original: 92/435 perdas pareáveis a propostas maduras, 14.949 propostas maduras não pareadas | Forma e recorrência insuficientes nesta configuração |
| Energia por template | Contraste parcial, sobreposição e forte concentração de pares no 228 | Informação descritiva, não regra validada |
| Suporte e última emissão | Direções discordantes fora do 228 e células conjuntas esparsas | Inconclusivo; sequência de covariáveis encerrada |
| Alinhamento fixo ±20 ms | +13 pares hipotéticos e +9.285 propostas maduras não pareadas; replicação exigida não atingida | Ablação insuficiente; busca encerrada |

As contagens de propostas não pareadas **não são FP clínicos**; os pares hipotéticos não são emissões adicionais nem ganhos de sensibilidade. As sondas deixam a produção em 30.418 TP / 582 FP / 435 FN nos 101 registros. Não calcular desempenho de uma combinação pela subtração offline de eventos: uma intervenção muda aprendizado, RR, reservas e decisões futuras.

### 20.2. O que podemos e não podemos concluir

**Podemos concluir:** nesta configuração testada, baixar a proteção de energia recupera batimentos, mas também admite erros; maturidade não identifica verdade QRS; V novos não podem ser vetados por falta de memória; energia/contexto/alinhamento não forneceram evidência suficiente para uma intervenção segura pelos critérios adotados. A instrumentação, os controles, os protocolos e os resultados são reproduzíveis e permanecem disponíveis para retomada.

**Não podemos concluir:** que templates ou adaptação seletiva sejam inviáveis em geral; que toda proposta não pareada seja onda T/ruído; que ausência de correlação prove ausência de morfologia; que a falta de replicação seja refutação estatística; ou que exista generalização clínica. O mesmo corpus foi repetidamente inspecionado e é desenvolvimento/regressão, não validação independente. A causa das correspondências residuais ausentes permanece aberta.

O fechamento é justificável porque as perguntas delimitadas foram executadas, os critérios de parada foram aplicados sem reajuste e nenhum resultado sustenta promoção. Repetir deslocamentos, correlações ou bins neste momento acrescentaria risco de seleção sobre o corpus, não evidência independente. **Não é necessário executar mais uma variante para concluir esta etapa.**

### 20.3. Pendências fora deste fechamento e condição de reabertura

Antes de outra etapa de melhoria, definir uma pergunta nova que não repita a busca encerrada, seu mecanismo esperado, um comparador, critérios de sucesso/parada e a separação de desenvolvimento versus registros reservados. Registrar a reserva antes de inspecionar os resultados; não consumir dados novos apenas para resgatar variantes já rejeitadas. Não há nesta entrega uma regra candidata aprovada a validar em novos registros.

Qualquer futura promoção ainda exige os gates da seção 9 (228 FN ≤205 e FP ≤19, regressão por banco ≤0,005 absoluta e resultados por registro), preservação dos V críticos, replay causal da intervenção completa, lacunas, equivalência lote/streaming, latência/custo e avaliação independente. CPU/memória e integração produto não foram aferidos para as sondas; isso não impede o fechamento exploratório, mas impede alegações de prontidão.

**Estado de entrega:** pesquisa desta etapa concluída; problema de recuperação QRS ainda aberto; detector original preservado; PR #13 reúne código de pesquisa e documentação, sem autorização de merge nesta decisão. Planos e JSON das seções 16–19 são o contexto persistente. Esta síntese não executa experimento novo nem modifica os resultados anteriores.