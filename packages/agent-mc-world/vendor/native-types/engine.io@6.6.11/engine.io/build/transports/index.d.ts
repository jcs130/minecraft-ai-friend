import { Polling as XHR } from "./polling.js";
import { WebSocket } from "./websocket.js";
import { WebTransport } from "./webtransport.js";
import type { EngineRequest } from "../transport.js";
declare const _default: {
    polling: typeof polling;
    websocket: typeof WebSocket;
    webtransport: typeof WebTransport;
};
export default _default;
/**
 * Polling polymorphic constructor.
 */
declare function polling(req: EngineRequest): XHR;
declare namespace polling {
    var upgradesTo: string[];
}
