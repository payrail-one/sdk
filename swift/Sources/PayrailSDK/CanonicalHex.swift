import Foundation

public enum CanonicalHex {
    public static func decode(_ value: String, expectedBytes: Int? = nil) throws -> Data {
        guard value.count.isMultiple(of: 2),
              !value.isEmpty,
              value.range(of: #"^[0-9a-f]+$"#, options: .regularExpression) != nil
        else { throw PayrailSDKError.invalidField("expected canonical lowercase hexadecimal data") }
        if let expectedBytes, value.count != expectedBytes * 2 {
            throw PayrailSDKError.invalidField("hexadecimal data has an unexpected length")
        }
        var result = Data(capacity: value.count / 2)
        var index = value.startIndex
        while index < value.endIndex {
            let next = value.index(index, offsetBy: 2)
            guard let byte = UInt8(value[index..<next], radix: 16) else {
                throw PayrailSDKError.invalidField("expected canonical lowercase hexadecimal data")
            }
            result.append(byte)
            index = next
        }
        return result
    }
}
