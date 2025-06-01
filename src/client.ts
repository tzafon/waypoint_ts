import { Command, type Result, ActionType } from "./models";
import { _WsConnection } from "./_wsConnection";
import { ScreenshotFailed } from "./exceptions";
import type { Buffer } from "buffer";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";

const _DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export class Waypoint {
    private wsUrl: string;
    private timeout: number;
    private ws?: _WsConnection;
    private responseTimeout: number;

    /**
     * Creates a new Waypoint client instance
     * @param token - Waypoint API token (must start with 'wpk_')
     * @param options - Configuration options
     * @param options.urlTemplate - WebSocket URL template (default: wss://api.tzafon.ai/ephemeral-tzafonwright?token={token})
     * @param options.connectTimeout - Connection timeout in milliseconds (default: 10000)
     * @param options.responseTimeout - Command response timeout in milliseconds (default: 10000)
     */
    constructor(
        token: string,
        {
            urlTemplate = "wss://api.tzafon.ai/ephemeral-tzafonwright?token={token}",
            connectTimeout = 10_000,
            responseTimeout = 10_000
        }: { urlTemplate?: string; connectTimeout?: number; responseTimeout?: number } = {}
    ) {
        if (!token || !token.startsWith("wpk_")) {
            throw new Error("token must look like 'wpk_…'");
        }
        this.wsUrl = urlTemplate.replace("{token}", token);
        this.timeout = connectTimeout;
        this.responseTimeout = responseTimeout;
    }

    /**
     * Connects to the Waypoint WebSocket server
     * @example
     * const client = new Waypoint(token);
     * await client.connect();
     * try {
     *   // use client
     * } finally {
     *   await client.close();
     * }
     */
    async connect(): Promise<void> {
        this.ws = new _WsConnection(this.wsUrl, { responseTimeout: this.responseTimeout });
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
    }

    async close(): Promise<void> {
        await this.ws?.close();
        this.ws = undefined;
    }

    // Public commands
    async goto(url: string, options?: { timeout?: number }): Promise<Result> {
        const timeout = options?.timeout ?? 5000;
        return await this._send(new Command(ActionType.GOTO, { url, timeout }));
    }

    async click(x: number, y: number): Promise<Result> {
        return await this._send(new Command(ActionType.CLICK, { x, y }));
    }

    async type(text: string): Promise<Result> {
        return await this._send(new Command(ActionType.TYPE, { text }));
    }

    async scroll(dx = 0, dy = 100): Promise<Result> {
        return await this._send(
            new Command(ActionType.SCROLL, { delta_x: dx, delta_y: dy })
        );
    }

    /**
     * Grab a JPEG screenshot.
     *
     * @param filepath Optional file destination. If provided the image is written to disk
     *                 and the raw bytes are still returned.
     * @param options.mkdir Automatically create parent folders if they do not exist.
     * @param options.returnUrl If true, return the remote URL instead of the image bytes.
     * @returns Buffer with image bytes or URL string if returnUrl is true
     */
    async screenshot(
        filepath?: string | URL,
        options?: {
            mkdir?: boolean;
            returnUrl?: boolean;
        }
    ): Promise<Buffer | string> {
        const mkdir = options?.mkdir ?? true;
        const returnUrl = options?.returnUrl ?? false;

        const res = await this._send(new Command(ActionType.SCREENSHOT));

        const toAbsolutePath = (fp: string | URL): string => {
            if (fp instanceof URL) {
                if (fp.protocol !== 'file:') {
                    throw new Error(`URL protocol not supported: ${fp.protocol}. Only file:// URLs are supported.`);
                }
                return fileURLToPath(fp);
            }
            return path.resolve(fp);
        };

        if (returnUrl) {
            if (res.image_url) {
                return res.image_url;
            }
            if (filepath !== undefined) {
                const p = toAbsolutePath(filepath);
                if (mkdir) {
                    await fs.mkdir(path.dirname(p), { recursive: true });
                }
                await fs.writeFile(p, res.image!);
                return p;
            }
            throw new ScreenshotFailed(
                "Server did not provide image_url; set returnUrl=false to get bytes"
            );
        }

        if (res.success && res.image === undefined && res.image_url !== undefined) {
            await res.downloadImage();
        }

        if (!(res.success && res.image)) {
            throw new ScreenshotFailed(res.error_message ?? "unknown error");
        }

        if (filepath !== undefined) {
            const p = toAbsolutePath(filepath);
            if (mkdir) {
                await fs.mkdir(path.dirname(p), { recursive: true });
            }
            await fs.writeFile(p, res.image);
        }
        return res.image;
    }

    async setViewport(size: { width: number; height: number }): Promise<Result> {
        console.log(`[Waypoint] Ignoring SET_VIEWPORT_SIZE command (default is 1280x720)`);
        return {
            success: true,
            error_message: undefined,
            image: undefined,
            image_url: undefined
        } as Result;
    }

    // Internals
    private async _send(cmd: Command): Promise<Result> {
        if (!this.ws) {
            throw new Error("Waypoint is not connected. Call connect() first");
        }
        const res = await this.ws.send(cmd);
        if (!res.success) {
            console.warn(
                `Command ${cmd.action_type} failed: ${res.error_message ?? "unknown"}`
            );
        }
        return res;
    }
}
