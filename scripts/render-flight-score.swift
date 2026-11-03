import AVFoundation
import Foundation

// Offline authoring helper. Neither the sampler nor its sound bank ships to browsers.
struct Instrument: Decodable {
    let program: UInt8
    let gain: Float
    let pan: Float
    let percussion: Bool
}
struct Note: Decodable {
    let track: Int
    let pitch: UInt8
    let velocity: UInt8
    let start: Double
    let duration: Double
}
struct Score: Decodable {
    let duration: Double
    let instruments: [Instrument]
    let notes: [Note]
}
struct Event {
    let frame: Int64
    let track: Int
    let pitch: UInt8
    let velocity: UInt8
}

let score = try JSONDecoder().decode(Score.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let bank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
let engine = AVAudioEngine()
let rate = 32000.0
let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
let loopFrames = Int64((score.duration * rate).rounded())
let samplers = try score.instruments.map { instrument in
    let sampler = AVAudioUnitSampler()
    engine.attach(sampler)
    engine.connect(sampler, to: engine.mainMixerNode, format: format)
    try sampler.loadSoundBankInstrument(at: bank, program: instrument.program,
        bankMSB: UInt8(instrument.percussion ? kAUSampler_DefaultPercussionBankMSB : kAUSampler_DefaultMelodicBankMSB), bankLSB: 0)
    sampler.overallGain = instrument.gain
    sampler.stereoPan = instrument.pan
    return sampler
}
let room = AVAudioUnitReverb()
room.loadFactoryPreset(.smallRoom)
room.wetDryMix = 8
engine.attach(room)
engine.disconnectNodeOutput(engine.mainMixerNode)
engine.connect(engine.mainMixerNode, to: room, format: format)
engine.connect(room, to: engine.outputNode, format: format)
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 1024)
try engine.start()
let file = try AVAudioFile(forWriting: output, settings: format.settings)
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 1024)!

// Three passes settle sampler/reverb tails; export the middle pass for a seamless loop.
var events = [Event]()
for pass in 0..<3 {
    for note in score.notes {
        let frame = Int64((note.start * rate).rounded()) + Int64(pass) * loopFrames
        events.append(Event(frame: frame, track: note.track, pitch: note.pitch, velocity: note.velocity))
        events.append(Event(frame: frame + Int64((note.duration * rate).rounded()), track: note.track, pitch: note.pitch, velocity: 0))
    }
}
events.sort { $0.frame == $1.frame ? $0.velocity < $1.velocity : $0.frame < $1.frame }
var next = 0
let end = loopFrames * 3
while engine.manualRenderingSampleTime < end {
    let current = engine.manualRenderingSampleTime
    while next < events.count && events[next].frame <= current {
        let event = events[next]
        let channel: UInt8 = score.instruments[event.track].percussion ? 9 : 0
        if event.velocity == 0 {
            samplers[event.track].stopNote(event.pitch, onChannel: channel)
        } else {
            samplers[event.track].startNote(event.pitch, withVelocity: event.velocity, onChannel: channel)
        }
        next += 1
    }
    let nextFrame = next < events.count ? events[next].frame : end
    let frames = AVAudioFrameCount(min(1024, end - current, nextFrame - current))
    if frames == 0 { continue }
    switch try engine.renderOffline(frames, to: buffer) {
    case .success: try file.write(from: buffer)
    case .cannotDoInCurrentContext: continue
    default: fatalError("Offline sampler could not render the score")
    }
}
engine.stop()
print("Rendered \(score.notes.count) original notes with \(samplers.count) instruments")
