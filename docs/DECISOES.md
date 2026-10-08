# Registro de decisões

Decisões técnicas e científicas do projeto, em ordem cronológica, com o motivo. Uma entrada só é alterada por outra entrada que a substitua.

## 2026-10 — D1. O sinal comanda o modelo, nunca o contrário

O coração 3D reage exclusivamente a eventos detectados no ECG (QRS). Verdade-terreno do gerador sintético e anotações de bancos públicos existem **apenas para pontuar o detector** e nunca alimentam a animação. Motivo: o objetivo do projeto é o fluxo inverso ao das simulações convencionais; qualquer atalho invalidaria a demonstração.

## 2026-10 — D2. Toda transformação é explícita e comparável

Bruto, filtrado e diferença são sempre calculados e podem ser alternados na mesma tela, com os parâmetros dos filtros escritos nela; a exibição simultânea (lado a lado) fica para o painel de análise da etapa 3. Motivo: a pergunta de pesquisa é "o que a filtragem convencional descarta?" — isso exige ver o descartado.

## 2026-10 — D3. Protótipo web estático, sem build, com dependências vendorizadas

HTML + ES modules + Three.js em `web/vendor/`. Motivo: reprodutibilidade (abre em qualquer máquina com um servidor HTTP simples, offline) e barreira zero para colaboradores. O CDN falhou no primeiro teste; a cópia local eliminou a dependência de rede.

## 2026-10 — D4. Registros reais são reproduzidos na frequência nativa

Filtros, detector e traçado são reconstruídos com a `fs` do registro (360 Hz no MIT-BIH, 500 Hz no PTB-XL/LUDB); nada é reamostrado. Motivo: o roteiro exige "manter o bruto imutável"; reamostragem é uma transformação que mascararia justamente os detalhes que queremos estudar.

## 2026-10 — D5. Formato WFDB, lido por código próprio e verificado por checksum

Leitor próprio (`web/src/io/wfdb.js`) em vez de biblioteca externa. Motivo: o formato é simples e documentado, o código roda igual no navegador e no Node, e o checksum de 16 bits presente em cada cabeçalho WFDB dá verificação objetiva da decodificação (todos os registros incluídos batem).

## 2026-10 — D6. Amostras pequenas no repositório, resto por script

Seis registros (~2,6 MB) ficam versionados em `web/data/records/` com `.gitattributes -text` (byte a byte iguais ao PhysioNet); os demais são baixados por `npm run fetch-data`. Motivo: a demonstração funciona ao clonar, sem inflar o repositório; licenças ODC-BY e CC BY permitem a redistribuição com atribuição (ver `web/data/README.md`). Precedente: `wfdb-python` versiona `sample-data/`.

## 2026-10 — D7. Rótulos de bancos são exibidos como vieram, nunca reinterpretados

Diagnósticos, laudos, idade e sexo do PTB-XL/LUDB/MIT-BIH aparecem na interface marcados como "rótulos do banco (não são inferências deste software)". Motivo: limite científico do projeto — o software não diagnostica; mostrar o rótulo original dá contexto sem criar a impressão de interpretação automática.

## 2026-10 — D8. Pontuação batimento a batimento com janela de ±150 ms

Métricas de detecção seguem a convenção ANSI/AAMI EC57 (janela de 150 ms) em dados reais; no sintético usa-se ±80 ms porque o instante do R é conhecido exatamente. Detecções após o último batimento anotado não são pontuadas (o LUDB não anota o ciclo incompleto final). Motivo: comparabilidade com a literatura e com os resultados históricos do Pan–Tompkins.

## 2026-10 — D9. Detector marca a deflexão dominante do QRS

O instante do evento é o máximo em módulo do sinal passa-banda dentro da janela candidata, não o máximo positivo. Motivo: no LUDB 8 (QRS negativo em II) o máximo positivo caía no rebote, 85 ms após o R. Consequência documentada: viés de ~25 ms em relação a anotações que marcam o pico R quando este é pequeno.

## 2026-10 — D10. Assets licenciados ficam cifrados; a chave fica fora do repositório

O modelo anatômico ilustrativo usado pelo coração 3D é um asset de terceiros adquirido sob licença que permite o uso apenas como parte incorporada de um produto e proíbe a redistribuição em forma extraível, citando formato proprietário, arquivo protegido por senha e criptografia como medidas aceitáveis. Os originais e o derivado para o navegador ficam no repositório **somente cifrados** (AES-256-GCM, fatias ≤ 95 MB, nomes neutros em `web/assets/calib/`); o manifesto com a proveniência completa (produto, autor, loja, pedido, licença, hashes) vai **dentro** do cofre; a chave vive fora do git (`~/.openheart3d/`), e o repositório não cita nomes de produto, autor ou loja em claro. Sem a chave o aplicativo usa o modelo procedural, em silêncio. Motivo: o repositório público não deve virar fonte de download de modelo 3D nem aparecer em buscas por modelos, e a proteção escolhida é a que a própria licença indica — "comercialmente razoável", não inviolável (num site estático a chave viaja ao navegador quando fornecida). Um teste de guarda (`npm test`) falha se qualquer arquivo rastreado parecer um asset em claro, uma chave ou um termo de proveniência.

