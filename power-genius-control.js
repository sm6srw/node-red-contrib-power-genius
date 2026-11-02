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
                    let reply;
                    switch (action) {
                        case "command": {
                            const cmd = String(msg.payload === undefined ? "" : msg.payload).trim();
                            if (!cmd) throw new Error("payload must be the command to send");
                            reply = await this.server.command(cmd);
                            break;
                        }
                        case "save":
                            reply = await this.server.save();
                            break;
                        default:
                            throw new Error("topic must be one of: command, save");
                    }
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
