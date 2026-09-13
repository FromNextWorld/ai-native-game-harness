$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$adapter = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../adapter'))
$path = Join-Path $adapter 'assets/grandpa-atlas.png'
$bitmap = [Drawing.Bitmap]::new($path)
try {
    if ($bitmap.Width -ne 1254 -or $bitmap.Height -ne 1254) { throw 'Atlas grid dimensions changed' }
    if ($bitmap.GetPixel(0,0).A -ne 0) { throw 'Opaque atlas background' }
    for ($row=0; $row -lt 2; $row++) {
        for ($col=0; $col -lt 2; $col++) {
            $clear=0; $visible=0
            for ($y=0; $y -lt 627; $y+=11) {
                for ($x=0; $x -lt 627; $x+=11) {
                    if ($bitmap.GetPixel($col*627+$x,$row*627+$y).A -eq 0) { $clear++ } else { $visible++ }
                }
            }
            if ($clear -lt 100 -or $visible -lt 100) { throw "Missing artwork or transparent area in cell $col,$row" }
        }
    }
} finally { $bitmap.Dispose() }
$assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes((Join-Path $adapter 'bin/Release/net6.0/StardewAgentMod.dll')))
$stream = $assembly.GetManifestResourceStream('StardewAgentMod.GrandpaAtlas')
if (!$stream) { throw 'Atlas omitted from Mod DLL' }
try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $embedded = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $sha.Dispose() }
    if ($embedded -ne (Get-FileHash -LiteralPath $path).Hash) { throw 'Embedded atlas differs from source' }
} finally { $stream.Dispose() }
Write-Output 'PASS: four populated transparent cells; compiled DLL embeds exact source PNG. Not a live render test.'
