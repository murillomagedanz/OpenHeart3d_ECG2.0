# 11 — Resultados B04: robustez e custo inicial

**Data:** 2026-10-08. **Estado:** braço Node/VM executado; braço navegador/WebGL pendente.  
**Protocolo congelado:** [09 — B04 v1](09-protocolo-robustez-custo.md). **Diagnóstico de origem:** [06](06-diagnostico-arquitetura.md). **Dados locais:** [07](07-inventario-dados.md). **Diretor:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md).

B04 foi executado sem alterar produção, algoritmos, limiares, dependências ou dados. A entrega fecha somente a medição Node e os testes de controles em VM: não fecha B04 em navegador, não fecha B06 e não certifica eficiência. Nenhum budget de produto foi definido.

**Seguimento posterior:** [12 — correção delimitada F08](12-correcao-relogio-reset.md), [13 — integridade de comprimento WFDB](13-integridade-comprimento-wfdb.md) e [14 — integridade e escala WFDB](14-integridade-calibracao-wfdb.md) documentam exceções específicas e evidências correntes. Este documento e seus JSONs **11** continuam baseline histórico anterior às correções. O gerador funcional atual é v4 e escreve [evidência 14](14-integridade-calibracao-wfdb.functional.json); executar hoje o comando funcional abaixo não reproduz nem sobrescreve o snapshot v1 nem as evidências v2/v3.

**Seguimento F01:** a aceitação de prefixos WFDB truncados foi corrigida separadamente em [13 — integridade de comprimento](13-integridade-comprimento-wfdb.md), com evidência corrente v3. Os resultados e JSONs desta página continuam registrando corretamente o baseline histórico anterior às correções.

## Artefatos e reprodução

Em `web/`, na revisão `0884fd1` da branch `murillomagedanz-diagnostico-qrs`:

```powershell
node tests\operational-functional.mjs
node tests\operational-baseline.mjs
npm test
```

- [JSON funcional](11-resultados-robustez-custo.functional.json): determinístico, sem tempos de execução; estados por F01–F11, evidências, arquivos e limites.
- [JSON de custo](11-resultados-robustez-custo.cost.json): variável por execução; ambiente permitido, amostras temporais completas em blocos de 1 s, memória e tempos por repetição. Não se promete identidade byte a byte.
- Runner de custo: `web/tests/operational-baseline.mjs`; testes Node/VM: `web/tests/operational-baseline.test.mjs`; gerador funcional: `web/tests/operational-functional.mjs`.
- Validação: `node --check` nos três módulos novos; `npm test` concluiu com **256 testes aprovados, 0 falhas** e os dois benchmarks já configurados no script.

## Funcionais — Node/VM

