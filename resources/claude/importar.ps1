# <!-- nautilus-skill {{VERSION}} . Lo escribe Nautilus junto a SKILL.md y lo reemplaza al actualizarse. -->
#
# importar.ps1 - Muda a Nautilus los secretos que estan fuera (config.env, variables de entorno, Administrador).
#
# Uso:  importar.ps1 -List lista.json            -> solo muestra que haria (no toca nada)
#       importar.ps1 -List lista.json -Apply     -> importa y, donde se pidio, reemplaza el valor por ${NAU_...}
#
# La lista la arma Claude con nombres y origenes, NUNCA con valores. Este script lee cada valor de su origen,
# lo guarda en el Administrador de credenciales (nautilus:NAU_...) y lo registra en index.json, solo en el
# Administrador (sin publicar). Ningun valor se imprime.
#
# Formato de la lista:
#   { "items": [ { "folder": "Uruguay", "code": "UY", "short": "DEV_INSIS_GEN_V10", "replace": true,
#                  "source": { "type": "file", "path": "C:\\...\\config.env", "key": "dev.schema.INSIS_GEN_V10" } },
#                { "folder": "General", "code": "", "short": "AZDO_PAT", "source": { "type": "env", "name": "AZDO_PAT" } },
#                { "folder": "General", "code": "", "short": "VALKIRIA_PASS", "source": { "type": "credential", "target": "valkiria" } } ] }

param(
    [Parameter(Mandatory)][string]$List,
    [switch]$Apply,
    # Solo para pruebas: otra carpeta de datos y otro prefijo de credenciales que los de Nautilus.
    [string]$DataDir = (Join-Path $env:APPDATA 'Nautilus'),
    [string]$CredentialPrefix = 'nautilus:'
)

$ErrorActionPreference = 'Stop'

$GeneralFolderId = 'general'
$SecretPrefix = 'NAU_'
# Limite de Windows para el valor de una credencial generica: 2560 bytes en UTF-16 (igual que Nautilus).
$MaxValueChars = 1280
$ShortPattern = '^[A-Z0-9][A-Z0-9_]{0,59}$'
$CodePattern = '^([A-Z]{2,4})?$'
$FolderColors = @('#4d88ff', '#15a0bf', '#7bd938', '#c517b6', '#f2ca33', '#e8743b',
                  '#2fc6a0', '#b5835a', '#ff5c8a', '#a974ff', '#9aa3b2')
$DefaultAutoLockMinutes = 10
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---------- Administrador de credenciales ----------

Add-Type -Namespace NautilusImport -Name Credentials -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
private struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
  public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
}
private const int CRED_TYPE_GENERIC = 1;
private const int CRED_PERSIST_LOCAL_MACHINE = 2;
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
private static extern bool CredWriteW(ref CREDENTIAL credential, int flags);
[DllImport("advapi32.dll")]
private static extern void CredFree(IntPtr buffer);

public static byte[] ReadBlob(string target) {
  IntPtr pointer;
  if (!CredReadW(target, CRED_TYPE_GENERIC, 0, out pointer)) return null;
  try {
    var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
    var blob = new byte[credential.CredentialBlobSize];
    if (blob.Length > 0) Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
    return blob;
  } finally { CredFree(pointer); }
}

public static bool Write(string target, string userName, string value) {
  byte[] blob = System.Text.Encoding.Unicode.GetBytes(value);
  IntPtr buffer = Marshal.AllocHGlobal(Math.Max(blob.Length, 1));
  try {
    Marshal.Copy(blob, 0, buffer, blob.Length);
    var credential = new CREDENTIAL {
      Type = CRED_TYPE_GENERIC, TargetName = target, UserName = userName,
      CredentialBlobSize = blob.Length, CredentialBlob = buffer, Persist = CRED_PERSIST_LOCAL_MACHINE
    };
    return CredWriteW(ref credential, 0);
  } finally { Marshal.FreeHGlobal(buffer); }
}
'@

