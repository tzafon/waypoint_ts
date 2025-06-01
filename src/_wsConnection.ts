import WebSocket from "ws";
import { type Command, Result } from "./models";

type PendingRequest = {
    id: string;
    resolve: (value: Result) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    command: Command;
    completed: boolean;
};

export class _WsConnection {
    private url: string;
    private pingInterval: number; // in milliseconds
    private conn?: WebSocket;
    private responseTimeout: number; // in milliseconds
    private pingTimer?: NodeJS.Timeout;
    private isAlive: boolean = false;
    private pendingRequests: PendingRequest[] = [];
    private requestCounter: number = 0;

    constructor(url: string, options?: { 
        pingInterval?: number; // in milliseconds (default: 20000)
        responseTimeout?: number; // in milliseconds (default: 10000)
    }) {
        if (!/^wss?:\/\//.test(url)) {
            throw new Error(`Invalid websocket URL '${url}'`);
        }
        this.url = url;
        this.pingInterval = options?.pingInterval ?? 20000; // milliseconds
        this.responseTimeout = options?.responseTimeout ?? 10000; // milliseconds
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

        // Set up persistent message handler
        this.conn?.on("message", (data: Buffer | string) => {
            const pending = this.pendingRequests.find(p => !p.completed);
            if (pending) {
                pending.completed = true;
                clearTimeout(pending.timeout);
                this.pendingRequests = this.pendingRequests.filter(p => p.id !== pending.id);
                try {
                    const result = Result.load(data);
                    pending.resolve(result);
                } catch (error) {
                    pending.reject(error as Error);
                }
            }
        });

        // Set up error handler for unexpected issues
        this.conn?.on("error", (err) => {
            console.error("WebSocket error:", err);
            // Reject all pending requests
            this.pendingRequests.forEach(pending => {
                if (!pending.completed) {
                    pending.completed = true;
                    clearTimeout(pending.timeout);
                    pending.reject(new Error("WebSocket error: " + err.message));
                }
            });
            this.pendingRequests = [];
        });

        // Handle unexpected connection closes
        this.conn?.on("close", (code, reason) => {
            console.warn(`WebSocket closed: code=${code}, reason=${reason}`);
            this.stopPing();
            // Reject all pending requests
            this.pendingRequests.forEach(pending => {
                if (!pending.completed) {
                    pending.completed = true;
                    clearTimeout(pending.timeout);
                    pending.reject(new Error("WebSocket closed unexpectedly"));
                }
            });
            this.pendingRequests = [];
        });

        // Set up ping/pong to keep connection alive
        this.isAlive = true;
        this.conn?.on("pong", () => {
            this.isAlive = true;
        });

        this.startPing();
    }

    private startPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
        }
        
        this.pingTimer = setInterval(() => {
            if (!this.isOpen || !this.conn) {
                this.stopPing();
                return;
            }

            if (!this.isAlive) {
                console.warn("WebSocket ping timeout - connection may be dead");
                this.conn.terminate();
                return;
            }

            this.isAlive = false;
            this.conn.ping();
        }, this.pingInterval);
    }

    private stopPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
    }

    async close(): Promise<void> {
        this.stopPing();
        
        // Clear all pending requests
        this.pendingRequests.forEach(pending => {
            if (!pending.completed) {
                pending.completed = true;
                clearTimeout(pending.timeout);
                pending.reject(new Error("Connection closing"));
            }
        });
        this.pendingRequests = [];
        
        if (this.conn && this.conn.readyState === WebSocket.OPEN) {
            try {
                this.conn.close(1000, "Client shutting down");
                
                await new Promise<void>((resolve) => {
                    const done = () => {
                        clearTimeout(timer);
                        this.conn?.removeListener("close", done);
                        this.conn?.removeAllListeners();
                        resolve();
                    };

                    this.conn?.once("close", done);

                    const timer = setTimeout(() => {
                        this.conn?.terminate();
                        done();
                    }, 5000);
                    
                    if (typeof timer !== 'number' && 'unref' in timer) {
                        timer.unref();
                    }
                });
            } catch (error) {
                console.error(error);
            }
        }
        this.conn = undefined;
    }

    async send(cmd: Command): Promise<Result> {
        if (!this.isOpen) {
            throw new Error("Websocket not connected");
        }
        if (!this.conn) {
            throw new Error("Websocket connection is not available");
        }
        
        // Send as text (JSON string)
        const cmdJson = cmd.dump().toString('utf-8');
        const requestId = `req_${++this.requestCounter}_${Date.now()}`;
        
        const responsePromise = new Promise<Result>((resolve, reject) => {
            const timeout = setTimeout(() => {
                // Find and mark as completed
                const pending = this.pendingRequests.find(p => p.id === requestId);
                if (pending && !pending.completed) {
                    pending.completed = true;
                    this.pendingRequests = this.pendingRequests.filter(p => p.id !== requestId);
                    reject(new Error(`Command ${cmd.action_type} timed out after ${this.responseTimeout}ms`));
                }
            }, this.responseTimeout);
            
            this.pendingRequests.push({ 
                id: requestId,
                resolve, 
                reject, 
                timeout, 
                command: cmd,
                completed: false 
            });
        });
        
        await this.conn.send(cmdJson);
        
        return responsePromise;
    }

    get isOpen(): boolean {
        return this.conn !== undefined && this.conn.readyState === WebSocket.OPEN;
    }
}
