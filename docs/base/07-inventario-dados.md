# 07 — Inventário de dados ECG e governança

**Vínculo:** [SDD 002, B02](../specs/002-consolidacao-base-ecg-3d.md) e [contrato de dados reais](04-dados-reais-avaliacao.md). **Estado:** B02 concluído; snapshot da worktree no commit `530b0ea`, sem downloads nem alterações nos sinais. O [JSON determinístico](07-inventario-dados.json) lista cada registro, disponibilidade local, metadados selecionados do cabeçalho, integridade WFDB e eventual inclusão nos relatórios.

## 1. Contagens reconciliadas

Contagem física verificada em `web/data/records/`; “versionado” significa arquivos rastreados pelo Git. Todos os conjuntos de arquivos declarados no manifesto estavam completos nesta worktree.

| Banco | Manifesto | Empacotados / rastreados | Presentes completos localmente | Fs e perfil observado |
|---|---:|---:|---:|---|
| LUDB | 87 | 87 | 87 | 500 Hz, 5.000 amostras (10 s), 12 sinais e 12 arquivos de anotação por derivação |
| MIT-BIH Arrhythmia | 16 | 14 | 16 | 360 Hz, 650.000 amostras (1.805,556 s no cabeçalho), 2 sinais e 1 `.atr` por registro |
| PTB-XL | 3 | 3 | 3 | 500 Hz, 5.000 amostras (10 s), 12 sinais, sem anotação de batimentos |
| **Total** | **106** | **104** | **106** | **1.266 arquivos rastreados; 1.272 presentes** |

Os seis arquivos locais adicionais são os conjuntos completos `mitdb/105` e `mitdb/203` (cada qual `.hea`, `.dat`, `.atr`), não rastreados porque `web/data/records/` é ignorada pelo Git. Não há arquivos ausentes nos 106 registros declarados. PTB-XL e os MIT-BIH 105/203 não pertencem à seleção QRS congelada. Os arquivos locais opcionais foram lidos nesta reconciliação e incluídos uma vez na reprodução opcional abaixo; portanto, nenhum registro QRS atualmente disponível é declarado reservado ou inédito.

### Fichas por banco

Metadados de fonte, URL, versão, licença e frequência de rede abaixo reproduzem o `web/data/manifest.json` e a documentação local. **Licenças e termos não foram reconsultados nas fontes externas nesta tarefa.**

