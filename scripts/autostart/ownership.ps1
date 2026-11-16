# Inspect command lines only, never process environment values.
function Assert-NoExistingBot($Processes, [string]$Entry) {
    foreach ($p in @($Processes)) {
        if (!$p.CommandLine) { throw 'Node ownership ambiguous: command line unavailable.' }
        $cmd = $p.CommandLine.Replace('/','\')
        if ($cmd.IndexOf($Entry,[StringComparison]::OrdinalIgnoreCase) -ge 0) { throw 'A bot from this repository already exists; refusing duplicate.' }
        if ($cmd -match '(?i)(?:\s|"|'')(?:\.\\)?src\\index\.js') { throw 'Node ownership ambiguous: relative src/index.js invocation.' }
    }
}
