

magick globe-big.jpg \
  -alpha set -background none -fuzz 15% -fill none -opaque white \
  -resize 256x256 \
  -define icon:auto-resize=256,64,48,32,16 \                                      
  favicon.ico


magick globe-big.jpg -alpha set -background none -fuzz 18% -fill none -opaque white -shave 2x2 -bordercolor none -border 4 -filter Lanczos -resize 256x256 \( -clone 0 -resize 16x16 -sharpen 0x1.0 -write favicon-16.png \) \( -clone 0 -resize 32x32 -sharpen 0x1.0 -write favicon-32.png \) \( -clone 0 -resize 64x64 -sharpen 0x1.0 -write favicon-64.png \) \( -clone 0 -resize 180x180 -sharpen 0x1.0 -write apple-touch-icon-180.png \) -delete 0-3
