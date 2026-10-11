import { Room, RoomEvent, Track, ParticipantKind, type RemoteTrack } from 'livekit-client'

export type VoiceState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'ended' | 'error'

// One microphone owner per UI. Canceling a pending join must never publish later.
export class LiveVoiceConnection {
  private room: Room | null = null
  private revision = 0
  private timers: ReturnType<typeof setTimeout>[] = []
  private tracks = new Set<RemoteTrack>()
  constructor(private notify: (state: VoiceState, message?: string) => void,
    private audioRoot: HTMLElement, private makeRoom: () => Room = () => new Room()) {}

  stop() {
    this.revision++
    this.timers.forEach(clearTimeout)
    this.timers = []
    this.tracks.forEach(track => track.detach().forEach((element: HTMLElement) => element.remove()))
    this.tracks.clear()
    const room = this.room
    this.room = null
    if (room) { room.removeAllListeners(); void room.disconnect().catch(() => {}) }
  }

  async start(serverUrl: string, token: string) {
    this.stop()
    const revision = this.revision
    const room = this.makeRoom()
    this.room = room
    const current = () => this.room === room && this.revision === revision
    const fail = (message: string) => { if (current()) { this.stop(); this.notify('error', message) } }
    let hostJoined = false
    room.on(RoomEvent.ParticipantConnected, participant => {
      if (current() && participant.kind === ParticipantKind.AGENT) {
        hostJoined = true
        this.notify('connected')
      }
    })
    room.on(RoomEvent.ParticipantDisconnected, participant => {
      if (participant.kind === ParticipantKind.AGENT) fail('The host disconnected. End this call and try again.')
    })
    room.on(RoomEvent.TrackSubscribed, track => {
      if (!current() || track.kind !== Track.Kind.Audio) return
      this.tracks.add(track)
      this.audioRoot.appendChild(track.attach())
    })
    room.on(RoomEvent.TrackUnsubscribed, track => {
      track.detach().forEach(element => element.remove())
      this.tracks.delete(track)
    })
    room.on(RoomEvent.Reconnecting, () => { if (current()) this.notify('reconnecting') })
    room.on(RoomEvent.Reconnected, () => { if (current()) this.notify(hostJoined ? 'connected' : 'waiting') })
    room.on(RoomEvent.Disconnected, () => { if (current()) { this.stop(); this.notify('ended') } })
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (current() && !room.canPlaybackAudio) fail('Audio was blocked by your browser. Start the call again and allow audio.')
    })
    this.notify('connecting')
    this.timers.push(setTimeout(() => fail('The call took too long to connect. Please try again.'), 30000))
    try {
      await room.connect(serverUrl, token)
      if (!current()) { await room.disconnect(); return }
      await room.startAudio()
      if (!current()) return
      await room.localParticipant.setMicrophoneEnabled(true)
      if (!current()) { await room.disconnect(); return }
      hostJoined ||= Array.from(room.remoteParticipants.values()).some(p => p.kind === ParticipantKind.AGENT)
      this.timers.forEach(clearTimeout)
      this.timers = []
      this.notify(hostJoined ? 'connected' : 'waiting')
      this.timers.push(setTimeout(() => { if (!hostJoined) fail('The host is unavailable. Please try again shortly.') }, 20000))
      this.timers.push(setTimeout(() => { if (current()) { this.stop(); this.notify('ended', 'This five-minute call has ended. You can start another conversation.') } }, 300000))
    } catch {
      fail('Could not start live conversation. Check microphone permission and your connection, then try again.')
    }
  }
}
