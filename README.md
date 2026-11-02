# node-red-contrib-power-genius

Node-RED nodes for monitoring a FlexRadio / 4O3A PowerGenius XL (PGXL) amplifier over its TCP API (port 9008).
Framing: `C<seq>|<command>` request, `R<seq>|<hex>|<message>` reply, `S<n>|<message>` asynchronous status.

> **Work in progress.** The API documentation ([API Docs](API%20Docs/PGXL-Amplifier-to-Radio-API-Documentation.pdf),
> firmware 3.8.8) only covers a few commands and says little about the replies, so the nodes keep whatever the
> amplifier sends and the property tables below are filled in from what a real amplifier reports.

## Nodes

- **power-genius-server** (config): host, port (default 9008), auto connect, status poll interval (default 1000 ms, 0 = off) and command terminator (LF by default).
- **power-genius-status**: emits one status property per node, or *all* as an object. The property is free text so that properties missing from the documentation can be used. Emits `msg.payload` (the value), `msg.topic` (the property name) and `msg.previous`. With `*`, `msg.payload` is the whole status object and `msg.topic` is `status`. By default it only emits when the value changes; an optional deadband suppresses small numeric changes. A start delay (default 1000 ms) holds back the first output after deploy so that downstream nodes, such as dashboard widgets, can initialize. Any input emits the last known value and refreshes from the device.
- **power-genius-info**: emits the device info once after connecting, either as an object or as a single property. Any input re-reads and emits it.
- **power-genius-control**: sends a raw command (`command`, payload is the command) or saves the configuration (`save`, which reboots the amplifier). The reply is output as `msg.payload`. The action is fixed in the node, or taken from `msg.topic` when the node is set to `msg.topic`; a fixed action always wins.

### Status properties

The `status` reply is a list of `key=value` pairs; numbers are emitted as numbers, everything else as text.

| Property | Meaning | Values |
|---|---|---|
| `state` | Amplifier state | e.g. `STANDBY`; `REBOOT` is sent asynchronously after `save` |
| `meffa` | MeFFA state | e.g. `OFF` |

TODO: add the remaining properties (power, SWR, drive, current, temperature, band, ...) once seen on a real amplifier.
Use a status node with property `*` and a debug node to list them.

### Info properties

Collected with `setup read`, `ifconf read`, `catradio read=A|B` and `flexradio read=A|B`; each reply is parsed as `key=value` pairs.

| Property | Meaning |
|---|---|
| `name` | Device name with spaces (the `nickname` with `_` replaced by a space) |
| `firmware` | Firmware version, from the banner the device sends on connect |
| `authRequired` | `true` when the device asked for authentication (not supported yet) |
| `nickname`, ... | Fields of `setup read` (nickname, fan mode, MeFFA state, LED intensity, ...) |
| `ifconf` | Object with the network configuration |
| `catradioA`, `catradioB` | Objects with the CAT radio configuration of slice A / B |
| `flexradioA`, `flexradioB` | Objects with the FlexRadio configuration of slice A / B |

## Commands used

Read-only: `status`, `setup read`, `ifconf read`, `catradio read={A|B}`, `flexradio read={A|B}`.
Through the control node: any command, and `save`.

## Learning what the amplifier sends

- Set the Node-RED log level to `trace` to log every line received from the amplifier.
- Use a **power-genius-control** node with action `command` to try commands and see the replies.
- If the amplifier answers `Invalid command`, change the server's *Terminator*. The documentation says CR, the default LF is what the sibling Tuner Genius needs.

Not supported: authentication (`AUTH` in the banner, only outside the local network), UDP discovery, and the FLEX radio-side commands (`amplifier create`, `meter create`, `interlock create`, ...), which the amplifier sends to the radio, not to clients.

## Example

An example flow is included. After installing, use **Import → Examples → node-red-contrib-power-genius** in the editor.
Set the host of the **power genius** server node to your amplifier before deploying. The flow is in
[examples/power-genius-example.json](examples/power-genius-example.json).

## Install

    npm install node-red-contrib-power-genius
