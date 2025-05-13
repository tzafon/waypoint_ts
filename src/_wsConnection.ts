import WebSocket from "ws";
import { type Command, Result } from "./models.js";

export class _WsConnection {
    private url: string;
    private pingInterval: number;
    private conn?: WebSocket;

    constructor(url: string, pingInterval = 20_000) {
        if (!/^wss?:\/\//.test(url)) {
            throw new Error(`Invalid websocket URL '${url}'`);
        }
        this.url = url;
        this.pingInterval = pingInterval;
    }

    async connect(): Promise<void> {
        if (this.isOpen) return;
        this.conn = new WebSocket(this.url, {
            maxPayload: 2 ** 24, // 16 MiB
            handshakeTimeout: this.pingInterval
        });

        await new Promise<void>((res, rej) => {
            this.conn?.once("open", res).once("error", rej);
        });
    }

    async close(graceMs = 5000): Promise<void> {
        if (!this.isOpen) return;

        // send CLOSE
        this.conn?.close(1000, "Client shutting down");

        await new Promise<void>((resolve) => {
            const done = () => {
                clearTimeout(timer);
                this.conn?.off("close", done);
                this.conn?.removeAllListeners();
                this.conn = undefined; // nullify connection reference
                resolve();
            };

            this.conn?.once("close", done);

            const timer = setTimeout(() => {
                this.conn?.terminate(); // no echo in time
                done();
            }, graceMs).unref();
        });
    }

    async send(cmd: Command): Promise<Result> {
        if (!this.isOpen) throw new Error("Websocket not connected");
        if (!this.conn) throw new Error("Websocket connection is not available");
        const conn = this.conn;

        const reply = await new Promise<Buffer | string>((resolve, reject) => {
            const handle = (data: Buffer | string) => {
                clearTimeout(timer);
                conn.off("message", handle);
                resolve(data);
            };
            conn.on("message", handle);

            const timer = setTimeout(
                () => reject(
                    new Error(
                        `Timed out after ${cmd.timeout} ms waiting for ${cmd.action_type}`
                    )
                ),
                cmd.timeout
            );

            conn.send(cmd.dump());
        });

        return Result.load(reply);
    }

    get isOpen(): boolean {
        return this.conn?.readyState === WebSocket.OPEN;
    }
}
