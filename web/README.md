# Protótipo web — ECG 12 derivações + coração 3D sincronizado

Protótipo estático (HTML + ES modules, sem build) da etapa 2 do roteiro. Reproduz ECG **sintético** ou **registros reais de bancos públicos (PhysioNet, formato WFDB)**; em ambos os casos é o sinal que comanda a animação do coração. Não é dispositivo médico e não realiza diagnóstico.

## Executar

Precisa de um servidor HTTP simples (módulos ES não carregam via `file://`). Three.js (r160) está incluído em `vendor/` — funciona offline.

```powershell
cd web
npm start            # python -m http.server 8000
```

Abra `http://localhost:8000` (se a porta 8000 estiver ocupada: `python -m http.server 8765` e `http://127.0.0.1:8765`).

## Fontes de dados

**Sintética (vetor cardíaco)** — controles de FC, variabilidade RR, ruído e rede. Faixa vermelha no topo: DADOS SINTÉTICOS.

**Registro real (WFDB / PhysioNet)** — escolha um registro do menu ou abra arquivos `.hea` + `.dat` (+ anotações) do disco. Faixa amarela: DADOS REAIS, com banco, registro e licença. O painel "Sobre o registro" mostra frequência de amostragem, derivações mapeadas, **rótulos fornecidos pelo banco** (nunca inferências deste software), comentários do cabeçalho, anotações disponíveis, verificação de checksum e citação.

Seis registros vêm no repositório (PTB-XL normal / fibrilação atrial / bloqueio de ramo esquerdo; LUDB sinusal / FA com anotações P-QRS-T; MIT-BIH 100). Outros são baixados com `npm run fetch-data`. Proveniência, licenças e critérios de escolha: [`data/README.md`](data/README.md).

Quando o registro tem anotações de batimento, a tira de ritmo mostra as marcas **amarelas (QRS detectado)** acima e as **azuis (referência anotada)** abaixo, e o painel conta TP / FP / FN ao vivo (janela ±150 ms, ANSI/AAMI EC57). Uma referência só vira FN depois do pior atraso possível do detector (no search-back, 1,66 × RR), para que o escore ao vivo concorde com o offline. Ao chegar ao fim do registro a contagem é fechada (pendências viram FN/FP), o resultado da passagem completa fica exibido e a reprodução recomeça do zero. O detector nunca vê as anotações; elas servem só para pontuá-lo.

## Testar

```powershell
cd web
npm test             # testes unitários + benchmark sintético + benchmark em dados reais
npm run bench        # só o sintético
npm run bench:real   # só os registros reais anotados presentes em data/records/
```

### Testes unitários (`tests/*.test.mjs`, 33 testes)

- `wfdb.test.mjs` — cada cabeçalho WFDB traz um checksum de 16 bits por sinal e o valor da primeira amostra; os testes decodificam os registros reais e exigem que ambos batam (formatos 16 e 212), conferem os 2273 batimentos conhecidos do MIT-BIH 100, a decodificação de anotações com SKIP (ordem de palavras PDP-11 da biblioteca WFDB)/AUX/NUM/CHN, skew, sentinelas de amostra inválida, conversão de unidades (µV/mV/V → mV) e o mapeamento de derivações (MLII, C1–C6, registros genéricos).
- `scoring.test.mjs` — escore ao vivo vs. offline, inclusive com detecção atrasada por search-back e fechamento no fim do registro.
- `filters.test.mjs` — notch atenua a rede e preserva o ECG; é desativado (e a descrição avisa) quando fs ≤ 2 × f0, em vez de divergir.

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

Derivação II (MLII no MIT-BIH), frequência nativa do registro, notch na rede do país de origem, pontuação após 1 s de aquecimento (±150 ms). Falha se o agregado ficar abaixo de 0,95.

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
        │                    └──────────────► EcgPlot (bruto | filtrado | diferença)
        └── anotações (.atr / .ii) ──► OnlineScorer ──► TP / FP / FN ao vivo
