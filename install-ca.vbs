Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command ""Import-Certificate -FilePath 'D:\WorkSpace\vscode\qq-farm-bot-ui-main\core\data\ca\certs\ca.pem' -CertStoreLocation Cert:\LocalMachine\Root; Write-Host '安装完成，可以关闭此窗口'; Read-Host '按回车退出'""", "", "runas", 1
