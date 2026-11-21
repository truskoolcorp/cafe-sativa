# Isolated Stage playback check

`synthetic-clip.webm` is a deliberately low-resolution FFmpeg test pattern
and a generated tone. It has no Café Sativa production footage, rights-bound
music, account data, or credentials. The checked-in fixture lets the GitHub
runner exercise native browser playback without installing a media encoder or
fetching anything over the network. Keep a seekable WebM with video and audio.
To regenerate:

```sh
ffmpeg -f lavfi -i "color=c=black:s=96x54:r=8,drawbox=x=8:y=8:w=44:h=30:color=white:t=fill:enable='lt(mod(t,2),1)'" \
  -f lavfi -i sine=frequency=300:sample_rate=48000 \
  -t 16 -c:v libvpx -g 8 -b:v 16k -c:a libopus -b:a 12k \
  tests/browser/stage/synthetic-clip.webm
```

This check mounts the actual player in two isolated browser contexts. It is
not evidence for hosted access controls, the approved premiere cut, actual
speaker output, audience moderation, or VIP entitlement.
