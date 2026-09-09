# legalize-pt

Portugal — legislação em Markdown, versionada como um repositório git.

Cada lei é um ficheiro; cada reforma é um commit datado da verdadeira data de publicação oficial. O `git log` de qualquer lei mostra o seu histórico completo — quando foi promulgada, que artigos foram alterados e por qual norma.

O repositório cobre a 1.ª Série do Diário da República desde 1960. Cada diploma é um ficheiro Markdown e cada reforma é um commit de Git datado à data de entrada em vigor da respetiva versão. Para os diplomas que o DRE consolida, o repositório segue a versão consolidada artigo a artigo: o texto de cada artigo em cada momento da sua vigência. Para os restantes, o texto tal como foi publicado. Os nomes dos ficheiros derivam do ELI; a legislação regional fica em pt-20 (Açores) e pt-30 (Madeira).

## O que contém

- **Lei** (`DRE-LEI-<n>-<ano>.md`) — `pt/DRE-LEI-29-2026.md`
- **Lei Constitucional** (`DRE-LEI-CONSTITUCIONAL-<n>-<ano>.md`)
- **Lei Orgânica** (`DRE-LEIORG-<n>-<ano>.md`)
- **Decreto-Lei** (`DRE-DEC-LEI-<n>-<ano>.md`) — `pt/DRE-DEC-LEI-47344-1966.md`
- **Decreto** (`DRE-DEC-<n>-<ano>.md`)
- **Decreto Regulamentar** (`DRE-DECREGUL-<n>-<ano>.md`)
- **Decreto Legislativo Regional** (`DRE-DECLEGREG-<n>-<ano>-<A|M>.md`) — Regiões Autónomas: pt-20 (Açores), pt-30 (Madeira)
- **Decreto Regulamentar Regional** (`DRE-DECREGULREG-<n>-<ano>-<A|M>.md`)
- **Portaria** (`DRE-PORT-<n>-<ano>.md`) — `pt/DRE-PORT-324-2015.md`
- **Resolução do Conselho de Ministros** (`DRE-RESOLCONSMIN-<n>-<ano>.md`) — Distinta da Resolução da Assembleia da República, que tem prefixo próprio
- **Resolução da Assembleia da República** (`DRE-RESOLASSREP-<n>-<ano>.md`)
- **Decreto do Presidente da República** (`DRE-DECPRESREP-<n>-<ano>.md`)
- **Despacho Normativo** (`DRE-DESPNORM-<n>-<ano>.md`)
- **Declaração de Retificação** (`DRE-DECLRETIF-<n>-<ano>.md`) — Corrige juridicamente o texto publicado; ambas as grafias (rectificação/retificação)
- **Acórdão do Tribunal Constitucional** (`DRE-ACTCONST-<n>-<ano>.md`) — Apenas os que declaram a inconstitucionalidade com força obrigatória geral
- **Acórdão de uniformização de jurisprudência** (`DRE-ACSTJ-<n>-<ano>.md`) — E os assentos anteriores a 1995

## Fonte dos dados

- **DRE — Diário da República Eletrónico (Imprensa Nacional-Casa da Moeda)**
  - Portal: https://diariodarepublica.pt
  - Legislação consolidada: https://diariodarepublica.pt/dr/legislacao-consolidada
  - Identificador Europeu de Legislação (ELI): https://data.dre.pt

## Limitações

- **Não há texto eletrónico antes de 1960.** Os diplomas anteriores existem no catálogo do DRE apenas como digitalização em PDF, sem camada de texto, pelo que ficam fora do repositório.
- **Alguns diplomas históricos existem só como digitalização.** Acórdãos doutrinários, cartas de lei e regimentos antigos são publicados com os seus metadados e uma ligação ao PDF oficial, em vez de serem omitidos.
- **Nem todo o texto consolidado tem tabelas.** As consolidações anteriores a cerca de 2023 foram achatadas pelo próprio DRE em texto corrido; onde o DRE marca «ver documento original», o repositório liga à página do PDF oficial.
- **A história de versões existe para os diplomas que o DRE consolida.** Os restantes têm um único commit, porque o texto publicado não muda — o que muda é a sua consolidação.
- As imagens não são armazenadas no repositório; são ligadas ao CDN oficial do DRE.
- **O Jornal Oficial dos Açores não está incluído.** O DRE cataloga esses diplomas mas nunca os digitalizou — sem texto, sem PDF — e este repositório é o Diário da República. A legislação regional que o próprio DR publica está incluída, em pt-20 e pt-30.
- Os descritores temáticos do DRE são publicados em `subjects`, já resolvidos para os termos portugueses do tesauro; os identificadores originais ficam em `extra.subject_ids`.

## Outros países

Este repositório faz parte do **Legalize**, que mantém a legislação de vários países como repositórios git. Consulte https://legalize.dev para ver o catálogo completo.

## Apoio

O Legalize é gratuito e aberto. Se este trabalho lhe for útil, pode ajudar a sustentar o seu alojamento e desenvolvimento: [Apoie este projeto](https://buymeacoffee.com/legalizedev).

## Licença

- **Código do pipeline**: MIT (https://github.com/legalize-dev/legalize-pipeline)
- **Dados**: Acesso universal e gratuito ao Diário da República, nos termos do artigo 3.º do Decreto-Lei n.º 83/2016, de 16 de dezembro, que abrange a impressão, o arquivo, a pesquisa e o livre acesso ao conteúdo dos atos publicados, em formatos eletrónicos de acesso aberto; e do regime de dados abertos da Lei n.º 68/2021, de 26 de agosto. A edição eletrónica é a que faz fé (eli:legal_value = official).
