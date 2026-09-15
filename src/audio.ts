/**
 * Tiny Web Audio beep used by the rest timer. No audio assets required.
 * Best-effort: if the AudioContext is unavailable or blocked, the timer
 * still runs — the beep is a cue, not a dependency.
 */

let ctx: AudioContext | null = null;

export function playBeep(frequency = 880, durationMs = 200): void {
try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durationMs / 1000 + 0.05);
} catch {
    /* audio unavailable — beep is best-effort */
}
}