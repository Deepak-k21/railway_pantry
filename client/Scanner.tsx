import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Camera, CameraOff } from "lucide-react";
import { isAllowedOrigin } from "../shared/origins";
export function extractToken(value: string) {
  const clean = value.trim();
  if (!clean.includes("/")) {
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(clean))
      throw new Error("Paste a complete pantry QR link or code.");
    return clean;
  }
  const url = new URL(clean, window.location.origin);
  if (
    !isAllowedOrigin(
      url.origin,
      window.location.origin,
      window.location.protocol === "http:",
    )
  )
    throw new Error("Use a QR code issued by this Railway Pantry website.");
  const match = url.pathname.match(/^\/(p|scan)\/([A-Za-z0-9_-]+)$/);
  if (!match) throw new Error("This is not a pantry QR link.");
  return match[2];
}
export function Scanner({
  onRead,
  autoStart = false,
  description = "Point at a food item or staff compartment code.",
}: {
  onRead: (value: string) => void;
  autoStart?: boolean;
  description?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const [running, setRunning] = useState(autoStart);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!running) return;
    let closed = false;
    let handled = false;
    const element = video.current;
    void import("@zxing/browser")
      .then(async ({ BrowserQRCodeReader }) => {
        if (closed) return;
        const reader = new BrowserQRCodeReader();
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera access requires HTTPS or localhost.");
        return reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          element!,
          (result, _error, controller) => {
            if (result && !handled && !closed) {
              handled = true;
              controller.stop();
              controls.current = null;
              setRunning(false);
              try {
                onRead(extractToken(result.getText()));
              } catch (error) {
                setError((error as Error).message);
              }
            }
          },
        );
      })
      .then((controller) => {
        if (controller) {
          if (closed) controller.stop();
          else controls.current = controller;
        }
      })
      .catch(() => {
        if (!closed) {
          setRunning(false);
          setError(
            "Camera unavailable or permission denied. Paste the QR link or code below. Camera access requires HTTPS or localhost.",
          );
        }
      });
    return () => {
      closed = true;
      controls.current?.stop();
      controls.current = null;
      const stream = element?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      if (element) element.srcObject = null;
    };
  }, [running, onRead]);
  return (
    <div className="scanner">
      <div className="scanner-heading">
        <Camera size={23} />
        <div>
          <h3>Scan a QR with your camera</h3>
          <p>{description}</p>
        </div>
      </div>
      <video ref={video} muted playsInline hidden={!running} />
      <button
        type="button"
        className="camera-trigger"
        onClick={() => {
          setError("");
          setRunning(!running);
        }}
      >
        {running ? <CameraOff size={19} /> : <Camera size={19} />}
        {running ? "Stop camera" : "Scan with camera"}
      </button>
      {running && (
        <p role="status" className="muted">
          Camera active. Hold the QR steady inside the preview.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
