param(
    [Parameter(Mandatory = $true)]
    [string]$LocalizedExe,
    [Parameter(Mandatory = $true)]
    [string]$ReferenceExe,
    [string]$OutputDir = ".\tmp\translation-audit\audit"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ("Win32ResourceAudit" -as [type])) {
    $typeDefinition = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class Win32ResourceAudit
{
    private const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
    private const int RT_DIALOG = 5;
    private static readonly IntPtr RT_STRING = (IntPtr)6;
    private const uint DS_SETFONT = 0x00000040;
    private const int ERROR_RESOURCE_TYPE_NOT_FOUND = 1813;
    private const int ERROR_RESOURCE_NAME_NOT_FOUND = 1814;

    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
    private delegate bool EnumResNameProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, IntPtr lParam);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hLibModule);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EnumResourceNames(IntPtr hModule, IntPtr lpszType, EnumResNameProc lpEnumFunc, IntPtr lParam);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr FindResource(IntPtr hModule, IntPtr lpName, IntPtr lpType);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LoadResource(IntPtr hModule, IntPtr hResInfo);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LockResource(IntPtr hResData);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SizeofResource(IntPtr hModule, IntPtr hResInfo);

    public sealed class StringEntry
    {
        public int BlockId { get; set; }
        public int Slot { get; set; }
        public int ResourceId { get; set; }
        public string Text { get; set; }
    }

    public sealed class DialogControl
    {
        public int Index { get; set; }
        public uint Id { get; set; }
        public string Title { get; set; }
    }

    public sealed class DialogEntry
    {
        public int DialogId { get; set; }
        public string Caption { get; set; }
        public List<DialogControl> Controls { get; set; }
    }

    private sealed class Cursor
    {
        private readonly byte[] _data;
        public int Offset;

        public Cursor(byte[] data)
        {
            _data = data;
        }

        public ushort ReadUInt16()
        {
            ushort value = BitConverter.ToUInt16(_data, Offset);
            Offset += 2;
            return value;
        }

        public short ReadInt16()
        {
            short value = BitConverter.ToInt16(_data, Offset);
            Offset += 2;
            return value;
        }

        public uint ReadUInt32()
        {
            uint value = BitConverter.ToUInt32(_data, Offset);
            Offset += 4;
            return value;
        }

        public byte ReadByte()
        {
            byte value = _data[Offset];
            Offset += 1;
            return value;
        }

        public void AlignDword()
        {
            Offset = (Offset + 3) & ~3;
        }

        public string ReadSzString()
        {
            int start = Offset;
            while (Offset + 1 < _data.Length)
            {
                if (_data[Offset] == 0 && _data[Offset + 1] == 0)
                {
                    string text = Encoding.Unicode.GetString(_data, start, Offset - start);
                    Offset += 2;
                    return text;
                }
                Offset += 2;
            }
            return string.Empty;
        }

        public string ReadOrdOrString()
        {
            ushort marker = ReadUInt16();
            if (marker == 0x0000)
            {
                return string.Empty;
            }
            if (marker == 0xFFFF)
            {
                ushort ordinal = ReadUInt16();
                return "#" + ordinal.ToString();
            }
            Offset -= 2;
            return ReadSzString();
        }
    }

    private static int IdFromIntPtr(IntPtr value)
    {
        return unchecked((int)(value.ToInt64() & 0xFFFF));
    }

    private static byte[] LoadResourceBytes(IntPtr module, IntPtr name, IntPtr type)
    {
        IntPtr resInfo = FindResource(module, name, type);
        if (resInfo == IntPtr.Zero)
        {
            return null;
        }

        uint size = SizeofResource(module, resInfo);
        IntPtr resData = LoadResource(module, resInfo);
        IntPtr resPtr = LockResource(resData);
        if (resPtr == IntPtr.Zero || size == 0)
        {
            return null;
        }

        byte[] raw = new byte[size];
        Marshal.Copy(resPtr, raw, 0, raw.Length);
        return raw;
    }

    private static List<int> EnumerateResourceIds(IntPtr module, IntPtr type, string label)
    {
        var ids = new List<int>();
        EnumResNameProc callback = delegate(IntPtr h, IntPtr resourceType, IntPtr name, IntPtr lParam)
        {
            ids.Add(IdFromIntPtr(name));
            return true;
        };

        if (!EnumResourceNames(module, type, callback, IntPtr.Zero))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == ERROR_RESOURCE_TYPE_NOT_FOUND || error == ERROR_RESOURCE_NAME_NOT_FOUND)
            {
                return ids;
            }

            throw new System.ComponentModel.Win32Exception(error, "EnumResourceNames failed for " + label);
        }

        ids.Sort();
        return ids;
    }

    public static List<StringEntry> ReadStringTable(string path)
    {
        var entries = new List<StringEntry>();
        IntPtr module = LoadLibraryEx(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (module == IntPtr.Zero)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "LoadLibraryEx failed");
        }

        try
        {
            var blockIds = EnumerateResourceIds(module, RT_STRING, "string table");
            foreach (int blockId in blockIds)
            {
                byte[] raw = LoadResourceBytes(module, (IntPtr)blockId, RT_STRING);
                if (raw == null)
                {
                    continue;
                }

                int offset = 0;
                for (int slot = 0; slot < 16 && offset + 2 <= raw.Length; slot++)
                {
                    ushort length = BitConverter.ToUInt16(raw, offset);
                    offset += 2;
                    int byteCount = length * 2;
                    if (offset + byteCount > raw.Length)
                    {
                        break;
                    }

                    string text = byteCount == 0 ? string.Empty : Encoding.Unicode.GetString(raw, offset, byteCount);
                    offset += byteCount;

                    if (!string.IsNullOrEmpty(text))
                    {
                        entries.Add(new StringEntry
                        {
                            BlockId = blockId,
                            Slot = slot,
                            ResourceId = ((blockId - 1) * 16) + slot,
                            Text = text
                        });
                    }
                }
            }

            return entries;
        }
        finally
        {
            FreeLibrary(module);
        }
    }

    public static List<DialogEntry> ReadDialogs(string path)
    {
        IntPtr module = LoadLibraryEx(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (module == IntPtr.Zero)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "LoadLibraryEx failed");
        }

        try
        {
            var dialogIds = EnumerateResourceIds(module, (IntPtr)RT_DIALOG, "dialogs");
            var results = new List<DialogEntry>();
            foreach (int dialogId in dialogIds)
            {
                byte[] raw = LoadResourceBytes(module, (IntPtr)dialogId, (IntPtr)RT_DIALOG);
                if (raw != null)
                {
                    results.Add(ParseDialog(dialogId, raw));
                }
            }

            return results;
        }
        finally
        {
            FreeLibrary(module);
        }
    }

    private static DialogEntry ParseDialog(int dialogId, byte[] raw)
    {
        Cursor cursor = new Cursor(raw);
        ushort first = BitConverter.ToUInt16(raw, 0);
        ushort second = BitConverter.ToUInt16(raw, 2);
        bool extended = first == 1 && second == 0xFFFF;
        uint style;
        ushort itemCount;

        if (extended)
        {
            cursor.ReadUInt16();
            cursor.ReadUInt16();
            cursor.ReadUInt32();
            cursor.ReadUInt32();
            style = cursor.ReadUInt32();
            itemCount = cursor.ReadUInt16();
            cursor.ReadInt16();
            cursor.ReadInt16();
            cursor.ReadInt16();
            cursor.ReadInt16();
        }
        else
        {
            style = cursor.ReadUInt32();
            cursor.ReadUInt32();
            itemCount = cursor.ReadUInt16();
            cursor.ReadInt16();
            cursor.ReadInt16();
            cursor.ReadInt16();
            cursor.ReadInt16();
        }

        cursor.ReadOrdOrString();
        cursor.ReadOrdOrString();
        string caption = cursor.ReadSzString();

        if ((style & DS_SETFONT) != 0)
        {
            cursor.ReadUInt16();
            if (extended)
            {
                cursor.ReadUInt16();
                cursor.ReadByte();
                cursor.ReadByte();
            }
            cursor.ReadSzString();
        }

        var entry = new DialogEntry();
        entry.DialogId = dialogId;
        entry.Caption = caption;
        entry.Controls = new List<DialogControl>();

        for (int i = 0; i < itemCount; i++)
        {
            cursor.AlignDword();
            uint controlId;
            if (extended)
            {
                cursor.ReadUInt32();
                cursor.ReadUInt32();
                cursor.ReadUInt32();
                cursor.ReadInt16();
                cursor.ReadInt16();
                cursor.ReadInt16();
                cursor.ReadInt16();
                controlId = cursor.ReadUInt32();
            }
            else
            {
                cursor.ReadUInt32();
                cursor.ReadUInt32();
                cursor.ReadInt16();
                cursor.ReadInt16();
                cursor.ReadInt16();
                cursor.ReadInt16();
                controlId = cursor.ReadUInt16();
            }

            cursor.ReadOrdOrString();
            string title = cursor.ReadOrdOrString();
            ushort extraCount = cursor.ReadUInt16();
            cursor.Offset += extraCount;

            if (!string.IsNullOrEmpty(title) && !title.StartsWith("#"))
            {
                entry.Controls.Add(new DialogControl
                {
                    Index = entry.Controls.Count,
                    Id = controlId,
                    Title = title
                });
            }
        }

        return entry;
    }
}
"@

    Add-Type -TypeDefinition $typeDefinition
}

