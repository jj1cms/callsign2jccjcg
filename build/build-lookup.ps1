# build-lookup.ps1
# jcc/jcg/ku の各リスト(UTF-8変換済み)を解析し、フロントが使う docs/lookup.json を生成する。
# 入力: build/*.utf8.txt   出力: docs/lookup.json
$ErrorActionPreference = "Stop"
$root  = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root "build"
$docs  = Join-Path $root "docs"

# JARL都道府県番号(01-47) -> 正式名称
$prefNames = [ordered]@{
  "01"="北海道";"02"="青森県";"03"="岩手県";"04"="秋田県";"05"="山形県";"06"="宮城県";"07"="福島県";
  "08"="新潟県";"09"="長野県";"10"="東京都";"11"="神奈川県";"12"="千葉県";"13"="埼玉県";"14"="茨城県";
  "15"="栃木県";"16"="群馬県";"17"="山梨県";"18"="静岡県";"19"="岐阜県";"20"="愛知県";"21"="三重県";
  "22"="京都府";"23"="滋賀県";"24"="奈良県";"25"="大阪府";"26"="和歌山県";"27"="兵庫県";"28"="富山県";
  "29"="福井県";"30"="石川県";"31"="岡山県";"32"="島根県";"33"="山口県";"34"="鳥取県";"35"="広島県";
  "36"="香川県";"37"="徳島県";"38"="愛媛県";"39"="高知県";"40"="福岡県";"41"="佐賀県";"42"="長崎県";
  "43"="熊本県";"44"="大分県";"45"="宮崎県";"46"="鹿児島県";"47"="沖縄県"
}

function Read-Utf8Lines($name) {
  [System.IO.File]::ReadAllLines((Join-Path $build $name), [System.Text.UTF8Encoding]::new($false))
}

# --- jcc-list: 市(4桁) と 東京特別区(6桁)。code先頭2桁=府県番号、漢字列が地名 ---
$jcc = @{}   # pref -> @{ 漢字 = code }
foreach ($line in (Read-Utf8Lines "jcc-list.utf8.txt")) {
  if ($line -match '^\*') { continue }                      # 消滅市はスキップ
  if ($line -match '^\s+(\d{4,6})\s+\S+\s+(\S+)\s*$') {
    $code = $matches[1]; $kanji = $matches[2]
    $pref = $code.Substring(0,2)
    if (-not $jcc.ContainsKey($pref)) { $jcc[$pref] = @{} }
    $jcc[$pref][$kanji] = $code
  }
}

# --- jcg-list: 郡(5桁)。漢字列=郡名(郡を含まない)。配下の町村行(コード無し)はスキップ ---
$jcg = @{}   # pref -> @{ 郡名 = code }
foreach ($line in (Read-Utf8Lines "jcg-list.utf8.txt")) {
  if ($line -match '^\*') { continue }
  if ($line -match '^\s+(\d{5})\s+\S+\s+(\S+)\s*$') {
    $code = $matches[1]; $kanji = $matches[2]
    $pref = $code.Substring(0,2)
    if (-not $jcg.ContainsKey($pref)) { $jcg[$pref] = @{} }
    $jcg[$pref][$kanji] = $code
  }
}

# --- ku-list: 政令市の区(6桁)。見出し "札幌市(0101)" で市名を取得 ---
$ku = @{}    # 市名 -> @{ 区名 = code }
$curCity = $null
foreach ($line in (Read-Utf8Lines "ku-list.utf8.txt")) {
  if ($line -match '^\*') { continue }
  if ($line -match '^(\S+市)\((\d{4})\)\s*$') {
    $curCity = $matches[1]
    if (-not $ku.ContainsKey($curCity)) { $ku[$curCity] = @{} }
    continue
  }
  if ($curCity -and $line -match '^(\d{6})\s+\S+\s+(\S+)\s*$') {
    $code = $matches[1]; $kanji = $matches[2]
    $ku[$curCity][$kanji] = $code
  }
}

# --- 補完: ku-list.txt に未収録の熊本市(2012年政令市移行)の5区を追加 ---
# 熊本市 JCC=4301。区コードは JARL の区番号順(中央01/東02/西03/南04/北05)。
if (-not $ku.ContainsKey("熊本市")) {
  $ku["熊本市"] = [ordered]@{
    "中央"="430101"; "東"="430102"; "西"="430103"; "南"="430104"; "北"="430105"
  }
}

$out = [ordered]@{
  generatedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
  prefNames   = $prefNames
  jcc         = $jcc
  jcg         = $jcg
  ku          = $ku
}

if (-not (Test-Path $docs)) { New-Item -ItemType Directory -Path $docs | Out-Null }
$json = $out | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText((Join-Path $docs "lookup.json"), $json, [System.Text.UTF8Encoding]::new($false))

$jccCnt = ($jcc.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
$jcgCnt = ($jcg.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
$kuCnt  = ($ku.Values  | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
Write-Output ("lookup.json 生成完了: jcc={0} jcg={1} ku={2} (cities={3})" -f $jccCnt,$jcgCnt,$kuCnt,$ku.Count)