## 2026-10 — D11. Câmera travada no eixo central; vistas e camadas são filtros de exibição, não medidas

A câmera do coração 3D orbita um alvo fixo no centro do modelo (sem pan), com zoom limitado, vistas predefinidas (anterior, posterior, laterais, base, ápice) e giro automático opcional em torno do eixo longo. Camadas (ventrículos, átrios/topo, grandes vasos), opacidade, raio-X e plano de corte alteram apenas a exibição; nada disso mede, segmenta ou reconstrói anatomia. Quando há modelo anatômico, seus clipes de animação têm o tempo posicionado pelos envelopes do ECG (nunca autoplay); o modelo é rotulado "ilustrativo (asset licenciado)" e o aviso de sincronização temporal permanece. Motivo: preservar o princípio D1 (o sinal comanda o modelo) e o limite científico do projeto também na representação mais realista.

## 2026-10 — D12. Primeiro painel espectral usa janela móvel comum de 10 s válidos

A primeira entrega da etapa 3 calcula espectros de amplitude para bruto, filtrado e diferença na derivação de ritmo/detecção (II, se existir; senão, a primeira derivação disponível). As três séries usam os mesmos 10 s consecutivos de amostras na frequência nativa. Aplica-se uma janela Hann sem remoção de DC e uma FFT radix-2, preenchida com zeros até a próxima potência de dois; o espectro unilateral é escalado em amplitude pico na unidade do sinal (mV após a conversão existente). Fonte, derivação, `fs`, descrição dos filtros, número de amostras, tamanho da FFT e resolução em frequência ficam visíveis. Motivo: uma comparação reprodutível do que os filtros atenuam, sem reimplementar a comparação temporal já existente ou introduzir reamostragem/dependências.

Uma janela incompleta não é exibida. Lacuna ou valor inválido limpa toda a janela; não se interpola, e é necessário preencher outros 10 s consecutivos válidos. Pausa congela a captura e a visualização; troca/reinício da fonte ou reconstrução do pipeline (por exemplo, mudança da configuração de rede) limpa a captura. A unidade apresentada segue a unidade física convertida no leitor WFDB; unidades desconhecidas permanecem rotuladas pela declaração original em vez de serem chamadas mV. O espectro é uma decomposição matemática e não separa automaticamente fisiologia de ruído. Não implica interpretação clínica.

## 2026-10 — D13. STFT e indicadores de banda descrevem conteúdo, não classificam artefatos

Para concluir a etapa 3 sem alterar filtros, detector ou comparação temporal, o mesmo recorte válido de 10 s é analisado também por STFT: quadros Hann de 2 s, avanço de 1 s, FFT radix-2 com zero-padding e `fs` nativa. Os três sinais têm quadros e eixos de frequência/tempo alinhados; a cor usa uma escala comum relativa ao maior pico da janela (0 a −60 dB). Exibe-se apenas quadro completo.

O painel apresenta os picos de amplitude e frequência em duas bandas derivadas dos parâmetros conhecidos, sem alegar que o conteúdo nelas é artefato: 0 até o corte do passa-alta; e faixa nominal de meia largura `f0/(2Q)` ao redor do notch (`Q=30`), marcada como nominal/inativa se o notch não for executado por limite de Nyquist. Se toda a faixa nominal estiver acima de Nyquist, ela é indicada como fora da faixa analisada e não recebe medida. Esses indicadores não identificam fontes, não removem conteúdo e não interpretam dados clínicos. O objetivo é tornar o efeito dos filtros auditável e investigar conteúdo variável no tempo; classificação de artefatos exige hipótese, critérios e validação separados.

## 2026-10 — D14. Export espectral local com contrato versionado e metadados por allowlist

O JSON `openheart3d.ecg.spectral-analysis` v1 preserva resultados completos da última janela calculada no painel, coordenadas base zero (fim exclusivo), filtros, método e métricas; inclui STFT alinhada somente no modo tempo-frequência. Não contém amostras do sinal. O download é exclusivamente local, por Blob/ObjectURL com liberação posterior; não há servidor, upload ou nova dependência. Pausa mantém a análise; janela insuficiente/lacuna e troca/reinício limpam a disponibilidade.