| ID | Estado | Resultado observado |
|---|---|---|
| F01 | **Parcial** | LUDB 8 válido: 5.000 amostras e 12/12 checksums corretos. Arquivo requerido ausente lança erro explícito. Na cópia format-16 truncada de 4 para 2 amostras, `loadRecord` não lança erro e devolve o prefixo de 2; a discrepância foi reproduzida, não tratada como aprovação. |
| F02 | **Falhou — lacuna P0** | A fixture de checksum divergente resulta em `false`; `mmHg` resulta em `known:false`, fator 1. Mesmo assim, `FileSource` e `SignalPipeline.step` aceitam o sinal e retornam filtrado finito. Continuação permissiva não é sucesso de integridade ou escala. |
| F03 | **Passou** | Sem II, usa derivação reconhecida disponível (V1 no ensaio); sem rótulos reconhecidos, mapeia os canais genéricos explicitamente (ECG1→I). Ausência não foi relatada como medição zero. |
| F04 | **Passou** | Lacuna II `[15,18)` s, 40 s sintéticos seeded e retomada com +1,5 mV: zero eventos durante a lacuna e zero falsos eventos nos primeiros 300 ms; a máscara foi preservada. |
| F05 | **Passou** | Lacuna de 3 s apenas em I produziu 1.500 amostras mascaradas nessa derivação; o fluxo de eventos de II permaneceu idêntico ao controle sem lacuna (SHA-256 no JSON funcional). |
| F06 | **Passou** | Replay de 5.000 amostras: `SignalPipeline.step` e `detectAll` produziram os mesmos 11 eventos e digest; todos os passos filtrados foram finitos e nenhuma amostra foi mascarada. |
| F07 | **Parcial** | VM da aplicação: pausa de 2 s sem avanço do índice/relógio; retomada e velocidades 0,5×/1×/2× alteraram a cadência, não `fs`. Browser/`requestAnimationFrame` real não medido. |
| F08 | **Falhou + runtime parcial** | VM: LUDB 8 avançado até 3,998 s; rebuild de pipeline por notch resetou índice para −1, mas conservou `state.signalTime = 3,998`. Um frame antes da nova amostra passou esse relógio antigo a `Heart3D.update`. A troca para MIT-BIH 100 conservou o valor até o primeiro `step`; aliases/fs corretos e o notch 50/60/0 reconstruiu filtros. Browser não medido. |
| F09 | **Parcial** | Testes existentes Node/VM cobrem P/T sem T final fabricada, janela de 10 s, invalidação por lacuna e export allowlisted. Nenhuma inspeção visual ou WebGL real. |
| F10 | **Parcial** | Fallback procedural coberto por código/testes Node/VM. Chave do asset opcional não foi fornecida nem consultada; nenhum asset privado foi buscado, decifrado ou aberto. Visualização no navegador não medida. |
| F11 | **Parcial** | Runner Node processou quatro fluxos de 30 min de sinal; VM fez 100 recriações de fonte/pipeline. Sem observação de heap/browser, WebGL ou ciclo de vida de renderização, não há conclusão sobre vazamento de recursos. |

Nenhum teste VM substitui o braço navegador: F07/F09–F11 permanecem parciais como critérios globais de runtime. F08 tem também a falha concreta de relógio antigo reproduzida em VM; não foi corrigida durante o baseline. O JSON funcional registra evidência e limites completos.

## Custo Node — ambiente e método

Máquina reportada: Windows (`win32 10.0.26200`), Intel Core Ultra 9 285K, 24 processadores lógicos, 102.382.514.176 bytes de memória física, Node v24.13.0, V8 13.6.233.17-node.37; heap limite reportado 4.496.293.888 bytes. Revisão: `0884fd1`. Nenhum hostname, caminho local ou variável de ambiente foi incluído.

Cada carga sintética usou seed `20261008`, 12 derivações, frequência nativa de 360 ou 500 Hz, PA 0,5 Hz, notch 50 ou 60 Hz, duração de sinal de 1.800 s, HR 72 bpm, HRV 4%, ruído 0,03 mV e rede 0,05 mV. Isso corresponde a 648.000 ou 900.000 amostras **por canal**. A fonte gerou uma amostra por vez e alimentou o `SignalPipeline.step` de produção; não se materializou a carga do benchmark primário nem se usou `filterAll` como proxy.

Por configuração houve um aquecimento, um controle sem coleta detalhada e cinco medidas com cronometragem em blocos de 1 s. Cada medida contém 1.800 tempos de bloco; o JSON conserva os 9.000 valores dos cinco runs. Mediana/faixa abaixo resume os cinco tempos totais, e p50/p95/máximo resume os blocos. Throughput por canal usa `fs × 1.800` (uma derivação, incluindo II); throughput agregado multiplica por 12. Os digests de eventos dos cinco runs medidos coincidiram em cada configuração.

| fs / notch | Total (mediana; min–máx), ms | Sinal s / parede s (min–máx) | Amostras/canal/s (min–máx) | Amostras agregadas/s (min–máx) | Bloco 1 s p50 / p95 / máx, ms | RSS / heap amostrados, MiB |
|---|---:|---:|---:|---:|---:|---:|
| 360 / 50 Hz | 471,181; 466,497–552,770 | 3.256,3–3.858,5 | 1.172.277–1.389.076 | 14.067.326–16.668.917 | 0,249 / 0,367 / 0,984 | 61,6–62,2 / 6,2–8,3 |
| 360 / 60 Hz | 587,279; 581,880–590,055 | 3.050,6–3.093,4 | 1.098.203–1.113.631 | 13.178.439–13.363.578 | 0,316 / 0,405 / 1,054 | 67,3–67,6 / 7,5–11,4 |
| 500 / 50 Hz | 799,464; 798,431–816,899 | 2.203,5–2.254,4 | 1.101.728–1.127.211 | 13.220.730–13.526.537 | 0,436 / 0,550 / 0,831 | 68,3–76,6 / 8,2–14,8 |
| 500 / 60 Hz | 805,314; 802,261–805,912 | 2.233,5–2.243,7 | 1.116.747–1.121.829 | 13.400.965–13.461.950 | 0,437 / 0,546 / 0,756 | 77,4–77,6 / 12,2–16,3 |

