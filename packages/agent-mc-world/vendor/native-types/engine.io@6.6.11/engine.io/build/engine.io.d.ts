import { Server as HttpServer } from "http";
import { Server, AttachOptions, ServerOptions } from "./server.js";
import transports from "./transports/index.js";
import * as parser from "../../../engine.io-parser@5.2.3/engine.io-parser/build/cjs/index.js";
export { Server, transports, listen, attach, parser };
export type { AttachOptions, ServerOptions, BaseServer, ErrorCallback, } from "./server.js";
export { uServer } from "./userver.js";
export { Socket } from "./socket.js";
export { Transport } from "./transport.js";
export declare const protocol = 4;
/**
 * Creates an http.Server exclusively used for WS upgrades, and starts listening.
 *
 * @param port
 * @param options
 * @param listenCallback - callback for http.Server.listen()
 * @return engine.io server
 */
declare function listen(port: number, options?: AttachOptions & ServerOptions, listenCallback?: () => void): Server;
/**
 * Captures upgrade requests for a http.Server.
 *
 * @param server
 * @param options
 * @return engine.io server
 */
declare function attach(server: HttpServer, options: AttachOptions & ServerOptions): Server;
