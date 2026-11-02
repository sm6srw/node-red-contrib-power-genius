# node-red-contrib-power-genius

Node-RED nodes for monitoring a FlexRadio / 4O3A PowerGenius XL (PGXL) amplifier over its TCP API (port 9008).
Framing: `C<seq>|<command>` request, `R<seq>|<hex>|<message>` reply, `S<n>|<message>` asynchronous status.

> **Work in progress.** The API documentation ([API Docs](API%20Docs/PGXL-Amplifier-to-Radio-API-Documentation.pdf),
> firmware 3.8.8) only covers a few commands and says little about the replies, so the nodes keep whatever the
> amplifier sends. The property tables below come from a real amplifier (firmware 3.9.9); units not given in the
> documentation are inferred.

## Nodes

- **power-genius-server** (config): host, port (default 9008), auto connect and status poll interval (default 1000 ms, 0 = off).
- **power-genius-status**: emits one status property per node, or *all* as an object. The property is free text so that properties missing from the documentation can be used. Emits `msg.payload` (the value), `msg.topic` (the property name) and `msg.previous`. With `*`, `msg.payload` is the whole status object and `msg.topic` is `status`. By default it only emits when the value changes; an optional deadband suppresses small numeric changes. A start delay (default 1000 ms) holds back the first output after deploy so that downstream nodes, such as dashboard widgets, can initialize. Any input emits the last known value and refreshes from the device.
- **power-genius-info**: emits the device info once after connecting, either as an object or as a single property. Any input re-reads and emits it.
- **power-genius-control**: switches `operate` (standby / operate), `antenna` (port routing), `meffa` and `bias` on or off. The action is fixed in the node, or taken from `msg.topic` when the node is set to `msg.topic`; a fixed action always wins. The payload is `true`/`false`, `1`/`0` or `"on"`/`"off"`; anything else is rejected and nothing is sent.

### Status properties

The `status` reply is a list of `key=value` pairs; numbers are emitted as numbers, everything else as text.

| Property | Meaning | Values / unit |
|---|---|---|
| `state` | Amplifier state | `IDLE`, `STANDBY`, `TRANSMIT_A`, `TRANSMIT_B` |
| `bandA`, `bandB` | Band of slice A / B | metres, e.g. `20` |
| `bsrcA`, `bsrcB` | Source of the band data | e.g. `FLEX` |
| `bsrcAutoA`, `bsrcAutoB` | Band source selected automatically | 1 = yes, 0 = no |
| `flexA`, `flexB` | FlexRadio nickname | text |
| `vac` | Mains voltage | V |
| `vdd` | Supply voltage | V; 0 when not transmitting |
| `id`, `peakid` | Drain current, and its peak | A; 0 when not transmitting |
| `fwd`, `peakfwd` | Forward power, and its peak | dBm; `fwd` is 30 (the meter minimum) when there is no RF, `peakfwd` keeps the last peak |
| `swr` | Return loss | dB (negative, e.g. -18; the FLEX `RL` meter); -60 when there is no RF |
| `temp` | PA temperature | °C |
| `hltemp` | Harmonic load temperature | °C |
| `cntfreq` | Frequency counted from the RF | kHz, e.g. 14098; 0 when there is no RF |
| `cat1freq`, `cat2freq` | Frequency from CAT port 1 / 2 | kHz, 0 = none |
| `biasA`, `biasB` | Bias source | e.g. `RADIO_AB` |
| `fanmode` | Fan mode | e.g. `STANDARD` |
| `meffa` | MeFFA state | `OFF`, `ACTIVE` |
| `unkey` | Protection fault | 1 = active protection fault, 0 = normal operation |
| `antA` | Antenna connector that input A is physically connected to | 0 or 1 (0 is presumably ANT1 and 1 ANT2; only 0 seen) |
| `ants` | Antenna routing of the two ports | 0 = A to ANT1 and B to ANT2 (straight), 1 = A to ANT2 and B to ANT1 (crossed); only 0 seen |

Units are taken from the FLEX meter definitions in the API documentation and from observed values. Only 0 has been
seen for `antA` and `ants`, so what 1 means is not verified on an amplifier. Other properties may show up on other
firmware or setups: use a status node
with property `*` and a debug node to list them.

### Info properties

Collected with `setup read`, `ifconf read`, `catradio read=A|B` and `flexradio read=A|B`; each reply is parsed as `key=value` pairs.

| Property | Meaning |
|---|---|
| `name` | Device name (the `nickname`, with `_` replaced by a space) |
| `nickname` | Device name as reported |
| `firmware` | Firmware version, from the banner the device sends on connect |
| `authRequired` | `true` when the device asked for authentication (not supported yet) |
| `ledintens` | LED intensity |
| `txdelay` | TX delay |
| `inactivity-timeout` | Inactivity timeout, 0 = off |
| `authcode` | Authentication code for WAN access. Treat it as a secret: it is part of the whole info object |
| `ants`, `ant1name`..`ant3name` | Antenna setup: the `ants` setting (0 on the test amplifier) and the antenna names (empty when not set) |
| `ifconf` | Object with the network configuration: `address`, `netmask`, `gateway`, `dhcp`, `dhcpstatus` and the active `address-status`, `netmask-status`, `gateway-status` |
| `catradioA`, `catradioB` | Objects with the CAT radio configuration of slice A / B: `type`, `baud`, `parity`, `stopbits`, `civ`, `active` |
| `flexradioA`, `flexradioB` | Objects with the FlexRadio configuration of slice A / B: `serial`, `txant`, `ptt`, `active` |

## Commands used

Read-only: `status`, `setup read`, `ifconf read`, `catradio read={A|B}`, `flexradio read={A|B}`.
Through the control node: `set operate={0|1}`, `set antenna={0|1}`, `set meffa={0|1}` and `set bias={0|1}`.

| Action | 0 | 1 |
|---|---|---|
| `operate` | Standby | Operate |
| `antenna` | Straight routing of the ports (status `ants` = 0) | Crossed routing (status `ants` = 1) |
| `meffa` | MeFFA off | MeFFA on |
| `bias` | Bias profile 0 | Bias profile 1 |

These `set` commands are not in the API documentation and have not been verified on an amplifier yet. A command the
amplifier rejects is reported as an error on the control node.

## Learning what the amplifier sends

- Set the Node-RED log level to `trace` to log every line received from the amplifier.

Commands are sent as `C<seq>|<command>` terminated by a bare LF; the documentation says CR, but LF works.

Not supported: authentication (`AUTH` in the banner, only outside the local network), UDP discovery, and the FLEX radio-side commands (`amplifier create`, `meter create`, `interlock create`, ...), which the amplifier sends to the radio, not to clients.

## Example

An example flow is included. After installing, use **Import → Examples → node-red-contrib-power-genius** in the editor.
Set the host of the **power genius** server node to your amplifier before deploying. The flow is in
[examples/power-genius-example.json](examples/power-genius-example.json).

## Install

    npm install node-red-contrib-power-genius