# Nautilus guarda en UTF-16. Otras apps (keyring de Python, navegadores) a veces guardan UTF-8: se decide por el blob.
function ConvertFrom-CredentialBlob {
    param([byte[]]$Blob)
    if ($null -eq $Blob) { return $null }
    if ($Blob.Length -eq 0) { return '' }
    $isEvenLength = ($Blob.Length % 2) -eq 0
    if ($isEvenLength) {
        $asUtf16 = [System.Text.Encoding]::Unicode.GetString($Blob)
        $hasControlChars = $asUtf16 -match '[\x00-\x08]'
        if (-not $hasControlChars) { return $asUtf16 }
    }
    return [System.Text.Encoding]::UTF8.GetString($Blob)
}

function Read-NautilusSecret {
    param([string]$Name)
    return ConvertFrom-CredentialBlob ([NautilusImport.Credentials]::ReadBlob($CredentialPrefix + $Name))
}

# ---------- Origenes ----------

# Devuelve @{ Found; Value; Problem }. Problem explica por que no se puede importar, sin el valor.
function Read-PropertiesValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path -LiteralPath $Path)) { return @{ Found = $false; Problem = 'el archivo no existe' } }
    $prefix = "$Key="
    $line = [IO.File]::ReadAllLines($Path) | ForEach-Object { $_.TrimStart([char]0xFEFF) } |
            Where-Object { $_.TrimStart().StartsWith($prefix) } | Select-Object -First 1
    if ($null -eq $line) { return @{ Found = $false; Problem = 'la clave no esta en el archivo' } }
    $value = $line.TrimStart().Substring($prefix.Length).Trim()
    if ($value -match '^\$\{NAU_[A-Z0-9_]+\}$') { return @{ Found = $true; Value = $value; Problem = 'ya apunta a Nautilus' } }
    # java.util.Properties interpreta las barras invertidas: copiarla sin reproducir ese escape daria otra contrasena
    if ($value.Contains('\')) { return @{ Found = $true; Value = $value; Problem = 'tiene \ : creala a mano en Nautilus' } }
    return @{ Found = $true; Value = $value; Problem = $null }
}

function Read-SourceValue {
    param($Source)
    switch ($Source.type) {
        'file' { return Read-PropertiesValue -Path $Source.path -Key $Source.key }
        'env' {
            $value = [Environment]::GetEnvironmentVariable($Source.name, 'User')
            if ($null -eq $value) { return @{ Found = $false; Problem = 'la variable no existe' } }
            return @{ Found = $true; Value = $value; Problem = $null }
        }
        'credential' {
            $value = ConvertFrom-CredentialBlob ([NautilusImport.Credentials]::ReadBlob($Source.target))
            if ($null -eq $value) { return @{ Found = $false; Problem = 'la credencial no existe' } }
            return @{ Found = $true; Value = $value; Problem = $null }
        }
        default { return @{ Found = $false; Problem = "origen desconocido: $($Source.type)" } }
    }
}

function Format-Source {
    param($Source)
    switch ($Source.type) {
        'file' { return "$($Source.path) [$($Source.key)]" }
        'env' { return "variable de entorno $($Source.name)" }
        'credential' { return "Administrador: $($Source.target)" }
        default { return [string]$Source.type }
    }
}

# ---------- index.json ----------

function New-EmptyIndex {
    return [pscustomobject]@{
        version     = 1
        folders     = @([pscustomobject]@{ id = $GeneralFolderId; name = 'General'; code = ''; color = $FolderColors[0] })
        vars        = @()
        published   = @()
        autoLockMin = $DefaultAutoLockMinutes
        claudeSkill = $true
    }
}

function Read-Index {
    param([string]$File)
    if (-not (Test-Path -LiteralPath $File)) { return New-EmptyIndex }
    $index = [IO.File]::ReadAllText($File) | ConvertFrom-Json
    # ConvertFrom-Json de PowerShell 5.1 devuelve un objeto suelto cuando la lista tiene uno: se fuerza a lista
    $index.folders = @($index.folders)
    $index.vars = @($index.vars)
    $index.published = @($index.published)
    return $index
}

# Escritura atomica, como Nautilus: un corte no deja el indice a medias.
function Save-Index {
    param($Index, [string]$File)
    $json = ConvertTo-Json -InputObject $Index -Depth 10
    $tmp = "$File.tmp"
    [IO.File]::WriteAllText($tmp, $json, $Utf8NoBom)
    # PowerShell pasa $null a .NET como "": NullString es el null real (sin copia del indice anterior)
    if (Test-Path -LiteralPath $File) { [IO.File]::Replace($tmp, $File, [NullString]::Value) }
    else { [IO.File]::Move($tmp, $File) }
}

function Get-FullName {
    param([string]$Code, [string]$Short)
    if ($Code) { return "$SecretPrefix$($Code)_$Short" }
    return "$SecretPrefix$Short"
}

function Get-IndexNames {
    param($Index)
    $names = @{}
    foreach ($variable in $Index.vars) {
        $folder = $Index.folders | Where-Object { $_.id -eq $variable.folderId } | Select-Object -First 1
        $names[(Get-FullName -Code $folder.code -Short $variable.short)] = $true
    }
    return $names
}

function Resolve-Folder {
    param($Index, [string]$Name, [string]$Code)
    if (-not $Code) { return $Index.folders | Where-Object { $_.id -eq $GeneralFolderId } | Select-Object -First 1 }
    $existing = $Index.folders | Where-Object { $_.code -eq $Code } | Select-Object -First 1
    if ($existing) { return $existing }
    $usedColors = @($Index.folders | ForEach-Object { $_.color })
    $freeColor = $FolderColors | Where-Object { $usedColors -notcontains $_ } | Select-Object -First 1
    if (-not $freeColor) { $freeColor = $FolderColors[$Index.folders.Count % $FolderColors.Count] }
    $folder = [pscustomobject]@{ id = [guid]::NewGuid().ToString(); name = $Name; code = $Code; color = $freeColor }
    $Index.folders = @($Index.folders) + $folder
    return $folder
}

# ---------- Reemplazo por la referencia ----------

function Backup-File {
    param([string]$Path, [string]$BackupDir, [int]$Number)
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $target = Join-Path $BackupDir ('{0:D2}_{1}' -f $Number, (Split-Path -Leaf $Path))
    Copy-Item -LiteralPath $Path -Destination $target
    return $target
}

# Cambia solo el valor de cada clave, conservando BOM, finales de linea y el resto del archivo.
function Set-PropertiesReferences {
    param([string]$Path, [hashtable]$ReferencesByKey)
    $bytes = [IO.File]::ReadAllBytes($Path)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $text = [IO.File]::ReadAllText($Path)
    foreach ($key in $ReferencesByKey.Keys) {
        $pattern = '(?m)^([ \t]*' + [regex]::Escape($key) + '=)[^\r\n]*'
        $reference = $ReferencesByKey[$key]
        $text = [regex]::Replace($text, $pattern, { param($match) $match.Groups[1].Value + $reference }.GetNewClosure())
    }
    [IO.File]::WriteAllText($Path, $text, (New-Object System.Text.UTF8Encoding($hasBom)))
}

# ---------- Plan ----------

function Get-ImportPlan {
    param($Items, $Index)
    $known = Get-IndexNames -Index $Index
    $planned = @{}
    foreach ($item in $Items) {
        $code = [string]$item.code
        $name = Get-FullName -Code $code -Short $item.short
        $row = [pscustomobject]@{ Name = $name; Folder = $item.folder; Code = $code; Short = $item.short
                                  Source = $item.source; Replace = [bool]$item.replace; Action = ''; Value = $null }
        $read = Read-SourceValue -Source $item.source
        $row.Action = Get-ItemAction -Item $item -Name $name -Read $read -Known $known -Planned $planned
        if ($row.Action -eq 'importar') { $row.Value = $read.Value; $planned[$name] = $read.Value }
        if ($row.Action -eq 'ya esta en Nautilus' -or $row.Action -eq 'repetida en la lista') { $row.Value = $read.Value }
        $row
    }
}

function Get-ItemAction {
    param($Item, [string]$Name, $Read, $Known, $Planned)
    if ($Item.short -notmatch $ShortPattern) { return 'nombre invalido (A-Z, 0-9 y _)' }
    if ([string]$Item.code -notmatch $CodePattern) { return 'codigo de carpeta invalido (2 a 4 letras)' }
    if (-not $Read.Found) { return "no se importa: $($Read.Problem)" }
    if ($Read.Problem) { return "no se importa: $($Read.Problem)" }
    if ($Read.Value -eq '') { return 'no se importa: esta vacio' }
    if ($Read.Value.Length -gt $MaxValueChars) { return 'no se importa: supera el limite de Windows' }
    if ($Planned.ContainsKey($Name)) {
        if ($Planned[$Name] -ceq $Read.Value) { return 'repetida en la lista' }
        return 'CONFLICTO: el mismo nombre con otro valor en la lista'
    }
    if ($Known.ContainsKey($Name)) {
        if ((Read-NautilusSecret -Name $Name) -ceq $Read.Value) { return 'ya esta en Nautilus' }
        return 'CONFLICTO: ya existe en Nautilus con otro valor (no se pisa)'
    }
    return 'importar'
}

# ---------- Aplicar ----------

function Invoke-Import {
    param($Plan, $Index, [string]$IndexFile)
    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    try {
        foreach ($row in ($Plan | Where-Object { $_.Action -eq 'importar' })) {
            $folder = Resolve-Folder -Index $Index -Name $row.Folder -Code $row.Code
            if (-not [NautilusImport.Credentials]::Write($CredentialPrefix + $row.Name, $row.Name, $row.Value)) {
                throw "No se pudo guardar $($row.Name) en el Administrador de credenciales."
            }
            $variable = [pscustomobject]@{ id = [guid]::NewGuid().ToString(); folderId = $folder.id; short = $row.Short
                                           expires = $null; updatedAt = $now; hasValue = $true; publish = $false }
            $Index.vars = @($Index.vars) + $variable
            $row.Action = 'importada'
        }
    } finally {
        # si Windows rechaza una credencial a mitad, el indice igual registra las que ya quedaron guardadas
        Save-Index -Index $Index -File $IndexFile
    }
}

function Invoke-Replacements {
    param($Plan, [string]$BackupDir)
    $inNautilus = @('importada', 'ya esta en Nautilus', 'repetida en la lista')
    $rows = $Plan | Where-Object { $_.Replace -and $_.Source.type -eq 'file' -and $inNautilus -contains $_.Action }
    $number = 0
    foreach ($group in ($rows | Group-Object { $_.Source.path })) {
        $number++
        $references = @{}
        foreach ($row in $group.Group) { $references[$row.Source.key] = '${' + $row.Name + '}' }
        $copy = Backup-File -Path $group.Name -BackupDir $BackupDir -Number $number
        Set-PropertiesReferences -Path $group.Name -ReferencesByKey $references
        [pscustomobject]@{ Archivo = $group.Name; Referencias = $references.Count; Copia = $copy }
    }
}

# ---------- Principal ----------

$isRealVault = $DataDir -eq (Join-Path $env:APPDATA 'Nautilus')
if ($Apply -and $isRealVault -and (Get-Process -Name 'Nautilus' -ErrorAction SilentlyContinue)) {
    # Nautilus tiene el indice en memoria y lo guarda en cada operacion: pisaria lo importado
    Write-Output 'Cierra Nautilus antes de importar (Nautilus guarda su indice al cerrarse y pisaria lo importado).'
    exit 2
}

$items = @(([IO.File]::ReadAllText($List) | ConvertFrom-Json).items)
$indexFile = Join-Path $DataDir 'index.json'
$index = Read-Index -File $indexFile
$plan = @(Get-ImportPlan -Items $items -Index $index)

if ($Apply) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    Invoke-Import -Plan $plan -Index $index -IndexFile $indexFile
    $backupDir = Join-Path $DataDir ('importar\' + (Get-Date -Format 'yyyy-MM-dd_HHmmss'))
    $replaced = @(Invoke-Replacements -Plan $plan -BackupDir $backupDir)
}

$plan | Select-Object Name, Folder, @{ n = 'Origen'; e = { Format-Source $_.Source } }, @{ n = 'Reemplaza'; e = { if ($_.Replace) { 'si' } else { '' } } }, Action |
    Format-Table -AutoSize -Wrap | Out-String -Width 400 | Write-Output
$plan | Group-Object Action | Sort-Object Name | ForEach-Object { "{0,5}  {1}" -f $_.Count, $_.Name } | Write-Output
if ($Apply -and $replaced.Count -gt 0) {
    'Archivos con la referencia ${NAU_...} (copia antes de cambiarlos):' | Write-Output
    $replaced | Format-Table -AutoSize | Out-String -Width 400 | Write-Output
}
if (-not $Apply) { 'Vista previa: no se cambio nada. Repite con -Apply para importar.' | Write-Output }
