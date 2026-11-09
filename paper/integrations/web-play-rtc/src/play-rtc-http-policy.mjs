// Exact allowlist; cookie, source proof, origin, CSRF and body ownership remain
// enforced by the existing outer gateway and application.
export const PLAY_RTC_HTTP_PATHS=Object.freeze(['/api/play/rtc/status','/api/play/rtc/offer','/api/play/rtc/receipt']);
export const isPlayRtcPath=path=>PLAY_RTC_HTTP_PATHS.includes(path);
// JSON escaping can expand the 16 KiB SDP. Other APIs retain their old budget.
export const playRtcBodyLimit=path=>path==='/api/play/rtc/offer'?65536:8192;
