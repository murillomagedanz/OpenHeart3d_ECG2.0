# 14 — Integridade e escala WFDB (F02)

**Estado:** política delimitada implementada e validada em Node/VM; navegador/WebGL não aferidos.  
**Diretor:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md). **Baseline original:** [B04 v1](11-resultados-robustez-custo.md). **F01 relacionada:** [integridade de comprimento](13-integridade-comprimento-wfdb.md). **Evidência funcional:** [JSON corrente v4](14-integridade-calibracao-wfdb.functional.json).

## Política aplicada

O playback ECG só recebe registros com escala física convertível para mV e sem divergência em checksums WFDB que o cabeçalho declarou:

- **Checksum declarado e correto:** aceito.
- **Checksum declarado e divergente:** rejeitado com erro identificando sinal, valor esperado e valor calculado.
- **Checksum ausente no cabeçalho:** aceito como não verificado (`null`); ausência não é checksum válido nem evidência de integridade.
- **Unidade reconhecida e conversível** (`mV`, `uV`, `V` e aliases já suportados): aceita após conversão para mV.
- **Unidade declarada desconhecida/não conversível:** rejeitada antes do playback; nenhuma unidade desconhecida é silenciosamente tratada como mV.
- **Unidade omitida:** permanece sob a convenção existente do parser, que usa mV como unidade padrão WFDB.

`loadRecord`, usado pelos carregadores local e do manifesto, aplica a política antes de devolver um registro. Em caso de rejeição, os manipuladores da aplicação exibem o erro e mantêm intactos fonte, pipeline e posição de reprodução ativos. `decodeSignals` e `verifyChecksums` permanecem APIs de inspeção de baixo nível: permitem observar ADC bruto, unidade declarada e resultado do checksum; amostras com unidade desconhecida saem como `NaN` físico, sem alegar valor em mV. Essas APIs não constituem caminho de playback validado.

## Evidência e limites

As regressões exercitam checksum divergente, checksum ausente, unidade desconhecida com checksum correto e recusa nos caminhos de arquivo local e manifesto, para fonte sintética e registro ativo. Os registros reais empacotados continuam cobertos por checksum e primeira amostra nos testes gerais.

Checksum WFDB é mecanismo de consistência contra corrupção acidental; não é assinatura nem verificação criptográfica de proveniência. Checksum ausente permanece não verificado. A recusa de unidade desconhecida limita o leitor ao domínio ECG cuja escala a aplicação consegue expressar; não implementa conversão de pressão, ADU ou outras modalidades. Nenhuma política de resolução manual, override ou recuperação automática foi criada.

F02, assim como F01, passa nos ensaios Node/VM. Isso não conclui B04: navegador/WebGL F07–F11 continua pendente; B05 global e B06 permanecem abertas. Filtros, detector, dados, relatórios congelados, unidades conhecidas e visualização não foram alterados.

## Reprodução

Em `web/`:

```powershell
node --test tests\wfdb.test.mjs tests\operational-baseline.test.mjs
node tests\operational-functional.mjs
npm test
```

O artefato determinístico corrente é `14-integridade-calibracao-wfdb.functional.json`. A linha de base funcional 11, a evidência F08 v2 e a evidência F01 v3 permanecem preservadas.