function Get-Flags {
    param(
        [AllowNull()]
        [string]$ReferenceText,
        [AllowNull()]
        [string]$LocalizedText
    )

    $flags = [System.Collections.Generic.List[string]]::new()
    $ref = if ($ReferenceText) { $ReferenceText.Trim() } else { "" }
    $loc = if ($LocalizedText) { $LocalizedText.Trim() } else { "" }

    if ($loc -eq "placeholder") {
        $flags.Add("placeholder")
    }

    if ($ref -and -not $loc) {
        $flags.Add("missing_translation")
    }

    if ($ref -match "^[Yy]\s*:?$" -and $loc -match "^是[:：]?$") {
        $flags.Add("coordinate_confusion")
    }

    if ($ref -match "[A-Za-z]{3,}" -and $loc -ceq $ref) {
        $flags.Add("untranslated_same_as_english")
    }

    $acronyms = [regex]::Matches($ref, "\b[A-Z]{2,}\b") | ForEach-Object { $_.Value } | Select-Object -Unique
    foreach ($acronym in $acronyms) {
        if ($loc -and $loc -notmatch "(?<![A-Za-z])$([regex]::Escape($acronym))(?![A-Za-z])") {
            $flags.Add("missing_acronym:$acronym")
        }
    }

    if ($loc -match "[A-Za-z]{3,}" -and $loc -notmatch "\b(?:AHS|CVF|DVF|WPC|TRNSYS|CONTAM|SketchPad)\b") {
        $flags.Add("latin_text_left")
    }

    ($flags | Select-Object -Unique) -join ";"
}

