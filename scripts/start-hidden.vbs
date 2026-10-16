' Starts the dashboard server (serve.ps1) with no visible window - but only if it is not already running.
' Run at logon and every 5 minutes by the Windows Task Scheduler, so a server that Windows closed comes back on its own.
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 2000, 2000, 2000, 2000
http.open "GET", "http://localhost:8765/", False
http.send
If Err.Number = 0 Then
  If http.status = 200 Then WScript.Quit 0
End If
Err.Clear
On Error GoTo 0
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\serve.ps1"" -NoBrowser"
CreateObject("WScript.Shell").Run cmd, 0, False