```

- `src/ecg/leads.js` — nomes, layout 4×3 e vetores aproximados das 12 derivações; `projectDipole()` mantém as derivações sintéticas fisicamente relacionadas.
- `src/ecg/synth.js` — vetor cardíaco como soma de gaussianas (P, Q, R, S, T) posicionadas no tempo em relação ao R: QRS de duração fixa, QT por Bazett, PR quase constante; variabilidade RR, linha de base respiratória, ruído e rede; semente opcional para reprodutibilidade.
- `src/ecg/filters.js` — passa-alta 1ª ordem e notch biquad (50 ou 60 Hz), por derivação, com descrição textual exibida na tela; o notch é desativado automaticamente (e a descrição diz isso) quando a frequência de amostragem do registro é ≤ 2 × f0.
- `src/ecg/detector.js` — detector de QRS em tempo real: passa-banda por médias móveis → derivada de 10 ms → quadrado → integração 100 ms → limiar adaptativo com janela candidata; search-back após 1,66 × RR; instante do R no máximo em módulo do passa-banda. Expõe RR médio, FC e a latência máxima de emissão.
- `src/ecg/scoring.js` — pareamento batimento a batimento (offline e incremental), janela ±150 ms, sempre cronológico (pendência mais antiga compatível); ao vivo, a espera por uma detecção segue a latência máxima do detector e `flush(Infinity)` fecha a contagem no fim do registro.
- `src/io/wfdb.js` — leitor WFDB: cabeçalho, sinais (formatos 16, 24, 32, 61, 80, 160, 212), anotações MIT, checksum. Aplica o skew por sinal do cabeçalho (o checksum é conferido sobre as amostras como armazenadas, antes do skew, como faz a biblioteca WFDB), converte as unidades declaradas (µV, mV, V) para mV — unidades desconhecidas ficam sem conversão e são sinalizadas no painel — e transforma as sentinelas WFDB de amostra inválida em NaN; na reprodução elas são contadas e preenchidas por retenção da última amostra válida (sample-and-hold), sem entrar nos filtros nem no detector. Sem DOM: o mesmo código roda no navegador e nos testes.
- `src/io/fileSource.js` — reprodução do registro na frequência nativa; mapeia MLII → II, C1–C6 → V1–V6, nomes em minúsculas e registros genéricos de 1–2 canais; escolhe a derivação de detecção (II, senão a primeira disponível).
- `src/view/ecgPlot.js` — papel 25 mm/s · 10 mm/mV, varredura, células "sem sinal" para derivações ausentes, tira de ritmo com marcas de QRS detectado e de referência. Guarda bruto e filtrado de cada amostra e escolhe o modo (bruto | filtrado | diferença) na hora de desenhar, então trocar de modo redesenha o histórico inteiro de imediato, mesmo em pausa.
- `src/view/heart3d.js` — coração procedural (Three.js); envelopes de contração acionados pelos eventos detectados.
- `src/main.js` — liga tudo; reconstrói filtros, detector e traçado na frequência da fonte a cada troca (nada é reamostrado); ao fim de um registro, recomeça do zero.
- `scripts/fetch-records.mjs` — baixa registros do PhysioNet listados em `data/manifest.json` (ou adiciona novos pela linha de comando).

## Limites deste protótipo

- O coração 3D é uma ilustração geométrica; a animação indica **sincronização temporal**, não anatomia, contratilidade ou força.
- A contração atrial é prevista pelo RR médio (não há detecção de onda P ainda) e é rotulada como "estimada". Em fibrilação atrial (PTB-XL 08215, LUDB 8) essa estimativa não tem sentido fisiológico — o registro está incluído justamente para expor esse limite.
- Registros de 2 derivações (MIT-BIH) mostram só as derivações existentes; nada é inventado para as outras células.
- O detector marca a deflexão dominante do QRS, não necessariamente o pico R (erro sistemático de ~25 ms em QRS predominantemente negativos).
- O gerador conhece os instantes reais do R (`source.beats`) e os registros trazem anotações; ambos existem apenas para avaliar o detector, nunca para animar o modelo.
- Formatos WFDB multi-segmento e multi-frequência, EDF e CSV ainda não são lidos; nos formatos suportados, o skew é aplicado e amostras inválidas (sentinelas WFDB) viram NaN, contadas e preenchidas por retenção da última amostra válida na reprodução.

## Próximos passos sugeridos

1. Detecção de ondas P e T (o LUDB fornece a referência anotada) para substituir a estimativa atrial pelo RR.
2. Painel de espectro/tempo-frequência para o modo "diferença" — o que a filtragem remove.
3. Rodar o benchmark nos 48 registros do MIT-BIH (`npm run fetch-data -- mitdb/<n>`) e publicar a tabela completa.
4. Leitores EDF e CSV para dispositivos próprios.
