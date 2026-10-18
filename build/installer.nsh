; matoga NSIS 自定义安装脚本（electron-builder include）
; 2026-10-18: 按需求移除开机自启；覆盖默认"应用在跑"检测（默认 tasklist|find 管道
; 在部分环境误报导致"无法关闭 请手动关闭"弹窗）。

!macro customCheckAppRunning
  ; 空实现：跳过默认进程检测。
  ; 若安装时应用确实在运行，文件解压会以明确错误失败，不会再误弹"无法关闭"。
!macroend
