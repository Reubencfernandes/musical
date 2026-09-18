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
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "ScoreStudioAudio") else { return }
    let channel = FlutterMethodChannel(name: "score_studio/audio", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { call, result in
      guard call.method == "decode", let args = call.arguments as? [String: Any],
            let path = args["path"] as? String, let output = args["output"] as? String else {
        result(FlutterMethodNotImplemented); return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try autoreleasepool {
            let url = URL(fileURLWithPath: path)
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let input = try AVAudioFile(forReading: url)
            let format = input.processingFormat
            let excerpt = args["excerpt"] as? Bool ?? false
            let duration = Double(input.length) / format.sampleRate
            guard format.channelCount <= 2, duration > 0, duration <= (excerpt ? 600 : 180) else {
              throw NSError(domain: "ScoreStudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose a mono or stereo recording up to three minutes long."])
            }
            let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM,
              AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount,
              AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
              AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false]
            let target = try AVAudioFile(forWriting: URL(fileURLWithPath: output), settings: settings,
                commonFormat: format.commonFormat, interleaved: format.isInterleaved)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192) else {
              throw NSError(domain: "ScoreStudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Not enough memory to import audio."])
            }
            let endFrame = min(input.length, AVAudioFramePosition(format.sampleRate * 180))
            while input.framePosition < endFrame {
              let count = AVAudioFrameCount(min(8192, endFrame - input.framePosition))
              try input.read(into: buffer, frameCount: count)
              if buffer.frameLength == 0 { break }
              try target.write(from: buffer)
            }
          }
          DispatchQueue.main.async { result(output) }
        } catch {
          DispatchQueue.main.async { result(FlutterError(code: "audio_import", message: error.localizedDescription, details: nil)) }
        }
      }
    }
  }
}
