# Protótipo web — ECG 12 derivações + coração 3D sincronizado

Protótipo estático (HTML + ES modules, sem build) das etapas 2 e 3. Reproduz ECG **sintético** ou **registros reais de bancos públicos (PhysioNet, formato WFDB)**; em ambos os casos é o sinal que comanda a animação do coração. Não é dispositivo médico e não realiza diagnóstico.

## Executar

Precisa de um servidor HTTP simples (módulos ES não carregam via `file://`). Three.js (r160) está incluído em `vendor/` — funciona offline.

```powershell
cd web
npm start            # python -m http.server 8000
```

Abra `http://localhost:8000` (se a porta 8000 estiver ocupada: `python -m http.server 8765 --bind 127.0.0.1` e `http://127.0.0.1:8765`).

## Coração 3D

O painel da direita mostra um coração 3D comandado pelos eventos detectados: a sístole ventricular começa no R detectado e a contração atrial é **estimada pelo RR** (e assim rotulada). Em qualquer modelo, a animação indica **sincronização temporal**, não anatomia, contratilidade ou força reais.

- **Vistas** (botões no topo do painel): anterior, posterior, lateral esquerda, lateral direita, superior (base) e inferior (ápice), com transição suave; "giro" liga a rotação automática em torno do eixo central. A câmera orbita um alvo fixo no centro do coração (sem pan) e o zoom é limitado.
- **Camadas e corte** (painel recolhível): visibilidade e opacidade por parte — ventrículos, átrios/topo, aorta e grandes vasos —, modo **raio-X** (transparente + malha) e **plano de corte** em um eixo (≈ sagital, transversal ou coronal) com posição ajustável. São filtros de exibição, não medidas (D11).
- **Modelo padrão: procedural didático** (esferas e tubos). É o que qualquer pessoa vê ao clonar o repositório.
- **Modelo anatômico ilustrativo (opcional, asset licenciado)**: um modelo de terceiros, com licença que não permite redistribuição, está no repositório **apenas cifrado** (`assets/calib/`, ver [`assets/calib/LEIA-ME.md`](assets/calib/LEIA-ME.md) e D10). Com a chave, o aplicativo decifra o derivado em memória (WebCrypto, AES-256-GCM, hash conferido) e troca o modelo; seus dois clipes de animação (ventrículos e topo) têm o tempo **posicionado pelos envelopes do ECG** — nunca tocam sozinhos. Sem chave, nada muda e nada aparece no console. Como fornecer a chave:
  - em host local (`localhost` / `127.0.0.1`): arquivo `assets/calib/local.key` (ignorado pelo git; `npm run build-rt` o grava), descoberto pela listagem de diretório do servidor estático — sem requisição 404 quando ele não existe;
  - em qualquer host: abrir a página com `#k=<chave em base64url>` uma vez (o fragmento é removido da barra; em host local a chave fica no `localStorage` do navegador).

  A proteção é a que a licença pede ("comercialmente razoável"), não inviolável: num site estático a chave viaja ao navegador quando é fornecida. Nenhum nome de produto, autor ou loja aparece em claro no repositório; a proveniência completa está no manifesto dentro do cofre.

### Cofre de assets (uso do autor do projeto)

```powershell
cd web
npm run pack-vault        # zip original → extração temporária → manifesto → fatias cifradas em assets/calib/
npm run unpack-vault      # verifica e decifra para ../.local/calib/ (ignorado pelo git); --list só mostra o índice
npm run build-rt          # originais → glTF (texturas WebP 2048², clipes por armadura) → GLB cifrado em assets/calib/
```

A chave (32 bytes) é criada na primeira execução de `pack-vault`, gravada em `~/.openheart3d/vault.key` (fora de qualquer worktree) e impressa uma única vez; também é aceita pela variável `OH3D_VAULT_KEY`. A proveniência é lida de `~/.openheart3d/provenance.json` e vai para o manifesto cifrado. Formato: bloco = IV(12) ‖ cifrado ‖ TAG(16), AAD amarrando conjunto e posição; índice cifrado com SHA-256 das fatias e do todo; fatias ≤ 95 MB (limite do GitHub). O código das ferramentas está em `tools/vault/`.

