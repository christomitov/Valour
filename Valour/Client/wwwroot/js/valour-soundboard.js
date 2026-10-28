/*
 * Valour microphone processor.
 *
 * Clips are posted to the Music bot, which mixes them into the track it already
 * publishes into the voice room. This file owns only the outgoing microphone:
 * Krisp noise suppression followed by an RMS gate, so typing and background
 * noise never reach the room.
 *
 * LiveKit's LocalTrack.setProcessor() ignores whatever init() returns, reads
 * processor.processedTrack, and calls destroy() and restart() on the processor,
 * so those are part of the contract here.
 */
(function () {
    "use strict";

    var GATE_HOLD_MS = 220;
    var GATE_RELEASE = 0.02;
    var GATE_ATTACK = 0.005;
    var METER_INTERVAL_MS = 60;

    // The 0..100 slider maps onto -70 dB to -15 dB, matching the settings meter.
    var METER_FLOOR_DB = -70;
    var METER_SPAN_DB = 55;

    var mixer = null;
    var meter = null;
    var meterGeneration = 0;

    function createContext() {
        var Ctor = window.AudioContext || window.webkitAudioContext;

        if (!Ctor) {
            throw new Error("Web Audio is not available");
        }

        return new Ctor({ latencyHint: "interactive" });
    }

    function readSettings() {
        var settings = { enabled: false, quality: "medium", gate: 0 };

        try {
            settings.enabled = window.localStorage.getItem("valour.noiseFilter.enabled") === "true";
            settings.quality = window.localStorage.getItem("valour.noiseFilter.quality") || "medium";
            settings.gate = parseInt(window.localStorage.getItem("valour.noiseGate.threshold") || "0", 10) || 0;
        } catch (error) {
            // Private mode or a native host without localStorage: keep defaults.
        }

        return settings;
    }

    function SoundboardMixProcessor(krisp, settings) {
        this.name = "valour-soundboard";
        this.krisp = krisp || null;
        this.settings = settings || {};
        this.lastOptions = null;

        this.context = null;
        this.ownsContext = false;
        this.source = null;
        this.gain = null;
        this.analyser = null;
        this.destination = null;
        this.krispProcessor = null;

        this.processedTrack = null;
        this.gateTimer = null;
        this.gateOpen = false;
        this.lastAboveAt = 0;
        this.destroyed = false;
        this.samples = null;
    }

    SoundboardMixProcessor.prototype.init = async function (options) {
        options = options || {};
        this.lastOptions = options;
        this.destroyed = false;

        var inputTrack = options.track;
        if (!inputTrack) {
            throw new Error("processor init needs a track");
        }

        // LiveKit hands us its own context and media element. Reusing them keeps
        // the graph on the same clock as the published track.
        this.context = options.audioContext || createContext();
        this.ownsContext = !options.audioContext;

        try {
            var resume = this.context.resume();
            if (resume && typeof resume.catch === "function") {
                resume.catch(function (error) {
                    console.warn("[valour] audio context resume failed", error);
                });
            }
        } catch (error) {
            console.warn("[valour] audio context resume failed", error);
        }

        window.valourMixerStage = "context";

        var micTrack = inputTrack;
        var settings = this.settings;

        if (this.krisp && settings.enabled) {
            try {
                this.krispProcessor = this.krisp.KrispNoiseFilter({ quality: settings.quality });

                // Krisp reads options.audioContext.sampleRate during init, so the
                // context and a media element must be supplied or it throws.
                await this.krispProcessor.init({
                    kind: "audio",
                    track: inputTrack,
                    element: options.element || document.createElement("audio"),
                    audioContext: this.context
                });

                // Krisp sets processedTrack on itself and returns nothing.
                if (this.krispProcessor.processedTrack) {
                    micTrack = this.krispProcessor.processedTrack;
                    window.valourKrispState = "active";
                } else {
                    window.valourKrispState = "no processed track";
                }
            } catch (error) {
                window.valourKrispState = "failed: " + (error && error.message ? error.message : String(error));
                console.warn("[valour] Krisp failed, publishing the raw microphone", error);
            }
        } else {
            window.valourKrispState = this.krisp ? "disabled" : "not loaded";
        }

        window.valourMixerStage = "krisp";

        this.source = this.context.createMediaStreamSource(new MediaStream([micTrack]));
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.4;
        this.samples = new Float32Array(this.analyser.fftSize);

        this.gain = this.context.createGain();
        this.gain.gain.value = 1;
        this.destination = this.context.createMediaStreamDestination();

        this.source.connect(this.analyser);
        this.source.connect(this.gain);
        this.gain.connect(this.destination);

        // LiveKit replaces the outgoing track with this one, so the gate and
        // Krisp are what listeners actually receive.
        this.processedTrack = this.destination.stream.getAudioTracks()[0];

        this.startGate();
        window.valourMixerStage = "attached";
        mixer = this;

        return this;
    };

    SoundboardMixProcessor.prototype.startGate = function () {
        var self = this;

        clearInterval(this.gateTimer);

        this.gateTimer = setInterval(function () {
            if (self.destroyed || !self.analyser || !self.gain) {
                return;
            }

            var threshold = self.settings.gate || 0;

            if (threshold <= 0) {
                // Gate disabled: leave the microphone open.
                self.gateOpen = true;
                self.gain.gain.setTargetAtTime(1, self.context.currentTime, GATE_ATTACK);
                return;
            }

            self.analyser.getFloatTimeDomainData(self.samples);

            var sum = 0;
            for (var i = 0; i < self.samples.length; i++) {
                sum += self.samples[i] * self.samples[i];
            }

            var db = 20 * Math.log10(Math.sqrt(sum / self.samples.length) || 1e-8);
            var cutoffDb = METER_FLOOR_DB + (threshold / 100) * METER_SPAN_DB;
            var now = performance.now();

            if (db >= cutoffDb) {
                self.lastAboveAt = now;
                self.gateOpen = true;
            } else if (now - self.lastAboveAt > GATE_HOLD_MS) {
                self.gateOpen = false;
            }

            var target = self.gateOpen ? 1 : 0;
            var ramp = self.gateOpen ? GATE_ATTACK : GATE_RELEASE;

            self.gain.gain.setTargetAtTime(target, self.context.currentTime, ramp);
        }, 40);
    };

    SoundboardMixProcessor.prototype.applySettings = function (settings) {
        this.settings = settings || this.settings;
    };

    SoundboardMixProcessor.prototype.destroy = function () {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        clearInterval(this.gateTimer);
        this.gateTimer = null;

        try { if (this.source) { this.source.disconnect(); } } catch (error) { /* already disconnected */ }
        try { if (this.analyser) { this.analyser.disconnect(); } } catch (error) { /* already disconnected */ }
        try { if (this.gain) { this.gain.disconnect(); } } catch (error) { /* already disconnected */ }

        if (this.krispProcessor && typeof this.krispProcessor.destroy === "function") {
            try { this.krispProcessor.destroy(); } catch (error) { /* already destroyed */ }
        }

        this.krispProcessor = null;
        this.source = null;
        this.analyser = null;
        this.gain = null;

        if (this.ownsContext && this.context) {
            try { this.context.close(); } catch (error) { /* already closed */ }
        }

        this.context = null;
        this.processedTrack = null;

        if (mixer === this) {
            mixer = null;
        }
    };

    SoundboardMixProcessor.prototype.restart = async function (options) {
        // LiveKit calls this after a device switch. Rebuild the graph around the
        // new track instead of leaving a stale one attached.
        var next = options && options.track ? options : this.lastOptions;

        if (!next || !next.track) {
            return;
        }

        this.destroy();
        await this.init(next);
    };

    SoundboardMixProcessor.prototype.status = function () {
        if (this.processedTrack) {
            return "Microphone processed, Krisp " + (window.valourKrispState || "unknown");
        }

        return "Microphone not processed";
    };

    function stopMeter() {
        meterGeneration++;

        if (!meter) {
            return;
        }

        clearInterval(meter.timer);

        try { meter.stream.getAudioTracks().forEach(function (track) { track.stop(); }); } catch (error) { /* already stopped */ }
        try { meter.context.close(); } catch (error) { /* already closed */ }

        meter = null;
    }

    window.valourSoundboard = {
        createProcessor: function (krisp, settings) {
            return new SoundboardMixProcessor(krisp, settings || readSettings());
        },

        isInCall: function () {
            return !!mixer;
        },

        status: function () {
            if (mixer) {
                return mixer.status();
            }

            if (window.valourLastMixerError) {
                return "Mixer failed: " + window.valourLastMixerError;
            }

            return "Microphone not processed";
        },

        async postSound(url) {
            var response = await fetch("/sb/sound", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ query: url })
            });

            var body = await response.text();

            if (!response.ok) {
                throw new Error(body || ("soundboard returned " + response.status));
            }

            return body;
        },

        async postStop() {
            var response = await fetch("/sb/stop", { method: "POST" });
            var body = await response.text();

            if (!response.ok) {
                throw new Error(body || ("soundboard returned " + response.status));
            }

            return body;
        },

        async startMicMeter(fillId, threshold) {
            stopMeter();

            var generation = meterGeneration;

            try {
                var stream = await navigator.mediaDevices.getUserMedia({ audio: true });

                // The component can be disposed while the permission prompt is up.
                if (generation !== meterGeneration) {
                    stream.getAudioTracks().forEach(function (track) { track.stop(); });
                    return false;
                }

                var context = createContext();

                var resume = context.resume();
                if (resume && typeof resume.catch === "function") {
                    resume.catch(function () { /* autoplay blocked, the analyser still reads */ });
                }

                var source = context.createMediaStreamSource(stream);
                var analyser = context.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.4;
                source.connect(analyser);

                var samples = new Float32Array(analyser.fftSize);

                meter = {
                    stream: stream,
                    context: context,
                    threshold: typeof threshold === "number" ? threshold : 0,
                    timer: setInterval(function () {
                        var fill = document.getElementById(fillId);
                        if (!fill || !meter) {
                            return;
                        }

                        analyser.getFloatTimeDomainData(samples);

                        var sum = 0;
                        for (var i = 0; i < samples.length; i++) {
                            sum += samples[i] * samples[i];
                        }

                        var db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-8);
                        var percent = Math.max(0, Math.min(100, ((db - METER_FLOOR_DB) / METER_SPAN_DB) * 100));

                        fill.style.width = percent.toFixed(1) + "%";
                        fill.style.background = percent >= meter.threshold ? "#3ba55d" : "#4e5058";
                    }, METER_INTERVAL_MS)
                };

                return true;
            } catch (error) {
                console.warn("[valour] microphone meter unavailable", error);
                return false;
            }
        },

        setMeterThreshold(value) {
            if (meter) {
                meter.threshold = typeof value === "number" ? value : 0;
            }
        },

        stopMicMeter() {
            stopMeter();
        }
    };
})();
