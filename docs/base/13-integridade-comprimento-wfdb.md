# 13 — Integridade do comprimento WFDB (F01)

**Estado:** correção delimitada implementada e validada em Node/VM; navegador/WebGL não aferidos.  
**Diretor:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md). **Baseline original:** [B04 v1](11-resultados-robustez-custo.md). **Evidência corrente:** [JSON funcional v3](13-integridade-comprimento-wfdb.functional.json).

## Achado e mudança

O decodificador aceitava menos amostras que a contagem positiva declarada no cabeçalho WFDB e retornava um prefixo como se fosse um registro utilizável. Agora, antes de retornar sinais, compara a capacidade de cada arquivo com a contagem declarada e lança erro explícito se o arquivo não contém amostras suficientes. Para canais multiplexados, a capacidade é calculada em quadros completos compartilhados; o primeiro sinal já não valida comprimento insuficiente de outro sinal.

Quando a contagem do cabeçalho está ausente ou é zero, o comprimento continua inferido dos quadros completos. Se os arquivos de sinal separados inferirem quantidades diferentes, a carga falha em vez de produzir canais desalinhados. Com contagem positiva, bytes excedentes são permitidos e os sinais retornados continuam limitados à contagem declarada.

Os testes também asseguram o comprimento mínimo do offset, compatibilidade de formato/offset entre sinais no mesmo arquivo, os formatos 16, 24, 32, 61, 80, 160 e 212, e a amostra terminal ímpar de 212. Os dois bytes que codificam a última amostra ímpar são aceitos; dados incompletos não são contados como uma amostra completa.

## Compatibilidade e limites

- A mudança afeta somente a integridade de comprimento durante a leitura WFDB. Não altera checksum, conversão ou política de unidade, escalas, filtros, detector, anotações, dados ou ativos 3D.
- Na interface, uma carga truncada informa o erro e preserva a fonte/pipeline ativos; não troca silenciosamente para um registro parcial.
- A evidência v3 cobre fixtures dos formatos suportados, registros locais já incluídos e carregamento da aplicação em VM. Não constitui validação em browser/WebGL, teste clínico, validação de todas as variantes externas do WFDB nem verificação de proveniência.
- Na entrega original F01, F02 ainda permanecia aberto; seu tratamento posterior está registrado separadamente em [14 — integridade e escala WFDB](14-integridade-calibracao-wfdb.md).
- B04 permanece incompleto até o braço de navegador; B05 global e B06 não são declarados concluídos.

**Seguimento:** a política separada para checksum declarado e unidade desconhecida foi definida e implementada em [14 — integridade e escala WFDB](14-integridade-calibracao-wfdb.md). Esta entrega F01 continua restrita à validação de comprimento e permanece preservada como registro da mudança anterior.

## Reprodução

Em `web/`:

```powershell
node --test tests\wfdb.test.mjs tests\operational-baseline.test.mjs
node tests\operational-functional.mjs
npm test
```

O artefato determinístico atual é `13-integridade-comprimento-wfdb.functional.json`. Os snapshots 11 e a evidência F08 v2 em `12-correcao-relogio-reset.functional.json` são mantidos como registros históricos, sem sobrescrita.
