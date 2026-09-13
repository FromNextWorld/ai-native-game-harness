param(
    [Parameter(Mandatory)][string]$CapturePath,
    [Parameter(Mandatory)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# Offline replay of actual production SpriteBatch calls, not an AI concept or GPU/game test.
$capture = Get-Content -LiteralPath $CapturePath -Raw | ConvertFrom-Json
$spritePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../content-pack/XiaoTangYuanCompanion/assets/xiaotangyuan_companion.png'))
$sheet = [Drawing.Bitmap]::new($spritePath)
$image = [Drawing.Bitmap]::new(2400,800)
$graphics = [Drawing.Graphics]::FromImage($image)
$font = [Drawing.Font]::new('Microsoft YaHei UI',14)
$smallFont = [Drawing.Font]::new('Microsoft YaHei UI',10)
try {
    $graphics.Clear([Drawing.Color]::FromArgb(252,246,232))
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
    $graphics.ScaleTransform(2,2)
    $panels = @(
        @{ Label='待机：4正面 / 4背面'; Calls=$capture.idle },
        @{ Label='出击前：两列各4只'; Calls=$capture.stage },
        @{ Label='返回：4正面 / 4背面'; Calls=$capture.returned }
    )
    for ($i=0; $i -lt 3; $i++) {
        $panel = $graphics.Save()
        try {
            $graphics.TranslateTransform($i*400,0)
            $graphics.DrawString($panels[$i].Label,$font,[Drawing.Brushes]::SaddleBrown,[single]18,[single]15)
            $graphics.FillRectangle([Drawing.Brushes]::Wheat,12,50,376,290)
            $graphics.TranslateTransform(-145,-145)
            $graphics.DrawImage($sheet,[Drawing.Rectangle]::new(288,288,64,64),0,0,64,64,[Drawing.GraphicsUnit]::Pixel)
            foreach ($call in $panels[$i].Calls) {
                $state = $graphics.Save()
                $brush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb($call.Color.A,$call.Color.R,$call.Color.G,$call.Color.B))
                try {
                    $graphics.TranslateTransform([single]$call.Position.X,[single]$call.Position.Y)
                    if ($call.Kind -eq 'dot') {
                        $graphics.FillRectangle($brush,[single]0,[single]0,[single]$call.Scale.X,[single]$call.Scale.Y)
                    } else {
                        $graphics.RotateTransform([single]($call.Rotation*180/[Math]::PI))
                        $graphics.ScaleTransform([single]$call.Scale.X,[single]$call.Scale.Y)
                        if ($call.Kind -eq 'sprite') {
                            $dest=[Drawing.Rectangle]::new(-[int]$call.Origin.X,-[int]$call.Origin.Y,[int]$call.Source.Width,[int]$call.Source.Height)
                            $graphics.DrawImage($sheet,$dest,[int]$call.Source.X,[int]$call.Source.Y,[int]$call.Source.Width,[int]$call.Source.Height,[Drawing.GraphicsUnit]::Pixel)
                        } else {
                            $graphics.FillRectangle($brush,-[single]$call.Origin.X,-[single]$call.Origin.Y,[single]1,[single]1)
                        }
                    }
                } finally { $brush.Dispose(); $graphics.Restore($state) }
            }
        } finally { $graphics.Restore($panel) }
    }
    $graphics.DrawString('原有像素素材 + 生产绘制指令离线回放（2倍显示）；不是实机截图。',$smallFont,[Drawing.Brushes]::SaddleBrown,[single]18,[single]365)
    $image.Save([IO.Path]::GetFullPath($OutputPath),[Drawing.Imaging.ImageFormat]::Png)
} finally { $smallFont.Dispose(); $font.Dispose(); $graphics.Dispose(); $image.Dispose(); $sheet.Dispose() }
Write-Output "Saved native draw-call replay: $OutputPath"
