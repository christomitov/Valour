/**
 * Client-side soundboard mixer.
 *
 * Discord plays soundboard clips into your own outgoing voice stream, so every
 * listener hears them without a bot in the call. This module does the same for
 * Valour: it wraps the microphone track processor so clips are mixed into the
 * published track *after* the noise filter, which stops Krisp from treating a
 * clip as background noise and suppressing it.
 *
 * Loaded on demand by livekit.interop.js; nothing else references it.
 */
(function () {
    "use strict";

    if (window.valourSoundboard) {
        return;
    }

    const MAX_CACHED_CLIPS = 32;
    const bufferCache = new Map();
    const activeSources = new Set();
    let mixer = null;

    function createContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        return new AudioContextClass({ sampleRate: 48000, latencyHint: "interactive" });
    }

    class SoundboardMixProcessor {
        constructor(krisp, settings) {
            this.name = "valour-soundboard";
            this.krisp = krisp;
            this.settings = settings || { enabled: false, quality: "medium" };
            this.context = null;
            this.destination = null;
        }

        async init(options) {
            const inputTrack = options.track;
            let micTrack = inputTrack;

            if (this.krisp && this.settings.enabled) {
                try {
                    const processor = this.krisp.KrispNoiseFilter({ quality: this.settings.quality });
                    const result = await processor.init({ track: inputTrack });
                    if (result && result.processedTrack) {
                        micTrack = result.processedTrack;
                    }
                } catch (error) {
                    console.warn("[valour] Krisp failed, publishing the raw microphone", error);
                }
            }

            const context = createContext();
            await context.resume();

            const micSource = context.createMediaStreamSource(new MediaStream([micTrack]));
            const destination = context.createMediaStreamDestination();
            micSource.connect(destination);

            this.context = context;
            this.destination = destination;
            this.micSource = micSource;
            mixer = this;

            return {
                processedTrack: destination.stream.getAudioTracks()[0],
                destroy: async () => {
                    if (mixer === this) {
                        mixer = null;
                    }

                    this.stopAll();

                    try { this.micSource.disconnect(); } catch (error) { /* already gone */ }
                    try { await context.close(); } catch (error) { /* already closed */ }
                }
            };
        }

        stopAll() {
            for (const source of activeSources) {
                try { source.stop(); } catch (error) { /* not started */ }
            }
            activeSources.clear();
        }

        async play(url, volume) {
            if (!this.destination) {
                return false;
            }

            const buffer = await this.loadBuffer(url);
            const source = this.context.createBufferSource();
            source.buffer = buffer;

            const gain = this.context.createGain();
            gain.gain.value = typeof volume === "number" ? volume : 1;
            source.connect(gain);

            // Into the outgoing mic track, so everyone in the room hears it...
            gain.connect(this.destination);

            // ...and into the local output, so the sender hears their own clip.
            if (this.context.destination) {
                gain.connect(this.context.destination);
            }

            activeSources.add(source);
            source.onended = () => {
                activeSources.delete(source);
                try { gain.disconnect(); } catch (error) { /* already gone */ }
            };
            source.start();
            return true;
        }

        async loadBuffer(url) {
            const cached = bufferCache.get(url);
            if (cached) {
                return cached;
            }

            const response = await fetch(url, { cache: "force-cache" });
            if (!response.ok) {
                throw new Error("sound fetch failed: HTTP " + response.status);
            }

            const data = await response.arrayBuffer();
            const buffer = await this.context.decodeAudioData(data);

            if (bufferCache.size >= MAX_CACHED_CLIPS) {
                bufferCache.delete(bufferCache.keys().next().value);
            }
            bufferCache.set(url, buffer);
            return buffer;
        }
    }

    window.valourSoundboard = {
        createProcessor: (krisp, settings) => new SoundboardMixProcessor(krisp, settings),
        isInCall: () => !!mixer,
        async play(url, volume) {
            if (!mixer) {
                return false;
            }
            return mixer.play(url, volume);
        },
        stopAll() {
            if (mixer) {
                mixer.stopAll();
            }
        }
    };
})();
