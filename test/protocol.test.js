const { GeniusPGProtocol, parseKeyValues, parseBanner } = require("../GeniusPGProtocol");

describe("GeniusPGProtocol", () => {
    test("parseKeyValues", () => {
        expect(parseKeyValues("state=STANDBY temp=31.5 meffa=OFF gateway-status=192.168.0.1")).toEqual({
            state: "STANDBY", temp: 31.5, meffa: "OFF", "gateway-status": "192.168.0.1",
        });
    });

    test("parseBanner", () => {
        expect(parseBanner("V3.8.8 AUTH")).toEqual({ firmware: "3.8.8", authRequired: true });
        expect(parseBanner("V3.8.8")).toEqual({ firmware: "3.8.8", authRequired: false });
    });

    test("terminator defaults to LF and is configurable", () => {
        const written = [];
        const socket = { write: (d) => written.push(d) };
        new GeniusPGProtocol(socket).sendCommand("status");
        new GeniusPGProtocol(socket, "CR").sendCommand("status");
        new GeniusPGProtocol(socket, "CRLF").sendCommand("status");
        expect(written).toEqual(["C1|status\n", "C1|status\r", "C1|status\r\n"]);
    });

    test("banner, command/reply and status", async () => {
        const written = [];
        const p = new GeniusPGProtocol({ write: (d) => written.push(d) });
        const status = [];
        const banners = [];
        const lines = [];
        p.onStatus((m) => status.push(m));
        p.onBanner((b) => banners.push(b));
        p.onLine((l) => lines.push(l));
        const reply = p.sendCommand("status", 500);
        expect(written[0]).toBe("C1|status\n");
        p.handleData("V3.8.8\r\nS|state=REBOOT\r\nR1|0|state=IDLE meffa=OFF\r");
        p.handleData("\n");
        await expect(reply).resolves.toBe("state=IDLE meffa=OFF");
        expect(status).toEqual(["state=REBOOT"]);
        expect(banners).toEqual(["V3.8.8"]);
        expect(lines).toHaveLength(3);
    });

    test("a reply without the hex result, as in the documentation examples, is a success", async () => {
        const p = new GeniusPGProtocol({ write: () => {} });
        const reply = p.sendCommand("status");
        p.handleData("R1|state=STANDBY meffa=OFF\n");
        await expect(reply).resolves.toBe("state=STANDBY meffa=OFF");
    });

    test("a reply whose message starts with hex digits is not mistaken for a result", async () => {
        const p = new GeniusPGProtocol({ write: () => {} });
        const reply = p.sendCommand("x");
        p.handleData("R1|0|abc|def\n");
        await expect(reply).resolves.toBe("abc|def");
    });

    test("error reply rejects", async () => {
        const p = new GeniusPGProtocol({ write: () => {} });
        const reply = p.sendCommand("bad");
        p.handleData("R1|10|oops\r\n");
        await expect(reply).rejects.toThrow("Command error: 0x10 - oops");
    });

    test("timeout", async () => {
        const p = new GeniusPGProtocol({ write: () => {} });
        await expect(p.sendCommand("x", 10)).rejects.toMatchObject({ code: "ETIMEDOUT" });
    });

    test("sequence numbers wrap at 255", () => {
        const p = new GeniusPGProtocol({ write: () => {} });
        p.seq = 255;
        expect(p.nextSeq()).toBe(1);
    });
});