`pack-vault -- --slice-bytes=<n>` aceita somente inteiros entre 30 e 95.000.000 bytes, validados antes de criar a chave. A extração ZIP limita cada entrada a 512 MiB e limita a saída da descompressão ao tamanho declarado no diretório central.

## Fontes de dados

**Sintética (vetor cardíaco)** — controles de FC, variabilidade RR, ruído e rede. Faixa vermelha no topo: DADOS SINTÉTICOS.

**Registro real (WFDB / PhysioNet)** — escolha um registro do menu ou abra arquivos `.hea` + `.dat` (+ anotações) do disco. Faixa amarela: DADOS REAIS, com banco, registro e licença. O painel "Sobre o registro" mostra frequência de amostragem, derivações mapeadas, **rótulos fornecidos pelo banco** (nunca inferências deste software), comentários do cabeçalho, anotações disponíveis, verificação de checksum e citação.

Seis registros vêm no repositório (PTB-XL normal / fibrilação atrial / bloqueio de ramo esquerdo; LUDB sinusal / FA com anotações P-QRS-T; MIT-BIH 100). Outros são baixados com `npm run fetch-data`. Proveniência, licenças e critérios de escolha: [`data/README.md`](data/README.md).

Quando o registro tem anotações de batimento, a tira de ritmo mostra as marcas **amarelas (QRS detectado)** acima e as **azuis (referência anotada)** abaixo, e o painel conta TP / FP / FN ao vivo (janela ±150 ms, ANSI/AAMI EC57). Uma referência só vira FN depois do pior atraso possível do detector (no search-back, 1,66 × RR), para que o escore ao vivo concorde com o offline. Ao chegar ao fim do registro a contagem é fechada (pendências viram FN/FP), o resultado da passagem completa fica exibido e a reprodução recomeça do zero. O detector nunca vê as anotações; elas servem só para pontuá-lo.

## Análise espectral (etapa 3)

O painel sob o traçado mostra simultaneamente os espectros de **bruto**, **filtrado** e **diferença (bruto − filtrado)** para a derivação da tira de ritmo/detecção: II quando disponível, senão a primeira derivação disponível. A janela é móvel, tem 10 s completos e consecutivos; os três sinais usam exatamente os mesmos índices e `fs` nativa da fonte. O processamento existente e o seletor bruto/filtrado/diferença do traçado não são alterados.

Parâmetros apresentados no painel: derivação/alias, fonte/registro, unidade declarada, frequência de amostragem, configuração dos filtros, janela Hann, ausência de remoção de DC, número de amostras, tamanho da FFT e resolução em Hz. A FFT radix-2 é preenchida com zeros até a próxima potência de dois; a escala de amplitude unilateral usa a unidade física decodificada (mV para tensão com unidade conhecida). Se o WFDB declarar unidade desconhecida, ela é exibida como declarada e os valores não são rotulados falsamente como mV. Cada faixa do gráfico usa escala vertical própria e o maior valor da faixa aparece como referência. A transformada é atualizada durante a reprodução e fica congelada em pausa.

O botão **Tempo-frequência** mostra três espectrogramas alinhados calculados por STFT sobre a mesma janela. Cada quadro usa Hann de 2 s, avanço de 1 s, zero-padding radix-2 e a fs nativa; a escala de cor é comum às três séries, relativa ao maior pico da janela, de 0 a −60 dB. A resolução e os parâmetros do quadro/avanço aparecem no painel. As bordas mostram apenas quadros completos (9 quadros para a janela de 10 s).

As medidas compactas de conteúdo em frequência exibem os picos (frequência e amplitude) em duas bandas ligadas aos filtros configurados: 0 até o corte do passa-alta e a largura nominal f0/Q ao redor da frequência central do notch (Q=30). Se o notch estiver desativado por fs baixa, a banda aparece como nominal/inativa; se toda a banda nominal estiver acima de Nyquist, ela é indicada como fora da faixa analisada e não recebe medida. São descritores do conteúdo e sua mudança pelo filtro, não detectores de artefato nem evidência de origem fisiológica.

