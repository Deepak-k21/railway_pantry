import { useEffect, useRef, useState } from "react";
import { Pause, Play, TrainFront } from "lucide-react";

export function RailwayScene({ compartment }: { compartment: string }) {
  const [paused, setPaused] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (paused) video.current?.pause();
    else void video.current?.play().catch(() => setPaused(true));
  }, [paused]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event: MediaQueryListEvent) => setPaused(event.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return (
    <section
      className={`railway-scene${paused ? " is-paused" : ""}`}
      aria-label="Animated railway landscape"
    >
      <video
        ref={video}
        className="railway-video"
        autoPlay={!paused}
        muted
        loop
        playsInline
        preload="auto"
        poster="/images/railway-journey-v2-poster.jpg"
        aria-hidden="true"
      >
        <source src="/images/railway-journey-v2.mp4" type="video/mp4" />
      </video>
      <div className="railway-haze" aria-hidden="true" />
      <div className="scene-label">
        <span /> THE JOY OF THE JOURNEY
      </div>
      <div className="scene-ticket">
        <TrainFront size={23} />
        <div>
          <small>YOUR COMPARTMENT</small>
          <strong>{compartment}</strong>
        </div>
        <span>
          Good food.
          <br />
          Great journeys.
        </span>
      </div>
      <button
        className="scene-motion"
        onClick={() => setPaused(!paused)}
        aria-pressed={paused}
        aria-label={
          paused ? "Play railway animation" : "Pause railway animation"
        }
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </section>
  );
}
