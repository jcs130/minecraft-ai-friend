$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$taskCases=@(
    @('AgentFriend-0.4.47.jar',$true),
    @('AgentFriend-0.4.47.3.jar',$true),
    @('AgentFriend-0.4.47.4.jar',$true),
    @('CortiEyeMirror-0.1.16.jar',$true),
    @('CortiEyeMirror-0.1.16.1.jar',$true),
    @('OtherPlugin-0.4.47.3.jar',$false),
    @('../AgentFriend-0.4.47.3.jar',$false),
    @('AgentFriend-0.4.47.3.jar.disabled',$false),
    @('AgentFriend-0.4.47.3.1.jar',$false),
    @('AgentFriend-0.4.47-beta.jar',$false),
    @('AgentFriend-0.4.jar',$false),
    @('AgentFriend-0.4.47.3.jar/elsewhere',$false)
)
foreach($taskCase in $taskCases){
    if((Content-FirstPartyPreviousJar $taskCase[0]) -ne $taskCase[1]){throw ('Unexpected previous JAR validation: '+$taskCase[0])}
}
Write-Output ('Content deployment versions: '+$taskCases.Count+' cases passed; no files installed')