Ao iniciar ou trocar/reiniciar uma fonte, a janela anterior é descartada e o painel aguarda 10 s novos. No fim de um arquivo, a última janela completa é analisada antes da reprodução recomeçar; a reinicialização limpa então a captura. Uma lacuna ou valor inválido limpa a janela inteira: não há interpolação nem espectro até haver 10 s consecutivos válidos. Sinais de menos de 10 s permanecem sem resultado. Trata-se de descrição matemática, sem diagnóstico, interpretação clínica ou classificação automática de artefatos.

### Exportação local de resultados (JSON v1)

**Exportar JSON** baixa a última análise calculada e apresentada no painel (atualização a cada 250 ms), sem enviar nada à rede. Só fica habilitado após uma janela válida completa; o motivo da indisponibilidade aparece junto ao botão. A pausa mantém os resultados exportáveis. Troca/reinício da fonte, mudança do notch e lacunas descartam o export anterior. Selecionar **Tempo-frequência** inclui a STFT da mesma janela; em **Frequência**, o campo `stft` não é incluído.

O arquivo usa `schema: "openheart3d.ecg.spectral-analysis"` e `version: 1`. Campos:

- `exportedAt`: instante ISO/UTC da solicitação do download; `origin`: `synthetic` ou `real`; `recordId`: identificador público `banco:registro` validado do catálogo, ou `null` para fontes sintéticas/arquivos locais.
- `lead`: nome padrão e alias reconhecido (MLII, ML2, MLI, MLIII, AVR/AVL/AVF ou C1–C6); nomes livres ficam `null`. `fs` é nativa e `unit` é a unidade de amplitude convertida (`mV` quando conhecida); declarações fora da lista segura mV/uV/µV/μV/V/adu ficam `unknown`.
- `window`: contagem, duração `N/fs`, índices inteiros base zero (`startIndex` inclusivo, `endIndexExclusive` exclusivo) na fonte, tempos em segundos desde o início da fonte e tempo da última amostra. Não contém amostras do sinal.
- `filters`: tipo/corte do passa-alta e tipo/frequência/Q/estado ativo do notch. `spectralMethod`: Hann, sem remoção de DC, FFT radix-2, preenchimento até a próxima potência de dois, amplitude pico unilateral, normalização pela soma dos pesos Hann (dobro exceto DC/Nyquist), tamanho FFT e resolução `fs/FFT`.
- `spectra`: eixo completo `frequencyHz` e arrays numéricos `amplitude.raw`, `.filtered`, `.difference`. A diferença é o espectro de **bruto − filtrado**, não a subtração das amplitudes. `bandMetrics`: limites e picos nas bandas passa-alta/notch, incluindo estado nominal/inativo.
- `stft` (opcional): método, número de quadros, quadro/avanço em amostras e segundos, política de quadros completos, eixo de frequência, centros temporais relativos à janela e absolutos à fonte, matrizes de amplitude **quadro × frequência** para as três séries. Exporta amplitude física, não as cores/dB do gráfico.

A serialização constrói uma lista explícita de campos e converte typed arrays em arrays JSON, sem copiar objetos de fonte/cabeçalho. Nunca inclui caminhos/nomes de arquivos locais, anotações, rótulos, comentários WFDB, dados pessoais ou chave do cofre. O arquivo recebe nome seguro; o download usa `Blob`/`ObjectURL` local e libera a URL após disparar o clique. A mensagem confirma apenas que o download foi solicitado, não que o navegador salvou o arquivo.

O contrato preserva resultados e parâmetros de análise para comparação reprodutível; **não permite reconstruir o sinal original ou repetir a captura sintética aleatória**, pois as amostras não são exportadas. Mesma análise e mesma data produzem o mesmo JSON. Não há importação, upload, backend ou dependência nova (D14).

