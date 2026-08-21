Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define ROOT "..\..\.."

Name "Alunixa X"
OutFile "${ROOT}\dist\windows\Alunixa-X-${VERSION}-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Alunixa X"
InstallDirRegKey HKCU "Software\Alunixa X" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define MUI_ICON "${ROOT}\apps\alunixa-x-manager\src-tauri\icons\icon.ico"
!define MUI_UNICON "${ROOT}\apps\alunixa-x-manager\src-tauri\icons\icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"

  nsExec::ExecToLog 'taskkill /IM alunixa-x.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM alunixa-x-imagegen-mcp.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM alunixa-x-manager.exe /F'
  Pop $0

  File "${ROOT}\dist\windows\app\alunixa-x.exe"
  File "${ROOT}\dist\windows\app\alunixa-x-imagegen-mcp.exe"
  File "${ROOT}\dist\windows\app\alunixa-x-manager.exe"

  CreateShortcut "$DESKTOP\Alunixa X.lnk" "$INSTDIR\alunixa-x-manager.exe" "" "$INSTDIR\alunixa-x-manager.exe"
  CreateShortcut "$DESKTOP\Alunixa X Launch.lnk" "$INSTDIR\alunixa-x.exe" "" "$INSTDIR\alunixa-x.exe"
  CreateDirectory "$SMPROGRAMS\Alunixa X"
  CreateShortcut "$SMPROGRAMS\Alunixa X\Alunixa X.lnk" "$INSTDIR\alunixa-x-manager.exe" "" "$INSTDIR\alunixa-x-manager.exe"
  CreateShortcut "$SMPROGRAMS\Alunixa X\Alunixa X Launch.lnk" "$INSTDIR\alunixa-x.exe" "" "$INSTDIR\alunixa-x.exe"
  CreateShortcut "$SMPROGRAMS\Alunixa X\卸载 Alunixa X.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\alunixa-x-manager.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Alunixa X" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AlunixaX" "DisplayName" "Alunixa X"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AlunixaX" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AlunixaX" "Publisher" "Alunixa-Code"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AlunixaX" "DisplayIcon" "$INSTDIR\alunixa-x-manager.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AlunixaX" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AlunixaX" "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM alunixa-x.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM alunixa-x-imagegen-mcp.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM alunixa-x-manager.exe /F'
  Pop $0

  Delete "$DESKTOP\Alunixa X.lnk"
  Delete "$DESKTOP\Alunixa X Launch.lnk"
  Delete "$SMPROGRAMS\Alunixa X\Alunixa X.lnk"
  Delete "$SMPROGRAMS\Alunixa X\Alunixa X Launch.lnk"
  Delete "$SMPROGRAMS\Alunixa X\卸载 Alunixa X.lnk"
  RMDir "$SMPROGRAMS\Alunixa X"

  Delete "$INSTDIR\alunixa-x.exe"
  Delete "$INSTDIR\alunixa-x-imagegen-mcp.exe"
  Delete "$INSTDIR\alunixa-x-manager.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AlunixaX"
  DeleteRegKey HKCU "Software\Alunixa X"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AlunixaXManager"
SectionEnd
