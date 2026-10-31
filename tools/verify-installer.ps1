$setup = 'F:\编程\mc\app\matoga\dist-electron\matoga Setup 3.0.0.exe'
$dest = 'F:\编程\mc\app\matoga\test-install-verify'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
$p = Start-Process -FilePath $setup -ArgumentList '/S', "/D=$dest" -Wait -PassThru
'安装退出码: ' + $p.ExitCode
Start-Sleep -Seconds 3
'落盘文件数: ' + (Get-ChildItem $dest -Recurse -File -ErrorAction SilentlyContinue).Count
'matoga.exe 存在: ' + (Test-Path "$dest\matoga.exe")
'协议页资源存在: ' + (Test-Path "$dest\resources\app.asar")
$un = "$dest\Uninstall matoga.exe"
if (Test-Path $un) {
    $pu = Start-Process -FilePath $un -ArgumentList '/S' -Wait -PassThru
    '卸载退出码: ' + $pu.ExitCode
    Start-Sleep -Seconds 2
}
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
'清理完成: ' + (-not (Test-Path $dest))
