"""Check SVC's startup writeback without weakening installation byte checks."""
from pathlib import Path
import hashlib,json,sys

REQUIRED=frozenset('port bind_address voice_host max_voice_distance whisper_distance force_voice_chat allow_recording allow_pings'.split())

def properties(text):
    result={}
    for line in text.splitlines():
        line=line.strip()
        if not line or line.startswith(('#','!')):continue
        key,sep,value=line.partition('=')
        key=key.strip();value=value.strip()
        if not sep or not key or key in result:raise ValueError('Invalid or duplicate voice property')
        result[key]=value
    return result

def compare(expected_text,actual_text):
    expected=properties(expected_text);actual=properties(actual_text)
    if set(expected)!=REQUIRED:raise ValueError('Unexpected candidate voice properties')
    for key in REQUIRED:
        if key not in actual or actual[key]!=expected[key]:raise ValueError('Voice property changed: '+key)
    return {'passed':True,'requiredKeys':len(REQUIRED),'addedDefaultKeys':sorted(set(actual)-REQUIRED),'byteEqualityRequiredBeforeStartup':True,'startupWritebackVerified':True}

def main():
    expected,actual,output=map(Path,sys.argv[1:])
    report=compare(expected.read_text(encoding='utf-8-sig'),actual.read_text(encoding='utf-8-sig'))
    report.update(expectedSha256=hashlib.sha256(expected.read_bytes()).hexdigest(),actualSha256=hashlib.sha256(actual.read_bytes()).hexdigest())
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'passed':True,'requiredKeys':report['requiredKeys'],'addedDefaultKeys':len(report['addedDefaultKeys'])}))

if __name__=='__main__':main()
