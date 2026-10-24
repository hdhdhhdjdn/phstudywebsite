' Start the class server in background (no console window).
' Logs go to server.log in the same folder.
Option Explicit
Dim fso, ws, dir, node, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

node = "C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
If Not fso.FileExists(node) Then node = "node"

cmd = "cmd /c chcp 65001 >nul & cd /d """ & dir & """ & """ & node & """ cloud-server.js >> server.log 2>&1"
ws.Run cmd, 0, False
