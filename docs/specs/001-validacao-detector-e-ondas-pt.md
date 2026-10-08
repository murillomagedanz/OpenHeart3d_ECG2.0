# SDD 001 — Validação reprodutível do detector de QRS e detecção/visualização de ondas P e T

Status: em execução · Autor: Eng. Murillo Magedanz (idealização) · Decisões derivadas: D15 e D16 em [`docs/DECISOES.md`](../DECISOES.md)

## 1. Objetivo

1. **(A)** Tornar a validação do detector de QRS ampla, estratificada e reprodutível: mais registros públicos anotados, métricas completas e um relatório versionado que um teste reproduz bit a bit.
2. **(B)** Detectar e exibir ondas P e T (pico, início e fim) a partir do sinal já filtrado, pontuadas contra as anotações do LUDB, que traz P/QRS/T anotados por derivação.

## 2. Escopo

Dentro: registros LUDB adicionais (37, total 39) no repositório; extensão aditiva de `scoring.js`; relatório `web/data/reports/validation.{json,md}`; delineador `web/src/ecg/waves.js`; parser das anotações de delineação do LUDB; marcadores P/T **opcionais e apenas visuais** na tira de ritmo; documentação e decisões.

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