Memória foi amostrada no início, a cada 60 s de sinal e no fim do primeiro run medido: 31 observações por configuração, sem GC explícito. No conjunto, `external` observado ficou em 2,0 MiB e `arrayBuffers` em 0,02–0,03 MiB. A fonte sintética retém também sua pequena lista de tempos R verdadeiros; não retém o vetor de amostras do ECG no benchmark primário. Os ranges não são teste de leak: V8 pode coletar durante a medida, e não se isolou cada objeto nem se comparou heap pós-GC. Um controle único versus as cinco medidas instrumentadas variou +0,06% a +2,66%; é apenas uma indicação ruidosa de overhead, não correção aplicada aos tempos.

### Fases independentes e registros reais

As fases não são aditivas nem representam um pipeline integrado total. Leitura de bytes ocorre antes do timer do decoder; o timer cobre parse WFDB, decodificação, checksums e anotações. Filtro+QRS é um replay próprio do passo de produção sobre entrada previamente materializada. P/T usa a saída desse setup; espectro/STFT e serialização usam a janela operacional de 10 s (STFT: 9 quadros, FFT 1.024). Cada linha teve um aquecimento e cinco medidas.

| Contexto / fase | Entrada | Tempo (mediana; min–máx), ms | Evidência |
|---|---|---:|---|
| Sintético 500 Hz / 50 Hz — filtros + QRS | 30 min, 12 canais | 144,339; 143,621–147,297 | 2.161 eventos; fase isolada |
| Mesmo setup — delineação P/T | 2.161 eventos | 147,428; 145,432–149,250 | 2.152 P e 2.160 T estimadas; não é medida de acurácia |
| Mesmo setup — espectro + STFT | 10 s II | 6,335; 5,994–6,600 | 9 quadros STFT, FFT 1.024 |
| Mesmo setup — serialização | JSON espectral + STFT | 3,424; 3,250–4,180 | 944.947 bytes |
| LUDB 8 — WFDB decoder | 5.000 amostras, 500 Hz, 10 s | 0,725; 0,635–0,839 | 12/12 checksums; decode inclui anotações |
| LUDB 8 — filtros + QRS | II, notch 50 Hz | 1,578; 1,301–1,849 | 11 eventos |
| MIT-BIH 100 — WFDB decoder | 650.000 amostras, 360 Hz, 1.805,556 s | 12,280; 12,087–13,941 | 2/2 checksums; decode inclui anotações |
| MIT-BIH 100 — filtros + QRS | II ← MLII, notch 60 Hz | 152,338; 151,666–161,902 | 2.271 eventos |

LUDB 8 e MIT-BIH 100 são reproduções reais separadas, não estimativa de corpus nem validação de detecção; contagem de eventos serve à verificação de repetibilidade. Latência de emissão do detector é tempo de sinal até decisão, não CPU, frame ou atraso de apresentação.

## Limites e encaminhamento

- Resultado de um computador potente e de loops acelerados; taxa maior que tempo real não é budget, garantia de responsividade, consumo/bateria ou eficiência em dispositivos-alvo.
- O braço navegador/WebGL de F07–F11 não foi executado. F02 falhou por permissividade de integridade/calibração e F01 mostrou aceitação de prefixo truncado; ambos permanecem achados funcionais explícitos para priorização posterior.
- Nenhum algoritmo/produção foi corrigido durante a medição. Não há aprovação clínica, mudança de detector, decisão de budget ou autorização para B06/B05.
- A próxima decisão sobre budgets depende de dispositivo/carga-alvo acordados; navegador e B05 permanecem pendentes conforme o SDD 002.
