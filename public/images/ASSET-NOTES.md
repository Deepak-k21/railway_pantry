# Railway landscape

`railway-landscape-v1.png` was generated with the built-in image generation tool for this project. It is decorative artwork, not a photograph of the service or a claim of railway affiliation.

## Final prompt

Use case: stylized-concept. Asset type: railway website landscape backdrop. Create a premium editorial 3D miniature Indian railway landscape, wide horizontal composition. Sweeping curved railway track crossing a low arched viaduct among soft sculpted hills, tiny trees, warm sunrise orb and subtle clouds. No train (an animated train will be rendered separately in the website). Smooth clay and porcelain materials, sophisticated deep midnight blue, lavender, apricot, teal and cream palette. Isometric elevated camera, luminous soft shadows, beautiful spacious composition, no text, no logos, no watermark. Designed as a decorative background behind a code-rendered railway train.

## Motion implementation

The active passenger animation is `railway-journey-v2.mp4`, converted from the user's `gemini_generated_video_2e128aee_frames.zip` containing 30 JPEG frames at 1280×720. With no original timing metadata supplied, the conversion uses an eight-second source sequence, interpolates motion to 30 fps and overlaps the end/start by 0.6 seconds for a soft loop. H.264, YUV420P and fast-start metadata support browser playback. `railway-journey-v2-poster.jpg` comes from the supplied sequence. `client/RailwayScene.tsx` supplies the muted inline player, compartment ticket, pause control and reduced-motion support. No runtime frame downloads or external video service is needed.

To regenerate, install Python and FFmpeg and run `python scripts/import-railway-frames.py path/to/gemini_generated_video_2e128aee_frames.zip`. Use `--ffmpeg path/to/ffmpeg` or `--duration 8` to override the executable or source timing. The archive is only needed for regeneration; the MP4 and poster are shipped with the app. The previous `railway-journey-v1.webm` and `scripts/render-railway-video.ts` are retained as earlier artwork; the passenger player no longer uses them. The original landscape remains the admin/staff login backdrop.

Design research: https://21st.dev/community/components/s/animated-hero and https://21st.dev/community/components/s/card. The layout and effects are original project code inspired by the catalog's animated hero, shimmer-button and elevated-card patterns; no third-party component source was copied.
