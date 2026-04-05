import { findByProps } from "@vendetta/metro";
import { before, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { showToast } from "@vendetta/ui/toasts";
import { Forms } from "@vendetta/ui/components";
import { React } from "@vendetta/metro/common";

storage.enabled ??= true;

const MediaEngine = findByProps("setVideoEnabled", "setSpeaking");
const RTCUtils = findByProps("updateVideoConsumer", "setVideoConsumer");
const Dispatcher = findByProps("dispatch", "subscribe", "_subscriptions");

const patches = [];

function isEnabled() {
    return storage.enabled !== false;
}

function blockLog(context) {
    if (__DEV__) console.log("[NoStageStream] Blocked: " + context);
}

function patchDispatcher() {
    const BLOCKED_TYPES = new Set([
        "STREAM_WATCH",
        "STAGE_STREAM_WATCH",
        "STREAM_USER_WATCHED",
        "STREAM_CREATE_VIEWED",
    ]);

    patches.push(
        before("dispatch", Dispatcher, ([action]) => {
            if (!isEnabled()) return;
            if (BLOCKED_TYPES.has(action && action.type)) {
                blockLog(action.type);
                return [{ type: "__NOSTAGESTREAM_BLOCKED__" }];
            }
        })
    );
}

function patchRTCConsumer() {
    if (!RTCUtils) return;

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
}

function patchMediaEngine() {
    if (!MediaEngine || !MediaEngine.setVideoEnabled) return;

    patches.push(
        before("setVideoEnabled", MediaEngine, ([streamKey, enabled]) => {
            if (!isEnabled()) return;
            if (enabled) {
                blockLog("setVideoEnabled(" + streamKey + ", true)");
                return [streamKey, false];
            }
        })
    );
}

const { FormRow, FormSwitch, FormSection, FormText } = Forms;

export const settings = () => {
    const proxy = useProxy(storage);

    return React.createElement(
        FormSection,
        { title: "NoStageStream", caption: "Prevents Discord from auto-watching stage channel streams, saving mobile data." },
        React.createElement(FormRow, {
            label: "Block stage/stream video",
            subLabel: "When enabled, video tracks from stage streams are never downloaded.",
            trailing: React.createElement(FormSwitch, {
                value: proxy.enabled,
                onValueChange: (v) => {
                    proxy.enabled = v;
                    showToast(
                        v ? "Stream blocking ON" : "Stream blocking OFF",
                        v ? "checkmark" : "ic_close"
                    );
                }
            })
        }),
        React.createElement(FormText, {
            style: { marginHorizontal: 16, marginTop: 8, opacity: 0.6 }
        }, "Audio in stage channels is unaffected. Toggle off to watch a specific stream.")
    );
};

export default {
    onLoad() {
        patchDispatcher();
        patchRTCConsumer();
        patchMediaEngine();
        console.log("[NoStageStream] Loaded.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches.length = 0;
        console.log("[NoStageStream] Unloaded.");
    },

    settings,
};
