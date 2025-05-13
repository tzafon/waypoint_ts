import { Command, type Result, ActionType } from "./models.js";
import { _WsConnection } from "./_wsConnection.js";
import { ScreenshotFailed } from "./exceptions.js";
import type { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";

const _DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export class Waypoint {
    private wsUrl: string;
    private timeout: number;
    private ws?: _WsConnection;

    constructor(
        token: string,
        {
            urlTemplate = "wss://api.tzafon.ai/ephemeral-tzafonwright?token={token}",
            connectTimeout = 10_000
        }: { urlTemplate?: string; connectTimeout?: number } = {}
    ) {
        if (!token || !token.startsWith("wpk_")) {
            throw new Error("token must look like 'wpk_…'");
        }
        this.wsUrl = urlTemplate.replace("{token}", token);
        this.timeout = connectTimeout;
    }

    async connect(): Promise<void> {
        this.ws = new _WsConnection(this.wsUrl);
        await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() =>
                reject(new Error("Connection timed out")),
                this.timeout
            );

            if (!this.ws) {
                clearTimeout(timeoutId);
                reject(new Error("WebSocket connection is not available"));
                return;
            }

            this.ws.connect()
                .then(() => {
                    clearTimeout(timeoutId);
                    resolve();
                })
                .catch((err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                });
        });
        await this.setViewport(_DEFAULT_VIEWPORT);
    }

    async close(): Promise<void> {
        await this.ws?.close();
        this.ws = undefined;
    }


    // Public commands
    goto(url: string, timeout = 5000): Promise<Result> {
        return this._send(new Command(ActionType.GOTO, { url, timeout }));
    }

    click(x: number, y: number): Promise<Result> {
        return this._send(new Command(ActionType.CLICK, { x, y }));
    }

    type(text: string): Promise<Result> {
        return this._send(new Command(ActionType.TYPE, { text }));
    }

    scroll(dx = 0, dy = 100): Promise<Result> {
        return this._send(
            new Command(ActionType.SCROLL, { delta_x: dx, delta_y: dy })
        );
    }

    /**
     * Grab a JPEG screenshot.
     *
     * @param dest Optional file destination.  If provided, the file is written
     *             and the raw bytes are still returned.
     */
    async screenshot(dest?: string | URL): Promise<Buffer> {
        const res = await this._send(new Command(ActionType.SCREENSHOT));
        if (!(res.success && res.image)) {
            throw new ScreenshotFailed(res.error_message ?? "unknown error");
        }
        if (dest) {
            const p = dest instanceof URL ? dest.pathname : path.resolve(dest);
            await fs.mkdir(path.dirname(p), { recursive: true });
            await fs.writeFile(p, res.image);
        }
        return res.image;
    }

    setViewport({
        width,
        height
    }: {
        width: number;
        height: number;
    }): Promise<Result> {
        return this._send(
            new Command(ActionType.SET_VIEWPORT_SIZE, { width, height })
        );
    }


    // Internals
    private async _send(cmd: Command): Promise<Result> {
        if (!this.ws) throw new Error("Waypoint#connect() not called");
        try {
            const res = await this.ws.send(cmd);
            if (!res.success) {
                console.warn(
                    `Command ${cmd.action_type} failed: ${res.error_message ?? "unknown"}`
                );
            }
            return res;
        } catch (error) {
            console.error(`Command ${cmd.action_type} error:`, error);
            throw error;
        }
    }
}