$localizedPath = (Resolve-Path $LocalizedExe).Path
$referencePath = (Resolve-Path $ReferenceExe).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDir))
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$localizedStrings = [Win32ResourceAudit]::ReadStringTable($localizedPath)
$referenceStrings = [Win32ResourceAudit]::ReadStringTable($referencePath)
$localizedDialogs = [Win32ResourceAudit]::ReadDialogs($localizedPath)
$referenceDialogs = [Win32ResourceAudit]::ReadDialogs($referencePath)

$localizedStrings | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $outputPath "localized-stringtable.json") -Encoding UTF8
$referenceStrings | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $outputPath "reference-stringtable.json") -Encoding UTF8
$localizedDialogs | ConvertTo-Json -Depth 7 | Set-Content -Path (Join-Path $outputPath "localized-dialogs.json") -Encoding UTF8
$referenceDialogs | ConvertTo-Json -Depth 7 | Set-Content -Path (Join-Path $outputPath "reference-dialogs.json") -Encoding UTF8

$auditRows = [System.Collections.Generic.List[object]]::new()

$refStringMap = @{}
foreach ($entry in $referenceStrings) {
    $refStringMap[$entry.ResourceId] = $entry
}
$locStringMap = @{}
foreach ($entry in $localizedStrings) {
    $locStringMap[$entry.ResourceId] = $entry
}

