param([Parameter(Mandatory=$true)][string]$SourceArchive,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
$resolvedTarget=[IO.Path]::GetFullPath($Target)
if(Test-Path -LiteralPath $resolvedTarget){throw 'Choose a fresh baseline directory'}
Expand-Archive -LiteralPath $SourceArchive -DestinationPath $resolvedTarget
