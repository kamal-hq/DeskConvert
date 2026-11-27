#define MyAppName "DeskConvert"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "Muhammad Kamal"
#define MyAppExeName "DeskConvert.exe"

; Verify pinned SHA-256 hashes for bundled Tesseract & Poppler binaries before compiling
#define VerifyExitCode Exec("python", "desktop\verify_installer_assets.py", ".", 1, 0)
#if VerifyExitCode != 0
  #error "Installer asset SHA-256 verification failed. Run 'python desktop/verify_installer_assets.py' to inspect mismatches."
#endif

[Setup]
AppId={{DC2024-DESKCONVERT-MK-001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://github.com/kamal-hq/DeskConvert
DefaultDirName={autopf}\DeskConvert
DefaultGroupName={#MyAppName}
OutputDir=installer_output
OutputBaseFilename=DeskConvert_Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\DeskConvert.exe
SetupIconFile=assets\icon.ico
LicenseFile=LICENSE-DESKTOP-AGPL-3.0.txt
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; \
  Description: "{cm:CreateDesktopIcon}"; \
  GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Main application — PyInstaller output
Source: "dist\DeskConvert\*"; \
  DestDir: "{app}"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; License & third-party attribution notices (AGPL-3.0 desktop distribution + MIT source)
Source: "LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE-DESKTOP-AGPL-3.0.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion

; Poppler binaries
Source: "installer_assets\poppler\bin\*"; \
  DestDir: "{app}\poppler\bin"; \
  Flags: ignoreversion recursesubdirs

; Tesseract installer (runs silently during install)
Source: "installer_assets\tesseract-installer.exe"; \
  DestDir: "{tmp}"; \
  Flags: deleteafterinstall

[Icons]
Name: "{group}\{#MyAppName}"; \
  Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; \
  Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; \
  Filename: "{app}\{#MyAppExeName}"; \
  Tasks: desktopicon

[Run]
; Install Tesseract silently
Filename: "{tmp}\tesseract-installer.exe"; \
  Parameters: "/S"; \
  StatusMsg: "Installing Tesseract OCR..."; \
  Flags: waituntilterminated

[Registry]
; Add Poppler to system PATH
Root: HKLM; \
  Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; \
  ValueType: expandsz; \
  ValueName: "Path"; \
  ValueData: "{olddata};{app}\poppler\bin"; \
  Check: NeedsAddPath(ExpandConstant('{app}\poppler\bin'))

[Code]
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(
    HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Control\Session Manager\Environment',
    'Path', OrigPath)
  then begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
