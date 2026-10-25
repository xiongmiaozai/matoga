/**
 * matoga NSIS installer customization
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * Empty customCheckAppRunning macro: overrides electron-builder's default
 * app-running check so the installer never shows the
 * "matoga cannot be closed, please close it manually" modal. The server runs
 * in-process inside matoga.exe, so closing the window closes the server.
 */
!macro customCheckAppRunning
  ; intentionally empty - skip default process check
!macroend