$stringIds = @($refStringMap.Keys + $locStringMap.Keys | Sort-Object -Unique)
foreach ($id in $stringIds) {
    $refText = if ($refStringMap.ContainsKey($id)) { $refStringMap[$id].Text } else { "" }
    $locText = if ($locStringMap.ContainsKey($id)) { $locStringMap[$id].Text } else { "" }
    $auditRows.Add([PSCustomObject]@{
        Category = "StringTable"
        DialogId = ""
        ControlIndex = ""
        ControlId = ""
        ResourceId = $id
        ReferenceText = $refText
        LocalizedText = $locText
        Flags = Get-Flags -ReferenceText $refText -LocalizedText $locText
    })
}

$refDialogMap = @{}
foreach ($dialog in $referenceDialogs) {
    $refDialogMap[$dialog.DialogId] = $dialog
}
$locDialogMap = @{}
foreach ($dialog in $localizedDialogs) {
    $locDialogMap[$dialog.DialogId] = $dialog
}

$dialogIds = @($refDialogMap.Keys + $locDialogMap.Keys | Sort-Object -Unique)
foreach ($dialogId in $dialogIds) {
    $refDialog = $refDialogMap[$dialogId]
    $locDialog = $locDialogMap[$dialogId]

    $refCaption = if ($refDialog) { $refDialog.Caption } else { "" }
    $locCaption = if ($locDialog) { $locDialog.Caption } else { "" }

    $auditRows.Add([PSCustomObject]@{
        Category = "DialogCaption"
        DialogId = $dialogId
        ControlIndex = ""
        ControlId = ""
        ResourceId = ""
        ReferenceText = $refCaption
        LocalizedText = $locCaption
        Flags = Get-Flags -ReferenceText $refCaption -LocalizedText $locCaption
    })

    $refControls = if ($refDialog) { @($refDialog.Controls) } else { @() }
    $locControls = if ($locDialog) { @($locDialog.Controls) } else { @() }
    $maxCount = [Math]::Max(@($refControls).Count, @($locControls).Count)

    for ($i = 0; $i -lt $maxCount; $i++) {
        $refControl = if ($i -lt @($refControls).Count) { @($refControls)[$i] } else { $null }
        $locControl = if ($i -lt @($locControls).Count) { @($locControls)[$i] } else { $null }
        $refText = if ($refControl) { $refControl.Title } else { "" }
        $locText = if ($locControl) { $locControl.Title } else { "" }
        $controlId = if ($locControl) { $locControl.Id } elseif ($refControl) { $refControl.Id } else { "" }

        $auditRows.Add([PSCustomObject]@{
            Category = "DialogControl"
            DialogId = $dialogId
            ControlIndex = $i
            ControlId = $controlId
            ResourceId = ""
            ReferenceText = $refText
            LocalizedText = $locText
            Flags = Get-Flags -ReferenceText $refText -LocalizedText $locText
        })
    }
}

$auditRows | Export-Csv -Path (Join-Path $outputPath "translation-audit.csv") -NoTypeInformation -Encoding UTF8
$auditRows | Where-Object { $_.Flags } | Export-Csv -Path (Join-Path $outputPath "translation-flags.csv") -NoTypeInformation -Encoding UTF8

[PSCustomObject]@{
    OutputDir = $outputPath
    StringEntriesLocalized = @($localizedStrings).Count
    StringEntriesReference = @($referenceStrings).Count
    DialogsLocalized = @($localizedDialogs).Count
    DialogsReference = @($referenceDialogs).Count
    FlaggedRows = @($auditRows | Where-Object { $_.Flags }).Count
}
