# Como contribuir

Obrigado pelo interesse. Este é um protótipo de pesquisa, **não é dispositivo médico**.

## Antes de enviar código

- A edição comunitária usa **GNU AGPL-3.0** ([`LICENSE`](LICENSE), [D17](docs/DECISOES.md)).
- Contribuições externas **só são aceitas após o CLA** ([`CLA.md`](CLA.md)) estar em vigor. Enquanto for rascunho, abra uma *issue* para discutir ideias em vez de enviar pull requests.
- Não envie dados de pacientes. Registros de teste vêm apenas de bancos públicos listados em [`web/data/`](web/data/README.md), com a licença deles.

## Fluxo

1. Abra uma issue descrevendo a mudança. Mudanças relevantes seguem o formato de especificação em [`docs/specs/`](docs/specs/001-validacao-detector-e-ondas-pt.md).
2. Rode `npm test` dentro de `web/` (Node 22+). O relatório de validação e o de ondas P/T são determinísticos: se o código mudar o resultado, regenere com `npm run report` / `npm run report:waves` e explique a diferença.
3. Parâmetros de algoritmos só podem ser ajustados nos registros de ajuste (id par); o desempenho divulgado é o do held-out.
4. Não adicione interpretação clínica ou diagnóstica à interface.