## Testar

```powershell
cd web
npm test             # testes unitários + benchmark sintético + benchmark em dados reais
npm run bench        # só o sintético
npm run bench:real   # só os registros reais anotados presentes em data/records/
```

### Testes unitários (`tests/*.test.mjs`)

- `source-controls.test.mjs` — falhas de carregamento restauram os seletores para a fonte ativa, preservam o erro visível e não sobrescrevem uma seleção mais recente.
- `asset-discovery.test.mjs` — chave por fragmento, armazenamento e arquivo local; remoção do fragmento, persistência só em host local, carregamento cifrado e fallback em falhas.
- `model-disposal.test.mjs` — substituição e remoção do modelo liberam geometrias, materiais e texturas compartilhados uma vez, encerram o mixer e preservam o procedural.

- `wfdb.test.mjs` — cada cabeçalho WFDB traz um checksum de 16 bits por sinal e o valor da primeira amostra; os testes decodificam os registros reais e exigem que ambos batam (formatos 16 e 212), conferem os 2273 batimentos conhecidos do MIT-BIH 100, a decodificação de anotações com SKIP (ordem de palavras PDP-11 da biblioteca WFDB)/AUX/NUM/CHN, skew, sentinelas de amostra inválida, conversão de unidades (µV/mV/V → mV) e o mapeamento de derivações (MLII, C1–C6, registros genéricos).
- `scoring.test.mjs` — escore ao vivo vs. offline, inclusive com detecção atrasada por search-back e fechamento no fim do registro.
- `filters.test.mjs` — notch atenua a rede e preserva o ECG; é desativado (e a descrição avisa) quando fs ≤ 2 × f0, em vez de divergir.
- `gaps.test.mjs` — lacunas de amostras inválidas: filtros e detector não avançam, são re-armados na retomada sem transiente, o RR através da lacuna não entra na média; inclui a comparação com o comportamento antigo (sample-and-hold), que gerava falso positivo na retomada.
- `spectrum.test.mjs` — escala unilateral com tom conhecido, janela comum e descarte após lacuna, efeito em bandas dos filtros, STFT localizando tons em instantes diferentes, e espectros/métricas/quadros finitos em registros reais MIT-BIH 360 Hz e PTB-XL/LUDB 500 Hz na fs nativa.
- `spectrum-export.test.mjs` — contrato JSON v1, arrays numéricos completos, parâmetros e coordenadas reproduzíveis, STFT alinhada, allowlist sem amostras/campos incidentais; integração do `main.js` com download mock sem rede, janela incompleta/lacuna, pausa, troca de modo/fonte, reinício e liberação de ObjectURL, inclusive em falha.
- `spectrum-plot.test.mjs` — dimensionamento pelo canvas, ausência de atualizações redundantes em regiões acessíveis e cache da renderização STFT.
- `envelopes.test.mjs` — envelopes de contração e a tradução envelope → tempo de clipe (`clipTime`): pose relaxada fora da janela, contraído em `peak` na sustentação, descida pela trajetória do autor até `duration`.
- `vault.test.mjs` — cofre: ida e volta em dados sintéticos com fatias pequenas forçadas, chave errada recusada, fatia corrompida/truncada apontada pelo nome, decodificador do navegador (WebCrypto) abrindo o conjunto gerado pelo Node, leitor zip mínimo com zip aninhado; e a **guarda contra vazamento**, que percorre todos os arquivos rastreados pelo git e falha se algum começar com assinatura de cena binária/arquivo de modelagem/TIFF/EXR/glTF, tiver extensão de modelo 3D, for uma chave, estiver em `assets/calib/` sem ser bloco cifrado de alta entropia, for imagem fora de `docs/`/`web/vendor/` ou citar um termo de proveniência (comparado por hash).

### Detector em sinal sintético (`tests/detector-bench.mjs`)

60 s por cenário, semente fixa, pontuado contra os instantes reais do R (±80 ms; o gerador conhece o R exato). Falha abaixo de 0,98.

