# Registro de decisões

Decisões técnicas e científicas do projeto, em ordem cronológica, com o motivo. Uma entrada só é alterada por outra entrada que a substitua.

## 2026-10 — D1. O sinal comanda o modelo, nunca o contrário

O coração 3D reage exclusivamente a eventos detectados no ECG (QRS). Verdade-terreno do gerador sintético e anotações de bancos públicos existem **apenas para pontuar o detector** e nunca alimentam a animação. Motivo: o objetivo do projeto é o fluxo inverso ao das simulações convencionais; qualquer atalho invalidaria a demonstração.

## 2026-10 — D2. Toda transformação é explícita e comparável

Bruto, filtrado e diferença ficam disponíveis lado a lado, com os parâmetros dos filtros escritos na tela. Motivo: a pergunta de pesquisa é "o que a filtragem convencional descarta?" — isso exige ver o descartado.

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
