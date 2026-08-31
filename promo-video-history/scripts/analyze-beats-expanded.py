from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt


ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "public" / "audio" / "bgm-expanded.mp3"
ANALYSIS_WAV = Path(tempfile.gettempdir()) / "linggan-expanded-beat-analysis.wav"


subprocess.run(
    [
        "ffmpeg", "-y", "-v", "error", "-t", "104", "-i", str(AUDIO),
        "-ac", "1", "-ar", "8000", str(ANALYSIS_WAV),
    ],
    check=True,
)
sr, pcm = wavfile.read(ANALYSIS_WAV)
y = pcm.astype(np.float64) / max(1, np.iinfo(pcm.dtype).max)
sos = butter(4, [40, 160], btype="band", fs=sr, output="sos")
kick = sosfilt(sos, y)
window = 256
hop = 64
power = np.convolve(kick * kick, np.ones(window) / window, mode="valid")
envelope = np.sqrt(np.maximum(0, power[::hop]))
times = (np.arange(len(envelope)) * hop + window / 2) / sr

best = None
for bpm_candidate in np.arange(84.0, 88.01, 0.05):
    interval_candidate = 60.0 / bpm_candidate
    for phase in np.linspace(0.0, interval_candidate, 128, endpoint=False):
        grid = np.arange(phase, times[-1], interval_candidate)
        indexes = np.searchsorted(times, grid)
        indexes = np.clip(indexes, 1, len(times) - 1)
        left = indexes - 1
        nearest = np.where(
            np.abs(times[indexes] - grid) < np.abs(times[left] - grid),
            indexes,
            left,
        )
        score = float(np.mean(envelope[nearest]))
        if best is None or score > best[0]:
            best = (score, float(bpm_candidate), float(phase))

assert best is not None
_, bpm, beat_zero = best
interval = 60.0 / bpm
beat_count = int((times[-1] - beat_zero) / interval)
energies = []
for beat in range(max(0, beat_count)):
    second = beat_zero + beat * interval
    energy = float(envelope[np.argmin(np.abs(times - second))])
    energies.append({"beat": beat, "second": round(second, 6), "energy": round(energy, 6)})

result = {
    "audio": AUDIO.name,
    "sampleRate": sr,
    "durationSeconds": round(len(y) / sr, 6),
    "bpm": round(bpm, 6),
    "beatZeroSeconds": round(beat_zero, 6),
    "beatIntervalSeconds": round(interval, 8),
    "phaseMethod": "low-frequency RMS grid search across 84-88 BPM",
    "strongestBeats": sorted(energies, key=lambda item: item["energy"], reverse=True)[:32],
}
print(json.dumps(result, ensure_ascii=False, indent=2))
