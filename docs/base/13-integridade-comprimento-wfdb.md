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
- F02 permanece aberto: divergência de checksum e unidade desconhecida ainda podem ser aceitas pelo fluxo. Essa política exige critérios próprios e não foi ampliada por esta correção.
- B04 permanece incompleto até o braço de navegador; B05 global e B06 não são declarados concluídos.

## Reprodução

Em `web/`:

```powershell
node --test tests\wfdb.test.mjs tests\operational-baseline.test.mjs
node tests\operational-functional.mjs
npm test
```

O artefato determinístico atual é `13-integridade-comprimento-wfdb.functional.json`. Os snapshots 11 e a evidência F08 v2 em `12-correcao-relogio-reset.functional.json` são mantidos como registros históricos, sem sobrescrita.
