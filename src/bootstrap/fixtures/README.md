# Startup validation fixtures

`gateway-client.ts` 是本地 HTTP Client 子进程替身。测试将其编译到临时目录，提供 health、结果接收及退出行为；不连接 Telegram 等外部平台。

`terminal-runner.py` 使用有尺寸的 PTY 启动 TUI/向导，并发送退出按键；最长等待 9 秒，超时终止该测试进程组。
