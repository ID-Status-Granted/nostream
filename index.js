import { findByProps, findByName } from “@vendetta/metro”;
import { before, instead } from “@vendetta/patcher”;
import { storage } from “@vendetta/plugin”;
import { useProxy } from “@vendetta/storage”;
import { showToast } from “@vendetta/ui/toasts”;

// ── Defaults ──────────────────────────────────────────────────────────────────
storage.enabled ??= true;

// ── Module hunting ────────────────────────────────────────────────────────────
// MediaEngine / RTC controls used to actually receive/render the video stream
const MediaEngine  = findByProps(“setVideoEnabled”, “setSpeaking”);
// RTCConnection patches – Discord calls selectProtocol/setRemoteDescription
// when it starts pulling a video track for a stage stream.
const RTCUtils     = findByProps(“updateVideoConsumer”, “setVideoConsumer”);
// The store that tracks which streams you are “watching”
const StreamStore  = findByProps(“getViewingStreams”, “getAllStreams”);
// Action dispatcher so we can intercept STREAM_WATCH / STAGE_STREAM_WATCH
const Dispatcher   = findByProps(“dispatch”, “subscribe”, “_subscriptions”);

// ── Patches array ─────────────────────────────────────────────────────────────
const patches = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function isEnabled() {
return storage.enabled !== false;
}

function blockLog(context) {
if (**DEV**) console.log(`[NoStageStream] Blocked: ${context}`);
}

// ── Core patch: intercept the Flux action that starts stream watching ─────────
//
// Discord dispatches one of these action types when a stage stream begins:
//   • STREAM_WATCH           – Go-live streams in voice channels
//   • STAGE_STREAM_WATCH     – Newer stage-channel video streams
//
// By swallowing the action we prevent the client from subscribing to the video
// track at all, which means zero extra bandwidth beyond the audio you already
// receive as a stage audience member.

function patchDispatcher() {
const BLOCKED_TYPES = new Set([
“STREAM_WATCH”,
“STAGE_STREAM_WATCH”,
“STREAM_USER_WATCHED”,       // prevents “now watching” state update
“STREAM_CREATE_VIEWED”,      // some builds use this variant
]);

```
patches.push(
    before("dispatch", Dispatcher, ([action]) => {
        if (!isEnabled()) return;
        if (BLOCKED_TYPES.has(action?.type)) {
            blockLog(action.type);
            // Return a dummy resolved promise so callers don't throw
            return [{ type: "__NOSTAGESTREAM_BLOCKED__" }];
        }
    })
);
```

}

// ── Secondary patch: block video consumer even if dispatch slips through ──────
//
// RTCUtils.updateVideoConsumer is what actually starts pulling encoded video
// frames over the wire.  We no-op it when our toggle is on.

function patchRTCConsumer() {
if (!RTCUtils) return;

```
patches.push(
    instead("updateVideoConsumer", RTCUtils, (args, orig) => {
        if (!isEnabled()) return orig(...args);
        blockLog("updateVideoConsumer");
        return Promise.resolve();
    })
);

if (RTCUtils.setVideoConsumer) {
    patches.push(
        instead("setVideoConsumer", RTCUtils, (args, orig) => {
            if (!isEnabled()) return orig(...args);
            blockLog("setVideoConsumer");
            return Promise.resolve();
        })
    );
}
```

}

// ── Tertiary patch: keep video disabled in MediaEngine ────────────────────────
//
// Even if a video track sneaks in, we tell MediaEngine the remote video is
// disabled so no decoding work happens on the CPU and no frames are rendered.

function patchMediaEngine() {
if (!MediaEngine?.setVideoEnabled) return;

```
patches.push(
    before("setVideoEnabled", MediaEngine, ([streamKey, enabled]) => {
        if (!isEnabled()) return;
        if (enabled) {
            blockLog(`setVideoEnabled(${streamKey}, true)`);
            return [streamKey, false]; // force it off
        }
    })
);
```

}

// ── Settings UI ───────────────────────────────────────────────────────────────
import { Forms } from “@vendetta/ui/components”;
import { React } from “@vendetta/metro/common”;

const { FormRow, FormSwitch, FormSection, FormText } = Forms;

export const settings = () => {
const proxy = useProxy(storage);

```
return (
    <FormSection title="NoStageStream" caption="Prevents Discord from auto-watching stage channel streams — saving mobile data.">
        <FormRow
            label="Block stage/stream video"
            subLabel="When enabled, video tracks from stage streams are never downloaded."
            trailing={
                <FormSwitch
                    value={proxy.enabled}
                    onValueChange={(v) => {
                        proxy.enabled = v;
                        showToast(
                            v ? "Stream blocking ON" : "Stream blocking OFF",
                            v ? "✅" : "⏸️"
                        );
                    }}
                />
            }
        />
        <FormText style={{ marginHorizontal: 16, marginTop: 8, opacity: 0.6 }}>
            Audio in stage channels is unaffected — only the video stream is blocked.
            Toggle off temporarily if you want to watch a specific stream.
        </FormText>
    </FormSection>
);
```

};

// ── Plugin lifecycle ──────────────────────────────────────────────────────────
export default {
onLoad() {
patchDispatcher();
patchRTCConsumer();
patchMediaEngine();
console.log(”[NoStageStream] Loaded – stage stream video blocking active.”);
},

```
onUnload() {
    for (const unpatch of patches) unpatch();
    patches.length = 0;
    console.log("[NoStageStream] Unloaded – patches removed.");
},

settings,
```

};
