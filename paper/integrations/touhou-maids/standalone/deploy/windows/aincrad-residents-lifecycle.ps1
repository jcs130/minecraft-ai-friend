function Ensure-AincradResidentServices {
    $runtime='E:/MC/runtime/aincrad-residents-0.3.0-20261116'
    $privateRoot='E:/MC/private/aincrad-residents'
    $shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
    $result=[ordered]@{}
    foreach($role in @('gateway','memory')) {
        $script=Join-Path $runtime ('start-'+$role+'.ps1')
        $expected=if($role -eq 'gateway'){'164c635993d5c3e66150b5460beac6d8655776e82b5d720047941c460ed35b40'}else{'56be2ab19409c5e1b90e0861b6a109d0c564e3249df59df15f73ddea04494683'}
        if((Get-FileHash -LiteralPath $script).Hash.ToLowerInvariant() -cne $expected){throw 'Resident startup source changed'}
        $needle=if($role -eq 'gateway'){'E:/MC/runtime/aincrad-residents-0.3.0-20261116/gateway/dsh_gateway.py'}else{'E:/MC/runtime/aincrad-residents-0.3.0-20261116/companion-memory.mjs'}
        $image=if($role -eq 'gateway'){'python.exe'}else{'node.exe'}
        $rows=@(Get-CimInstance Win32_Process -Filter ("Name='"+$image+"'") | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($needle)})
        if($rows.Count -gt 1){throw 'Duplicate resident worker; inspect original processes'}
        if($rows.Count -eq 0){
            if($role -eq 'gateway' -and (Get-NetTCPConnection -State Listen -LocalPort 19105 -ErrorAction SilentlyContinue)){throw 'Resident gateway port is owned by another process'}
            if($role -eq 'memory' -and (Test-Path -LiteralPath (Join-Path $privateRoot 'memory/companion-sync.lock'))){throw 'Resident memory writer lock needs original-request reconciliation'}
            $argsForResident=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$script)
            $p=Start-IndependentProcess -FilePath $shell -ArgumentList $argsForResident -WorkingDirectory $runtime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateRoot ($role+'.launcher.out.log')) -RedirectStandardError (Join-Path $privateRoot ($role+'.launcher.err.log')) -PassThru
            $until=(Get-Date).AddSeconds(15)
            do {
                Start-Sleep -Milliseconds 300
                $rows=@(Get-CimInstance Win32_Process -Filter ("Name='"+$image+"'") | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($needle)})
                if($p.HasExited -and $rows.Count -eq 0){throw 'Resident worker exited during startup'}
            }while($rows.Count -eq 0 -and (Get-Date) -lt $until)
            if($rows.Count -ne 1){throw 'Resident worker did not become unique and ready'}
        }
        $result[$role+'Pid']=[int]$rows[0].ProcessId
        if($role -eq 'gateway'){
            $until=(Get-Date).AddSeconds(12);$ready=$false
            do {
                try{
                    $health=Invoke-RestMethod -Uri 'http://127.0.0.1:19105/health' -TimeoutSec 2
                    $listener=@(Get-NetTCPConnection -State Listen -LocalPort 19105 -ErrorAction Stop)
                    $ready=$health.ready -eq $true -and $health.kind -ceq 'maid-harness-gateway' -and $listener.Count -eq 1 -and $listener[0].LocalAddress -ceq '127.0.0.1' -and $listener[0].OwningProcess -eq $rows[0].ProcessId
                }catch{}
                if(-not$ready){Start-Sleep -Milliseconds 300}
            }while(-not$ready -and (Get-Date) -lt $until)
            if(-not$ready){throw 'Resident gateway health did not verify'}
        }
    }
    return [pscustomobject]$result
}