| Cenário | bpm | Ruído / rede (mV) | Sens. | VPP | Erro médio | Latência |
|---|---|---|---|---|---|---|
| repouso limpo | 72 | 0,02 / 0 | 1,00 | 1,00 | 1,3 ms | ~126 ms |
| repouso c/ rede | 75 | 0,05 / 0,10 | 1,00 | 1,00 | 1,4 ms | ~126 ms |
| bradicardia ruidosa | 40 | 0,10 / 0,20 | 1,00 | 1,00 | 1,3 ms | ~125 ms |
| exercício | 100 | 0,20 / 0,30 | 1,00 | 1,00 | 1,5 ms | ~126 ms |
| taquicardia | 150 | 0,03 / 0,05 | 1,00 | 1,00 | 1,0 ms | ~125 ms |
| taquicardia extrema | 180 | 0,02 / 0 | 1,00 | 1,00 | 0,7 ms | ~125 ms |

### Detector em registros reais anotados (`tests/detector-real.mjs`)

Derivação II (MLII no MIT-BIH), frequência nativa do registro, notch na rede do país de origem, pontuação após 1 s de aquecimento (±150 ms); usa o mesmo `SignalPipeline` da interface, inclusive o tratamento de lacunas. Falha se o agregado ficar abaixo de 0,95.

| Registro | fs | Batimentos | Sens. | VPP | Erro médio |
|---|---|---|---|---|---|
| MIT-BIH 100 | 360 Hz | 2272 | 1,000 | 1,000 | 2 ms |
| MIT-BIH 105 (ruído intenso) | 360 Hz | 2571 | 0,998 | 0,974 | 5 ms |
| MIT-BIH 203 (arritmias múltiplas) | 360 Hz | 2979 | 0,972 | 0,974 | 25 ms |
| LUDB 56 (sinusal) | 500 Hz | 10 | 1,000 | 1,000 | 1 ms |
| LUDB 8 (FA, QRS negativo em II) | 500 Hz | 10 | 1,000 | 1,000 | 25 ms |
| **agregado** | | **7842** | **0,989** | **0,982** | |

Para comparação, o Pan–Tompkins original (1985) reporta no 105 cerca de 67 FP / 22 FN e no 203 cerca de 30 FP / 53 FN; aqui: 69 FP / 5 FN e 77 FP / 82 FN. O erro de 25 ms no LUDB 8 e no 203 é sistemático: o detector marca a deflexão dominante do QRS (máximo em módulo), enquanto a anotação marca o pico R, que nesses casos é pequeno.

A latência (~125 ms entre o R e a detecção) vem dos filtros causais e da janela de confirmação; é inerente a um detector em tempo real. O instante reportado (marca no traçado, painel, escore) é compensado; a animação do coração começa suavemente no momento da detecção, sem pular esse atraso.

## Como funciona (fluxo inverso: o sinal comanda o modelo)

```text
SyntheticSource ─┐
                 ├─► LeadFilterBank ──► QrsDetector ──► Heart3D.onQrs()
FileSource ──────┘    (PA 0,5 Hz +        (Pan–Tompkins       (sístole ventricular no R;
 (WFDB: .hea/.dat,     notch 50|60 Hz)     simplificado +      contração atrial ESTIMADA
  fs nativa, 12 ou                         search-back,        a partir do RR médio)
  menos derivações)                        derivação II)
        │                    ├──────────────► EcgPlot (bruto | filtrado | diferença)
        └─ bruto + filtrado ──► SpectrumWindow (10 s, mesma fs e derivação)
                                  └──────────► espectros: bruto | filtrado | diferença
        └── anotações (.atr / .ii) ──► OnlineScorer ──► TP / FP / FN ao vivo
```

