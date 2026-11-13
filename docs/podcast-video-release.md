# Café Sativa video podcast release

The Smoker's Lounge reads the approved show's YouTube playlist every five minutes and features its newest published video. Configure `CAFE_SATIVA_SMOKING_PLAYLIST_ID` only after verifying that the playlist belongs to Café Sativa's intended channel. Do not use a channel-wide uploads feed. Missing/invalid configuration or an unavailable feed shows an honest audio fallback, not another channel's video.

The public audio player remains on the existing Transistor show. Transistor show 78736 already has public directory listings. Jellypod is a production workspace; changing feed URLs or redirects requires reconciliation of episode GUIDs and existing subscribers first. Pull Up a Chair is currently published in Jellypod, not yet in Transistor.

## Release procedure

1. Finish and approve the 1920×1080 master. Retain the approved narration and scene sync.
2. Upload video to the existing Transistor show. Verify the destination is Café Sativa's intended YouTube channel, not Tru Skool, Dallasite or a character account by default. Confirm the show's Apple video setup separately. Spotify video currently requires its own upload.
3. Publish to the show's dedicated playlist. The website feature follows the publication date automatically within its five-minute cache window.
4. Save the archival master in an existing **private** storage bucket. Register it through the existing VIP recordings admin and approve/release it. VIP playback uses server-side membership authorization and short-lived signed links; a public or unlisted YouTube embed is not access control.
5. Before claiming back-catalog video exclusivity, retire the corresponding public YouTube video and any other public video copies. The website does not automatically change external visibility. Public RSS audio remains public; that is distinct from the VIP video archive.

## Validation and activation gates

- This code does not configure a playlist, change account connections, redirect feeds, or publish media.
- Test the valid VIP, expired VIP, Regular, signed-out, unreleased-recording and public-bucket rejection paths in the deployed environment.
- The existing replay library is shared with live-event recordings; podcast recordings should be clearly titled with the show and episode name.
- Verify actual directory episodes and channel ownership before routing public traffic.
