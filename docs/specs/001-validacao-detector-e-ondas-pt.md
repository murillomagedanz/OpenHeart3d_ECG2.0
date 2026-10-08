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
