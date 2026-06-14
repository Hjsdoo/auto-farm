$certPath = "D:\WorkSpace\vscode\qq-farm-bot-ui-main\core\data\ca\certs\ca.crt"
certutil -addstore root $certPath
if ($LASTEXITCODE -eq 0) {
    Write-Host "CA 证书安装成功！" -ForegroundColor Green
} else {
    Write-Host "安装失败，可以试试手动导入：certlm.msc" -ForegroundColor Red
}
Read-Host "按回车退出"