| Banco e proveniência declarada | Direitos declarados | Composição e referência disponível | Limites de proveniência |
|---|---|---|---|
| **MIT-BIH Arrhythmia Database 1.0.0** — [PhysioNet](https://physionet.org/content/mitdb/1.0.0/), arquivos em `https://physionet.org/files/mitdb/1.0.0/`; rede 60 Hz | ODC-BY 1.0 | Fonte com duas derivações, 360 Hz; MLII e uma segunda derivação que varia (V1/V2/V5). Cabeçalhos locais: 2 sinais, 650.000 amostras; entrada QRS selecionada é `II ← MLII`. `.atr` contém anotações de batimento, usadas pelo escore QRS. | Não há identidade paciente/sessão vinculada no manifesto. Cabeçalho dá ganho, baseline, unidade e checksums por sinal; aquisição, dispositivo e processamento anterior não estão caracterizados registro a registro. |
| **LUDB 1.0.1** — [PhysioNet](https://physionet.org/content/ludb/1.0.1/), arquivos em `https://physionet.org/files/ludb/1.0.1/`; rede 50 Hz | ODC-BY 1.0 | 12 derivações, 500 Hz, 5.000 amostras; os conjuntos locais incluem 12 arquivos de anotação, um por derivação. O QRS usa `*.ii`; a avaliação de P/T consulta as anotações por derivação. | Cabeçalho tem ganhos/baselines por sinal, variáveis entre registros. Não há informação suficiente no inventário para comprovar identidade de pacientes/sessões, equipamento ou diversidade de aquisição. |
| **PTB-XL 1.0.3** — [PhysioNet](https://physionet.org/content/ptb-xl/1.0.3/), arquivos em `https://physionet.org/files/ptb-xl/1.0.3/`; rede 50 Hz | CC BY 4.0 | 12 derivações, 500 Hz, 5.000 amostras. Os três registros incluídos têm `.hea` e `.dat`, sem anotação temporal de batimentos/ondas; os rótulos diagnósticos do banco não são referência de tempo QRS ou P/T. | Os três casos servem à visualização; não entram em escore de batimentos. Rótulos diagnósticos não os tornam validação QRS independente. |

O repositório declara que os sinais empacotados são cópias WFDB sem filtragem, reamostragem ou edição (`web/data/README.md`). A auditoria confirmou a consistência entre os dados de sinal decodificados e os checksums de 16 bits presentes nos cabeçalhos: **1.112/1.112 sinais passaram**, sem amostras inválidas indicadas pelo leitor. A soma de 16 bits não é hash criptográfico nem cadeia de custódia: não autentica a origem, não verifica os arquivos de anotação e não prova verdade clínica. A verificação externa de identidade dos arquivos e do processamento anterior não foi feita.

`web/src/io/wfdb.js` converte amostras usando ganho, baseline e unidade do cabeçalho; `web/src/io/fileSource.js` mapeia as derivações para os canais do pipeline. Isso documenta decodificação e mapeamento, não garante que o publicador não tenha aplicado processamento antes da distribuição. A proveniência de pré-processamento na fonte permanece **desconhecida** onde não declarada.

## 2. Relatórios e seleção congelada

O baseline canônico é `web/data/reports/validation.json` (`includeOptional: false`), reproduzido por `web/tests/validation-report.mjs`. A seleção é **87 LUDB + 14 MIT-BIH = 101 registros**, com 30.853 referências: 30.418 TP, 582 FP e 435 FN; sensibilidade 0,9859, VPP 0,9812. O protocolo reportado usa tolerância ±150 ms, aquecimento de 1 s e janela até a última referência mais a tolerância.

| Banco no baseline congelado | Registros | Referências QRS | TP | FP | FN | Sensibilidade | VPP |
|---|---:|---:|---:|---:|---:|---:|---:|
| LUDB | 87 | 796 | 788 | 20 | 8 | 0,9899 | 0,9752 |
| MIT-BIH | 14 | 30.057 | 29.630 | 562 | 427 | 0,9858 | 0,9814 |
| **Total** | **101** | **30.853** | **30.418** | **582** | **435** | **0,9859** | **0,9812** |

Como reconciliação local separada, `buildReport({ includeOptional: true })` encontrou 103 registros (87 LUDB + 16 MIT-BIH), 36.403 referências, 35.881 TP, 728 FP e 522 FN (sensibilidade 0,9857; VPP 0,9801). O acréscimo corresponde somente a `mitdb/105` e `mitdb/203` (5.550 referências em conjunto). Esse relatório é uma reprodução opcional da worktree, não está versionado, não altera os 101 registros canônicos e **não constitui nova validação independente**. O JSON anexa os totais opcionais e os dois resultados por registro em seção separada.

`web/data/reports/waves.json` é outro desfecho e outro protocolo: 87 registros LUDB, tolerância ±150 ms, modo `detected` (R do detector) ou `reference` (R anotado), derivação II ou 12 derivações. Cada modo/escopo cobre 47 registros tuning e 40 held-out; o resumo adicional “só ritmo sinusal” cobre 41 e 34. Essa divisão par/ímpar é o protocolo histórico de ajuste/held-out do **delineador P/T**, não um selo de independência para pesquisas QRS.

Resultados do relatório de ondas em held-out, para explicitar o denominador diferente e o efeito de usar R detectado ou anotado:

| Entrada / escopo | Registros | Onda | TP / FP / FN | Sensibilidade / VPP |
|---|---:|---|---:|---:|
| R detectado, II | 40 | P | 260 / 30 / 4 | 0,9848 / 0,8966 |
| R detectado, II | 40 | T | 326 / 1 / 18 | 0,9477 / 0,9969 |
| R detectado, 12 derivações | 40 | P | 2.556 / 335 / 606 | 0,8083 / 0,8841 |
| R detectado, 12 derivações | 40 | T | 3.811 / 28 / 313 | 0,9241 / 0,9927 |
| R anotado, II | 40 | P | 260 / 32 / 4 | 0,9848 / 0,8904 |
| R anotado, II | 40 | T | 332 / 3 / 12 | 0,9651 / 0,9910 |
| R anotado, 12 derivações | 40 | P | 2.555 / 370 / 607 | 0,8080 / 0,8735 |
| R anotado, 12 derivações | 40 | T | 3.879 / 54 / 245 | 0,9406 / 0,9863 |

Todos os 101 registros do baseline QRS foram já pontuados e usados como baseline e regressão nas investigações documentadas no [SDD 001](../specs/001-validacao-detector-e-ondas-pt.md), incluindo análise aprofundada de 228, 108 e 207. Para uma nova hipótese QRS, o conjunto inteiro deve ser tratado conservadoramente como **desenvolvimento/regressão**, ainda que o JSON do relatório rotule LUDB como `tuning` ou `held-out`. Esse rótulo herdado não desfaz a exposição posterior. Os resultados P/T históricos permanecem associados ao propósito original, separados da alegação de avaliação independente QRS.

## 3. Acesso, independência e proposta de reserva

- **Reserva atualmente declarada: nenhuma.** Não há seleção identificada, pré-congelada e ainda não acessada que sustente uma avaliação independente.
- Os 105/203 não são uma reserva: apesar de não integrarem o baseline versionado, estavam completos localmente e foram incluídos na reprodução opcional desta auditoria.
- Os três PTB-XL são registros de visualização sem referência temporal de QRS; não devem ser usados para alegar sensibilidade/VPP ou como substituto automático de uma reserva QRS.
- Para estudo futuro, manter os 101 registros canônicos e os dois MIT opcionais como desenvolvimento/regressão. Antes de qualquer acesso aos resultados, definir pergunta, versão/fonte e critérios; identificar pacientes/sessões quando permitido; separar por paciente/sessão, não por segmentos; e registrar a seleção e o protocolo. Somente selecionar registros novos após checar proveniência, licença, disponibilidade e anotação apropriada. Não enumerar agora registros externos não inspecionados como candidatos nem baixar dados nesta tarefa.
- O manifesto não contém IDs de paciente/sessão nem metadados verificáveis de dispositivo, posicionamento de eletrodos ou diversidade de aquisição. A quantidade de registros **não** prova quantidade de indivíduos independentes, representatividade, diversidade clínica ou generalização. Nenhuma dessas propriedades é inferida aqui.

## 4. Lacunas e prioridades de governança

1. **Prioridade alta — independência:** obter e validar metadados permitidos de paciente/sessão; sem eles, declarar explicitamente que separação por indivíduo não foi comprovada.
2. **Alta — pré-processamento e aquisição:** determinar o que a fonte informa sobre dispositivos, unidade/calibração, filtros prévios, conversão e cadeia de custódia. O cabeçalho local não resolve processamento anterior.
3. **Alta — reserva:** escolher unidade, fonte e critérios de inclusão antes de examinar resultados da próxima hipótese; manter registro de acesso e não reutilizar a reserva em ajuste.
4. **Média — direitos:** conferir os termos atuais do publicador e obrigações de atribuição/redistribuição antes de nova aquisição ou publicação de arquivos opcionais; nesta auditoria, a licença foi lida somente no manifesto e na documentação local.
5. **Média — referência:** manter separados diagnóstico textual, anotação temporal QRS por batimento e anotação de limites/picos P/QRS/T por derivação. Registrar ambiguidades e limites do esquema de anotações sem converter falta de anotação em ausência fisiológica.

## 5. Artefatos e reprodução

O snapshot [JSON](07-inventario-dados.json) não inclui sinal bruto, comentários arbitrários dos cabeçalhos, rótulos clínicos detalhados, caminhos absolutos ou hashes de proveniência. Contém IDs públicos de registro, contagens de arquivos, frequência, amostras, derivações e metadados de calibração por sinal no formato compacto `[descrição, unidade, ganho, baseline, resolução ADC, checksum confere]`, além de métricas por registro do relatório congelado. Disponibilidade de arquivos opcionais representa esta worktree, não uma garantia para outros clones.

Fontes locais: `web/data/manifest.json`; `web/data/reports/validation.json` e `waves.json`; `web/tests/validation-report.mjs` (`readLocalRecord`, `buildReport`); `web/tests/wave-report.mjs`; `web/src/io/wfdb.js` (`parseHeader`, `loadRecord`, `verifyChecksums`); `web/src/io/fileSource.js` (mapeamento de derivações). Reprodução do baseline: em `web/`, `npm run report`. A reprodução opcional imprime a seleção local com `npm run report -- --include-optional` e não substitui nem grava o relatório congelado.
