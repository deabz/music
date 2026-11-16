# Inspect command lines only, never process environment values.
function Assert-NoExistingBot($Processes, [string]$Entry) {
    foreach ($p in @($Processes)) {
        if (!$p.CommandLine) { throw 'Node ownership ambiguous: command line unavailable.' }
        $cmd = $p.CommandLine.Replace('/','\')
        if ($cmd.IndexOf($Entry,[StringComparison]::OrdinalIgnoreCase) -ge 0) { throw 'A bot from this repository already exists; refusing duplicate.' }
        if ($cmd -match '(?i)(?:\s|"|'')(?:\.\\)?src\\index\.js') { throw 'Node ownership ambiguous: relative src/index.js invocation.' }
        # A relative entry point, eval or package-directory launch has no reliable
        # working directory in Win32_Process. Only clearly rooted other scripts
        # can be classified as unrelated without guessing.
        if ($cmd -notmatch '(?i)(?:[A-Z]:\\|\\\\)[^\r\n]*\.(?:js|cjs|mjs)(?:\s|"|''|$)') {
            throw 'Node ownership ambiguous: no explicit absolute script path.'
        }
    }
}
