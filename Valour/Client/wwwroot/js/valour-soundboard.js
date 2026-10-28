/**
 * Client-side soundboard mixer and microphone gate.
 *
 * Discord plays soundboard clips into your own outgoing voice stream, so every
 * listener hears them without a bot in the call. This module does the same for
 * Valour: it wraps the microphone track processor so clips are mixed into the
 * published track *after* the noise filter, which stops Krisp from treating a
 * clip as background noise and suppressing it.
 *
 * It also implements Discord's squelch: when the input sensitivity threshold is
 * set, microphone audio below that level is gated out, so a keyboard, fan or TV
 * does not reach the room.
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
        return new AudioContextClass({ latencyHint: "interactive" });
    }

    class SoundboardMixProcessor {
        constructor(krisp, settings) {
            this.name = "valour-soundboard";
            this.krisp = krisp;
            this.settings = settings || { enabled: false, quality: "medium", gate: 0 };
            this.context = null;
            this.destination = null;
            this.gateTimer = null;
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

            // Do not await resume(). An autoplay-blocked context leaves that
            // promise pending, which previously aborted the whole processor and
            // left the microphone raw, with no Krisp and no mixer.
            const resume = context.resume();
            if (resume && typeof resume.catch === "function") {
                resume.catch(error => console.warn("[valour] audio context resume failed", error));
            }

            const micSource = context.createMediaStreamSource(new MediaStream([micTrack]));
            const destination = context.createMediaStreamDestination();

            this.context = context;
            this.destination = destination;
            this.micSource = micSource;
            this.gate = this.settings.gate > 0 ? this.settings.gate : 0;

            if (this.gate > 0) {
                this.attachGate(context, micSource, destination);
            } else {
                micSource.connect(destination);
            }

            mixer = this;

            return {
                processedTrack: destination.stream.getAudioTracks()[0],
                destroy: async () => {
                    if (mixer === this) {
                        mixer = null;
                    }

                    this.stopAll();

                    if (this.gateTimer) {
                        clearInterval(this.gateTimer);
                        this.gateTimer = null;
                    }

                    try { this.micSource.disconnect(); } catch (error) { /* already gone */ }
                    try { await context.close(); } catch (error) { /* already closed */ }
                }
            };
        }

        attachGate(context, source, destination) {
            const analyser = context.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.3;

            const gate = context.createGain();
            gate.gain.value = 0;

            source.connect(analyser);
            source.connect(gate);
            gate.connect(destination);

            const samples = new Float32Array(analyser.fftSize);

            // The slider runs 1..100 and maps onto a usable range of speech
            // levels, where 100 is the most aggressive gate.
            const thresholdDb = -70 + (this.gate / 100) * 55;

            this.gateTimer = setInterval(() => {
                analyser.getFloatTimeDomainData(samples);

                let sum = 0;
                for (let i = 0; i < samples.length; i++) {
                    sum += samples[i] * samples[i];
                }

                const rms = Math.sqrt(sum / samples.length);
                const db = 20 * Math.log10(rms || 1e-8);
                const open = db > thresholdDb;

                gate.gain.setTargetAtTime(open ? 1 : 0, context.currentTime, open ? 0.01 : 0.06);
            }, 40);
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

            // Into the outgoing mic track, so everyone in the room hears it.
            // Clips bypass the gate, otherwise quiet clips would be squelched.
            gain.connect(this.destination);

            // Into the local output too, so the sender hears their own clip.
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
        status() {
            if (mixer) {
                return "In call";
            }

            if (window.valourLastMixerError) {
                const error = window.valourLastMixerError;
                return "Mixer failed: " + (error && error.message ? error.message : String(error));
            }

            return "Turn your microphone on to hear clips";
        },
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
