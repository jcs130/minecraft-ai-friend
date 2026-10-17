import { readFile } from 'node:fs/promises';
import { startGameplayRecording, type GameplayRecordingConfig } from './recording.ts';
export async function runGameplayRecorder(configPath:string) {
  const recorder=await startGameplayRecording(JSON.parse(await readFile(configPath,'utf8')) as GameplayRecordingConfig);
  console.log(JSON.stringify(recorder.status()));
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;void recorder.stop().then(()=>process.exit(0)).catch(()=>process.exit(1));};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  return recorder;
}