Metadados são reconstruídos campo a campo, nunca por cópia do registro WFDB. Só identificadores públicos do catálogo validado e tokens reconhecidos de derivações/unidades são exportados; identificador local e aliases livres são omitidos, unidades livres viram `unknown`. Motivo: nomes locais e descrições arbitrárias podem conter caminhos ou dados pessoais mesmo quando parecem identificadores. Anotações, labels, cabeçalhos, comentários e chave do cofre não atravessam o contrato. Reprodutibilidade significa preservar resultados e convenções matemáticas, não regenerar amostras ou uma fonte sintética aleatória.

## 2026-10 — D15. Protocolo de validação do detector: amostra estratificada, divisão tuning/held-out e relatório determinístico

A validação do QRS passa a usar 39 registros LUDB (2 anteriores + 37 escolhidos por estratificação de ritmo) mais o MIT-BIH 100. O relatório (`npm run report` → `web/data/reports/validation.{json,md}`) não tem timestamps, tem ordem fixa e é regenerado por um teste de guarda que falha se divergir do commitado. Métricas: sensibilidade, VPP, erro médio ± DP, mediana e P95 do erro absoluto, por banco, ritmo, divisão e registro. Divisão do LUDB: id par = ajuste, id ímpar = held-out; qualquer parâmetro ajustado (em particular do delineador P/T, D16) só vê os pares, e o desempenho divulgado é o dos ímpares. O detector não foi alterado: falhas conhecidas (ex.: `ludb/83`, bloqueio de ramo esquerdo com extrassístoles ventriculares; fibrilação atrial com QRS negativo; flutter com FP) ficam visíveis no relatório. O agregado "Total" é dominado pelos 2272 batimentos do MIT-BIH 100; os agregados por banco/ritmo são os informativos para o LUDB (registros de 10 s, poucos ciclos). Registros MIT-BIH adicionais permanecem opcionais (`--include-optional`) e fora do relatório versionado. Não é validação clínica.

## 2026-10 — D16. Delineação de ondas P/T: estimativa visual, ajustada só no tuning

`web/src/ecg/waves.js` estima início/pico/fim de P e T na derivação de ritmo a partir do sinal já filtrado e dos R detectados: suavização, janelas relativas ao RR, linha de base linear entre bordas, limiar por piso mínimo e ruído (MAD) e bordas a 10 % da amplitude. Amostras inválidas anulam a onda (sem imputação). Em fluxo, `WaveTracker` reproduz o mesmo cálculo com atraso (a T de um batimento só aparece após o seguinte). As marcas aparecem apenas na tira de ritmo, desligadas por padrão e rotuladas "estimadas por algoritmo"; **não** alimentam a animação 3D, o envelope nem qualquer inferência clínica (D1). Parâmetros foram ajustados somente nos registros LUDB pares; o desempenho divulgado é o dos ímpares (`npm run report:waves` → `web/data/reports/waves.{json,md}`, com guarda de reprodutibilidade e piso de regressão em `waves.test.mjs`). Pontuação: tolerância ±150 ms no pico, só ondas anotadas completas, janela do trecho anotado. Em fibrilação/flutter não há P anotada, então P detectadas contam como falso-positivo (limitação, por isso o relatório separa o ritmo sinusal). Resultado held-out, derivação II, ritmo sinusal: P sens 1,000 / VPP 0,930, pico 0,3 ± 5,6 ms; T sens 0,977 / VPP 1,000, pico 5,4 ± 26,1 ms. Limites: T em baixa amplitude/achatada e T de morfologia incomum falham (ex.: `ludb/83`); bordas de T têm DP ~40–50 ms, coerente com a ambiguidade da anotação. Não é validação clínica.
## 2026-10 — D17. Licença do código da edição comunitária: AGPL-3.0, com licença comercial alternativa

A edição comunitária (CE) é publicada sob GNU AGPL-3.0-only (`LICENSE`). Motivos: o protótipo é web e a AGPL cobre o uso como serviço de rede; terceiros podem usar e modificar a CE, mas quem a oferecer como serviço deve abrir o código; e o titular único pode oferecer licença comercial alternativa e recursos pagos em edições futuras. Condições e limites: (1) o direito de relicenciar depende de o titular deter todos os direitos, então contribuições externas exigem CLA antes de serem aceitas (pendente); (2) a licença do código não se estende a dados (registros PhysioNet mantêm suas licenças no `manifest.json`) nem ao modelo anatômico cifrado, de licença própria e não redistribuível; (3) a licença não trata de regulação: uma edição paga com finalidade médica pode ser enquadrada como software como dispositivo médico (ANVISA) e isso deve ser avaliado separadamente; (4) a licença publicada para versões já distribuídas não é revogável. Esta decisão deve ser revisada por advogado de propriedade intelectual antes de divulgação ampla.