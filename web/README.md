# Protótipo web — ECG 12 derivações + coração 3D sincronizado

Protótipo estático (HTML + ES modules, sem build) da etapa 2 do roteiro. **Todos os dados são sintéticos.** Não é dispositivo médico e não realiza diagnóstico.

## Executar

Precisa de um servidor HTTP simples (módulos ES não carregam via `file://`). Three.js (r160) está incluído em `vendor/` — funciona offline.

```powershell
cd web
python -m http.server 8000   # ou: npm start
```

Abra `http://localhost:8000`.

## Testar o detector

```powershell
cd web
npm test
```

`tests/detector-bench.mjs` roda 60 s de sinal sintético em seis cenários e pontua o detector contra os instantes reais do R (`source.beats`, que o detector nunca vê). Resultado atual (fs 500 Hz, tolerância ±80 ms):

| Cenário | bpm | Ruído / rede (mV) | Sens. | VPP | Erro médio | Latência |
|---|---|---|---|---|---|---|
| repouso limpo | 72 | 0,02 / 0 | 1,00 | 0,99 | ~6 ms | ~125 ms |
| repouso c/ rede | 75 | 0,05 / 0,10 | 1,00 | 0,99 | ~6 ms | ~125 ms |
| bradicardia ruidosa | 40 | 0,10 / 0,20 | 1,00 | 1,00 | ~5 ms | ~125 ms |
| exercício | 100 | 0,20 / 0,30 | 1,00 | 0,98 | ~8 ms | ~125 ms |
| taquicardia | 150 | 0,03 / 0,05 | 0,99 | 0,99 | ~3 ms | ~130 ms |
| taquicardia extrema | 180 | 0,02 / 0 | 1,00 | 0,99 | ~1 ms | ~130 ms |

O teste falha se sensibilidade ou VPP ficarem abaixo de 0,97 em algum cenário. A latência (~125 ms entre o R e a detecção) vem dos filtros causais e da janela de confirmação; é inerente a um detector em tempo real e é compensada no instante reportado, não na animação.

## Como funciona (fluxo inverso: o sinal comanda o modelo)

```text
SyntheticSource ──► LeadFilterBank ──► QrsDetector ──► Heart3D.onQrs()
 (12 derivações)     (PA 0,5 Hz +        (Pan–Tompkins       (sístole ventricular no R;
  vetor cardíaco      notch 60 Hz)        simplificado,       contração atrial ESTIMADA
  projetado)                              derivação II)       a partir do RR médio)
         └──────────────► EcgPlot (bruto | filtrado | diferença)
```

- `src/ecg/leads.js` — nomes, layout 4×3 e vetores aproximados das 12 derivações; `projectDipole()` mantém as derivações fisicamente relacionadas.
- `src/ecg/synth.js` — vetor cardíaco como soma de gaussianas (P, Q, R, S, T) posicionadas no tempo em relação ao R: o QRS tem duração fixa, o QT encurta com √RR (Bazett) e o PR fica quase constante. Variabilidade RR, linha de base respiratória, ruído e rede 60 Hz.
- `src/ecg/filters.js` — passa-alta 1ª ordem e notch biquad, por derivação, com descrição textual exibida na tela.
- `src/ecg/detector.js` — detector de QRS em tempo real (passa-banda por médias móveis → derivada de 10 ms → quadrado → integração 100 ms → limiar adaptativo com janela candidata). Expõe RR médio e FC. Só vê o sinal filtrado, nunca os instantes verdadeiros do gerador.
- `src/view/ecgPlot.js` — papel 25 mm/s · 10 mm/mV, varredura, tira de ritmo com marcas de QRS detectado.
- `src/view/heart3d.js` — coração procedural (Three.js); envelopes de contração acionados pelos eventos detectados.

## Limites deste protótipo

- O coração 3D é uma ilustração geométrica; a animação indica **sincronização temporal**, não anatomia, contratilidade ou força.
- A contração atrial é prevista pelo RR médio (não há detecção de onda P ainda) e é rotulada como "estimada".
- O gerador conhece os instantes reais do R (`source.beats`); eles existem apenas para avaliar o detector em testes, nunca para animar o modelo.

## Próximos passos sugeridos

1. Fonte de dados real: leitor de arquivos (WFDB/EDF/CSV) com fs, unidade, ganho e mapeamento de eletrodos, mantendo o bruto imutável.
2. Validar o detector contra anotações públicas (ex.: MIT-BIH), não só contra o gerador sintético.
3. Detecção de onda P e T para substituir a estimativa atrial pelo RR.
4. Painel de espectro/tempo-frequência para o modo "diferença".
