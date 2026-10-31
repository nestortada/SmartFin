# Parser only: input is never dot-sourced, invoked or passed to a shell.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-LiteralValue($Element) {
  if ($Element -is [System.Management.Automation.Language.StringConstantExpressionAst] -or
      $Element -is [System.Management.Automation.Language.ConstantExpressionAst]) {
    return [string]$Element.Value
  }
  if ($Element -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
      $Element.NestedExpressions.Count -eq 0) { return $Element.Value }
  return $null
}

try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.command -isnot [string] -or $request.command.Length -gt 131072) { throw 'Invalid input' }
  $tokens = $null
  $parseErrors = $null
  $tree = [System.Management.Automation.Language.Parser]::ParseInput($request.command, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count -gt 0) { throw 'Invalid syntax' }
  $commands = @($tree.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.CommandAst]
  }, $true) | Sort-Object { $_.Extent.StartOffset } | ForEach-Object {
    $elements = $_.CommandElements
    $arguments = @(for ($index = 1; $index -lt $elements.Count; $index++) {
      $element = $elements[$index]
      if ($element -is [System.Management.Automation.Language.CommandParameterAst]) {
        '-' + $element.ParameterName
        if ($null -ne $element.Argument) { Get-LiteralValue $element.Argument }
      } else { Get-LiteralValue $element }
    })
    [PSCustomObject]@{ name = (Get-LiteralValue $elements[0]); args = $arguments }
  })
  $redirects = @($tree.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FileRedirectionAst]
  }, $true) | ForEach-Object {
    if ($_.Location.Extent.Text -eq '$null') { @{ discard = $true } } else { Get-LiteralValue $_.Location }
  })
  $opaque = @($tree.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -or
    ($node -is [System.Management.Automation.Language.CommandAst] -and
      $node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot)
  }, $true)).Count -gt 0
  [PSCustomObject]@{ commands = $commands; redirects = $redirects; opaque = $opaque } |
    ConvertTo-Json -Depth 12 -Compress
} catch {
  # Never echo the source command or parser exceptions (they can contain secrets).
  [Console]::Out.Write('{"error":"DG-PARSE: PowerShell input could not be parsed"}')
  exit 0
}
