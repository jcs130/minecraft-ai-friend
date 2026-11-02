param([string]$Path,[string]$Stop)
$ErrorActionPreference='Stop'
$deadline=[DateTime]::UtcNow.AddSeconds(45)
while([DateTime]::UtcNow -lt $deadline -and -not [IO.File]::Exists($Stop)){
 [IO.File]::AppendAllText($Path,"$PID $([DateTime]::UtcNow.Ticks) env=$($env:QD_TEST_INHERIT -eq 'fixture only')`n")
 Start-Sleep -Milliseconds 150
}
