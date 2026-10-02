# Meus Livros — Leitor (App Mobile)

App leve (PWA — instala no celular direto do navegador, sem loja de apps)
pra ler e ouvir TODOS os seus livros, não só um ciclo/série específica —
cada livro é uma entrada independente na biblioteca do app. Lê texto e
toca o áudio do capítulo inteiro, funciona com a tela desligada, guarda de
onde você parou, tem modo foco de leitura e um botão opcional de música de
fundo.

No momento "Ruínas dos Céus" (Ciclo de Jesed, Livro 1) e "Guerras de Sangue" (Livro 2) estão carregados. A estrutura já suporta qualquer quantidade de livros e séries — basta seguir "Adicionando mais livros depois", abaixo.

## Como colocar isso no ar (uma vez só)

1. **Crie um repositório novo no GitHub** (github.com → "New repository").
   Pode ser público. Nome sugerido: `jesed-leitor` (qualquer nome serve).
   Não marque "Add a README" — vamos subir os arquivos já prontos.

2. **Suba esta pasta inteira** (`App Mobile/`) pro repositório. Duas formas:
   - **Sem instalar nada**: na página do repositório no GitHub, clique em
     "uploading an existing file" e arraste todo o conteúdo desta pasta
     (mantendo a estrutura de subpastas: `assets/`, `data/`, `content/`,
     `icons/`, mais os arquivos soltos `index.html`, `manifest.webmanifest`).
   - **Com Git instalado**: `git init`, `git add .`, `git commit -m "app"`,
     depois `git remote add origin <url do repo>` e `git push -u origin main`.

3. **Ative o GitHub Pages**: no repositório, vá em
   Settings → Pages → Build and deployment → Source: "Deploy from a branch"
   → Branch: `main` / pasta `/ (root)` → Save. Em 1-2 minutos o site fica no
   ar em algo como `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

4. **No celular**, abra esse endereço no Chrome e use "Adicionar à tela
   inicial" (ou "Instalar app", se o Chrome oferecer) — vira um app normal,
   com ícone próprio, sem barra do navegador.

## Onde colocar o conteúdo de cada livro

Dentro de `content/ruinas-dos-ceus/`:

- `capitulos/` → copie aqui os `.md` de dentro da pasta `00 - Texto/capitulos`
  do livro, **sem mudar o nome dos arquivos** (o app já espera esses nomes
  exatos, ex. `01 - Capítulo 1 - O Sopro de Etérea.md`).
- `audio/` → coloque aqui o `.wav` do capítulo inteiro que o Editor de
  Livros gera (botão de narração → baixa um `.wav` por capítulo).
  **Recomendo converter pra `.mp3` antes de subir** (arquivo bem menor,
  carrega mais rápido no celular e sem perda perceptível pra voz). Mantenha
  o nome igual ao que o editor gera, só trocando a extensão, ex.:
  `Ruínas dos Céus - Capítulo 1 - O Sopro de Etérea.mp3`.

Você não precisa ter todos os 25 capítulos com áudio pra usar o app — os
que ainda não tiverem `.mp3` aparecem só pra leitura, sem o player embaixo.
Suba aos poucos, o app detecta sozinho quais já existem.

### Conversão rápida wav → mp3

Se tiver o `ffmpeg` instalado no PC (gratuito), um comando simples resolve
um arquivo:

```
ffmpeg -i "Ruínas dos Céus - Capítulo 1 - O Sopro de Etérea.wav" -codec:a libmp3lame -b:a 96k "Ruínas dos Céus - Capítulo 1 - O Sopro de Etérea.mp3"
```

(96kbps já fica ótimo pra voz falada e deixa o arquivo bem leve.) Se
preferir, também dá pra converter vários de uma vez com uma ferramenta
gráfica (ex. o próprio VLC tem opção de "Convert").

## Adicionando mais livros depois

Vale pra qualquer livro novo, seja outro livro do Ciclo de Jesed ou de uma
história completamente diferente — o app não é amarrado a nenhuma série:

1. Crie uma pasta nova em `content/`, ex. `content/nome-do-livro/`, com as
   mesmas subpastas `capitulos/` e `audio/`.
2. Crie `data/nome-do-livro.json` (mesmo formato de
   `data/ruinas-dos-ceus.json`) com os títulos/nomes de arquivo dos
   capítulos desse livro.
3. Acrescente uma entrada nova em `data/books.json`, apontando pro
   manifesto novo — o `subtitle` de cada livro é livre (pode citar a série
   dele, ou nada, se for avulso).

Se quiser, é só me avisar quando estiver pronto que eu gero o `.json` do
próximo livro igual fiz com o 1, a partir dos nomes de arquivo reais.

## Música de fundo (opcional)

Se você colocar um arquivo em `content/_shared/ambient.mp3`, o botão de
nota musical na barra do player liga essa música em volume baixo por baixo
da narração. Se esse arquivo não existir, o botão simplesmente não faz
nada — não precisa mexer em código pra ativar/desativar essa função.

## Se quiser trocar de onde o app puxa o conteúdo

Por padrão o app lê tudo deste mesmo site (mesma pasta que você subiu).
Se um dia quiser manter o conteúdo em outro repositório (por exemplo, um
privado, separado do app), dá pra apontar pra lá: no app, toque no ícone
de engrenagem (⚙) e cole o endereço base, por exemplo:

```
https://raw.githubusercontent.com/SEU-USUARIO/OUTRO-REPO/main/
```


## Acesso administrativo seguro

O modo admin usa Firebase Authentication com e-mail/senha e uma allowlist por UID no Firestore. Não existe senha de administrador embutida no repositório.

Configuração inicial, feita uma única vez:

1. No Firebase Console do projeto `editorlivroapeditorlivroappp`, habilite **Authentication → E-mail/Senha**.
2. Em **Authentication → Users**, crie a conta do administrador e copie o **UID**.
3. Em **Firestore Database**, crie a coleção `admins` e um documento cujo ID seja exatamente esse UID. O documento pode conter apenas `enabled: true`; a existência do documento já autoriza o acesso.
4. Publique as regras de `firestore.rules` no Firestore.
5. No app, abra **Ajustes → Modo admin** e entre com o e-mail e a senha dessa conta.

O login tem recuperação de senha por e-mail. Uma conta autenticada que não possua o documento `admins/{UID}` é desconectada e não recebe acesso ao painel.
