# 12 — Correção delimitada F08: relógio após rebuild

**Data:** 2026-10-08. **Origem:** branch `murillomagedanz-diagnostico-qrs`, revisão de partida `5c9efdb`. **Estado:** regressão corrigida e verificada em Node/VM; navegador/WebGL pendentes.
**Vínculos:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md), [protocolo B04 v1](09-protocolo-robustez-custo.md), [baseline histórico](11-resultados-robustez-custo.md), [evidência funcional atual v2](12-correcao-relogio-reset.functional.json).

## 1. Exceção de escopo, não fechamento de gate

O diretor exige B04 concluída antes de B05. O braço navegador ainda não está disponível. Esta intervenção é uma **exceção explícita, limitada ao defeito determinístico F08 já demonstrado em VM**, sob autorização de progresso autônomo e delimitação do coordenador. Corrigir o relógio obsoleto não exige inferência visual, novo algoritmo ou decisão de produto. A exceção não amplia autorização para B05 global, não declara B04 completa e não aprova B06.

F01 (prefixo truncado), F02 (checksum divergente/unidade desconhecida), budgets de dispositivo/carga e navegador/WebGL continuam pendentes. Não houve downloads, busca de chave, acesso ao asset privado, navegador substituto, commit, push ou merge.

## 2. Reprodução antes da correção

Os testes desejados foram alterados/adicionados **antes** de tocar produção e executados contra `main.js` original:

```powershell
cd web
node --test tests\operational-baseline.test.mjs tests\source-controls.test.mjs
```

- LUDB 8 após 2.000 passos: `signalTime = 3.998`. Trocar notch resetava `source.index = 0`, `source.position = 0`, `signalIndex = -1`, mas a expectativa `signalTime === 0` falhava: **3.998 !== 0**.
- Sintético após 2.000 passos: tempo da última amostra **3.9979999999997813**, posição da próxima amostra `source.t = 3.999999999999781`. O rebuild por notch mantinha a fonte, mas o relógio ficava atrasado: expectativa de posição atual falhou com esses dois valores.
- Troca pausada sintético → arquivo: **3.9979999999997813 !== 0**. Este caso foi reexecutado antes da correção após completar os campos da fixture curta requeridos pelo painel.
- O teste do gerador também falhou com **versão 1 !== 2**, uma alteração intencional do contrato de evidência, não outro defeito de produção.

O baseline histórico registrou que um frame sem nova amostra recebia `3.998` em `Heart3D.update`. Sua tabela/JSON v1 continuam históricos e não foram reescritos como se a correção já existisse.

## 3. Contrato corrigido

A única mudança de produção é em `buildPipeline`: atribuir `state.signalTime` à posição temporal **da fonte corrente** antes do próximo passo/frame.

| Contexto | Fonte após rebuild | Relógio antes da nova amostra |
|---|---|---|
| Novo arquivo, notch de arquivo, reinício explícito, EOF | `FileSource.position`, normalmente zero após reset | Zero |
| Novo sintético | Novo `SyntheticSource.t = 0` | Zero |
| Notch sintético 50/60/0 | Mesma fonte, não reiniciada | `SyntheticSource.t` corrente, não zero |

`signalIndex = -1` continua significando que o novo buffer de análise ainda não recebeu amostras; não é a posição temporal da fonte. No primeiro `step`, o relógio volta ao `s.t` da amostra corrente e o índice ao `s.index`/índice sintético absoluto, exatamente como antes. Não há nova convenção para fluxo ininterrupto nem arredondamento extra do relógio sintético.

Filtros, detector/RR, ondas, plot, espectro/exportação, referências/escore e `heart.reset()` mantêm seus resets existentes. Não foi inserido `heart.onQrs` no rebuild; a regressão verifica que reset não acrescenta evento ventricular. `lastFrame`, acumulador e cadência permanecem intactos; o teste preserva a fração de **0,001 s** e verifica a primeira amostra após retomada. Nenhum checksum, unidade, decoder, filtro, limiar, evento QRS, fórmula ou asset foi modificado.

No EOF o frame ainda apresenta a última amostra/janela válida antes do rebuild. O rebuild ao fim desse frame deixa o relógio em zero; o próximo frame pausado já recebe zero, mesmo sem novo passo. O teste existente de exportação da janela final curta permanece aprovado.

## 4. Verificação e artefatos

- VM compartilhada em `web/tests/operational-app.mjs`, extraída do harness existente, sem duplicá-lo.
- Testes em `operational-baseline.test.mjs`: arquivo LUDB 500 Hz → MIT 360 Hz (`II ← MLII`) → sintético, notch 50/60/0, 100 resets, pausa/retomada/velocidades, sintético contínuo, troca pausada, reinício explícito e EOF. Baseline v1 testado como histórico; expectativas atuais identificadas como v2.
- `source-controls.test.mjs` continua cobrindo falhas/seleção obsoleta e janela final antes do reinício; nenhum ajuste desses comportamentos.
- Gerador `operational-functional.mjs` v2 executa o harness para obter valores F08 atuais, em vez de conservar constantes do defeito. Agora escreve **12**, nunca o JSON congelado **11**. F08 passa no braço VM, mas seu estado global permanece **parcial** porque o navegador não foi medido.
- Dois runs do gerador produziram JSON byte a byte idêntico, SHA-256 `3bbbb1c4628bd0ffb4642b4d7c2aeea54a664424d39365a95f66ea3d7bcdf6ba`.
- Validação direcionada: **11 testes, 11 aprovados**. `npm test`: **259 testes, 259 aprovados, zero falhas**, mais os benchmarks sintético e real configurados; agregado real local: 36.403 referências, sensibilidade 0,9857, PPV 0,9801. Este corpus local não é apresentado como nova reprodução do corpus QRS congelado de 101 registros.
- `node --check` nos módulos alterados/extraído e `git diff --check` aprovados. Não há linter/TypeScript configurado; não foram instalados novos validadores/dependências.
- `git diff --exit-code` confirmou inalterados `web/src/ecg`, `web/src/io` e os JSONs históricos de custo/funcionalidade. Os algoritmos e relatórios QRS congelados não foram alterados; os testes existentes de regressão continuam aprovados.

Reprodução atual em `web`:

```powershell
node --test tests\operational-baseline.test.mjs tests\source-controls.test.mjs
node tests\operational-functional.mjs
npm test
node --check src\main.js
node --check tests\operational-app.mjs
node --check tests\operational-baseline.test.mjs
node --check tests\operational-functional.mjs
git diff --check
```

O benchmark operacional completo de 30 minutos não foi reexecutado: a alteração apenas normaliza estado no rebuild, sem mudança matemática no fluxo. O relatório de custo **11** permanece baseline histórico, não medida da revisão atual.

## 5. Limites residuais

BrowserOS indisponível; não houve browser/`requestAnimationFrame` real, inspeção visual, medição de apresentação, WebGL ou análise de recursos renderizados. O mock verifica o argumento entregue a `Heart3D.update`, não a renderização/anatomia. F07–F11 mantêm o braço real pendente; F01/F02 e budgets permanecem achados/decisões separados. A base não foi declarada consolidada nem clinicamente validada.
