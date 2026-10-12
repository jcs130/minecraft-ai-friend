/** Install immediately after createBot, before starting tasks or photo hooks.
 * The limbo has a spawn event too: spawn alone does not prove authentication.
 * Supply password from that account's environment; never log chat commands. */
export function installLoginGate(bot, {password, timeoutMs=135000, automaticLoginGraceMs=10000, log=()=>{}}={}) {
  let sent=false, settled=false, authenticated=false, resolve, reject;
  const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const timer=setTimeout(()=>fail('AUTH_TIMEOUT'),timeoutMs); timer.unref?.();
  let sendTimer;
  function cleanup(){clearTimeout(timer);clearTimeout(sendTimer);bot.off('messagestr',message);bot.off('end',end);}
  function fail(code){if(settled)return;settled=true;cleanup();log(code);reject(Error(code));try{bot.quit('登录验证失败');}catch{}}
  function end(){fail('AUTH_DISCONNECTED');}
  function message(raw){
    const s=String(raw).replace(/§[0-9a-fk-or]/gi,'').trim();
    if(/^\[MC_AUTH_SUCCESS\] 登录成功，可以开始游戏。$/.test(s)) {
      if(settled)return;settled=true;authenticated=true;cleanup();log('AUTH_READY');resolve();return;
    }
    if(/^\[MC_AUTH_LOGIN\]/.test(s)) {
      if(sent)return;
      if(typeof password!=='string'||!password||/[\s\x00-\x1f]/.test(password)) {
        // A paired Eye can briefly receive the limbo prompt before the server
        // authorizes it. Wait for the exact success marker; never send a blank
        // password or treat a spawn / Eye hint as successful authentication.
        if(!sendTimer)sendTimer=setTimeout(()=>fail('AUTH_PASSWORD_MISSING'),automaticLoginGraceMs);
        return;
      }
      sent=true;
      // The proxy may emit its first prompt while completing the limbo switch.
      // Give that switch one brief turn to finish, then submit exactly once.
      sendTimer=setTimeout(()=>{try{bot.chat(`/login ${password}`);}catch{fail('AUTH_SEND_FAILED');}},500);
    } else if(/^\[MC_AUTH_REGISTER\]/.test(s)) {
      // A new account (including a paired Eye) can briefly receive REGISTER.
      // The owner permits first entry before password setup. Only the server's
      // exact success marker opens the task gate; never register a shared secret.
      if(!sendTimer)sendTimer=setTimeout(()=>fail('AUTH_PASSWORD_MISSING'),automaticLoginGraceMs);
    } else if(/^\[MC_AUTH_(?:WRONG|LOCKED|UNAVAILABLE|DENIED)\]/.test(s)) fail('AUTH_REJECTED');
  }
  bot.on('messagestr',message);bot.once('end',end);
  return {ready,get authenticated(){return authenticated;}};
}
