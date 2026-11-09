Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")
RepoDir = Fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = RepoDir
WshShell.Run chr(34) & Fso.BuildPath(RepoDir, "Iniciar-Bit.bat") & Chr(34), 0, False
Set WshShell = Nothing
Set Fso = Nothing
