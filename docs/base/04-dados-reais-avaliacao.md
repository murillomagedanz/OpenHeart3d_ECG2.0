# 04 — Dados reais, proveniência e avaliação reservada

**Vínculo:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md), B02 e futuras ampliações. **Estado:** contrato e reconciliação B02 concluídos; nenhum novo download ou split de avaliação executado. Ver [07 — Inventário de dados](07-inventario-dados.md).

## Objetivo

Ter dados suficientes e diversos para perguntas explícitas, com unidades, referências e direitos verificáveis. Mais amostras do mesmo registro não substituem diversidade de pacientes ou avaliação independente.

## Inventário a reconciliar

Usar [catálogo atual](../../web/data/README.md), `web/data/manifest.json`, arquivos locais, relatórios congelados e histórico de investigação. Distinguir:

- Declarado no manifesto, disponível localmente e realmente incluído no relatório.
- ECG isolado, anotação de batimento, delineação de ondas e diagnóstico textual.
- Registro inspecionado, usado em ajuste/regressão ou candidato ainda não acessado.
- Frequência nativa, derivações recebidas/derivadas, calibração, validade e filtragem prévia conhecida/desconhecida.

O relatório QRS tem 101 registros; números históricos de benchmarks e inventários podem usar outra seleção. Reconciliar divergências, não somar contagens incompatíveis. PTB-XL com diagnóstico não deve ser tratado como referência de tempos QRS sem anotação apropriada.

## Ficha obrigatória de base/registro

| Grupo | Campos mínimos |
|---|---|
| Proveniência | Publicador, URL/versão, identificador autorizado, integridade e data de obtenção |
| Direitos | Licença, atribuição, redistribuição, restrições de acesso e finalidade |
| Sinal | fs, canais, unidade/gain/baseline, mapeamento, duração, relógio e lacunas |
| Processamento anterior | Filtros/reamostragem conhecidos ou explicitamente desconhecidos |
| Referência | Tipo de anotação, autores/método, incerteza, trecho avaliado e exclusões justificadas |
| Avaliação | Paciente/sessão quando disponíveis, split e histórico de inspeção/uso |

A AGPL do código não licencia os dados. Dados clínicos novos exigem autorização, finalidade, governança ética aplicável, desidentificação, minimização e controle de acesso; dados sensíveis não entram no git. Dados públicos também devem respeitar termos e risco de reidentificação.

## Separação de avaliação

Definir unidade de separação por paciente/sessão, evitando que segmentos do mesmo indivíduo apareçam em ajuste e avaliação. Quando identidade não estiver disponível, declarar que a independência por paciente não foi comprovada. Congelar seleção e regras antes de examinar resultados; registrar acesso e não reutilizar o reservado para tuning.

LUDB ímpar conserva a função histórica no protocolo P/T, mas registros já inspecionados não são “inéditos” para novas hipóteses QRS. Reservas futuras devem ser novas para a pergunta em questão. Uma variante rejeitada não recebe novo corpus só para ser resgatada.

## Entrega e aceite

Inventário reconciliado e ficha por base, lacunas, cobertura por paciente/ritmo/equipamento quando disponível e proposta de reserva sem acesso prematuro. Ampliação posterior requer pergunta, referências adequadas, termos verificados, orçamento de armazenamento e protocolo; base sem anotações úteis ainda pode servir à interface, não ao escore correspondente.

## Estado B02 — concluído

O inventário, os totais reconciliados, as lacunas de proveniência e a proposta de reserva estão em [07 — Inventário de dados](07-inventario-dados.md), com o snapshot determinístico [07-inventario-dados.json](07-inventario-dados.json). A seleção QRS versionada permanece congelada em 101 registros; os arquivos locais opcionais e sua avaliação separada não foram incorporados a esse baseline. Não foi declarada uma reserva independente.
