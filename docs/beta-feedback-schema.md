# Beta Reading — esquema de feedback

Este documento descreve os dados estruturados de beta reading do app.

## Coleção `betaFeedback`

Cada documento pertence a um leitor e livro. O campo `type` define o formato.

### Identidade comum

- `schemaVersion`: atualmente `1`
- `type`: `cover`, `chapter` ou `book`
- `readerId`: identificador técnico estável do leitor
- `profileHash`: hash do perfil usado apenas para validar a escrita
- `name`: nome do leitor
- `bookId`, `bookTitle`
- `createdAt`, `updatedAt`

O código de acesso do leitor **não** é exportado nem gravado nesta coleção.

## Capa — `type: "cover"`

- `visualRating` (1–5): avaliação estética da capa
- `openInterestRating` (1–5): quanto a capa faria o leitor abrir o livro sem conhecer a história
- `note`: comentário opcional sobre a capa

A avaliação pós-leitura da adequação da capa fica na pesquisa final do livro.

## Capítulo — `type: "chapter"`

- `chapter`, `chapterTitle`
- `tags`: lista estruturada
  - `loved`: Gostei muito
  - `confused`: Fiquei confuso
  - `slow`: Ritmo lento
- `text`: comentário livre opcional

O documento é atualizado se o mesmo leitor editar seu feedback do mesmo capítulo.

## Livro — `type: "book"`

- `overallRating` (1–5): nota geral
- `continueRating` (1–5): vontade de seguir para o próximo livro
- `pace`: `slow`, `balanced`, `fast` ou vazio
- `favoriteCharacter`: personagem favorito
- `coverRepresentationRating` (0–5): quanto a capa representa a história após terminar
- `memorableMoment`: momento mais memorável
- `hookMoment`: momento em que o leitor percebeu que precisava continuar lendo
- `difficultPart`: parte confusa, cansativa ou que mudaria
- `finalComment`: opinião livre final

As listas de personagens por livro ficam em `data/beta-feedback.json`.

## Cruzamento com analytics

O painel administrativo cruza `betaFeedback` com:

- `readerAnalytics/{readerId}`
- `readerAnalytics/{readerId}/chapters/{bookId__chapter}`

Por capítulo, o painel pode comparar:

- leitores que concluíram
- tempo ativo médio de capítulos concluídos
- quantidade de feedbacks
- tags de reação
- comentários livres

Leitores com `analyticsIgnored: true` no perfil permanecem armazenados, mas são excluídos dos agregados e da exportação para análise.

## Exportação para IA

Em **Painel do Autor → Avaliações beta**:

- **Copiar JSON para IA**
- **Baixar JSON**

O JSON exportado contém:
- feedback estruturado da amostra válida
- analytics por capítulo da mesma amostra
- definições semânticas dos principais campos

Não inclui códigos de acesso.

## Interpretação importante

`activeSec` mede tempo ativo do app no capítulo. Não deve ser tratado automaticamente como tempo de leitura ocular. Narração e música possuem métricas separadas e podem se sobrepor ao tempo ativo.
