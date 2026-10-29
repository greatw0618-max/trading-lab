' 청산맵 자료 수집을 창 없이 실행합니다 (예약 작업 "MaemaeLab LiqMap Collect"가 15분마다 부름).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run """C:\Program Files\nodejs\node.exe"" """ & dir & "\liqmap-collect.mjs"" --auto", 0, False
