' Starts the dashboard server (serve.ps1) with no visible window.
' Used by the Windows startup shortcut and by the start files.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\serve.ps1"" -NoBrowser"
CreateObject("WScript.Shell").Run cmd, 0, False
