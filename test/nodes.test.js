const net = require("net");
const fs = require("fs");
const path = require("path");
const helper = require("node-red-node-test-helper");
const server = require("../power-genius-server.js");
const status = require("../power-genius-status.js");
const info = require("../power-genius-info.js");
const control = require("../power-genius-control.js");

helper.init(require.resolve("node-red"));

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// Minimal PGXL: banner on connect, then answers the commands it knows, with R lines.
const startFakeAmplifier = () => new Promise((resolve) => {
    const received = [];
    const replies = {
        "setup read": "nickname=My_PGXL fan=NORMAL meffa=OFF led=5",
        "ifconf read": "address=192.168.0.14 netmask=255.255.255.0 gateway-status=192.168.0.1 dhcp=false",
        "catradio read=A": "ampslice=A active=0 type=None",
        "flexradio read=A": "serial=1718-9765-6601-2203 txant=ANT1 ptt=LAN active=1",
        "status": "state=STANDBY temp=31.5 meffa=OFF",
        "operate=1": "",
    };
    const srv = net.createServer((socket) => {
        socket.write("V3.8.8\r\n");
        let buf = "";
        socket.on("data", (d) => {
            buf += d.toString();
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
                const m = /^C(\d+)\|(.*)$/.exec(line);
                received.push(m[2]);
                socket.write(m[2] in replies ? `R${m[1]}|0|${replies[m[2]]}\r\n` : `R${m[1]}|1|unknown\r\n`);
            }
        });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port, received }));
});

