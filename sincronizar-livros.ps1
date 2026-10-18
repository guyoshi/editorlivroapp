# Sincroniza capítulos dos livros (Diário Sobrenatural 1 e 2, Spacetheft 1, Viajantes Dimensionais 1)
# para o app Lityra. Copia os .md, recria data/<livro>.json a partir do livro.json de cada livro
# e garante a entrada em data/books.json.
# Capítulos vazios (arquivo ausente ou <= 50 bytes) são ignorados e entram sozinhos
# na próxima execução, assim que forem escritos.

$ErrorActionPreference = "Stop"
$app  = $PSScriptRoot                                   # ...\Editor de Livros\editorlivroapp
$root = Split-Path (Split-Path $app -Parent) -Parent    # ...\Dimensões Infinitas
$utf8 = New-Object System.Text.UTF8Encoding($false)

$livros = @(
  @{ id="diario-sobrenatural-1";    title="Os Elos das Sombras";     sub="Diário Sobrenatural — Livro 1";   dir="Diário Sobrenatural\1 - Os Elos das Sombras" },
  @{ id="diario-sobrenatural-2";    title="A Alvorada das Ilusões";  sub="Diário Sobrenatural — Livro 2";   dir="Diário Sobrenatural\2 - A Alvorada das Ilusões" },
  @{ id="spacetheft-1";             title="A Lenda da Aurora";       sub="Spacetheft — Livro 1";            dir="Spacetheft\1 - A Lenda da Aurora" },
  @{ id="viajantes-dimensionais-1"; title="A Patrulha de Korvo";     sub="Viajantes Dimensionais — Livro 1"; dir="Viajantes Dimensionais\1 - A Patrulha de Korvo" }
)

function Limpar-Titulo($t, $n) {
  $t = [regex]::Replace($t, '^\s*cap[ií]tulo\s+\d+\s*[–-]?\s*', '', 'IgnoreCase').Trim()
  $t = [regex]::Replace($t, '^([A-Za-zÀ-ú]+ [IVX]+) - ', '$1: ')
  if ([string]::IsNullOrWhiteSpace($t)) { $t = "Capítulo $n" }
  return $t
}

foreach ($l in $livros) {
  $texto = Join-Path $root ($l.dir + "\00 - Texto")
  $json  = Join-Path $texto "livro.json"
  if (-not (Test-Path $json)) { Write-Host "[$($l.id)] livro.json não encontrado, pulando"; continue }
  $livro = Get-Content $json -Raw -Encoding UTF8 | ConvertFrom-Json
  $destDir = Join-Path $app ("content\" + $l.id + "\capitulos")
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null

  $caps = @(); $pendentes = @()
  foreach ($c in $livro.capitulos) {
    $arq = $c.arquivo
    $n = [int]($arq -split ' - ')[0]
    $src = Join-Path $texto ("capitulos\" + $arq)
    if (-not (Test-Path $src) -or (Get-Item $src).Length -le 50) { $pendentes += $arq; continue }
    Copy-Item $src (Join-Path $destDir $arq) -Force
    $caps += [ordered]@{ n=$n; title=(Limpar-Titulo $c.titulo $n); text=("content/" + $l.id + "/capitulos/" + $arq) }
  }

  $manifest = [ordered]@{ id=$l.id; title=$l.title; chapters=$caps }
  [IO.File]::WriteAllText((Join-Path $app ("data\" + $l.id + ".json")), ($manifest | ConvertTo-Json -Depth 6), $utf8)
  Write-Host ("[{0}] {1} capítulos publicados, {2} pendentes" -f $l.id, $caps.Count, $pendentes.Count)
  foreach ($p in $pendentes) { Write-Host "    pendente: $p" }
}

# books.json: acrescenta os livros que ainda não estão na biblioteca
$booksPath = Join-Path $app "data\books.json"
$books = Get-Content $booksPath -Raw -Encoding UTF8 | ConvertFrom-Json
$ids = @($books.books | ForEach-Object { $_.id })
$lista = @($books.books)
foreach ($l in $livros) {
  if ($ids -notcontains $l.id) {
    $lista += [pscustomobject]@{ id=$l.id; title=$l.title; subtitle=$l.sub; manifest=("data/" + $l.id + ".json") }
  }
}
$books.books = $lista
[IO.File]::WriteAllText($booksPath, ($books | ConvertTo-Json -Depth 6), $utf8)
Write-Host "Pronto. Se usa GitHub Pages, faça commit/push da pasta editorlivroapp para publicar."
