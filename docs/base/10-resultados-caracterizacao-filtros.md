# 10 — Resultados B03: caracterização dos filtros

**Data:** 2026-10-08. **Estado:** concluída a caracterização Node v1, sem alteração de produção.
**Base:** branch `murillomagedanz-diagnostico-qrs`, commit `0884fd1`.
**Vínculos:** [protocolo congelado](08-protocolo-caracterizacao-filtros.md), [fundamento](02-caracterizacao-filtros.md), [B01](06-diagnostico-arquitetura.md), [SDD 002](../specs/002-consolidacao-base-ecg-3d.md).
**Artefato completo por caso:** [JSON v1](10-resultados-caracterizacao-filtros.json).

## 1. Resultado e limites do aceite

| Família | Casos | Passaram | Falharam | Bloqueados |
|---|---:|---:|---:|---:|
| Senoides | 270 | 270 | 0 | 0 |
| Impulso | 22 | 22 | 0 | 0 |
| Degrau | 6 | 6 | 0 | 0 |
| Inicialização atual | 6 | 6 | 0 | 0 |
| Prime explícito / lacuna / retomada | 6 | 6 | 0 | 0 |
| Notch0 | 2 | 2 | 0 | 0 |
| Notch impossível | 2 | 2 | 0 | 0 |
| Replay real | 5 | 5 | 0 | 0 |
| **Total** | **319** | **319** | **0** | **0** |

A primeira execução, antes de qualquer correção, já produziu **319 pass / 0 fail / 0 blocked**. Depois foram acrescentados pontos de curva, metadados do hardware e diferença total bruto/filtrado; a grade, durações, janelas, tolerâncias e resultados de aceite não mudaram. Não houve correção de filtro/detector, ajuste silencioso nem exceção de tolerância.

“Pass” em inicialização significa **caracterização finita do comportamento atual**, não aprovação de prime automático. No braço real significa integridade local, métricas disponíveis e preservação de eventos/escores, não bom desempenho clínico: LUDB83 continua com 8 FN e MIT228 com 352 FN/9 FP. B03 encerra a pergunta de medição, não consolida toda a base e não autoriza B05 antes de B04.

## 2. Método e precisão

Executado em Windows `10.0.26200`, Node `v24.13.0`, `win32/x64`, Intel Core Ultra 9 285K, 24 CPUs lógicas, memória física declarada `102382514176` bytes. Ambiente registrado para reprodução; **nenhum custo, tempo de processamento ou benchmark de hardware foi medido**. B04 mantém seu escopo independente Node/VM/navegador.

Senoides determinísticas de 1 mV pico e fase zero, em 360/500 Hz, 120 s com ajuste dos últimos 60 s. Cada fs/frequência tem nove trajetórias: PA escalar; notch50/60 isolados; cascata escalar e banco de 12 canais para notch0/50/60. Todas as 15 frequências congeladas estão abaixo de Nyquist. O banco recebe o mesmo vetor Float64 em cada canal, para separar arredondamento Float32 de sua saída; sua paridade entre canais foi exata.

As fórmulas complexas de PA, biquad e produto usam coeficientes derivados independentemente, sem consultar os objetos de produção. As trajetórias medidas usam somente `HighPass1`, `Notch` e `LeadFilterBank` existentes. Estimador: mínimos quadrados seno/cosseno/DC na frequência exata, matriz 3×3 com pivotamento. Não usa FFT/pico de bin.

Ganho é amplitude ajustada / 1 mV; resíduo RMS é normalizado por essa mesma entrada unitária. dB é publicado quando ganho > 0. Fases analítica/medida e erro são `null` quando ganho analítico < 0,01; o zero teórico do notch pode ter ganho numérico residual da aritmética complexa, sem interpretação de fase. Erro circular usa `atan2(sin(delta), cos(delta))`. Nenhuma fase foi convertida em atraso constante.

| Erro máximo efetivamente observado | Valor | Tolerância congelada |
|---|---:|---:|
| Ganho absoluto escalar PA/notch | `1.9373391779708982e-13` | `0.002` |
| Ganho absoluto cascata/banco | `1.720973652474811e-8` | `0.003` |
| Fase circular elegível (rad) | `2.41413354688802e-8` | `0.02` |
| Resíduo RMS normalizado | `1.7219140079743303e-8` | `0.002` |
| Impulso, máximo de todas as trajetórias (mV) | `2.8859593492747138e-8` | escalar `1e-6`; banco `1e-5` |

O JSON conserva resultados individuais, erros, limites e resumos dos primeiros 60 s separados do regime. Impulso/degrau/início têm curvas reduzidas em coordenadas fixas, pico e RMS; não são dumps de sinais completos.

## 3. Transientes, estado e superfície de erro

