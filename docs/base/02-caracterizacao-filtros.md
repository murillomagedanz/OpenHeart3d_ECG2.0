# 02 — Caracterização dos filtros e conteúdo transformado

**Vínculo:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md), B03. **Depende:** B01. **Estado:** protocolo v1 definido; execução pendente.

O [protocolo executável de estudo v1](08-protocolo-caracterizacao-filtros.md) foi definido em 2026-10-08, antes das medições. Ensaios e implementação da instrumentação continuam pendentes; este documento conserva a fundamentação.

## Objetivo e fundamento

Medir o comportamento dos filtros do aplicativo e das transformações internas do detector. Resposta em frequência descreve ganho e fase de um estágio linear; não identifica a origem fisiológica de uma componente. Derivação, quadrado e integração do detector têm finalidade e comportamento diferentes dos filtros de exibição; não aplicar a todo o detector uma interpretação linear de ganho/fase.

O sistema já tem comparação temporal e espectral/STFT de bruto/filtrado/diferença (D12–D14). B03 deve reaproveitá-la e avaliar a necessidade de observação por estágio. A diferença é **conteúdo transformado**, não automaticamente ruído descartado ou informação cardíaca útil.

## Protocolo mínimo a congelar

| Ensaio | Medidas | Cuidados |
|---|---|---|
| Senoides de amplitude conhecida | Ganho por frequência e fase/atraso nos estágios lineares | Fixar frequências, fs, duração e trecho de regime antes da execução |
| Impulso/degrau e início de fluxo | Transiente, tempo de acomodação e inicialização | Separar comportamento inicial de regime; declarar saturação se houver |
| Notch e limites de Nyquist | Resposta perto da rede, ativação/inativação efetiva | Não assumir que configuração declarada foi aplicada |
| Reinício/lacuna | Estado descartado, recuperação e transiente | Não preencher lacunas nem atravessá-las com janelas |
| ECG real e sinais controlados | Alterações de amplitude, forma e tempo | Mesma janela válida; distinguir pico, borda e efeito de alinhamento |
| Transformações do detector | Passa-banda interno, derivada, quadrado/MWI e decisões | Manter escalas e unidades próprias; não rotular energia interna como mV |

Para cada ensaio, registrar fórmula/implementação de referência, parâmetros efetivos, tolerância numérica, política de bordas, unidade, atraso e denominador. Caracterização analítica deve ser conferida pela execução da implementação existente; não substituí-la por um filtro de biblioteca diferente.

## Interpretação e referências

“Bruto” pode conter filtragem prévia do dispositivo/base. Componentes anteriores a esse processamento não são recuperáveis de forma confiável. Comparar diferenças tanto no mesmo relógio de entrada/saída quanto, se necessário, após alinhamento explicitamente declarado; nunca deslocar silenciosamente para melhorar o resultado.

Mudanças em amplitudes/bordas P/QRS/T devem ser descritas como medidas, não como conclusão diagnóstica. Referências externas futuras precisam indicar convenções, frequência de amostragem e finalidade (visualização, detecção ou diagnóstico); não transplantar constantes entre pipelines.

## Entrega e aceite

Relatório determinístico para medições que permitem determinismo, cenários sintéticos e reais, resposta por estágio e composição, falhas e transientes. Tolerâncias devem estar definidas antes de julgar resultados. Alterar coeficientes ou métodos exige tarefa posterior, justificativa e replay completo de regressão; B03 não autoriza isso.
