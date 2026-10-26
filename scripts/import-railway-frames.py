import argparse
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path


parser = argparse.ArgumentParser(description="Convert the supplied railway JPEG frames into the passenger hero video.")
parser.add_argument("archive", type=Path)
parser.add_argument("--ffmpeg", default="ffmpeg")
parser.add_argument("--duration", type=float, default=8)
args = parser.parse_args()
if args.duration < 2:
    parser.error("Use a duration of at least two seconds.")
root = Path(__file__).resolve().parents[1]
output = root / "public" / "images"
with tempfile.TemporaryDirectory(prefix="railway-frames-") as temporary:
    frames = Path(temporary)
    with zipfile.ZipFile(args.archive) as archive:
        entries = sorted((entry for entry in archive.infolist() if Path(entry.filename).name.startswith("frame_") and entry.filename.lower().endswith(".jpg")), key=lambda entry: entry.filename)
        if len(entries) < 3:
            parser.error("The archive must contain at least three JPEG frames.")
        for index, entry in enumerate(entries, 1):
            with archive.open(entry) as source, (frames / f"frame_{index:03d}.jpg").open("wb") as destination:
                shutil.copyfileobj(source, destination)
    frame_rate = len(entries) / args.duration
    crossfade = 0.6
    filters = (
        f"[0:v]tpad=stop_mode=clone:stop_duration=1,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
        f"trim=duration={args.duration},setpts=PTS-STARTPTS,split=2[body][head];"
        f"[body]trim=start={crossfade},setpts=PTS-STARTPTS,fps=30[tail];"
        f"[head]trim=duration={crossfade},setpts=PTS-STARTPTS,fps=30[start];"
        f"[tail][start]xfade=transition=fade:duration={crossfade}:offset={args.duration - crossfade * 2},format=yuv420p[video]"
    )
    subprocess.run([
        args.ffmpeg, "-y", "-hide_banner", "-loglevel", "warning", "-framerate", str(frame_rate),
        "-i", str(frames / "frame_%03d.jpg"), "-filter_complex", filters, "-map", "[video]",
        "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-movflags", "+faststart",
        str(output / "railway-journey-v2.mp4"),
    ], check=True)
    shutil.copyfile(frames / "frame_003.jpg", output / "railway-journey-v2-poster.jpg")
print(f"Created {output / 'railway-journey-v2.mp4'} from {len(entries)} frames.")
