const Net = require("net");
const EventEmitter = require("events");
const { GeniusPGProtocol, parseKeyValues, parseBanner } = require("./GeniusPGProtocol");

class UpdatesEventEmitter extends EventEmitter {}

// Read-only commands whose replies make up the device info. Replies are stored under the given key, or merged
// flat into the info object when the key is null. The documentation does not list the reply fields, so
// whatever the device sends is kept.
const INFO_COMMANDS = [
    { cmd: "setup read", key: null },
    { cmd: "ifconf read", key: "ifconf" },
    { cmd: "catradio read=A", key: "catradioA" },
    { cmd: "catradio read=B", key: "catradioB" },
    { cmd: "flexradio read=A", key: "flexradioA" },
    { cmd: "flexradio read=B", key: "flexradioB" },
];

module.exports = (RED) => {
    class PowerGeniusServerNode {
        constructor(n) {
            RED.nodes.createNode(this, n);
            this.host = n.host;
            this.port = n.port;
            this.autoConnect = n.autoConnect || false;
            this.pollInterval = Math.max(parseInt(n.pollInterval, 10) || 0, 0);
            this.terminator = n.terminator || "LF";
            this.poller = null;

            this.status = {};
            this.info = {};
            this.timer = null;
            this._protocol = null;
            this._dataHandler = null;

            this.updatesEventEmitter = new UpdatesEventEmitter();
            this.updatesEventEmitter.setMaxListeners(0);

            this.client = new Net.Socket();
            this.connected = false;

            this.client.on("close", () => {
                this.log("TCP connection disconnected with the server.");
                clearTimeout(this.timer);
                this.connected = false;
                this._detach();
                this._stopPolling();

                if (this.updatesEventEmitter.listenerCount("closed") == 0) {
                    this.log("Stop retrying. No nodes are refering this connection anymore.");
                    return;
                }

                if (this.autoConnect) {
                    this.log("Will try to reconnect in 5 seconds");
                    this.timer = setTimeout(() => this.connect(), 5000);
                    this.updatesEventEmitter.emit("closed");
                }
            });

            this.client.on("connect", async () => {
                this.log("TCP connection established with the server.");
                this.connected = true;
                try {
                    await this._setup();
                } catch (err) {
                    this.warn("Connection setup failed: " + err.message);
                }
            });

            this.client.on("error", (err) => {
                this.warn(err);
            });

            this.on("close", (done) => {
                clearTimeout(this.timer);
                this.autoConnect = false;
                this.connected = false;
                this._detach();
                this._stopPolling();
                this.client.end();
                done();
            });
        }

        _detach() {
            if (this._dataHandler) {
                this.client.removeListener("data", this._dataHandler);
                this._dataHandler = null;
            }
            this._protocol = null;
        }

        _stopPolling() {
            clearInterval(this.poller);
            this.poller = null;
        }

        _startPolling() {
            this._stopPolling();
            if (!this.pollInterval) return;
            let busy = false;
            this.poller = setInterval(async () => {
                if (busy || !this._protocol) return;
                busy = true;
                try {
                    await this.resendStatus();
                } finally {
                    busy = false;
                }
            }, this.pollInterval);
        }

        _mergeStatus(msg) {
            const kv = parseKeyValues(msg);
            if (Object.keys(kv).length === 0) return false;
            this.status = { ...this.status, ...kv };
            return true;
        }

        _applyInfo(parts) {
            const info = { ...this.info };
            for (const { key, values } of parts) {
                if (key === null) {
                    Object.assign(info, values);
                } else {
                    info[key] = values;
                }
            }
            const nickname = info.nickname !== undefined ? info.nickname : info.name;
            info.name = String(nickname || this.info.name || "").replace(/_/g, " ");
            this.info = info;
        }

        // Reads the info commands one by one. A command the device rejects is skipped, so that one unsupported
        // command does not hide the rest.
        async _readInfo(protocol) {
            const parts = [];
            for (const { cmd, key } of INFO_COMMANDS) {
                try {
                    const values = parseKeyValues(await protocol.sendCommand(cmd, 3000));
                    parts.push({ key, values });
                } catch (err) {
                    this.debug(`'${cmd}' failed: ${err.message}`);
                }
            }
            this._applyInfo(parts);
        }

        async _setup() {
            const protocol = new GeniusPGProtocol(this.client, this.terminator);
            this._protocol = protocol;
            this._dataHandler = (chunk) => protocol.handleData(chunk);

            // The device sends "V<version>[ AUTH]" immediately after connecting.
            protocol.onBanner((line) => {
                this.info = { ...this.info, ...parseBanner(line) };
                if (this.info.authRequired) {
                    this.warn("Power Genius requires authentication, which is not supported yet.");
                }
            });
            // Anything the device sends is traced, to help finding properties the documentation leaves out.
            protocol.onLine((line) => this.trace("rx " + line));
            // Unsolicited status, such as "S|state=REBOOT".
            protocol.onStatus((msg) => {
                if (this._mergeStatus(msg)) {
                    this.updatesEventEmitter.emit("status", { ...this.status });
                }
            });
            this.client.on("data", this._dataHandler);

            await this._readInfo(protocol);
            this._mergeStatus(await protocol.sendCommand("status", 3000));

            if (this._protocol !== protocol || !this.connected) return;

            this._startPolling();

            this.updatesEventEmitter.emit("connected");
            this.updatesEventEmitter.emit("status", { ...this.status });
        }

        // Send a raw command to the amplifier. Resolves with the reply message.
        command(cmd) {
            if (!this._protocol) {
                return Promise.reject(new Error("not connected"));
            }
            return this._protocol.sendCommand(cmd, 5000);
        }

        // Writes the configuration. The amplifier reboots afterwards.
        save() {
            return this.command("save");
        }

        connect() {
            if (this.autoConnect && !this.connected && !this.client.connecting) {
                this.client.connect(this.port, this.host);
            }
        }

        // Ask the device for the current status and emit it.
        async resendStatus() {
            if (!this._protocol) return;
            try {
                this._mergeStatus(await this._protocol.sendCommand("status", 5000));
            } catch (err) {
                this.warn("Failed to read status: " + err.message);
                return;
            }
            this.updatesEventEmitter.emit("status", { ...this.status });
        }

        // Re-read the device info.
        async refreshInfo() {
            if (!this._protocol) return;
            await this._readInfo(this._protocol);
        }
    }

    RED.nodes.registerType("power-genius-server", PowerGeniusServerNode);
};
