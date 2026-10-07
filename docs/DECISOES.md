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

Uma janela incompleta não é exibida. Lacuna ou valor inválido limpa toda a janela; não se interpola, e é necessário preencher outros 10 s consecutivos válidos. Pausa congela a captura e a visualização; troca/reinício da fonte ou reconstrução do pipeline (por exemplo, mudança da configuração de rede) limpa a captura. O espectro é uma decomposição matemática e não separa automaticamente fisiologia de ruído. Não implica interpretação clínica; tempo-frequência e avaliação ampla de artefatos ficam fora desta entrega.
