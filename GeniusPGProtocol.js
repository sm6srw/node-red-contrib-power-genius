// Client for the PowerGenius XL line based API (TCP port 9008).
//   banner:    V<a.b.c>[ AUTH]\r\n   (sent once on connect)
//   request:   C<seq>|<command><terminator>   (seq 1-255; the documentation says CR, LF is the default here
//              because the sibling Tuner Genius rejects a trailing CR, see the "terminator" option)
//   reply:     R<seq>|<hex result>|<message>
//   status:    S<n>|<message>   (asynchronous, for example "S|state=REBOOT")
// The documentation is incomplete, so everything here is tolerant: unknown lines are passed on, never dropped.
const TERMINATORS = { LF: "\n", CR: "\r", CRLF: "\r\n" };

class GeniusPGProtocol {
    constructor(socket, terminator = "LF") {
        this.socket = socket;
        this.terminator = TERMINATORS[terminator] || TERMINATORS.LF;
        this.seq = 0;
        this.pending = new Map();
        this.lineBuffer = "";
        this.statusHandler = null;
        this.bannerHandler = null;
        this.lineHandler = null;
    }

    nextSeq() {
        this.seq = (this.seq % 255) + 1;
        return this.seq;
    }

    handleData(chunk) {
        this.lineBuffer += chunk.toString("utf8");
        const lines = this.lineBuffer.split(/\r\n|\r|\n/);
        this.lineBuffer = lines.pop();
        for (const line of lines) {
            this._handleLine(line);
        }
    }

    _handleLine(line) {
        if (!line) return;
        if (this.lineHandler) this.lineHandler(line);

        if (line.startsWith("V")) {
            if (this.bannerHandler) this.bannerHandler(line);
            return;
        }

        if (line.startsWith("S")) {
            const pipeIdx = line.indexOf("|");
            const msg = pipeIdx !== -1 ? line.substring(pipeIdx + 1) : "";
            if (this.statusHandler) this.statusHandler(msg);
            return;
        }

        if (line.startsWith("R")) {
            const pipeIdx1 = line.indexOf("|");
            if (pipeIdx1 === -1) return;
            const pipeIdx2 = line.indexOf("|", pipeIdx1 + 1);
            const seq = parseInt(line.substring(1, pipeIdx1), 10);
            const pending = this.pending.get(seq);
            if (!pending) return;
            this.pending.delete(seq);

            // The documentation's examples show replies without the hex result: "R0|state=STANDBY ...".
            // A real result field contains only hex digits, so anything else is the message itself.
            const first = line.substring(pipeIdx1 + 1, pipeIdx2 !== -1 ? pipeIdx2 : undefined);
            const hasResult = pipeIdx2 !== -1 && /^[0-9a-fA-F]+$/.test(first);
            const hexResult = hasResult ? first : "0";
            const message = hasResult ? line.substring(pipeIdx2 + 1) : line.substring(pipeIdx1 + 1);

            if (parseInt(hexResult, 16) !== 0) {
                const error = new Error(`Command error: 0x${hexResult} - ${message}`);
                error.code = hexResult;
                pending.reject(error);
            } else {
                pending.resolve(message);
            }
        }
    }

    sendCommand(cmd, timeoutMs) {
        const seq = this.nextSeq();
        return new Promise((resolve, reject) => {
            const entry = { resolve, reject };
            if (timeoutMs) {
                const timer = setTimeout(() => {
                    this.pending.delete(seq);
                    const error = new Error(`Timeout waiting for reply to '${cmd}'`);
                    error.code = "ETIMEDOUT";
                    reject(error);
                }, timeoutMs);
                entry.resolve = (v) => { clearTimeout(timer); resolve(v); };
                entry.reject = (e) => { clearTimeout(timer); reject(e); };
            }
            this.pending.set(seq, entry);
            this.socket.write(`C${seq}|${cmd}${this.terminator}`);
        });
    }

    onStatus(handler) {
        this.statusHandler = handler;
    }

    onBanner(handler) {
        this.bannerHandler = handler;
    }

    // Called for every received line, before it is interpreted. Used to learn undocumented traffic.
    onLine(handler) {
        this.lineHandler = handler;
    }
}

const toValue = (value) => {
    if (value === "") return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
};

// Parses "key=value key=value ..." (optionally prefixed by a word such as "status").
const parseKeyValues = (msg) => {
    const kv = {};
    const re = /([\w-]+)=(\S*)/g;
    let m;
    while ((m = re.exec(msg)) !== null) {
        kv[m[1]] = toValue(m[2]);
    }
    return kv;
};

// "V3.8.8 AUTH"
const parseBanner = (line) => {
    const tokens = line.trim().split(/\s+/);
    return {
        firmware: tokens[0].replace(/^V/, ""),
        authRequired: tokens.includes("AUTH"),
    };
};

exports.GeniusPGProtocol = GeniusPGProtocol;
exports.parseKeyValues = parseKeyValues;
exports.parseBanner = parseBanner;
exports.TERMINATORS = TERMINATORS;