- `src/ecg/leads.js` — nomes, layout 4×3 e vetores aproximados das 12 derivações; `projectDipole()` mantém as derivações sintéticas fisicamente relacionadas.
- `src/ecg/synth.js` — vetor cardíaco como soma de gaussianas (P, Q, R, S, T) posicionadas no tempo em relação ao R: QRS de duração fixa, QT por Bazett, PR quase constante; variabilidade RR, linha de base respiratória, ruído e rede; semente opcional para reprodutibilidade.
- `src/ecg/filters.js` — passa-alta 1ª ordem e notch biquad (50 ou 60 Hz), por derivação, com descrição textual exibida na tela; o notch é desativado automaticamente (e a descrição diz isso) quando a frequência de amostragem do registro é ≤ 2 × f0.
- `src/ecg/pipeline.js` — `SignalPipeline`: um passo de processamento (banco de filtros + detector + tratamento de lacunas), compartilhado pela interface, pelo benchmark em dados reais e pelos testes, para que o que é medido seja exatamente o que é exibido.
- `src/ecg/spectrum.js` — janela móvel comum de 10 s válidos e FFT radix-2 sem dependências; Hann, zero-padding, espectro unilateral de amplitude e diferença calculada a partir do mesmo par bruto/filtrado.
- `src/ecg/detector.js` — detector de QRS em tempo real: passa-banda por médias móveis → derivada de 10 ms → quadrado → integração 100 ms → limiar adaptativo com janela candidata; search-back após 1,66 × RR; instante do R no máximo em módulo do passa-banda. Expõe RR médio, FC e a latência máxima de emissão.
- `src/ecg/scoring.js` — pareamento batimento a batimento (offline e incremental), janela ±150 ms, sempre cronológico (pendência mais antiga compatível); ao vivo, a espera por uma detecção segue a latência máxima do detector e `flush(Infinity)` fecha a contagem no fim do registro.
- `src/io/wfdb.js` — leitor WFDB: cabeçalho, sinais (formatos 16, 24, 32, 61, 80, 160, 212), anotações MIT, checksum. Aplica o skew por sinal do cabeçalho (o checksum é conferido sobre as amostras como armazenadas, antes do skew, como faz a biblioteca WFDB), converte as unidades declaradas (µV, mV, V) para mV — unidades desconhecidas ficam sem conversão e são sinalizadas no painel — e transforma as sentinelas WFDB de amostra inválida em NaN; na reprodução elas são contadas e sinalizadas por uma máscara por derivação: filtros e detector não avançam nessas amostras (nada é inventado), são re-armados na primeira amostra válida seguinte e o traçado mostra um vão. Sem DOM: o mesmo código roda no navegador e nos testes.
- `src/io/fileSource.js` — reprodução do registro na frequência nativa; mapeia MLII → II, C1–C6 → V1–V6, nomes em minúsculas e registros genéricos de 1–2 canais; escolhe a derivação de detecção (II, senão a primeira disponível); entrega a máscara de amostras inválidas por derivação.
- `src/view/ecgPlot.js` — papel 25 mm/s · 10 mm/mV, varredura, células "sem sinal" para derivações ausentes, tira de ritmo com marcas de QRS detectado e de referência. Guarda bruto e filtrado de cada amostra e escolhe o modo (bruto | filtrado | diferença) na hora de desenhar, então trocar de modo redesenha o histórico inteiro de imediato, mesmo em pausa.
- `src/view/spectrumPlot.js` — desenha os três espectros e explicita fonte, derivação, `fs`, filtros, janela e resolução; deixa o painel sem curva durante janela insuficiente ou após lacuna.
- `src/io/spectrumExport.js` — contrato de export JSON v1: allowlist de metadados, validação de alinhamento, arrays completos e nome seguro. `src/view/spectrumExportControl.js` — disponibilidade acessível e download local com liberação da URL.
- `src/view/envelopes.js` — envelopes de contração (ventricular no R detectado; atrial estimada pelo RR) e `clipTime()`, que traduz o envelope em instante de um clipe de animação. Sem DOM: testado no Node.
- `src/view/heart3d.js` — coração 3D (Three.js): modelo procedural padrão e, opcionalmente, modelo anatômico carregado por `setModel(gltf)` (nós mapeados em camadas; clipes com tempo posicionado pelo ECG via `AnimationMixer`, nunca autoplay; centralização, alinhamento do eixo longo e normalização de tamanho). Câmera com alvo fixo, vistas predefinidas, giro automático, camadas/opacidade, raio-X e plano de corte.
- `src/view/assetVault.js` — acesso ao asset cifrado: descobre a chave (`#k=`, `localStorage`, `local.key` em host local), decifra índice e fatias com WebCrypto (AES-256-GCM), confere SHA-256 e devolve o GLB só em memória; sem chave ou com falha, devolve `null` em silêncio (aviso discreto no console apenas em host local).
- `src/main.js` — liga tudo; reconstrói o `SignalPipeline` e o traçado na frequência da fonte a cada troca (nada é reamostrado); ao fim de um registro, fecha o escore e recomeça do zero; liga os controles de vistas/camadas/corte e carrega o modelo anatômico opcional (importando o `GLTFLoader` só quando há chave).
- `scripts/fetch-records.mjs` — baixa registros do PhysioNet listados em `data/manifest.json` (ou adiciona novos pela linha de comando).
- `tools/vault/` — `lib.mjs` (formato do cofre: chave, AES-GCM, fatias, índice, contêiner próprio + gzip, leitor zip mínimo), `pack.mjs`, `unpack.mjs` e `build-rt.mjs` (conversão da cena de origem com `fbx2gltf`, texturas → WebP com `sharp`, um clipe por armadura recortado a um ciclo, dicas de camadas/clipes nos `extras` da cena, otimização com `@gltf-transform`, cifra do GLB; fallback OBJ + MTL estático). Dependências só de desenvolvimento (`npm install`).
- `vendor/three/` — Three.js r160 (`three.module.js`, `OrbitControls`, `GLTFLoader` + `BufferGeometryUtils`).

