; 自定义 NSIS 宏：安装/卸载前强制结束旧实例，避免 electron-builder 默认的
; tasklist/find 检测在中文名、路径或子串场景下误报“应用无法关闭”。
!macro customCheckAppRunning
  ; 静默尝试强制结束主进程及其子进程（数据已自动保存，强制结束安全）
  nsExec::Exec 'cmd /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t >nul 2>&1'
  Pop $R0
  ; 给进程一点时间退出，避免文件锁
  Sleep 500
!macroend
