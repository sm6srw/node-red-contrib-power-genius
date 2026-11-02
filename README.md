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
- **power-genius-control**: switches `operate` (standby / operate), selects the `antenna` (1-3, amplifiers with the antenna switch only), sets the `fanmode` (`STANDARD`, `CONTEST` or `BROADCAST`), or sends any command (`command`, the payload is the command) and outputs the reply as `msg.payload`. The action is fixed in the node, or taken from `msg.topic` when the node is set to `msg.topic`; a fixed action always wins. For `operate` the payload is `true`/`false`, `1`/`0` or `"on"`/`"off"`; anything else is rejected and nothing is sent.

### Status properties

The `status` reply is a list of `key=value` pairs; numbers are emitted as numbers, everything else as text.

| Property | Meaning | Values / unit |
|---|---|---|
| `state` | Amplifier state | `STANDBY`, `IDLE` (operate, not transmitting), `TRANSMIT_A`, `TRANSMIT_B`; probably `FAULT` |
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
| `biasA`, `biasB` | Bias setting of input A / B, as `SOURCE_MODE` | e.g. `RADIO_AB`; others seen elsewhere: `AUTO_AAB`, `MANUAL_A` |
| `fanmode` | Fan mode | `STANDARD`, `CONTEST`, `BROADCAST` |
| `meffa` | MeFFA state | `OFF`, `ACTIVE`; may name a fault such as SWR, TEMP or CURRENT |
| `unkey` | Protection fault | 1 = active protection fault, 0 = normal operation |
| `antA` | Antenna selected on the antenna switch | Only on the 3-port antenna switch version; 0 on the SO2R version, which has no switch |
| `ants` | Antenna switch | 0 on the SO2R version (no antenna switch); values on the antenna switch version not seen yet |

Units are taken from the FLEX meter definitions in the API documentation and from observed values. There are two
hardware versions: SO2R, and one with a 3-port antenna switch. `antA` and `ants` were only seen on the SO2R version.
Other properties may show up on other
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
| `ants`, `ant1name`..`ant3name` | Antenna switch setup: `ants` (0 on the SO2R version, which has no switch) and the names of antennas 1-3 (empty when not set) |
| `ifconf` | Object with the network configuration: `address`, `netmask`, `gateway`, `dhcp`, `dhcpstatus` and the active `address-status`, `netmask-status`, `gateway-status` |
| `catradioA`, `catradioB` | Objects with the CAT radio configuration of slice A / B: `type`, `baud`, `parity`, `stopbits`, `civ`, `active` |
| `flexradioA`, `flexradioB` | Objects with the FlexRadio configuration of slice A / B: `serial`, `txant`, `ptt`, `active` |

## Commands used

Read-only: `status`, `setup read`, `ifconf read`, `catradio read={A|B}`, `flexradio read={A|B}`.
Through the control node: `operate={0|1}` (0 = standby, 1 = operate), `antenna={n}` (select the antenna, only on the
antenna switch version), `setup fanmode={STANDARD|CONTEST|BROADCAST}` and anything with the `command` action.

`operate` comes from another open-source PGXL client ([Log4YM](https://github.com/brianbruff/Log4YM)) and works; it is not
in the API documentation. `set operate=...` is rejected by the amplifier (error `0x50000015`, unknown command), so the commands
are bare `name=value`. `antenna=1` is known to exist: the SO2R version answers `0x50000013 - No antenna switch on this hardware`.
The antenna numbers (assumed 1-3) have not been tried on an amplifier with the switch.

## Learning what the amplifier sends

- Set the Node-RED log level to `trace` to log every line received from the amplifier.
- Use a **power-genius-control** node with action `command` to try commands and see the replies. An error with result code `0x50000015` means the amplifier does not know the command.

Commands are sent as `C<seq>|<command>` terminated by a bare LF; the documentation says CR, but LF works.

Not supported: authentication (`AUTH` in the banner, only outside the local network), UDP discovery, and the FLEX radio-side commands (`amplifier create`, `meter create`, `interlock create`, ...), which the amplifier sends to the radio, not to clients.

## Example

An example flow is included. After installing, use **Import → Examples → node-red-contrib-power-genius** in the editor.
Set the host of the **power genius** server node to your amplifier before deploying. The flow is in
[examples/power-genius-example.json](examples/power-genius-example.json).

## Install

    npm install node-red-contrib-power-genius
