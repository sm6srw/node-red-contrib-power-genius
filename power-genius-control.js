// Builds the command to send from the payload. "command" sends the payload as it is, to try commands that
// are not documented; the amplifier answers an unknown one with an error.
const COMMANDS = {
    operate: (payload) => `operate=${parseSwitch(payload)}`,
    command: (payload) => {
        const cmd = String(payload === undefined || payload === null ? "" : payload).trim();
        if (!cmd) throw new Error("payload must be the command to send");
        if (/[\r\n]/.test(cmd)) throw new Error("payload must be a single line");
        return cmd;
    },
};
const ACTIONS = Object.keys(COMMANDS);

// true/false, 1/0, "1"/"0" and "on"/"off" (any case). Anything else is rejected, so that a stray payload
// can never switch the amplifier by accident.
const parseSwitch = (payload) => {
    if (payload === true || payload === 1) return 1;
    if (payload === false || payload === 0) return 0;
    switch (String(payload).trim().toLowerCase()) {
        case "1":
        case "on":
        case "true":
            return 1;
        case "0":
        case "off":
        case "false":
            return 0;
        default:
            throw new Error("payload must be true/false, 1/0 or on/off");
    }
};

module.exports = (RED) => {
    class PowerGeniusControl {
        constructor(config) {
            RED.nodes.createNode(this, config);
            this.server = RED.nodes.getNode(config.server);

            if (this.server == null) {
                this.status({ fill: "red", shape: "ring", text: "disconnected" });
                return;
            }

            const emitter = this.server.updatesEventEmitter;
            const onConnected = () => {
                this.status({ fill: "green", shape: "dot", text: this.server.info.name || "connected" });
            };
            const onClosed = () => {
                this.status({ fill: "red", shape: "ring", text: "disconnected" });
            };
            emitter.on("connected", onConnected);
            emitter.on("closed", onClosed);

            this.on("close", () => {
                emitter.removeListener("connected", onConnected);
                emitter.removeListener("closed", onClosed);
            });

            this.on("input", async (msg, send, done) => {
                const action = String(config.action || msg.topic || "").toLowerCase();
                try {
                    if (!ACTIONS.includes(action)) {
                        throw new Error(`topic must be one of: ${ACTIONS.join(", ")}`);
                    }
                    const reply = await this.server.command(COMMANDS[action](msg.payload));
                    send({ ...msg, topic: action, payload: reply });
                    if (done) done();
                } catch (err) {
                    this.status({ fill: "red", shape: "ring", text: err.message });
                    if (done) done(err); else this.error(err, msg);
                }
            });

            this.server.connect();
        }
    }
    RED.nodes.registerType("power-genius-control", PowerGeniusControl);
};