- **Impulso:** 20 s, estado zero, confronto com recorrência independente. Todas as amostras foram finitas; os 12 canais do banco foram iguais.
- **Degrau:** 30 s, subida em 5 s. O PA fica ≤0,01 mV até EOF a partir de `6.472222222222222` s em 360 Hz e `6.47` s em 500 Hz: respectivamente `1.4722222222222223` e aproximadamente `1.47` s após a subida. São tempos descritivos, não gates fisiológicos.
- **Início constante de 1 mV:** o banco **não faz prime automático na primeira amostra**. Primeira saída para notch0/50/60: em 360 Hz, `0.9913488626480103 / 0.9788514375686646 / 0.9772435426712036` mV; em 500 Hz, `0.9937560558319092 / 0.9841152429580688 / 0.9825460910797119` mV. O transiente depois decai. A tabela de filtros em B01 dizia “na primeira amostra válida”; só a primeira amostra **após lacuna** é rearmada no código atual. Este relatório registra a divergência documental sem alterar produção nem reescrever B01.
- **Prime explícito:** PA e notch são armados em sequência no valor correspondente à entrada de cada estágio. O banco não tem API pública `prime`; a sonda arma suas cadeias existentes explicitamente. Saída máxima escalar/banco: **0 mV**.
- **Lacuna:** máscara de todos os canais por exatamente 3 s; retomada em 2,5 mV. Estados dos filtros e índice de processamento do detector não avançam. O banco retorna o último valor, mas a máscara é preservada e esse valor **não é nova amostra**. Na retomada: cascata **0 mV**, MWI **0 mV²**, máscara `null`. Testes existentes também verificam RR, fechamento de candidata e eventos atravessando gaps.
- **Notch impossível:** em fs100, banco50/60 contém somente PA, `notchActive:false`; classe isolada lança `RangeError` antes de qualquer processamento. Mensagens exatas estão no JSON. Não existem coeficientes de notch instável em uso.
- **Notch0:** processamento está corretamente desativado e igual ao PA dentro do arredondamento Float32. A descrição atual diz `fs ... ≤ 2 × 0 Hz`, embora a desigualdade seja falsa. Essa inconsistência de texto foi observada, não corrigida.

Falhas inesperadas não são normalizadas em “pass”: cada caso compara seus critérios diretamente; falha/bloqueio dá saída CLI não zero. Falhas de leitura/replay aparecem com classe/mensagem por registro. Nesta execução não houve falha ou indisponibilidade. Os limites já conhecidos de unidade desconhecida/checksum falso permanecem fora de uma correção B03.

## 4. ECG real e observação do detector

Replay **inteiro**, nativo, por `FileSource` → `SignalPipeline.step`. LUDB8/56/83: 5.000 amostras cada, 500 Hz, rede50, janela `[1,9)` s = `[500,4500)` amostras. MIT100/228: 650.000 amostras cada, 360 Hz, rede60, janelas `[60,70)` = `[21600,25200)` e `[400,410)` = `[144000,147600)`. Não foram substituídas janelas.

Detecção em II; MIT reconhece alias MLII. As 40 unidades de canal declaradas são mV, fator1, conhecidas; 40/40 checksums de sinal conferem. Janelas completas, sem amostras inválidas. JSON registra disponibilidade/mapeamento dos canais, contagens ausentes e SHA-256 dos arquivos locais de sinal/anotação/cabeçalho. Os canais não presentes no MIT não são interpretados como medições reais nas métricas.

A sonda lê estados primitivos **após** `step`: saída PA/notch, médias curta/longa, passa-banda, diferença atrasada, quadrado Float32 armazenado, MWI/limiares adaptativos. Guarda apenas o histórico anterior necessário para observar a diferença efetiva; não duplica o processamento nem modifica os objetos. Teste confere `Float32(derivada²)` contra o quadrado realmente armazenado, MWI contra estado e ausência de efeitos colaterais.

| fs | Curta/longa | Parâmetro derivada | Lookback efetivo | MWI |
|---|---|---|---|---|
| 500 Hz | 15/75 amostras | 5 amostras | **6 = 12 ms** | 50 amostras |
| 360 Hz | 11/54 amostras | 4 amostras | **5 = 13,888888888888889 ms** | 36 amostras |

A “derivada” é `bp[n] − bp[n−L]`, **sem dividir por L/fs**: unidade mV, não mV/s. Quadrado, MWI, limiares e níveis adaptativos são mV² nessa convenção. RMS do quadrado é a raiz da média dos quadrados de uma sequência já em mV², não amplitude ECG. Comparações de diferença só usam mesma unidade: MWI compara com quadrado; quadrado não subtrai derivada. Nenhuma largura interna recebe interpretação clínica.

Resumo das janelas (valores arredondados somente nesta tabela; JSON mantém precisão):

