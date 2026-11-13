"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type Check = "idle" | "running" | "ok" | "fail";

/** "Test my setup" — a real device check: requests camera+mic, shows a live
 *  preview and a mic level meter so the student can confirm before the interview. */
export function TestSetupButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [cam, setCam] = useState<Check>("idle");
  const [mic, setMic] = useState<Check>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Bumped by every run() and by close/unmount; an await that resumes with a stale
  // token must release whatever it acquired instead of attaching it.
  const runTokenRef = useRef(0);

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function run() {
    stop();
    const token = ++runTokenRef.current;
    const stale = () => token !== runTokenRef.current;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    const release = () => {
      ctx?.close().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
    };
    setCam("running");
    setMic("running");
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't access your camera and mic.");
      setCam("fail");
      setMic("fail");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (stale()) return release();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        if (stale()) return; // stop() (via close/unmount/new run) already released streamRef
      }
      setCam(stream.getVideoTracks().length ? "ok" : "fail");
      setMic(stream.getAudioTracks().length ? "ok" : "fail");

      // live mic level meter
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(100, Math.round((peak / 128) * 100 * 1.8)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      if (stale()) return release();
      stop();
      release();
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Permission denied. Allow camera and mic access in your browser, then try again."
          : "We couldn't reach your camera or mic. Check they're connected and not in use."
      );
      setCam("fail");
      setMic("fail");
    }
  }

  // Release camera/mic if the component unmounts while the test is running.
  useEffect(
    () => () => {
      runTokenRef.current++;
      stop();
    },
    []
  );

  function openDialog() {
    setOpen(true);
    // The video element mounts with the dialog; give it a tick before attaching the stream.
    void run();
  }

  function close() {
    runTokenRef.current++;
    stop();
    setOpen(false);
    setCam("idle");
    setMic("idle");
    setLevel(0);
    setError(null);
  }

  const dot = (s: Check) =>
    s === "ok" ? "bg-mint" : s === "fail" ? "bg-amberline" : s === "running" ? "bg-amberline animate-pulse" : "bg-rule";

  return (
    <>
      <button onClick={openDialog} className={className}>
        Test my setup
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="student block max-w-md rounded-2xl bg-white p-5 sm:max-w-md">
          <div>
            <DialogTitle className="font-display text-lg font-semibold text-graphite">Test your setup</DialogTitle>

            <div className="mt-3 aspect-video overflow-hidden rounded-xl bg-graphite">
              <video
                ref={(el) => {
                  videoRef.current = el;
                  if (el && streamRef.current && el.srcObject !== streamRef.current) {
                    el.srcObject = streamRef.current;
                    el.play().catch(() => {});
                  }
                }}
                muted playsInline className="size-full object-cover" />
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${dot(cam)}`} />
                <span className="text-graphite">Camera {cam === "ok" ? "working" : cam === "fail" ? "not available" : "checking…"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${dot(mic)}`} />
                <span className="text-graphite">Microphone {mic === "ok" ? "working" : mic === "fail" ? "not available" : "checking…"}</span>
              </div>
              {mic === "ok" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-pencil">Level</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-rule">
                    <span className="block h-full rounded-full bg-mint transition-[width] duration-75" style={{ width: `${level}%` }} />
                  </span>
                </div>
              )}
            </div>

            {error && <p className="mt-3 rounded-lg bg-amberline-soft p-3 text-sm text-graphite">{error}</p>}
            {cam === "ok" && mic === "ok" && !error && (
              <p className="mt-3 rounded-lg bg-mint-soft p-3 text-sm text-mint">You&apos;re good to go. Say something to see the mic level move.</p>
            )}

            <div className="mt-4 flex gap-2">
              {(cam === "fail" || mic === "fail") && (
                <button onClick={() => void run()} className="min-h-[44px] flex-1 rounded-xl bg-graphite font-bold text-white">Try again</button>
              )}
              <button onClick={close} className="min-h-[44px] flex-1 rounded-xl border-[1.5px] border-graphite bg-white font-bold text-graphite">Done</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