describe("nodes", () => {
    beforeEach(() => helper.startServer());
    afterEach(async () => { await helper.unload(); await helper.stopServer(); });

    test("load", async () => {
        const flow = [
            { id: "s", type: "power-genius-server", host: "127.0.0.1", port: 1, autoConnect: false },
            { id: "st", type: "power-genius-status", server: "s" },
            { id: "i", type: "power-genius-info", server: "s" },
            { id: "c", type: "power-genius-control", server: "s" },
        ];
        await helper.load([server, status, info, control], flow);
        for (const id of ["s", "st", "i", "c"]) expect(helper.getNode(id)).toBeDefined();
    });

    test("example flow loads and the nodes are wired", async () => {
        const flow = JSON.parse(fs.readFileSync(path.join(__dirname, "../examples/power-genius-example.json"), "utf8"));
        const ids = new Set(flow.map((n) => n.id));
        for (const n of flow) {
            for (const out of n.wires || []) for (const target of out) expect(ids.has(target)).toBe(true);
        }
        // Not auto connecting, so the test does not try to reach the example host.
        const testFlow = flow.map((n) => (n.type === "power-genius-server" ? { ...n, autoConnect: false } : n));
        const core = ["common/20-inject.js", "common/21-debug.js", "common/90-comment.js"]
            .map((f) => require(`@node-red/nodes/core/${f}`));
        await helper.load([...core, server, status, info, control], testFlow);
        for (const n of flow.filter((x) => x.type.startsWith("power-genius-") && x.z)) {
            expect(helper.getNode(n.id)).toBeDefined();
        }
    });

    describe("against a fake amplifier", () => {
        let amp;
        beforeEach(async () => { amp = await startFakeAmplifier(); });
        afterEach(() => amp.srv.close());

        const load = async () => {
            await helper.load([server, status, info, control], [
                { id: "s", type: "power-genius-server", host: "127.0.0.1", port: amp.port, autoConnect: true, pollInterval: 0 },
                { id: "st", type: "power-genius-status", server: "s", property: "state", startDelay: 0, wires: [["h"]] },
                { id: "i", type: "power-genius-info", server: "s", property: "ifconf", startDelay: 0, wires: [["h"]] },
                { id: "c", type: "power-genius-control", server: "s", action: "" },
                { id: "h", type: "helper" },
            ]);
            const out = [];
            helper.getNode("h").on("input", (m) => out.push(m));
            for (let i = 0; i < 50 && !helper.getNode("s").connected; i++) await tick(20);
            await tick(200);
            return { out, srv: helper.getNode("s") };
        };

        test("reads status and info on connect, ignoring unsupported commands", async () => {
            const { out, srv } = await load();
            expect(srv.status).toEqual({ state: "STANDBY", temp: 31.5, meffa: "OFF" });
            expect(srv.info.firmware).toBe("3.8.8");
            expect(srv.info.name).toBe("My PGXL");
            expect(srv.info.ifconf).toMatchObject({ address: "192.168.0.14", dhcp: "false" });
            expect(srv.info.flexradioA).toMatchObject({ txant: "ANT1" });
            expect(srv.info.catradioB).toBeUndefined();
            expect(out.map((m) => [m.topic, m.payload])).toEqual(
                expect.arrayContaining([["state", "STANDBY"], ["ifconf", expect.objectContaining({ netmask: "255.255.255.0" })]])
            );
        });

        test("control node sends the operate command to the amplifier", async () => {
            await load();
            amp.received.length = 0;
            helper.getNode("c").receive({ topic: "operate", payload: true });
            await tick(100);
            expect(amp.received).toEqual(["operate=1"]);
        });

        test("a command the amplifier rejects is reported as an error", async () => {
            await load();
            const c = helper.getNode("c");
            const errors = [];
            c.on("call:error", (call) => errors.push(call.args[0]));
            c.receive({ topic: "operate", payload: false });
            await tick(100);
            expect(String(errors[0])).toContain("Command error");
        });
    });

    describe("control node", () => {
        const load = async ({ reply = "", ...cfg }) => {
            await helper.load([server, control], [
                { id: "s", type: "power-genius-server", host: "127.0.0.1", port: 1, autoConnect: false },
                { id: "c", type: "power-genius-control", server: "s", ...cfg },
                { id: "h", type: "helper" },
            ]);
            const srv = helper.getNode("s");
            const calls = [];
            srv.command = (cmd) => { calls.push(cmd); return Promise.resolve(reply); };
            const node = helper.getNode("c");
            const errors = [];
            node.on("call:error", (call) => errors.push(String(call.args[0])));
            const out = [];
            helper.getNode("h").on("input", (m) => out.push(m));
            return { calls, errors, out, node };
        };

        test("a fixed action wins over msg.topic", async () => {
            const { calls, node } = await load({ action: "operate" });
            node.receive({ topic: "save", payload: 1 });
            await tick();
            expect(calls).toEqual(["operate=1"]);
        });

        test("msg.topic is used when no action is fixed", async () => {
            const { calls, node } = await load({ action: "" });
            node.receive({ topic: "operate", payload: "off" });
            node.receive({ topic: "Operate", payload: true });
            await tick();
            expect(calls).toEqual(["operate=0", "operate=1"]);
        });

        test("antenna sends antenna=<n> and only accepts 1-3", async () => {
            const { calls, errors, node } = await load({ action: "antenna" });
            for (const payload of [2, "3"]) node.receive({ payload });
            for (const payload of [0, 4, 1.5, "x", "", null, undefined]) node.receive({ payload });
            await tick();
            expect(calls).toEqual(["antenna=2", "antenna=3"]);
            expect(errors).toHaveLength(7);
        });

        test("only operate, antenna and command are accepted", async () => {
            const { calls, errors, node } = await load({ action: "" });
            node.receive({ topic: "save", payload: 1 });
            node.receive({ topic: "ptt", payload: 1 });
            node.receive({ payload: 1 });
            await tick();
            expect(calls).toEqual([]);
            expect(errors).toHaveLength(3);
            expect(errors[0]).toContain("topic must be one of: operate, antenna, command");
        });

        test("command sends the payload as it is and outputs the reply", async () => {
            const { calls, out, node } = await load({ action: "command", reply: "a=1 b=2", wires: [["h"]] });
            node.receive({ payload: "  setup read " });
            await tick();
            expect(calls).toEqual(["setup read"]);
            expect(out).toHaveLength(1);
            expect(out[0].topic).toBe("command");
            expect(out[0].payload).toBe("a=1 b=2");
        });

        test("command rejects an empty or multi-line payload", async () => {
            const { calls, errors, node } = await load({ action: "command" });
            for (const payload of ["", "   ", undefined, null, "status\nsave"]) node.receive({ payload });
            await tick();
            expect(calls).toEqual([]);
            expect(errors).toHaveLength(5);
        });

        test("a payload that is not a clear on/off is rejected and nothing is sent", async () => {
            const { calls, errors, node } = await load({ action: "operate" });
            for (const payload of [2, "maybe", undefined, null, ""]) node.receive({ payload });
            await tick();
            expect(calls).toEqual([]);
            expect(errors).toHaveLength(5);
        });
    });

    describe("status node", () => {
        const load = async (cfg) => {
            await helper.load([server, status], [
                { id: "s", type: "power-genius-server", host: "127.0.0.1", port: 1, autoConnect: false },
                { id: "st", type: "power-genius-status", server: "s", startDelay: 0, wires: [["h"]], ...cfg },
                { id: "h", type: "helper" },
            ]);
            const out = [];
            helper.getNode("h").on("input", (m) => out.push(m));
            return { out, srv: helper.getNode("s") };
        };

        test("only emits a property when it changes", async () => {
            const { out, srv } = await load({ property: "state" });
            srv.updatesEventEmitter.emit("status", { state: "STANDBY" });
            srv.updatesEventEmitter.emit("status", { state: "STANDBY" });
            srv.updatesEventEmitter.emit("status", { state: "REBOOT" });
            await tick();
            expect(out.map((m) => [m.payload, m.previous])).toEqual([["STANDBY", undefined], ["REBOOT", "STANDBY"]]);
        });

        test("deadband suppresses small numeric changes", async () => {
            const { out, srv } = await load({ property: "temp", deadband: 1 });
            for (const t of [30, 30.5, 31]) srv.updatesEventEmitter.emit("status", { temp: t });
            await tick();
            expect(out.map((m) => m.payload)).toEqual([30, 31]);
        });

        test("emits the whole status as an object", async () => {
            const { out, srv } = await load({ property: "*" });
            srv.updatesEventEmitter.emit("status", { state: "IDLE", whatever: 1 });
            await tick();
            expect(out[0].topic).toBe("status");
            expect(out[0].payload).toEqual({ state: "IDLE", whatever: 1 });
        });
    });
});
