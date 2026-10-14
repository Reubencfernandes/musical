package com.reubencf.kiku_ai

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Handler
import android.os.Looper
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread

/**
 * Decodes MP3, M4A, OGG and the other formats Android plays into 16-bit WAV
 * for the studio and score, which read WAV and FLAC themselves.
 */
class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val main = Handler(Looper.getMainLooper())
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "kiku/audio").setMethodCallHandler { call, result ->
            val input = call.argument<String>("path")
            val output = call.argument<String>("output")
            if (call.method != "decode" || input == null || output == null) {
                result.notImplemented()
                return@setMethodCallHandler
            }
            thread(name = "kiku-decode") {
                try {
                    decodeToWav(input, output)
                    main.post { result.success(output) }
                } catch (e: Exception) {
                    File(output).delete()
                    main.post { result.error("audio_decode", e.message ?: "This audio could not be read.", null) }
                }
            }
        }
    }

    private fun decodeToWav(input: String, output: String) {
        val extractor = MediaExtractor()
        extractor.setDataSource(input)
        val track = (0 until extractor.trackCount).firstOrNull {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: throw IllegalArgumentException("This file has no audio track.")
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        if (format.containsKey(MediaFormat.KEY_DURATION) && format.getLong(MediaFormat.KEY_DURATION) > 11L * 60 * 1_000_000) {
            throw IllegalArgumentException("Choose a recording up to ten minutes long.")
        }
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()
        val out = RandomAccessFile(output, "rw")
        out.setLength(0)
        out.write(ByteArray(44))
        var written = 0L
        var floatPcm = false
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val index = codec.dequeueInputBuffer(10_000)
                    if (index >= 0) {
                        val buffer = codec.getInputBuffer(index)!!
                        val size = extractor.readSampleData(buffer, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val index = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val changed = codec.outputFormat
                        rate = changed.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = changed.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        floatPcm = changed.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            changed.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                    }
                    index >= 0 -> {
                        if (info.size > 0) {
                            val buffer = codec.getOutputBuffer(index)!!
                            buffer.position(info.offset)
                            buffer.limit(info.offset + info.size)
                            val bytes = if (floatPcm) floatTo16(buffer) else ByteArray(info.size).also { buffer.get(it) }
                            out.write(bytes)
                            written += bytes.size
                        }
                        codec.releaseOutputBuffer(index, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
            if (written == 0L) throw IllegalArgumentException("This file has no audio in it.")
            out.seek(0)
            out.write(header(written, rate, channels))
        } finally {
            out.close()
            codec.stop()
            codec.release()
            extractor.release()
        }
    }

    private fun floatTo16(buffer: ByteBuffer): ByteArray {
        val floats = buffer.order(ByteOrder.nativeOrder()).asFloatBuffer()
        val out = ByteBuffer.allocate(floats.remaining() * 2).order(ByteOrder.LITTLE_ENDIAN)
        while (floats.hasRemaining()) {
            val v = (floats.get().coerceIn(-1f, 1f) * 32767f).toInt()
            out.putShort(v.toShort())
        }
        return out.array()
    }

    private fun header(size: Long, rate: Int, channels: Int): ByteArray {
        val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt((36 + size).toInt()).put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(channels.toShort())
        b.putInt(rate).putInt(rate * channels * 2).putShort((channels * 2).toShort()).putShort(16)
        b.put("data".toByteArray()).putInt(size.toInt())
        return b.array()
    }
}
