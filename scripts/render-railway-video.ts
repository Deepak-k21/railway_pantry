import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const image = await readFile("public/images/railway-landscape-v1.png");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.evaluate("window.__name = (value) => value");
  const encoded = await page.evaluate(
    async (source) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable.");
      const landscape = new Image();
      landscape.src = source;
      await landscape.decode();
      const mimeType = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType)
        throw new Error("This browser cannot record a WebM video.");
      const stream = canvas.captureStream(24);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_800_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };

      function drawCar(
        position: number,
        colour: string,
        word: string,
        scale: number,
      ) {
        const x = position;
        const y = 190 + x * 0.24;
        context!.save();
        context!.translate(x, y);
        context!.rotate(Math.atan(0.24));
        context!.scale(scale, scale);
        context!.fillStyle = "#13223d66";
        context!.beginPath();
        context!.ellipse(0, 13, 90, 14, 0, 0, Math.PI * 2);
        context!.fill();
        context!.fillStyle = "#e8e2d9";
        context!.fillRect(-81, 3, 166, 7);
        context!.fillStyle = colour;
        context!.beginPath();
        context!.roundRect(-82, -57, 165, 61, 9);
        context!.fill();
        context!.fillStyle = "#f4e9da";
        context!.beginPath();
        context!.moveTo(-75, -57);
        context!.lineTo(78, -57);
        context!.lineTo(91, -47);
        context!.lineTo(-65, -47);
        context!.closePath();
        context!.fill();
        context!.fillStyle = "#223953";
        for (let index = 0; index < 4; index++) {
          context!.beginPath();
          context!.roundRect(-67 + index * 36, -43, 26, 21, 4);
          context!.fill();
          context!.fillStyle = "#b9e1e6";
          context!.fillRect(-64 + index * 36, -41, 20, 5);
          context!.fillStyle = "#223953";
        }
        context!.fillStyle = "#fff0d5";
        context!.font = "bold 8px system-ui";
        context!.fillText(word, -65, -8);
        context!.fillStyle = "#1d2a39";
        for (const wheelX of [-50, 50]) {
          context!.beginPath();
          context!.arc(wheelX, 9, 11, 0, Math.PI * 2);
          context!.fill();
          context!.fillStyle = "#c5cdda";
          context!.beginPath();
          context!.arc(wheelX, 9, 4, 0, Math.PI * 2);
          context!.fill();
          context!.fillStyle = "#1d2a39";
        }
        context!.restore();
      }

      function frame(elapsed: number) {
        context!.drawImage(landscape, 0, 0, canvas.width, canvas.height);
        const position = 500 + 1100 * (elapsed / 7000);
        const scale = 0.82 + 0.2 * (elapsed / 7000);
        context!.save();
        context!.globalAlpha = Math.max(
          0,
          Math.min(1, elapsed / 450, (7000 - elapsed) / 600),
        );
        drawCar(position - 350, "#4f9699", "RAILWAY", scale);
        drawCar(position - 175, "#847bb7", "RAILWAY", scale);
        drawCar(position, "#db936e", "PANTRY", scale);
        context!.restore();
      }

      frame(0);
      recorder.start();
      await new Promise<void>((resolve) => {
        const started = performance.now();
        const step = () => {
          const elapsed = performance.now() - started;
          frame(Math.min(elapsed, 7000));
          if (elapsed < 7000) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      const recording = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("Video recording failed."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      const blob = await recording;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(new Error("Could not save the recording."));
        reader.readAsDataURL(blob);
      });
    },
    `data:image/png;base64,${image.toString("base64")}`,
  );
  await writeFile(
    "public/images/railway-journey-v1.webm",
    Buffer.from(encoded, "base64"),
  );
  console.log("Saved public/images/railway-journey-v1.webm");
} finally {
  await browser.close();
}
