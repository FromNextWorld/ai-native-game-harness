# Grandpa atlas

Generated with built-in image generation from the approved XiaoTangYuan Grandpa/Meng Po and ghost-door concept art. A second background-extraction pass removed the incorrectly painted checkerboard. No external image-editing dependency is required at runtime.

Source PNG: `grandpa-atlas.png`, 1254×1254, RGBA, four 627×627 cells:

- (0,0): Grandpa idle holding the 孟 bowl.
- (1,0): Grandpa tilting the bowl; the runtime draws the stream.
- (0,1): closed spirit door.
- (1,1): open spirit door containing the bridge and dumpling Meng Po.

Generation specification: preserve approved round ivory mascot, sprout, dark eyes, rosy cheeks, white brows/beard and cyan ghost tail; retain 孟 on bowl. Compact jade door with sprout finial, gray-haired purple-shawl dumpling Meng Po inside. Exact 2×2 grid; transparent padding; no captions, terrain or baked water stream. Background-extraction pass preserves cell positions and removes checkerboard to true alpha.

The renderer embeds this file in the Mod DLL, validates dimensions and alpha, premultiplies alpha, and renders at 88px character / 144px door canvas size. Animation uses two poses, crossfading door states, translation/bobbing and procedural water particles; it is not a full hand-drawn frame-by-frame animation. Do not mirror the 孟 glyph.
