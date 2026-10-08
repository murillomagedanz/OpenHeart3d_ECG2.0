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
