# 08 — Protocolo B03: caracterização dos filtros

**Data:** 2026-10-08. **Estado:** protocolo v1 congelado antes das medições; execução pendente.
**Vínculos:** [diretor](../specs/002-consolidacao-base-ecg-3d.md), [fundamento](02-caracterizacao-filtros.md), [diagnóstico B01](06-diagnostico-arquitetura.md).

## 1. Pergunta e escopo

Qual é a transformação efetivamente aplicada por estágio, em regime e em transientes, e quais efeitos aparecem no sinal real? Caracterizar a implementação atual, sem mudar coeficientes ou detector e sem identificar automaticamente fisiologia/ruído.

Referência de código: `HighPass1`, `Notch`, `LeadFilterBank` em `web/src/ecg/filters.js`; `QrsDetector` e `SignalPipeline`. Separar filtros lineares de exibição, médias móveis/diferença interna, derivada, quadrado/MWI e decisão adaptativa. A derivada tem lookback efetivo a conferir, distinto do parâmetro nominal (B01).

## 2. Experimento linear fixado

Frequências nativas: **360 e 500 Hz**; PA **0,5 Hz**; notch **50 e 60 Hz, Q=30**, incluindo configuração desativada **0 Hz**. Um canal para medidas por estágio; 12 canais para paridade do banco. Entradas em mV; cálculos internos em dupla precisão, saída do banco Float32.

Senoides de amplitude pico **1 mV**, fase inicial zero. Grade em Hz: **0,1; 0,25; 0,5; 1; 5; 10; 20; 40; 49; 50; 51; 59; 60; 61; 100**, apenas abaixo de Nyquist. Rodar **120 s**, descartar os primeiros **60 s** para medidas de regime; preservar o transiente separadamente. Não usar FFT com pico de bin como estimador de ganho: ajustar saída a seno/cosseno/DC na frequência exata, por mínimos quadrados, sobre o trecho declarado.

Referência analítica independente derivada das recorrências:

```text
PA: H(z) = alpha (1 - z^-1) / (1 - alpha z^-1)
notch: H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
cascata: produto das respostas dos estágios, z = exp(j 2 pi f/fs)
```

Publicar ganho linear, ganho dB somente quando definido, fase e erro do ajuste. Fase fica **indisponível** quando o ganho analítico <0,01; não interpretar fase no zero do notch. Comparar fases por diferença circular, não subtrair ângulos sem wrap. Não converter fase em atraso constante para toda a banda.

**Critérios de consistência numérica:** erro absoluto de ganho ≤0,002 no estágio escalar e ≤0,003 na cascata/banco; diferença circular de fase ≤0,02 rad quando elegível. Valores são tolerâncias desta caracterização matemática, não requisitos clínicos. Resíduo RMS normalizado pela amplitude de entrada deve ser ≤0,002 no trecho de regime. Falha é registrada sem relaxar tolerância depois do resultado.

## 3. Transientes, estado e limites

| Caso fixado | Execução | Medida/aceite |
|---|---|---|
| Impulso | 1 mV seguido de zeros, 20 s, estado inicial zero | Todos os valores finitos; confronto com recorrência analítica ≤1e-6 escalar e ≤1e-5 banco |
| Degrau | 0 até 5 s, depois 1 mV; duração 30 s | Curva, máximo e primeiro instante após o qual |saída PA| ≤0,01 mV até EOF; tempo é descritivo |
| Inicialização | Constante 1 mV desde início, 10 s | Registrar transiente atual; não presumir prime automático no primeiro passo |
| Prime/retomada | Constante 1 mV, prime explícito; e máscara por 3 s, retomada a 2,5 mV | Após prime/primeira retomada, saída de cascata ≤1e-6 mV; estado não avança na lacuna |
| Notch impossível | Banco a 100 Hz com notch50/60; classe Notch isolada nos mesmos limites | Banco inativo; Notch lança RangeError; nenhum coeficiente instável usado |
| Notch desligado | Banco notch0 | Sem notch e saída igual ao PA dentro da tolerância; descrição atual também registrada |

A descrição de notch0 e a ausência de gate de unidade/checksum são achados de auditoria, não autorização de correção nesta tarefa. Máscara representa indisponibilidade mesmo se a API retornar último valor; não analisar esse valor como nova amostra.

## 4. Detector e ECG real: braço descritivo

Usar registros já inspecionados **LUDB 8, 56 e 83; MIT-BIH 100 e 228**, sem novos downloads. Reproduzir o registro inteiro, na frequência nativa, com configuração de rede do manifesto. Registrar unidades, validade, checksums e derivação mapeada. Medidas em janelas fixas: LUDB **[1,9) s**; MIT100 **[60,70) s**; MIT228 **[400,410) s**. Se inválida/incompleta, marcar indisponível, não escolher outra janela favorável.

Por estágio, publicar RMS, pico absoluto, diferença entrada/saída, coordenadas e unidade; não comparar diretamente quadrado/MWI com amplitude em mV. Traços internos observados por sonda de testes, sem duplicar a lógica do detector. Referências anotadas podem organizar medidas depois do replay, nunca orientar processamento. Para medidas de forma por batimento, declarar bordas/janela e censura; não atribuir significado clínico à largura interna.

Preservar comparação no relógio original. Qualquer vista alinhada é secundária, com deslocamento declarado, sem substituir a diferença original. Este braço não tem gate de “melhoria de morfologia”, nem ajusta parâmetros. Confirmar eventos do pipeline observado iguais aos não observados e controles QRS congelados.

## 5. Artefatos e encerramento

Implementação futura somente em testes, por exemplo `web/tests/filter-characterization.mjs` e teste correspondente; **esses arquivos ainda não existem**. Comandos existentes de preparação em `web`:

```powershell
node --test tests\filters.test.mjs tests\gaps.test.mjs tests\wfdb.test.mjs
npm test
```

Salvar relatório científico determinístico com schema/versão, configuração, método, critérios, resultados por caso e indisponibilidades; sem tempo de parede. Relatório narrativo deve explicar falhas, não só totais. Testar estimador com ganho/fase conhecidos e validar saída contra fórmulas, além de repetir a geração.

B03 conclui quando todos os casos têm resultado ou bloqueio explícito, controles/eventos preservados e divergências documentadas. Uma falha pode concluir a caracterização e gerar trabalho B05, mas não equivale a aprovação do comportamento. Não reajustar grade/tolerâncias, otimizar filtros ou abrir nova hipótese QRS nesta execução.

## Atualização de execução v1 — 2026-10-08

**B03 Node concluída:** [relatório](10-resultados-caracterizacao-filtros.md) e [JSON determinístico por caso](10-resultados-caracterizacao-filtros.json), medidos em `0884fd1` sem alteração de produção. Primeira execução e artefato final: 319 casos, 319 pass, 0 fail, 0 blocked; eventos e controles reais preservados. Grade, janelas, durações e tolerâncias acima continuam congeladas e inalteradas. Inicialização é zero-state, não prime automático; notch0 possui descrição enganosa embora processamento correto. Esses achados geram encaminhamento B05, não ajuste do protocolo. Estado pendente do cabeçalho refere-se ao congelamento anterior, superado por esta atualização.