| Registro | RMS bruto mV | RMS filtrado mV | RMS bruto−filtrado mV | RMS BP mV | RMS derivada mV | RMS MWI mV² |
|---|---:|---:|---:|---:|---:|---:|
| LUDB8 | 0,085709 | 0,083794 | 0,015865 | 0,064640 | 0,035905 | 0,002924 |
| LUDB56 | 0,119274 | 0,116760 | 0,022281 | 0,091490 | 0,052459 | 0,005906 |
| LUDB83 | 0,074115 | 0,065504 | 0,034417 | 0,051735 | 0,017977 | 0,000949 |
| MIT100 | 0,330898 | 0,169311 | 0,282704 | 0,111001 | 0,096066 | 0,023321 |
| MIT228 | 0,453003 | 0,393039 | 0,214061 | 0,331558 | 0,146661 | 0,063193 |

JSON publica RMS, pico absoluto, coordenada índice/segundos e diferença por estágio. Tudo no relógio original, sem deslocamento/alinhamento. Não foram medidas formas por batimento nem contornos P/QRS/T; por isso não há largura/censura de batimento a interpretar. Anotações entram **somente depois do replay**, para controles. A diferença é **conteúdo transformado**, não evidência automática de ruído, fisiologia ou benefício.

Eventos completos com observação ligada/desligada foram idênticos nos cinco replays. Pontuação congelada: ±150 ms, aquecimento ≥1 s, detecções até última referência +150 ms; referência/escores vêm de `web/data/reports/validation.json`, não são regravados.

| Registro | Eventos totais | Ref. pontuadas | TP | FP | FN | Viés / MAE ms |
|---|---:|---:|---:|---:|---:|---:|
| LUDB8 | 11 | 10 | 10 | 0 | 0 | 24,8 / 25,2 |
| LUDB56 | 11 | 10 | 10 | 0 | 0 | −0,4 / 0,8 |
| LUDB83 | 1 | 9 | 1 | 0 | 8 | 82 / 82 |
| MIT100 | 2271 | 2272 | 2271 | 0 | 1 | −2 / 2 |
| MIT228 | 1709 | 2052 | 1700 | 9 | 352 | 8,4 / 11,4 |

**Zero divergências de referência**, incluindo sensibilidade/VPP arredondados como no relatório congelado. Preservar o mau resultado de LUDB83/MIT228 é regressão fiel, não satisfação de um gate de melhoria.

## 5. Reprodução e validação

Na raiz do worktree:

```powershell
node --check web\tests\filter-characterization.mjs
node --check web\tests\filter-characterization.test.mjs
node web\tests\filter-characterization.mjs --output docs\base\10-resultados-caracterizacao-filtros.json
Set-Location web
node --test tests\filter-characterization.test.mjs tests\filters.test.mjs tests\gaps.test.mjs tests\wfdb.test.mjs
npm test
```

Sem `--output`, a CLI emite JSON determinístico com todos os casos, sem sinais extensos nem relógio de parede. O teste faz duas gerações integrais e exige igualdade **byte a byte**; também confere o artefato salvo. Metadados do host são comparados separadamente da parte científica para permitir regressão em outro hardware, sem fingir que foi medido ali.

Validação: **137 testes direcionados passaram**, 0 falhas/ignorados; **7 novos testes** verificam estimador conhecido, wrap/zero/null, recorrência, estado/gap/limites, unidades/coordenadas, observação e determinismo. `npm test`: **256 testes passaram** na última execução (252 na primeira, antes da chegada de testes do agente independente), 0 falhas/ignorados, mais benches sintético e real aprovados; agregado real atual 36.403 referências, sensibilidade 0,9857 e VPP 0,9801. O benchmark amplo inclui opcionais locais existentes, não muda o relatório congelado de 101 registros. Nenhum flaky vault ocorreu nesta execução. `node --check` e `git diff --check` passaram. Não há eslint/TypeScript configurado; nenhuma ferramenta/dependência foi instalada.

## 6. Encaminhamento B05, sem intervenção algorítmica

1. **Integridade/escala:** manter prioridades B01 de unidade desconhecida/checksum falso e contrato explícito antes de mudanças; estes cinco replays íntegros não exercitam todos os casos de corrupção.
2. **Observabilidade/inicialização:** reconciliar documentação e contrato de início zero-state versus prime explícito versus retomada. Primeiro passo atual não é igual a retomada pós-gap; decidir comportamento requer tarefa posterior, não correção inferida deste estudo.
3. **Texto efetivo:** corrigir futuramente descrição notch0, distinguindo desativação voluntária de limite Nyquist, com teste de UI/contrato.
4. **Detector/unidades:** expor lookback efetivo e ausência de normalização temporal; não “consertar” atraso/ganho sem protocolo próprio. Não reabrir hipótese QRS pelos resultados de LUDB83/228.
5. **Reprodução:** eventual instrumentação de produto deve preservar eventos e separar relógios/unidades como a sonda de testes; custos/budgets dependem de B04.

Não houve produção alterada, download, API externa, commit, push ou merge. B04 é independente; B05 permanece sujeito às dependências B02+B03+B04.
