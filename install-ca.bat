@echo off
certutil -addstore root "D:\WorkSpace\vscode\qq-farm-bot-ui-main\core\data\ca\certs\ca.crt"
if %errorlevel% equ 0 (
    echo CA 证书安装成功！
) else (
    echo 安装失败，请右键本文件选择「以管理员身份运行」
)
pause
