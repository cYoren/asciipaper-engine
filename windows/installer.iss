; asciipaper for Windows: per-user installer (no administrator rights needed).
; Build: iscc /DAppVersion=1.4.0 windows\installer.iss   (after building windows\asciipaper.csproj)
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{C4495F18-206B-492F-B54E-8A8FC27577E0}
AppName=asciipaper
AppVersion={#AppVersion}
AppVerName=asciipaper {#AppVersion}
AppPublisher=cYoren
AppPublisherURL=https://github.com/cYoren/asciipaper
AppSupportURL=https://github.com/cYoren/asciipaper/issues
DefaultDirName={localappdata}\Programs\asciipaper
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
OutputDir=..\dist
OutputBaseFilename=asciipaper-setup-{#AppVersion}
SetupIconFile=asciipaper.ico
UninstallDisplayIcon={app}\asciipaper.exe
UninstallDisplayName=asciipaper
LicenseFile=..\LICENSE
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
MinVersion=10.0

[Tasks]
Name: "desktopicon"; Description: "Add an icon to the desktop"; Flags: unchecked

[Files]
Source: "bin\Release\net48\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion; Excludes: "*.pdb,Microsoft.Web.WebView2.Wpf.dll"

[Icons]
Name: "{userprograms}\asciipaper"; Filename: "{app}\asciipaper.exe"
Name: "{userdesktop}\asciipaper"; Filename: "{app}\asciipaper.exe"; Tasks: desktopicon

[Registry]
; Start with Windows (a switch in the app's Settings turns it off).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "asciipaper"; ValueData: """{app}\asciipaper.exe"" --background"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\asciipaper.exe"; Description: "Open asciipaper"; Flags: nowait postinstall

[UninstallRun]
Filename: "{app}\asciipaper.exe"; Parameters: "--quit"; Flags: runhidden waituntilterminated; RunOnceId: "QuitApp"

[UninstallDelete]
; The app's copy of its files and the browser cache. Your wallpapers (library) stay.
Type: filesandordirs; Name: "{localappdata}\asciipaper\app"
Type: filesandordirs; Name: "{localappdata}\asciipaper\webview"
Type: filesandordirs; Name: "{localappdata}\asciipaper\thumbs"

[Code]
// Close a running asciipaper before replacing its files.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  if FileExists(ExpandConstant('{app}\asciipaper.exe')) then
  begin
    Exec(ExpandConstant('{app}\asciipaper.exe'), '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Sleep(2000);
  end;
  Result := '';
end;
