import Foundation
import UIKit
import Vision
import Capacitor

/**
 * Текст и коды бирки, прочитанные на самом iPhone, — Apple Vision (аналог Android-плагина на ML Kit):
 * точное распознавание текста (VNRecognizeTextRequest) и кодов (VNDetectBarcodesRequest: QR, DataMatrix,
 * штрихкоды). Всё на устройстве, без сети. Поля бирки из этого собирают правила в WebView (`LabelExtractor.ts`).
 *
 * Фото приходит JPEG в Base64 уже в нужной ориентации (WebView перерисовал его с учётом EXIF). Текст читается
 * в каждом из заданных поворотов: бирку могли снять боком — какой поворот верный, решают правила по найденным
 * подписям. Рамки строк — в пикселях повёрнутого фото, от левого верхнего угла.
 */
@objc(TagOcrPlugin)
public class TagOcrPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "TagOcrPlugin"
    public let jsName = "TagOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    /// Языки бирок — только латиница: с русским Vision читал бы «B500C» кириллицей («В500С»).
    private static let languages = ["en-US", "de-DE", "fr-FR", "it-IT", "es-ES", "pt-BR"]

    private let queue = DispatchQueue(label: "TagOcr", qos: .userInitiated)

    /// Читает фото: `image` — JPEG в Base64, `rotations` — повороты по часовой стрелке, `codes` — читать ли коды.
    @objc public func read(_ call: CAPPluginCall) {
        guard let base64 = call.getString("image"),
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data)?.cgImage else {
            call.reject("Не удалось прочитать фото", "imageUnreadable")
            return
        }
        let rotations = call.getArray("rotations")?.compactMap { ($0 as? NSNumber)?.intValue } ?? [0]
        let readCodes = call.getBool("codes") ?? false
        queue.async {
            do {
                var pages: [JSObject] = []
                for rotation in rotations {
                    pages.append(try TagOcrPlugin.readPage(image, rotation: TagOcrPlugin.normalized(rotation)))
                }
                let codes = try readCodes ? TagOcrPlugin.readCodes(image) : []
                call.resolve(["pages": pages, "codes": codes])
            } catch {
                call.reject("Не удалось распознать текст: \(error.localizedDescription)", "failed", error)
            }
        }
    }

    /// Поворот, приведённый к 0, 90, 180 или 270.
    private static func normalized(_ rotation: Int) -> Int {
        (((rotation % 360) + 360) % 360) / 90 * 90
    }

    /// Ориентация для Vision: на сколько повернуть фото по часовой стрелке, чтобы текст встал ровно.
    private static func orientation(for rotation: Int) -> CGImagePropertyOrientation {
        switch rotation {
        case 90: return .right
        case 180: return .down
        case 270: return .left
        default: return .up
        }
    }

    /// Текст фото, повёрнутого на `rotation`: строки с рамками и уверенностью.
    private static func readPage(_ image: CGImage, rotation: Int) throws -> JSObject {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // Номера плавок и марки — не слова: «исправление» по словарю их бы портило.
        request.usesLanguageCorrection = false
        // По умолчанию Vision пропускает текст ниже 1/32 высоты фото, а строки бирки, снятой не вплотную, мельче.
        request.minimumTextHeight = 1.0 / 80
        if let supported = try? request.supportedRecognitionLanguages() {
            let preferred = languages.filter { supported.contains($0) }
            if !preferred.isEmpty { request.recognitionLanguages = preferred }
        }
        try VNImageRequestHandler(cgImage: image, orientation: orientation(for: rotation), options: [:]).perform([request])

        let sideways = rotation % 180 != 0
        let width = Double(sideways ? image.height : image.width)
        let height = Double(sideways ? image.width : image.height)
        var lines: [JSObject] = []
        for observation in request.results ?? [] {
            guard let candidate = observation.topCandidates(1).first else { continue }
            // У Vision доли от 0 до 1 с началом в левом нижнем углу повёрнутого фото — переводим в пиксели от левого верхнего.
            var corners: [Double] = []
            for point in [observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft] {
                corners.append(Double(point.x) * width)
                corners.append((1 - Double(point.y)) * height)
            }
            lines.append(["text": candidate.string, "corners": corners, "confidence": Double(candidate.confidence)])
        }
        return ["rotation": rotation, "width": Int(width), "height": Int(height), "lines": lines]
    }

    /// Коды на фото (поворот им не важен).
    private static func readCodes(_ image: CGImage) throws -> [JSObject] {
        let request = VNDetectBarcodesRequest()
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).compactMap { observation -> JSObject? in
            guard let text = observation.payloadStringValue, !text.isEmpty else { return nil }
            return ["text": text, "format": observation.symbology.rawValue]
        }
    }
}
