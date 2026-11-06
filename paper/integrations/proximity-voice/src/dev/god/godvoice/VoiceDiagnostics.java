package dev.god.godvoice;

import java.net.ConnectException;
import java.net.http.HttpTimeoutException;

/** Stable public codes and useful next steps; never expose backend bodies or credentials. */
final class VoiceDiagnostics {
    static String preparationFailure(String stage,Exception failure){
        if(failure instanceof ConnectException)return "VOICE_MEDIA_UNREACHABLE";
        if(failure instanceof HttpTimeoutException)return "VOICE_MEDIA_TIMEOUT";
        if(failure instanceof InterruptedException)return "VOICE_PREPARATION_INTERRUPTED";
        if(failure instanceof BackendFailure rejected)return rejected.code;
        return stage.equals("decode")?"VOICE_NORMALIZED_AUDIO_INVALID":"VOICE_AUDIO_PREPARATION_FAILED";
    }
    static final class BackendFailure extends java.io.IOException {
        final String code;
        BackendFailure(String code){super(code);this.code=code;}
    }
    static String connection(boolean ready,boolean installed,boolean connected,boolean disabled,boolean canListen,boolean isolated){
        if(!ready)return "VOICE_SERVER_STARTING";
        if(!installed)return "VOICE_CLIENT_NOT_INSTALLED";
        if(!connected)return "VOICE_CLIENT_NOT_CONNECTED";
        if(disabled)return "VOICE_CLIENT_DISABLED";
        if(!canListen)return "VOICE_LISTEN_PERMISSION_MISSING";
        if(isolated)return "VOICE_ISOLATED_GROUP";
        return "VOICE_RECEIVER_READY";
    }
    static String hint(String code){return switch(code){
        case "VOICE_MEDIA_UNREACHABLE","VOICE_BACKEND_UNAVAILABLE"->"服务端音频准备服务未连接，请联系服主检查语音媒体服务；不要反复重发。";
        case "VOICE_MEDIA_TIMEOUT"->"服务端音频准备超时；先查询原请求，不要换编号重播。";
        case "VOICE_MEDIA_AUTH_REJECTED"->"服务端语音桥认证配置不一致，请服主检查内部配置；无需提供玩家密码。";
        case "VOICE_MEDIA_BUSY"->"服务端音频准备繁忙，本请求未进入播放；稍后检查服务健康。";
        case "VOICE_AUDIO_INPUT_REJECTED"->"音频未进入播放。使用 PCM16 WAV，单或双声道，8–96 kHz，0.1–30 秒，最大 4 MiB；不要只改文件后缀。";
        case "VOICE_NORMALIZED_AUDIO_INVALID","VOICE_AUDIO_TOO_LARGE"->"媒体服务返回的音频不符合播放格式，尚未播放；请服主检查归一化服务应返回 48 kHz、单声道、PCM16 WAV。";
        case "VOICE_CLIENT_NOT_INSTALLED"->"听音需安装匹配游戏版本的 Simple Voice Chat；原版、基岩和未装语音模组的 Agent 仍可正常游戏。Agent 上传语音不要求自身安装收听模组。";
        case "VOICE_BRIDGE_CONNECTED"->"Agent 已连接服务器语音桥：上传音频由服务器播放，附近语音通过字幕接收；这不表示已安装原生语音模组，也不是客户端实际听到的证明。";
        case "VOICE_CLIENT_NOT_CONNECTED"->"打开客户端语音设置检查连接；服主核对独立 UDP 24454 的连通性。游戏登录成功不代表语音已连接。";
        case "VOICE_CLIENT_DISABLED"->"在客户端完成 Simple Voice Chat 首次设置并开启收听；麦克风可以保持静音，无需开启录音。";
        case "VOICE_LISTEN_PERMISSION_MISSING"->"请服主检查 voicechat.listen 权限。";
        case "VOICE_ISOLATED_GROUP"->"当前处于隔离语音小组，请退出隔离小组再听附近语音。";
        case "VOICE_NO_RECEIVER_CHECK_STATUS"->"音频处理结束，但未观察到向可用接收端的发送。收听者先用 /voice status，确认同维度、在附近、语音已连接且开启；观战还需跟随目标。不要重播原编号。";
        case "VOICE_SENT_HEARING_UNVERIFIED"->"已观察到服务端发送事件，仍需客户端确认音量、声源实体已加载及实际听感；这不是收听成功证明。";
        case "VOICE_RECEIVER_READY"->"收听连接就绪；还需与说话者同维度并在语音距离内，客户端加载声源实体并开启输出音量。";
        case "VOICE_SERVER_STARTING"->"语音服务尚未就绪，稍后用 /voice status 检查。";
        default->"查询原请求：/voice status <请求ID>；结果未知时不要更换编号重播。";
    };}
}
