import {command} from './rcon-client.mjs';
// Empty, correctly framed command replies are valid (e.g. no matching Numen
// bodies). Authentication/transport failure remains a nonzero exit, never [].
if(process.argv.length!==3||!process.argv[2]){
    console.error('Usage: node rcon-command.mjs <one console command>');process.exitCode=2;
}else try{process.stdout.write(await command(process.argv[2],15000));}
catch(error){console.error('RCON failed: '+error.message);process.exitCode=1;}
