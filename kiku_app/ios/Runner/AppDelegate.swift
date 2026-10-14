import Flutter
import UIKit
import AVFoundation

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "KikuAudio") else { return }
    let channel = FlutterMethodChannel(name: "kiku/audio", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler(KikuAudio.handle)
  }
}

/// Decodes MP3, M4A and the other formats AVFoundation reads into 16-bit WAV
/// for the studio and score, which read WAV and FLAC themselves.
enum KikuAudio {
  static func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    guard call.method == "decode", let args = call.arguments as? [String: Any],
          let path = args["path"] as? String, let output = args["output"] as? String else {
      result(FlutterMethodNotImplemented); return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try decode(path, to: output)
        DispatchQueue.main.async { result(output) }
      } catch {
        try? FileManager.default.removeItem(atPath: output)
        DispatchQueue.main.async { result(FlutterError(code: "audio_decode", message: error.localizedDescription, details: nil)) }
      }
    }
  }

  static func decode(_ path: String, to output: String) throws {
    try autoreleasepool {
      let url = URL(fileURLWithPath: path)
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      let input = try AVAudioFile(forReading: url)
      let format = input.processingFormat
      let seconds = Double(input.length) / format.sampleRate
      guard seconds > 0, seconds <= 660 else {
        throw NSError(domain: "KikuAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose a recording up to ten minutes long."])
      }
      let channels = min(format.channelCount, 2)
      let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: channels, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false]
      if format.channelCount <= 2 {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192) else {
          throw NSError(domain: "KikuAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Not enough memory to read this audio."])
        }
        let target = try AVAudioFile(forWriting: URL(fileURLWithPath: output), settings: settings,
                                     commonFormat: format.commonFormat, interleaved: format.isInterleaved)
        while input.framePosition < input.length {
          try input.read(into: buffer, frameCount: AVAudioFrameCount(min(8192, input.length - input.framePosition)))
          if buffer.frameLength == 0 { break }
          try target.write(from: buffer)
        }
        return
      }
      // More than two channels: a converter folds them into stereo.
      guard let stereo = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 2, interleaved: false),
            let converter = AVAudioConverter(from: format, to: stereo),
            let source = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192),
            let buffer = AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: 8192) else {
        throw NSError(domain: "KikuAudio", code: 3, userInfo: [NSLocalizedDescriptionKey: "This audio has a channel layout that cannot be read."])
      }
      let target = try AVAudioFile(forWriting: URL(fileURLWithPath: output), settings: settings,
                                   commonFormat: .pcmFormatFloat32, interleaved: false)
      while input.framePosition < input.length {
        try input.read(into: source, frameCount: AVAudioFrameCount(min(8192, input.length - input.framePosition)))
        if source.frameLength == 0 { break }
        try converter.convert(to: buffer, from: source)
        try target.write(from: buffer)
      }
    }
  }
}
