# Background music

“Easy Lemon” — Kevin MacLeod (incompetech.com)
Licensed under Creative Commons Attribution 4.0:
https://creativecommons.org/licenses/by/4.0/

Official track and licence declaration:
https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1200076
Downloaded 2026-10-02 from:
https://incompetech.com/music/royalty-free/mp3-royaltyfree/Easy%20Lemon.mp3

MP3 unmodified. The browser loops it and applies a quiet gain / fade-in.
Visible attribution and licence links are in the game's pause panel.

## Night background music

“Dream Culture” — Kevin MacLeod (incompetech.com)
Licensed under Creative Commons Attribution 4.0:
https://creativecommons.org/licenses/by/4.0/

Official track and licence declaration:
https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1300046
Downloaded 2026-10-03 from:
https://incompetech.com/music/royalty-free/mp3-royaltyfree/Dream%20Culture.mp3

The original MP3 is preserved in assets-source/audio/dream-culture.mp3 and
copied unchanged to the runtime. Day uses Easy Lemon; night uses Dream Culture.
The browser loops both tracks, crossfades over two seconds, and preserves their
playheads when paused. Both use the music controls and house-radio ducking.
Visible attribution and licence links are in the game's pause panel.

# Vehicle sounds

Original runtime Web Audio synthesis in src/audio.js, written for this project.
No third-party engine, tyre, brake or collision recordings. Low-pass filtered
oscillators and deterministic noise, independent gain controls, no horn or
screech effects. Defaults music 18%, effects bus 22%; user controls capped at 35%.
The engine/tyre signals themselves have additional small gains before the bus.
These are relative software gains, not a guarantee of physical loudness on any speaker.

# Nohara house radio

`dgcr.mp3` — user-supplied 动感超人之歌, copied unchanged from
`assets-source/audio/dgcr.mp3`. No additional licence information supplied.
Loops after the user starts play, with distance gain, stereo direction,
low-pass filtering and background-music ducking near the house.

# Animal effects

`mama_niulai.wav`, `mama.wav`, `niulai.mp3`, `jiaoli.mp3`, `niu_angry.mp3`,
`cow-moo.mp3`, `cow-goes-m.mp3`, `g-know.mp3`, `g-cow-fllow.mp3`,
`wolf.mp3`, `cat.mp3`, `cute-cat.mp3`: user-supplied files, copied unchanged
from assets-source/audio. No additional licence information was supplied.
Runtime media events, volume and cooldowns are controlled by the game.

# Zombie corral effects

`zombies_noooomp.mp3`: user-supplied zombie voice meaning “No”, copied unchanged
from `assets-source/audio/zombies_noooomp.mp3`. No additional licence information
was supplied. Requested once when animals clear the corral gate. Gate creaks,
latch and hoof steps use project-authored Web Audio synthesis. Animal escape
calls reuse the existing user-supplied touch recordings; confined wolves are silent.

# Shiro preview effects

Paw steps, bark and whine are project-authored Web Audio synthesis in
src/exploration-audio.js. Retired human speech files and their original
attribution are retained in local-archive/characters-2026-10-04/.

# Lookout alarm voice

`pvz-brains.mp3`: Plants vs. Zombies zombie “Brains…” voice (`Groan5.ogg`,
1.526712 seconds), selected by the user for the lookout's calf alarm.
Source: https://plantsvszombies.fandom.com/wiki/File:Groan5.ogg
Original OGG retained at `assets-source/audio/pvz-brains.ogg`; the runtime MP3
is an untrimmed FFmpeg conversion for browser compatibility. Game audio belongs
to PopCap/EA; no separate reuse licence was supplied by the source.
The wiki's text licence is not treated as a licence for the game recording.
Requested once during an alarm; plain manual bell ringing has no voice.
