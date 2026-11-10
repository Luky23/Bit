Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")
ScriptsDir = Fso.GetParentFolderName(WScript.ScriptFullName)
RepoDir = Fso.GetParentFolderName(ScriptsDir)
WshShell.CurrentDirectory = RepoDir
WshShell.Run chr(34) & Fso.BuildPath(ScriptsDir, "bit-launch.bat") & Chr(34), 0, False
Set WshShell = Nothing
Set Fso = Nothing
