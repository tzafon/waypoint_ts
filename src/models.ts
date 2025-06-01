export enum ActionType {
    CLICK = "click",
    TYPE = "type",
    SCROLL = "scroll",
    GOTO = "goto",
    SCREENSHOT = "screenshot",
    SET_VIEWPORT_SIZE = "set_viewport_size"
}

export interface CommandPayload {
    action_type: ActionType | string;
    x?: number;
    y?: number;
    text?: string;
    delta_x?: number;
    delta_y?: number;
    url?: string;
    width?: number;
    height?: number;
    timeout?: number; // ms
}

export class Command implements CommandPayload {
    action_type: ActionType;
    x?: number;
    y?: number;
    text?: string;
    delta_x?: number;
    delta_y?: number;
    url?: string;
    width?: number;
    height?: number;
    timeout: number;

    constructor(
        action_type: ActionType,
        fields: Omit<CommandPayload, "action_type"> = {}
    ) {
        this.action_type = action_type;
        this.timeout = fields.timeout ?? 5000;
        Object.assign(this, fields);
    }

    static load(raw: Buffer | string): Command {
        const data: Record<string, unknown> =
            typeof raw === "string" ? JSON.parse(raw) : JSON.parse(raw.toString());
        const actionStr = data.action_type as string | undefined;
        if (!actionStr) throw new Error("Command missing 'action_type'");
        if (!Object.values(ActionType).includes(actionStr as ActionType)) {
            throw new Error(`Unknown action_type '${actionStr}'`);
        }
        return new Command(actionStr as ActionType, data as Omit<CommandPayload, "action_type">);
    }

    dump(): Buffer {
        const plain = { ...this };
        // strip undefineds
        const pruned = Object.fromEntries(
            Object.entries(plain).filter(([, v]) => v !== undefined)
        );
        return Buffer.from(JSON.stringify(pruned));
    }
}

export interface ResultPayload {
    success: boolean;
    image?: string; // base64 jpeg
    image_url?: string; // remote location if bytes omitted
    error_message?: string;
}

export class Result {
    success: boolean;
    image?: Buffer;
    image_url?: string;
    error_message?: string;

    constructor({ success, image, image_url, error_message }: ResultPayload) {
        this.success = success;
        this.error_message = error_message;
        this.image = image ? Buffer.from(image, "base64") : undefined;
        this.image_url = image_url;
    }

    /**
     * If `image` is null but `image_url` is present, fetch the bytes asynchronously.
     */
    async downloadImage(): Promise<void> {
        if (this.image === undefined && this.image_url !== undefined) {
            try {
                const response = await fetch(this.image_url, {
                    signal: AbortSignal.timeout(20000), // 20s timeout
                    redirect: 'follow'
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                this.image = Buffer.from(arrayBuffer);
            } catch (error) {
                // Silent failure - caller will handle missing image
            }
        }
    }

    static load(raw: Buffer | string): Result {
        const data: ResultPayload =
            typeof raw === "string" ? JSON.parse(raw) : JSON.parse(raw.toString());
        return new Result(data);
    }

    dump(): Buffer {
        const obj: ResultPayload = {
            success: this.success,
            error_message: this.error_message,
            image: this.image ? this.image.toString("base64") : undefined,
            image_url: this.image_url
        };
        const pruned = Object.fromEntries(
            Object.entries(obj).filter(([, v]) => v !== undefined)
        );
        return Buffer.from(JSON.stringify(pruned));
    }

    toString(): string {
        const ok = this.success ? "✅" : "❌";
        const img = this.image ? "🖼️" : "—";
        return `<Result ${ok} image:${img} msg:'${this.error_message ?? ""}'>`;
    }
}
