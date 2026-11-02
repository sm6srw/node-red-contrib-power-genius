module.exports = (RED) => {
    class PowerGeniusInfo {
        constructor(config) {
            RED.nodes.createNode(this, config);
            this.server = RED.nodes.getNode(config.server);

            if (this.server == null) {
                this.status({ fill: "red", shape: "ring", text: "disconnected" });
                return;
            }

            // "*" (or unset) emits the whole info object.
            const property = config.property && config.property !== "*" ? config.property : null;
            const startDelay = Math.max(parseInt(config.startDelay, 10) || 0, 0);
            let ready = false;

            const emit = () => {
                const info = this.server.info;
                if (Object.keys(info).length === 0) return;
                if (property === null) {
                    this.send({ topic: "info", payload: { ...info } });
                } else if (property in info) {
                    this.send({ topic: property, payload: info[property] });
                }
            };

            const emitter = this.server.updatesEventEmitter;

            const onConnected = () => {
                this.status({ fill: "green", shape: "dot", text: this.server.info.name || "connected" });
                if (ready) emit();
            };
            const onClosed = () => {
                this.status({ fill: "red", shape: "ring", text: "disconnected" });
            };

            emitter.on("connected", onConnected);
            emitter.on("closed", onClosed);

            // Hold back output after deploy so that downstream nodes (e.g. dashboard UI) can finish initializing.
            // Also covers a server that is already connected, which does not emit "connected" again.
            const startTimer = setTimeout(() => {
                ready = true;
                emit();
            }, startDelay);

            this.on("input", async (msg, send, done) => {
                await this.server.refreshInfo();
                emit();
                if (done) done();
            });

            this.on("close", () => {
                clearTimeout(startTimer);
                emitter.removeListener("connected", onConnected);
                emitter.removeListener("closed", onClosed);
            });

            this.server.connect();
        }
    }
    RED.nodes.registerType("power-genius-info", PowerGeniusInfo);
};