## Limites deste protótipo

- O coração 3D é uma ilustração; a animação indica **sincronização temporal**, não anatomia, contratilidade ou força. Isso vale também para o modelo anatômico opcional: ele é "ilustrativo", seus clipes só têm o tempo posicionado pelo ECG, e vistas, camadas, raio-X e corte são filtros de exibição, não medidas.
- O modelo anatômico é um asset licenciado distribuído cifrado: sem a chave, só o procedural existe; com a chave num site estático, o conteúdo decifrado fica na memória do navegador de quem a recebeu (proteção "comercialmente razoável", não inviolável). O cofre adiciona ~170 MB ao clone.
- A contração atrial é prevista pelo RR médio (não há detecção de onda P ainda) e é rotulada como "estimada". Em fibrilação atrial (PTB-XL 08215, LUDB 8) essa estimativa não tem sentido fisiológico — o registro está incluído justamente para expor esse limite.
- Registros de 2 derivações (MIT-BIH) mostram só as derivações existentes; nada é inventado para as outras células.
- O detector marca a deflexão dominante do QRS, não necessariamente o pico R (erro sistemático de ~25 ms em QRS predominantemente negativos).
- O gerador conhece os instantes reais do R (`source.beats`) e os registros trazem anotações; ambos existem apenas para avaliar o detector, nunca para animar o modelo.
- Formatos WFDB multi-segmento e multi-frequência, EDF e CSV ainda não são lidos; nos formatos suportados, o skew é aplicado e amostras inválidas (sentinelas WFDB) viram vãos: contadas, fora do processamento, com filtros e detector re-armados na retomada.

## Próximos passos sugeridos

1. Detecção de ondas P e T (o LUDB fornece a referência anotada) para substituir a estimativa atrial pelo RR.
2. A etapa 3 está concluída no escopo documentado; qualquer método de artefato que classifique ou interprete sinais deve ser proposto e validado separadamente.
3. Rodar o benchmark nos 48 registros do MIT-BIH (`npm run fetch-data -- mitdb/<n>`) e publicar a tabela completa.
4. Leitores EDF e CSV para dispositivos próprios.
